# Iteration: Concept Salvage Manifest

## Assignment

Extract design concepts embedded in Phase 1 DISCARD files (and latent in the API surface), classify each as UI-AGNOSTIC / MAP-SHAPED / MAP-BOUND, cite code locations, and produce a numbered inventory the brainstorm can use as input. Do not propose specific UIs or recommend libraries.

Source documents: phase-1-packet.md, area-5-salvage-map.md, area-2-rendering-complexity-audit.md §Finding 6, area-3-user-task-fit.md, area-4-data-api-surface.md. Code read directly for all citations below.

---

## Findings

### Concept Inventory

**1. Species-stacked aggregation**
- Code: `frontend/src/components/BadgeStack.tsx:12-28` (`layoutBadges()`)
- Excerpt: `for (const o of observations) { const existing = map.get(o.speciesCode); if (existing) { existing.count += 1; } else { map.set(o.speciesCode, { speciesCode, comName, silhouetteId, count: 1 }); } }`
- Classification: **UI-AGNOSTIC**
- Rationale: 28 lines of pure Map/Array reduction over the `Observation` DTO — no SVG, no geo imports. Produces a ranked unique-species list with counts from a flat observation array.
- UI-agnostic form: The concept would manifest as an observation reducer that outputs a ranked species-count list, needed by any view that groups by species.
- Confidence: High — `layoutBadges` imports only the `Observation` type; all SVG logic starts at line 30.
- Relation to Phase 1: Resolves Area 5 gap: "Whether this 28-line function should be extracted depends on whether the replacement UI needs per-species count aggregation."

---

