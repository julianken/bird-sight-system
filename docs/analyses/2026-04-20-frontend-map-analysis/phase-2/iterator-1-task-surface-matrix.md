# Iteration: Task × Surface Matrix with Redesign-Path Dimension

## Assignment

Cross-cut Area 3 (7 user tasks, T1–T7) and Area 4 (UI shapes naturally supported by the data) to produce a unified task × surface matrix that also crosses a second dimension — map-ness of the replacement. Score each task (0/1/2) against three redesign paths (A: non-spatial, B: real geographic basemap, C: hybrid). Name 1–3 concrete task-surfaces per path. Address archetype fit, data-resurrection requirements, path composability, and what the brainstorm still needs to decide.

---

## Findings

### Finding 1: Scoring methodology

Each score cell answers: "Given what the backend already serves, how well could this path serve this task without backend changes?" The Area 4 UI-shapes feasibility table (`area-4-data-api-surface.md §Finding 5`) and the Area 3 task-fit matrix (`area-3-user-task-fit.md §Task-Fit Matrix`) are the joint evidence base. Scores are not predictions about specific UIs; they predict whether the data + task pairing has structural support under each path.

- **2 — Strong.** The backend delivers the necessary fields, the path's organizing metaphor matches the task's implicit question, and nothing about the path structurally suppresses the answer.
- **1 — Partial.** The backend has the data; the path can surface it, but only with non-trivial workarounds or secondary screens that feel bolted-on to the primary metaphor.
- **0 — Weak.** The path's organizing metaphor conflicts with the task, or the backend field required for the task is one Area 4 identifies as dropped and not retrievable under this path without surfacing it as a non-natural element.

**Confidence:** High for the scoring logic; medium for individual cells where the path's organizing metaphor is ambiguous (noted inline).

**Relation to Phase 1:** Extends Area 3 §Task-Fit Matrix and Area 4 §Finding 5, which are both single-path assessments. This is the first cross-path view.

---

### Finding 2: The unified task × surface × path matrix

| Task | Current score (A3) | Path A score | Path B score | Path C score |
|---|---|---|---|---|
| T1 — Notable birds now | 1 | **2** | 1 | **2** |
| T2 — Near a specific place | 0 | 1 | **2** | **2** |
| T3 — I saw X / tell me more | 1 | **2** | 1 | **2** |
| T4 — Browse by family | 1 | **2** | 0 | **2** |
| T5 — Where to go for a species | 0 | 1 | **2** | **2** |
| T6 — Diversity at a glance | 1 | 1 | **2** | **2** |
| T7 — What's new since yesterday | 0 | **2** | 1 | **2** |

**Path A totals:** 2+1+2+2+1+1+2 = 11/14
**Path B totals:** 1+2+1+0+2+2+1 = 9/14
**Path C totals:** 2+2+2+2+2+2+2 = 14/14 (maximum possible)

Per-cell justifications follow.

**T1 — Notable birds now**

- Path A: 2. `isNotable` is a row-level field on every `Observation` (Area 4 §Finding 2: "DROPPED at row — only as filter-gate via `?notable=true`"). A non-spatial list can expose it as a label per row, with `obsDt` ISO timestamp also present. The question "what notable birds are in AZ right now" is fundamentally a list question; the list's ordering (`ORDER BY obs_dt DESC` is already the server's sort) makes temporal arrangement native, not bolted-on. No backend change required.
- Path B: 1. A basemap with markers can mark notable observations differently (shape, color), but the question is "what" — a verbal enumeration — not "where." Scanning markers to build a mental list is a non-natural use of geographic display. The data is available but the metaphor competes.
- Path C: 2. The primary non-spatial view handles T1 natively (same as Path A); geography is an optional mode that adds "where are these notables" as a bonus rather than a requirement.

**T2 — Near a specific place**

- Path A: 1. `locName` on `Observation` (currently dropped; `area-4-data-api-surface.md §Finding 2`) can be surfaced as a text field in a list. A user can filter or search by `locName` string. However, "near" implies a proximity concept: a user who wants "birds near Madera Canyon" has to know the eBird hotspot name, not a city name — no geocoding is in the contract. Partial but achievable without backend change.
- Path B: 2. This is the one task where a basemap dominates. `Observation.lat`/`lng` and `Hotspot.lat`/`lng` are both on the wire and both currently dropped by the frontend (Area 4 §Finding 2 and §Surprises). Plotting them against a real tiled basemap immediately answers "near a place" by visual inspection. The user can see Tucson on the map and see which observations are geographically close. No backend change required; only field resurrection.
- Path C: 2. Same as Path B when the geographic mode is entered; the non-spatial primary view handles "near a place" via text-accessible hotspot names as a fallback.

