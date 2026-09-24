# Modifications

This distribution is derived from Blockout by Sam Wasserman and retains the
original `LICENSE`, `NOTICE`, credits, and citation metadata.

Frozen upstream base: `6a85105101a0504e38c330b0caae010c957b2321`.

Portable desktop work added in 2026, contributed by
**Gumbii Digital** ([github.com/GumbiiDigital](https://github.com/GumbiiDigital)):

- Windows 11 x64 packaging with a per-user NSIS installer and native window chrome.
- Portable project-relative paths, Windows-safe filenames, and cross-platform UI labels.
- Shared platform configuration and FFmpeg discovery with deterministic asset checks.
- Versioned local-control discovery compatible with existing unversioned descriptors.
- Process-tree-aware export cancellation and cross-platform FFmpeg concat files.
- Windows/macOS/Linux CI, packaging provenance, third-party notices, and SBOM generation.

AlchemyWorx internal fork changes (2026), by **AlchemyWorx**:

- Opt-in software rendering (`src/shared/software-gl.ts`, two lines in
  `src/main/index.ts`). When `BLOCKOUT_SOFTWARE_GL` is set to a truthy value the
  main process appends ANGLE/SwiftShader Chromium switches before `ready`, so
  the app runs on hosts with no GPU (headless Linux containers, GPU-less CI
  images) where Chromium otherwise fails WebGL context creation with
  "BindToCurrentSequence failed". Default off: an unset variable leaves launch
  behaviour byte-for-byte unchanged. Software and hardware backends are not
  guaranteed pixel-identical to each other, so golden frames must not be
  compared across the two.
- Imported-model correctness in `src/renderer/viewport/SceneManager.ts` and
  `src/renderer/export/exporter.ts`: custom GLB/glTF loads are tracked and
  awaited before any export renders, loads start when `sourceFile` is attached
  rather than only at visual creation, and `GLTFLoader.parse` reports errors
  instead of leaving a promise pending. `.obj` removed from the import picker
  in `src/renderer/panels/Library.tsx`, since only `GLTFLoader` is wired.
- Generic parametric product system (new: `src/engine/products.ts`,
  `src/engine/products.json`, `src/renderer/viewport/product-builder.ts`,
  `src/main/products.ts`). Products are data presets resolved by a pure engine
  module into metre-space primitives; three archetypes, optional hinged
  doors/lids, attachable parts, and compound multi-piece presets. Projects may
  override or add presets from their own `products/` folder. Upstream files
  touched: `assets.ts` (catalog derives product specs), `builders.ts` (one
  dispatch branch), `Library.tsx`, `Inspector.tsx`, `store.ts`,
  `SceneManager.ts` (scale-aware grid, gizmo snap and camera near planes),
  `src/main/index.ts` and `src/preload/index.ts` (one IPC each).
- Staging props and sets for product stills (`src/engine/assets.ts`,
  `src/renderer/viewport/builders.ts`): a security tray, a standalone overhead
  bin, a vanity counter and an extruded seamless studio sweep. `buildProp` and
  `buildEnv` now take the entity's `params`, and `env.planeCabin` accepts
  `params.bins = 'open'` to lift its bin doors; the bin geometry itself is
  shared between the kit and the standalone prop rather than duplicated.
- Full static entity pose (new: `src/engine/transform.ts`,
  `src/renderer/viewport/ground-lift.ts`). Upstream entities were upright and
  uniformly scaled: one `rotationY` for heading, one `scale` number. Staging a
  product needs a carry-on laid on its side and a proxy corrected in one axis,
  so `Transform` gains optional `rotationX`, `rotationZ` and a per-axis
  `stretch`. Two deliberate constraints: `rotationY` remains the heading field
  (rotation is applied in YXZ order, so the roughly thirty call sites reading it
  as facing keep their meaning), and `scale` remains the single real-world size
  multiplier that `entityHeight` and auto-framing consume, with per-axis
  correction separate. All three fields are optional and an identity value
  serializes to absent, so pre-fork projects migrate to the identity pose and
  round-trip without gaining keys. Because assets are built with their origin at
  ground level, a tilt is followed by a ground-contact lift applied to the
  rendered object only; the document keeps the clean value. Upstream files
  touched: `types.ts` (three optional fields), `schema.ts` (additive migration),
  `SceneManager.ts` (pose on both the sync and the per-frame evaluator path,
  unconstrained rotate gizmo plus a scale mode, `S` shortcut),
  `Inspector.tsx` (pitch/yaw/roll fields, numeric scale, per-axis stretch with a
  proportions lock, replacing a slider clamped 0.3 to 3.0),
  `Viewport.tsx` (Scale button), `export/gltf.ts` (same pose in the Blender
  handoff), `control/handler.ts` (MCP reads and writes the pose).
- AW build documentation under `docs/HANDOFF.md`.

Downstream distributors should append their own branding and behavioral changes
to this file rather than replacing the original attribution.

Every upstream file changed by this port and capable of carrying comments has
a prominent first-lines notice pointing back to this manifest. The following
changed structured/generated files cannot accept comments without invalidating
their format, so this manifest is their file-level change notice:

- `package.json`
- `package-lock.json`
- `tsconfig.json`
- `tsconfig.node.json`

New binary and structured release artifacts are likewise identified here:
`build/icon.ico` and `ASSET_MANIFEST.json`. Patch inputs retain their exact
patch syntax and are documented by path under `third_party/ffmpeg/`.

A stable or commercial distribution remains gated on upstream/trademark
permission, platform code signing/notarization, a final FFmpeg/H.264
distribution review, and the ordinary complete third-party compliance review.
