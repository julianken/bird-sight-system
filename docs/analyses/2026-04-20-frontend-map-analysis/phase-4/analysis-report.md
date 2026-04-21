# Bird-Watch Frontend Map Analysis — Final Report

**Analysis:** 2026-04-20-frontend-map-analysis
**Audience:** Julian (solo developer on `bird-watch`, user of `bird-maps.com`, about to run a map-less reimagining brainstorm)
**Status:** Phase 4 unified synthesis. Inputs: 5 Phase 1 investigations, 5 Phase 2 iterations, 3 Phase 3 syntheses, 4 archived screenshots, live site at <https://bird-maps.com>.

---

## A) Executive Summary

The current SVG ecoregion map is not failing because of rendering bugs. It is failing because three decisions were collapsed into one — the ecoregion taxonomy as an organising frame, SVG polygons as the rendering target, and from-scratch SVG as the implementation — and each decision fails for its own reason. The ecoregion frame drops the dataset's most legible signals (observation date, latitude/longitude, per-sighting count) and imposes a geographic-taxonomic mental model most plausible visitors do not bring to the page. The SVG polygon rendering forced data-model contortions (a `parent_id` column and polygon vertex-clamping migrations) and now consumes 80% of recent PR throughput on correctness fixes. The implementation shipped 17 "here be dragons" comments of which 14 were predictable from SVG fundamentals and would have surfaced in a 2-hour prototype — the plan was wrong in a knowable way. Against that cost, the current UI scores 6/14 across seven inferred user tasks, with zero tasks fully supported.

The rescue is not a green-field build: 33% of production LOC survives any redesign unchanged, 16% survives with selector updates, and five latent data fields already on the wire (`obsDt`, observation `lat/lng`, `locName`/`howMany`, row-level `isNotable`, `taxonOrder`/`familyCode`) are pre-approved for integration with zero backend work. The `SpeciesPanel` + `useSpeciesDetail` + `FiltersBar` + `ApiClient` + URL-state stack is sound engineering buried behind the weakest interaction. Operationally, the ingestor has been stalled for 52+ hours at analysis time and `api.bird-maps.com` is uncompressed Cloud Run without the CDN the user memory assumes — both are parallel concerns the brainstorm should acknowledge without absorbing. The evidence supports reimagining, but it also supports sizing a 1-week rescue rather than assuming rescue is foreclosed. The brainstorm owns that sizing.

---

## B) Analysis Question & Scope

### Central question (restated from Phase 0)

> **Why is the map-based bird-watch frontend failing as a product, and what evidence should inform a map-less reimagining?**

### In bounds

- Current frontend source (`frontend/src/**`, `frontend/e2e/**`, `frontend/playwright.config.ts`, `frontend/vite.config.ts`).
- Spec frontend section (`docs/specs/2026-04-16-bird-watch-design.md` §Frontend / §Filters MVP / §Success criteria).
- Plan 4 (`docs/plans/2026-04-16-plan-4-frontend.md`).
- Backend read-API contract at the consumer boundary (request/response shapes only).
- Frontend GitHub PR/issue history and recent commit archaeology.
- Live rendered output via the four archived screenshots in `phase-0/screenshots/`.
- Salvage classification of existing frontend code.

### Out of bounds

- Backend re-architecture. The API contract is considered stable and sufficient.
- Database, ingestor, and infrastructure work (Plans 1, 2, 5). The ingestor stall is flagged as a parallel operational concern; fixing it is not this analysis's output.
- Evaluating specific replacement technologies (Leaflet, Mapbox, deck.gl, feed UIs, list UIs). That is brainstorm territory.
- Proposing the replacement design itself. This analysis describes what fails and what must be preserved; it does not design what comes next.
- eBird API / Phylopic / ecoregion data sources — immutable external dependencies.

### Depth

Targeted deep-dive. Not a broad codebase audit.

---

## C) Table of Contents

| Section | Summary |
|---|---|
| A Executive Summary | Seven-sentence distillation. Three collapsed decisions, one preservable stack, five free wins. |
| B Analysis Question & Scope | Restated from Phase 0. Frontend and salvage classification in; backend re-architecture out. |
| C Table of Contents | This table. |
| D Methodology | Five investigators, five iterators, three syntheses, static analysis plus live probes. Establishes traceability. |
| E Key Findings | Twelve findings grouped into four themes: Ecoregion frame, data legibility, engineering ledger, scaffolding. Ordered by confidence × impact. |
| F Analysis & Implications | The weave. The three separable decisions, the six reframes, the task-fit matrix, the tensions the syntheses preserve, the operational incident as parallel concern. |
| G Confidence Assessment | High on the ledger, data inventory, and separation. Medium on task scores and rescue ceiling. Low on mobile-viewport feasibility and user behaviour. |
| H Recommendations | Six high-level process recommendations for the brainstorm — no UI designs, no library picks. |
| I Open Questions | Five must-answer brainstorm questions and the blind spots Julian owns. |
| J Appendix: Evidence Index | Comprehensive findings → source → type → location table. |

---

## D) Methodology

### Phase structure

This was an `analysis-funnel` 5 → 5 → 3 → 1 pipeline. Five Phase 1 investigators examined independent facets of the central question. Five Phase 2 iterators stress-tested or extended those findings. Three Phase 3 synthesizers applied distinct lenses (thematic, risk/opportunity, gap/implication) to the combined evidence. This Phase 4 unifier wove the three lenses into one document.

### Phase 1 — Five parallel investigators

- **Area 1 — Visual-UX audit** (`phase-1/area-1-visual-ux-audit.md`): UX critique of each archived screenshot with fixable-vs-inherent classification.
- **Area 2 — Rendering-complexity audit** (`phase-1/area-2-rendering-complexity-audit.md`): "Here be dragons" inventory, LOC counts, churn metrics, migration trace-back.
- **Area 3 — User-task fit** (`phase-1/area-3-user-task-fit.md`): Seven inferred user tasks graded against the current UI across three user archetypes.
- **Area 4 — Data/API surface** (`phase-1/area-4-data-api-surface.md`): Field-level inventory of what the backend serves vs what the UI reads; list of UI shapes the data naturally supports.
- **Area 5 — Salvage map** (`phase-1/area-5-salvage-map.md`): File-by-file KEEP/REFACTOR/DISCARD classification for `frontend/src/**` and `frontend/e2e/**`.

### Phase 2 — Five iterators

- **Iterator 1 — Task-surface matrix** (`phase-2/iterator-1-task-surface-matrix.md`): Scored three candidate paths (A non-spatial, B real basemap, C hybrid) against the Area 3 task set.
- **Iterator 2 — Production data volume** (`phase-2/iterator-2-production-data-volume.md`): Live probes of `/api/observations`, `/api/hotspots`, `/api/regions`, `/api/species/:code` against production `api.bird-maps.com`. Surfaced the ingestor stall and the uncompressed-API finding.
- **Iterator 3 — Concept salvage** (`phase-2/iterator-3-concept-salvage.md`): Concept-level (not file-level) inventory of 22 frontend concepts, classified UI-AGNOSTIC / MAP-SHAPED / LATENT / MAP-BOUND.
- **Iterator 4 — Red team** (`phase-2/iterator-4-red-team.md`): Four counter-narratives against the emerging consensus; graded credibility.
- **Iterator 5 — Historical timeline** (`phase-2/iterator-5-historical-timeline.md`): Tombstone reconstruction of what the plan assumed vs what production proved; predictability taxonomy for the 17 rendering dragons.

