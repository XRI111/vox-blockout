# Handoff: AW previs fork (vox-blockout) — Phase 1 complete, 6 PRs open and unmerged
**Date:** 2026-09-24 | **Next session focus:** open (inferred: get the PR stack merged, then await Stephane's direction on the item 7 findings)

> Focus was not specified. I inferred it from state: all seven build-plan items are delivered and
> nothing is authorized beyond them, so the only work left is landing the stack and answering
> Stephane. If the next session has a different brief, the Gotchas and Environment sections still
> apply verbatim.

## TL;DR
Stephane's fork of `wassermanproductions/blockout`, being turned into an internal AlchemyWorx previs
tool. **Phase 1 is complete**: items 1-6 shipped plus owner-added 4b, and item 7 delivered as a
report. Six PRs (#7-#12) sit open in a dependent stack, all mergeable clean, none merged. **Nothing
further is authorized** — do not start fixing the item 7 findings without Stephane saying so.

## Goal
Stage a real-scale product in a grey-box scene, frame it with real lens maths and headline-safe
negative space, export clay/depth/normal passes plus a model-tailored prompt. First pilot: Biaggi
Runway Hardside Hybrid Carry On, stills framed for AW email headlines.

Success condition (from `docs/HANDOFF.md`): an AW email designer can drop a headline on a generated
still without recomposing, and a non-3D AW team member can reproduce one shot from a blank project
in under 30 minutes.

## Current State

**Done and pushed.** Seven items, one branch and one PR each, stacked bottom-up:

| PR | Branch | Base | Contents |
|---|---|---|---|
| #7 | `aw/phase1` | `main` | Baseline audit, scope change, items 1-3 |
| #8 | `aw/props-sets` | `aw/phase1` | Item 4, props and sets |
| #9 | `aw/transform` | `aw/props-sets` | Item 4b, full static entity pose |
| #10 | `aw/aspects-resolution` | `aw/transform` | Item 5, arbitrary width + 5 added ratios |
| #11 | `aw/safe-zone` | `aw/aspects-resolution` | Item 6, headline safe zones |
| #12 | `aw/small-product-check` | `aw/safe-zone` | Item 7, report only, no source changed |

All six are draft except #7, all `mergeable_state: clean`, zero review comments, zero CI checks.
Head SHAs as of 11:55 UTC: main `440fae7`, `95c8a61`, `b336661`, `c79a103`, `1b0ec32`, `26ea04e`,
`5221421`.

**Gates on the stack head (`aw/small-product-check`):** typecheck green, lint green (0 warnings),
**1039/1039** unit tests, **100/101** e2e (only `perf.spec.ts`, which needs a GPU), smoke 6/6
including the byte-determinism check.

**Decided and closed this session:** Stephane's 2026-09-23 commit on `main` answered five open
questions (email spec, model policy, no Biaggi CAD, pilot owner, app name). Only one open question
remains: approve or replace the draft shot list.

**Not done, not authorized:** any of the six item 7 findings; swappable hero colour on the product
proxy; the ALXStudio rename.

## Next Action

1. **Check whether `main` moved.** `git ls-remote origin main` against `440fae7`. Stephane pushed to
   `main` once mid-session and broke #7; if he does it again, merge `main` up the **whole** stack
   (`aw/phase1` → `props-sets` → `transform` → `aspects-resolution` → `safe-zone` →
   `small-product-check`), resolving `docs/HANDOFF.md` at each step. Rules for that resolution:
   keep the live 7-item build plan over the superseded 10-item list; union status-log rows in date
   order. A helper that automates the status-log case only is at
   `<scratchpad>/resolve-log.py` (it refuses anything that isn't purely log rows).
2. **Otherwise the stack is waiting on Stephane**, who is the sole reviewer. Do not push to try to
   move it along.
3. A self check-in is armed hourly (`send_later`, next ~12:56 UTC). Re-arm it silently when nothing
   moved; do not message Stephane or comment on the PRs for a no-change check.

## Key Decisions

Locked owner decisions live in the Key decisions table of `docs/HANDOFF.md`. **Locked decisions stay
locked** — if an instruction contradicts that table, ask whether it is a change or a one-time
exception. The ones that shaped the most code:

| Decision | Why | Rejected |
|---|---|---|
| Dimensional accuracy, not product fidelity (Stephane) | Geometry carries scale, silhouette, placement. Appearance comes from reference images | Fidelity spike, image-to-3D, photogrammetry, clay override |
| Generic archetypes, no product-specific code (Stephane) | Must carry luggage, cosmetics and odd appliances with no builder per client | Bespoke luggage generator; per-client cases in `builders.ts` |
| Static pose now, animation later (Stephane) | Stills are the pilot; animating pitch/roll reaches `state(t)` and re-opens byte-determinism | Pitch/roll on marks |
| `rotationY` stays the heading field (Claude) | ~30 call sites read it as facing. Pitch/roll are separate, applied YXZ | Rotation V3; Euler XYZ |
| `scale` stays one number, `stretch` separate (Claude) | `entityHeight` and auto-framing need one real-world multiplier | Making `scale` a V3 |
| Safe-zone rect is normalized frame space (Claude) | The reserved share must survive a change of aspect or export width | Pixel rects |
| Environment kits excluded from safe-zone occupancy (Claude) | A terminal spans the frame by design; counting it reads 0% clear on every shot | Counting all entities |
| Height derives from aspect on custom export width (Claude) | Viewport mask, camera FOV and exported pixels all read `shot.aspect`; free W+H returns a frame that is not what was composed | Free width and height |

## Files & Artifacts

**Do not duplicate — read these:**
- `docs/HANDOFF.md` — the living project doc. Build plan, audit with file:line citations, Key
  decisions, Answered questions, full status log, and the **item 7 report** (six findings).
  `CLAUDE.md` requires reading it at the start of every session and keeping the status log current.
- `AGENTS.md` — upstream's hard rules: engine purity, determinism, `store.mutate`, the
  `window.__blockout` automation surface.
- `MODIFICATIONS.md` — every upstream-file change is logged here. Keep it that way.

**New engine modules this session (all pure, no DOM/three):**
- `src/engine/transform.ts` — pose conventions (YXZ order, `scale` vs `stretch`, snap, ground re-seat inputs)
- `src/engine/safe-zone.ts` — safe-zone rects, camera projection, occupancy
- `src/engine/products.ts` + `products.json` — parametric product presets
- `src/renderer/viewport/ground-lift.ts`, `product-builder.ts`
- `docs/aw/renders/item7/` — item 7 renders (188 KB, committed)

**This file** lives at `docs/aw/session-handoff-2026-09-24.md` on branch `aw/session-handoff`,
which branches from `main` and is deliberately **not** part of the six-PR stack — it is a session
record, not a change to the product, and putting it on `aw/small-product-check` would have widened
a report-only diff.

## Environment & Tools

Cloud container, no GPU, no display. Two things had to be installed/worked around:

- **ffmpeg/ffprobe 6.1.1** installed from apt (not on PATH by default, not vendored for Linux).
  Used for decoding exported PNGs and pulling frames out of depth MP4s in tests.
- **No WebGL** without a flag. The verification loop for anything that renders is:
  ```
  npm run build
  BLOCKOUT_SOFTWARE_GL=1 BLOCKOUT_E2E_ROOT=/tmp/e2e-x \
    xvfb-run -a --server-args="-screen 0 1920x1080x24" npx playwright test --reporter=line
  ```
  `BLOCKOUT_SOFTWARE_GL=1` is item 1's env-gated switch (`src/shared/software-gl.ts`), default off.
- `BLOCKOUT_SMOKE_DIR=<dir>` bypasses the New/Open dialogs when driving the app from a spec.
- GitHub via `mcp__github__*` tools; no `gh` CLI. `$GITHUB_TOKEN` works for direct `curl` against
  the REST API (used for `mergeable_state`, which the MCP tools do not surface).
- Bundled MCP server at `mcp/blockout-mcp.mjs` drives the running app (34 tools; docs say 33).

## Gotchas & Blockers

- **GitHub Actions has never run in this fork.** Zero checks on any PR across two days. Every gate
  quoted anywhere was run locally in this container. Nothing will catch a regression on Stephane's
  side until he enables it. Flagged to him twice; still not enabled.
- **`perf.spec.ts` fails under software GL** and always will (asserts 50 entities hold >50fps;
  SwiftShader manages 2.4). It fails at baseline. Not a regression, needs a GPU.
- **Do not kill a full e2e run mid-flight.** I did once; the next run showed two extra failures in
  `round4.spec.ts` from process contention, and I burned a cycle proving they weren't mine. Both of
  those tests read rendered state after a fixed 200 ms timeout, so they are load-sensitive.
- **The recurring failure mode in this codebase** is a value that is correct in the store and never
  reaches the rendered object. It has happened three times (invisible imported GLB, a tilt that
  survived one frame, a catalog-sized bounds box). Verify by measuring world bounding boxes off the
  live scene graph or by decoding real pixels — never by re-reading the code.
- **Pixel-diffing a render is contaminated two ways.** Adding an entity changes scene-derived scale
  (grid, near planes), so diff against the same document with the subject hidden via
  `excludeFromExport`, not against an empty scene. And a cast shadow sits in the same brightness
  band as clay-on-grey geometry, so no magnitude threshold separates them.
- **`docs/HANDOFF.md` conflicts on every `main` merge** because Stephane edits the old 10-item build
  plan that this work replaced. Semantic, not textual. See Next Action step 1.
- **Stephane's Answered questions list image-to-3D and phone scan** ahead of the parametric proxy in
  the 3D source order. Both were cut on 2026-09-22 and the same note calls the proxy the default, so
  the cut was left in place. Raised to him; unanswered.
- No secrets appear in this document, the repo, or any commit. `$GITHUB_TOKEN` was only ever passed
  as an env var, never printed.

## Suggested Skills
- `code-review` — before Stephane reviews, if he wants a second pass on the six-PR diff.
- `handoff` — this doc; re-run if the next session also ends without the stack merging.

## Open Questions
1. **For Stephane, still open:** approve or replace the draft 7-shot pilot list (`docs/HANDOFF.md`).
2. **Raised, unanswered:** swappable hero colour (Black/Navy/Grey/Pink) is not built — the product
   system carries dimensions, not colour variants. Nobody has scoped it.
3. **Raised, unanswered:** the ALXStudio rename is recorded but not applied to the app.
4. **Raised, unanswered:** whether any of the six item 7 findings should be fixed. My ranking, by
   cost against benefit to the pilot: (1) the one-metre depth floor at `SceneManager.ts:2723` — one
   line, measured 11.5x improvement in depth range for a small product; (2) width-aware framing in
   `frameSubject`, which silently ruins any product wider than it is tall; (3) joint-anchored
   attachment, genuinely new work; (4) the focus clamp and real depth of field, cheap and expensive
   respectively, and neither buys much while appearance comes from reference images.
