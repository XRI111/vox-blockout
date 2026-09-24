/**
 * AW fork: the headline safe zone, checked against real pixels.
 *
 * The engine's unit tests prove the projection algebra is self-consistent.
 * They cannot prove it matches the renderer, and that is the claim the whole
 * feature rests on: an overlay that says a region is clear when the render
 * puts a suitcase there is worse than no overlay, because a designer acts on
 * it. So the ground truth here is a pixel diff — render with the subject and
 * without it, and the changed pixels are exactly where the subject is on
 * screen.
 *
 * The property asserted is containment, in one direction only. The engine
 * measures bounding boxes, which are larger than the subjects inside them, so
 * the engine's box must CONTAIN the pixel box. A box that fits inside the
 * pixels would mean the engine under-reports occupancy, which is the failure
 * that costs real work.
 */

import { _electron as electron, test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

let app: ElectronApplication
let page: Page

const W = 400
const H = 200

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  const root = process.env.BLOCKOUT_E2E_ROOT || tmpdir()
  mkdirSync(root, { recursive: true })
  const outDir = mkdtempSync(join(root, 'blockout-awzone-'))
  app = await electron.launch({
    args: ['out/main/index.js'],
    env: { ...process.env, BLOCKOUT_SMOKE_DIR: outDir }
  })
  page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await page.getByRole('button', { name: 'New Project' }).click()
  await expect(page.locator('.mode-switch')).toBeVisible({ timeout: 30_000 })
})

test.afterAll(async () => {
  await app?.close()
})

interface PixelBox {
  x: number
  y: number
  w: number
  h: number
  count: number
}

/**
 * Stage one subject at a known spot with a known camera, then return both the
 * engine's safe-zone report and the subject's true on-screen box, the latter
 * from a with/without render diff.
 */