### Phase 3 — Three synthesizers

- **Synthesis 1 — Thematic** (`phase-3/synthesis-1.md`): Five-theme narrative centred on the ecoregion frame as root cause, data silence, engineering ledger, knowable plan gap, scaffolding integrity.
- **Synthesis 2 — Risk/Opportunity** (`phase-3/synthesis-2.md`): Ten severity-rated risks (R1–R10), eleven value-rated opportunities (O1–O11), risk × opportunity matrix.
- **Synthesis 3 — Gap/Implication** (`phase-3/synthesis-3.md`): Eight decisions the analysis closes, six questions it cannot close, six reframes, five must-answer brainstorm questions.

### Evidence types

- **Code citations:** `frontend/src/**`, `migrations/**` with file:line precision.
- **Live production probes:** `api.bird-maps.com` measurements at analysis time.
- **Screenshots:** Four archived captures in `phase-0/screenshots/`, captured once at commit time; no re-probes (per Phase 0 packet §Screenshot policy).
- **GitHub archaeology:** PR and issue history via `area:frontend` label.
- **Spec/plan citations:** `docs/specs/2026-04-16-bird-watch-design.md`, `docs/plans/2026-04-16-plan-4-frontend.md`.

### Constraints

No user research was performed. No UI libraries were evaluated. No frontend code was modified. The ingestor stall was flagged and left alone. Static analysis plus four archived screenshots is the evidentiary ceiling; the task-fit matrix is analytically derived, not empirically validated.

---

## E) Key Findings

Findings are grouped into four themes — ecoregion frame, data legibility, engineering ledger, scaffolding integrity — and ordered within each theme by combined confidence × impact.

### Theme: The Ecoregion Frame as Imposed Metaphor

#### Finding E1: The ecoregion taxonomy is an imposed metaphor most plausible visitors do not bring to the page.

- **Confidence:** High.
- **Evidence:**
  - Three user archetypes inferred in `phase-1/area-3-user-task-fit.md`: visiting birder, local birder, nature-curious non-birder. Only the local birder with prior ecoregion familiarity is plausibly served by the default view; all three archetypes hit zero on T2 ("near a place"), T5 ("where to go"), T7 ("what's new"), per Phase 1 Convergence 4.
  - `phase-0/screenshots/bird-maps-default-1440.png`: no region labels, no legend, no state outline, no place names.
  - Phase 0 packet anchor 2 / live DOM query: three Sky Islands regions share fill `#B84C3A` (`sky-islands-chiricahuas`, `sky-islands-huachucas`, `sky-islands-santa-ritas`), making the one subrange a local birder might identify visually indistinguishable across three polygons.
- **Impact:** The default visual frame excludes the two largest plausible visitor archetypes. Every downstream rendering cost is paid in service of a frame that is not the user's mental model.
- **Related findings:** E2 (data silence), F3 (engineering ledger). Synthesis 1 Theme 1 makes this the root finding.

#### Finding E2: The ecoregion frame actively misdirects on spatial resolution.

- **Confidence:** High.
- **Evidence:**
  - Observation `lat/lng` is on every `/api/observations` wire row (`packages/shared-types/**` + `frontend/src/api/client.ts`); frontend grep for `o.lat|o.lng|observation.lat|observation.lng` returns zero matches in production code (`phase-1/area-4-data-api-surface.md`; Phase 1 packet Surprise 2).
  - Badge position is computed as the polygon's pole-of-inaccessibility via `geo/path.ts:225-301` — a geometric centroid with no relation to any actual sighting coordinate.
  - `phase-1/area-1-visual-ux-audit.md` calls this "actively misleading" spatial encoding. A polygon covering thousands of square kilometers contains badges the user reads as local clusters.
- **Impact:** T2 ("near a place") and T5 ("where to go") score 0 not because the data is absent but because the display coarsens it. This is the single biggest task-fit failure of the current design.
- **Related findings:** E1, F1.

#### Finding E3: The ecoregion concept survives redesign as a filter/facet; it does not survive as a default visual container.

- **Confidence:** High.
- **Evidence:**
  - Iterator 3 (`phase-2/iterator-3-concept-salvage.md`) classifies ecoregion taxonomy as MAP-SHAPED, not MAP-BOUND — concept survives, expression changes.
  - Iterator 4's Counter 1 (`phase-2/iterator-4-red-team.md`) notes colour legend and vocabulary issues are in-metaphor fixable — the taxonomy itself is not the rendering problem.
  - URL state `?region=sky-islands-huachucas` already works as a filter parameter in `frontend/src/state/url-state.ts`; no architectural change is needed to demote ecoregion from default visual container to filter param.
- **Impact:** The brainstorm inherits a design vocabulary that works as a secondary filter without preserving the rendering cost. This is a reframe, not a removal.
- **Related findings:** E1, I4 (below — `?region=` migration policy).

### Theme: Rich Data, Silent Display

#### Finding F1: The backend serves 12 fields the UI ignores; `obsDt` is the single most indefensible omission.

- **Confidence:** High.
- **Evidence:**
  - Phase 1 Convergence 2 documents 12 populated fields dropped at display time: `obsDt`, observation `lat`/`lng`, `howMany`, `subId`, `latestObsDt`, row-level `isNotable`, `locId`/`locName`, `taxonOrder`, `familyCode` (on species), and hotspot `regionId`.
  - Server code (`services/read-api` routes) orders `/api/observations` by `obs_dt DESC` (Phase 1 Surprise 3, `observations.ts:147`).
  - Spec `§Filters MVP` (line 233-245) mandates a `since=` filter. `FiltersBar` exposes the time-window control. No displayed timestamp exists anywhere in the rendered UI.
  - Frontend grep for `obsDt` usage returns zero display-side matches.
- **Impact:** Server orders by time, filter bar filters on time, data carries time, display suppresses time. T7 ("what's new") scores 0 for this reason alone. Iterator 4 Counter 2 concedes this is the one field whose omission is indefensible.
- **Related findings:** E2, H6 (recommendation).

#### Finding F2: Five latent concepts are pre-approved for integration with zero backend changes required.

- **Confidence:** High.
- **Evidence:**
  - Iterator 3's LATENT category (`phase-2/iterator-3-concept-salvage.md`; Phase 2 packet Theme 6): `obsDt` (per-observation timestamps), observation `lat/lng` (per-observation location), `locName` + `howMany` (location name and individual count), row-level `isNotable` (per-observation rarity flag), `taxonOrder` + `familyCode` (taxonomic ordering).
  - All five are on the API response per `packages/shared-types/**`.
  - Iterator 2 (`phase-2/iterator-2-production-data-volume.md`) measured `?since=14d` at 344 species / 101 KB / 220–280 ms TTFB. Volume does not constrain any feed, scatter, or list rendering of these fields.
- **Impact:** These five fields are the "first-day wins" of any path the brainstorm chooses. They collectively move T2, T5, and T7 from score 0 toward score 2 without touching the backend.
- **Related findings:** F1, H6.

#### Finding F3: Backend pre-aggregation to species-per-row is a semantic caveat that bounds which redesign tasks are cheap.

