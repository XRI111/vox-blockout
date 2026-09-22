# AW Previs Fork: Build Handoff
**Location in repo:** `docs/aw/HANDOFF.md` | **Created:** 2026-09-21 | **Owner:** Stephane Gringer (Fractional CMO, AlchemyWorx)
**Status line (keep current):** Baselined and audited 2026-09-22, all gates green. Scope changed the same day: dimensional accuracy over product fidelity, generic archetypes over product-specific code. Phase 1 rewritten to 7 items, building items 1 to 3 now, stopping after 3 for Stephane's review of the clay stills.

This is a living document. Claude Code: read it at the start of every session, and update the Status Log at the bottom the moment anything runs, ships, or breaks, with an honest status ("built, untested", "smoke passing", "blocked on X"). One source of truth: edit sections in place, don't append duplicates.

## TL;DR
This repo is Stephane's fork of `wassermanproductions/blockout` (Apache-2.0, Electron + TypeScript). We are turning it into an internal AlchemyWorx (AW) tool so designers and motion people can stage a real-scale product in a grey-box scene, frame it with real lens math and headline-safe negative space, and export clay/depth/normal passes plus a model-tailored prompt for image and video generators. No Blender. First pilot: Biaggi (AW client) Runway Hardside Hybrid Carry On, product and lifestyle stills framed for email headlines.

## Goal and success condition
AW's email work for Biaggi has been using a mix of products because good product shots don't exist. Current promotions center on Zipcubes (packing cubes). This tool fills that gap: new angles and lifestyle frames we can't get from existing photography, composed for headline copy.

The pilot succeeds when:
1. A set of Runway (with Zipcubes where relevant) hero and lifestyle stills, generated from this tool's references, is good enough that an AW email designer drops a headline on it without recomposing.
2. A non-3D AW team member reproduces one shot from a blank project in under 30 minutes, either through the UI or by telling Claude Code to drive the app over the bundled MCP.

## Recommended Claude Code setup
- **Default: Opus 5 at `high` effort.** Launch with `claude --model opus --effort high`. This work spans a deterministic engine, export pipeline, and UI across many files; it needs strong planning, not speed.
- **Step up to `xhigh`** for the engine/export work: product import that must render into exports, stills export, anything touching `src/engine/` and byte-determinism.
- **Step down to Sonnet 5 at `medium`** for mechanical work: lighting/set presets, generator profile config, copy, docs, UI polish once the pattern is set.
- Effort is set per session with `/effort` or `--effort`. Switching models can reset it, so check `/model` after any switch.
- If Stephane's plan includes Fable 5.1 and Opus 5 stalls on the engine architecture, that is the escalation path. Don't default to it.

## Upstream context to read first (in order)
`AGENTS.md`, `CLAUDE.md`, `docs/DESIGN.md`, `docs/ROADMAP.md`, `mcp/README.md`, `NOTICE`, `MODIFICATIONS.md`. Upstream's instructions govern how to build and test this codebase; this file governs what we're building and why. If they conflict, stop and ask Stephane.

Key upstream facts this plan depends on:
- Deterministic core lives in `src/engine/`: pure TypeScript, no DOM, unit-tested. `state(t)` is a pure function shared by playback, video export, stills, and glTF baking. Preserve this.
- Library assets are all procedurally generated in code.
- Gaussian-splat / photogrammetry scan imports are editor-only and never touch the export.
- Generator profiles are data-driven (durations, resolutions, reference modes, prompt templates). Adding a generator is a config edit.
- Bundled MCP server (33 tools) lets Claude Code drive the running app.
- Existing: real sensors/lenses, aspect masks, 9 lighting presets, 50+ environment kits, depth/normal passes, stills at camera marks, `.glb` Blender handoff.

## Next Action
1. Read the upstream files above.
2. `npm install`, `npm run dev` (Node 22+), then `npm run smoke`. Record pass/fail and machine details in the Status Log.
3. Register the MCP: `claude mcp add blockout -- node <ABSOLUTE_PATH_TO_REPO>/mcp/blockout-mcp.mjs`
4. **Gap audit, report before building.** Verify in `src/`, don't assume:
   - Can an arbitrary `.glb`/`.gltf` be imported at true scale and render into exported video and stills? (Expect no.)
   - Still-frame export: arbitrary resolution? Per-mark only or current frame?
   - Aspect mask system: can it take custom ratios?
   - Do generator profiles support image-only models, or only video?
   - Which existing environment kits and props cover: airport terminal, security line/bins, jet bridge, aircraft cabin with overhead bins, hotel room, car trunk, curbside, seamless studio?
5. Write the audit as a short section in this file (replace "Audit results: pending" below), propose any Phase 1 scope changes, and stop for Stephane's go-ahead.

## Audit results

Run 2026-09-22 on the `aw/baseline` branch against commit `e7b12f1`. Every claim below cites the file
and line range it was read from. Anything not verified in `src/` is marked unverified.

