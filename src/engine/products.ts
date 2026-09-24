/**
 * AlchemyWorx fork addition — generic parametric products. See MODIFICATIONS.md.
 *
 * A product is a *data preset*, never code. Three archetypes (rounded box,
 * capped cylinder, tapered tube), an optional hinged door or lid per piece,
 * attachable parts, and compound presets that place several pieces at
 * relative offsets. That vocabulary covers luggage, cosmetics and
 * odd-shaped appliances without a builder per client.
 *
 * Fidelity is explicitly not the goal (see the Key decisions table in
 * docs/HANDOFF.md). Geometry carries real-world dimensions, silhouette and
 * placement; product appearance comes from reference images handed to the
 * image model. A preset only has to be the right size and the right rough
 * shape.
 *
 * This module is PURE: no DOM, no three.js, no Electron. It turns a preset
 * plus a state name into `ResolvedProduct`, a flat list of primitives in
 * METRES in the product's own space, which the renderer builds verbatim.
 * All the geometry reasoning is therefore unit-testable under Node.
 *
 * Conventions follow AGENTS.md: metres, radians, origin at ground, centred
 * in X and Z, front face toward −Z.
 */

import BUILTIN_PRODUCTS_JSON from './products.json'

// ---------------------------------------------------------------------------
// Units

export type LengthUnit = 'in' | 'cm' | 'mm' | 'm'

const METRES_PER: Record<LengthUnit, number> = {
  in: 0.0254,
  cm: 0.01,
  mm: 0.001,
  m: 1
}

export function isLengthUnit(v: unknown): v is LengthUnit {
  return typeof v === 'string' && v in METRES_PER
}

/** Convert a length in `unit` to metres. */
export function toMetres(value: number, unit: LengthUnit): number {
  return value * METRES_PER[unit]
}

// ---------------------------------------------------------------------------
// Preset schema (what lives in JSON)

export type ProductArchetype = 'roundedBox' | 'cappedCylinder' | 'taperedTube'

/** Which face of a piece something sits on. Front is −Z, matching heading 0. */
export type Face = 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom'

export type PartKind = 'handle' | 'wheels' | 'feet' | 'cap' | 'pump'

export interface DoorSpec {
  /** Face the door or lid occupies. `top` reads as a lid. */
  face: Face
  /** Edge the hinge runs along, seen looking at that face from outside. */
  hinge: 'bottom' | 'top' | 'left' | 'right'
  /** Slab thickness, in the piece's unit. */
  thickness: number
  /** Fraction of the face the door covers, 0..1. Default 1. */
  coverage?: number
  /**
   * Fraction of the door measured from its free edge that folds on its own
   * secondary hinge. The Biaggi Runway's laptop flap is this: the top of the
   * front panel folds down while the panel itself stays shut. 0 or absent
   * means a plain one-piece door.
   */
  foldFraction?: number
}

export interface PartSpec {
  kind: PartKind
  /** Face it attaches to. Defaults per kind (wheels/feet bottom, cap top). */
  face?: Face
  /** Primary size in the piece's unit: length for a handle, diameter for a
   *  wheel or cap, height for a pump. Defaults per kind. */
  size?: number
  /** Secondary size in the piece's unit: cap/pump height, wheel width. */
  depth?: number
  /** How many, for repeated parts. Default 4 for wheels and feet, 1 otherwise. */
  count?: number
  /**
   * Telescoping stop heights above the piece, in the piece's unit, for a
   * handle. Index 0 is stowed. A state picks one by index.
   */
  stops?: number[]
}

export interface PieceSpec {
  archetype: ProductArchetype
  /** Overrides the preset unit for this piece only. */
  unit?: LengthUnit
  /** X extent. For cylinders and tubes this is the base diameter. */
  width: number
  /** Y extent. */
  height: number
  /** Z extent. Ignored for cylinders and tubes, which are circular in plan. */
  depth?: number
  /** Top diameter for `taperedTube`. Defaults to 60% of `width`. */
  topWidth?: number
  /** Corner radius for `roundedBox`. Defaults to 6% of the smallest extent. */
  radius?: number
  /** Z extent when a state sets `expand`. */
  expandedDepth?: number
  /** Offset of this piece's bottom-centre from the product origin. */
  offset?: { x?: number; y?: number; z?: number }
  /** Yaw of this piece about its own bottom-centre, in degrees. */
  rotationYDeg?: number
  door?: DoorSpec
  parts?: PartSpec[]
}

