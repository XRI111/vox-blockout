/**
 * AW fork: headline safe zones.
 *
 * An AW email hero is a picture with words on it. The designer needs to know,
 * before generating, that a chosen region of the frame will be clean enough to
 * carry a headline — and the image model needs to be told to keep it clean.
 * This module owns both halves: where the zone is, and how much of it is free.
 *
 * Pure engine: no DOM, no three.js. The rect lives on the shot as data, so
 * `state(t)` stays a pure function of the document and nothing here reads the
 * editor. That matters because the same numbers go into `metadata.json` and
 * `prompt.txt`, which have to be reproducible from the project alone.
 *
 * Two conventions worth stating plainly, because both are load-bearing:
 *
 * 1. **Frame space is normalized, origin top-left.** A rect is a fraction of
 *    the delivered frame, never pixels, so "left third" keeps meaning left
 *    third when the aspect or the export width changes. Aspect enters only
 *    through the projection, where it belongs.
 *
 * 2. **Occupancy is measured from bounding boxes, so it over-reports.** A box
 *    around a suitcase is larger than the suitcase, so the free space this
 *    module reports is never more than the free space in the render. Erring
 *    the other way would put a headline on the product, which is the one
 *    failure mode that costs a designer real work.
 *
 *    The box bounds a subject's geometry and not the shadow it casts. A soft
 *    ground shadow under a headline is not a problem, and treating it as one
 *    would report most frames as blocked. Worth knowing when reading the
 *    figure: it answers "is an object in the way", not "is every pixel flat".
 */

import { assetSpec, entityHeight } from './assets'
import { ASPECT_RATIOS } from './camera'
import { heightScale, widestScale } from './transform'
import type { CameraState, Entity, EntityState, Scene, Shot, ShotState, V3 } from './types'

/** Normalized rect in delivered-frame space: origin top-left, 0..1. */
export interface FrameRect {
  x: number
  y: number
  w: number
  h: number
}

export type SafeZonePresetId = 'leftThird' | 'rightThird' | 'topBand' | 'bottomBand' | 'custom'

export interface SafeZone {
  preset: SafeZonePresetId
  /** Read only when `preset` is 'custom'. Normalized, origin top-left. */
  rect?: FrameRect
}

/**
 * The four named zones. Each is exactly one third of the frame: a "band" and a
 * "third" differ in name only, so a designer switching between a 2:1 hero and
 * a 4:5 social frame gets the same proportion of the picture either way.
 *
 * The pilot's "headline left 40%" is not a preset. It is a custom rect, which
 * is what custom is for — adding a preset per percentage would be a list
 * nobody can read.
 */
export const SAFE_ZONE_PRESETS: Record<Exclude<SafeZonePresetId, 'custom'>, FrameRect> = {
  leftThird: { x: 0, y: 0, w: 1 / 3, h: 1 },
  rightThird: { x: 2 / 3, y: 0, w: 1 / 3, h: 1 },
  topBand: { x: 0, y: 0, w: 1, h: 1 / 3 },
  bottomBand: { x: 0, y: 2 / 3, w: 1, h: 1 / 3 }
}

/** Ordered for the UI picker. */
export const SAFE_ZONE_PRESET_IDS: SafeZonePresetId[] = [
  'leftThird',
  'rightThird',
  'topBand',
  'bottomBand',
  'custom'
]

export const SAFE_ZONE_LABELS: Record<SafeZonePresetId, string> = {
  leftThird: 'Left third',
  rightThird: 'Right third',
  topBand: 'Top band',
  bottomBand: 'Bottom band',
  custom: 'Custom'
}

/** Words for `prompt.txt`. A generator reads English, not a rect. */
export const SAFE_ZONE_PHRASES: Record<Exclude<SafeZonePresetId, 'custom'>, string> = {
  leftThird: 'the left third of the frame',
  rightThird: 'the right third of the frame',
  topBand: 'the top third of the frame',
  bottomBand: 'the bottom third of the frame'
}

export function isSafeZonePresetId(v: unknown): v is SafeZonePresetId {
  return typeof v === 'string' && SAFE_ZONE_PRESET_IDS.includes(v as SafeZonePresetId)
}

/** Smallest rect worth reserving; below this a zone is a rounding error. */
export const MIN_ZONE_EDGE = 0.02

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0
  // `+ 0` collapses -0, which would otherwise reach serialized metadata.
  return Math.min(1, Math.max(0, n)) + 0
}

/**
 * Pull a rect fully inside the frame without changing its size where that is
 * possible, shrinking it only when it is genuinely too large. A zone dragged
 * past the edge should slide back, not silently resize.
 */