**T3 — I saw X / tell me more**

- Path A: 2. `SpeciesPanel` + `useSpeciesDetail` are classified KEEP with no modification (Area 5 §KEEP manifest). Under Path A, any direct access to a species record (search autocomplete, list item click, URL `?species=`) opens the panel without requiring region-expand as prerequisite. `SpeciesMeta` delivers `comName`, `sciName`, `familyName` (Area 4 §Finding 1). `taxonOrder` is present in the type and currently dropped — a future enhancement, not a blocker.
- Path B: 1. A basemap organizes by location; clicking a marker could open a species detail, but the primary question is "tell me about species X" — the species's geographic location is secondary to its identity. The panel can still be wired; the path just makes the access modal less obvious. If a user's mental model is "I saw X at a place," Path B could work — but Area 3 §Finding 4 shows the panel is already strong; the problem is access, not content. A marker-click-to-panel is a plausible but non-natural secondary modal.
- Path C: 2. Species search goes directly to the panel in the primary (non-spatial) view; the geographic mode adds "where was it seen" as a natural complement. Strongest possible fit.

**T4 — Browse by family**

- Path A: 2. `SpeciesMeta.familyCode`/`familyName` are in the contract and currently dropped in the panel (Area 4 §Finding 2). `taxonOrder` enables taxonomic sorting. A non-spatial list sorted by family or rendered as a family-grouped hierarchy directly answers "show me warblers." Area 4 §Finding 5 flags the latent coupling: family dropdown reflects only currently-loaded observation families (`derived.ts:16-24`). A stable taxonomic browser needs a `/api/families` endpoint that does not yet exist — but family-filtered views work today.
- Path B: 0. A geographic basemap has no natural organizing axis for taxonomy. "Show me warblers" is answered by coloring or filtering markers by family, but the map provides no incremental value over a list for this task; it adds geographic noise. A user browsing taxonomically is not asking a spatial question.
- Path C: 2. Family browsing lives in the primary non-spatial mode; the geographic mode can show "where are the warblers" as an extension. The tasks separate cleanly across modes.

**T5 — Where to go for a species**

- Path A: 1. `locName` and `Hotspot.lat`/`lng` (with `numSpeciesAlltime` and `latestObsDt`) allow a text list of hotspots sorted by recent activity. A user looking for "where to find Painted Buntings" can filter by species, see a list of location names with date ranges. Text-locatable but not spatially oriented. `latestObsDt` is currently dropped (Area 4 §Finding 2) — resurrecting it enables "hotspot freshness" ranking.
- Path B: 2. This is the second task where a basemap clearly dominates. Plotting hotspots as sized or colored points on a real map and then filtering by species turns "where to go" into a direct visual answer. `Hotspot.numSpeciesAlltime` already drives the log-scale radius in `HotspotDot.tsx`; a basemap preserves that signal and adds geographic orientation. `latestObsDt` resurrection adds a recency dimension. `Observation.lat`/`lng` adds individual sighting scatter, which is additional signal.
- Path C: 2. Geographic mode answers T5 directly; the non-spatial mode provides the textual fallback for users without spatial intuition about AZ hotspot geography.

**T6 — Diversity at a glance**

- Path A: 1. A count-by-region, count-by-family, or species-richness summary is derivable from the current observation set. `howMany` (currently dropped) would add abundance; without it, diversity is a species count. Non-spatial formats (sorted table, bar chart of species per region) communicate diversity, but they require the user to build a spatial mental model themselves. The current map's rough diversity signal — "Sonoran-Phoenix has the most badges" — is weak, but it is spatial and immediate. A list replaces it with something accurate but less instant.
- Path B: 2. Chloropleth-style coloring or graduated symbols on a real basemap by region or hotspot gives an immediately legible diversity overview. The current SVG map attempts this but fails because of the polygon-fills-equal-regions encoding problem (Area 1). A basemap with markers whose size or density reflects species richness at actual hotspot lat/lng positions is more honest and more legible. `numSpeciesAlltime` on hotspots is already wired; `howMany` on observations adds abundance.
- Path C: 2. Both modes contribute: the geographic mode gives the spatial diversity overview; a non-spatial mode can give a ranked list or summary breakdown. Complementary, not redundant.