### Baseline: what runs

| Gate | Result |
|---|---|
| `npm install` | Clean, exit 0. Node 22.22.2, npm 10.9.7, Linux x86_64 container, no GPU, no display. |
| `npm run typecheck` | Green (both TS projects). |
| `npm run lint` | Green, zero warnings. |
| `npm test` | Green. 886 tests across 14 files, 1.9s. |
| `npm run dev` | Boots to the welcome screen under Xvfb. The 3D viewport does not initialise (see below). |
| `npm run smoke` | **Green, 6/6, after a container workaround.** Fails out of the box here. |

Two environment problems, both container-side, neither a code defect:

1. **No ffmpeg.** Not on `PATH` and not vendored for Linux. Installed ffmpeg/ffprobe 6.1.1 from apt.
   The resolution order in `src/main/ffmpeg.ts` falls through to `ffmpeg` on `PATH` on Linux, so that
   is enough. On Stephane's Mac, `brew install ffmpeg` per `AGENTS.md`.
2. **No WebGL.** Chromium picks Mesa llvmpipe through ANGLE and fails with
   `BindToCurrentSequence failed`, so `new THREE.WebGLRenderer()` throws in `SceneManager`'s
   constructor and the app never leaves the welcome screen. There is no `/dev/dri` in the container.
   Forcing ANGLE/SwiftShader on the Electron main process fixes it and the whole smoke suite passes,
   including the real ffmpeg export and the byte-determinism check:

   ```
   ✓ app boots to the welcome screen
   ✓ creates a project and stages a scene through real UI actions
   ✓ choreographs marks, labels, and camera; project round-trips to disk
   ✓ playback advances deterministic state
   ✓ rendering is deterministic: same t → byte-identical frames
   ✓ exports a real package: video + stills + prompt + metadata
   6 passed (1.3m)
   ```

   I proved this by patching the **built artifact** (`out/main/index.js`), not the source, and reverted
   it. `ELECTRON_EXTRA_LAUNCH_ARGS` is ignored by this Electron build, and the smoke spec hardcodes its
   launch args, so there is no env-only way in. **Recommendation:** add an env-gated
   `app.commandLine.appendSwitch('use-angle', 'swiftshader')` to `src/main/index.ts` behind something
   like `BLOCKOUT_SOFTWARE_GL=1`. Roughly five lines, upstream-mergeable, logged in `MODIFICATIONS.md`.
   Upstream CI is not affected either way: `.github/workflows/ci.yml:27-66` runs the Playwright specs
   on `macos-14` and `windows-2022` native runners, where GL works. The switch is for headless Linux
   containers, which is where every cloud Claude Code session runs. Without it, no such session can run
   `npm run smoke`, which is the repo's own definition of done for engine and export changes. Not done
   yet, waiting on your go-ahead.

### MCP: registered and driving the app

`claude mcp add blockout -- node /home/user/vox-blockout/mcp/blockout-mcp.mjs` succeeded and reports
`blockout: ... - ✓ Connected`. I then launched the built app and drove it through the bridge over real
stdio JSON-RPC:

- `initialize` returned `{"name":"blockout","version":"1.0.0"}`.
- `tools/list` returned **34** tools. `AGENTS.md` and `mcp/README.md` both say 33. Minor doc drift, not
  a defect.
- `get_state` returned the live project, scene, shot and conventions string.
- `add_entity {assetId: "prop.suitcase", x: 0, z: -2, label: "RUNWAY"}` placed the entity, and a second
  `get_state` showed it in the scene with its label. Round trip confirmed.

Success condition 2 in the TL;DR (an AW team member drives the app by telling Claude Code what they
want) is technically live today.

### Gap audit

**1. Can an arbitrary `.glb`/`.gltf` be imported at true scale and render into exports?**

It imports and it renders. It does not do true scale, and it does not do clay.

- *Import path works.* `Library.tsx:702-727` picks the file, `src/main/index.ts:156-164`
  (`project:importAsset`) copies it into `<project>/assets/` and returns a project-relative path, which
  is stored on `Entity.sourceFile` (`src/engine/types.ts:84`). Projects stay portable, so handoff item
  1's storage requirement is already met.
- *It does reach the exports.* `SceneManager.addEntityVisual` (`SceneManager.ts:544-556`) calls
  `loadCustomModel`, which parses with `GLTFLoader` and adds the result into the entity's root group
  (`SceneManager.ts:558-580`). That group lives in `this.scene`, and `renderFrameAt`
  (`SceneManager.ts:2371-2464`) renders `this.scene` for every pass. Imported models are **not** in the
  editor-only exclusion list that hides Gaussian scans (`SceneManager.ts:2383-2385`). The handoff
  expected "no" here. The answer is yes.