export function clampRect(r: FrameRect): FrameRect {
  const w = Math.min(1, Math.max(MIN_ZONE_EDGE, Number.isFinite(r.w) ? r.w : MIN_ZONE_EDGE))
  const h = Math.min(1, Math.max(MIN_ZONE_EDGE, Number.isFinite(r.h) ? r.h : MIN_ZONE_EDGE))
  return {
    x: clamp01(Math.min(clamp01(r.x), 1 - w)),
    y: clamp01(Math.min(clamp01(r.y), 1 - h)),
    w,
    h
  }
}

/** The rect a zone denotes, or null when the shot reserves nothing. */
export function resolveSafeZone(zone: SafeZone | undefined | null): FrameRect | null {
  if (!zone) return null
  if (zone.preset === 'custom') return zone.rect ? clampRect(zone.rect) : null
  const preset = SAFE_ZONE_PRESETS[zone.preset]
  return preset ? { ...preset } : null
}

/**
 * Normalize an untrusted value from a project file. Returns undefined for
 * anything unusable, so a hand-edited or forward-versioned document degrades
 * to "no safe zone" rather than rejecting the project or leaking NaN into the
 * overlay and the export package.
 */
export function normalizeSafeZone(v: unknown): SafeZone | undefined {
  if (typeof v !== 'object' || v === null) return undefined
  const raw = v as { preset?: unknown; rect?: unknown }
  if (!isSafeZonePresetId(raw.preset)) return undefined
  if (raw.preset !== 'custom') return { preset: raw.preset }
  const r = raw.rect as Partial<FrameRect> | undefined
  if (!r || typeof r !== 'object') return undefined
  const nums = [r.x, r.y, r.w, r.h]
  if (nums.some((n) => typeof n !== 'number' || !Number.isFinite(n))) return undefined
  return { preset: 'custom', rect: clampRect(r as FrameRect) }
}

/* ------------------------------ projection ------------------------------ */

/**
 * A world point in frame space. `depth` is metres along the view direction:
 * positive in front of the camera, so a non-positive depth means the point is
 * behind it and `x`/`y` are meaningless.
 */
export interface FramePoint {
  x: number
  y: number
  depth: number
}

/**
 * Project a world point into normalized frame space.
 *
 * This reproduces the renderer's camera rather than inventing one: the shot
 * camera is a three.js PerspectiveCamera whose rotation is set as Euler
 * `(tilt, pan, roll)` in **YXZ** order, looking down its own -Z, with vertical
 * FOV `vfov` and the shot's aspect. Getting that order wrong would put the
 * overlay somewhere the render does not, which is why an e2e measures this
 * against real pixels instead of trusting the algebra.
 */
export function projectToFrame(camera: CameraState, aspect: number, p: V3): FramePoint {
  const { pan, tilt, roll } = camera
  const sp = Math.sin(pan)
  const cp = Math.cos(pan)
  const st = Math.sin(tilt)
  const ct = Math.cos(tilt)
  const sr = Math.sin(roll)
  const cr = Math.cos(roll)

  // Columns of R = Ry(pan) * Rx(tilt) * Rz(roll): the camera's own axes in
  // world space. Forward is -Z.
  const right: V3 = { x: cp * cr + sp * st * sr, y: ct * sr, z: -sp * cr + cp * st * sr }
  const up: V3 = { x: -cp * sr + sp * st * cr, y: ct * cr, z: sp * sr + cp * st * cr }
  const forward: V3 = { x: -sp * ct, y: st, z: -cp * ct }

  const d: V3 = {
    x: p.x - camera.position.x,
    y: p.y - camera.position.y,
    z: p.z - camera.position.z
  }
  const depth = d.x * forward.x + d.y * forward.y + d.z * forward.z
  const halfH = Math.tan(camera.vfov / 2)
  const halfW = halfH * aspect
  if (depth <= 1e-6) return { x: 0, y: 0, depth }
  const xn = (d.x * right.x + d.y * right.y + d.z * right.z) / (depth * halfW)
  const yn = (d.x * up.x + d.y * up.y + d.z * up.z) / (depth * halfH)
  // NDC to frame space: x right, y DOWN from the top-left corner.
  return { x: (xn + 1) / 2, y: (1 - yn) / 2, depth }
}

/* ------------------------------- occupancy ------------------------------ */

/** The whole frame, used when a subject straddles the camera. */
const FULL_FRAME: FrameRect = { x: 0, y: 0, w: 1, h: 1 }

/** A world-space axis-aligned box, as measured off the live scene graph. */
export interface WorldBox {
  min: V3
  max: V3
}

