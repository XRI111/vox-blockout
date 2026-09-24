/**
 * AW fork: headline safe zones.
 *
 * Two things are worth testing hard here and the rest follows from them.
 *
 * The projection has to match the renderer's camera, because an overlay that
 * disagrees with the render is worse than no overlay: it tells a designer a
 * region is clear when it is not. The algebra is pinned against hand-computed
 * cases here and against real pixels in `tests/e2e/aw-safe-zone.spec.ts`.
 *
 * The occupancy has to err toward "busier than it looks", never the reverse,
 * so the union maths and the straddling-the-camera case get their own tests.
 */

import { describe, it, expect } from 'vitest'
import {
  MIN_ZONE_EDGE,
  SAFE_ZONE_PRESETS,
  SAFE_ZONE_PRESET_IDS,
  analyzeSafeZone,
  clampRect,
  describeCustomRect,
  isSafeZonePresetId,
  normalizeSafeZone,
  projectEntityBounds,
  projectToFrame,
  resolveSafeZone,
  safeZonePhrase,
  unionArea,
  worstSafeZone,
  type FrameRect
} from '@engine/safe-zone'
import { ASPECT_RATIOS } from '@engine/camera'
import { createEntity, createProject, createShot, parseProject, serializeProject } from '@engine/schema'
import { ShotEvaluator } from '@engine/evaluate'
import type { CameraState, Scene, Shot } from '@engine/types'

/** A camera at the origin looking down -Z with a 90° vertical FOV. */
function cam(over: Partial<CameraState> = {}): CameraState {
  return {
    position: { x: 0, y: 0, z: 0 },
    pan: 0,
    tilt: 0,
    roll: 0,
    focalLength: 35,
    vfov: Math.PI / 2,
    ...over
  }
}

describe('zone rects', () => {
  it('names four thirds of the frame and a custom escape hatch', () => {
    expect(SAFE_ZONE_PRESET_IDS).toHaveLength(5)
    expect(SAFE_ZONE_PRESETS.leftThird).toEqual({ x: 0, y: 0, w: 1 / 3, h: 1 })
    expect(SAFE_ZONE_PRESETS.rightThird.x + SAFE_ZONE_PRESETS.rightThird.w).toBeCloseTo(1)
    expect(SAFE_ZONE_PRESETS.bottomBand.y + SAFE_ZONE_PRESETS.bottomBand.h).toBeCloseTo(1)
  })

  it('covers exactly a third of the frame, whichever preset', () => {
    // Normalized space is the point: the proportion must not change with
    // aspect, so a 2:1 hero and a 4:5 social frame reserve the same share.
    for (const r of Object.values(SAFE_ZONE_PRESETS)) {
      expect(r.w * r.h).toBeCloseTo(1 / 3, 6)
    }
  })

  it('reads the pilot "headline left 40%" as a custom rect', () => {
    const rect = resolveSafeZone({ preset: 'custom', rect: { x: 0, y: 0, w: 0.4, h: 1 } })
    expect(rect).toEqual({ x: 0, y: 0, w: 0.4, h: 1 })
  })

  it('treats a missing zone and a custom zone with no rect alike', () => {
    expect(resolveSafeZone(undefined)).toBeNull()
    expect(resolveSafeZone(null)).toBeNull()
    expect(resolveSafeZone({ preset: 'custom' })).toBeNull()
  })

  it('slides an off-frame rect back in rather than resizing it', () => {
    // A dragged zone that runs past the edge should keep its size; silently
    // shrinking it would change the composition the designer set.
    const r = clampRect({ x: 0.9, y: 0.9, w: 0.3, h: 0.3 })
    expect(r.w).toBeCloseTo(0.3)
    expect(r.h).toBeCloseTo(0.3)
    expect(r.x).toBeCloseTo(0.7)
    expect(r.y).toBeCloseTo(0.7)
  })

  it('shrinks only when the rect genuinely cannot fit', () => {
    const r = clampRect({ x: 0.5, y: 0.5, w: 2, h: 2 })
    expect(r).toEqual({ x: 0, y: 0, w: 1, h: 1 })
  })

  it('refuses a degenerate rect and kills signed zero', () => {
    const r = clampRect({ x: -0, y: -5, w: 0, h: Number.NaN })
    expect(r.w).toBe(MIN_ZONE_EDGE)
    expect(r.h).toBe(MIN_ZONE_EDGE)
    expect(Object.is(r.x, -0)).toBe(false)
    expect(Object.is(r.y, -0)).toBe(false)
  })

  it('narrows an untrusted preset id', () => {
    expect(isSafeZonePresetId('leftThird')).toBe(true)
    expect(isSafeZonePresetId('leftHalf')).toBe(false)
    expect(isSafeZonePresetId('toString')).toBe(false)
    expect(isSafeZonePresetId(undefined)).toBe(false)
  })
})