**2. Colour-by-family encoding**
- Code: `frontend/src/App.tsx:41-43` (`colorFor()`), `@bird-watch/family-mapping` package
- Excerpt: `function colorFor(silhouetteId: string | null): string { return colorForFamily(silhouetteId ?? ''); }`
- Classification: **MAP-SHAPED**
- Rationale: Stable hue assignment per taxonomic family is a sound information design concept. Currently used as SVG circle fill. The `silhouetteId`-as-`familyCode` coupling (App.tsx COUPLING NOTE, issue #57) is a data-layer debt any replacement inherits until #57 resolves, but the family-to-colour mapping itself is independent of SVG.
- UI-agnostic form: The concept would manifest as a colour token keyed to `familyCode` (or `silhouetteId` until #57 lands) applied to whatever visual element represents a species.
- Confidence: High for concept portability; medium for coupling path.
- Relation to Phase 1: Area 2 Finding 6: classified "accidental-but-migrates." Area 4 Finding 7: coupling debt documented.

---

**3. Per-species observation-count chip**
- Code: `frontend/src/components/Badge.tsx:109-123`
- Excerpt: `{props.count > 1 && ( <g ...><circle r={chipRadius} fill="#1a1a1a" /><text ...>{props.count}</text></g> )}`
- Classification: **MAP-SHAPED**
- Rationale: The guard `count > 1 → render a secondary numeric indicator` is presentation-agnostic. The SVG `<circle>/<text>` pair at a computed offset inside a badge is map-specific. The count comes from Concept 1 (`layoutBadges`) and transfers with it.
- UI-agnostic form: The concept would manifest as a numeric annotation on any species entry when count > 1 — a badge, a pill, a parenthetical — using the count produced by Concept 1.
- Confidence: High — count logic is in layoutBadges; the SVG rendering idiom is map-bound.
- Relation to Phase 1: Area 5: "count-aggregation concept is not specific to SVG but is entirely bundled with the SVG rendering here."

---

**4. Notable-sighting elevation**
- Code: `frontend/src/state/url-state.ts:31` (`notable: p.get('notable') === 'true'`); `Observation.isNotable` in shared-types
- Classification: **UI-AGNOSTIC**
- Rationale: eBird's "notable" designation is a data-layer fact (rare-for-region) that survives any presentation. The current UI uses it only as a filter gate; the row-level `isNotable` boolean is dropped after filtering (Area 4). Both the filter and the per-item flag are independently useful.
- UI-agnostic form: The concept would manifest as a filter toggle (already exists) and a per-item "notable" indicator on whatever element represents an observation — `isNotable` is already on the wire.
- Confidence: High — `isNotable` confirmed in shared-types; URL param confirmed in url-state.ts.
- Relation to Phase 1: Area 4 Finding 2: "row-level `isNotable` DROPPED — only as filter-gate." Extends that gap.

---

**5. Overflow summary — hidden-count indication**
- Code: `frontend/src/components/BadgeStack.tsx:214-254` (`data-role="overflow-pip"`)
- Excerpt: `{overflow > 0 && ( <g aria-label={`${overflow} more species — expand region to view`}>...<text>+{overflow}</text></g> )}`
- Classification: **MAP-SHAPED**
- Rationale: When a container shows K of N items (N > K), summarising the hidden count as "+N-K more" is applicable to any list. The mechanism (compute overflow from grid layout, render SVG pip) is map-specific; the concept and the accessible-label pattern are not.
- UI-agnostic form: The concept would manifest as a truncation indicator on any capped list — "+12 more" at the bottom of a finite-height container, with a corresponding accessible label.
- Confidence: High — overflow count logic is generic; pip geometry is SVG-specific.
- Relation to Phase 1: Area 1 identifies pip dominance as a UX failure in the current form, attributable to the polygon container, not the concept itself.

---

**6. Deep-linkable filter state**
- Code: `frontend/src/state/url-state.ts:1-70` (`useUrlState`, `readUrl`, `writeUrl`)
- Classification: **UI-AGNOSTIC**
- Rationale: Serialising `since`, `notable`, `speciesCode`, `familyCode` into URL query params so any state is bookmarkable is a framework-agnostic pattern. The hook has no SVG imports. The only map-coupled field is `regionId`; the four surviving params constitute a live external contract.
- UI-agnostic form: The concept would manifest as the same `useUrlState` hook with `regionId` removed — four params preserved.
- Confidence: High — Area 5 §URL-State Contract; direct code read confirms no map imports in url-state.ts.
- Relation to Phase 1: Area 5 classifies hook as REFACTOR. Area 2 Finding 6: four params "essential-to-any-frontend."

---

**7. URL-driven detail panel**
- Code: `frontend/src/components/SpeciesPanel.tsx:47` (`if (speciesCode === null) return null`); `frontend/src/state/url-state.ts:29`
- Classification: **UI-AGNOSTIC**
- Rationale: Binding a detail panel's open state to a URL param so that `?species=vermfly` opens the panel on cold load is a general pattern. `SpeciesPanel` has zero SVG dependencies; the panel itself (ESC handler, aria-labelledby, sr-only heading fallback) is axe-clean and fully portable.
- UI-agnostic form: The concept would manifest as the same `?species=` trigger opening a detail view in any replacement layout.
- Confidence: High — SpeciesPanel.tsx confirmed zero map imports; Area 5 §Invariants mandates preserving `?species=`.
- Relation to Phase 1: Area 3 Finding 4: "SpeciesPanel is the UI's strongest user-task component in isolation." Area 5 §Invariants: "Preserve the `?species=` URL trigger."

---

**8. Scope-to-named-subset (region selection)**
- Code: `frontend/src/state/url-state.ts:27,37` (`regionId`); `frontend/src/App.tsx:84` (`onSelectRegion`)
- Classification: **MAP-SHAPED**
- Rationale: Narrowing displayed observations to a named partition is sound. Currently expressed as a polygon expand + `?region=` URL param. The data-scoping concept (partition name → filter) transfers; the polygon-expand trigger, `?region=` slug, and SVG transform do not.
- UI-agnostic form: The concept would manifest as any selection mechanism that scopes the observation list to a named data partition without requiring SVG.
- Confidence: High for concept portability; medium for whether the 9-region granularity is the right unit (see Concept 14).
- Relation to Phase 1: Area 2 Finding 6: `regionId` "accidental-but-migrates." Area 5 §URL-State Contract: `?region=` DISCARD.

---

**9. Activity-level encoding by size**
- Code: `frontend/src/components/HotspotDot.tsx:11-16` (`radiusFor()`)
- Excerpt: `const r = MIN_R + Math.log10(species) * 3; return Math.min(MAX_R, Math.max(MIN_R, r));`
- Classification: **MAP-SHAPED**
- Rationale: Log-scaling a visual size dimension to represent species richness is legitimate data encoding. The formula is generic; the SVG circle at projected lat/lng coordinates is map-specific.
- UI-agnostic form: The concept would manifest as a proportional visual weight — bar height, icon size, area — indicating species richness on any location entry.
- Confidence: High for concept; high for current implementation being map-bound.
- Relation to Phase 1: Area 5 classifies HotspotDot.tsx as DISCARD. Area 2 Finding 6: "accidental-to-map-choice."

---

**10. Region hierarchy as data (parent_id)**
- Code: `migrations/1700000011000_fix_region_boundaries.sql:148-153`; `frontend/src/components/Map.tsx:60-87` (paint-order sort using `parentId`)
- Classification: **MAP-SHAPED**
- Rationale: `parentId` was populated to serve SVG paint-order (Phase 1 Surprise 1). However, the containment relationship it encodes — Sky Islands sub-regions nested within the broader Sonoran zone — is a genuine domain fact. The paint-order use is map-bound; the grouping concept is not.
- UI-agnostic form: The concept would manifest as a grouping or nesting structure in any hierarchical display — parent ecoregion as a collapsible section header with child sub-regions as members.
- Confidence: Medium — the hierarchy is real but its current sole use is a rendering artefact; whether the 9-region taxonomy is the right grouping unit is unresolved.
- Relation to Phase 1: Phase 1 Surprise 1: "The `parent_id` column exists to serve the SVG paint-order sort, not to model data hierarchy." This concept argues the data value partially survives.

---

**11. Inline-expand drill-down**
- Code: `frontend/src/components/Region.tsx:62-89` (`computeExpandTransform()`); `frontend/src/App.tsx:82-85`
- Classification: **MAP-BOUND**
- Rationale: The SVG-transform-space expand is responsible for 12 of 18 dragons-comment blocks and all of Area 2's six correctness mechanisms. The underlying UX intent (drill into a subset without page navigation) is valid, but no part of `computeExpandTransform`, `EXPAND_MAX_BBOX_FRAC`, `parsePoints`, or the CSS `transform-origin: 0 0` contract transfers to a non-SVG context. A non-SVG drill-down would be built from scratch.
- UI-agnostic form: None for this implementation. Drop from brainstorm consideration.
- Confidence: High — Area 2 Finding 2: `computeExpandTransform` explicitly listed as a mechanism that "would not exist in a non-SVG UI."
- Relation to Phase 1: Area 2 Finding 6: "accidental-to-map-choice." Area 1: expand is one of the five inherent UX failures.

---

**12. Server-side time-window filtering**
- Code: `frontend/src/state/url-state.ts:3,30`; `services/read-api/src/app.ts:57-61`
- Classification: **UI-AGNOSTIC**
- Rationale: Compiling `?since=1d|7d|14d|30d` into `WHERE obs_dt >= now() - N days` is a server-side SQL concern wholly independent of the frontend rendering layer. The four values are a live external contract.
- UI-agnostic form: The concept would manifest as the same `?since=` param and time-window select in any replacement UI.
- Confidence: High — URL contract live on bird-maps.com (memory file). Area 5 §URL-State Contract: KEEP.
- Relation to Phase 1: Area 2 Finding 6: "essential-to-any-frontend."

---

**13. Accessible-name-first interaction model**
- Code: `frontend/src/components/Region.tsx:124` (`aria-label={props.region.name}`); `frontend/e2e/pages/app-page.ts:31` (select by `aria-label`)
- Classification: **UI-AGNOSTIC**
- Rationale: Authoring interactive elements with meaningful accessible names and selecting them in tests by accessible name rather than CSS class is a resilience discipline that applies to any UI technology.
- UI-agnostic form: The concept would manifest as the same authoring rule: every interactive element carries an accessible name; tests select by role + name rather than implementation-detail selectors.
- Confidence: High — pattern confirmed across POM, axe.spec.ts, and FiltersBar.tsx.
- Relation to Phase 1: Area 5 §Invariants: "A11y baseline — FiltersBar aria-labels, SpeciesPanel aria-labelledby + sr-only heading fallback are axe-clean today."

---

**14. The 9-region ecoregion taxonomy as data**
- Code: seeded in `migrations/1700000008000_seed_regions.sql`; `packages/shared-types/src/index.ts` (`Region`: `id`, `name`, `parentId`, `displayColor`, `svgPath`)
- Classification: **MAP-SHAPED**
- Rationale: The taxonomy is a genuine ornithological partition of Arizona with real domain meaning. The `svgPath` field is map-specific; `id`, `name`, and `parentId` are useful as grouping keys or filter options in any UI. The current primary role (polygon geometry for SVG rendering) is map-bound; the data itself is not.
- UI-agnostic form: The concept would manifest as a named grouping taxonomy usable as a filter option or a list section header without requiring SVG path data.
- Confidence: High for data existence; medium for whether the 9-region coarseness serves user tasks (Area 3 Finding 5 documents the cognitive cost of ecoregion vocabulary).
- Relation to Phase 1: Phase 1 Contradiction: "Whether `getRegions()` has utility in a map-less UI" unresolved. Area 4 Finding 5: "Per-region narrative — `regionId`-derived filter is trivial client-side."

---

**15. Render-readiness signal**
- Code: `frontend/e2e/pages/app-page.ts:20-22` (`waitForMapLoad()`)
- Excerpt: `await expect(this.page.locator('[data-region-id]')).toHaveCount(9, { timeout });`
- Classification: **MAP-SHAPED**
- Rationale: Waiting for a deterministic DOM signal before asserting is essential in any async UI test suite. The current signal (9 `[data-region-id]` elements) is map-specific. The discipline of emitting a reliable completion signal and consuming it in tests is not.
- UI-agnostic form: The concept would manifest as a `[data-render-complete]` attribute (or equivalent) set by the app when the primary data load is done — tests wait for this attribute instead of counting map-specific DOM nodes.
- Confidence: High for concept necessity; high for current signal being map-bound.
- Relation to Phase 1: Area 5 §e2e REFACTOR specs: multiple specs cite `[data-region-id]` count=9 as a readiness gate that must be replaced.

---

**16. Axe-scan discipline (WCAG automated testing)**
- Code: `frontend/e2e/axe.spec.ts:1-74`
- Classification: **UI-AGNOSTIC**
- Rationale: Running `@axe-core/playwright` against the page in multiple states with WCAG tags `['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']` is independent of rendering technology. Only test 2's setup (expand a region) is map-specific; the scanning pattern and violation-attachment approach are directly reusable.
- UI-agnostic form: The concept would manifest as axe scans of equivalent states in the replacement UI — the WCAG tag set and `toEqual([])` assertion pattern survive verbatim.
- Confidence: High.
- Relation to Phase 1: Area 5 §Invariants: "axe.spec.ts WCAG scans must remain in the suite."

---

**17. `test.fail()` as known-bug documentation**
- Code: `frontend/e2e/history-nav.spec.ts:10,29`
- Excerpt: `test.fail(); // Expected to fail today: url-state.ts uses replaceState, so goBack exits the app...`
- Classification: **UI-AGNOSTIC**
- Rationale: Using `test.fail()` to keep a failing assertion alive as both a design-intent record and a future regression detector is a test-authoring convention applicable to any suite. When the bug is fixed, `test.fail()` inverts to CI failure — the cue to remove it.
- UI-agnostic form: The concept would manifest as `test.fail()` specs preserved whenever a known design gap exists in the replacement UI.
- Confidence: High.
- Relation to Phase 1: Phase 1 Surprise 7: "History-nav.spec.ts is `test.fail()` on both tests."

---

### Latent Concepts (not yet implemented; in API surface)

**18. Per-observation timestamps (obsDt)**
- Code: `packages/shared-types/src/index.ts` (`Observation.obsDt`); server-sorted at `packages/db-client/src/observations.ts:147` (`ORDER BY obs_dt DESC`); zero frontend dereferences
- Classification: **UI-AGNOSTIC**
- Rationale: `obsDt` is on the wire and server-sorted descending. The frontend never reads it. A time-ordered observation feed — enabling "what's new since yesterday" — is feasible without any backend changes and directly addresses user task T7 (score 0 in Area 3).
- UI-agnostic form: The concept would manifest as a time-ordered list where each observation entry displays its timestamp.
- Confidence: High for field presence; confirmed by Area 4 Surprise and Area 3 Finding 7.
- Relation to Phase 1: Phase 1 Surprise 3 and Phase 1 Convergence 2.

---

**19. Hotspot freshness indicator (latestObsDt)**
- Code: `packages/shared-types/src/index.ts` (`Hotspot.latestObsDt: string | null`); zero frontend dereferences
- Classification: **UI-AGNOSTIC**
- Rationale: `latestObsDt` enables a "which hotspots are active right now" signal with no backend changes. Ignored by the current UI. Would directly serve user task T2 ("what's been seen near a specific place recently") which scores 0.
- UI-agnostic form: The concept would manifest as a recency indicator on hotspot entries — timestamp, freshness label, or sort order.
- Confidence: High for field presence; Area 4 Finding 2 and Surprise confirm it is unused.
- Relation to Phase 1: Phase 1 Convergence 2: "Rich data is being dropped at the display layer."

---

**20. Per-observation location name and coordinates**
- Code: `packages/shared-types/src/index.ts` (`Observation.lat`, `Observation.lng`, `Observation.locId`, `Observation.locName`); zero frontend dereferences of observation lat/lng (Area 4 Finding 2 grep: no matches for `o\.lat|o\.lng|observation\.lat|observation\.lng`)
- Classification: **UI-AGNOSTIC**
- Rationale: Every observation carries its exact lat/lng and hotspot name. The frontend discards all of these. The data to answer "where exactly was this seen" and "what's been seen at [named place]" (tasks T2, T5 — both score 0) already exists on the wire.
- UI-agnostic form: The concept would manifest as a location name displayed alongside each observation in any list or card view.
- Confidence: High — confirmed zero frontend dereferences by Area 4 grep.
- Relation to Phase 1: Phase 1 Surprise 2: "Observation lat/lng is on the wire and never read." Area 3 §Misdirections: badge position implies geography; it does not.

---

**21. Checklist grouping (subId)**
- Code: `packages/shared-types/src/index.ts` (`Observation.subId`); unique-keyed on upsert in ingestor
- Classification: **UI-AGNOSTIC**
- Rationale: eBird records observations in checklists (one birder session = one `subId` with multiple species). `subId` is preserved through ingest and available on the wire; the frontend ignores it. Grouping by checklist would compress a temporal feed and expose a natural unit of "what did one observer see in one outing."
- UI-agnostic form: The concept would manifest as a collapsible checklist group in any observation list — multiple species under one session header.
- Confidence: Medium — `subId` is confirmed on the wire; grouping semantics depend on upsert stability, which was not directly verified.
- Relation to Phase 1: Area 4 Surprise: "`subId` checklist grouping is never surfaced."

---

**22. Taxonomic ordering (taxonOrder)**
- Code: `packages/shared-types/src/index.ts` (`SpeciesMeta.taxonOrder: number | null`); dropped by frontend (Area 4 Finding 2)
- Classification: **UI-AGNOSTIC**
- Rationale: `taxonOrder` provides eBird's phylogenetic sort order — the standard convention in birding contexts (eBird itself uses it). Any species list sorted taxonomically rather than alphabetically would better serve the "local birder" archetype. The field is already in the API response for the `/api/species/:code` route.
- UI-agnostic form: The concept would manifest as an optional sort dimension on any species list — toggle between alphabetical and taxonomic order.
- Confidence: High for field presence; medium for whether all AZ species in the seed have `taxonOrder` populated (`null` is allowed by the type).
- Relation to Phase 1: Area 4 Finding 2: "`taxonOrder` DROPPED — no taxonomic ordering."

---

## Resolved Questions

- Phase 1 Gap 4 ("Salvageable concepts vs. salvageable files") is resolved. Concepts 1, 3, 5, 9 contain extractable logic from DISCARD files; Concept 11 (inline-expand) is confirmed MAP-BOUND with no transferable code. Concepts 18–22 are latent — present in the API surface with no frontend implementation at all.
- Concept 11: `computeExpandTransform` and all associated SVG-transform machinery are confirmed MAP-BOUND. The UX intent (drill without navigating) may survive in a different form, but no current code transfers.

## Remaining Unknowns

- Whether `taxonOrder` is fully populated for all AZ species in the current seed (`null` is a valid value per shared-types).
- Whether the 9-region taxonomy is the right partition granularity for any non-map UI. Area 3 Finding 5 documents the cognitive cost of ecoregion vocabulary; this is a design question, not answerable from static analysis.
- Production row volume for `?since=14d` — relevant to whether Concept 18 (temporal feed) needs pagination before it is renderable. (Iterator 2 answers this.)

## Revised Understanding

Phase 1's file-level DISCARD boundary is confirmed correct for all six map-chain files. The concept-level picture adds nuance: five of the six DISCARD files contain concepts worth carrying (BadgeStack → Concept 1; Badge → Concept 3; BadgeStack overflow → Concept 5; HotspotDot → Concept 9; Region's taxonomy data via parentId → Concept 10), while `geo/path.ts` contains zero transferable concepts — every exported function exists to solve SVG polygon placement problems.

The more actionable finding is the latent group (Concepts 18–22): five design ideas already supported by the API with no frontend implementation. These five concepts map directly to the three user tasks Area 3 scored 0 (T2, T5, T7). The brainstorm should treat them as priority inputs: they represent the highest-value gap between available data and what the current UI surfaces, and they require zero backend changes to exploit.