- *True scale: no.* Scale is one uniform multiplier on `Entity.transform.scale`
  (`types.ts:78`), exposed only as a slider clamped to 0.3 to 3.0 with no numeric field
  (`Inspector.tsx:663-676`). No unit declaration, no inches or cm entry, no bounding-box measurement
  after load. A GLB authored in centimetres lands 100x oversize and the slider cannot correct it.
- *Ground snap: yes.* `snapSelectionToGround` (`SceneManager.ts:1328-1360`) raycasts from a real
  `Box3` of the loaded object, so it snaps actual geometry.
- *But the metadata is wrong.* An unrecognised asset id degrades to a person-scale box, height 1.7 m,
  footprint 0.5 (`assets.ts:270-283`). That fallback is what auto-framing and label placement consume
  (`assets.ts:286-290`), so every shot-size preset misframes an imported product.
- *Clay override: does not exist.* The glTF keeps its own materials in the clean pass. Depth and
  normal passes override materials scene-wide (`SceneManager.ts:2417-2427`) so they are unaffected.
- *`.obj` is a broken promise.* The picker advertises `obj` (`Library.tsx:703`) but the only loader is
  `GLTFLoader` (`SceneManager.ts:565`). An `.obj` copies successfully, then fails to parse and toasts
  an error.
- *Race condition.* `loadCustomModel` is fire-and-forget (`SceneManager.ts:555`). Exporting right after
  opening a project can render frames before the model resolves. No test covers custom-model export.

**2. Still-frame export: arbitrary resolution? Per-mark only, or current frame?**

Per-mark and current-frame both exist. Arbitrary resolution does not.

- *Per-mark:* `exporter.ts:306-326` renders first frame, last frame, and one still per camera mark,
  plus a top-down diagram hardcoded at 1600x1600 (`exporter.ts:329`).
- *Current frame:* `exportStillAtPlayhead` (`exporter.ts:386-418`) writes one PNG at the playhead into
  `exports/<scene>/Shot-<name>/frames/`, wired to the "Export this frame (at playhead)" button
  (`DeliverPanel.tsx:186-207`).
- *Resolution is a three-way enum.* `ExportResolution = 'auto' | '720p' | '1080p'` (`exporter.ts:20`).
  `exportDims` (`exporter.ts:42-64`) derives width and height from the profile's `exportWidth` and the
  shot's aspect, evening both for h264. There is no arbitrary path. You cannot ask for 1200x600 today,
  and the ceiling anywhere is a 1920 long edge (video profiles) or 1536 (image profiles).

**3. Aspect masks: custom ratios?**

No. `AspectId` is a closed five-value union (`types.ts:67`), `ASPECT_RATIOS` is a
`Record<AspectId, number>` (`camera.ts:26-32`), and both UI lists enumerate the same five
(`Inspector.tsx:55`, `Viewport.tsx:17`). The MCP `set_shot` validates against a hardcoded copy of the
same list (`control/handler.ts:291`). Of the six ratios the build plan proposes, only **1:1 and 9:16
exist**. 2:1, 3:2 and 4:5 do not. Adding them touches the union, the ratio table, two UI lists, the
control handler, every profile's `aspects` array, and the migration in `schema.ts`.

Separately, the aspect *mask* is a viewport-only CSS overlay with a thirds grid and a 5% action-safe
box (`Viewport.tsx:540-588`). Nothing about it is exported.

**4. Generator profiles: image-only models, or video only?**

Image models are already first-class. `GeneratorProfile.kind` is `'video' | 'image'`
(`profiles.ts:17`), and four image profiles ship: GPT Image 2, Nano Banana, Ideogram, Krea 2
(`profiles.ts:129-169`), each with `refModes: ['stills']` and `exportWidth: 1536`. Adding one is a
config edit exactly as `docs/generator-profiles.md` claims.

Two caveats:

- The Deliver panel does not branch on `kind`. It lists all nine profiles in one dropdown
  (`DeliverPanel.tsx:83-87`), and the package export still runs the full MP4 pass loop
  (`exporter.ts:264-305`) even for an image profile, where the video is dead weight. The
  "Export this frame" button is the practical stills path, and it ignores the pass toggles entirely.
- `profiles.ts:5` claims users can drop profile JSON into a project `profiles/` folder. **Nothing in
  `src/` reads such a folder.** `getProfile(id, extra)` takes an `extra` array (`profiles.ts:162`) but
  every caller passes none. Treat that comment as aspirational.

**5. Environment and prop coverage for the pilot shot list**

205 catalog entries: 55 environment kits, 86 props (`src/engine/assets.ts`).

