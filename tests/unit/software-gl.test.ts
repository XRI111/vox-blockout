/**
 * AW fork: the opt-in software-GL switch must stay opt-in. A launch that did
 * not ask for SwiftShader has to come back with an empty switch list, or a
 * stray env var would silently downgrade real renders.
 */

import { describe, it, expect } from 'vitest'
import { SOFTWARE_GL_ENV, isSoftwareGlEnabled, softwareGlSwitches } from '../../src/shared/software-gl'

const env = (value?: string): NodeJS.ProcessEnv =>
  (value === undefined ? {} : { [SOFTWARE_GL_ENV]: value }) as NodeJS.ProcessEnv

describe('software GL opt-in', () => {
  it('is off when the variable is unset', () => {
    expect(isSoftwareGlEnabled(env())).toBe(false)
    expect(softwareGlSwitches(env())).toEqual([])
  })

  it('stays off for empty and falsey spellings', () => {
    for (const v of ['', ' ', '0', 'false', 'no', 'off', 'maybe']) {
      expect(isSoftwareGlEnabled(env(v))).toBe(false)
      expect(softwareGlSwitches(env(v))).toEqual([])
    }
  })

  it('turns on for the documented truthy spellings, case and space insensitive', () => {
    for (const v of ['1', 'true', 'TRUE', ' yes ', 'On']) {
      expect(isSoftwareGlEnabled(env(v))).toBe(true)
    }
  })

  it('emits the exact switch set that brings WebGL up without a GPU', () => {
    expect(softwareGlSwitches(env('1'))).toEqual([
      { name: 'use-gl', value: 'angle' },
      { name: 'use-angle', value: 'swiftshader' },
      { name: 'enable-unsafe-swiftshader' },
      { name: 'disable-gpu-sandbox' }
    ])
  })
})
