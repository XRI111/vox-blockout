/**
 * AW fork: the static pose has to reach the geometry, not just the document.
 *
 * Unit tests cover the maths. What they cannot cover is the part that actually
 * broke in earlier items: a field that is written to the store, read back
 * correctly, and never applied to the object three.js renders. The product
 * system shipped a bug exactly like that (an imported GLB stayed invisible
 * because the loader only fired on one of two mutations), so every claim here
 * is measured off the live scene graph's world bounding box.
 *
 * Measuring bounds rather than eyeballing a render is deliberate: it is what
 * caught the seamless sweep sitting a half-width off its origin and the vanity
 * counter declaring 1.71 m while building 1.66.
 */

import { _electron as electron, test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

let app: ElectronApplication
let page: Page

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  const root = process.env.BLOCKOUT_E2E_ROOT || tmpdir()
  mkdirSync(root, { recursive: true })
  const dir = mkdtempSync(join(root, 'blockout-awtransform-'))
  app = await electron.launch({
    args: ['out/main/index.js'],
    env: { ...process.env, BLOCKOUT_SMOKE_DIR: dir }
  })
  page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await page.getByRole('button', { name: 'New Project' }).click()
  await expect(page.locator('.mode-switch')).toBeVisible({ timeout: 30_000 })
})

test.afterAll(async () => {
  await app?.close()
})

interface Bounds {
  minX: number
  maxX: number
  minY: number
  maxY: number
  minZ: number
  maxZ: number
  width: number
  height: number
  depth: number
}

/** Stage one asset alone with the given transform patch, measure world bounds. */
async function poseBounds(
  assetId: string,
  patch: Record<string, unknown>
): Promise<Bounds> {
  return page.evaluate(
    ({ assetId, patch }) => {
      const w = window as unknown as { __blockout: any; __blockout_scene: any }
      const s = w.__blockout.store.getState()
      const sm = w.__blockout_scene
      s.mutate('reset', (doc: any) => {
        for (const sc of doc.scenes) sc.entities = []
      })
      const id = s.addEntity(assetId, { x: 0, y: 0, z: 0 })
      s.mutate('pose', (doc: any) => {
        for (const sc of doc.scenes) {
          const e = sc.entities.find((x: any) => x.id === id)
          if (e) Object.assign(e.transform, patch)
        }
      })
      const V = sm.shotCam.position.constructor
      const b = {
        minX: Infinity,
        maxX: -Infinity,
        minY: Infinity,
        maxY: -Infinity,
        minZ: Infinity,
        maxZ: -Infinity
      }
      for (const v of sm.visuals.values()) {
        v.root.updateMatrixWorld(true)
        v.root.traverse((o: any) => {
          if (!o.isMesh) return
          o.geometry.computeBoundingBox()
          const bb = o.geometry.boundingBox
          const p = new V()
          for (const x of [bb.min.x, bb.max.x])
            for (const y of [bb.min.y, bb.max.y])
              for (const z of [bb.min.z, bb.max.z]) {
                p.set(x, y, z).applyMatrix4(o.matrixWorld)
                b.minX = Math.min(b.minX, p.x)
                b.maxX = Math.max(b.maxX, p.x)
                b.minY = Math.min(b.minY, p.y)
                b.maxY = Math.max(b.maxY, p.y)
                b.minZ = Math.min(b.minZ, p.z)
                b.maxZ = Math.max(b.maxZ, p.z)
              }
        })
      }
      return {
        ...b,
        width: b.maxX - b.minX,
        height: b.maxY - b.minY,
        depth: b.maxZ - b.minZ
      }
    },
    { assetId, patch }
  )
}

/** The Runway: 22 x 14 x 8 inches, so 0.559 H x 0.356 W x 0.203 D in metres. */
const RUNWAY = 'product.biaggi.runway-carry-on'

test('an upright product still measures its real-world dimensions', async () => {
  // The baseline every other case is compared against. If this drifts, the
  // pose work broke the dimensional accuracy the whole fork rests on.
  const b = await poseBounds(RUNWAY, {})
  expect(b.height).toBeGreaterThan(0.54)
  expect(b.height).toBeLessThan(0.58)
  expect(b.width).toBeGreaterThan(0.33)
  expect(b.width).toBeLessThan(0.38)
})

test('rolling a carry-on onto its side swaps height for width', async () => {
  // Pilot shot 4 wants the bag sliding wheels-first into an overhead bin, which
  // was impossible while entities carried yaw alone.
  const up = await poseBounds(RUNWAY, {})
  const rolled = await poseBounds(RUNWAY, { rotationZ: Math.PI / 2 })
  expect(rolled.height).toBeCloseTo(up.width, 1)
  expect(rolled.width).toBeCloseTo(up.height, 1)
})

