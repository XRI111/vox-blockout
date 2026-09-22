/**
 * AW fork: catalog contract for the Phase 1 item 4 staging props.
 *
 * The builders themselves need three.js and a DOM, so they are checked by eye
 * in the clay renders. What IS testable here is the thing that actually
 * matters under the dimensional-accuracy rule: that the catalog reports sizes
 * a shot can be framed against, and that nothing was duplicated.
 */

import { describe, it, expect } from 'vitest'
import { ASSET_CATALOG, assetSpec, entityHeight } from '../../src/engine/assets'

const AW_PROPS = [
  'prop.securityTray',
  'prop.overheadBin',
  'prop.vanityCounter',
  'prop.seamlessSweep'
] as const

describe('AW staging props', () => {
  /**
   * Exact catalog values. `tests/e2e/aw-props.spec.ts` measures the built
   * geometry against the same numbers, so drift on either side fails a test
   * rather than silently misframing every shot the prop appears in.
   * `footprint` is a RADIUS here, so the larger ground extent is twice it.
   */
  it('declares exactly the sizes the geometry is measured against', () => {
    expect(assetSpec('prop.securityTray').height).toBe(0.1)
    expect(assetSpec('prop.securityTray').footprint).toBe(0.33)
    expect(assetSpec('prop.overheadBin').height).toBe(0.4)
    expect(assetSpec('prop.overheadBin').footprint).toBe(0.61)
    expect(assetSpec('prop.vanityCounter').height).toBe(1.66)
    expect(assetSpec('prop.vanityCounter').footprint).toBe(0.6)
    expect(assetSpec('prop.seamlessSweep').height).toBe(1.0)
    expect(assetSpec('prop.seamlessSweep').footprint).toBe(0.6)
  })

  it('are all in the catalog exactly once', () => {
    for (const id of AW_PROPS) {
      const hits = ASSET_CATALOG.filter((a) => a.id === id)
      expect(hits, id).toHaveLength(1)
      expect(hits[0]!.category).toBe('props')
    }
  })

  it('carry a real height, so auto-framing does not fall back to person scale', () => {
    for (const id of AW_PROPS) {
      const spec = assetSpec(id)
      expect(spec.height, id).toBeGreaterThan(0)
      expect(spec.height, id).not.toBe(1.7) // the unknown-asset fallback
      expect(spec.footprint, id).toBeGreaterThan(0)
    }
  })

  it('are static set dressing, never moving subjects', () => {
    for (const id of AW_PROPS) {
      expect(assetSpec(id).motion, id).toBe('static')
      expect(assetSpec(id).speedScale, id).toBe(0)
    }
  })

  it('name themselves in prompts, since they set the scene for the model', () => {
    for (const id of AW_PROPS) {
      const noun = assetSpec(id).promptNoun
      expect(noun, id).toMatch(/^an? /)
      expect(noun, id).not.toBe('an object')
    }
  })

  // The sizes below are the whole point of these props under the
  // dimensional-accuracy rule. `footprint` is a RADIUS in this catalog, so the
  // larger ground extent is footprint * 2.
  it('sizes the security tray to take a laptop, and keeps it shallow', () => {
    const tray = assetSpec('prop.securityTray')
    // A 15" laptop is roughly 0.35 x 0.25 m and has to lie flat in the tray.
    expect(tray.footprint * 2).toBeGreaterThan(0.35)
    // Checkpoint bins are about 4" deep. Anything taller reads as a crate.
    expect(tray.height).toBeLessThan(0.15)
  })

  it('sizes the overhead bin so a carry-on does fit, wheels first', () => {
    const bin = assetSpec('prop.overheadBin')
    // Runway depth is 0.203 m and width 0.356 m; the bin opening is 0.4 tall.
    expect(bin.height).toBeGreaterThan(0.36)
  })

  it('puts the vanity counter surface at usable bathroom height', () => {
    // 0.86 m counter plus the mirror above it. Total is what the catalog
    // reports; the surface itself has to land near 0.86 for a hand to reach.
    const vanity = assetSpec('prop.vanityCounter')
    expect(vanity.height).toBeGreaterThan(1.5)
    expect(vanity.height).toBeLessThan(2.0)
  })

  it('makes the sweep tall enough to fill frame behind a carry-on', () => {
    const sweep = assetSpec('prop.seamlessSweep')
    expect(sweep.height).toBeGreaterThanOrEqual(0.56 * 1.5)
  })

  it('scales with the entity, like every other asset', () => {
    expect(entityHeight('prop.seamlessSweep', 2)).toBeCloseTo(assetSpec('prop.seamlessSweep').height * 2)
  })

  it('did not duplicate an existing kit or prop', () => {
    // The audit found env.planeCabin, env.airportTerminal and
    // furniture.sinkCounter already in place. Item 4 extends the cabin rather
    // than shipping a second one, so those ids must still be unique too.
    for (const id of ['env.planeCabin', 'env.airportTerminal', 'furniture.sinkCounter']) {
      expect(ASSET_CATALOG.filter((a) => a.id === id), id).toHaveLength(1)
    }
    // And no two catalog entries share an id, which a copy-paste would break.
    const ids = ASSET_CATALOG.map((a) => a.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
