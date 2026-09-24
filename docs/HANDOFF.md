# AW Previs Fork: Build Handoff
**Location in repo:** `docs/aw/HANDOFF.md` | **Created:** 2026-09-21 | **Owner:** Stephane Gringer (Fractional CMO, AlchemyWorx)
**Status line (keep current):** Forked by Stephane. Not yet built, baselined, or audited.

This is a living document. Claude Code: read it at the start of every session, and update the Status Log at the bottom the moment anything runs, ships, or breaks, with an honest status ("built, untested", "smoke passing", "blocked on X"). One source of truth: edit sections in place, don't append duplicates.

## TL;DR
This repo is Stephane's fork of `wassermanproductions/blockout` (Apache-2.0, Electron + TypeScript). We are turning it into an internal AlchemyWorx (AW) tool so designers and motion people can stage a real-scale product in a grey-box scene, frame it with real lens math and headline-safe negative space, and export clay/depth/normal/mask passes plus a model-tailored prompt for image and video generators. No Blender. First pilot: Biaggi (AW client) Runway Hardside Hybrid Carry On, product and lifestyle stills framed for email headlines.

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

**Audit results:** pending.

## Build plan

### Phase 1: Product stills mode (required for the pilot)
Every new timeline/scene behavior goes through the engine pattern. Add Vitest coverage. Keep `npm run smoke` green and exports byte-deterministic.

1. **Product import that renders in exports.** GLB/glTF import with unit-aware scaling (inches or cm entry), ground snap, clay override by default with a toggle to show original materials for silhouette checks. Store imported assets inside the project folder so projects stay portable.
2. **Parametric luggage proxy.** Generator from H x W x D with body types:
   - Hardside shell (rounded box).
   - **Hybrid (Runway):** hard polycarbonate rear shell + soft fabric front panel. States: closed; front panel fully open; top of front panel folded down (laptop sleeve access); expanded depth.
   - Softside (ZipSak) as a later addition.
   Options: telescoping trolley handle with height stops, top carry handle, 4 spinner wheels, rear exterior pocket.
3. **Packing cube proxies (Zipcubes).** Simple soft boxes at spec dimensions, placeable inside the open Runway. Zipcubes are the current promo focus, so "Runway open with cubes fitted inside" is a priority shot.
4. **Stills export package** per camera mark or current frame, arbitrary resolution:
   `clay.png`, `depth.png`, `normal.png`, `lineart.png`, `product_mask.png`, `headline_safezone_mask.png`, `prompt.txt` (per target model), `metadata.json` (lens, sensor, camera pose, product placement, safe-zone rect).
5. **Headline safe-zone overlay.** Viewport overlay + exported mask. Presets: left third, right third, top band, bottom band, custom rect. Show negative-space percentage. Prompt generator writes it into the prompt (e.g. "clean, uncluttered background across the left 40% of frame for headline copy").
6. **Aspect presets** (email spec confirmed: 600px wide, heroes up to 500px tall; export at 2x): 600x500, 600x400, 600x300, 600x250 (and 2x versions), plus 1:1 (1080x1080), 4:5 (1080x1350), 9:16 (1080x1920) for social. Extend the existing aspect-mask system.
7. **Image-model generator profiles.** Add profiles for whatever models AW uses (open question). Each defines input slots (structure/depth reference, product reference images, style reference), max resolution, prompt template.
8. **Product photography sets and lighting.** Seamless sweep/infinity cove, tabletop, soft top light, window light, hard sun. Extend the existing 9 presets; don't duplicate.
9. **Travel lifestyle kits**, only those missing after the audit: airport terminal, security checkpoint with bins, aircraft cabin with overhead bins, hotel room with luggage rack, car trunk, curbside drop-off.
10. **Import product from a Shopify URL** (nice-to-have, high leverage; biaggi.com is Shopify and most AW e-commerce clients likely are too). Fetch the product JSON (`/products/<handle>.json` or `.js`; verify on biaggi.com), parse the Specifications block for dimensions, download the image set into a project reference folder, generate a scaled proxy. On parse failure, fall back to manual entry. Never guess dimensions.

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
- **Reference imagery:** the product page carries a studio image set, a product video, and creator lifestyle shots. Download into the project's reference folder for image-model product references and possible image-to-3D.
- **3D source order:** official CAD/3D from Biaggi (ask Stephane) > image-to-3D from the product image set > phone scan of a physical sample > parametric hybrid proxy (item 2 above).

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

## Answered questions (2026-09-23, Stephane)
1. **Email spec:** emails are 600px wide. Heroes are up to 500px tall. Design at 2x for retina (up to 1200x1000). Aspect presets should be built around 600 wide and heights up to 500 (for example 600x500, 600x400, 600x300, 600x250), plus the social ratios already listed. No standard headline placement: it varies per email, so the safe-zone presets (left, right, top, bottom, custom) must all stay available and be chosen per shot.
2. **Models:** no fixed models. AW uses whichever model does the job best. Generator profiles must stay easy to add and swap; don't hard-wire one model.
3. **Biaggi CAD/3D:** none available now. Use the next options in the 3D source order: image-to-3D, phone scan, or the parametric proxy. The parametric proxy is the default path.
4. **Hero color:** not chosen yet. Build the proxy with color as a swappable option (Black, Navy Blue, Grey, Pink).
5. **Pilot:** Stephane.
6. **App name:** ALXStudio. Rename not yet applied to the app. Apply per the attribution rules (keep `NOTICE`, credit Sam Wasserman).

## Open questions (for Stephane)
1. Approve or replace the draft shot list?

## Status log
| Date | Status | Notes |
|---|---|---|
| 2026-09-21 | Forked | Fork created by Stephane. Handoff added. Nothing built or baselined. |
| 2026-09-23 | Baseline passing | Added `scripts/aw-verify.mjs` (run `node scripts/aw-verify.mjs`). On macOS Darwin 24.6.0, Node 22.23.1: typecheck, lint, unit tests, smoke, and app launch passed. Manual UI test by Stephane pending. |
| 2026-09-23 | Decisions recorded | Email spec, model policy, no Biaggi CAD, pilot owner, and app name (ALXStudio) recorded under Answered questions. Rename not yet applied. |
