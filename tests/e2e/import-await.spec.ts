/**
 * AW fork: an export started right after importing a 3D model must contain
 * that model.
 *
 * Imported GLBs are read over IPC, so the load cannot finish in the tick that
 * queues it. Before SceneManager.settleAsyncLoads() the export paths rendered
 * straight through and the package silently shipped without the product —
 * worse than a crash, because the frames look fine. This test drives the real
 * production path (exportStillAtPlayhead) in the same tick as the import, so
 * it fails deterministically if the await is ever removed.
 */

import { _electron as electron, test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs'
import { execFileSync } from 'child_process'
import { tmpdir } from 'os'
import { join } from 'path'

let app: ElectronApplication
let page: Page
let smokeDir: string
let glbPath: string

test.describe.configure({ mode: 'serial' })

/**
 * A minimal valid glTF 2.0 binary: one unlit-ish 4 m cube at the origin, big
 * enough to dominate frame 0 from the default camera. Built here rather than
 * committed because the repo keeps binary blobs out of git (DESIGN.md §5).
 */
function writeCubeGlb(path: string): void {
  const s = 2 // half-extent, so a 4 m cube
  // 8 corners, then 12 triangles. POSITION only; glTF says a primitive with no
  // NORMAL renders flat-shaded, which is all a grey-box proxy needs.
  const positions = new Float32Array([
    -s, -s, -s, s, -s, -s, s, s, -s, -s, s, -s,
    -s, -s, s, s, -s, s, s, s, s, -s, s, s
  ])
  const indices = new Uint16Array([
    0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4,
    3, 7, 6, 3, 6, 2, 0, 4, 7, 0, 7, 3, 1, 2, 6, 1, 6, 5
  ])
  const idxBytes = indices.byteLength
  const idxPad = (4 - (idxBytes % 4)) % 4
  const bin = Buffer.concat([
    Buffer.from(indices.buffer, indices.byteOffset, idxBytes),
    Buffer.alloc(idxPad),
    Buffer.from(positions.buffer, positions.byteOffset, positions.byteLength)
  ])
  const posOffset = idxBytes + idxPad

  const gltf = {
    asset: { version: '2.0', generator: 'blockout-e2e' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: 'ImportProbeCube' }],
    meshes: [{ primitives: [{ attributes: { POSITION: 1 }, indices: 0, material: 0 }] }],
    materials: [
      {
        pbrMetallicRoughness: {
          // Saturated magenta: nothing in the grey-box library is this colour,
          // so its presence in the frame is unambiguous.
          baseColorFactor: [1, 0, 1, 1],
          metallicFactor: 0,
          roughnessFactor: 1
        },
        doubleSided: true
      }
    ],
    accessors: [
      { bufferView: 0, componentType: 5123, count: indices.length, type: 'SCALAR' },
      {
        bufferView: 1,
        componentType: 5126,
        count: positions.length / 3,
        type: 'VEC3',
        min: [-s, -s, -s],
        max: [s, s, s]
      }
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: idxBytes, target: 34963 },
      { buffer: 0, byteOffset: posOffset, byteLength: positions.byteLength, target: 34962 }
    ],
    buffers: [{ byteLength: bin.byteLength }]
  }

  const jsonRaw = Buffer.from(JSON.stringify(gltf), 'utf8')
  const jsonPad = (4 - (jsonRaw.byteLength % 4)) % 4
  // Chunks pad to a 4-byte boundary: JSON with spaces, BIN with zeroes.
  const json = Buffer.concat([jsonRaw, Buffer.alloc(jsonPad, 0x20)])

  const header = Buffer.alloc(12)
  header.write('glTF', 0, 'ascii')
  header.writeUInt32LE(2, 4)
  header.writeUInt32LE(12 + 8 + json.byteLength + 8 + bin.byteLength, 8)

  const jsonHeader = Buffer.alloc(8)
  jsonHeader.writeUInt32LE(json.byteLength, 0)
  jsonHeader.writeUInt32LE(0x4e4f534a, 4) // 'JSON'

  const binHeader = Buffer.alloc(8)
  binHeader.writeUInt32LE(bin.byteLength, 0)
  binHeader.writeUInt32LE(0x004e4942, 4) // 'BIN\0'

  writeFileSync(path, Buffer.concat([header, jsonHeader, json, binHeader, bin]))
}

