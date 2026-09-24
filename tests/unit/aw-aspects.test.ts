/**
 * AW fork: the three added delivery ratios and the custom export width.
 *
 * The audit found three files each keeping their own copy of the aspect list,
 * with the MCP validator's copy able to reject an aspect the UI offered. The
 * first block here exists to make that class of drift fail a test rather than
 * fail silently at runtime.
 *
 * The export-dims block pins the rule that matters for the pilot: height
 * follows the shot's aspect. An email hero is specified by width, and the
 * exported pixels have to be the framing the viewport showed.
 */

import { describe, it, expect } from 'vitest'
import { ASPECT_IDS, ASPECT_RATIOS, isAspectId, verticalFov } from '@engine/camera'
import { BUILTIN_PROFILES, getProfile } from '@engine/profiles'
import {
  CUSTOM_WIDTH_MAX,
  CUSTOM_WIDTH_MIN,
  clampCustomWidth,
  exportDims,
  isCustomResolution,
  resolutionLabel
} from '../../src/renderer/export/exporter'
import type { AspectId } from '@engine/types'

describe('the aspect set', () => {
  it('carries the three ratios the pilot shot list needs', () => {
    // 2:1 for the email hero, 3:2 for the promo frame, 4:5 for the portrait
    // social slot — shots 1, 2 and 3 of the pilot list.
    expect(ASPECT_RATIOS['2:1']).toBe(2)
    expect(ASPECT_RATIOS['3:2']).toBeCloseTo(1.5)
    expect(ASPECT_RATIOS['4:5']).toBeCloseTo(0.8)
  })

  it('reaches all four confirmed email hero sizes at a 600px content width', () => {
    // AW's email spec, confirmed 2026-09-23: 600 wide, heroes up to 500 tall.
    // These four sizes are the deliverable, so each has to be one preset away
    // rather than something a designer arrives at by arithmetic.
    const image = getProfile('gpt-image-2')
    expect(exportDims(image, '6:5', { widthPx: 600 })).toEqual({ width: 600, height: 500 })
    expect(exportDims(image, '3:2', { widthPx: 600 })).toEqual({ width: 600, height: 400 })
    expect(exportDims(image, '2:1', { widthPx: 600 })).toEqual({ width: 600, height: 300 })
    expect(exportDims(image, '12:5', { widthPx: 600 })).toEqual({ width: 600, height: 250 })
  })

  it('doubles cleanly, because the spec says design at 2x for retina', () => {
    const image = getProfile('gpt-image-2')
    expect(exportDims(image, '6:5', { widthPx: 1200 })).toEqual({ width: 1200, height: 1000 })
    expect(exportDims(image, '12:5', { widthPx: 1200 })).toEqual({ width: 1200, height: 500 })
  })

  it('keeps 12:5 distinct from 2.39:1, which is a different ratio', () => {
    // The cinema ratio is close enough to look interchangeable and is not: at
    // 600 wide it gives 251, which evens to 252 and misses the spec by 2px.
    expect(ASPECT_RATIOS['12:5']).toBeCloseTo(2.4)
    expect(ASPECT_RATIOS['12:5']).not.toBeCloseTo(ASPECT_RATIOS['2.39:1'], 2)
    const image = getProfile('gpt-image-2')
    expect(exportDims(image, '2.39:1', { widthPx: 600 }).height).not.toBe(250)
  })

  it('never reports a hero taller than the spec allows at 600 wide', () => {
    // Heroes cap at 500 tall. Any ratio at or above 6:5 satisfies that, and the
    // ones below it are the social slots, not heroes.
    const image = getProfile('gpt-image-2')
    for (const a of ['6:5', '3:2', '2:1', '12:5'] as AspectId[]) {
      expect(exportDims(image, a, { widthPx: 600 }).height, a).toBeLessThanOrEqual(500)
    }
  })

  it('lists every ratio exactly once, widest to tallest', () => {
    // The ordering is what the UI pickers render, so it is part of the
    // contract rather than incidental.
    expect(new Set(ASPECT_IDS).size).toBe(ASPECT_IDS.length)
    const ratios = ASPECT_IDS.map((a) => ASPECT_RATIOS[a])
    expect([...ratios].sort((a, b) => b - a)).toEqual(ratios)
  })

  it('has no id in the table that the list forgets, or the reverse', () => {
    // This is the drift test. Three files used to keep separate copies and the
    // MCP validator's copy could reject an aspect the UI already offered.
    expect([...ASPECT_IDS].sort()).toEqual(Object.keys(ASPECT_RATIOS).sort())
  })

  it('narrows an untrusted string', () => {
    expect(isAspectId('4:5')).toBe(true)
    expect(isAspectId('5:4')).toBe(false)
    expect(isAspectId('')).toBe(false)
    expect(isAspectId(undefined)).toBe(false)
    // Prototype keys must not read as valid ids.
    expect(isAspectId('toString')).toBe(false)
    expect(isAspectId('constructor')).toBe(false)
  })

  it('gives every ratio a usable field of view', () => {
    // A ratio missing from the table would surface here as NaN rather than as
    // a blank export nobody traced back.
    for (const a of ASPECT_IDS) {
      const fov = verticalFov('super35', 35, a)
      expect(Number.isFinite(fov), a).toBe(true)
      expect(fov, a).toBeGreaterThan(0)
    }
  })
})

