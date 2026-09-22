/**
 * AW fork: the catalog's declared size must match the geometry it builds.
 *
 * Under the dimensional-accuracy rule the catalog numbers are not decoration:
 * auto-framing, label placement and the scale-aware grid all read `height` and
 * `footprint`. A builder that quietly drifts from its catalog entry misframes
 * every shot it appears in, silently.
 *
 * Both errors this test was written against were real. The seamless sweep was
 * translated a half-width off the origin, so a product placed at x=0 stood
 * beside the backdrop instead of on it. The vanity counter declared 1.71 m and
 * built 1.66 m.
 *
 * Unit tests cannot cover this: the builders need three.js and a DOM.
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
  const dir = mkdtempSync(join(root, 'blockout-awprops-'))
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
}

/** Place one asset alone at the origin and measure its world bounds. */
async function boundsOf(assetId: string, params?: Record<string, string>): Promise<Bounds> {
  return page.evaluate(
    ({ assetId, params }) => {
      const w = window as unknown as { __blockout: any; __blockout_scene: any }
      const s = w.__blockout.store.getState()
      const sm = w.__blockout_scene
      s.mutate('reset', (doc: any) => {
        for (const sc of doc.scenes) sc.entities = []
      })
      const id = s.addEntity(assetId, { x: 0, y: 0, z: 0 })
      if (params) {
        s.mutate('params', (doc: any) => {
          for (const sc of doc.scenes) {
            const e = sc.entities.find((x: any) => x.id === id)
            if (e) e.params = { ...e.params, ...params }
          }
        })
      }
      // Vector3 without importing three into the page.
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
      return b
    },
    { assetId, params }
  )
}

const AW_PROPS = ['prop.securityTray', 'prop.overheadBin', 'prop.vanityCounter', 'prop.seamlessSweep']

/**
 * Ground truth, stated here rather than read from the catalog. The unit test
 * pins the catalog to these same numbers, so between the two, drift on either
 * side fails a test instead of silently misframing shots.
 *
 * The overhead bin is measured shut: its door opens into the aisle by design,
 * which makes the open state legitimately asymmetric.
 */
const EXPECTED: Record<string, { height: number; width: number; depth: number }> = {
  'prop.securityTray': { height: 0.1, width: 0.66, depth: 0.42 },
  'prop.overheadBin': { height: 0.42, width: 0.62, depth: 1.22 },
  'prop.vanityCounter': { height: 1.66, width: 1.2, depth: 0.55 },
  'prop.seamlessSweep': { height: 1.0, width: 1.2, depth: 0.9 }
}

const SHUT: Record<string, Record<string, string> | undefined> = {
  'prop.overheadBin': { state: 'closed' }
}

test('every AW prop builds to the size its catalog entry promises', async () => {
  for (const id of AW_PROPS) {
    const b = await boundsOf(id, SHUT[id])
    const want = EXPECTED[id]!
    const height = b.maxY - b.minY
    const width = b.maxX - b.minX
    const depth = b.maxZ - b.minZ
    // 3 cm, enough for chamfers and slab thickness, far too tight to hide a
    // half-width offset or a 5 cm height error. Both of those were real.
    expect(Math.abs(height - want.height), `${id} height ${height.toFixed(3)}`).toBeLessThan(0.03)
    expect(Math.abs(width - want.width), `${id} width ${width.toFixed(3)}`).toBeLessThan(0.03)
    expect(Math.abs(depth - want.depth), `${id} depth ${depth.toFixed(3)}`).toBeLessThan(0.03)
  }
})

test('every AW prop is centred on its origin and sits on the ground', async () => {
  for (const id of AW_PROPS) {
    const b = await boundsOf(id, SHUT[id])
    // Centred in X: a product placed at x=0 must be in the middle of the prop,
    // not beside it. The seamless sweep failed this, a half-width off.
    expect(Math.abs(b.minX + b.maxX), `${id} X centre`).toBeLessThan(0.03)
    // On the ground plane, per the origin-at-ground convention. The overhead
    // bin is the exception: it hangs at cabin height.
    if (id !== 'prop.overheadBin') {
      expect(Math.abs(b.minY), `${id} floor`).toBeLessThan(0.03)
    }
  }
})

test('the seamless sweep puts its flat run in front and its wall behind', async () => {
  const b = await boundsOf('prop.seamlessSweep')
  // Forward is -Z, so the flat run a product stands on extends to negative Z
  // and the wall it falls off against is at the back.
  expect(b.maxZ).toBeLessThan(0.03)
  expect(b.minZ).toBeLessThan(-0.5)
})

test('the overhead bin door opens into the aisle, not into the fuselage', async () => {
  const shut = await boundsOf('prop.overheadBin', { state: 'closed' })
  const open = await boundsOf('prop.overheadBin')
  // Inboard is -X for a starboard bin. An open door has to reach that way:
  // swinging the other way would put it through the aircraft skin, and would
  // still leave the cavity hidden from the camera.
  expect(open.minX).toBeLessThan(shut.minX - 0.2)
  expect(open.maxX).toBeCloseTo(shut.maxX, 2)
  // The bin itself does not grow in the other axes.
  expect(open.maxY).toBeCloseTo(shut.maxY, 2)
  expect(open.maxZ).toBeCloseTo(shut.maxZ, 2)
})

test('the plane cabin actually opens its bins when asked', async () => {
  // The cabin's bounds do NOT change: the doors swing into the aisle, well
  // inside the fuselage walls. So this has to be checked in pixels, from a
  // camera in the aisle looking at a bin, which is the shot that needs it.
  const frame = async (params?: Record<string, string>): Promise<number[]> =>
    page.evaluate(
      ({ params }) => {
        const w = window as unknown as { __blockout: any; __blockout_scene: any }
        const s = w.__blockout.store.getState()
        s.mutate('reset', (doc: any) => {
          for (const sc of doc.scenes) sc.entities = []
        })
        const id = s.addEntity('env.planeCabin', { x: 0, y: 0, z: 0 })
        if (params) {
          s.mutate('params', (doc: any) => {
            for (const sc of doc.scenes) {
              const e = sc.entities.find((x: any) => x.id === id)
              if (e) e.params = { ...e.params, ...params }
            }
          })
        }
        s.clearCameraMarks()
        // Stand in the aisle at eye height, look up and to starboard at a bin.
        s.dropCameraMark({ x: 0, y: 1.6, z: 1.5 }, -1.1, 0.25, 35)
        s.setTime(0)
        return w.__blockout.renderRawForTest(0, 320, 200) as number[]
      },
      { params }
    )

  const shut = await frame()
  const open = await frame({ bins: 'open' })
  expect(shut.length).toBe(open.length)
  let differing = 0
  for (let i = 0; i < shut.length; i += 4) {
    if (Math.abs(shut[i]! - open[i]!) > 6) differing++
  }
  // A lifted door is a big object close to the lens; a handful of changed
  // pixels would mean something subtler moved.
  expect(differing / (shut.length / 4)).toBeGreaterThan(0.01)
})