**T7 — What's new since yesterday**

- Path A: 2. This task is definitionally temporal. `obsDt` is present in every observation row, the server already orders by `obs_dt DESC` (Area 4 §Finding 1), and the `?since=1d` filter is already wired. A reverse-chronological list that shows `obsDt` per row is the canonical answer to "what's new." No backend change. `isNotable` row-level flag (currently dropped) can mark notable rows inline. This is the strongest possible fit: the data shape is a feed; the task question is a feed question.
- Path B: 1. A basemap can animate over time or show "recent additions" with a recency color ramp, but "what's new" is fundamentally a temporal ordering question, not a spatial one. A map of "where was this seen recently" is a secondary question; "what was seen recently" is the primary one. Path B answers the secondary question while making the primary one harder to read.
- Path C: 2. Same as Path A for the non-spatial primary mode; the geographic mode adds "where were the recent sightings" as a secondary overlay. Full fit.

**Confidence:** Medium-high overall. Cells where the path's organizing metaphor is clearly aligned or clearly opposed are rated high confidence. Cells rated 1 are medium confidence — they depend on how a specific UI surfaces secondary information, which is a design question beyond this analysis.

**Relation to Phase 1:** Extends Area 3's task-fit matrix from a single-path baseline to a three-path comparison. Extends Area 4's UI-shapes table by anchoring each shape to a path and task pair. Confirms Phase 1 Convergence 2 (rich data dropped at the display layer) — the score jumps between paths are almost entirely caused by field resurrection, not backend changes.

**Significance:** Path C dominates by score, but the score reflects maximum feasibility, not minimum complexity. The scores are a ceiling on what each path can serve, not a prediction that any specific path implementation would achieve its maximum.

---

### Finding 3: Task-surfaces per path

A task-surface is a data + task pairing that would be strong under a given path. It names what-to-show, not how-to-show it.

**Path A — Non-spatial (list / feed / grid / timeline / cards)**

