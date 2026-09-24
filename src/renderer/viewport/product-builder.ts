/**
 * AlchemyWorx fork addition — renderer for generic parametric products.
 * See MODIFICATIONS.md and src/engine/products.ts.
 *
 * Deliberately dumb: every decision about size, placement, hinge geometry and
 * part layout is already made in the pure engine, in metres. This file only
 * turns `ResolvedProduct` into three.js primitives, so all the reasoning
 * stays unit-testable under Node.
 *
 * Grey-box conventions from builders.ts apply: origin at ground, forward is
 * −Z, no Math.random, MeshLambertMaterial with tint-aware userData.
 */

import * as THREE from 'three'
import type { ResolvedDoor, ResolvedPart, ResolvedPiece, ResolvedProduct } from '@engine/products'

/** Matches builders.ts so products tint with everything else. */
interface TintUserData {
  origColor?: number
}

const SHELL = 0x8a8a92
/** Doors and lids read a shade lighter so the opening is legible in clay. */
const PANEL = 0x9c9ca6
const HARDWARE = 0x3a3a42

function mesh(geometry: THREE.BufferGeometry, color: number): THREE.Mesh {
  const m = new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({ color }))
  m.castShadow = true
  m.receiveShadow = true
  ;(m.userData as TintUserData).origColor = color
  return m
}

/**
 * A box with chamfered edges, cheap enough to keep the whole library
 * low-poly. Real rounded corners would need a bevelled extrusion per piece;
 * at grey-box fidelity a chamfer reads the same and costs 24 triangles.
 */
function roundedBox(size: THREE.Vector3, radius: number, color: number): THREE.Object3D {
  const g = new THREE.Group()
  const r = Math.min(radius, size.x / 2.2, size.y / 2.2, size.z / 2.2)
  if (r <= 0.001) {
    g.add(mesh(new THREE.BoxGeometry(size.x, size.y, size.z), color))
    return g
  }
  // Core plus three inflated slabs: the silhouette picks up the chamfer from
  // whichever slab is widest on each axis.
  g.add(mesh(new THREE.BoxGeometry(size.x, size.y - r * 2, size.z), color))
  g.add(mesh(new THREE.BoxGeometry(size.x - r * 2, size.y, size.z), color))
  g.add(mesh(new THREE.BoxGeometry(size.x - r * 2, size.y - r * 2, size.z + r * 0.6), color))
  return g
}

function buildPiece(piece: ResolvedPiece): THREE.Object3D {
  const { size } = piece
  const body = new THREE.Group()

  if (piece.archetype === 'roundedBox') {
    const shell = roundedBox(new THREE.Vector3(size.x, size.y, size.z), piece.radius, SHELL)
    shell.position.y = size.y / 2
    body.add(shell)
  } else if (piece.archetype === 'cappedCylinder') {
    const m = mesh(new THREE.CylinderGeometry(size.x / 2, size.x / 2, size.y, 24), SHELL)
    m.position.y = size.y / 2
    body.add(m)
  } else {
    const top = (piece.topDiameter ?? size.x * 0.6) / 2
    const m = mesh(new THREE.CylinderGeometry(top, size.x / 2, size.y, 24), SHELL)
    m.position.y = size.y / 2
    body.add(m)
  }

  if (piece.door) body.add(buildDoor(piece.door))
  for (const part of piece.parts) body.add(buildPart(part))
  return body
}

function slab(size: { x: number; y: number; z: number }, color: number): THREE.Mesh {
  // Never let a zero extent through: a degenerate BoxGeometry renders as an
  // invisible sliver and looks like a missing panel.
  return mesh(
    new THREE.BoxGeometry(Math.max(size.x, 0.001), Math.max(size.y, 0.001), Math.max(size.z, 0.001)),
    color
  )
}

function buildDoor(door: ResolvedDoor): THREE.Object3D {
  // Pivot group at the hinge line; the slab hangs off it at slabOffset, so
  // rotating the group swings the panel the way a real hinge would.
  const pivot = new THREE.Group()
  pivot.position.set(door.pivot.x, door.pivot.y, door.pivot.z)
  if (door.axis === 'x') pivot.rotation.x = door.angle
  else pivot.rotation.y = door.angle

  const panel = slab(door.size, PANEL)
  panel.position.set(door.slabOffset.x, door.slabOffset.y, door.slabOffset.z)
  pivot.add(panel)

  if (door.fold) {
    // Secondary hinge lives in the parent slab's frame, so it is parented to
    // the panel and inherits the main swing for free.
    const foldPivot = new THREE.Group()
    foldPivot.position.set(door.fold.pivot.x, door.fold.pivot.y, door.fold.pivot.z)
    if (door.fold.axis === 'x') foldPivot.rotation.x = door.fold.angle
    else foldPivot.rotation.y = door.fold.angle
    const foldPanel = slab(door.fold.size, PANEL)
    foldPanel.position.set(door.fold.slabOffset.x, door.fold.slabOffset.y, door.fold.slabOffset.z)
    foldPivot.add(foldPanel)
    panel.add(foldPivot)
  }
  return pivot
}

function buildPart(part: ResolvedPart): THREE.Object3D {
  const g = new THREE.Group()
  g.position.set(part.position.x, part.position.y, part.position.z)

  switch (part.kind) {
    case 'wheels': {
      const w = mesh(new THREE.CylinderGeometry(part.size.x / 2, part.size.x / 2, part.size.z, 14), HARDWARE)
      w.rotation.z = Math.PI / 2
      g.add(w)
      break
    }
    case 'feet': {
      const f = mesh(new THREE.CylinderGeometry(part.size.x / 2, part.size.x / 2, part.size.y, 10), HARDWARE)
      g.add(f)
      break
    }
    case 'handle': {
      // Two rails plus a grip. A stowed handle (zero rise) still shows the
      // grip flush with the lid, which is what a real trolley looks like.
      const rise = part.size.y
      const railR = Math.max(part.size.z / 2, 0.004)
      if (rise > 0.002) {
        for (const sx of [-part.size.x / 2, part.size.x / 2]) {
          const rail = mesh(new THREE.CylinderGeometry(railR, railR, rise, 10), HARDWARE)
          rail.position.set(sx, 0, 0)
          g.add(rail)
        }
      }
      const grip = mesh(new THREE.BoxGeometry(part.size.x + railR * 2, railR * 2.4, railR * 2.4), HARDWARE)
      grip.position.y = rise / 2
      g.add(grip)
      break
    }
    case 'cap': {
      g.add(mesh(new THREE.CylinderGeometry(part.size.x / 2, part.size.x / 2, part.size.y, 24), SHELL))
      break
    }
    case 'pump': {
      g.add(mesh(new THREE.CylinderGeometry(part.size.x / 2, part.size.x / 2, part.size.y, 16), HARDWARE))
      const nozzle = mesh(
        new THREE.BoxGeometry(part.size.x * 0.9, part.size.y * 0.25, part.size.x * 0.5),
        HARDWARE
      )
      nozzle.position.set(part.size.x * 0.35, part.size.y / 2, 0)
      g.add(nozzle)
      break
    }
  }
  return g
}

/** Build the whole product. Origin at ground, centred in X and Z. */
export function buildResolvedProduct(product: ResolvedProduct): THREE.Group {
  const root = new THREE.Group()
  for (const piece of product.pieces) {
    const g = buildPiece(piece)
    g.position.set(piece.position.x, piece.position.y, piece.position.z)
    g.rotation.y = piece.rotationY
    root.add(g)
  }
  return root
}