async function stageAndMeasure(opts: {
  assetId: string
  x: number
  z: number
  camX: number
  camY: number
  camZ: number
  panDeg: number
  tiltDeg: number
  focalLength: number
  aspect: string
  zone: { preset: string; rect?: { x: number; y: number; w: number; h: number } }
}): Promise<{
  report: { rect: { x: number; y: number; w: number; h: number }; negativeSpace: number; boxes: { entityId: string; rect: { x: number; y: number; w: number; h: number } }[] }
  pixels: PixelBox | null
  zoneClearByPixels: number
}> {
  return page.evaluate(
    async (o) => {
      const w = window as unknown as { __blockout: any }
      const api = w.__blockout
      const st = () => api.store.getState()

      // Rebuild the scene from scratch each time so runs cannot contaminate
      // each other through leftover entities or marks.
      st().mutate('zone test: reset', (doc: any) => {
        const sc = doc.scenes[0]
        sc.entities = []
        for (const b of sc.blocking) b.tracks = []
        const sh = sc.shots[0]
        sh.aspect = o.aspect
        sh.duration = 1
        sh.fps = 24
        sh.safeZone = o.zone
        sh.camera.rig = 'sticks'
        sh.camera.rigIntensity = 0
        // Two identical marks: a single mark leaves the evaluator without a
        // leg, and rig noise is off so the camera is exactly where we put it.
        const mark = (id: string) => ({
          id,
          time: 0,
          hold: 0,
          easeIn: 0,
          easeOut: 0,
          position: { x: o.camX, y: o.camY, z: o.camZ },
          pan: (o.panDeg * Math.PI) / 180,
          tilt: (o.tiltDeg * Math.PI) / 180,
          roll: 0,
          focalLength: o.focalLength
        })
        sh.camera.marks = [mark('m1'), { ...mark('m2'), time: 1 }]
      })

      // The subject is added once and hidden for the reference render, never
      // removed. Adding an entity changes scene-derived values (the grid cell
      // and both camera near planes follow the scene's extent), so diffing
      // against an EMPTY scene moves the background too and the diff picks up
      // pixels that have nothing to do with the subject. `excludeFromExport`
      // hides it from the render pass while leaving the document identical,
      // which is exactly the isolation this needs.
      st().mutate('zone test: add subject', (doc: any) => {
        doc.scenes[0].entities.push({
          id: 'subject',
          assetId: o.assetId,
          name: 'SUBJECT',
          excludeFromExport: true,
          transform: { position: { x: o.x, y: 0, z: o.z }, rotationY: 0, scale: 1 }
        })
      })
      await new Promise((r) => setTimeout(r, 250))
      const empty = api.renderRawForTest(0, o.W, o.H, true) as number[]

      st().mutate('zone test: reveal subject', (doc: any) => {
        delete doc.scenes[0].entities[0].excludeFromExport
      })
      await new Promise((r) => setTimeout(r, 250))
      const withSubject = api.renderRawForTest(0, o.W, o.H, true) as number[]
      const report = api.safeZoneForTest(0)

      // Changed pixels locate the subject. GL reads bottom-up, so row 0 of the
      // buffer is the BOTTOM of the picture; flip into frame space (y down from
      // the top) before comparing against the engine.
      //
      // Thin fringes are trimmed because the subject casts a SHADOW, and the
      // engine's box bounds the object's geometry rather than the light it
      // blocks. Magnitude cannot separate the two here — clay on a grey ground
      // differs by only 10-19 levels, the same band as the shadow — but extent
      // separates them cleanly: measured on this scene, a column crossing the
      // object carries ~100 changed pixels and a shadow-fringe column carries
      // 2. Requiring 5 sits between them with a wide margin, and the resulting
      // box is identical at 5 and at 10, so the exact figure is not
      // load-bearing.
      const MIN_RUN = 5
      const changedAt = (row: number, col: number): boolean => {
        const i = (row * o.W + col) * 4
        return (
          Math.abs(empty[i]! - withSubject[i]!) > 6 ||
          Math.abs(empty[i + 1]! - withSubject[i + 1]!) > 6 ||
          Math.abs(empty[i + 2]! - withSubject[i + 2]!) > 6
        )
      }
      const colHits = new Map<number, number>()
      const rowHits = new Map<number, number>()
      let count = 0
      for (let row = 0; row < o.H; row++) {
        for (let col = 0; col < o.W; col++) {
          if (!changedAt(row, col)) continue
          count++
          colHits.set(col, (colHits.get(col) ?? 0) + 1)
          const frameY = o.H - 1 - row
          rowHits.set(frameY, (rowHits.get(frameY) ?? 0) + 1)
        }
      }
      const solidCols = [...colHits.entries()].filter(([, n]) => n >= MIN_RUN).map(([c]) => c)
      const solidRows = [...rowHits.entries()].filter(([, n]) => n >= MIN_RUN).map(([r]) => r)

      // Zone occupancy from the same mask, so the comparison against the
      // engine's figure is apples to apples.
      let zoneTotal = 0
      let zoneBusy = 0
      const solidColSet = new Set(solidCols)
      const solidRowSet = new Set(solidRows)
      const zx0 = report ? report.rect.x * o.W : 0
      const zx1 = report ? (report.rect.x + report.rect.w) * o.W : 0
      const zy0 = report ? report.rect.y * o.H : 0
      const zy1 = report ? (report.rect.y + report.rect.h) * o.H : 0
      for (let row = 0; row < o.H; row++) {
        const frameY = o.H - 1 - row
        for (let col = 0; col < o.W; col++) {
          if (col + 0.5 < zx0 || col + 0.5 > zx1) continue
          if (frameY + 0.5 < zy0 || frameY + 0.5 > zy1) continue
          zoneTotal++
          if (changedAt(row, col) && solidColSet.has(col) && solidRowSet.has(frameY)) zoneBusy++
        }
      }
      return {
        report,
        pixels:
          solidCols.length === 0 || solidRows.length === 0
            ? null
            : {
                x: Math.min(...solidCols) / o.W,
                y: Math.min(...solidRows) / o.H,
                w: (Math.max(...solidCols) - Math.min(...solidCols) + 1) / o.W,
                h: (Math.max(...solidRows) - Math.min(...solidRows) + 1) / o.H,
                count
              },
        zoneClearByPixels: zoneTotal === 0 ? 1 : 1 - zoneBusy / zoneTotal
      }
    },
    { ...opts, W, H }
  )
}