| Need | Status | Evidence |
|---|---|---|
| Airport terminal | **Have** | `env.airportTerminal` (`assets.ts:239`). Glass window wall with mullions, two back-to-back gate seating rows, four check-in desks, emissive departures board (`builders.ts:4958-4997`). |
| Security line / bins | **Missing** | No checkpoint, no X-ray, no bins anywhere. Nearest stand-ins: `prop.barrier`, `prop.crate`, `prop.trafficCone`, `furniture.counter`. |
| Jet bridge | **Missing** | Nothing in the catalog. |
| Aircraft cabin, overhead bins | **Have, but closed** | `env.planeCabin` (`assets.ts:208`) builds six rows of 2+2 seats, angled side walls, and overhead bins as solid boxes 0.6 m wide x 0.4 m tall at y=2.0 (`builders.ts:3802-3833`). They do not open. A 22x14x8 inch carry-on is 0.56 x 0.36 x 0.20 m, so shot 4 (sliding wheels-first into a bin) needs an open-bin variant, not the existing kit. |
| Hotel room | **Have, no luggage rack** | `env.hotelRoom` (`assets.ts:233`): bed, headboard, dresser, TV, desk, chair, curtain, bathroom partition (`builders.ts:4703-4743`). No rack. |
| Car trunk | **Missing** | Vehicles are closed shells. No `trunk`, `boot` or `tailgate` in `builders.ts` (the two hits are a tree trunk at 3869 and a chest at 2094). New geometry. |
| Curbside drop-off | **Partial** | `env.downtown`, `env.residentialStreet`, `env.gasStation`, `env.parkingLot` (`assets.ts:244-251`), plus `prop.busShelter`, `prop.parkingMeter`, `prop.trafficCone` (`assets.ts:193`). No purpose-built curb-with-open-door set, but closest to usable as-is. |
| Seamless studio / infinity cove | **Missing** | Nothing. `env.stage` is a theatrical stage with a raised platform, flat backdrop and two light trusses (`builders.ts:4347-4380`), not a cyc wall. Shots 1 and 6 both need this. |

Two adjacent finds worth keeping:

- **`prop.suitcase` is already a rolling bag.** 0.45 x 0.70 x 0.24 m body, torus pull handle at y=0.70,
  two wheels (`builders.ts:1785-1810`). Wrong proportions for the Runway (0.36 W x 0.56 H x 0.20 D) and
  it is hardcoded rather than parametric, but it is the right builder to clone for the luggage proxy.
- **Lighting is all location lighting.** Nine presets confirmed (`types.ts:37-48`, table at
  `SceneManager.ts:767-782`): day, golden hour, night, interior warm, interior cool, club, and three
  physical-sky presets. Zero product lighting. No soft top light, no window light, no seamless
  key/fill. Build-plan item 8 is genuinely new work, not an extension.

**6. Export package vs the Phase 1 spec** (not on the ask list, but it is the deliverable)

The plan asks for `clay.png`, `depth.png`, `normal.png`, `lineart.png`, `product_mask.png`,
`headline_safezone_mask.png`, `prompt.txt`, `metadata.json`. Today:

- `RenderPass` is `'clean' | 'depth' | 'normal'` (`SceneManager.ts:58`). **No lineart pass, no mask
  pass.** Both are new render paths.
- Depth and normal ship as MP4s only (`exporter.ts:264-305`). Per-mark stills are clean-pass only
  (`exporter.ts:321`). Getting depth and normal PNGs per mark is a loop change, not new rendering.
- `prompt.txt` exists (`exporter.ts:337`, `src/engine/prompt.ts`).
- `metadata.json` exists (`exporter.ts:154-207`) with shot name, duration, fps, aspect, sensor, rig,
  rig intensity, seed, every camera mark (position, pan and tilt in degrees, focal length, focus
  distance) and every subject's marks. **Two gaps for this pilot:** it only lists entities that have a
  blocking track (`exporter.ts:182-198`), so a static product with no marks does not appear at all; and
  it records neither the export resolution nor any safe-zone rect.

### Known issues found while building, not yet fixed

Found in passing during Phase 1 items 1 and 2. Neither is in the scope of the item that surfaced it,
so both are recorded rather than silently dropped.

- **The Blender handoff never contains imported models.** `exportGlb` (`export/gltf.ts:19-46`)
  rebuilds the scene from `buildAsset` rather than from the live SceneManager, so a custom GLB is
  replaced by its person-scale placeholder box in the `.glb` export. Separate code path from the
  render exports fixed in item 2. Low priority: the pilot is stills, and the Blender handoff is not on
  the AW path at all.
- **Two playhead stills in the same second overwrite each other.** `exportStillAtPlayhead`
  (`exporter.ts:409`) names the file from shot, playhead time and a second-resolution timestamp, so
  exporting the same frame twice inside one second silently replaces the first. Cost me a wrong test
  result before I spotted it. One-line fix whenever that file is next open.
- **`perf.spec.ts` cannot run under software GL.** It asserts 50 entities hold >50 fps and SwiftShader
  manages 2.4. Expected, not a regression: run it on a machine with a GPU. CI's `native-smoke` job
  does not include it.