test.beforeAll(async () => {
  const root = process.env.BLOCKOUT_E2E_ROOT || tmpdir()
  mkdirSync(root, { recursive: true })
  smokeDir = mkdtempSync(join(root, 'blockout-import-'))
  glbPath = join(smokeDir, 'probe-cube.glb')
  writeCubeGlb(glbPath)
  app = await electron.launch({
    args: ['out/main/index.js'],
    env: { ...process.env, BLOCKOUT_SMOKE_DIR: smokeDir }
  })
  page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
})

test.afterAll(async () => {
  await app?.close()
})

/**
 * Fraction of a PNG's pixels that carry the fixture's magenta. Decoded with
 * ffmpeg, already a test dependency (the smoke suite shells out to ffprobe).
 *
 * Comparing whole PNGs is not enough: adding the entity also adds the
 * person-scale grey placeholder box that stands in until the glTF resolves,
 * so the bytes differ whether or not the real mesh arrived. Only the colour
 * proves the imported geometry is in the frame.
 */
function magentaFraction(pngPath: string): number {
  const raw = execFileSync(
    process.env.BLOCKOUT_FFMPEG || 'ffmpeg',
    ['-v', 'error', '-i', pngPath, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'],
    { maxBuffer: 256 * 1024 * 1024 }
  )
  let hits = 0
  for (let i = 0; i < raw.length; i += 4) {
    const r = raw[i]!
    const g = raw[i + 1]!
    const b = raw[i + 2]!
    if (r > 120 && b > 120 && g < r * 0.5 && g < b * 0.5) hits++
  }
  return hits / (raw.length / 4)
}

test('an export fired in the same tick as an import contains the imported mesh', async () => {
  await page.getByRole('button', { name: 'New Project' }).click()
  await expect(page.locator('.mode-switch')).toBeVisible({ timeout: 30_000 })

  // Baseline: the empty stage at t=0, through the same production path.
  const before = await page.evaluate(async () => {
    const w = window as unknown as { __blockout: any }
    return (await w.__blockout.exportStillAtPlayhead('gpt-image-2', '720p', false)) as {
      ok: boolean
      packagePath?: string
      error?: string
    }
  })
  expect(before.ok, before.error).toBe(true)
  // Nothing in the procedural grey-box library is magenta.
  expect(magentaFraction(before.packagePath!)).toBe(0)

  // Import and export with nothing awaited in between — exactly the sequence
  // that used to ship a package without the product in it.
  const after = await page.evaluate(async (src: string) => {
    const w = window as unknown as { __blockout: any; blockout: any }
    const store = w.__blockout.store.getState()
    const folder = store.projectFolder as string
    const imported = await w.blockout.importAsset(folder, src)

    const entityId = store.addEntity(`custom.${imported.name}`, { x: 0, y: 0, z: 0 })
    store.mutate('import model', (doc: any) => {
      for (const scene of doc.scenes) {
        const e = scene.entities.find((x: any) => x.id === entityId)
        if (e) {
          e.sourceFile = imported.relativePath
          break
        }
      }
    })
    // No await, no settle, no rAF: straight into the export.
    return (await w.__blockout.exportStillAtPlayhead('gpt-image-2', '720p', false)) as {
      ok: boolean
      packagePath?: string
      error?: string
    }
  }, glbPath)
  expect(after.ok, after.error).toBe(true)

  // A 4 m cube at the origin from the default 35 mm camera fills most of frame
  // 0. Without the await this reads 0: the export races the IPC read and
  // renders the grey placeholder instead.
  expect(magentaFraction(after.packagePath!)).toBeGreaterThan(0.25)
})

test('the model survives a later render, so the load was not a one-frame fluke', async () => {
  const { hits, total } = await page.evaluate(() => {
    const w = window as unknown as { __blockout: any }
    const px: number[] = w.__blockout.renderRawForTest(0, 320, 180)
    let hits = 0
    for (let i = 0; i < px.length; i += 4) {
      const r = px[i]!
      const g = px[i + 1]!
      const b = px[i + 2]!
      if (r > 120 && b > 120 && g < r * 0.5 && g < b * 0.5) hits++
    }
    return { hits, total: px.length / 4 }
  })
  expect(hits / total).toBeGreaterThan(0.25)
})