export interface StateSpec {
  id: string
  label: string
  /** Door opening angle in degrees. Default 0. */
  door?: number
  /** Secondary fold angle in degrees, needs `door.foldFraction`. Default 0. */
  fold?: number
  /** Use `expandedDepth` on every piece that declares one. */
  expand?: boolean
  /** Index into a handle's `stops`. Default 0 (stowed). */
  handleStop?: number
}

export interface ProductPreset {
  id: string
  name: string
  /** Grouping for the library UI, e.g. 'luggage', 'cosmetics', 'appliance'. */
  category: string
  /** Default unit for every piece that does not override it. */
  unit: LengthUnit
  /** Noun used in generated prompts, e.g. 'a hardside carry-on suitcase'. */
  promptNoun: string
  pieces: PieceSpec[]
  states?: StateSpec[]
  defaultState?: string
  /** Free-text provenance. Put the spec page URL here, never a guess. */
  source?: string
}

// ---------------------------------------------------------------------------
// Resolved output (what the renderer consumes) — everything in METRES

export interface Vec3 {
  x: number
  y: number
  z: number
}

export interface ResolvedPart {
  kind: PartKind
  /** Centre of the part in product space. */
  position: Vec3
  /** Bounding size. For round parts, x is the diameter. */
  size: Vec3
  /** Round parts spin about this axis; absent for box-ish parts. */
  axis?: 'x' | 'y' | 'z'
}

export interface ResolvedDoor {
  /** Slab extent before rotation. */
  size: Vec3
  /** Hinge line position in product space. */
  pivot: Vec3
  /** Axis the hinge turns about. */
  axis: 'x' | 'y'
  /** Rotation in radians, signed so positive opens outward. */
  angle: number
  /**
   * Offset of the slab's centre from the pivot, in the door's own unrotated
   * frame. The renderer parents the slab to a group at `pivot`, rotates the
   * group, and places the slab at this offset.
   */
  slabOffset: Vec3
  /** Present when `foldFraction` is set: a second hinge on the slab itself. */
  fold?: {
    size: Vec3
    /** Pivot in the parent slab's frame. */
    pivot: Vec3
    axis: 'x' | 'y'
    angle: number
    slabOffset: Vec3
  }
}

export interface ResolvedPiece {
  archetype: ProductArchetype
  /** Full extent in metres. x is the diameter for round archetypes. */
  size: Vec3
  /** Top diameter for `taperedTube`, metres. */
  topDiameter?: number
  /** Corner radius for `roundedBox`, metres. */
  radius: number
  /** Bottom-centre of the piece in product space, metres. */
  position: Vec3
  rotationY: number
  door?: ResolvedDoor
  parts: ResolvedPart[]
}

export interface ResolvedProduct {
  id: string
  name: string
  promptNoun: string
  stateId: string
  pieces: ResolvedPiece[]
  /** Axis-aligned extent of the whole product with parts, metres. */
  bounds: { width: number; height: number; depth: number }
  /** Convenience: `bounds.height`, what the catalog and auto-framing want. */
  height: number
  /** Convenience: half the larger ground extent, what the catalog wants. */
  footprint: number
}

// ---------------------------------------------------------------------------
// Defaults

const DEFAULT_PART_SIZE: Record<PartKind, { size: number; depth: number; count: number }> = {
  // Sizes are fractions of the host piece, resolved below, except where the
  // preset gives an explicit value in its unit.
  handle: { size: 0, depth: 0, count: 1 },
  wheels: { size: 0, depth: 0, count: 4 },
  feet: { size: 0, depth: 0, count: 4 },
  cap: { size: 0, depth: 0, count: 1 },
  pump: { size: 0, depth: 0, count: 1 }
}

