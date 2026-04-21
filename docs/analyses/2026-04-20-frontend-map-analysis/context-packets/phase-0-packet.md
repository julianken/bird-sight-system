# Phase 0 Packet — Shared Context for Phase 1 Investigators

This packet is the handoff to the 5 Phase 1 investigators. It is intentionally compact: every investigator receives it verbatim in addition to their specific area assignment.

## The question

**Why is the map-based bird-watch frontend failing as a product, and what evidence should inform a map-less reimagining?**

## Situation in one paragraph

Bird-watch (live at <https://bird-maps.com>) renders Arizona birding data as 9 SVG ecoregion polygons with colored-circle "badges" stacked inside each polygon; click a region to inline-expand it and see species labels. The user is a solo developer who has shipped 8 consecutive map-rendering bug-fix PRs over the last 10 merges (non-scaling stroke, drop-shadow containment, expand-cap, paint-order, two-pass layering, …). The current UI has legibility problems visible in the screenshots: overlapping species labels on expand, un-keyed color encoding, identical generic silhouettes for every species, a default view dominated by "+N more" pips, and three Sky Islands sharing the same fill color. The user has decided to ditch the map. This analysis feeds a brainstorming session about a map-less reimagining. The brainstorm is not your concern — producing the right evidence is.

## Key anchors

- **Spec:** `docs/specs/2026-04-16-bird-watch-design.md` — §Components › Frontend (line 40-52), §Filters (MVP) (line 233-245), §Success criteria (line 345+).
- **Plan 4 (frontend):** `docs/plans/2026-04-16-plan-4-frontend.md`.
- **CLAUDE.md:** project-level conventions and architecture invariants (note: opening paragraph is stale per issue #103).
- **Live site:** <https://bird-maps.com> — also archived as screenshots in `phase-0/screenshots/`.
- **Frontend source:** `frontend/src/**` — 2566 LOC total across TS/TSX/CSS.
  - Map rendering chain: `App.tsx` (101), `components/Map.tsx` (205), `components/Region.tsx` (176), `components/Badge.tsx` (139), `components/BadgeStack.tsx` (333), `components/HotspotDot.tsx` (36), `geo/path.ts` (302), `styles.css` (170) — ≈1462 LOC of map-specific code + ~1100 LOC of map-specific tests.
  - Non-map scaffolding: `api/client.ts`, `state/url-state.ts`, `data/use-bird-data.ts`, `data/use-species-detail.ts`, `components/FiltersBar.tsx`, `components/SpeciesPanel.tsx`, `derived.ts`.
- **E2E:** `frontend/e2e/*.spec.ts` — 16 specs. 8 are map-specific: `badge-containment`, `cross-region-badge-containment`, `expand-cap`, `paint-order`, `sizing`, `stroke-scaling`, `region-collapse`, `happy-path`. 8 are design-agnostic: `a11y`, `axe`, `deep-link`, `error-states`, `filters`, `history-nav`, `species-panel`, `prod-smoke.preview`.

## Loadbearing facts (investigators should treat as ground truth unless they find evidence otherwise)

1. `silhouetteFor` in `App.tsx:28-30` returns `GENERIC_SILHOUETTE.path` for every species — the visual per-species differentiator is circle fill color alone.
2. Three regions share fill `#B84C3A`: `sky-islands-chiricahuas`, `sky-islands-huachucas`, `sky-islands-santa-ritas`.
3. The expand-transform is capped at `EXPAND_MAX_BBOX_FRAC = 0.6` of the viewBox (`Region.tsx:18`) because uncapped scale hit 16× linear on Sky Islands (PR #100 / issue #88).
4. Badge layout uses a 96×96-grid-rastered largest-inscribed-rect algorithm + pole-of-inaccessibility fallback (`geo/path.ts:140-209` + `:225-301`).
5. Default map view on 1440×900 shows: 9 region polygons, 30 badges (of 9-region × ≤12 badges cap), 8 overflow pips ("+N more"), 0 visible hotspot dots, 183 total SVG child elements.
6. Recent PRs confirming the rendering-churn signal: #80 region z-order → #81 fix → #87 paint-order sort → #99 selected-last → #88 expand blowup → #100 expand-cap → #93 non-scaling-stroke → #98 non-scaling stroke + drop-shadow → #77 polygon-aware badge layout → #78 visible labels → #94 two-pass paint layers → #96 design tokens → #101 sqrt-radius hotspot → #92 badge-radius vs silhouette-size unification.
7. Known-broken coupling: `silhouetteId` is used as `familyCode` for colour lookup (`App.tsx:32-43`); issue #57 tracks the deferred refactor.
8. Known "stale" doc: `CLAUDE.md` opens "This repository currently contains planning artifacts only" — that's wrong; live code exists. Don't quote that line as evidence of anything.

## What each investigator receives

Each gets this packet + their specific area assignment from the brief (`phase-0/analysis-brief.md`, §Investigation areas for Phase 1):

1. **Area 1 — Visual-UX audit** — critic the rendered UI, distinguish "fixable" from "inherent."
2. **Area 2 — Rendering-complexity audit** — quantify map-specific complexity; what vanishes if map dies.
3. **Area 3 — User-task fit** — articulate jobs-to-be-done; map them against current UI support.
4. **Area 4 — Data/API surface** — what the backend serves, what the UI drops, what shapes it naturally supports.
5. **Area 5 — Salvage map** — KEEP/REFACTOR/DISCARD manifest for code, tests, contracts.

## Output contract (every area)

- Write to `{ARTIFACT_ROOT}/phase-1/area-{N}-{slug}.md` **before returning**. If the file is missing after you return, you have failed and will be re-dispatched.
- Follow the Phase 1 template in `/Users/j/.claude/skills/analysis-funnel/references/phase-templates.md`.
- Cite every claim with a file path + line number, screenshot name, URL, or tool output. Do NOT write "probably" or "seems like" without a backing citation.
- Confidence levels (high / medium / low) with the reason.
- Distinguish symptoms from root causes.
- Flag surprises — things that contradicted your expectations.
- List unknowns honestly.

## What you should NOT do

- Do not propose the replacement UI. That's for the brainstorm.
- Do not recommend specific map libraries, list UIs, feed UIs, etc.
- Do not refactor or edit any frontend code.
- Do not attempt to fix the bugs you find — document them.
- Do not expand scope beyond your assigned area (other investigators are handling other facets in parallel).
- Do not re-take screenshots — the 4 captured in `phase-0/screenshots/` at commit time are sufficient reference; re-driving Playwright is wasted work and risks credential leakage per user memory. If you genuinely need a new view, say so in your "Unknowns" section and we will capture it during Phase 2.

## Screenshot inventory (for reference)

- `phase-0/screenshots/bird-maps-default-1440.png` — default view, 1440×900 desktop.
- `phase-0/screenshots/bird-maps-sonoran-tucson-expanded.png` — `?region=sonoran-tucson`, 1440×900. Species label overlap is visible here.
- `phase-0/screenshots/bird-maps-huachucas-expanded.png` — `?region=sky-islands-huachucas`, 1440×900. Single-badge pole-of-inaccessibility fallback, giant grey "+1" pip, no species info.
- `phase-0/screenshots/bird-maps-mobile-390.png` — default view, 390×844 (iPhone 14 Pro) — badges shrink to near-unclickable size, empty space below the map.