- **Confidence:** High.
- **Evidence:**
  - Iterator 2 Finding 1 (`phase-2/iterator-2-production-data-volume.md`; Phase 2 Theme 1 Corollary): `/api/observations` returns one row per species, not one row per sighting. `obsDt` on the row is the most-recent or most-representative observation date for that species, not a time-series.
  - Any metric on species counts (diversity, rarity by family, first-seen-in-window) is cheap — just read the fields.
  - Any metric on observation counts (abundance over time, checklist volume, individual-sighting detail) requires a new backend aggregate endpoint.
- **Impact:** Determines whether the first release needs backend work. If T2 ("where *exactly* did this show up?") in its single-sighting form is in release 1, a new endpoint is in scope. If release 1 stays in the species-aggregate space (T1, T3, T4, T7), no backend work is required.
- **Related findings:** F2, I3.

### Theme: The Engineering Ledger

#### Finding G1: Eight of the last ten merged PRs are rendering correctness fixes; this is not a sprint — it is the steady state.

- **Confidence:** High.
- **Evidence:**
  - Phase 0 packet anchor 6: PR sequence #80 → #81 → #87 → #99 → #88 → #100 → #93 → #98 → #77 → #78 → #94 → #96 → #101 → #92. Fourteen PRs with rendering correctness in their summary.
  - `phase-1/area-2-rendering-complexity-audit.md` quantifies 8/10 most-recent PRs as rendering fixes; the ratio has been stable across ~30 PRs.
  - Current branch `refactor/two-pass-map-render` is mid-architectural-pivot from per-region `<g>` to two-pass layer structure — the pivot began within 4 days of first deploy and is still in progress as of this analysis (Iterator 5 trajectory verdict, `phase-2/iterator-5-historical-timeline.md`).
- **Impact:** At 8/10 merge share, the project has effectively no capacity for feature work. Synthesis 2 rates this risk R1 — High severity, near-certain if status quo persists. The solo-developer constraint compounds it.
- **Related findings:** G2, G3.

#### Finding G2: 17 rendering dragons exist; 14 were predictable from SVG fundamentals or domain knowledge — a 2-hour prototype would have caught them.

- **Confidence:** High on the count and categorisation. Medium on the "2-hour prototype would have caught them" counterfactual.
- **Evidence:**
  - Iterator 5 (`phase-2/iterator-5-historical-timeline.md`; Phase 2 packet Theme 3) inventories 17 dragons and applies a predictability taxonomy:
    - "Predictable from SVG fundamentals" (paint-order z-index, `transform-origin`, non-scaling-stroke, drop-shadow coordinate space): 4 dragons.
    - "Predictable from domain knowledge" (concave sky-island polygon geometry; inscribed-rect and pole-of-inaccessibility requirements obvious from Arizona sky-island topography): 10 dragons.
    - "Genuinely emergent" (exact `EXPAND_MAX_BBOX_FRAC` scale values, Safari `vector-effect` bug, pip-offset regression): 3 dragons.
  - `frontend/src/styles.css:35` contains a tombstoned `transform-origin: center` comment with four-line explanation of SVG coordinate basics.
  - `frontend/src/styles.css:13` contains a tombstoned `.badge-stack { transform: scale(1.5) }` comment.
  - Five Plan 4 task-level assumptions were invalidated within four days of first deploy.
- **Impact:** The plan was wrong in a knowable way. The lesson generalises forward: the next plan should include a mandatory prototype gate before task-by-task code is committed.
- **Related findings:** G1, H4.

#### Finding G3: Data-model modifications exist solely to serve SVG rendering — 306 SQL LOC become eligible for removal.

- **Confidence:** High.
- **Evidence:**
  - Migration `migrations/1700000011000_fix_region_boundaries.sql` and migration `migrations/1700000012000_fix_sky_islands_boundaries.sql` perform polygon vertex clamping to avoid SVG z-fighting (Phase 1 Surprise 1).
  - `parent_id` column on the `regions` table (migration `migrations/1700000002000_regions.sql` + Phase 1 Surprise 1) serves paint-order sort in `Map.tsx:60-87`, not a real data hierarchy.
  - Combined: ~306 SQL LOC committed in service of the SVG renderer, not the data model.
- **Impact:** The rendering choice propagated backward into the schema. Retiring SVG retires 306 SQL LOC of schema contortion — a rare bonus of a frontend redesign.
- **Related findings:** G1, G2, E3.

#### Finding G4: Task-fit matrix: current design scores 6/14 across seven inferred tasks. No task scores 2.

- **Confidence:** Medium (task-fit scores are analytically derived from Phase 1 Area 3 task inference; no user research validates them).
- **Evidence:**

| Task | Current | Path A (non-spatial) | Path B (real basemap) | Path C (hybrid) |
|---|---:|---:|---:|---:|
| T1 notable now | 1 | 2 | 1 | 2 |
| T2 near a place | 0 | 1 | 2 | 2 |
| T3 species detail | 1 | 2 | 1 | 2 |
| T4 browse by family | 1 | 2 | 1 | 2 |
| T5 where to go | 0 | 1 | 2 | 2 |
| T6 diversity at a glance | 1 | 1 | 2 | 2 |
| T7 what's new | 0 | 2 | 1 | 2 |
| **Total** | **6** | **11** | **9** | **14** |

- **Impact:** The engineering investment buys visual complexity without buying usability. The 8/14 delta between current and Path C defines the upper-bound gain available from a reimagining. The 5/14 delta from current to Path A defines a safer starting posture.
- **Related findings:** G1–G3, I1.

### Theme: Scaffolding Integrity

#### Finding S1: 33% of production LOC is KEEP-unchanged; 16% is REFACTOR (selector/layout updates); 51% is DISCARD.

- **Confidence:** High.
- **Evidence:**
  - Phase 1 Area 5 manifest (`phase-1/area-5-salvage-map.md`; Phase 1 Convergence 3):
    - **KEEP (653 LOC production):** `frontend/src/api/client.ts`, `frontend/src/data/use-bird-data.ts`, `frontend/src/data/use-species-detail.ts`, `frontend/src/state/url-state.ts`, `frontend/src/derived.ts`, `frontend/src/components/FiltersBar.tsx`, `frontend/src/components/SpeciesPanel.tsx` (interaction logic), `frontend/src/App.tsx` (partial).
    - **REFACTOR (~400 LOC):** `SpeciesPanel` layout (`styles.css:94-100` `position: fixed` must change in non-map context), potential `ApiClient` pagination extensions, `App.tsx` routing partial.
    - **DISCARD (~1,300 LOC production + ~1,100 LOC tests):** `components/Map.tsx`, `components/Region.tsx`, `components/Badge.tsx`, `components/BadgeStack.tsx`, `components/HotspotDot.tsx`, `geo/path.ts`, associated unit tests and CSS.
  - E2E specs: 8/16 KEEP (`a11y`, `axe`, `deep-link`, `error-states`, `filters`, `history-nav`, `species-panel`, `prod-smoke.preview`); 8/16 DISCARD (`badge-containment`, `cross-region-badge-containment`, `expand-cap`, `paint-order`, `sizing`, `stroke-scaling`, `region-collapse`, `happy-path`).