test('the projected box contains the subject the renderer actually drew', async () => {
  // Camera square-on to a suitcase left of centre. If the engine's Euler order
  // or its NDC-to-frame flip were wrong, the box would sit somewhere else
  // entirely and containment would fail by a wide margin.
  const { report, pixels } = await stageAndMeasure({
    assetId: 'prop.suitcase',
    x: -0.9,
    z: 0,
    camX: 0,
    camY: 0.7,
    camZ: 3.5,
    panDeg: 0,
    tiltDeg: 0,
    focalLength: 35,
    aspect: '2:1',
    zone: { preset: 'leftThird' }
  })
  expect(pixels).not.toBeNull()
  const box = report.boxes.find((b) => b.entityId === 'subject')!.rect
  // Half a pixel. The engine's box is computed from the same world-space
  // bounds the renderer drew, so containment is exact rather than approximate;
  // a loose tolerance here would hide a real drift.
  const tol = 0.5 / W
  expect(box.x).toBeLessThanOrEqual(pixels!.x + tol)
  expect(box.y).toBeLessThanOrEqual(pixels!.y + tol)
  expect(box.x + box.w).toBeGreaterThanOrEqual(pixels!.x + pixels!.w - tol)
  expect(box.y + box.h).toBeGreaterThanOrEqual(pixels!.y + pixels!.h - tol)
})

test('the box is a usable bound, not a lazy whole-frame claim', async () => {
  // Containment alone would pass trivially if the engine always returned the
  // full frame. The bound has to be tight enough to be worth drawing.
  const { report, pixels } = await stageAndMeasure({
    assetId: 'prop.suitcase',
    x: -0.9,
    z: 0,
    camX: 0,
    camY: 0.7,
    camZ: 3.5,
    panDeg: 0,
    tiltDeg: 0,
    focalLength: 35,
    aspect: '2:1',
    zone: { preset: 'leftThird' }
  })
  const box = report.boxes.find((b) => b.entityId === 'subject')!.rect
  expect(box.w * box.h).toBeLessThan(pixels!.w * pixels!.h * 4)
  expect(box.w).toBeLessThan(0.6)
})

/**
 * Set a camera pose, then compare the engine's pure projection against the
 * renderer's own for a spread of world points.
 */
async function projectionDrift(pose: {
  camX: number
  camY: number
  camZ: number
  panDeg: number
  tiltDeg: number
  rollDeg: number
  focalLength: number
  aspect: string
}): Promise<number> {
  return page.evaluate(async (o) => {
    const w = window as unknown as { __blockout: any }
    const st = () => w.__blockout.store.getState()
    st().mutate('proj test', (doc: any) => {
      const sh = doc.scenes[0].shots[0]
      sh.aspect = o.aspect
      sh.camera.rig = 'sticks'
      sh.camera.rigIntensity = 0
      const mark = (id: string, t: number) => ({
        id,
        time: t,
        hold: 0,
        easeIn: 0,
        easeOut: 0,
        position: { x: o.camX, y: o.camY, z: o.camZ },
        pan: (o.panDeg * Math.PI) / 180,
        tilt: (o.tiltDeg * Math.PI) / 180,
        roll: (o.rollDeg * Math.PI) / 180,
        focalLength: o.focalLength
      })
      sh.camera.marks = [mark('m1', 0), mark('m2', 1)]
    })
    await new Promise((r) => setTimeout(r, 120))
    const points: { x: number; y: number; z: number }[] = []
    for (const x of [-3, -0.7, 0, 0.7, 3])
      for (const y of [0, 0.9, 2.1])
        for (const z of [-6, -2.5, 0]) points.push({ x, y, z })
    const res = w.__blockout.projectForTest(0, points)
    let worst = 0
    for (let i = 0; i < points.length; i++) {
      // Only points in front of the lens: behind it the engine reports depth
      // and stops, by contract, while three.js wraps the divide.
      if (res.engine[i].depth <= 1e-6) continue
      worst = Math.max(
        worst,
        Math.abs(res.engine[i].x - res.three[i].x),
        Math.abs(res.engine[i].y - res.three[i].y)
      )
    }
    return worst
  }, pose)
}