describe('normalizing an untrusted zone', () => {
  it('keeps a good preset and a good custom rect', () => {
    expect(normalizeSafeZone({ preset: 'topBand' })).toEqual({ preset: 'topBand' })
    expect(normalizeSafeZone({ preset: 'custom', rect: { x: 0, y: 0, w: 0.5, h: 1 } })).toEqual({
      preset: 'custom',
      rect: { x: 0, y: 0, w: 0.5, h: 1 }
    })
  })

  it('drops a preset rect, which would be dead data', () => {
    // A preset's geometry lives in one table. Storing a rect beside it invites
    // the two to disagree after the table changes.
    expect(normalizeSafeZone({ preset: 'leftThird', rect: { x: 9, y: 9, w: 9, h: 9 } })).toEqual({
      preset: 'leftThird'
    })
  })

  it('degrades junk to no zone instead of throwing', () => {
    for (const bad of [
      undefined,
      null,
      'leftThird',
      42,
      {},
      { preset: 'nope' },
      { preset: 'custom' },
      { preset: 'custom', rect: null },
      { preset: 'custom', rect: { x: 0, y: 0, w: Number.NaN, h: 1 } },
      { preset: 'custom', rect: { x: 0, y: 0, w: 0.5 } }
    ]) {
      expect(normalizeSafeZone(bad), JSON.stringify(bad)).toBeUndefined()
    }
  })
})

