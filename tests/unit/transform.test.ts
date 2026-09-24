/**
 * AW fork: the full static pose.
 *
 * Two invariants carry the weight here and both were chosen to protect
 * existing behavior rather than to add features:
 *
 * 1. `rotationY` still means heading. Roughly thirty call sites read it that
 *    way, so pitch and roll are separate fields applied in YXZ order.
 * 2. `scale` is still one number, because `entityHeight` and the auto-framing
 *    that consumes it need one. Per-axis correction lives in `stretch`.
 *
 * The consequence worth testing hardest: a proportional scale drag must move
 * `scale`, and a non-proportional one must not. Getting that backwards would
 * let a plain resize silently detach auto-framing from its subject.
 */

import { describe, it, expect } from 'vitest'
import {
  ENTITY_EULER_ORDER,
  ROTATION_SNAP_DEG,
  SCALE_MAX,
  SCALE_MIN,
  STRETCH_MAX,
  STRETCH_MIN,
  clampScale,
  clampStretch,
  effectiveScale,
  heightScale,
  isProportional,
  normalizeAngle,
  normalizeStretch,
  rotationOf,
  setPitchRoll,
  snapDeg,
  splitScaleVector,
  stretchOf,
  widestScale
} from '../../src/engine/transform'
import type { Transform } from '../../src/engine/types'

const base = (over: Partial<Transform> = {}): Transform => ({
  position: { x: 0, y: 0, z: 0 },
  rotationY: 0,
  scale: 1,
  ...over
})

describe('rotation', () => {
  it('yaw stays the heading field, and pitch/roll default to upright', () => {
    // A project written before the fields exist must read as upright.
    const r = rotationOf(base({ rotationY: 1.2 }))
    expect(r).toEqual({ x: 0, y: 1.2, z: 0 })
  })

  it('applies yaw first, so heading survives a tilt', () => {
    // Not an arbitrary preference: XYZ order would make rotationY mean
    // something different once pitch is non-zero, and every consumer reading
    // it as "which way is this facing" would quietly be wrong.
    expect(ENTITY_EULER_ORDER).toBe('YXZ')
  })

  it('collapses a zero angle back to absent so old projects round-trip', () => {
    const t = base({ rotationX: 0.5, rotationZ: 0.5 })
    setPitchRoll(t, 0, 0)
    expect('rotationX' in t).toBe(false)
    expect('rotationZ' in t).toBe(false)
  })

  it('stores a non-zero tilt', () => {
    const t = base()
    setPitchRoll(t, Math.PI / 2, -Math.PI / 4)
    expect(t.rotationX).toBeCloseTo(Math.PI / 2)
    expect(t.rotationZ).toBeCloseTo(-Math.PI / 4)
  })

  it('folds a full turn to zero rather than accumulating', () => {
    const t = base()
    setPitchRoll(t, Math.PI * 2, Math.PI * 4)
    expect('rotationX' in t).toBe(false)
    expect('rotationZ' in t).toBe(false)
  })

  it('never emits a signed zero, which would compare unequal', () => {
    // The product system already lost a day to -0 leaking through sign maths.
    expect(Object.is(normalizeAngle(-0), 0)).toBe(true)
    expect(Object.is(normalizeAngle(-Math.PI * 2), 0)).toBe(true)
  })

  it('normalises into (-PI, PI]', () => {
    expect(normalizeAngle(Math.PI * 1.5)).toBeCloseTo(-Math.PI / 2)
    expect(normalizeAngle(-Math.PI * 1.5)).toBeCloseTo(Math.PI / 2)
    expect(normalizeAngle(Math.PI)).toBeCloseTo(Math.PI)
  })

  it('survives junk instead of throwing', () => {
    const t = base()
    setPitchRoll(t, Number.NaN, Number.POSITIVE_INFINITY)
    expect('rotationX' in t).toBe(false)
    expect('rotationZ' in t).toBe(false)
  })

  it('snaps to the approved 15 degree increment', () => {
    expect(ROTATION_SNAP_DEG).toBe(15)
    expect(snapDeg(7)).toBe(0)
    expect(snapDeg(8)).toBe(15)
    expect(snapDeg(-82)).toBe(-75)
    expect(snapDeg(Number.NaN)).toBe(0)
  })
})