test('the pure projection matches the renderer camera at every pose', async () => {
  // This is the claim the overlay rests on. The engine reimplements the shot
  // camera in pure TypeScript; if its Euler order, its crop-to-aspect FOV or
  // its NDC flip differed from three.js, the drawn zone would not be the
  // region the render delivers.
  //
  // Combined pan and tilt is the case that distinguishes YXZ from XYZ: either
  // order agrees when only one angle is non-zero.
  const poses = [
    { camX: 0, camY: 0.7, camZ: 3.5, panDeg: 0, tiltDeg: 0, rollDeg: 0, focalLength: 35, aspect: '2:1' },
    { camX: -1, camY: 2.2, camZ: 3, panDeg: -22, tiltDeg: -14, rollDeg: 0, focalLength: 35, aspect: '16:9' },
    { camX: 2, camY: 1.4, camZ: -1, panDeg: 115, tiltDeg: 9, rollDeg: 0, focalLength: 24, aspect: '4:5' },
    { camX: 0.5, camY: 3.5, camZ: 4, panDeg: 8, tiltDeg: -35, rollDeg: 12, focalLength: 85, aspect: '2.39:1' },
    { camX: -2, camY: 0.4, camZ: -4, panDeg: -160, tiltDeg: 4, rollDeg: -7, focalLength: 50, aspect: '9:16' },
    { camX: 0, camY: 1.6, camZ: 2, panDeg: 0, tiltDeg: 0, rollDeg: 0, focalLength: 12, aspect: '1:1' }
  ]
  for (const pose of poses) {
    const drift = await projectionDrift(pose)
    // A quarter of a pixel at 4K, so this is float noise and nothing else.
    expect(drift, JSON.stringify(pose)).toBeLessThan(1e-4)
  }
})

test('every delivery ratio projects consistently, including the ones item 5 added', async () => {
  // Aspect enters the engine's maths only through the horizontal half-angle.
  // A ratio missing from that path would show as drift here and nowhere else.
  // Covers all ten, including 6:5 and 12:5 from AW's confirmed email spec.
  for (const aspect of ['12:5', '2.39:1', '2:1', '16:9', '3:2', '4:3', '6:5', '1:1', '4:5', '9:16']) {
    const drift = await projectionDrift({
      camX: -1,
      camY: 1.7,
      camZ: 3,
      panDeg: -18,
      tiltDeg: -11,
      rollDeg: 5,
      focalLength: 35,
      aspect
    })
    expect(drift, aspect).toBeLessThan(1e-4)
  }
})

test('never reports more free space in the zone than the pixels have', async () => {
  // The safety property, stated directly: the number written into prompt.txt
  // and metadata.json must not overstate how clear the headline region is.
  for (const preset of ['leftThird', 'rightThird', 'topBand', 'bottomBand']) {
    const { report, zoneClearByPixels } = await stageAndMeasure({
      assetId: 'prop.suitcase',
      x: -0.9,
      z: 0,
      camX: 0,
      camY: 0.7,
      camZ: 2.5,
      panDeg: 0,
      tiltDeg: 0,
      focalLength: 35,
      aspect: '2:1',
      zone: { preset }
    })
    expect(report.negativeSpace, preset).toBeLessThanOrEqual(zoneClearByPixels + 1e-6)
  }
})