### Proposed Phase 1 scope (superseded)

The scope I proposed here on 2026-09-22 was overridden by Stephane the same day. The gap audit above
still stands as evidence; the plan built on it does not. Two of its premises are gone:

- I wanted a fidelity spike to test whether a grey-box proxy could produce a Biaggi-accurate bag.
  **Product fidelity is not a goal.** Models get appearance from reference images, not geometry, so
  the question the spike would have answered does not need answering. Spike cut, image-to-3D cut.
- I scoped a parametric *luggage* proxy. **The system must be generic**, carrying luggage, cosmetics
  and odd-shaped appliances across AW clients with no product-specific code.

Live scope is the Build plan below.

## Build plan

### Phase 1: Product stills mode (required for the pilot)

**Governing constraint, owner decision 2026-09-22: dimensional accuracy, not product fidelity.**
Geometry exists to control real-world scale, silhouette, placement and composition. Product appearance
comes from reference images handed to the image model, never from the mesh. Nothing in Phase 1 chases
likeness, and "it doesn't look like the real product" is not a defect.

**Second constraint: no product-specific code paths.** The system has to carry luggage (Biaggi),
cosmetics (Laura Geller, Julep, near term) and appliances with odd proprietary shapes (Baby Brezza)
without a new builder per client. Products are data, not code.

Every new scene or timeline behavior goes through the engine pattern. Add Vitest coverage. Keep
`npm run smoke` green and exports byte-deterministic. One branch and one PR per item, built in this
order.

1. **Env-gated software-GL switch.** `app.commandLine.appendSwitch('use-angle', 'swiftshader')` in
   `src/main/index.ts` behind an env flag, default off so normal launches are untouched. Without it no
   headless Linux container can create a WebGL context, so no cloud agent session can run
   `npm run smoke`, which is the repo's own definition of done for engine and export work. Log the
   change in `MODIFICATIONS.md`.

2. **Await model loads before export and stills.** `loadCustomModel` is fire-and-forget today
   (`SceneManager.ts:555`), so an export can render frames before an imported GLB resolves. Make the
   export and stills paths wait, with a test that proves an imported GLB is present in frame 0. Also
   resolve `.obj`: the picker advertises it (`Library.tsx:703`) but only `GLTFLoader` exists. Pick
   whichever is smaller, wiring `OBJLoader` or dropping the extension, and say which in the PR.
   GLB import is the escape hatch for shapes the archetypes cannot cover, so it has to be solid.

3. **Generic parametric product system.** No product-specific code anywhere in it.
   - **Archetypes:** rounded box, capped cylinder, tapered tube. Each supports an optional hinged door
     or lid, and attachable parts: handle, wheels, feet, cap, pump.
   - **Compound products:** a preset can combine several archetypes at relative offsets into one
     selectable product, which is how odd shapes like a bottle warmer get covered.
   - **Presets are data:** JSON in a presets folder, overridable per project. A preset names its
     archetype or archetypes, dimensions in inches or cm, and part states.
   - **Scale-aware from roughly 1 inch to 30 inches**, lipstick to check-in luggage. Grid, snapping,
     camera near-clip and default framing all have to follow the product's size rather than assume
     human scale.
   - Clone `prop.suitcase`'s builder logic (`builders.ts:1785-1810`) where it helps.
   - **First presets:** Biaggi Runway (22 x 14 x 8 in, expanding to 10.5; trolley handle with height
     stops, four wheels, front panel as a hinged slab with closed / open / top-folded states),
     Zipcubes as plain boxes at spec dimensions, one cosmetic compact, one lipstick-size tube, one
     compound appliance example.

4. **Cheap props and sets.** Security tray, open overhead-bin door, vanity or bathroom counter
   tabletop, seamless tabletop sweep. Check the existing 55 environment kits and 86 props first and
   extend rather than duplicate: `env.planeCabin` already has closed bins (`builders.ts:3827-3830`) and
   `env.airportTerminal` already exists (`builders.ts:4958-4997`).

5. **Arbitrary export resolution, plus 2:1, 3:2 and 4:5 added to the aspect set.** `ExportResolution`
   is a three-way enum today (`exporter.ts:20`) and `AspectId` is a closed five-value union
   (`types.ts:67`). Adding ratios touches the union, `ASPECT_RATIOS`, two UI lists, the MCP control
   handler, every profile's `aspects` array, and the schema migration.

6. **Headline safe-zone overlay.** Presets left third, right third, top band, bottom band, custom
   rect. Viewport overlay, negative-space percentage, written into `prompt.txt` and `metadata.json`.
   Store the rect on the shot so `state(t)` stays pure.

7. **Small-product camera check, report only.** Verify macro-range focal lengths, close focus distance
   and shallow depth of field in the clay and depth passes. Then test whether a character's hand
   holding the lipstick-size tube reads clearly at close range. Report with renders. Do not fix in
   this pass.

