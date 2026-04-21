# Synthesis: Gap and Implication Lens

## Synthesis Approach

This lens asks two questions of the evidence: what does the analysis **enable** the brainstorm to decide, and what does it **still block on**? The synthesis is structured around the separation — every finding either closes a decision, reframes a decision, or surfaces a decision the brainstorm must still own. The goal is not to rank severity (that's synthesis 2's lens) or to weave themes (synthesis 1's lens), but to deliver the brainstorm audience a crisp inventory of the decisions that remain discretionary versus the decisions the evidence has already made.

Every claim cites Phase 1 area or Phase 2 iterator findings via the compressed packets; the synthesizer did not re-read raw iterator reports.

## Core Narrative

The evidence compiled across three phases does *not* say "ditch the map" — that framing is the user's, pre-analysis. What the evidence says is more specific: the **ecoregion taxonomy** as a grouping concept, the **SVG-polygon rendering** of that taxonomy, and the **from-scratch SVG implementation** are three separable choices, and each fails for different reasons. Phase 2 Iterator 4's red-team explicitly flags this collapse (Theme 4, Blind Spots). The polygon-rendering dragons would close under a real mapping library (Theme 4, Counter 4, "moderate credibility"); the UX failures (label collision, misdirection, Sky Islands coloring) would not. The ecoregion concept itself survives redesign as a filter/facet — Iterator 3 classifies it as MAP-SHAPED, not MAP-BOUND. So the brainstorm is not choosing between "keep it" and "ditch it"; it is choosing *which of three decisions to make* and in what order.

Second, the evidence reveals that the hardest decisions facing the brainstorm are **not technical feasibility questions**. Iterator 2 measured `?since=14d` at 101 KB / 344 rows / 220–280 ms TTFB (Theme 1) — no volume constraint exists at today's regime. The backend already serves everything needed for a temporal feed, spatial plot, hotspot list, species hub, and search list without backend changes (Phase 1 Convergence 3). What the analysis *cannot* decide are the design-territory questions: which user archetype to privilege, whether ecoregion taxonomy deserves a default or a toggle, and whether the 1–2 week "rescue path" (Iterator 5's 3–5 dragons closable) is more valuable than spending that time on a reimagining that closes 14/14 tasks (Iterator 1's Path C). Those are judgment calls. This synthesis's job is to make sure Julian enters the brainstorm knowing which is which.

## What This Analysis Enables the Brainstorm to Decide

### Decision 1: Drop `geo/path.ts` and `computeExpandTransform` from the forward design.
- **Evidence grounding:** Iterator 3 classifies `computeExpandTransform` as MAP-BOUND (the single concept in that tier) and `geo/path.ts` as containing zero transferable concepts (Phase 2 Theme 6). Phase 1 Area 5 classifies the entire file chain (`Map.tsx`, `Region.tsx`, `Badge.tsx`, `BadgeStack.tsx`, `HotspotDot.tsx`, `geo/path.ts`) as DISCARD, totalling ~1,000 production LOC (Phase 1 Convergence 1). Iterator 5 documents that 0 of the 6 SVG correctness mechanisms in `geo/path.ts` existed in the plan — all were discovered during implementation (Phase 2 Theme 3).
- **Trade-off the brainstorm still owns:** Whether to mine `layoutBadges` (28 LOC inside `BadgeStack.tsx`, Iterator 3) for any future species-stacked aggregation. That's a concept-level salvage decision, not a file-level one.

### Decision 2: The `SpeciesPanel` + `useSpeciesDetail` + `ApiClient` + `FiltersBar` + `derived.ts` + URL state + axe discipline stack survives intact.
- **Evidence grounding:** Phase 1 Area 5 classifies 653 production LOC as KEEP (Phase 1 Convergence 3). Iterator 3's 9 UI-AGNOSTIC concepts (Phase 2 Theme 6) include deep-linkable filter state, notable elevation, URL-driven detail panel, accessible-name-first interaction, axe-scan discipline, `test.fail()` pattern, and species-stacked aggregation. Phase 1 Surprise 4 ("species panel is the strongest feature, buried behind the weakest interaction") explicitly nominates `SpeciesPanel` as the single best component.
- **Trade-off the brainstorm still owns:** Iterator 4's Counter 3 (Phase 2 Theme 4) upgrades `SpeciesPanel`'s `position: fixed` layout (documented at `styles.css:94-100` as serving the map) to REFACTOR; the brainstorm decides whether the new layout reflows or overlays. `ApiClient` may need pagination/sort extensions depending on the chosen surfaces.

### Decision 3: The backend is ready. No backend work is required to ship any of Paths A, B, or C.
- **Evidence grounding:** Iterator 2's measurements (Phase 2 Theme 1): 344 species / 101 KB / 220–280 ms for `?since=14d`; plateau at 30d (+2 rows); no virtualization needed; no /api/species index needed. Iterator 1's corollary (Phase 2 Theme 1): "every feasibility score jump is caused by field resurrection, not new endpoints." Phase 1 Convergence 2 documents 12 populated fields the UI ignores.
- **Trade-off the brainstorm still owns:** Whether to design around the *semantic caveat* that `/api/observations` is pre-aggregated to one row per species (Iterator 2 Finding 1, Phase 2 Theme 1). Any metric on observation counts (checklist volume over time, abundance) requires a new backend aggregate; any metric on species counts (diversity, rarity, family distribution) does not. The brainstorm's task design implicitly decides whether to step into that backend work or stay in the species-counts space.

### Decision 4: The latent concept set (per-obs timestamps, hotspot freshness, per-obs location, checklist grouping, taxonomic ordering) is pre-approved for integration — no design validation required to include them.
- **Evidence grounding:** Iterator 3 classifies these 5 concepts as LATENT (Phase 2 Theme 6): "currently implementable with zero backend changes; map directly onto the 3 tasks that score 0 under current UI (T2, T5, T7)." Phase 1 Area 3 independently grades T2/T5/T7 at 0. Iterator 1's task-fit matrix (Phase 2 Theme 2) shows every non-spatial task that improves vs. today is driven by surfacing these fields.
- **Trade-off the brainstorm still owns:** Which three to prioritize for the first release. Five concepts at once would dilute the redesign; cherry-picking is a discretion point.

### Decision 5: The URL filter contract (`?since`, `?notable`, `?family`, `?q`, `?species`) migrates unchanged; `?region` is the only open URL-contract decision.
- **Evidence grounding:** Phase 1 Area 5's URL contract (Convergence 3 support material) classifies the shared filter params as KEEP. Iterator 3 lists "deep-linkable filter state" as UI-AGNOSTIC (Phase 2 Theme 6). Phase 2 Gap 5 explicitly flags `?region=` migration policy as unresolved (Phase 2 Theme 1 gaps list).
- **Trade-off the brainstorm still owns:** Whether `?region=` redirects to a filtered feed, silently drops, or becomes a soft warning. This is a product decision framed by a single variable: how many existing bookmarks are likely in the wild (Julian's personal project; probably few, but empirically unknown).

### Decision 6: The `happy-path.spec.ts` and the 8 map-specific e2e specs are DISCARD; the 5 design-agnostic specs (a11y, axe, deep-link, error-states, species-panel, filters, history-nav, prod-smoke.preview) survive.
- **Evidence grounding:** Phase 1 Area 5's e2e manifest; Phase 1 Convergence 1 (8 map-specific specs tied to DISCARD files); Phase 1 Surprise 6 ("the happy-path e2e spec tests rendering, not bird-discovery"). Iterator 4's red-team does not challenge this classification. `history-nav.spec.ts` is `test.fail()` but marked KEEP because intent is design-agnostic (Phase 1 Surprise 7).
- **Trade-off the brainstorm still owns:** Whether a *new* happy-path spec is written during the redesign or deferred. Given the old one's phrasing ("load → expand Sky Islands → toggle notable → reload"), a new golden path is unavoidable; the question is whether it gates the redesign branch or ships with the feature.

### Decision 7: "Path C (hybrid)" is the strictly dominant design posture for task fit, but "Path A (non-spatial)" is the safest starting posture for scope.
- **Evidence grounding:** Iterator 1's matrix (Phase 2 Theme 2): Path C 14/14, Path A 11/14, Path B 9/14. Iterator 1 notes "Path A and Path B are composable — they share the same state contract and KEEP infrastructure. Path C formalises that composition." The 3-point gap between Path C and Path A is entirely on T2/T5/T6 (where-questions), which are also the three tasks scoring 0 today.
- **Trade-off the brainstorm still owns:** Phasing. Path C can be built in two phases (A first, then B added) or committed to up-front. The analysis shows the former is feasible (composability claim) but does not choose for you.

### Decision 8: The ecoregion concept survives as a filter/facet; it does not survive as a default visual container.
- **Evidence grounding:** Iterator 3 classifies ecoregion taxonomy as MAP-SHAPED, not MAP-BOUND (Phase 2 Theme 6) — the concept survives, the expression changes. Phase 1 Area 1 cites "three Sky Islands share identical fill color" and "no legend exists" as inherent failures of the current expression. Phase 1 Convergence 4: the ecoregion framing excludes the visiting-birder and nature-curious-non-birder archetypes. Phase 2 Theme 4 Counter 1: colour legend and vocabulary are *in-metaphor fixable* — the taxonomy is not the problem.
- **Trade-off the brainstorm still owns:** Whether ecoregion is a secondary filter (opt-in), a sidebar grouping (always-visible but not primary), or a minor metadata field on observations (fully demoted). The evidence supports any of the three.

## What This Analysis Cannot Resolve

### Question 1: What do actual users do when they land on the site?
- **Why this analysis can't close it:** Every finding is derived from code, screenshots, API measurements, and archetype inference. Phase 1 Gap 1 and Phase 2 Theme 1 Gap 1 both explicitly name this methodological limit. Iterator 4's blind spot list includes "no user research" (Phase 2 Theme 4 blind spots).
- **Recommended way to resolve:** Needs user research. A 30-minute session of Julian narrating his own use (he's the only known user) would meaningfully advance this. Heat-map telemetry on the live site would help; GA/Plausible is probably not installed. None of this should block the brainstorm, but the brainstorm should not pretend it can answer this.

### Question 2: Is the user archetype the visiting birder, the local birder, or the nature-curious non-birder?
- **Why this analysis can't close it:** Phase 1 Area 3 and Phase 1 Convergence 4 both list three archetypes; the analysis can grade UI fit per archetype but cannot tell you which Julian wants to privilege. Iterator 1's Path C scoring implies hybrid-wins-across-archetypes, but "privilege which archetype on first load" is a design-territory decision.
- **Recommended way to resolve:** Julian decides. This is a 30-second product call, not a research question. The analysis expects the brainstorm to make this call early and consciously, because it determines which task (T1 / T2 / T5) is the default entry.

### Question 3: Is the 1–2 week "rescue path" a better investment than a reimagining of equivalent duration?
- **Why this analysis can't close it:** Iterator 5 sizes the dragon-closure effort (3–5 of 18 dragons, "focused week") but cannot compare against a reimagining effort it hasn't scoped. Iterator 4 Counter 4 ("execution, not design") is rated "moderate credibility" — not flipped, not dismissed. Phase 2 Theme 3 notes the current branch is mid-architectural-pivot, which complicates the counterfactual.
- **Recommended way to resolve:** A 30-minute sketch session with the user. The brainstorm itself is the resolution mechanism. The analysis has sized the pain (Phase 1 Area 2: 18 dragons, 8 of 10 recent PRs rendering churn) and the value (Iterator 1: 8/14 task-fit improvement delta from current to Path C); Julian weighs his own preferences.

### Question 4: Should the new UI surface observation-row data at the single-observation grain, or stay at the species-aggregate grain?
- **Why this analysis can't close it:** Iterator 2's Finding 1 (Phase 2 Theme 1) reveals that `/api/observations` is currently species-aggregated. Surfacing single observations requires a new backend endpoint. The choice has design consequences (does the feed show sightings or species?) and backend consequences (does the redesign block on a new endpoint?).
- **Recommended way to resolve:** Brainstorm decides based on which tasks it prioritizes. If T2 ("where exactly did this show up?") is in the first release, single-observation grain is required. If the first release is T1/T3/T4/T7, species-aggregate grain is sufficient.

### Question 5: How much operational hygiene must ship with the redesign?
- **Why this analysis can't close it:** Iterator 2 Finding 2 surfaces an active ingestor stall (52+ hours at probe time, Phase 2 Theme 5). This is not a design question but it shapes whether the redesign demonstrates well. The analysis cannot decide whether Julian should fix the ingestor first, in parallel, or after the redesign.
- **Recommended way to resolve:** Cannot be resolved statically. Fix the ingestor before the brainstorm if feasible (an hour's work, probably), because a stalled ingest makes the redesign feel like a haunted house.

### Question 6: What's the right Path A/B phase boundary — does spatial mode launch later or never?
- **Why this analysis can't close it:** Iterator 1's composability claim says the non-spatial and spatial modes can share state contract and KEEP infrastructure, but doesn't tell you whether the spatial mode pays for its complexity in year one. Real basemaps (Leaflet/Mapbox/deck.gl) introduce a new dependency, new rendering concerns, and new testing surface — all of which the "ditch the map" impulse was partly trying to avoid.
- **Recommended way to resolve:** Design-territory; brainstorm decides. The evidence *does* say that deferring the spatial mode does not break the composability property (it's adding a panel, not reshaping the app). That's a conservative path the evidence permits.

## Decisions This Analysis Reframes

### Reframe 1: "Should I ditch the map?" → three separable decisions.
- **Before:** One binary decision ("keep" vs "ditch").
- **After:** Three separable decisions: (a) retire the SVG-polygon rendering (evidence: strongly yes); (b) demote the ecoregion taxonomy from primary visual container (evidence: yes); (c) retire from-scratch SVG in favour of real basemap tiles (evidence: permissive, not forcing — Paths A, B, C are all live options).
- **Evidence that drove the reframe:** Iterator 4 Blind Spot ("collapsed decisions" — Phase 2 Theme 4). Iterator 3's MAP-BOUND / MAP-SHAPED / UI-AGNOSTIC concept classification (Phase 2 Theme 6).

### Reframe 2: "The map is broken" → half structural, half under-executed.
- **Before:** Monolithic failure conclusion.
- **After:** Iterator 5's 3–5-of-18 dragons-closable estimate (Phase 2 Theme 3) + Iterator 4 Counter 1's "moderate credibility" verdict (Phase 2 Theme 4) say that roughly half the rendering dragons are structural to SVG choice and half are fixable in a focused week. A real mapping library (Mapbox/Leaflet) would close ~80% of Area 2's dragons but would not rescue the UX failures (Counter 4). So "the map is broken" is more precisely "the SVG rendering is half-structurally-broken and half-executionally-broken, and the UX is independently broken regardless of rendering choice."
- **Evidence that drove the reframe:** Phase 2 Theme 3 + Theme 4. Phase 1 Area 2's 30-PR churn classification ("8 of last 10 are rendering fixes") quantifies the ongoing cost.

### Reframe 3: "Rich data is dropped" → 5 latent concepts are pre-approved for integration with zero backend work.
- **Before:** A criticism of the current UI.
- **After:** A resource list. Iterator 3's 5 LATENT concepts (per-obs timestamps, hotspot freshness, per-obs location, checklist grouping, taxonomic ordering) are pre-classified as zero-backend-cost and task-relevant for the three zero-scoring tasks (T2, T5, T7). This turns a design problem into a prioritization problem.
- **Evidence that drove the reframe:** Phase 2 Theme 6 Iterator 3 concept inventory. Phase 1 Area 3's T2/T5/T7 zero-grades. Iterator 2's feasibility measurements (Phase 2 Theme 1) confirm no volume constraint.

### Reframe 4: "Starting from scratch" → 33% of code already works, one-third needs selector updates, and 51% is genuinely DISCARD.
- **Before:** The "ditch the map" framing reads as a greenfield decision.
- **After:** Phase 1 Area 5 + Iterator 3 together say 653 LOC production code and 3 of 16 e2e specs are unchanged-KEEP; another ~16% and 5 specs need selector updates; roughly 51% is DISCARD. This meaningfully changes the sizing of the work.
- **Evidence that drove the reframe:** Phase 1 Convergence 3 + Phase 1 Area 5 manifest. Phase 1 headline explicitly says "reimagining is not starting from zero."

### Reframe 5: "The UI doesn't serve users" → the strongest component is hidden behind the weakest interaction.
- **Before:** Diffuse criticism.
- **After:** Specific inversion. `SpeciesPanel` + `useSpeciesDetail` is the cleanest code in the repo (Phase 1 Area 5) and supports the deepest user task (Phase 1 Area 3); it is reached only by expanding the wrong thing and clicking an illegibly-labelled badge (Phase 1 Surprise 4). The redesign task is structurally an *unburying* task, not a *rebuilding* task.
- **Evidence that drove the reframe:** Phase 1 Surprise 4, Phase 1 Area 5 KEEP classification of `SpeciesPanel`.

### Reframe 6: "The SVG code is too complex" → the data model was modified to serve the SVG rendering.
- **Before:** Complexity framed as frontend-local debt.
- **After:** Iterator 5 traces `parent_id` on the `regions` table and a 306-LOC polygon-clamping migration (Phase 1 Surprise 1) as SQL-level debt committed in service of the SVG paint-order sort. The consequence is that dropping the SVG doesn't just retire ~1,000 frontend LOC; it retires 306 SQL LOC of data-model contortion. The brainstorm should factor in that the database gets simpler too, not just the frontend.
- **Evidence that drove the reframe:** Phase 1 Surprise 1 (migration `1700000011000:148-153` + `Map.tsx:60-87`; migration `1700000012000` polygon-clamping).

## Implications Per Audience Segment

### Implications for Julian the developer (process, engineering, technical-debt POV)

1. **The dragons-closure week is a stabilization tax, not an investment.** Iterator 5's 3–5 dragons estimate closes roughly 20–30% of the 18 dragons; the remaining 13–15 are structural (Phase 2 Theme 3). Paying the tax keeps the current trajectory alive; it does not end the trajectory. If the decision is to reimagine, paying the tax is wasted work. Phase 1 Area 2's "rendering churn is not declining" (Phase 1 Convergence 5) signals this trajectory is load-bearing.
2. **The data model cleans up when the map leaves.** 306 SQL LOC of polygon-clamping and `parent_id` modelling becomes eligible for removal (Phase 1 Surprise 1). This is rare — usually frontend rewrites don't reach into the schema. It's a small bonus.
3. **The plan-4 authoring process has a reproducible failure mode.** Iterator 5's tombstone inventory (Phase 2 Theme 3) identifies 5 plan-level assumptions that were wrong on SVG fundamentals and catchable with a 2-hour prototype. The lesson generalizes: the next plan (plan-6 reimagining) should include a prototype spike *before* committing the task-by-task code. This is a process commitment Julian can make to himself.
4. **Operational hygiene is outstanding.** Iterator 2 Finding 2 + 3 (Phase 2 Theme 5): ingestor stalled 52+ hours, API not actually behind Cloudflare despite memory-note belief. Neither is a design concern, but both affect the deployed site's credibility during the brainstorm period.

### Implications for Julian running the brainstorm

1. **Frame the brainstorm as "which of three decisions first" not "keep or ditch."** The Reframe 1 separation is the most important shift in problem framing. If the brainstorm collapses the three decisions again, you will generate designs you can't sequence.
2. **Bring a prioritised archetype into the brainstorm. Don't try to pick it during.** Question 2 above is a 30-second product call — make it on the way to the brainstorm, not within it. The archetype choice determines the default surface (Path A's three task-surfaces: reverse-chron feed vs. species search vs. hotspot list, per Phase 2 Theme 2).
3. **Leave the spatial mode open. Treat it as a Phase-2 toggle, not a launch-blocker.** Iterator 1's composability claim (Phase 2 Theme 2) permits shipping Path A and adding Path B later without architectural rework. The brainstorm should resist committing to Path C launch in one shot — the Path A→Path B phasing is evidence-supported.
4. **Constrain the brainstorm to decisions the evidence enables.** The eight decisions in the "can decide" section above are not brainstorm inputs — they're brainstorm *constraints*. If the brainstorm starts relitigating `SpeciesPanel` or the URL filter contract, it's drifting.
5. **Leave user research out.** Question 1 above is genuinely unanswerable from static analysis; the brainstorm's designs will be bets regardless. Name that explicitly so no one tries to pretend the analysis closed it.
6. **Size the rescue-vs-reimagine decision; don't assume it.** Question 3 is the one dimensional decision Julian himself must make. The analysis has sized the pain (dragons, churn) and the task-fit upside (8-of-14 delta) but cannot weigh Julian's preferences against them. Budget 10 minutes of brainstorm time for this explicitly.

### Implications for the product over the next 1–3 months

**Success looks like:**
- One of the 3 zero-scoring tasks (T2, T5, or T7) moves to 2 (Iterator 1 matrix, Phase 2 Theme 2).
- The dragons-comments count goes from 18 to fewer than 5 (Phase 1 Area 2 baseline).
- The `SpeciesPanel` becomes reachable within one click of the landing state (vs. current multi-step path).
- The rendering-PR churn rate drops from 80% (8 of last 10) to something closer to the broader 33% baseline (Phase 1 Convergence 5).
- The 5 LATENT concepts have at least 3 shipped (Iterator 3, Phase 2 Theme 6).

**Failure looks like:**
- The redesign ships with a from-scratch rendering engine and a new set of dragons-comments (repeat of Plan-4's failure mode per Iterator 5).
- The brainstorm produces a design that requires backend changes before anything is shippable (violates Iterator 2's zero-backend-changes finding, Phase 2 Theme 1).
- Ecoregion taxonomy is preserved as the primary visual container in a different wrapper (Phase 1 Convergence 4 failure re-expresses).
- The `?region=` URL migration is silent and breaks bookmarks without notice (unresolved Phase 2 Gap 5).
- No archetype is privileged, resulting in a "flat" surface that serves no one well (Iterator 1's archetype-fit analysis, Phase 2 Theme 2).

## The 5 Questions the Brainstorm MUST Answer (Priority Order)

1. **Which user archetype is the default?** — Determines the default surface (feed vs. species search vs. hotspot list), determines which of the 3 zero-scoring tasks is prioritized first, determines whether Path A or Path B launches first if phased. Priority 1 because every subsequent decision branches from this.

2. **Rescue-vs-reimagine — sized, not chosen.** — Commit to either (a) a 1-week rescue pass closing 3–5 dragons (Iterator 5) while leaving UX failures intact, (b) a 2-3 week reimagining committing to Path A (Iterator 1), or (c) a longer reimagining committing to Path C composed across two releases. Any of the three is defensible; undecided is not.

3. **Observation grain — species-aggregate or single-observation?** — Determines whether the first release requires a new backend aggregate endpoint. If T2/T5 are in the first release, single-observation grain is required and backend work is in scope.

4. **`?region=` URL migration policy.** — Explicit redirect to a filtered-feed URL, silent drop, or soft warning. This is a 10-minute decision that affects zero engineering time once made; leave it undecided and someone will silently drop it.

5. **Ecoregion taxonomy's surviving role.** — Secondary filter, sidebar grouping, or demoted metadata field. All three are evidence-supported; the brainstorm picks one and locks it. This decision cascades into whether `getRegions()` stays, what happens to the 9-region content, and how the family dropdown composes with region filtering.

## Confidence Assessment

Overall confidence in the gap/implication picture: **high**, with specific medium-confidence caveats below.

- **High confidence** on the separation-of-decisions work (the core product of this synthesis), because it derives from explicit Iterator 4 blind spot language and Iterator 3's concept taxonomy — both of which are structural findings not interpretive ones.
- **High confidence** on the "8 decisions the brainstorm can make" and "6 questions the analysis cannot close" inventories, because each is directly sourced to a Phase 1 or Phase 2 finding with a citation.
- **Medium confidence** on the "success/failure looks like" bullets in the 1-3 month implications — these are inferred from the evidence rather than measured; a brainstorm outcome could legitimately define success differently.
- **Medium confidence** on the rescue-vs-reimagine sizing (Question 3): the 1-2 week rescue estimate is Iterator 5's, and the reimagining duration is not scoped anywhere in the analysis. Brainstorm participants may have better estimates than this synthesis.

**What would raise confidence:**
- 30 minutes of user research (even Julian narrating his own use) would close Question 1 and materially advance the archetype prioritization.
- A 2-hour spike on a real basemap (Leaflet or Mapbox) would firm up the Path B viability claim that Iterator 1 currently makes on task-fit grounds alone.
- Measured production data with a healthy ingestor (Phase 2 Gap 3) would confirm the 101 KB / 220-280 ms feasibility numbers are stable, not stall-regime artifacts.
- A scoped-effort estimate for each of Path A, Path B, Path C would let Question 3 close before the brainstorm instead of during.

## Blind Spots

### Blind spot 1: Julian's project-personal dimension.
This synthesis treats the brainstorm as a product decision and the analysis as product evidence. Iterator 4's "personal project bias" blind spot (Phase 2 Theme 4) explicitly names what this lens underweights: Julian's satisfaction, design preference, and the ship-small-things-that-delight-me motivation. A thematic lens (synthesis 1) would likely name "this is a hobbyist expressing aesthetic disappointment as a design conclusion" as a theme; this lens ignores it because it does not enable or block a decision — it reframes Julian's relationship to the decisions.

### Blind spot 2: The risk asymmetry between rescue and reimagine paths.
A risk lens (synthesis 2) would note that the 1-week rescue path has a known outcome (closes 3-5 dragons, leaves UX failures) and the reimagine path has a distribution of outcomes (Path A 11/14, Path C 14/14, but either could fail to ship at all). This synthesis treats them as symmetric options; a risk lens would weight them by variance, not just by expected task-fit delta.

### Blind spot 3: Process-legacy implications.
Iterator 5's process lesson (Phase 2 Theme 3: "the plan was wrong in a way catchable by a 2-hour prototype") has implications for how Plan 6 / Plan 7 are authored going forward — i.e., include a prototype spike before committing task-by-task code. This synthesis mentions it in the developer implications but a dedicated methodology lens would make this a first-class finding and propagate it to CLAUDE.md conventions. The gap/implication lens treats this as a one-off observation; the process lens would treat it as a binding convention-update recommendation.