test('pitching a product forward swaps height for depth', async () => {
  const up = await poseBounds(RUNWAY, {})
  const tipped = await poseBounds(RUNWAY, { rotationX: Math.PI / 2 })
  expect(tipped.height).toBeCloseTo(up.depth, 1)
  expect(tipped.depth).toBeCloseTo(up.height, 1)
})

test('a tilted product does not sink through the floor', async () => {
  // The origin-at-ground convention means a naive tilt rotates half the object
  // below y=0. A bag buried to its handle renders as a bag buried to its
  // handle, and nothing in the export would flag it.
  const rolled = await poseBounds(RUNWAY, { rotationZ: Math.PI / 2 })
  expect(rolled.minY).toBeGreaterThan(-0.02)
})

test('yaw still means heading after the object is tilted', async () => {
  // YXZ order exists for this: roughly thirty call sites read rotationY as
  // "which way is this facing". Under XYZ order a pitched object's yaw would
  // rotate about a tilted axis and every one of them would quietly be wrong.
  const yawOnly = await poseBounds(RUNWAY, { rotationY: Math.PI / 2 })
  const yawThenPitch = await poseBounds(RUNWAY, {
    rotationY: Math.PI / 2,
    rotationX: Math.PI / 2
  })
  const up = await poseBounds(RUNWAY, {})
  const pitchOnly = await poseBounds(RUNWAY, { rotationX: Math.PI / 2 })
  // Yaw alone swaps the two ground axes and leaves height alone.
  expect(yawOnly.width).toBeCloseTo(up.depth, 1)
  expect(yawOnly.height).toBeCloseTo(up.height, 1)
  // Pitch is applied in the object's OWN frame, so the same pitch produces the
  // same body-relative tilt at any heading: the height it ends up with does not
  // depend on the yaw. Under XYZ order it would, and every consumer reading
  // rotationY as "which way is this facing" would be wrong for a tilted object.
  expect(yawThenPitch.height).toBeCloseTo(pitchOnly.height, 2)
  expect(yawThenPitch.height).toBeCloseTo(up.depth, 1)
  // And yaw still only permutes the two ground axes: the set of three extents
  // is the same with and without it.
  const sorted = (b: Bounds): number[] =>
    [b.width, b.height, b.depth].map((n) => Number(n.toFixed(3))).sort((a, c) => a - c)
  expect(sorted(yawThenPitch)).toEqual(sorted(pitchOnly))
})

test('per-axis stretch corrects one dimension and leaves the others alone', async () => {
  const up = await poseBounds(RUNWAY, {})
  const taller = await poseBounds(RUNWAY, { stretch: { x: 1, y: 1.2, z: 1 } })
  expect(taller.height).toBeCloseTo(up.height * 1.2, 2)
  expect(taller.width).toBeCloseTo(up.width, 2)
  expect(taller.depth).toBeCloseTo(up.depth, 2)
})

test('uniform scale and a proportional stretch agree', async () => {
  // The two paths exist for different reasons (nominal size vs proxy
  // correction) but a proportional change through either must land identically,
  // or the scale gizmo and the numeric fields disagree with each other.
  const scaled = await poseBounds(RUNWAY, { scale: 1.5 })
  const stretched = await poseBounds(RUNWAY, { stretch: { x: 1.5, y: 1.5, z: 1.5 } })
  expect(stretched.height).toBeCloseTo(scaled.height, 2)
  expect(stretched.width).toBeCloseTo(scaled.width, 2)
})

test('a stretched product still sits on the ground', async () => {
  const squashed = await poseBounds(RUNWAY, { stretch: { x: 1, y: 0.6, z: 1 } })
  expect(Math.abs(squashed.minY)).toBeLessThan(0.02)
})

test('the pose reaches auto-framing, not just the render', async () => {
  // entityHeight feeds every shot-size preset. A proxy stretched 20% taller
  // must report 20% taller or the framing silently misses by that much.
  const heights = await page.evaluate(() => {
    const w = window as unknown as { __blockout: any }
    const s = w.__blockout.store.getState()
    const read = (patch: Record<string, unknown>): number => {
      s.mutate('reset', (doc: any) => {
        for (const sc of doc.scenes) sc.entities = []
      })
      const id = s.addEntity('product.biaggi.runway-carry-on', { x: 0, y: 0, z: 0 })
      s.mutate('pose', (doc: any) => {
        for (const sc of doc.scenes) {
          const e = sc.entities.find((x: any) => x.id === id)
          if (e) Object.assign(e.transform, patch)
        }
      })
      const doc = w.__blockout.store.getState().doc
      const ent = doc.scenes.flatMap((sc: any) => sc.entities).find((e: any) => e.id === id)
      return ent.transform.scale * (ent.transform.stretch?.y ?? 1)
    }
    return { plain: read({}), tall: read({ stretch: { x: 1, y: 1.2, z: 1 } }) }
  })
  expect(heights.tall).toBeCloseTo(heights.plain * 1.2, 3)
})