describe('scale and stretch', () => {
  it('reads as unstretched when the field is absent', () => {
    expect(stretchOf(base())).toEqual({ x: 1, y: 1, z: 1 })
    expect(isProportional(base())).toBe(true)
  })

  it('multiplies stretch onto the uniform scale', () => {
    const t = base({ scale: 2, stretch: { x: 1, y: 1.5, z: 0.5 } })
    expect(effectiveScale(t)).toEqual({ x: 2, y: 3, z: 1 })
  })

  it('reports a stretched proxy as no longer proportional', () => {
    expect(isProportional(base({ stretch: { x: 1, y: 1.1, z: 1 } }))).toBe(false)
    expect(isProportional(base({ stretch: { x: 1.2, y: 1.2, z: 1.2 } }))).toBe(true)
  })

  it('folds vertical stretch into the height auto-framing reads', () => {
    // The whole point of routing entityHeight through here: a proxy stretched
    // 10% taller must REPORT 10% taller, or every shot-size preset misframes
    // it by that much and nothing says so.
    expect(heightScale(base({ scale: 2, stretch: { x: 3, y: 1.1, z: 3 } }))).toBeCloseTo(2.2)
    expect(heightScale(base({ scale: 2 }))).toBe(2)
  })

  it('reports the widest axis for scale-aware grid and clipping', () => {
    expect(widestScale(base({ scale: 1, stretch: { x: 0.5, y: 2, z: 1 } }))).toBe(2)
  })

  it('clamps scale wide enough to rescue a GLB authored in centimetres', () => {
    // The old slider stopped at 3.0, so a model 100x oversize was unfixable.
    expect(clampScale(0.01)).toBe(0.01)
    expect(clampScale(1e9)).toBe(SCALE_MAX)
    expect(clampScale(0)).toBe(SCALE_MIN)
    expect(clampScale(Number.NaN)).toBe(1)
  })

  it('clamps stretch tightly, since it corrects rather than rebuilds', () => {
    expect(clampStretch(99)).toBe(STRETCH_MAX)
    expect(clampStretch(0)).toBe(STRETCH_MIN)
    expect(clampStretch(Number.NaN)).toBe(1)
  })

  it('collapses an identity stretch to absent', () => {
    expect(normalizeStretch({ x: 1, y: 1, z: 1 })).toBeUndefined()
    expect(normalizeStretch(undefined)).toBeUndefined()
    expect(normalizeStretch({ x: 1, y: 1.2, z: 1 })).toEqual({ x: 1, y: 1.2, z: 1 })
  })
})

describe('splitting a scale gizmo drag', () => {
  it('sends a proportional drag to the uniform scale', () => {
    // Doubling an object really did change its size, so entityHeight must see
    // it. Recording this as a stretch instead would leave framing behind.
    const out = splitScaleVector({ x: 2, y: 2, z: 2 }, 1)
    expect(out.scale).toBeCloseTo(2)
    expect(out.stretch).toBeUndefined()
  })

  it('sends a one-axis drag to stretch and leaves the nominal size alone', () => {
    const out = splitScaleVector({ x: 1, y: 1.2, z: 1 }, 1)
    expect(out.scale).toBe(1)
    expect(out.stretch).toEqual({ x: 1, y: 1.2, z: 1 })
  })

  it('splits correctly when the entity was already scaled', () => {
    const out = splitScaleVector({ x: 2, y: 2.4, z: 2 }, 2)
    expect(out.scale).toBe(2)
    expect(out.stretch?.y).toBeCloseTo(1.2)
    expect(out.stretch?.x).toBeCloseTo(1)
  })

  it('round-trips: applying the split reproduces the dragged vector', () => {
    const dragged = { x: 1.5, y: 2.25, z: 0.75 }
    const out = splitScaleVector(dragged, 1.5)
    const back = effectiveScale(base({ scale: out.scale, stretch: out.stretch }))
    expect(back.x).toBeCloseTo(dragged.x)
    expect(back.y).toBeCloseTo(dragged.y)
    expect(back.z).toBeCloseTo(dragged.z)
  })
})