**Cut** (owner decision, 2026-09-22): fidelity spike, image-to-3D, clay override on imported models,
unit-aware GLB scaling, soft-body cube proxies. **Deferred:** lineart pass, product-mask pass, Shopify
URL import.

Effort re-estimate. Agent-session days on Opus, `xhigh` for engine and export work. Anything over one
day carries its reason.

| # | Item | Effort | Reason if over 1d |
|---|---|---|---|
| 1 | Software-GL switch | 0.25d | |
| 2 | Await model loads, `.obj` decision | 0.5d | |
| 3 | Generic parametric product system | 3d | Five subsystems, not one: archetype builders, the part-attachment model, compound composition, a JSON preset loader with project override, and scale-awareness. Scale-awareness alone reaches the viewport grid, the camera near-clip, snapping and the auto-framing path, all of which assume human scale today. Plus five presets and engine tests. |
| 4 | Cheap props and sets | 1d | |
| 5 | Arbitrary resolution + 3 aspect ratios | 1d | |
| 6 | Headline safe-zone overlay | 1.5d | The rect lives on the shot, so it needs a schema field, a migration and a round-trip test, then five consumers: viewport overlay, negative-space computation, `engine/prompt.ts`, `metadata.json`, and the aspect-aware overlay layout. Each consumer needs its own test. |
| 7 | Small-product camera check | 0.5d | Report only, no fix. |

Roughly **7.75 days**, down from 13.5. The fidelity constraint is what bought that back.

### Phase 2: Phone camera input (handheld video moves; not needed for stills)
- Spike first: an ARKit app streaming 6DoF pose over OSC/VMC/FreeD (VRL Cam lists these). Receive UDP in the Electron main process, map to the shot camera, record into camera marks. LOW CONFIDENCE on VRL Cam: single store-listing source, untested.
- Fallback: VirtuCamera 2 via PyVirtuCamera (`VCServer` + `VCBase`). Needs a Python sidecar (version-specific C-extension), viewport streaming to the phone, and a paid app per user ($19.99, Pro $9.99/mo or $99/yr). No license statement found on its wiki; confirm before depending on it. Docs: https://github.com/theweirdbyte/PyVirtuCamera/wiki

### Phase 3: Team rollout
Internal installer, one-page SOP, a saved "Biaggi Runway hero" preset project as template, and a documented MCP path ("tell Claude Code the shot you want").