const DEFAULT_PART_FACE: Record<PartKind, Face> = {
  handle: 'top',
  wheels: 'bottom',
  feet: 'bottom',
  cap: 'top',
  pump: 'top'
}

const deg = (d: number): number => (d * Math.PI) / 180

/**
 * Collapse -0 to 0. Signs multiply through the face/hinge maths and JavaScript
 * keeps -0 distinct under Object.is, which would make two structurally
 * identical resolutions compare unequal.
 */
const z0 = (n: number): number => (n === 0 ? 0 : n)

// ---------------------------------------------------------------------------
// Resolution

function pieceUnit(preset: ProductPreset, piece: PieceSpec): LengthUnit {
  return piece.unit && isLengthUnit(piece.unit) ? piece.unit : preset.unit
}

function resolveParts(
  piece: PieceSpec,
  u: LengthUnit,
  size: Vec3,
  state: StateSpec
): ResolvedPart[] {
  const out: ResolvedPart[] = []
  for (const spec of piece.parts ?? []) {
    const face = spec.face ?? DEFAULT_PART_FACE[spec.kind]
    const count = spec.count ?? DEFAULT_PART_SIZE[spec.kind].count
    const half = { x: size.x / 2, z: size.z / 2 }

    if (spec.kind === 'wheels' || spec.kind === 'feet') {
      // Spinner wheels hang below the shell; feet sit flush under it. Both
      // ride the bottom corners, inset so they read as corner-mounted.
      const d = spec.size !== undefined ? toMetres(spec.size, u) : Math.min(size.x, size.z) * 0.14
      const w = spec.depth !== undefined ? toMetres(spec.depth, u) : d * 0.55
      const insetX = Math.max(half.x - d * 0.85, 0)
      const insetZ = Math.max(half.z - d * 0.85, 0)
      // Corner order is stable so exports stay byte-deterministic.
      const corners: [number, number][] =
        count <= 2
          ? [
              [0, -insetZ],
              [0, insetZ]
            ]
          : [
              [-insetX, -insetZ],
              [insetX, -insetZ],
              [-insetX, insetZ],
              [insetX, insetZ]
            ]
      for (const [cx, cz] of corners.slice(0, count)) {
        out.push({
          kind: spec.kind,
          position: { x: cx, y: -d / 2, z: cz },
          size: { x: d, y: d, z: w },
          axis: 'x'
        })
      }
      continue
    }

    if (spec.kind === 'handle') {
      // A telescoping trolley handle: two rails plus a grip, expressed as one
      // part whose Y extent is the chosen stop. The renderer draws the rails.
      const stops = spec.stops?.length ? spec.stops : [0]
      const idx = Math.min(Math.max(state.handleStop ?? 0, 0), stops.length - 1)
      const rise = toMetres(stops[idx] ?? 0, u)
      const span = spec.size !== undefined ? toMetres(spec.size, u) : size.x * 0.62
      const thickness = spec.depth !== undefined ? toMetres(spec.depth, u) : Math.min(size.z * 0.22, 0.03)
      // `top` sits it on the lid; `back` recesses it against the rear face.
      const z = face === 'back' ? half.z - thickness : 0
      out.push({
        kind: 'handle',
        position: { x: 0, y: size.y + rise / 2, z },
        size: { x: span, y: rise, z: thickness },
        axis: 'y'
      })
      continue
    }

    // cap / pump: a short coaxial cylinder stacked on the top face.
    const d = spec.size !== undefined ? toMetres(spec.size, u) : size.x * (spec.kind === 'cap' ? 1.02 : 0.42)
    const h = spec.depth !== undefined ? toMetres(spec.depth, u) : size.y * (spec.kind === 'cap' ? 0.42 : 0.3)
    out.push({
      kind: spec.kind,
      position: { x: 0, y: size.y + h / 2, z: 0 },
      size: { x: d, y: h, z: d },
      axis: 'y'
    })
  }
  return out
}