- **Impact:** The reimagining is not a greenfield build. The brainstorm can direct its generative energy at the display layer with confidence that the plumbing behind it is solid.
- **Related findings:** S2, S3, H1.

#### Finding S2: `SpeciesPanel` is the strongest component, buried behind the weakest interaction.

- **Confidence:** High.
- **Evidence:**
  - `phase-1/area-5-salvage-map.md` nominates `SpeciesPanel` + `useSpeciesDetail` as the cleanest code in the repo: accessible (axe-clean), deep-linkable (`?species=code`), ESC-dismissible, tested (`species-panel.spec.ts`).
  - `phase-1/area-3-user-task-fit.md` grades T3 ("I think I saw X — tell me more") as the one task where the panel supports the deepest interaction.
  - `phase-1/area-1-visual-ux-audit.md` / Phase 1 Surprise 4: the panel is reached only by expanding the wrong thing (ecoregion polygon) and clicking an illegibly-labelled generic-silhouette badge.
- **Impact:** The redesign is structurally an unburying task, not a rebuilding task. Synthesis 2 flags the associated risk R4: `position: fixed` must be reworked in any non-map layout.
- **Related findings:** S1, H3.

#### Finding S3: 22 frontend concepts inventoried: 9 UI-agnostic transfer unchanged, 5 latent ship for free, 7 map-shaped survive with rework, 1 is map-bound.

- **Confidence:** High for the classification. Medium for the concept-level transfer claims (assumes the reimagined UI preserves general interaction patterns).
- **Evidence:**
  - Iterator 3 (`phase-2/iterator-3-concept-salvage.md`; Phase 2 packet Theme 6):
    - **9 UI-AGNOSTIC:** deep-linkable filter state, notable elevation, time-window filter, URL-driven detail panel, accessible-name-first interaction, axe-scan discipline, `test.fail()` pattern for in-progress features, species-stacked aggregation (`layoutBadges` concept, 28 LOC inside a DISCARD file), species code normalisation.
    - **5 LATENT:** `obsDt`, observation `lat/lng`, `locName`/`howMany`, row-level `isNotable`, `taxonOrder`/`familyCode` (see F2).
    - **7 MAP-SHAPED:** colour-by-family, count chip, overflow summary, activity-level size encoding, region selection, region hierarchy, ecoregion taxonomy — survive in altered expression.
    - **1 MAP-BOUND:** inline-expand / `computeExpandTransform` — drops entirely.
- **Impact:** The brainstorm inherits a design vocabulary, not a constraint list. Concept-level thinking lets the brainstorm separate what the current design *means* from how it *renders*.
- **Related findings:** S1, S2, H1.

---

## F) Analysis & Implications

### F.1 The three separable decisions

The single most important reframe the analysis produces is that "ditch the map" — the user's pre-analysis framing — is not one decision but three. Synthesis 3 Reframe 1 and Synthesis 1 Theme 1 both name the separation explicitly; Iterator 4 identified the collapse as a methodological blind spot.

**Decision 1 — Retire SVG polygon rendering.** Evidence strongly in favour of retirement. 17 dragons, 14 predictable from fundamentals (G2), 8/10 PR churn rate (G1), 306 SQL LOC of schema contortion in service of SVG (G3), 1,300 LOC plus 1,100 test LOC of DISCARD (S1). The only credible counter comes from Iterator 4 Counter 4 ("execution not design, moderate credibility"): a real mapping library would close ~80% of the dragons. That counter argues against continuing *from-scratch SVG*, not against any spatial display — it narrows the question rather than resolving it.