## Pilot product: Biaggi Runway Hardside Hybrid Carry On
Source of truth: https://biaggi.com/products/runway-hardside-hybrid-carry-on (Specifications section). Pulled 2026-09-21. Re-verify before locking scale.
- **Dimensions:** 22" x 14" x 8"; expands to 22" x 14" x 10.5". Read as H x W x D (22" is carry-on height). Unconfirmed whether height includes wheels; check against side-view product photos.
- **Weight / volume:** 5.9 lb; 36.7 L, 48.1 L expanded.
- **Construction:** 100% polycarbonate rear shell; nylon fabric front panel and rear exterior; aluminum trolley handle; Japanese Hinomoto PU spinner wheels.
- **Signature features (these are the shots):** opens from the front panel instead of a clamshell; top of the front panel folds down for two cushioned laptop sleeves and a passport pocket; large zippered rear water-bottle pocket; slim profile for small-plane overhead bins; expansion zipper; removable wet/dirty pouch.
- **Colors:** Black, Navy Blue, Grey, Pink.
- **Zipcubes tie-in:** Biaggi sells a Runway + Zipcubes bundle (3-pack carry-on size + Mini Cube Duo) and markets the cubes as fitting the Runway like a jigsaw. Pull Zipcube dimensions from their product pages before building proxies.
- **Reference imagery:** the product page carries a studio image set, a product video, and creator lifestyle shots. Download into the project's reference folder. These are what carry product appearance into the generated image; the geometry only carries scale and silhouette.
- **Geometry source:** the generic archetype preset (Phase 1 item 3) is the default and is expected to be sufficient. GLB import (item 2) is the escape hatch if Biaggi supplies real CAD. Image-to-3D and phone scanning are cut: fidelity is not a goal, so neither earns its cost.

## Pilot shot list (DRAFT, proposed by Claude, confirm with Stephane)
| # | Shot | Type | Framing |
|---|---|---|---|
| 1 | Runway upright, 3/4 front, low camera, seamless sweep | Product hero | Headline left 40%, 2:1 |
| 2 | Runway upright, front panel open, Zipcubes fitted inside | Product + promo | Headline right third, 3:2 |
| 3 | Top panel folded down, laptop sliding out into a security bin | Lifestyle (feature) | Headline top band, 4:5 |
| 4 | Runway sliding wheels-first into a small-plane overhead bin | Lifestyle (slim profile) | Headline left third, 2:1 |
| 5 | Traveler rolling Runway through a terminal, wheel-height tracking angle | Lifestyle | Headline right third, 2:1 |
| 6 | Overhead flat lay: Zipcubes set beside the open Runway | Product + promo | Headline top band, 1:1 |
| 7 | Curbside vertical, telephoto compression | Lifestyle / social | Headline top band, 9:16 |

Pipeline per shot: stage in the app, export the stills package, attach Biaggi product imagery as product references, generate in the target image model, review in an email template mock with a real headline.

## Key decisions
| Decision | Why | Rejected |
|---|---|---|
| Fork Blockout | Apache-2.0 permits a proprietary internal fork; real lens math, real-scale libraries, deterministic exports, passes, per-generator prompts, MCP already exist | CozyClay (AGPL-3.0), from scratch, closed vendor tools (Higgsfield 3D Jutsu, Topview, SEELE) |
| No Blender for the team | Learning curve blocks AW adoption | Blender template + Higgsfield Blender add-on (fine for Stephane personally) |
| Stills first | AW's output is email/product imagery | Video-first |
| Runway first, Zipcubes as supporting props | Runway is a best seller with visual features; Zipcubes are the current promo and physically pair with it | Glide (considered, parked) |
| Phone mocap deferred, OSC spike first | Avoid Python sidecar and per-user subscription | VirtuCamera-first |
| **Dimensional accuracy, not product fidelity** (Stephane, 2026-09-22) | Primitives at correct real-world dimensions are enough. Geometry controls scale, silhouette, placement and composition; the image model gets product appearance from reference images. Chasing likeness in the mesh buys nothing the references do not already give us | Fidelity spike, image-to-3D, photogrammetry of a physical sample, clay override on imported models |
| **Generic archetypes, no product-specific code** (Stephane, 2026-09-22) | The tool has to carry luggage (Biaggi), cosmetics (Laura Geller, Julep) and odd-shaped appliances (Baby Brezza) without a new builder per client. Three archetypes plus attachable parts plus compound composition covers all three categories | A bespoke parametric luggage generator; per-client builder cases in `builders.ts` |
| **Products are data presets, not code** (Stephane, 2026-09-22) | JSON in a presets folder, overridable per project. Adding a client's product is an edit a non-engineer can make, matching how generator profiles already work | Hardcoding each product into `assets.ts` and `builders.ts` |
| **GLB import is the escape hatch, and must be solid** (Stephane, 2026-09-22) | Archetypes will not cover every shape. Import already renders into exports; it needs the load race fixed and the `.obj` promise resolved | Unit-aware scaling and clay override, both cut as fidelity work |

## Gotchas
- **Attribution/naming:** Apache 2.0 Â§4(d). Keep `NOTICE`, credit Sam Wasserman (wassermanproductions.com) in docs and the app's about/credits. Upstream says stable/commercial distribution also needs upstream/trademark permission, signing/notarization, and FFmpeg/H.264 review. Internal AW use only; rename the app before anyone outside Stephane uses it.
- **Keep upstream mergeable:** put AW-specific code behind clear module boundaries and docs under `docs/aw/`. Don't reformat upstream files. Log every upstream-file modification in `MODIFICATIONS.md`.
- **Windows FFmpeg is GPL-3.0-or-later**, a separate component. Don't statically link it.
- **Unsigned builds:** macOS may call the app "damaged"; use `xattr -cr /Applications/<App>.app`.
- **Upstream README had a stray merge marker** ("Stashed changes") in the MCP section. Check for other conflict artifacts.
- **MCP stale IDs:** refresh state, confirm ID, retry once.
- **Specs only from biaggi.com.** Not Amazon, retailers, or review sites. Biaggi product copy mentions "as seen on Shark Tank" and viral press also exists; none of that belongs in dimensions.
- **Scope/politics:** a custom AW build needs a home in Stephane's AW engagement and someone's engineering time. Stephane clears that; don't plan a team rollout until he confirms.
- **No secrets** in this file, commits, or logs. Reference where a credential lives, never its value.

## Working rules (Stephane's preferences)
- Execution work: just do it. Strategy, scope, go/no-go: push back and name the weak point.
- Ask one question at a time, then stop and wait. Don't bury a question under more work.
- Evidence only: verify from files or commands before claiming anything works.
- No loose ends: fix bugs in the same session unless Stephane approves deferring.
- Locked decisions stay locked. If an instruction contradicts the Key Decisions table, ask whether it's a change or a one-time exception.
- Written output: no em dashes, no filler, active voice.
- Don't run a named Claude skill without asking first.

## Open questions (for Stephane)
1. AW's standard email hero dimensions and headline placement conventions?
2. Which image and video models does AW use in production?
3. Does Biaggi have CAD/3D files or high-res product photography beyond the website?
4. Approve or replace the draft shot list? Which Runway color is the hero?
5. Who on the AW team pilots the tool?
6. Final internal app name?

## Status log
| Date | Status | Notes |
|---|---|---|
| 2026-09-21 | Forked | Fork created by Stephane. Handoff added. Nothing built or baselined. |
| 2026-09-22 | Baselined, green | Branch `aw/baseline`. `npm install` clean. typecheck green, lint green (0 warnings), `npm test` 886/886 across 14 files. Node 22.22.2, npm 10.9.7, Linux x86_64 cloud container, no GPU. |
| 2026-09-22 | Smoke passing, with a caveat | `npm run smoke` 6/6 including the real ffmpeg export and the byte-determinism check. Needed two container fixes: installed ffmpeg 6.1.1 (none on PATH), and forced ANGLE/SwiftShader because the container has no WebGL (`BindToCurrentSequence failed`, no `/dev/dri`). The GL switch was applied to the built artifact and reverted, not to source. See the recommendation in Audit results. |
| 2026-09-22 | MCP live | `claude mcp add blockout` connected. Drove the running app over the bridge: `initialize`, `tools/list` (34 tools, docs say 33), `get_state`, `add_entity` placing a labelled suitcase, `get_state` confirming it. |
| 2026-09-22 | Audit done, blocked on go-ahead | Gap audit written into this file with file:line citations. Phase 1 scope proposed with build order and effort: spike first, Shopify import deferred, shot list trimmed to five. Not starting Phase 1. Blocking question: which image model does AW use? |
| 2026-09-22 | Scope changed by owner, docs updated | Stephane: product fidelity is not a goal, primitives at correct real-world dimensions are enough, appearance comes from reference images. System must scale across AW clients (luggage, cosmetics, odd-shaped appliances). Cut: fidelity spike, image-to-3D, clay override, unit-aware GLB scaling, soft-body cubes. Deferred: lineart pass, product-mask pass, Shopify import. Key decisions and Build plan rewritten. Phase 1 is now 7 items, re-estimated at 7.75d from 13.5d. |
| 2026-09-22 | Item 1 shipped, verified | Env-gated software GL. `src/shared/software-gl.ts` (new, pure, unit-tested) plus two lines in `src/main/index.ts`. Default off. Verified in this container: flag off gives `NO WEBGL`, flag on gives WebGL 2.0 through SwiftShader, and `BLOCKOUT_SOFTWARE_GL=1 npm run smoke` is 6/6. typecheck, lint and 890/890 unit tests green. Logged in `MODIFICATIONS.md`. Branch `aw/software-gl`. |
| 2026-09-22 | Item 2 shipped, verified | Imported models now reach exports. Found and fixed a bigger bug than the planned race: the Library imports in two mutations (addEntity, then attach `sourceFile`), and the load only fired on visual creation, so an imported GLB stayed invisible for the whole session until the project was reopened. Added `ensureCustomModel` (idempotent, guards retry storms) plus `settleAsyncLoads()` awaited by `exportShot`, `exportStillAtPlayhead` and `exportContactSheet`. `GLTFLoader.parse` now has an error callback so a malformed file cannot wedge an export. `.obj` removed from the import picker: one line against ~15 to wire `OBJLoader`, and the picker was advertising a format that always failed to parse. New `tests/e2e/import-await.spec.ts` builds a minimal GLB fixture, exports in the same tick as the import, and decodes the PNG with ffmpeg to assert the mesh's own colour is in frame 0. Verified it fails with either fix removed. typecheck, lint, 890/890 unit, 72/73 e2e green (`perf.spec.ts` needs a GPU). Branch `aw/import-await`. |
| 2026-09-22 | Item 3 shipped, verified | Generic parametric product system. Pure engine module `src/engine/products.ts` resolves a data preset plus a state into metre-space primitives; `src/renderer/viewport/product-builder.ts` just draws them. Three archetypes (rounded box, capped cylinder, tapered tube), optional hinged door or lid with an independent secondary fold, attachable parts (handle with stops, wheels, feet, cap, pump), and compound multi-piece presets with relative offsets. Presets are JSON (`src/engine/products.json`), overridable per project from `<project>/products/*.json`. Scale-aware: grid cell, gizmo snap and both camera near planes derive from the scene, and the shot camera's near plane comes from the document only, never selection, so exported pixels stay independent of editor state. Six presets ship, all dimensions verified against biaggi.com on 2026-09-22: Runway 22x14x8 expanding to 10.5, Zipcube 13.5x9.5x3, Zipcube Mini 7x7x4, plus generic compact, lipstick tube and a compound bottle-warmer sample. 40 new unit tests; 930/930 total. Two geometry bugs found and fixed by those tests: signed-zero angles, and wheels not lifting the shell onto the ground (a 20.4in shell on 1.6in wheels is a 22in bag). A third, the laptop flap hinging inside the panel instead of on its free edge, was caught in the clay render and fixed. Branch `aw/product-system`. Stopped here for Stephane's review of the stills. |