function resolveDoor(
  spec: DoorSpec,
  u: LengthUnit,
  size: Vec3,
  state: StateSpec
): ResolvedDoor {
  const coverage = Math.min(Math.max(spec.coverage ?? 1, 0.05), 1)
  const thickness = toMetres(spec.thickness, u)
  const angle = deg(state.door ?? 0)

  // Face geometry: which two extents the slab spans, and where its plane sits.
  const onZ = spec.face === 'front' || spec.face === 'back'
  const onTop = spec.face === 'top'
  const spanX = onTop || onZ ? size.x * coverage : thickness
  const spanY = onTop ? thickness : size.y * coverage
  const spanZ = onTop ? size.z * coverage : onZ ? thickness : size.z * coverage
  const slab: Vec3 = { x: spanX, y: spanY, z: spanZ }

  // Outward normal of the face, used to sit the slab proud of the shell and
  // to sign the opening rotation.
  const sign = spec.face === 'front' || spec.face === 'left' ? -1 : 1
  const planeZ = onZ ? sign * (size.z / 2 + thickness / 2) : 0
  const planeX = spec.face === 'left' || spec.face === 'right' ? sign * (size.x / 2 + thickness / 2) : 0
  const planeY = onTop ? size.y + thickness / 2 : size.y / 2

  // Hinge line and the slab's offset from it.
  let pivot: Vec3
  let axis: 'x' | 'y'
  let slabOffset: Vec3
  if (spec.hinge === 'bottom' || spec.hinge === 'top') {
    axis = 'x'
    const edge = spec.hinge === 'bottom' ? -1 : 1
    if (onTop) {
      pivot = { x: planeX, y: planeY, z: edge * (slab.z / 2) }
      slabOffset = { x: 0, y: 0, z: -edge * (slab.z / 2) }
    } else {
      pivot = { x: planeX, y: planeY + edge * (slab.y / 2), z: planeZ }
      slabOffset = { x: 0, y: -edge * (slab.y / 2), z: 0 }
    }
  } else {
    axis = 'y'
    const edge = spec.hinge === 'left' ? -1 : 1
    pivot = { x: planeX + edge * (slab.x / 2), y: planeY, z: planeZ }
    slabOffset = { x: -edge * (slab.x / 2), y: 0, z: 0 }
  }

  const door: ResolvedDoor = {
    size: slab,
    pivot,
    axis,
    angle: z0(angle * sign * (spec.hinge === 'top' ? -1 : 1)),
    slabOffset
  }

  const foldFraction = spec.foldFraction ?? 0
  if (foldFraction > 0 && foldFraction < 1) {
    // The fold occupies the free-edge end of the slab and turns about a hinge
    // parallel to the main one. Expressed in the slab's own frame so the
    // renderer can nest it without knowing anything about faces.
    const along = axis === 'x' && !onTop ? 'y' : axis === 'x' ? 'z' : 'x'
    const slabSpan = along === 'y' ? slab.y : along === 'z' ? slab.z : slab.x
    const foldSpan = slabSpan * foldFraction
    const freeSign = spec.hinge === 'bottom' || spec.hinge === 'left' ? 1 : -1
    const foldSize: Vec3 = { ...slab }
    if (along === 'y') foldSize.y = foldSpan
    else if (along === 'z') foldSize.z = foldSpan
    else foldSize.x = foldSpan
    // The hinge sits on the MAIN slab's free edge, and that slab has already
    // given away `foldSpan`, so measure against the shrunk span. Using the
    // original span put the flap half its own length too far in, overlapping
    // the panel instead of continuing from it.
    const hingeAt = freeSign * ((slabSpan - foldSpan) / 2)
    door.fold = {
      size: foldSize,
      pivot:
        along === 'y'
          ? { x: 0, y: hingeAt, z: 0 }
          : along === 'z'
            ? { x: 0, y: 0, z: hingeAt }
            : { x: hingeAt, y: 0, z: 0 },
      axis,
      angle: z0(deg(state.fold ?? 0) * sign * freeSign),
      slabOffset:
        along === 'y'
          ? { x: 0, y: freeSign * (foldSpan / 2), z: 0 }
          : along === 'z'
            ? { x: 0, y: 0, z: freeSign * (foldSpan / 2) }
            : { x: freeSign * (foldSpan / 2), y: 0, z: 0 }
    }
    // The main slab shrinks by the fold it gave away.
    if (along === 'y') door.size = { ...slab, y: slabSpan - foldSpan }
    else if (along === 'z') door.size = { ...slab, z: slabSpan - foldSpan }
    else door.size = { ...slab, x: slabSpan - foldSpan }
    door.slabOffset = {
      x: door.slabOffset.x + (along === 'x' ? -freeSign * (foldSpan / 2) : 0),
      y: door.slabOffset.y + (along === 'y' ? -freeSign * (foldSpan / 2) : 0),
      z: door.slabOffset.z + (along === 'z' ? -freeSign * (foldSpan / 2) : 0)
    }
  }

  return door
}

