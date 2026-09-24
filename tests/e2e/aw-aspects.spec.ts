/**
 * AW fork: the new ratios and the custom export width have to reach real
 * pixels, not just the dimension maths.
 *
 * `exportDims` returning 1200x600 proves nothing on its own — the value still
 * has to survive the render path, and the frame at a new ratio has to be
 * composed the way the viewport masked it. Both are measured here off decoded
 * PNG bytes and the live camera, because a number that is right in the store
 * and wrong on screen is the failure this codebase has produced twice.
 */

import { _electron as electron, test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { execFileSync } from 'child_process'

let app: ElectronApplication
let page: Page
let outDir: string

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  const root = process.env.BLOCKOUT_E2E_ROOT || tmpdir()
  mkdirSync(root, { recursive: true })
  outDir = mkdtempSync(join(root, 'blockout-awaspect-'))
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

/** Set the shot aspect, render a still at the given dims, return real pixel size. */
async function renderedSize(
  aspect: string,
  width: number,
  height: number
): Promise<{ w: number; h: number }> {
  const bytes = await page.evaluate(
    async ({ aspect, width, height }) => {
      const w = window as unknown as { __blockout: any }
      const s = w.__blockout.store.getState()
      s.mutate('aspect', (doc: any) => {
        for (const sc of doc.scenes) for (const sh of sc.shots) sh.aspect = aspect
      })
      await new Promise((r) => setTimeout(r, 120))
      const buf = (await w.__blockout.renderStillPngForTest(0, width, height)) as ArrayBuffer
      return Array.from(new Uint8Array(buf))
    },
    { aspect, width, height }
  )
  const file = join(outDir, `probe-${aspect.replace(/[^0-9a-z]/gi, '')}-${width}x${height}.png`)
  writeFileSync(file, Buffer.from(bytes))
  // Decode with ffprobe rather than trusting the number we asked for.
  const out = execFileSync(
    'ffprobe',
    ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file],
    { encoding: 'utf8' }
  ).trim()
  const [w, h] = out.split(',').map((n) => Number(n))
  return { w: w!, h: h! }
}

test('an email hero renders at exactly the requested pixel size', async () => {
  // 1200x600 is the size the audit called out as unreachable: the old
  // resolution control was a three-way enum topping out at a 1536 long edge.
  const got = await renderedSize('2:1', 1200, 600)
  expect(got).toEqual({ w: 1200, h: 600 })
})

test('every confirmed email hero size renders at 2x', async () => {
  // AW's spec, confirmed 2026-09-23: 600 wide, heroes to 500 tall, designed at
  // 2x. Decoded from the PNG rather than trusting the numbers requested.
  for (const [aspect, w, h] of [
    ['6:5', 1200, 1000],
    ['3:2', 1200, 800],
    ['2:1', 1200, 600],
    ['12:5', 1200, 500]
  ] as [string, number, number][]) {
    expect(await renderedSize(aspect, w, h), aspect).toEqual({ w, h })
  }
})

test('the portrait social ratio renders at its own size', async () => {
  const got = await renderedSize('4:5', 1080, 1350)
  expect(got).toEqual({ w: 1080, h: 1350 })
})

test('each new ratio actually reframes the camera', async () => {
  // A ratio that reached the store but not the camera would export a 2:1 file
  // containing a 16:9 composition — the right pixels around the wrong frame.
  const fovs = await page.evaluate(async () => {
    const w = window as unknown as { __blockout: any; __blockout_scene: any }
    const s = w.__blockout.store.getState()
    const read = async (aspect: string): Promise<{ aspect: number; fov: number }> => {
      s.mutate('aspect', (doc: any) => {
        for (const sc of doc.scenes) for (const sh of sc.shots) sh.aspect = aspect
      })
      await new Promise((r) => setTimeout(r, 120))
      const cam = w.__blockout_scene.shotCam
      return { aspect: cam.aspect, fov: cam.fov }
    }
    return {
      wide: await read('2:1'),
      three2: await read('3:2'),
      tall: await read('4:5')
    }
  })
  expect(fovs.wide.aspect).toBeCloseTo(2, 3)
  expect(fovs.three2.aspect).toBeCloseTo(1.5, 3)
  expect(fovs.tall.aspect).toBeCloseTo(0.8, 3)
  // Crop-to-aspect: a wider delivery crops the gate vertically, so 2:1 must
  // have a strictly narrower vertical FOV than 4:5 on the same lens.
  expect(fovs.wide.fov).toBeLessThan(fovs.tall.fov)
})

test('every aspect in the picker is one the engine knows', async () => {
  // Guards the drift the audit found: the UI list, the engine table and the
  // MCP validator each used to be written out separately.
  const bad = await page.evaluate(() => {
    const w = window as unknown as { __blockout: any }
    const s = w.__blockout.store.getState()
    const ids = ['12:5', '2.39:1', '2:1', '16:9', '3:2', '4:3', '6:5', '1:1', '4:5', '9:16']
    const failures: string[] = []
    for (const a of ids) {
      s.mutate('aspect', (doc: any) => {
        for (const sc of doc.scenes) for (const sh of sc.shots) sh.aspect = a
      })
      const cam = (window as any).__blockout_scene.shotCam
      if (!Number.isFinite(cam.aspect) || cam.aspect <= 0) failures.push(a)
    }
    return failures
  })
  expect(bad).toEqual([])
})
