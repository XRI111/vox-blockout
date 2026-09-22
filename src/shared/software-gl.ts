/**
 * AlchemyWorx fork addition — opt-in software rendering. See MODIFICATIONS.md.
 *
 * Headless Linux containers (cloud agent sessions, GPU-less CI images) have no
 * `/dev/dri`, so Chromium picks Mesa llvmpipe through ANGLE and then fails to
 * bind it: "Could not create a WebGL context … BindToCurrentSequence failed".
 * `new THREE.WebGLRenderer()` throws in the SceneManager constructor and the
 * app never leaves the welcome screen, which makes `npm run smoke` — the repo's
 * definition of done for engine and export changes — impossible to run there.
 *
 * Setting BLOCKOUT_SOFTWARE_GL=1 switches ANGLE to its bundled SwiftShader
 * backend, which needs no GPU. It is OFF by default: a normal desktop launch
 * is byte-for-byte unaffected, and nobody gets software rendering by accident.
 *
 * Renderer output is NOT guaranteed to match hardware GL pixel-for-pixel, so
 * golden-frame comparisons must not mix the two. Determinism *within* one
 * backend still holds, which is what the smoke suite's byte-identical check
 * asserts.
 *
 * Pure and DOM-free so both TS projects can import it and tests/unit can
 * exercise the parsing without Electron.
 */

/** Environment variable that opts a launch into software rendering. */
export const SOFTWARE_GL_ENV = 'BLOCKOUT_SOFTWARE_GL'

/** A Chromium command-line switch; `value` omitted for boolean flags. */
export interface ChromiumSwitch {
  name: string
  value?: string
}

/**
 * Truthy spellings accepted for the env flag. Anything else, including unset,
 * an empty string, '0' and 'false', leaves hardware GL alone — the safe
 * default, since a typo must never silently downgrade a real render.
 */
const TRUTHY = new Set(['1', 'true', 'yes', 'on'])

export function isSoftwareGlEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env[SOFTWARE_GL_ENV]
  return typeof raw === 'string' && TRUTHY.has(raw.trim().toLowerCase())
}

/**
 * The switches to append before Electron's `ready` event, or an empty list
 * when software GL is not requested. Verified as the minimal set that brings
 * WebGL 2.0 up in a GPU-less container; dropping any one of them reproduces
 * the BindToCurrentSequence failure.
 */
export function softwareGlSwitches(env: NodeJS.ProcessEnv = process.env): ChromiumSwitch[] {
  if (!isSoftwareGlEnabled(env)) return []
  return [
    { name: 'use-gl', value: 'angle' },
    { name: 'use-angle', value: 'swiftshader' },
    { name: 'enable-unsafe-swiftshader' },
    { name: 'disable-gpu-sandbox' }
  ]
}