/**
 * Corners of the box to project for one entity.
 *
 * Prefer a measured box when the caller has one. The catalog's `height` and
 * `footprint` describe the subject, not everything attached to it: a suitcase
 * declares 0.7 m and builds a pull handle above that, so the catalog box stops
 * below the top of the mesh. For auto-framing that is a rounding error; for a
 * headline it is the unsafe direction, because the overlay would call a strip
 * of frame clear that has a handle in it.
 *
 * The catalog box stays as the fallback: it needs no scene graph, so the engine
 * stays pure and unit-testable, and a caller without a renderer still gets a
 * usable answer.
 */
function entityCorners(entity: Entity, state: EntityState, measured?: WorldBox): V3[] {
  if (measured) {
    const { min, max } = measured
    const out: V3[] = []
    for (const x of [min.x, max.x]) for (const y of [min.y, max.y]) for (const z of [min.z, max.z]) {
      out.push({ x, y, z })
    }
    return out
  }
  const spec = assetSpec(entity.assetId)
  const t = entity.transform
  const h = entityHeight(entity.assetId, heightScale(t), entity.params)
  const r = Math.max(spec.footprint * widestScale(t), 1e-4)
  const base = state.position.y
  const out: V3[] = []
  for (const dx of [-r, r]) for (const dz of [-r, r]) for (const dy of [0, h]) {
    out.push({ x: state.position.x + dx, y: base + dy, z: state.position.z + dz })
  }
  return out
}

/**
 * Screen-space bounds of an entity. Returns null when it is entirely behind
 * the camera.
 */