describe('projection', () => {
  it('puts a point straight ahead at the frame centre', () => {
    const p = projectToFrame(cam(), 16 / 9, { x: 0, y: 0, z: -10 })
    expect(p.x).toBeCloseTo(0.5, 6)
    expect(p.y).toBeCloseTo(0.5, 6)
    expect(p.depth).toBeCloseTo(10, 6)
  })

  it('reports depth behind the camera as non-positive', () => {
    // Callers rely on this rather than on a wrapped-around x/y.
    expect(projectToFrame(cam(), 16 / 9, { x: 0, y: 0, z: 10 }).depth).toBeLessThan(0)
  })

  it('lands the vertical FOV edges exactly on the top and bottom', () => {
    // 90° vfov: at 10m the frame is 10m above and below centre.
    const top = projectToFrame(cam(), 16 / 9, { x: 0, y: 10, z: -10 })
    const bottom = projectToFrame(cam(), 16 / 9, { x: 0, y: -10, z: -10 })
    expect(top.y).toBeCloseTo(0, 6)
    expect(bottom.y).toBeCloseTo(1, 6)
  })

  it('puts +Y up and +X right, not mirrored', () => {
    // Frame space is origin top-left, so up is a SMALLER y. Getting this
    // backwards would flip every overlay top for bottom.
    const up = projectToFrame(cam(), 16 / 9, { x: 0, y: 2, z: -10 })
    expect(up.y).toBeLessThan(0.5)
    const right = projectToFrame(cam(), 16 / 9, { x: 2, y: 0, z: -10 })
    expect(right.x).toBeGreaterThan(0.5)
  })

  it('widens horizontally with the aspect, at a fixed vertical FOV', () => {
    // Crop-to-aspect: the same world point sits closer to centre in a wider
    // delivery, because the horizontal FOV grew and the vertical did not.
    const wide = projectToFrame(cam(), 2, { x: 4, y: 0, z: -10 })
    const tall = projectToFrame(cam(), 0.8, { x: 4, y: 0, z: -10 })
    expect(wide.x - 0.5).toBeLessThan(tall.x - 0.5)
  })

  it('pans: a point to the left fills centre frame once the camera turns', () => {
    // Heading 0 faces -Z and pan is a yaw about +Y, so a positive pan swings
    // the camera toward -X.
    const p = projectToFrame(cam({ pan: Math.PI / 2 }), 16 / 9, { x: -10, y: 0, z: 0 })
    expect(p.x).toBeCloseTo(0.5, 6)
    expect(p.depth).toBeCloseTo(10, 6)
  })

  it('tilts up toward +Y', () => {
    const p = projectToFrame(cam({ tilt: Math.PI / 4 }), 16 / 9, { x: 0, y: 10, z: -10 })
    expect(p.y).toBeCloseTo(0.5, 6)
  })

  it('rolls the frame without moving the centre', () => {
    const rolled = projectToFrame(cam({ roll: Math.PI / 2 }), 1, { x: 0, y: 2, z: -10 })
    // A quarter roll turns "above centre" into "beside centre". At aspect 1
    // the offset transfers exactly, which is the strongest form of this check.
    expect(rolled.y).toBeCloseTo(0.5, 6)
    expect(Math.abs(rolled.x - 0.5)).toBeCloseTo(0.1, 6)
    const centre = projectToFrame(cam({ roll: 0.7 }), 1, { x: 0, y: 0, z: -10 })
    expect(centre.x).toBeCloseTo(0.5, 6)
    expect(centre.y).toBeCloseTo(0.5, 6)
  })

  it('applies pan before tilt, so pitch acts in the camera frame', () => {
    // YXZ, not XYZ. Under XYZ a tilted camera's pan would rotate about a
    // tilted axis and the overlay would drift off the render as the camera
    // both pans and tilts, which is most shots.
    const c = cam({ pan: Math.PI / 2, tilt: Math.PI / 4 })
    // Camera at origin, panned left and tilted up: the view direction is
    // (-sin(pan)cos(tilt), sin(tilt), -cos(pan)cos(tilt)).
    const dir = { x: -Math.SQRT1_2, y: Math.SQRT1_2, z: 0 }
    const p = projectToFrame(c, 16 / 9, { x: dir.x * 10, y: dir.y * 10, z: dir.z * 10 })
    expect(p.x).toBeCloseTo(0.5, 6)
    expect(p.y).toBeCloseTo(0.5, 6)
  })
})

describe('union area', () => {
  it('is zero for nothing and the area for one rect', () => {
    expect(unionArea([])).toBe(0)
    expect(unionArea([{ x: 0, y: 0, w: 0.5, h: 0.4 }])).toBeCloseTo(0.2)
  })

  it('does not double-count two subjects standing together', () => {
    // Summing areas instead would report a zone as busier than it is and send
    // a designer moving a headline that was fine.
    const a: FrameRect = { x: 0, y: 0, w: 0.6, h: 1 }
    const b: FrameRect = { x: 0.4, y: 0, w: 0.6, h: 1 }
    expect(unionArea([a, b])).toBeCloseTo(1, 6)
  })

  it('handles a rect fully inside another', () => {
    expect(
      unionArea([
        { x: 0, y: 0, w: 1, h: 1 },
        { x: 0.2, y: 0.2, w: 0.1, h: 0.1 }
      ])
    ).toBeCloseTo(1, 6)
  })

  it('adds disjoint rects', () => {
    expect(
      unionArea([
        { x: 0, y: 0, w: 0.2, h: 0.5 },
        { x: 0.5, y: 0.5, w: 0.2, h: 0.5 }
      ])
    ).toBeCloseTo(0.2, 6)
  })

  it('handles an L-shaped overlap, where slab merging earns its keep', () => {
    const area = unionArea([
      { x: 0, y: 0, w: 0.5, h: 0.5 },
      { x: 0.25, y: 0.25, w: 0.5, h: 0.5 }
    ])
    expect(area).toBeCloseTo(0.25 + 0.25 - 0.0625, 6)
  })
})

/* --------------------------- end-to-end on a doc -------------------------- */