export function findState(preset: ProductPreset, stateId?: string): StateSpec {
  const states = preset.states ?? []
  const wanted = stateId ?? preset.defaultState
  return (
    states.find((s) => s.id === wanted) ??
    states.find((s) => s.id === preset.defaultState) ??
    states[0] ?? { id: 'default', label: 'Default' }
  )
}

/**
 * Turn a preset plus a state into metre-space primitives. Pure and total: an
 * unknown state falls back to the default, and missing optional fields take
 * their documented defaults, so a hand-written preset cannot throw here.
 */
export function resolveProduct(preset: ProductPreset, stateId?: string): ResolvedProduct {
  const state = findState(preset, stateId)
  const pieces: ResolvedPiece[] = []

  let minX = Infinity
  let maxX = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  let maxY = 0
  let minY = 0

  for (const spec of preset.pieces) {
    const u = pieceUnit(preset, spec)
    const useExpanded = state.expand === true && spec.expandedDepth !== undefined
    const depthValue = useExpanded ? spec.expandedDepth! : (spec.depth ?? spec.width)
    const size: Vec3 = {
      x: toMetres(spec.width, u),
      y: toMetres(spec.height, u),
      z: toMetres(depthValue, u)
    }
    // Round archetypes are circular in plan, so depth tracks the diameter.
    if (spec.archetype !== 'roundedBox') size.z = size.x

    const radius =
      spec.radius !== undefined
        ? toMetres(spec.radius, u)
        : Math.min(size.x, size.y, size.z) * 0.06

    const position: Vec3 = {
      x: toMetres(spec.offset?.x ?? 0, u),
      y: toMetres(spec.offset?.y ?? 0, u),
      z: toMetres(spec.offset?.z ?? 0, u)
    }

    const parts = resolveParts(spec, u, size, state)
    const piece: ResolvedPiece = {
      archetype: spec.archetype,
      size,
      radius,
      position,
      rotationY: deg(spec.rotationYDeg ?? 0),
      parts,
      ...(spec.archetype === 'taperedTube'
        ? { topDiameter: toMetres(spec.topWidth ?? spec.width * 0.6, u) }
        : {})
    }
    if (spec.door) piece.door = resolveDoor(spec.door, u, size, state)
    pieces.push(piece)

    // Bounds: the shell plus anything that sticks out of it. Doors are left
    // out on purpose — an open panel should not change how the product frames.
    minX = Math.min(minX, position.x - size.x / 2)
    maxX = Math.max(maxX, position.x + size.x / 2)
    minZ = Math.min(minZ, position.z - size.z / 2)
    maxZ = Math.max(maxZ, position.z + size.z / 2)
    maxY = Math.max(maxY, position.y + size.y)
    for (const part of parts) {
      minX = Math.min(minX, position.x + part.position.x - part.size.x / 2)
      maxX = Math.max(maxX, position.x + part.position.x + part.size.x / 2)
      minZ = Math.min(minZ, position.z + part.position.z - part.size.z / 2)
      maxZ = Math.max(maxZ, position.z + part.position.z + part.size.z / 2)
      maxY = Math.max(maxY, position.y + part.position.y + part.size.y / 2)
      minY = Math.min(minY, position.y + part.position.y - part.size.y / 2)
    }
  }

  // Spinner wheels and feet hang below their shell, so the lowest point of the
  // product is not y=0. Lift everything so the product rests on the ground,
  // per the origin-at-ground convention, and report the true overall height —
  // a 22" carry-on is 20.4" of shell plus 1.6" of wheel, and it is the 22 that
  // has to match the airline limit.
  const lift = minY < 0 ? -minY : 0
  if (lift > 0) for (const piece of pieces) piece.position.y += lift

  const width = isFinite(maxX - minX) ? maxX - minX : 0
  const depth = isFinite(maxZ - minZ) ? maxZ - minZ : 0
  const height = maxY - minY
  return {
    id: preset.id,
    name: preset.name,
    promptNoun: preset.promptNoun,
    stateId: state.id,
    pieces,
    bounds: { width, height, depth },
    height,
    footprint: Math.max(width, depth) / 2
  }
}