**Decision 2 — Demote the ecoregion taxonomy from primary visual container.** Evidence in favour of demotion, not removal. Finding E1 (most archetypes do not carry the mental model) and Finding E2 (frame coarsens the data's real spatial resolution) argue against the ecoregion as the default entry. Finding E3 argues the concept survives as a filter/facet. Iterator 4 Counter 1 ("UX failures are in-metaphor fixable, moderate credibility") does not overturn the demotion; it suggests colour legend and Sky Islands disambiguation could be fixed if the ecoregion remained primary — but even then, the task-fit failures on T2/T5/T7 would persist because the *frame*, not the *rendering*, is what coarsens the data.

**Decision 3 — Retire from-scratch SVG implementation, whether or not spatial display returns.** Evidence permissive but not forcing. If Decision 1 is yes, the from-scratch implementation is retired by default. If Decision 1 is no, Decision 3 becomes its own question: would a real mapping library retire the 14 predictable dragons while preserving the spatial affordance? The analysis does not answer this — libraries are out of bounds — but it does say that closing 80% of the engineering ledger is on the table.

A brainstorm that collapses them again will generate designs it cannot sequence.

### F.2 Thematic spine: imposed frame → silent data → unbalanced ledger

Synthesis 1's thematic spine names the causal chain the findings make visible. The ecoregion frame (E1) forces spatial aggregation that drops the data fields most useful to users (F1). The coarse aggregation then requires a bespoke rendering engine — polygons must be laid out without overlap, badges must fit inside them, expand transforms must cap before the canvas blows up (G1). Every engineering cost is downstream of the frame choice.

The feedback loop Synthesis 1 names is that sound scaffolding (S1) masks the severity of the display-layer failure. The plumbing works. Tests pass. Filters filter. If the only signal the developer received were "does the code run," the answer would be "yes." The churn rate became the signal that broke through, but the underlying fit failure existed from first deploy.

### F.3 Risk ledger: what the brainstorm must navigate

Synthesis 2 rated 10 risks. The ones most relevant to the brainstorm, with ratings preserved:

| ID | Risk | Severity | Likelihood |
|---|---|---|---|
| R1 | Rendering churn escalates to blocking | **High** | Near-certain if status quo persists |
| R2 | Ingestor stall masks data volume assumptions | **High** | Likely (healthy volume almost certainly higher than stall volume) |
| R3 | Reimagining recreates ecoregion-taxonomy problem in a new medium | **High** | Possible |
| R6 | Path-C ceiling mismatched to Path-A implementation rubric | **Medium** | Possible |
| R7 | "Ditch the map" misread as "ditch spatial entirely" | **Medium** | Possible |
| R10 | Process failure repeats — plan authored before prototype validation | **High** | Possible |

**R1** is the thesis of G1. If no decision is made, the current trajectory continues; 8/10 PR churn compounds; another architectural pivot starts, and the cycle repeats.

**R2** anchors to Iterator 2's measurement of a 52+ hour ingestor stall at probe time (newest observation 52.76 hours old, `?since=1d` returns `[]`, `/api/hotspots` returns `[]`). The 344-row / 101 KB measurements are correct but may describe a degraded regime. Healthy-ingest volumes are estimated at 1,500–2,000 rows — still inside any rendering budget, but the margin narrows.

**R3** is the risk that the brainstorm replaces the ecoregion taxonomy with a different wrong taxonomy — county lines, admin regions, anything that aggregates by area and maintains the equal-weight visual encoding for unequal data density. Observation density is skewed roughly 40× (Sonoran ~40 species vs Grand Canyon 2 species). Any taxonomy that treats all regions as equal tiles reproduces the failure class.

**R6** is the composability trap. Path C (hybrid, 14/14) is strictly dominant on task fit, but it is Path A (non-spatial, 11/14) plus Path B (real basemap, 9/14) mode layered on. The risk is shipping Path A, calling it Path C, and leaving Path B "coming soon" indefinitely. Six months later, T2/T5/T6 still score 1.

**R7** is the semantic trap. The user said "ditch the map," but the analysis cannot tell whether "ditch" means "retire SVG ecoregion polygons" or "retire geography entirely." Path A leaves T2 and T5 at score 1; Path B or C raises them to 2. This is Iterator 4's "personal project bias" blind spot raised to a risk. The brainstorm must ask.

**R10** is the process risk. Finding G2 established that 14 of 17 dragons were knowable before plan authorship. If the next plan is committed at the same granularity without a prototype gate, the failure mode is reproducible in any rendering approach the brainstorm picks.

### F.4 Opportunity side: free wins and staged delivery

Synthesis 2's opportunity inventory identifies eleven. The four that matter most to the brainstorm:

- **O1 — Resurrect `obsDt`.** Zero backend changes. Moves T7 from 0 toward 2.
- **O2 — Resurrect observation `lat/lng`.** Zero backend changes for non-spatial display; Medium cost for scatter plot on a basemap. Moves T2 and T5 from 0 toward 2.
- **O6 — Enable gzip on the API.** One-line Hono `compress()` middleware or Cloud Run setting. ~90% payload reduction. This is an infrastructure prerequisite for any mobile-viable design, not a design consideration.
- **O7 — Mandatory prototype gate before plan authorship.** 2–4 hours of prototyping saves weeks of correctness-fix cycles.

### F.5 Task-fit scoring and the three paths

Iterator 1's path scoring (G4) frames the decision space:

- **Path A — Non-spatial** (feed, list, grid, species hub). Score 11/14. Gain 5 over current. T2 and T5 move from 0 to 1 (better but not resolved).
- **Path B — Real basemap** (tile map with observation scatter). Score 9/14. Wins T2 and T5 decisively (score 2) but loses ground on T1/T3/T4/T7 because the spatial-first framing de-emphasises species browse and time.
- **Path C — Hybrid** (non-spatial primary + optional spatial mode). Score 14/14. All tasks score 2. Path A and B composable; they share state contract and KEEP infrastructure.

Path C is strictly dominant on task fit. The tension the three syntheses preserve is about how hard to push it:

- **Synthesis 1** treats Path C as the leading option because it dominates.
- **Synthesis 2** flags R6 as a real risk — shipping Path A and deferring Path B indefinitely becomes the likely outcome under solo-developer time pressure.
- **Synthesis 3** lists "Path A/B phase boundary" as question 5 of 5 — a decision Julian must make consciously.

The evidence permits the brainstorm to commit to Path C up front or to commit to Path A with a concrete gate for Path B. What it does not permit is handwaving the composability claim.

### F.6 Scaffolding as asset — the brainstorm is not starting from zero

Findings S1–S3 converge on a single message: the reimagining inherits working infrastructure. 33% KEEP + 16% REFACTOR = 49% of production code survives. 8 of 16 e2e specs survive. 9 concepts transfer unchanged. The `SpeciesPanel` is the strongest feature in the repo reached only through the weakest interaction.

This reframes the brainstorm's starting posture. "Starting from scratch" is the natural framing when retiring 1,300 LOC. "Inheriting half a working product" is the framing the evidence supports. The difference changes what the brainstorm can assume: state contract, filter semantics, species detail hook, accessibility discipline, and URL deep-link contract are all givens.

One caveat: Iterator 4 Counter 3 partially upgrades `SpeciesPanel` from KEEP to REFACTOR — the `position: fixed` layout at `styles.css:94-100` must change in a non-map layout. Interaction logic, hook, and deep-link contract survive; CSS positioning block does not.

### F.7 Parallel operational concerns — flag, don't absorb

**Incident 1: The ingestor has been stalled 52+ hours.** Iterator 2 probed `api.bird-maps.com`: newest observation 52.76 hours old, `?since=1d` returned `[]`, `/api/hotspots` returned `[]`. This is outside scope of the frontend analysis, but:

- Volume feasibility claims (344 rows, 101 KB) describe a degraded regime. Healthy-ingest volumes estimated 4–6× higher.
- Any visitor during the stall sees a site that looks broken regardless of rendering.
- The brainstorm may feel like a haunted-house tour if the ingestor is still stalled when it runs.

Recommendation: if still stalled at brainstorm time, fix first (an hour's work, probably). Not a redesign decision.

**Incident 2: `api.bird-maps.com` is direct Cloud Run, not behind Cloudflare.** User memory states "Cloudflare fronts the deployment"; accurate for the apex but incorrect for the API subdomain. No CDN, no gzip, no shared cache. `Cache-Control` directives are browser-only. At healthy ingest without compression, payload sizes reach 400–600 KB. Enabling gzip eliminates this.

### F.8 Gaps and unknowns the analysis preserves

- **No user research.** Every finding is static analysis or live API probing. The archetype inference, task-fit grades, and "imposed metaphor" claim are analytical.
- **Mobile-viewport feasibility beyond one screenshot.** Only `phase-0/screenshots/bird-maps-mobile-390.png`. No other viewport measurements exist.
- **Healthy-ingest volume extrapolation.** 344 baseline measured; 1,500–2,000 healthy inferred.
- **Rescue-vs-reimagine effort comparison.** Iterator 5 sized the rescue (3–5 dragons). No iterator scoped reimagining duration.

### F.9 Tensions preserved across the three syntheses

1. **Weight on rescue vs reimagine.** Synthesis 1 treats rescue as a weak option (moderate-credibility counter). Synthesis 2 treats it as a Medium-value Low-cost stabilisation tax. Synthesis 3 makes it a priority-2 brainstorm question. All three must be carried: rescue is viable, is unlikely to end the trajectory on its own, and must be sized explicitly before being ruled out.

2. **How hard to push Path C.** Synthesis 1 treats Path C as the leading option. Synthesis 2 flags R6 — Path C's split-ship nature becomes Path A plus deferred Path B under time pressure. Synthesis 3 treats the Path A/B phase boundary as a question, not a directive. Path C looks best on paper; its split-ship nature is the risk.

3. **How much to emphasise the user-research gap.** Synthesis 1 names it but does not foreground it. Synthesis 2 does not touch it directly. Synthesis 3 makes it Question 1 and explicitly says leave user research out of the brainstorm. Acknowledge the gap without paralysing action — designs will be bets regardless, and naming the bet is the honest move.

---

## G) Confidence Assessment

### Overall confidence: Medium-High

The evidence base is large and internally consistent. Direct code citations with file:line precision. Live production probes. No raw claims without backing.

### Strongest claims (High confidence)

- **The engineering ledger.** LOC counts, dragon counts, PR churn rate, migration trace-back — all counted directly.
- **The data-surface inventory.** 12 fields populated on the wire vs 12 fields dropped at display, confirmed by frontend grep.
- **The three-decision separation** (ecoregion taxonomy / SVG rendering / from-scratch implementation). Grounded in Iterator 4's explicit blind-spot language and Iterator 3's concept-classification taxonomy.
- **The 33% KEEP salvage fraction.** Direct file-level classification in Phase 1 Area 5, cross-referenced with Iterator 3's concept-level inventory.
- **The rendering-churn trajectory.** 8/10 most recent PRs as rendering fixes directly counted; branch name `refactor/two-pass-map-render` observable fact.
- **The five latent concepts pre-approved for integration.** Each traced to a specific wire field with zero frontend usage.

### Moderate claims (Medium confidence)

- **The task-fit scores.** Iterator 1's 14-point matrix is analytically derived. No user research validates the task set or the grades.
- **The 1–2 week rescue ceiling.** Iterator 5's estimate that 3–5 of 18 dragons close in a focused week is an informed estimate, not a measured bound.
- **The healthy-ingest volume extrapolation.** 1,500–2,000 rows is inferred from eBird Arizona activity patterns; not measured.
- **The "2-hour prototype would have caught 14 dragons" counterfactual.** Tombstone evidence accurate; counterfactual timing plausible but not verified.
- **The concept-level transfer claims.** Assumes the reimagined UI preserves general interaction patterns.

### Weakest claims (Low confidence)

- **Individual UI-shape feasibility at mobile viewports.** Only one mobile screenshot (`phase-0/screenshots/bird-maps-mobile-390.png`). No measurements of alternative layouts at 390px, 320px, or tablet sizes. Any redesign's mobile feasibility is a bet until prototyped.
- **What actual users do on `bird-maps.com`.** Zero user research. The three archetypes are inferred.
- **Whether user satisfaction correlates with task-fit scores.** Aesthetic preference, emotional engagement, or the pleasure of map-driven exploration could create satisfaction that task scores do not predict.

### Known blind spots

- **No user observation.** The biggest single limit.
- **Mobile beyond 390×844.** Only one viewport probed.
- **Effort-envelope modelling.** Risk and opportunity ratings assume a solo developer; some High-value Medium-cost opportunities may be 3× longer than the rating suggests.
- **Julian's personal-project dimension.** The "ditch the map" framing could be engineer fatigue reified as a design conclusion — or it could be correct. Static analysis cannot tell.

---

## H) Recommendations

Six recommendations. All are about how Julian should approach the brainstorm and what decisions to size — not UI designs, not library picks, not code changes.

### Recommendation H1: Treat the scaffolding as asset, not debt.

- **Priority:** High.
- **Rationale:** Findings S1, S2, S3. 33% KEEP + 16% REFACTOR = 49% of production code survives. Eight of sixteen e2e specs survive. Nine concepts transfer unchanged. Entering the brainstorm with "what do we keep and build on" produces different options than entering with "what do we throw out."
- **Trade-offs:** Anchoring on existing assets could bias the brainstorm toward incrementalism. A truly radical redesign might correctly discard some KEEP items. Hold the 653 LOC KEEP as a permissive floor, not a ceiling.
- **Open questions:** Does the reimagined UI preserve the interaction patterns (filter bar, species panel, URL state) the KEEP classification assumes?

### Recommendation H2: Before the brainstorm opens, answer the "ditch SVG" vs "ditch geography" question.

- **Priority:** High.
- **Rationale:** Risk R7 + Synthesis 3 Question 2. The user said "ditch the map." The analysis cannot tell whether "map" means SVG ecoregion polygons or geographic UI entirely. The answer determines whether Path A or Path C is the target and changes implementation scope by weeks. Every other brainstorm question branches from this one.
- **Trade-offs:** Committing to "ditch geography entirely" before the brainstorm might prematurely foreclose options. Committing to "keep geography as a future mode" might inflate scope.
- **Open questions:** If geography is retained, does it launch in release 1 (Path C up front) or release 2 (Path A now, Path B gated)?

### Recommendation H3: Bring a prioritised user archetype into the brainstorm. Do not pick it during.

- **Priority:** High.
- **Rationale:** Synthesis 3 Question 1. The three inferred archetypes — visiting birder, local birder, nature-curious non-birder — have different default surfaces. The visiting birder wants a hotspot list with recent sightings; the local birder wants a species feed filtered to the Chiricahuas; the nature-curious non-birder wants notable sightings framed as "what's cool this week." A 30-second product call Julian makes for himself, before the brainstorm, not during it.
- **Trade-offs:** Prioritising one archetype in release 1 does not preclude serving others later, but shapes the first iteration. Refusing to prioritise produces a "flat" surface that serves no one well.
- **Open questions:** Which of T1 (notable now), T2 (near a place), T4 (browse by family), or T7 (what's new) is the default entry task?

### Recommendation H4: Commit to a mandatory prototype gate before the next plan is authored.

- **Priority:** High.
- **Rationale:** Synthesis 2 O7 + Finding G2. Fourteen of seventeen dragons were predictable from SVG fundamentals or domain knowledge. A 2-hour prototype at production dimensions with representative data (1,500–2,000 observations, mobile + desktop viewports) would have surfaced them before task-by-task code was committed. The opportunity is not "do not use SVG"; it is "validate the chosen rendering approach at production dimensions before committing a plan body." Applicable to whatever the brainstorm chooses — feed UIs have their own dragons (virtualisation, keyboard navigation, deep-link restoration on scroll), basemap UIs have different dragons (tile loading, marker clustering, mobile gestures).
- **Trade-offs:** Adds 2–4 hours to the next plan authoring cycle. Delays task-by-task implementation. Saves weeks of post-ship correctness cycles.
- **Open questions:** Where does the gate live — `CLAUDE.md` conventions, plan template, superpowers skill invocation? This is a candidate CLAUDE.md convention update, not a one-off note.

### Recommendation H5: Size the rescue-vs-reimagine decision explicitly. Do not assume it.

- **Priority:** Medium-High.
- **Rationale:** Synthesis 3 Question 3 + R1. Iterator 5 sized the rescue (3–5 of 18 dragons in a focused week). The evidence allows three defensible paths:
  - **Rescue:** 1-week focused pass; closes 3–5 dragons; leaves 13–15 structural dragons and UX failures intact. Keeps current trajectory alive.
  - **Path A reimagine:** 2–3 weeks to ship a non-spatial UI. Scores 11/14. Defers geographic mode.
  - **Path C reimagine:** Longer — Path A plus Path B geographic mode. Scores 14/14. Risk R6 if ungated.
  Any is defensible with honest framing. "Undecided" reproduces the failure mode the current branch is an example of. Budget 10 minutes of brainstorm time explicitly.
- **Trade-offs:** Sizing requires scoped-effort estimates no iterator produced. The brainstorm itself may be the sizing mechanism.
- **Open questions:** What would convince Julian the rescue is worth paying? What would convince him it is not?

### Recommendation H6: Ship the five latent fields as the first-day integration of whichever path is chosen.

- **Priority:** Medium.
- **Rationale:** Finding F2 + O1/O2/O4/O5/O10. `obsDt`, observation `lat/lng`, `locName`/`howMany`, row-level `isNotable`, `taxonOrder`/`familyCode` all on the wire with zero frontend usage. Zero backend changes. Collectively move T2, T5, T7 from 0 toward 2 — the three tasks currently scoring zero. Every path benefits equally. Frame as "first-day wins," not "stretch goals."
- **Trade-offs:** All five at once may dilute the redesign's visual focus. Cherry-pick three for release 1, defer two. `taxonOrder` has nulls requiring a policy decision.
- **Open questions:** Which three of five ship first? What is the null-handling policy on `taxonOrder`?

---

## I) Open Questions

Five questions the analysis surfaced but cannot close. The brainstorm owns them. Ordered by priority — which ones block the most downstream decisions.

### I1: Which user archetype is the default? (Priority 1)

- **Why it matters:** Determines the default surface, default entry task, three-fields-to-surface-first decision, and whether Path A or Path B launches first in phased delivery. Every subsequent design decision branches from this one.
- **Why the analysis cannot close it:** Archetype prioritisation is a product judgment call. No user research exists.
- **Suggested approach:** Julian picks one on the way to the brainstorm. A 30-second call, made consciously.

### I2: Rescue-vs-reimagine — sized, not chosen. (Priority 2)

- **Why it matters:** The three defensible paths (1-week rescue / 2–3 week Path A / longer Path C) all correctly interpret the evidence. Undecided is not a fourth option.
- **Why the analysis cannot close it:** Iterator 5 sized the rescue; no iterator scoped reimagining duration. Julian's preference for shipping feature work vs shipping stability is not in the analysis.
- **Suggested approach:** 10-minute brainstorm subsection. Name the three paths. For each, state what would make it the right choice.

### I3: Observation grain — species-aggregate or single-observation? (Priority 3)

- **Why it matters:** Determines whether the first release requires a new backend aggregate endpoint. If T2 in single-sighting form is in release 1, backend work is in scope.
- **Why the analysis cannot close it:** Iterator 2's Finding 1 exposed the pre-aggregation; the design consequence is a judgment call about which tasks release 1 serves.
- **Suggested approach:** The archetype decision (I1) cascades here. Visiting-birder archetype implies single-sighting grain. Local-birder or family-browser archetype tolerates species-aggregate grain.

### I4: `?region=` URL migration policy. (Priority 4)

- **Why it matters:** Existing bookmarks using `?region=sky-islands-huachucas` silently drop or redirect to empty view if not planned for. `url-state.ts` is KEEP as a module but the `region` param's semantics change if ecoregion is demoted.
- **Why the analysis cannot close it:** A 10-minute product decision, not an analytical question.
- **Suggested approach:** Three options — (a) silent drop; (b) redirect to a `?family=` or `?q=` equivalent filtered view; (c) soft warning with link to the new filter UI. Pick one, write into the plan.

### I5: Path A/B phase boundary — if and when spatial mode launches. (Priority 5)

- **Why it matters:** If Path C chosen without a concrete gate for Path B, Path B may never ship (Risk R6). If Path A chosen without explicitly deferring Path B, every future PR faces "should this add geography back?" pressure.
- **Why the analysis cannot close it:** Design-territory phasing. Evidence permits either configuration.
- **Suggested approach:** If Path C is the decision, define a concrete Path B ship gate — a date, a feature flag, a user-count trigger, or scope deliverable. If Path A, mark Path B as "future phase, scope TBD" and resist scope creep during Path A implementation.

### Operational question (not brainstorm-priority): When to fix the ingestor?

- **Why it matters:** 52+ hours stalled at analysis time. Any visitor sees a broken-looking site. The brainstorm may feel like a haunted-house tour if still stalled when it runs.
- **Why the analysis cannot close it:** Out of scope — frontend-only analysis.
- **Suggested approach:** If still stalled at brainstorm time, fix first (an hour's work, probably).

---

## J) Appendix: Evidence Index

### Screenshots (Phase 0 evidence)

| Screenshot | Path | Purpose |
|---|---|---|
| Default desktop 1440×900 | `/Users/j/repos/bird-watch/docs/analyses/2026-04-20-frontend-map-analysis/phase-0/screenshots/bird-maps-default-1440.png` | Default view — 9 polygons, 30 badges, 8 overflow pips, 0 hotspot dots, 183 SVG children |
| Sonoran-Tucson expanded | `/Users/j/repos/bird-watch/docs/analyses/2026-04-20-frontend-map-analysis/phase-0/screenshots/bird-maps-sonoran-tucson-expanded.png` | Species label overlap evidence |
| Huachucas expanded | `/Users/j/repos/bird-watch/docs/analyses/2026-04-20-frontend-map-analysis/phase-0/screenshots/bird-maps-huachucas-expanded.png` | Single-badge pole-of-inaccessibility fallback; no species info |
| Mobile 390×844 | `/Users/j/repos/bird-watch/docs/analyses/2026-04-20-frontend-map-analysis/phase-0/screenshots/bird-maps-mobile-390.png` | Near-unclickable badges; ~30% empty screen |

### Map rendering chain (DISCARD — 1,300 LOC production)

| File | Path | Role |
|---|---|---|
| `App.tsx` (partial) | `/Users/j/repos/bird-watch/frontend/src/App.tsx` | `silhouetteFor` GENERIC at `:28-30`; coupling note at `:32-43` |
| `Map.tsx` | `/Users/j/repos/bird-watch/frontend/src/components/Map.tsx` | 205 LOC; paint-order sort at `:60-87` |
| `Region.tsx` | `/Users/j/repos/bird-watch/frontend/src/components/Region.tsx` | 176 LOC; `EXPAND_MAX_BBOX_FRAC = 0.6` at `:18` |
| `Badge.tsx` | `/Users/j/repos/bird-watch/frontend/src/components/Badge.tsx` | 139 LOC; species label at `:124-136` |
| `BadgeStack.tsx` | `/Users/j/repos/bird-watch/frontend/src/components/BadgeStack.tsx` | 333 LOC; `layoutBadges` at `:1-28`; pole-of-inaccessibility fallback at `:189-258` |
| `HotspotDot.tsx` | `/Users/j/repos/bird-watch/frontend/src/components/HotspotDot.tsx` | 36 LOC |
| `geo/path.ts` | `/Users/j/repos/bird-watch/frontend/src/geo/path.ts` | 302 LOC; inscribed rect at `:140-209`; pole-of-inaccessibility at `:225-301` |
| `styles.css` | `/Users/j/repos/bird-watch/frontend/src/styles.css` | 170 LOC; tombstoned `transform-origin: center` at `:35`; tombstoned `.badge-stack { transform: scale(1.5) }` at `:13`; `SpeciesPanel` `position: fixed` at `:94-100` |

### Non-map scaffolding (KEEP — 653 LOC production)

| File | Path | Role |
|---|---|---|
| API client | `/Users/j/repos/bird-watch/frontend/src/api/client.ts` | Typed client for `/api/regions`, `/api/hotspots`, `/api/observations`, `/api/species/:code` |
| Bird-data hook | `/Users/j/repos/bird-watch/frontend/src/data/use-bird-data.ts` | Parallel fetch orchestration |
| Species-detail hook | `/Users/j/repos/bird-watch/frontend/src/data/use-species-detail.ts` | Sidebar detail driver |
| URL state | `/Users/j/repos/bird-watch/frontend/src/state/url-state.ts` | Syncs `since | notable | speciesCode | familyCode | regionId` |
| Derivation | `/Users/j/repos/bird-watch/frontend/src/derived.ts` | Aggregation helpers |
| FiltersBar | `/Users/j/repos/bird-watch/frontend/src/components/FiltersBar.tsx` | Filter UI, deep-link compatible |
| SpeciesPanel | `/Users/j/repos/bird-watch/frontend/src/components/SpeciesPanel.tsx` | Detail sidebar; strongest component in repo |
| Shared types | `/Users/j/repos/bird-watch/packages/shared-types/**` | Full wire schema for all four endpoints |

### Plan and spec documents

| Document | Path | Role |
|---|---|---|
| Plan 4 (frontend) | `/Users/j/repos/bird-watch/docs/plans/2026-04-16-plan-4-frontend.md` | The plan Iterator 5 tombstoned |
| Spec | `/Users/j/repos/bird-watch/docs/specs/2026-04-16-bird-watch-design.md` | §Frontend (line 40-52), §Filters MVP (line 233-245), §Success criteria (line 345+) |
| Project instructions | `/Users/j/repos/bird-watch/CLAUDE.md` | Project conventions |

### Rendering-driven migrations (eligible for removal if SVG retires)

| Migration | Path | Purpose |
|---|---|---|
| `fix_region_boundaries` | `/Users/j/repos/bird-watch/migrations/1700000011000_fix_region_boundaries.sql` | Polygon vertex adjustments to avoid SVG z-fighting |
| `fix_sky_islands_boundaries` | `/Users/j/repos/bird-watch/migrations/1700000012000_fix_sky_islands_boundaries.sql` | Santa Ritas vertex clamp |

(Combined ~306 SQL LOC per Phase 1 Surprise 1. `parent_id` column in `regions` table, migration `1700000002000_regions.sql`, serves paint-order sort, not data hierarchy.)

### Live site and API endpoints

| Resource | URL | Evidence source |
|---|---|---|
| Live frontend | <https://bird-maps.com> | Default visitor experience; archived screenshots |
| Production API | <https://api.bird-maps.com> | Iterator 2 live probes (`phase-2/iterator-2-production-data-volume.md`) |
| `/api/observations?since=14d` | 344 rows / 101 KB / 220–280 ms TTFB (stall regime) | Iterator 2 Finding 1 |
| `/api/observations?since=1d` | `[]` (ingestor stall) | Iterator 2 Finding 2 |
| `/api/hotspots` | `[]` (ingestor stall) | Iterator 2 Finding 2 |

### Phase 1 artifacts

| Artifact | Path |
|---|---|
| Area 1 — Visual-UX audit | `/Users/j/repos/bird-watch/docs/analyses/2026-04-20-frontend-map-analysis/phase-1/area-1-visual-ux-audit.md` |
| Area 2 — Rendering-complexity audit | `/Users/j/repos/bird-watch/docs/analyses/2026-04-20-frontend-map-analysis/phase-1/area-2-rendering-complexity-audit.md` |
| Area 3 — User-task fit | `/Users/j/repos/bird-watch/docs/analyses/2026-04-20-frontend-map-analysis/phase-1/area-3-user-task-fit.md` |
| Area 4 — Data/API surface | `/Users/j/repos/bird-watch/docs/analyses/2026-04-20-frontend-map-analysis/phase-1/area-4-data-api-surface.md` |
| Area 5 — Salvage map | `/Users/j/repos/bird-watch/docs/analyses/2026-04-20-frontend-map-analysis/phase-1/area-5-salvage-map.md` |

### Phase 2 artifacts

| Artifact | Path |
|---|---|
| Iterator 1 — Task-surface matrix | `/Users/j/repos/bird-watch/docs/analyses/2026-04-20-frontend-map-analysis/phase-2/iterator-1-task-surface-matrix.md` |
| Iterator 2 — Production data volume | `/Users/j/repos/bird-watch/docs/analyses/2026-04-20-frontend-map-analysis/phase-2/iterator-2-production-data-volume.md` |
| Iterator 3 — Concept salvage | `/Users/j/repos/bird-watch/docs/analyses/2026-04-20-frontend-map-analysis/phase-2/iterator-3-concept-salvage.md` |
| Iterator 4 — Red team | `/Users/j/repos/bird-watch/docs/analyses/2026-04-20-frontend-map-analysis/phase-2/iterator-4-red-team.md` |
| Iterator 5 — Historical timeline | `/Users/j/repos/bird-watch/docs/analyses/2026-04-20-frontend-map-analysis/phase-2/iterator-5-historical-timeline.md` |

### Phase 3 artifacts

| Artifact | Path |
|---|---|
| Synthesis 1 — Thematic | `/Users/j/repos/bird-watch/docs/analyses/2026-04-20-frontend-map-analysis/phase-3/synthesis-1.md` |
| Synthesis 2 — Risk/Opportunity | `/Users/j/repos/bird-watch/docs/analyses/2026-04-20-frontend-map-analysis/phase-3/synthesis-2.md` |
| Synthesis 3 — Gap/Implication | `/Users/j/repos/bird-watch/docs/analyses/2026-04-20-frontend-map-analysis/phase-3/synthesis-3.md` |

### Finding-to-source index (condensed)

| Finding | Primary source | Type |
|---|---|---|
| E1 Ecoregion as imposed metaphor | `phase-1/area-3-user-task-fit.md`; Phase 0 anchor 2 (Sky Islands shared fill) | Code + observation |
| E2 Spatial misdirection | `phase-1/area-4-data-api-surface.md`; `frontend/src/geo/path.ts:225-301` | Code |
| E3 Ecoregion survives as filter | `phase-2/iterator-3-concept-salvage.md` (MAP-SHAPED); `frontend/src/state/url-state.ts` | Code |
| F1 12 dropped fields, obsDt worst | `phase-1/area-4-data-api-surface.md`; server `observations.ts:147` | Code + measurement |
| F2 5 latent concepts | `phase-2/iterator-3-concept-salvage.md` LATENT category | Code |
| F3 Species-per-row pre-aggregation | `phase-2/iterator-2-production-data-volume.md` Finding 1 | Live probe |
| G1 8/10 PR churn rate | Phase 0 packet anchor 6; `phase-1/area-2-rendering-complexity-audit.md` | Archaeology |
| G2 17 dragons, 14 predictable | `phase-2/iterator-5-historical-timeline.md`; `styles.css:13`, `:35` | Code + analysis |
| G3 306 SQL LOC rendering-driven | `migrations/1700000011000_*`, `1700000012000_*`; Phase 1 Surprise 1 | Code |
| G4 Task-fit 6/14 current | `phase-2/iterator-1-task-surface-matrix.md` | Analytical |
| S1 33% KEEP / 16% REFACTOR / 51% DISCARD | `phase-1/area-5-salvage-map.md` | Code classification |
| S2 SpeciesPanel buried behind weakest interaction | `phase-1/area-5-salvage-map.md`; Phase 1 Surprise 4 | Code + observation |
| S3 22-concept inventory | `phase-2/iterator-3-concept-salvage.md` | Concept-level |
| R1 Churn escalates | Phase 0 packet anchor 6 + Iterator 5 | Archaeology |
| R2 Ingestor stall | `phase-2/iterator-2-production-data-volume.md` Finding 2 | Live probe |
| R7 "Ditch map" misread | Synthesis 2 R7; Iterator 4 blind spot | Synthesis |
| R10 Process failure repeats | Synthesis 2 O7; Iterator 5 tombstones | Synthesis + code |
| Ingestor operational incident | `phase-2/iterator-2-production-data-volume.md` Finding 2 | Live probe |
| API uncompressed / no CDN | `phase-2/iterator-2-production-data-volume.md` Finding 3 | Live probe |

---

*End of report.*