function sceneWith(entities: { assetId: string; x: number; z: number }[]): {
  scene: Scene
  shot: Shot
} {
  const doc = createProject('safe zone')
  const scene = doc.scenes[0]!
  for (const [i, e] of entities.entries()) {
    scene.entities.push(createEntity(e.assetId, `E${i}`, { x: e.x, y: 0, z: e.z }))
  }
  const shot = scene.shots[0]!
  shot.aspect = '2:1'
  shot.camera.marks = []
  return { scene, shot }
}

/** Evaluate with a camera pinned at a known place, so the maths is checkable. */
function reportFor(
  scene: Scene,
  shot: Shot,
  zone: Shot['safeZone'],
  camOver: Partial<CameraState> = {}
) {
  shot.safeZone = zone
  const state = new ShotEvaluator(scene, shot).evaluate(0)
  const patched = { ...state, camera: { ...state.camera, ...camOver } }
  return analyzeSafeZone(scene, shot, patched)
}

describe('measuring a zone against a scene', () => {
  it('reports no data when the shot reserves nothing', () => {
    const { scene, shot } = sceneWith([])
    expect(reportFor(scene, shot, undefined)).toBeNull()
  })

  it('calls an empty scene fully clear', () => {
    const { scene, shot } = sceneWith([])
    const r = reportFor(scene, shot, { preset: 'leftThird' })
    expect(r!.negativeSpace).toBe(1)
    expect(r!.intruders).toEqual([])
  })

  it('finds a product standing in the reserved third', () => {
    // Camera at +Z looking at the origin; the bag sits left of frame centre,
    // which is the left third.
    const { scene, shot } = sceneWith([{ assetId: 'prop.suitcase', x: -1.6, z: 0 }])
    const c = { position: { x: 0, y: 0.6, z: 4 }, pan: 0, tilt: 0, vfov: Math.PI / 3 }
    const left = reportFor(scene, shot, { preset: 'leftThird' }, c)
    const right = reportFor(scene, shot, { preset: 'rightThird' }, c)
    expect(left!.negativeSpace).toBeLessThan(1)
    expect(left!.intruders[0]!.name).toBe('E0')
    // The same bag must not also block the far side of the frame.
    expect(right!.negativeSpace).toBe(1)
    expect(right!.intruders).toEqual([])
  })

  it('leaves the zone clear when the subject is outside it', () => {
    const { scene, shot } = sceneWith([{ assetId: 'prop.suitcase', x: 1.6, z: 0 }])
    const r = reportFor(
      scene,
      shot,
      { preset: 'leftThird' },
      { position: { x: 0, y: 0.6, z: 4 }, vfov: Math.PI / 3 }
    )
    expect(r!.negativeSpace).toBe(1)
  })

  it('ignores environment kits, which would swamp every zone', () => {
    // A terminal spans the frame by design. Counting it would report 0% clear
    // for every shot in a set and the number would mean nothing.
    const { scene, shot } = sceneWith([{ assetId: 'env.airportTerminal', x: 0, z: 0 }])
    const r = reportFor(
      scene,
      shot,
      { preset: 'leftThird' },
      { position: { x: 0, y: 1.6, z: 10 }, vfov: Math.PI / 3 }
    )
    expect(r!.negativeSpace).toBe(1)
    expect(r!.boxes).toEqual([])
  })

  it('ignores entities excluded from the export', () => {
    const { scene, shot } = sceneWith([{ assetId: 'prop.suitcase', x: -1.6, z: 0 }])
    scene.entities[0]!.excludeFromExport = true
    const r = reportFor(
      scene,
      shot,
      { preset: 'leftThird' },
      { position: { x: 0, y: 0.6, z: 4 }, vfov: Math.PI / 3 }
    )
    expect(r!.negativeSpace).toBe(1)
  })

  it('counts two overlapping subjects once', () => {
    const { scene, shot } = sceneWith([
      { assetId: 'prop.suitcase', x: -1.6, z: 0 },
      { assetId: 'prop.suitcase', x: -1.55, z: 0.05 }
    ])
    const c = { position: { x: 0, y: 0.6, z: 4 }, vfov: Math.PI / 3 }
    const two = reportFor(scene, shot, { preset: 'leftThird' }, c)!
    const summed = two.intruders.reduce((a, i) => a + i.coverage, 0)
    // Coverage per subject can sum past the union; the reported figure must
    // not. A negativeSpace below 0 would be the giveaway.
    expect(1 - two.negativeSpace).toBeLessThanOrEqual(summed + 1e-9)
    expect(two.negativeSpace).toBeGreaterThanOrEqual(0)
  })

  it('claims the whole frame for a subject straddling the camera', () => {
    // Half its corners are behind the lens, so the perspective divide is
    // unusable. Reporting the frame as blocked is the safe direction; a
    // plausible-looking small box would be wrong the dangerous way.
    const { scene, shot } = sceneWith([{ assetId: 'prop.suitcase', x: 0, z: 0 }])
    const state = new ShotEvaluator(scene, shot).evaluate(0)
    const bounds = projectEntityBounds(
      scene.entities[0]!,
      state.entities[0]!,
      cam({ position: { x: 0, y: 0.3, z: 0 } }),
      2
    )
    expect(bounds).toEqual({ x: 0, y: 0, w: 1, h: 1 })
  })

  it('drops a subject entirely behind the camera', () => {
    const { scene, shot } = sceneWith([{ assetId: 'prop.suitcase', x: 0, z: 10 }])
    const state = new ShotEvaluator(scene, shot).evaluate(0)
    expect(
      projectEntityBounds(scene.entities[0]!, state.entities[0]!, cam(), 2)
    ).toBeNull()
  })

  it('never reports negative space outside 0..1', () => {
    const { scene, shot } = sceneWith(
      Array.from({ length: 6 }, (_, i) => ({ assetId: 'prop.suitcase', x: -2 + i * 0.3, z: 0 }))
    )
    for (const preset of SAFE_ZONE_PRESET_IDS.filter((p) => p !== 'custom')) {
      const r = reportFor(scene, shot, { preset }, { position: { x: 0, y: 0.6, z: 3 } })!
      expect(r.negativeSpace, preset).toBeGreaterThanOrEqual(0)
      expect(r.negativeSpace, preset).toBeLessThanOrEqual(1)
    }
  })

  it('grows a subject box when the proxy is stretched', () => {
    // Item 4b's per-axis stretch has to reach the overlay, or a corrected
    // proxy would be measured at its old size.
    const { scene, shot } = sceneWith([{ assetId: 'prop.suitcase', x: 0, z: 0 }])
    const state = new ShotEvaluator(scene, shot).evaluate(0)
    const c = cam({ position: { x: 0, y: 0.6, z: 4 }, vfov: Math.PI / 3 })
    const before = projectEntityBounds(scene.entities[0]!, state.entities[0]!, c, 2)!
    scene.entities[0]!.transform.stretch = { x: 3, y: 1, z: 1 }
    const after = projectEntityBounds(scene.entities[0]!, state.entities[0]!, c, 2)!
    expect(after.w).toBeGreaterThan(before.w * 1.5)
  })

  it('prefers a measured box over the catalog one', () => {
    // The catalog's height describes the subject, not what is bolted to it:
    // prop.suitcase declares 0.7m and builds a pull handle above that. A
    // headline placed against the catalog box would land on the handle, so a
    // caller with real geometry must be able to hand it over.
    const { scene, shot } = sceneWith([{ assetId: 'prop.suitcase', x: 0, z: 0 }])
    const state = new ShotEvaluator(scene, shot).evaluate(0)
    const c = cam({ position: { x: 0, y: 0.7, z: 3 }, vfov: Math.PI / 3 })
    const fromCatalog = projectEntityBounds(scene.entities[0]!, state.entities[0]!, c, 2)!
    const measured = projectEntityBounds(scene.entities[0]!, state.entities[0]!, c, 2, {
      min: { x: -0.15, y: 0, z: -0.12 },
      max: { x: 0.15, y: 1.05, z: 0.12 }
    })!
    // A taller real box reaches higher up the frame, which is a SMALLER y.
    expect(measured.y).toBeLessThan(fromCatalog.y)
  })

  it('counts a measured box against the zone', () => {
    // End to end through analyzeSafeZone, not just the projection: a measured
    // box that never reached the occupancy maths would be silently ignored.
    const { scene, shot } = sceneWith([{ assetId: 'prop.suitcase', x: -1.6, z: 0 }])
    shot.safeZone = { preset: 'leftThird' }
    const evaluator = new ShotEvaluator(scene, shot)
    const base = evaluator.evaluate(0)
    const state = {
      ...base,
      camera: { ...base.camera, position: { x: 0, y: 0.6, z: 4 }, pan: 0, tilt: 0, vfov: Math.PI / 3 }
    }
    const plain = analyzeSafeZone(scene, shot, state)!
    const big = analyzeSafeZone(
      scene,
      shot,
      state,
      new Map([
        [
          scene.entities[0]!.id,
          { min: { x: -2.4, y: 0, z: -0.4 }, max: { x: -0.8, y: 2, z: 0.4 } }
        ]
      ])
    )!
    expect(big.negativeSpace).toBeLessThan(plain.negativeSpace)
  })

  it('falls back to the catalog box for an entity with no measurement', () => {
    // A partial map must not silently drop the subjects it does not cover.
    const { scene, shot } = sceneWith([{ assetId: 'prop.suitcase', x: -1.6, z: 0 }])
    shot.safeZone = { preset: 'leftThird' }
    const base = new ShotEvaluator(scene, shot).evaluate(0)
    const state = {
      ...base,
      camera: { ...base.camera, position: { x: 0, y: 0.6, z: 4 }, vfov: Math.PI / 3 }
    }
    const withEmptyMap = analyzeSafeZone(scene, shot, state, new Map())!
    expect(withEmptyMap).toEqual(analyzeSafeZone(scene, shot, state)!)
  })

  it('finds the worst instant across a moving shot, not just frame 0', () => {
    // A zone clear at t=0 and blocked at t=3 is not a safe zone.
    const { scene, shot } = sceneWith([{ assetId: 'person.man', x: 0, z: 0 }])
    shot.duration = 2
    shot.fps = 12
    shot.safeZone = { preset: 'rightThird' }
    const evaluator = new ShotEvaluator(scene, shot)
    const camAt = { position: { x: 0, y: 1.6, z: 6 }, pan: 0, tilt: 0, vfov: Math.PI / 3 }
    const patched = (t: number) => {
      const s = evaluator.evaluate(t)
      // Walk the subject from frame centre INTO the right third. At z=0 with
      // this lens the frame spans x -6.9..6.9, so the right third starts near
      // x=2.3 and the subject is clear of it at t=0.
      const e = s.entities[0]!
      return {
        ...s,
        camera: { ...s.camera, ...camAt },
        entities: [{ ...e, position: { x: t * 2.5, y: 0, z: 0 } }]
      }
    }
    const worst = worstSafeZone(scene, shot, patched)!
    expect(worst.report.negativeSpace).toBeLessThan(
      analyzeSafeZone(scene, shot, patched(0))!.negativeSpace
    )
    expect(worst.time).toBeGreaterThan(0)
  })
})

