/**
 * AlchemyWorx fork addition — resolving an entity's full static pose.
 * See MODIFICATIONS.md.
 *
 * Upstream entities were upright and uniformly scaled: one `rotationY` for
 * heading, one `scale` number. Staging a product needs more — a carry-on laid
 * on its side, a compact tipped to catch a highlight, a proxy stretched 8% in
 * one axis because the archetype is slightly off the real thing.
 *
 * Two constraints shaped the representation:
 *
 * 1. `rotationY` stays the yaw field. Roughly thirty call sites read it as
 *    heading — choreography facing, marriage offsets, the MCP bridge, the
 *    top-down diagram. Pitch and roll arrive as separate optional fields so
 *    none of that changes meaning.
 * 2. `scale` stays the single real-world size multiplier, because
 *    `entityHeight` and the auto-framing that consumes it need one number.
 *    Per-axis correction is a separate `stretch`, applied on top.
 *
 * Both additions are optional, so a project written before them migrates to
 * the identity pose and renders byte-identically.
 *
 * Pure: no DOM, no three.js. The renderer and the glTF export both resolve
 * through here so a staged pose and its Blender handoff cannot disagree.
 */

import type { Transform, V3 } from './types'

/**
 * Euler order for entity rotation. Yaw is applied FIRST, so `rotationY` still
 * means "which way is this facing" no matter how far the object is tilted.
 * Any consumer building a rotation from a Transform must use this order or
 * the pose will not match what the viewport showed.
 */
export const ENTITY_EULER_ORDER = 'YXZ' as const

/** Rotation snap for the gizmo and the numeric fields, in degrees. */
export const ROTATION_SNAP_DEG = 15

/** Per-axis stretch is clamped here: enough to fix a proxy, not to mangle it. */
export const STRETCH_MIN = 0.25
export const STRETCH_MAX = 4

/** Uniform scale bounds. Wider than the old 0.3–3.0 slider, which could not
 *  correct an imported GLB authored in the wrong unit. */
export const SCALE_MIN = 0.01
export const SCALE_MAX = 100

const IDENTITY_STRETCH: V3 = { x: 1, y: 1, z: 1 }

function finite(n: unknown, fallback: number): number {
  return typeof n === 'number' && Number.isFinite(n) ? n : fallback
}

export function clampScale(n: number): number {
  return Math.min(SCALE_MAX, Math.max(SCALE_MIN, finite(n, 1)))
}

export function clampStretch(n: number): number {
  return Math.min(STRETCH_MAX, Math.max(STRETCH_MIN, finite(n, 1)))
}

/** Pitch, yaw and roll in radians, defaulted for a pre-rotation project. */
export function rotationOf(t: Transform): V3 {
  return {
    x: finite(t.rotationX, 0),
    y: finite(t.rotationY, 0),
    z: finite(t.rotationZ, 0)
  }
}

/** Per-axis stretch multipliers, defaulted and clamped. */
export function stretchOf(t: Transform): V3 {
  const s = t.stretch
  if (!s) return IDENTITY_STRETCH
  return { x: clampStretch(s.x), y: clampStretch(s.y), z: clampStretch(s.z) }
}

/** True when the pose carries no per-axis stretch, so proportions are intact. */
export function isProportional(t: Transform): boolean {
  const s = stretchOf(t)
  return s.x === s.y && s.y === s.z
}

/**
 * Uniform scale times per-axis stretch: exactly what a renderer should put on
 * the object's scale vector. One place, so the viewport and the `.glb` agree.
 */
export function effectiveScale(t: Transform): V3 {
  const base = clampScale(t.scale)
  const s = stretchOf(t)
  return { x: base * s.x, y: base * s.y, z: base * s.z }
}

/**
 * The multiplier to hand `entityHeight`. Vertical stretch is folded in, so a
 * proxy stretched 10% taller reports 10% taller and auto-framing, label
 * placement and the top-down diagram stay honest about it.
 */
export function heightScale(t: Transform): number {
  return clampScale(t.scale) * stretchOf(t).y
}

/** The largest of the three effective axes, for scale-aware grid and clipping. */
export function widestScale(t: Transform): number {
  const s = effectiveScale(t)
  return Math.max(s.x, s.y, s.z)
}

/** Snap an angle in degrees to the nearest increment. */
export function snapDeg(deg: number, increment = ROTATION_SNAP_DEG): number {
  if (!Number.isFinite(deg) || increment <= 0) return 0
  return Math.round(deg / increment) * increment
}

/**
 * Normalise a stretch triple for storage: identity collapses to `undefined`
 * so an untouched entity writes no extra keys and old projects round-trip
 * unchanged on disk.
 */
export function normalizeStretch(s: V3 | undefined): V3 | undefined {
  if (!s) return undefined
  const out = { x: clampStretch(s.x), y: clampStretch(s.y), z: clampStretch(s.z) }
  if (out.x === 1 && out.y === 1 && out.z === 1) return undefined
  return out
}

/**
 * Write pitch and roll onto a transform, collapsing zero back to absent so an
 * entity nobody tilted keeps serializing exactly as it did before the fields
 * existed. Angles are normalised to (-PI, PI] so a full turn reads as zero.
 */
export function setPitchRoll(t: Transform, pitch: number, roll: number): void {
  const x = normalizeAngle(pitch)
  const z = normalizeAngle(roll)
  if (x === 0) delete t.rotationX
  else t.rotationX = x
  if (z === 0) delete t.rotationZ
  else t.rotationZ = z
}

/** Fold an angle into (-PI, PI], mapping a signed zero to plain zero. */
export function normalizeAngle(rad: number): number {
  if (!Number.isFinite(rad)) return 0
  const twoPi = Math.PI * 2
  let a = rad % twoPi
  if (a > Math.PI) a -= twoPi
  if (a <= -Math.PI) a += twoPi
  return a === 0 ? 0 : a
}

/**
 * Split a three.js-style scale vector back into a uniform scale plus a
 * per-axis stretch, given the uniform scale the entity already carries. Used
 * when the scale gizmo commits, and the rule matters:
 *
 * - A PROPORTIONAL drag moves the uniform `scale`, so the object's declared
 *   real-world size changes and `entityHeight` follows it.
 * - A NON-PROPORTIONAL drag leaves `scale` alone and lands in `stretch`,
 *   because the object's nominal size did not change, only one dimension of
 *   the proxy got corrected.
 *
 * Getting that backwards would let a plain uniform resize silently detach
 * auto-framing from the object it is framing.
 */
export function splitScaleVector(vector: V3, base: number): { scale: number; stretch?: V3 } {
  const from = clampScale(base)
  const rx = finite(vector.x, from) / from
  const ry = finite(vector.y, from) / from
  const rz = finite(vector.z, from) / from
  const proportional =
    Math.abs(rx - ry) < 1e-4 && Math.abs(ry - rz) < 1e-4 && Math.abs(rx - rz) < 1e-4
  if (proportional) return { scale: clampScale(from * rx), stretch: undefined }
  return { scale: from, stretch: normalizeStretch({ x: rx, y: ry, z: rz }) }
}
