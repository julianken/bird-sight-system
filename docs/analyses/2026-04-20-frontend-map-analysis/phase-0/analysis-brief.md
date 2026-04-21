# Phase 0 — Analysis Brief

## Central Question

**Why is the map-based bird-watch frontend failing as a product, and what evidence should inform a map-less reimagining?**

The user (Julian, single developer on this project) has said the map design "just isn't working out on the front end" and wants to ditch it. This analysis has to produce enough structured evidence that the follow-on brainstorming session can reimagine the frontend without starting from a blank page *or* from vague dissatisfaction.

## Why now

- Bird-watch is live at <https://bird-maps.com> and has been for ~24h (first ship 2026-04-19 per project memory).
- Of the last 10 merged PRs (#93–#102), 8 are frontend rendering fixes: non-scaling stroke, drop-shadow containment, paint-order sort, expand-transform cap, silhouette-sizing unification, two-pass map render, HotspotDot sqrt-radius, Sky-Islands palette fix, sonoran/sky-island vertex clamp, design-token system.
- Dev-cost signal: the rendering approach is churning weekly, not stabilising.
- Product-quality signal: live screenshots (see `screenshots/`) expose overlapping species labels in expand view, un-keyed colour encoding, and a default view dominated by "+N more" overflow pips rather than bird information.

## Scope

### In bounds

- Current frontend code (`frontend/src/**`, `frontend/e2e/**`, `frontend/playwright.config.ts`, `frontend/vite.config.ts`).
- Original frontend plan (`docs/plans/2026-04-16-plan-4-frontend.md`) and spec frontend section (`docs/specs/2026-04-16-bird-watch-design.md` §Frontend / §Filters (MVP) / §Success criteria).
- Backend read-API contract at the consumer boundary — request/response shapes, not internal implementation.
- Frontend GitHub PR/issue history (`area:frontend` label) and recent commit archaeology for pain-point evidence.
- The live rendered output (screenshots already captured in `phase-0/screenshots/`).
- Salvage classification of existing frontend code.

### Out of bounds

- Backend re-architecture; the API contract is considered stable and sufficient.
- Database, ingestor, and infra work (Plans 1, 2, 5).
- Evaluation of specific replacement technologies (Leaflet, Mapbox, deck.gl, a feed UI, …). That is for the brainstorm.
- Proposing the replacement design itself. This analysis describes *what is wrong and what must be preserved*, not *what to build*.
- eBird API / Phylopic / ecoregion data sources — untouchable external dependencies.

## Depth

Targeted deep-dive. Not a broad codebase audit — this is scoped to "why the current frontend fails as a product" with enough engineering evidence to inform what to throw out vs keep.

## Known information & assumption register

### Known knowns (established from this turn's code-and-screenshot reconnaissance)

1. **The rendered UI currently shows:** Arizona as 9 flat-coloured ecoregion polygons, each with a grid of ~3–12 coloured circle "badges" representing species. Overflow is shown as grey "+N" pips. No state outline, no place names, no legend. (`screenshots/bird-maps-default-1440.png`, DOM count: 9 region paths, 30 badges, 8 overflow pips, 183 SVG children, 0 hotspot dots visible.)
2. **All species currently render with the same `GENERIC_SILHOUETTE`** path (`frontend/src/App.tsx:23-30`, `silhouetteFor()` returns the generic path unconditionally). The visual differentiator is reduced to circle fill colour alone — and the colour-to-family mapping has no legend in the UI.
3. **Three of the 9 regions share the same fill `#B84C3A`** — all the Sky Islands (`grep` on `browser_evaluate` output above). That makes 6 of 9 fills visually distinguishable, not 9.
4. **The `region` URL param triggers an inline expand** that CSS-scales the clicked polygon to fill ~60% of the canvas (capped in `frontend/src/components/Region.tsx:18` `EXPAND_MAX_BBOX_FRAC = 0.6`). The expanded view is where species names appear (`frontend/src/components/Badge.tsx:124-136`).
5. **At 1440×900, expanded species labels overlap catastrophically** — `screenshots/bird-maps-sonoran-tucson-expanded.png` shows "Great Hbesdeny Cahyon Tantus Wren" style label-on-label text collisions. The label row uses `dominantBaseline="hanging"` centred on the badge x-position; adjacent badges' labels can and do overlap.
6. **At expand-cap on tiny regions, the single-badge fallback dominates the screen as a giant grey "+1" pip with a generic silhouette and no text** — `screenshots/bird-maps-huachucas-expanded.png` (Sky Islands — Huachucas expanded: the pole-of-inaccessibility fallback in `BadgeStack.tsx:189-258` kicks in and renders one huge badge per polygon with no species name, no count chip, no visible information).
7. **Mobile viewport (390×844) shrinks the entire map to roughly 350px square**, pushing the filters into a vertical stack and leaving ~30% of the screen empty at the bottom (`screenshots/bird-maps-mobile-390.png`). Badge tap targets shrink with it.
8. **Frontend line counts:** 2566 total lines across `frontend/src/` (TS/TSX/CSS). Of that, 1258 lines (≈49%) live in the map rendering chain: `Map.tsx` (205), `Region.tsx` (176), `BadgeStack.tsx` (333), `Badge.tsx` (139), `HotspotDot.tsx` (36), `geo/path.ts` (302) + their tests and styles. Unit-test files add another ~1100 lines of map-specific coverage.
9. **Backend serves**, as consumed from `frontend/src/api/client.ts` and wired in `frontend/src/data/use-bird-data.ts`: `/api/regions` (9 polygons w/ svgPath + displayColor + parentId), `/api/hotspots` (locId/lat/lng/locName/numSpeciesAlltime), `/api/observations?since=&notable=&speciesCode=&familyCode=` (observations w/ subId, speciesCode, comName, silhouetteId, regionId, obsDt, isNotable, + lat/lng), `/api/species/:code` (scientific name, family).
10. **URL state** currently syncs `since | notable | speciesCode | familyCode | regionId` (`frontend/src/state/url-state.ts`). Deep-linking is covered by `frontend/e2e/deep-link.spec.ts` and `history-nav.spec.ts`.
11. **E2E coverage** has 16 `.spec.ts` files. Of those, 8 are map-rendering-specific (`badge-containment`, `cross-region-badge-containment`, `expand-cap`, `paint-order`, `sizing`, `stroke-scaling`, `region-collapse`, `happy-path` partial); 8 are design-agnostic (`a11y`, `axe`, `deep-link`, `error-states`, `filters`, `history-nav`, `species-panel`, `prod-smoke.preview`).
12. **Silhouette-id → family coupling is known-broken by design** — `frontend/src/App.tsx:32-43` carries a multi-paragraph `COUPLING NOTE` that `colorForFamily(silhouetteId ?? '')` works only while `family_silhouettes.id == family_code` in seed data. Issue #57 tracks the deferred refactor. This is technical debt inherited from the current model — independent of any UI redesign.

### Known unknowns (specific questions for investigators)

- What fraction of the 8 map-specific e2e specs die with the map, vs. get reframed for the replacement UI?
- What is the full inventory of "here-be-dragons" comments in the map code? (A proxy for how many SVG-dark-corners we've paid to navigate.)
- What user tasks are actually served by the current design, concretely, on a scale of *served well / served poorly / not served at all*?
- Do the SpeciesPanel and FiltersBar work well in isolation, or are they also dragged down by the map metaphor?
- Does any part of the current UI actually use the raw lat/lng in observations, or is it all region-aggregated by the time it hits the UI?
- How much of the visual noise is attributable to colour encoding lacking a legend, vs. the map metaphor itself?

### Suspected unknowns

- Whether the ecoregion abstraction is something a non-ecologist user would recognise or care about.
- Whether the inline-region-expand interaction delivers any value that a plain master-detail layout wouldn't.
- Whether the "spatial" framing is actively misleading (users assuming badge position within a polygon = lat/lng, which it isn't — badges are grid-laid-out inside the inscribed rect).
- Whether a list/feed/grid UI would render the filter and species-detail features more legibly with a fraction of the code.

## Domain tags

- **ux-ui** — what is communicated, what is readable, what decisions does the design force on the user
- **frontend-engineering** — code complexity, rendering correctness, maintenance cost
- **product-strategy** — user tasks, jobs-to-be-done, fit between UI metaphor and user mental model
- **salvage-inventory** — what survives a redesign (code, tests, contracts), a meta-domain bridging code audit and planning

## Pre-committed quality criteria

These determine whether the final report is useful; weights sum to 100.

| Criterion | Weight | Description |
|---|---:|---|
| Evidence-grounded | 25% | Every finding traces to code, screenshots, metrics, or documentation — no vibes |
| Separates symptoms from root causes | 25% | "Labels overlap" is a symptom; *why* it's impossible to fix in this model is the cause |
| Articulates what to salvage | 20% | Names specific files/components/tests that survive; not just "throw it all out" |
| Identifies user tasks | 20% | Concrete jobs-to-be-done, not wishlist — evidence from code/spec/observed behaviour |
| Epistemic honesty | 10% | Flags what we cannot know from static analysis, distinguishes confidence levels |

## Investigation areas for Phase 1

Five distinct facets of the central question. Each area produces one file at `{ARTIFACT_ROOT}/phase-1/area-{N}-{slug}.md`.

### Area 1 — `area-1-visual-ux-audit`

**Question:** What does the rendered product actually communicate to a first-time visitor, and where does it break down?

**Scope:** Walk through each captured screenshot as a UX critic. Apply principles of visual hierarchy, information-to-noise ratio, colour-as-encoding-without-legend, Fitts's-law tap targets, WCAG contrast, mobile legibility, semantic anchoring (does this LOOK like Arizona?), label crowding, and affordance (does a user know what's clickable and why). Document every visual failure mode with a screenshot reference. Distinguish "this specific rendering bug" from "this design cannot be made to work."

**Deliverables:** A prioritised inventory of UX failures, each marked as (a) fixable within the map metaphor or (b) inherent to the metaphor. Specific references to screenshots and DOM queries.

**Suggested `subagent_type`:** `ui-design:ui-designer` or `accessibility-compliance:ui-visual-validator`.

### Area 2 — `area-2-rendering-complexity-audit`

**Question:** How much of the frontend's code complexity exists *purely* to make the map render correctly under SVG's constraints, vs. is essential to any bird-data frontend?

**Scope:** Catalogue every "dark-corner" comment/workaround in the map rendering stack — the `non-scaling-stroke` belt-and-braces, the drop-shadow-filter-region drama, the `computeExpandTransform` cap, the `largestInscribedRect` + `poleOfInaccessibility` grid raster, the two-pass paint layering, the `parsePoints` parser that silently drops curves, the `parentId` paint-order sort, the DB-level vertex clamping of Santa Ritas (migration 11000) to avoid SVG z-fighting, the label-overlap in expanded view, and the identical `#B84C3A` fill on three Sky Islands. Classify each as "accidental to map choice" or "would exist in any frontend." Quantify: lines, PRs, open issues, comment word-count. Read the `CLAUDE.md` conventions baked in by the plans.

**Deliverables:** A structured table of complexity sources, line counts, and a point-estimate of how much code + test infrastructure would vanish if the map were replaced with a non-SVG UI (list/feed/card/grid/timeline). Cite specific PRs as evidence of continuing churn.

**Suggested `subagent_type`:** `feature-dev:code-explorer` or `code-refactoring:code-reviewer`.

### Area 3 — `area-3-user-task-fit`

**Question:** What user tasks should this product serve, and which are actually served by the current design?

**Scope:** From the spec (`docs/specs/2026-04-16-bird-watch-design.md` §Goal, §Filters, §Success criteria) plus inference from observed functionality, articulate 4–6 user tasks (jobs-to-be-done). Sample candidates — refine based on evidence:
- "What's notable in Arizona right now?"
- "What's been seen near me/a location I care about this week?"
- "I think I saw X — tell me more about it."
- "Browse by family or species across the state."
- "Identify a bird by its visual features."

Map each task against the current UI's support level (served well / served poorly / not served). Make the ecoregion framing's cost explicit: does the user care that their observation is in "Sonoran — Tucson" vs. "Sky Islands — Huachucas", or do they care about "within 10 miles of Tucson"? Does the map even show which region IS Tucson?

**Deliverables:** A task-by-task fit matrix with evidence and a clear claim about the user mental model the current design assumes vs. what actual users would have.

**Suggested `subagent_type:** `cognitive-orchestration:perspective-analyst` or `multi-platform-apps:ui-ux-designer`.

### Area 4 — `area-4-data-and-api-surface`

**Question:** What data does the backend already serve, at what shape and cadence, and what categories of frontend does that naturally support?

**Scope:** Read the API consumer code (`frontend/src/api/client.ts`, `frontend/src/data/use-bird-data.ts`, `frontend/src/data/use-species-detail.ts`) and the shared types (`packages/shared-types/**`). Document every field returned by `/api/observations`, `/api/hotspots`, `/api/regions`, `/api/species/:code`. Identify which fields the current UI *uses* and which it *drops*. Specifically: does the current UI drop the lat/lng on observations (replacing it with region-aggregated grid position)? Does it drop the `obsDt` timestamp (turning a time-rich feed into a flat aggregate)? Does it preserve the `isNotable` flag at the observation level or only as a filter-gate?

**Deliverables:** A field-by-field inventory + a set of "UI shapes this data naturally supports" (map, list/feed, grid, timeline, search, detail). This does NOT propose a design — it defines the feasibility envelope for the brainstorm.

**Suggested `subagent_type`:** `backend-development:backend-architect` (reading as a consumer) or `feature-dev:code-explorer`.

### Area 5 — `area-5-salvage-map`

**Question:** If the map is replaced, what existing frontend code, state, contracts, tests, and tooling survive — and what must be thrown away?

**Scope:** Catalogue every file under `frontend/` and classify each as **KEEP** (works unchanged), **REFACTOR** (concept survives, code needs rewrites for the new design), or **DISCARD** (map-specific, dies with the map). Be specific: `url-state.ts`, `api/client.ts`, `data/use-bird-data.ts`, `FiltersBar.tsx`, `SpeciesPanel.tsx`, `App.tsx` vs `Map.tsx`, `Region.tsx`, `Badge.tsx`, `BadgeStack.tsx`, `HotspotDot.tsx`, `geo/path.ts`. Do the same for `frontend/e2e/**` — which specs survive ("deep-link", "error-states", "a11y", "filters", "species-panel") vs which die with the map ("badge-containment", "paint-order", "expand-cap", "sizing", "stroke-scaling", "cross-region-badge-containment", "region-collapse"). Note the URL-param contract: `?region=` obviously needs reworking or deletion; `?since=`, `?notable=`, `?speciesCode=`, `?familyCode=` are design-agnostic.

**Deliverables:** A KEEP / REFACTOR / DISCARD manifest with file:line references, total survived-line-count, and a short list of things the brainstorm should treat as invariants (URL deep-linking contract, API client shape, filter semantics, species-detail sidebar, a11y approach).

**Suggested `subagent_type`:** `code-refactoring:legacy-modernizer` or `feature-dev:code-explorer`.

## Non-goals for this analysis

- Do not propose the replacement UI.
- Do not evaluate specific map libraries (Leaflet, Mapbox, deck.gl, react-map-gl, etc.) — that's brainstorm material.
- Do not refactor anything.
- Do not pick a winner among the surviving interaction paradigms (list vs feed vs grid vs timeline).

The **brainstorm** is the next phase; this analysis feeds it.