describe('the prompt sentence', () => {
  it('says nothing when no zone is set', () => {
    expect(safeZonePhrase(undefined)).toBeNull()
    expect(safeZonePhrase({ preset: 'custom' })).toBeNull()
  })

  it('names each preset region in words a model can act on', () => {
    expect(safeZonePhrase({ preset: 'leftThird' })).toContain('left third of the frame')
    expect(safeZonePhrase({ preset: 'bottomBand' })).toContain('bottom third of the frame')
    // States the purpose, not just "leave it empty" — models read a bare
    // "empty" as licence to put something small there.
    expect(safeZonePhrase({ preset: 'topBand' })).toMatch(/headline text/)
  })

  it('describes a custom rect by where it actually sits', () => {
    expect(describeCustomRect({ x: 0, y: 0, w: 0.4, h: 1 })).toContain('left')
    expect(describeCustomRect({ x: 0.6, y: 0, w: 0.4, h: 1 })).toContain('right')
    expect(describeCustomRect({ x: 0, y: 0, w: 1, h: 0.25 })).toContain('upper')
    expect(describeCustomRect({ x: 0, y: 0.75, w: 1, h: 0.25 })).toContain('lower')
  })

  it('does not stack two placement words on a full-width band', () => {
    // "the upper centre area" for a top band reads like a mistake.
    expect(describeCustomRect({ x: 0, y: 0, w: 1, h: 0.25 })).not.toContain('centre')
  })

  it('carries the share of the frame, which is the number being negotiated', () => {
    expect(describeCustomRect({ x: 0, y: 0, w: 0.4, h: 1 })).toContain('40%')
  })
})