// ---------------------------------------------------------------------------
// Registry

/** Asset ids for products are namespaced so `buildAsset` can route them. */
export const PRODUCT_ASSET_PREFIX = 'product.'

export const productAssetId = (presetId: string): string => `${PRODUCT_ASSET_PREFIX}${presetId}`

export function isProductAssetId(assetId: string): boolean {
  return assetId.startsWith(PRODUCT_ASSET_PREFIX)
}

export function presetIdFromAssetId(assetId: string): string {
  return assetId.slice(PRODUCT_ASSET_PREFIX.length)
}

const BUILTIN: ProductPreset[] = BUILTIN_PRODUCTS_JSON as ProductPreset[]

/** Presets shipped with the app. Never mutated. */
export function builtinProducts(): ProductPreset[] {
  return BUILTIN
}

let projectOverrides: ProductPreset[] = []

/**
 * Install per-project presets, read from `<project>/products/*.json`. A
 * project preset with the same id as a built-in replaces it wholesale, which
 * is how a client tweaks a shipped product without forking the app.
 */
export function setProjectProducts(presets: ProductPreset[]): void {
  projectOverrides = presets.filter(isValidPreset)
}

export function clearProjectProducts(): void {
  projectOverrides = []
}

/** Built-ins with project overrides applied, stable order for determinism. */
export function allProducts(): ProductPreset[] {
  const byId = new Map<string, ProductPreset>()
  for (const p of BUILTIN) byId.set(p.id, p)
  for (const p of projectOverrides) byId.set(p.id, p)
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id))
}

export function getProduct(presetId: string): ProductPreset | undefined {
  return allProducts().find((p) => p.id === presetId)
}

/**
 * Structural check for hand-written JSON. Deliberately shallow: it rejects
 * what would crash or silently render nothing, and lets everything else
 * through to the documented defaults.
 */
export function isValidPreset(value: unknown): value is ProductPreset {
  if (typeof value !== 'object' || value === null) return false
  const p = value as Partial<ProductPreset>
  if (typeof p.id !== 'string' || !p.id) return false
  if (typeof p.name !== 'string' || !p.name) return false
  if (typeof p.promptNoun !== 'string' || !p.promptNoun) return false
  if (!isLengthUnit(p.unit)) return false
  if (!Array.isArray(p.pieces) || p.pieces.length === 0) return false
  return p.pieces.every((piece) => {
    if (typeof piece !== 'object' || piece === null) return false
    const q = piece as Partial<PieceSpec>
    const archetypes: ProductArchetype[] = ['roundedBox', 'cappedCylinder', 'taperedTube']
    if (!archetypes.includes(q.archetype as ProductArchetype)) return false
    return (
      typeof q.width === 'number' &&
      q.width > 0 &&
      typeof q.height === 'number' &&
      q.height > 0 &&
      (q.depth === undefined || (typeof q.depth === 'number' && q.depth > 0))
    )
  })
}

/** Parse the contents of one project preset file. Never throws. */
export function parseProductFile(text: string): ProductPreset[] {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return []
  }
  const list = Array.isArray(data) ? data : [data]
  return list.filter(isValidPreset)
}