test('a custom 40% zone measures the region the pilot hero actually uses', async () => {
  const { report, zoneClearByPixels } = await stageAndMeasure({
    assetId: 'prop.suitcase',
    x: 0.8,
    z: 0,
    camX: 0,
    camY: 0.7,
    camZ: 3,
    panDeg: 0,
    tiltDeg: 0,
    focalLength: 35,
    aspect: '2:1',
    zone: { preset: 'custom', rect: { x: 0, y: 0, w: 0.4, h: 1 } }
  })
  expect(report.rect).toEqual({ x: 0, y: 0, w: 0.4, h: 1 })
  // Product staged right of centre, so the left 40% should read clear both
  // ways round.
  expect(report.negativeSpace).toBeGreaterThan(0.9)
  expect(zoneClearByPixels).toBeGreaterThan(0.9)
})

test('the overlay renders the zone and its clear percentage', async () => {
  // The badge is the number a designer reads while framing; a report computed
  // and never drawn would be the same class of bug as the tilt that survived
  // one frame.
  await page.evaluate(() => {
    const w = window as unknown as { __blockout: any }
    const st = w.__blockout.store.getState()
    st.mutate('zone test: overlay', (doc: any) => {
      doc.scenes[0].shots[0].safeZone = { preset: 'leftThird' }
    })
    st.setLookThrough(true)
  })
  const badge = page.locator('text=/HEADLINE · \\d+% clear/')
  await expect(badge.first()).toBeVisible({ timeout: 10_000 })
  await page.evaluate(() => {
    const w = window as unknown as { __blockout: any }
    w.__blockout.store.getState().setLookThrough(false)
  })
})

test('the zone reaches prompt.txt and metadata.json', async () => {
  const out = await page.evaluate(async () => {
    const w = window as unknown as { __blockout: any }
    const st = w.__blockout.store.getState()
    st.mutate('zone test: package', (doc: any) => {
      doc.scenes[0].shots[0].safeZone = { preset: 'rightThird' }
    })
    await new Promise((r) => setTimeout(r, 150))
    return w.__blockout.exportShot({
      profileId: 'gpt-image-2',
      passes: { clean: true, depth: false, normal: false },
      labels: 'off'
    })
  })
  expect(out.ok, JSON.stringify(out)).toBe(true)
  const { readFileSync } = await import('fs')
  const prompt = readFileSync(join(out.packagePath, 'prompt.txt'), 'utf8')
  expect(prompt).toContain('right third of the frame')
  expect(prompt).toContain('headline text')
  const meta = JSON.parse(readFileSync(join(out.packagePath, 'metadata.json'), 'utf8'))
  expect(meta.shot.safeZone.preset).toBe('rightThird')
  expect(meta.shot.safeZone.rect.w).toBeCloseTo(0.333, 2)
  expect(meta.shot.safeZone.measuredFrom).toBe('subjectBounds')
  expect(typeof meta.shot.safeZone.negativeSpace).toBe('number')
  expect(meta.shot.safeZone.worst).not.toBeNull()
})

test('a shot with no zone says nothing in the package', async () => {
  // Absence has to stay absence: a null block or a default rect would tell a
  // downstream operator a zone was reserved when none was.
  const out = await page.evaluate(async () => {
    const w = window as unknown as { __blockout: any }
    const st = w.__blockout.store.getState()
    st.mutate('zone test: no zone', (doc: any) => {
      delete doc.scenes[0].shots[0].safeZone
    })
    await new Promise((r) => setTimeout(r, 150))
    return w.__blockout.exportShot({
      profileId: 'gpt-image-2',
      passes: { clean: true, depth: false, normal: false },
      labels: 'off'
    })
  })
  expect(out.ok, JSON.stringify(out)).toBe(true)
  const { readFileSync } = await import('fs')
  const meta = JSON.parse(readFileSync(join(out.packagePath, 'metadata.json'), 'utf8'))
  expect(meta.shot.safeZone).toBeNull()
  expect(readFileSync(join(out.packagePath, 'prompt.txt'), 'utf8')).not.toContain('negative space')
})