describe('project round-trip', () => {
  function roundTrip(shot: Shot): Shot {
    const doc = createProject('rt')
    const scene = doc.scenes[0]!
    scene.shots = [{ ...shot, blockingTakeId: scene.blocking[0]!.id }]
    const parsed = parseProject(serializeProject(doc))
    expect(parsed.issues).toEqual([])
    return parsed.doc!.scenes[0]!.shots[0]!
  }

  it('gains no key when no zone is set', () => {
    // A pre-fork project must not pick up a phantom diff the first time it is
    // opened in this build.
    const doc = createProject('rt')
    const before = serializeProject(doc)
    const after = serializeProject(parseProject(before).doc!)
    expect(after).toBe(before)
    expect('safeZone' in doc.scenes[0]!.shots[0]!).toBe(false)
  })

  it('survives a preset zone unchanged', () => {
    const doc = createProject('rt')
    const shot = createShot(doc.scenes[0]!, '1A')
    shot.safeZone = { preset: 'rightThird' }
    expect(roundTrip(shot).safeZone).toEqual({ preset: 'rightThird' })
  })

  it('survives a custom rect unchanged', () => {
    const doc = createProject('rt')
    const shot = createShot(doc.scenes[0]!, '1A')
    shot.safeZone = { preset: 'custom', rect: { x: 0, y: 0, w: 0.4, h: 1 } }
    expect(roundTrip(shot).safeZone).toEqual({
      preset: 'custom',
      rect: { x: 0, y: 0, w: 0.4, h: 1 }
    })
  })

  it('degrades a junk zone to no zone instead of rejecting the file', () => {
    const doc = createProject('rt')
    const shot = createShot(doc.scenes[0]!, '1A')
    ;(shot as { safeZone?: unknown }).safeZone = { preset: 'leftHalf' }
    expect(roundTrip(shot).safeZone).toBeUndefined()
  })

  it('normalizes a zone on a draft shot too', () => {
    // Drafts are playable and exportable, so they need the same guarantees.
    const doc = createProject('rt')
    const scene = doc.scenes[0]!
    const draft = createShot(scene, '1A v1')
    draft.draftOf = scene.shots[0]!.id
    ;(draft as { safeZone?: unknown }).safeZone = { preset: 'nope' }
    scene.drafts = [draft]
    const parsed = parseProject(serializeProject(doc))
    expect(parsed.issues).toEqual([])
    expect(parsed.doc!.scenes[0]!.drafts![0]!.safeZone).toBeUndefined()
  })

  it('pulls an out-of-frame custom rect back on load', () => {
    const doc = createProject('rt')
    const shot = createShot(doc.scenes[0]!, '1A')
    shot.safeZone = { preset: 'custom', rect: { x: 0.95, y: 0, w: 0.4, h: 1 } }
    const back = roundTrip(shot).safeZone!
    expect(back.rect!.x).toBeCloseTo(0.6)
    expect(back.rect!.w).toBeCloseTo(0.4)
  })
})

describe('aspect independence', () => {
  it('reserves the same share of the picture at every delivery ratio', () => {
    // The zone is normalized, so switching a shot from 16:9 to 4:5 must not
    // change what fraction of the frame the headline gets.
    for (const aspect of Object.keys(ASPECT_RATIOS)) {
      const { scene, shot } = sceneWith([])
      shot.aspect = aspect as Shot['aspect']
      const r = reportFor(scene, shot, { preset: 'leftThird' })!
      expect(r.rect.w * r.rect.h, aspect).toBeCloseTo(1 / 3, 6)
    }
  })
})