export function projectEntityBounds(
  entity: Entity,
  state: EntityState,
  camera: CameraState,
  aspect: number,
  measured?: WorldBox
): FrameRect | null {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let anyBehind = false
  let anyFront = false
  for (const corner of entityCorners(entity, state, measured)) {
    const pt = projectToFrame(camera, aspect, corner)
    if (pt.depth <= 1e-6) {
      anyBehind = true
      continue
    }
    anyFront = true
    if (pt.x < minX) minX = pt.x
    if (pt.x > maxX) maxX = pt.x
    if (pt.y < minY) minY = pt.y
    if (pt.y > maxY) maxY = pt.y
  }
  if (!anyFront) return null
  // Straddling the near plane: the perspective divide is unusable for the
  // corners behind the camera, and something that close fills the frame. Claim
  // the whole frame rather than report a bound that is wrong in the unsafe
  // direction.
  if (anyBehind) return { ...FULL_FRAME }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

function intersect(a: FrameRect, b: FrameRect): FrameRect | null {
  const x = Math.max(a.x, b.x)
  const y = Math.max(a.y, b.y)
  const w = Math.min(a.x + a.w, b.x + b.w) - x
  const h = Math.min(a.y + a.h, b.y + b.h) - y
  return w > 0 && h > 0 ? { x, y, w, h } : null
}

function area(r: FrameRect): number {
  return r.w * r.h
}

/**
 * Exact union area of axis-aligned rects, by sweeping x-slabs and merging the
 * y-intervals in each. Summing areas instead would double-count two subjects
 * standing together and report a zone as busier than it is.
 */
export function unionArea(rects: FrameRect[]): number {
  if (rects.length === 0) return 0
  const xs = [...new Set(rects.flatMap((r) => [r.x, r.x + r.w]))].sort((a, b) => a - b)
  let total = 0
  for (let i = 0; i < xs.length - 1; i++) {
    const x0 = xs[i]!
    const x1 = xs[i + 1]!
    const slabWidth = x1 - x0
    if (slabWidth <= 0) continue
    const spans = rects
      .filter((r) => r.x <= x0 && r.x + r.w >= x1)
      .map((r) => [r.y, r.y + r.h] as [number, number])
      .sort((a, b) => a[0] - b[0])
    let covered = 0
    let openStart = -Infinity
    let openEnd = -Infinity
    for (const [s, e] of spans) {
      if (s > openEnd) {
        if (openEnd > openStart) covered += openEnd - openStart
        openStart = s
        openEnd = e
      } else if (e > openEnd) {
        openEnd = e
      }
    }
    if (openEnd > openStart) covered += openEnd - openStart
    total += covered * slabWidth
  }
  return total
}

export interface SafeZoneIntruder {
  entityId: string
  name: string
  /** Fraction of the zone this one subject covers, 0..1. */
  coverage: number
}

export interface SafeZoneReport {
  rect: FrameRect
  /** Fraction of the zone no subject box reaches, 0..1. 1 means clear. */
  negativeSpace: number
  /** Subjects reaching into the zone, largest first. */
  intruders: SafeZoneIntruder[]
  /** Every subject's projected bounds, for drawing the overlay. */
  boxes: { entityId: string; rect: FrameRect }[]
}

/**
 * Entities that count against a headline. Environment kits are excluded:
 * a terminal or a hotel room spans the whole frame by design, so counting
 * them would make every zone read 0% clear and the number would tell a
 * designer nothing. Export-excluded entities are staging aids and are not in
 * the picture at all.
 */
export function isSafeZoneSubject(entity: Entity): boolean {
  if (entity.excludeFromExport) return false
  return assetSpec(entity.assetId).category !== 'environment'
}

/**
 * Measure a shot's safe zone at one instant. Returns null when the shot
 * reserves no zone, so callers can treat "no zone" and "no data" alike.
 */
export function analyzeSafeZone(
  scene: Scene,
  shot: Shot,
  state: ShotState,
  /**
   * Measured world boxes by entity id, from the live scene graph. Supplying
   * them makes the report exact; omitting them falls back to the catalog box,
   * which can stop short of attached geometry.
   */
  measured?: Map<string, WorldBox>
): SafeZoneReport | null {
  const rect = resolveSafeZone(shot.safeZone)
  if (!rect) return null
  const aspect = ASPECT_RATIOS[shot.aspect] ?? 16 / 9
  const byId = new Map(scene.entities.map((e) => [e.id, e]))
  const boxes: { entityId: string; rect: FrameRect }[] = []
  const intruders: SafeZoneIntruder[] = []
  const clipped: FrameRect[] = []
  for (const es of state.entities) {
    const entity = byId.get(es.entityId)
    if (!entity || !isSafeZoneSubject(entity)) continue
    const bounds = projectEntityBounds(
      entity,
      es,
      state.camera,
      aspect,
      measured?.get(entity.id)
    )
    if (!bounds) continue
    boxes.push({ entityId: entity.id, rect: bounds })
    const hit = intersect(bounds, rect)
    if (!hit) continue
    clipped.push(hit)
    intruders.push({
      entityId: entity.id,
      name: entity.label?.text || entity.name,
      coverage: area(hit) / area(rect)
    })
  }
  intruders.sort((a, b) => b.coverage - a.coverage || a.entityId.localeCompare(b.entityId))
  const covered = unionArea(clipped) / area(rect)
  return {
    rect,
    negativeSpace: clamp01(1 - covered),
    intruders,
    boxes
  }
}

/**
 * Worst negative space across the shot, and when it happens. A still only ever
 * needs one instant, but a shot whose zone is clear at t=0 and blocked at t=3
 * would otherwise be reported as safe. Sampling at the shot's own fps matches
 * what actually gets rendered.
 */
export function worstSafeZone(
  scene: Scene,
  shot: Shot,
  evaluate: (t: number) => ShotState,
  measured?: Map<string, WorldBox>
): { report: SafeZoneReport; time: number } | null {
  if (!resolveSafeZone(shot.safeZone)) return null
  const frames = Math.max(1, Math.round(shot.duration * shot.fps))
  let worst: { report: SafeZoneReport; time: number } | null = null
  for (let i = 0; i < frames; i++) {
    const t = i / shot.fps
    const report = analyzeSafeZone(scene, shot, evaluate(t), measured)
    if (!report) return null
    if (!worst || report.negativeSpace < worst.report.negativeSpace) worst = { report, time: t }
  }
  return worst
}

/**
 * The sentence handed to an image model. Names the region in words, because a
 * generator cannot read a rect, and states the intent (clean space for text)
 * rather than just "keep it empty", which models tend to read as "put
 * something small there".
 */
export function safeZonePhrase(zone: SafeZone | undefined | null): string | null {
  const rect = resolveSafeZone(zone)
  if (!zone || !rect) return null
  const where =
    zone.preset === 'custom'
      ? describeCustomRect(rect)
      : SAFE_ZONE_PHRASES[zone.preset as Exclude<SafeZonePresetId, 'custom'>]
  return `Reserve ${where} as clean, uncluttered negative space for headline text: keep subjects, edges and high-contrast detail out of it.`
}

/** Plain-English placement for a custom rect, so the prompt reads naturally. */
export function describeCustomRect(rect: FrameRect): string {
  const pct = Math.round(rect.w * rect.h * 100)
  const midX = rect.x + rect.w / 2
  const midY = rect.y + rect.h / 2
  const horizontal = midX < 0.4 ? 'left' : midX > 0.6 ? 'right' : 'centre'
  const vertical = midY < 0.4 ? 'upper' : midY > 0.6 ? 'lower' : 'middle'
  // A full-width or full-height zone reads better named on its long axis
  // alone: "the upper area" beats "the upper centre area" for a top band.
  if (rect.w > 0.9) return `the ${vertical} area of the frame (${pct}% of it)`
  if (rect.h > 0.9) return `the ${horizontal} area of the frame (${pct}% of it)`
  return `the ${vertical} ${horizontal} area of the frame (${pct}% of it)`
}