describe('generator profiles', () => {
  it('offers the new ratios on image models, which is the AW path', () => {
    for (const p of BUILTIN_PROFILES.filter((x) => x.kind === 'image')) {
      // Every email hero size plus the portrait social slot.
      for (const a of ['12:5', '2:1', '3:2', '6:5', '4:5']) {
        expect(p.aspects, `${p.id}:${a}`).toContain(a)
      }
    }
  })

  it('does NOT claim video models took them', () => {
    // Deliberate: the export package tells a downstream operator what the
    // model accepts. Advertising 4:5 on Veo would be a lie the package carries.
    for (const p of BUILTIN_PROFILES.filter((x) => x.kind === 'video')) {
      expect(p.aspects, p.id).not.toContain('4:5')
    }
  })

  it('only ever names a real aspect', () => {
    for (const p of BUILTIN_PROFILES) {
      for (const a of p.aspects) expect(isAspectId(a), `${p.id}:${a}`).toBe(true)
    }
  })
})

describe('export dimensions', () => {
  const image = getProfile('gpt-image-2')

  it('pins an exact width and derives height from the aspect', () => {
    // The headline case: a 1200-wide 2:1 email hero.
    expect(exportDims(image, '2:1', { widthPx: 1200 })).toEqual({ width: 1200, height: 600 })
  })

  it('handles the portrait ratios the same way', () => {
    expect(exportDims(image, '4:5', { widthPx: 1080 })).toEqual({ width: 1080, height: 1350 })
    expect(exportDims(image, '9:16', { widthPx: 1080 })).toEqual({ width: 1080, height: 1920 })
  })

  it('keeps both edges even, because h264 requires it', () => {
    for (const a of ASPECT_IDS) {
      const d = exportDims(image, a, { widthPx: 1201 })
      expect(d.width % 2, a).toBe(0)
      expect(d.height % 2, a).toBe(0)
    }
  })

  it('clamps a width the GPU could not render', () => {
    // Past the driver's max renderbuffer the canvas yields a blank or
    // truncated frame with no error, which is worse than a clamp.
    expect(clampCustomWidth(999_999)).toBe(CUSTOM_WIDTH_MAX)
    expect(clampCustomWidth(1)).toBe(CUSTOM_WIDTH_MIN)
    expect(clampCustomWidth(Number.NaN)).toBe(1200)
    expect(exportDims(image, '16:9', { widthPx: 999_999 }).width).toBe(CUSTOM_WIDTH_MAX)
  })

  it('leaves auto and the pinned short edges exactly as they were', () => {
    // Regression guard: this change must not move any existing export size.
    expect(exportDims(image, '16:9', '720p')).toEqual({ width: 1280, height: 720 })
    expect(exportDims(image, '9:16', '720p')).toEqual({ width: 720, height: 1280 })
    expect(exportDims(image, '16:9', 'auto').width).toBe(1536)
  })

  it('recognises and labels a custom resolution', () => {
    expect(isCustomResolution({ widthPx: 800 })).toBe(true)
    expect(isCustomResolution('auto')).toBe(false)
    expect(resolutionLabel('720p')).toBe('720p')
    expect(resolutionLabel({ widthPx: 1200 })).toBe('custom 1200px wide')
  })

  it('produces a sane size for every ratio at a typical hero width', () => {
    for (const a of ASPECT_IDS) {
      const d = exportDims(image, a as AspectId, { widthPx: 1200 })
      expect(d.width, a).toBe(1200)
      expect(d.height, a).toBeGreaterThan(0)
      expect(Number.isFinite(d.height), a).toBe(true)
    }
  })
})