1. **Reverse-chronological observation feed filtered by `since` + `notable` + `species` + `family`.** This surface directly serves T1 (notable birds now), T7 (what's new), and partially T3 (species lookup). The fields required are all currently on the wire: `obsDt`, `comName`, `locName`, `howMany`, `isNotable`, `obsDt`. Server sort is already correct (`ORDER BY obs_dt DESC`). No backend change.

2. **Species-first search with direct panel access.** `SpeciesPanel` + `useSpeciesDetail` are KEEP. Wiring species autocomplete (already in `FiltersBar.tsx:78-97`, scoped to current observation set) to a direct panel open — bypassing the region-expand gate — serves T3 strongly and T4 partially. The latent coupling (`silhouetteId` as `familyCode` proxy; `derived.ts:16-24`) needs resolution for family browsing to be stable, but species-search-to-panel works today.

3. **Hotspot ranked list with freshness and species-richness signals.** `Hotspot.numSpeciesAlltime`, `Hotspot.latestObsDt` (currently dropped), `Hotspot.locName`, `Hotspot.lat`/`lng` (as human-readable place identifiers, not map coordinates) form a list sortable by "most species," "most recently active," or "fewest species" (rarity hunting). Serves T5 partially (text-locatable) and T6 (richness at a glance via ranking). Requires `latestObsDt` resurrection.

**Path B — Real geographic basemap**

1. **Observation and hotspot scatter plot on a tiled basemap.** `Observation.lat`/`lng` (on the wire, zero frontend reads; Area 4 §Finding 2 Surprises) and `Hotspot.lat`/`lng` (already used in SVG projection math, `Map.tsx:26-30`; just needs different target coordinate system). This surface directly serves T2 (near a place) and T5 (where to go for species). Filtering by `?species=` reduces the scatter to a single-species footprint, answering "where is this species seen in AZ?" The basemap's geographic context (city names, roads, terrain) solves the orientation problem Area 3 §Finding 5 identifies as the current map's primary failure.

2. **Species-richness heat or graduated-symbol map by hotspot.** `Hotspot.numSpeciesAlltime` already drives radius in `HotspotDot.tsx`. On a real basemap, sized hotspot markers become comprehensible without legend because the underlying geography provides orientation. `latestObsDt` resurrection adds a recency color dimension. Serves T6 (diversity at a glance) as the strongest possible surface under Path B.

**Path C — Hybrid (non-spatial primary; geographic mode optional)**

1. **Feed-primary with geographic drill-down.** The non-spatial primary mode delivers the reverse-chronological feed (Path A surface 1). Selecting an entry or a filter result surfaces a geographic mode showing where those observations cluster. Serves T1, T7 via feed; T2, T5 via geographic mode. The mode transition is a "show on map" affordance, not a separate route — the geographic view is parameterized by whatever the feed is currently filtered to.

2. **Species hub: panel + recent sightings + location context.** Species search → panel open (Path A surface 2) + a "recent sightings" list using `obsDt`, `locName`, `howMany` (currently dropped fields) + an optional "see on map" that plots those sighting lat/lngs. Serves T3, T4, T5, T7 as a unified task chain: "I saw a Painted Bunting → panel → where else has it been seen → map those sightings."

3. **Hotspot hub: hotspot list + geographic placement.** Same as Path B surface 2, but the geographic map is entered from a primary hotspot list (Path A surface 3). The user starts in the list, sees richness rankings in text, enters the map to see geographic context. Serves T2 and T5 more completely than either path alone.

**Confidence:** High for the data provenance of each surface. Medium for how naturally each surface transitions into adjacent tasks (depends on navigation design, which is out of scope here).

**Relation to Phase 1:** These surfaces are explicit realizations of Area 4 §Finding 5's UI-shapes table, mapped through the path dimension. The "temporal feed" and "spatial plot" rows in that table directly correspond to Path A surfaces 1/3 and Path B surfaces 1/2.

**Significance:** No surface requires a new backend endpoint except the family-taxonomy browser (needs `/api/families`). All other surfaces work by reading fields already on the wire. The constraint is resurrection of dropped fields, not new data.

---

### Finding 4: Which path best serves the excluded archetypes

Area 3 §User Archetype Assessment identifies two excluded archetypes: the visiting birder and the casual non-birder.

**Visiting birder** — arrives with a target place (Tucson, Sedona, the Huachucas). Their implicit question is T2 (near a place) and T5 (where to go for a species). Path B serves them best from a pure-task perspective: the basemap gives the orientation the current SVG map withholds. However, Path B's weakness is T3 and T4 — a visiting birder planning a trip also wants species information and family browsing. Path C addresses the full visiting birder workflow: geographic orientation via the basemap mode, species research via the non-spatial mode, navigated via a single "show this on map" / "tell me about this species" toggle.

**Casual non-birder** — curiosity-driven, no prior knowledge. Their implicit question is T6 (diversity at a glance) and T1 (notable/remarkable birds). Area 1 finds the current map briefly engaging but offering no reward for curiosity. Path A serves the casual non-birder best in terms of immediate legibility: a notable-birds feed with species names, counts, and dates visible without interaction is more rewarding than an unlabeled polygon map. Path B might engage visually ("dots on a map") but still requires the user to click each dot for information — similar orientation problem to the current design. Path C gives the casual user the immediately readable feed (Path A) with the option to satisfy "where is this?" curiosity via the geographic mode.

**Summary:**
- Visiting birder: Path C > Path B > Path A
- Casual non-birder: Path A > Path C > Path B

**Confidence:** Medium. This is inferred from archetype task-priorities, not user research (Phase 1 Gap 1 remains open: no actual user research exists).

**Relation to Phase 1:** Extends Area 3 §User Archetype Assessment, which assessed archetypes against the current design only. This is the first cross-path archetype comparison.

---

### Finding 5: Data resurrection requirements by path

Area 4 §Finding 2 identifies 12 dropped fields. The paths differ in which ones they require to fulfill their scoring.

| Field currently dropped | Path A needs it? | Path B needs it? | Path C needs it? | Resurrection cost |
|---|---|---|---|---|
| `Observation.obsDt` | Yes (T1, T7, T3 secondary) | Partial (T7 secondary) | Yes | Zero backend work — field is on the wire; client just never reads it |
| `Observation.lat`/`lng` | No | Yes (T2, T5, T6) | Yes (in geo mode) | Zero backend work — on the wire; projection math already in `Map.tsx:26-30` for a different coord system |
| `Observation.locName` | Yes (T2 partial, T5 partial) | Partial | Yes | Zero backend work — on the wire |
| `Observation.howMany` | Yes (T3 secondary, richness) | Partial | Yes | Zero backend work — on the wire |
| `Observation.isNotable` (row-level) | Yes (T1) | Partial | Yes | Zero backend work — on the wire |
| `Observation.subId` | No (T3 future) | No | No | Zero backend; checklist grouping is a design choice |
| `Hotspot.latestObsDt` | Yes (T5 surface) | Yes (T6 surface) | Yes | Zero backend work — on the wire |
| `Hotspot.regionId` | No | Partial | No | Zero backend work — on the wire |
| `SpeciesMeta.familyCode` | Yes (T4) | No | Yes | Zero backend work — on the wire |
| `SpeciesMeta.taxonOrder` | Yes (T4 sorting) | No | Yes | Zero backend work — on the wire |
| `SpeciesMeta.familyName` (already used in panel) | — | — | — | Already used |

**Key observation:** Path B requires the most *geometrically* significant resurrection — `Observation.lat`/`lng` — because it needs those coordinates as map inputs, not just display text. The SVG projection math in `Map.tsx:26-30` already handles AZ-bounding-box normalization but is tied to the SVG coordinate system; a real tiled basemap needs WGS84 passthrough, which is what the raw lat/lng already is. This is not a backend change but it is the largest single-file change among the resurrection items.

Path A requires the most *field count* of resurrection — five to seven fields for full T1/T7/T2/T3/T5 surface coverage — but each resurrection is purely "read this field that is already in the response."

Path C requires everything both paths require, as expected.

**No path requires a new backend endpoint** except the stable taxonomic browser (T4 advanced case) which needs `/api/families`.

**Confidence:** High. Field presence confirmed in Area 4 §Finding 2 table with grep evidence; backend endpoints confirmed in Area 4 §Finding 1.

**Relation to Phase 1:** Extends Area 4 §Finding 2 by mapping dropped fields to path-specific resurrection requirements. Confirms Phase 1 Convergence 2 (rich data dropped at the display layer) — resurrection cost is near-zero in all cases because the data is already on the wire.

---

### Finding 6: Are Paths A and B mutually exclusive or composable?

Paths A and B are **composable, not mutually exclusive**, but the composability is asymmetric.

Path A (non-spatial) and Path B (real basemap) share the same backend contract, the same filter state (`url-state.ts` URL params are path-agnostic — `?since=`, `?notable=`, `?species=`, `?family=` are not spatially specific), and the same API client (`api/client.ts` is KEEP). They diverge only in which fields each renders and which visual metaphor organizes the display.

A combined implementation can share:
- All filter state and URL contract (Area 5 §URL contract: KEEP)
- `api/client.ts`, `use-bird-data.ts`, `use-species-detail.ts`, `FiltersBar.tsx`, `SpeciesPanel.tsx` (all KEEP)
- Field resurrection work — if `obsDt` is resurrected for Path A, it costs nothing to also pass it through to Path B's marker metadata

The divergence is in rendering: Path A renders observation fields as text/structured layout; Path B renders `lat`/`lng` as map coordinates. These are non-conflicting — the same observation object can supply both a list row and a map marker in two different view modes. This is precisely what Path C formalizes as a mode toggle.

The asymmetry: Path B cannot subsume Path A. A map that shows "notable birds now" cannot enumerate them textually without adding a secondary panel or list — the map metaphor competes with the list question. Path A can subsume Path B at reduced fidelity (text location rather than map point). Path C is the composable resolution, not a compromise between two incompatible metaphors but a natural extension of Path A with geographic views added where they win (T2, T5, T6).

**Confidence:** High. Grounded in the shared state contract (Area 5 KEEP manifest) and the independence of rendering from data retrieval.

**Relation to Phase 1:** Extends Phase 1 Gap 5 ("ditch the map is ambiguous"). Directly addresses the gap by showing the three paths are composable rather than mutually exclusive.

---

### Finding 7: What the brainstorm must still decide

This matrix establishes what the backend supports and which tasks each path can serve. It does not resolve:

1. **Which primary entry state the redesign opens into.** Path C's score maximum depends on both modes being present, but only one can be the default. Whether the default is non-spatial (feed/list) or geographic (basemap) is a product decision that requires knowing the prioritized archetype. This analysis shows the visiting birder benefits most from a geographic default; the casual non-birder benefits most from a non-spatial default. The matrix cannot resolve the archetype priority.

2. **Pagination and volume.** Area 4 §Finding 4 flags that `/api/observations` is unpaginated and ships a full filtered rowset. Path A's feed surfaces and Path B's marker scatter both load the full array. At "several-thousand-row volumes" (Area 4 §Finding 5), client-side rendering of an unpaginated list or marker set may require virtualization. Whether AZ 14-day volumes are within unvirtualized tolerance is a gap that Phase 1 left open (Gap 2: production data volume unmeasured).

3. **The family taxonomy stable-source problem.** Area 4 §Finding 7 identifies that the family dropdown reflects only currently-loaded observation families (`derived.ts:16-24`). Any Path A or C surface that exposes taxonomic browsing as a first-class view — not a filter side effect — needs a stable `/api/families` endpoint. This is an architectural decision about whether to add an endpoint or accept the filter-derived family list as sufficient.

4. **Whether `silhouetteId`-as-`familyCode` coupling is resolved before a redesign ships.** Issue #57 documents this. Any surface that uses color-by-family (a strong signal for T4 and T6) inherits the silent miscategorization risk if Phylopic assets are re-keyed. The brainstorm should decide whether to invest in fixing this or to drop color-by-family from the redesign's initial scope.

5. **Whether `subId`-based checklist grouping is in scope.** `subId` is on every observation row and currently dropped. A "recent checklists" surface (grouping observations by `subId` with observer and checklist metadata) would serve T7 particularly well, but it requires either the eBird checklist endpoint (`/product/checklist/view/:subId`, not currently wired) or accepting that checklist-grouped views show only species, not observer/effort metadata. This is a product scope decision, not a technical feasibility question.

---

## Resolved Questions

- **"Ditch the map is ambiguous" (Phase 1 Gap 5).** This matrix operationalizes the three paths. Paths A and B are composable; Path C is the formal composition. The ambiguity is now a three-way choice with scored evidence rather than an open question.
- **Which path requires the most discarded data to come back.** Path C requires the most field resurrection in aggregate (it subsumes both A and B). Path B requires the most geometrically significant single resurrection (`Observation.lat`/`lng` as WGS84 inputs to a real basemap). In all cases, resurrection cost is near-zero because the fields are already on the wire.
- **Whether Paths A and B are mutually exclusive.** They are composable, sharing the same backend contract, state, and client infrastructure.

---

## Remaining Unknowns

- Actual observation row volume at `?since=14d` in AZ production (Phase 1 Gap 2, still open). This determines whether Path A's feed and Path B's scatter marker layer require virtualization or pagination before they are usable.
- Prioritized user archetype (Phase 1 Gap 1, still open). The matrix shows Path C is highest-scoring, but the default mode within Path C depends on which archetype is primary.
- Whether the brainstorm treats the `silhouetteId`-as-`familyCode` coupling (issue #57) as a prerequisite fix or a parallel track.
- Whether a stable `/api/families` endpoint is acceptable scope for the redesign or whether family-browse degrades gracefully to filter-derived families.

---

## Revised Understanding

Phase 1 established the map as the failure surface and confirmed the non-map scaffolding is sound. This iteration adds a structural claim: the data the backend serves already supports three coherent redesign paths with varying task coverage, and the paths are composable rather than mutually exclusive.

The matrix's most significant finding is not which path scores highest (Path C does, trivially, because it subsumes both others) but why the score jumps occur. Almost every score improvement from the current design to any redesign path comes from field resurrection — reading fields already on the wire that the current UI drops. This is consistent with Phase 1 Convergence 2 and Surprise 2 (observation lat/lng on the wire, never read). The redesign's primary engineering leverage is in the frontend data layer, not the backend.

Path B is the only path where the geometric nature of the resurrection matters: `Observation.lat`/`lng` must be treated as real WGS84 coordinates fed to a tiled map engine, not just text. This is a higher-complexity resurrection than the others. All other resurrections are "pass the field through to the display" changes.

The task-surface pairs that survive any path are: `SpeciesPanel` + direct species search (T3, served by all three paths), and filter state + observation feed (T1, T7, served strongly by Paths A and C). These are the lowest-risk starting points for a redesign because they require the fewest new rendering choices and the most reuse of KEEP files.
