# Synthesis: Thematic

## Synthesis Approach

This synthesis applies a thematic lens — asking not "what went wrong" in a list but "what story does the evidence tell." The evidence is dense and convergent across five investigators and five iterators; the synthesizer's job is to identify which stories are load-bearing for the brainstorm and which are detail. Five themes emerged from reading the phase-0, phase-1, and phase-2 packets as a single document. They are ordered by their explanatory power, not by their urgency, because this synthesis feeds a brainstorm rather than a remediation backlog.

---

## Core Narrative

The bird-watch frontend does not have a rendering bug — it has an identity crisis about what kind of product it is trying to be. The SVG ecoregion map imposes a geographic-taxonomic mental model that almost no plausible user brings to the page, encodes species data in a visual vocabulary that requires prior knowledge to decode, and then drops the most user-legible signals — time, exact location, observation count — before they ever reach the screen. The result is a UI that confidently points at the wrong level of abstraction (the ecoregion) while silently discarding the abstraction most users actually think in (the species, the sighting, the date). Every rendering fix over the past 10 PRs is a local repair to this mismatch, not a resolution of it: the label collision, the color duplication, the expand-blowup, the pip dominance are symptoms of a frame that cannot carry the information load the product is trying to put into it.

What makes this situation recoverable is that the failure is almost entirely in the presentation layer, not in the data or the plumbing. The backend surfaces 12 fields the UI currently ignores; the non-map scaffolding — state management, filter logic, species panel, API client — is cleanly engineered and portable; eight of sixteen end-to-end specs are design-agnostic and survive any reimagining intact. The brainstorm is not a greenfield exercise. It is a decision about what to put in front of real, working infrastructure — infrastructure that answers 344 real Arizona bird observations in 101 KB over a 220-millisecond round trip. The evidence says the question is not "can we build something better" but "what is the simplest thing that would actually serve the users this data is for."

---

## Key Conclusions

### Theme 1: The Ecoregion Frame Is an Imposed Metaphor, Not a Natural Entry Point

The map's central organizing concept — the ecoregion — is an ornithological classification that a subset of birders use professionally or academically, but which has no natural meaning to the three user archetypes identified in Phase 1 Area 3: the visiting birder planning a trip, the casual nature-curious user, and the local birder with ecoregion familiarity. The last of these is the only archetype the current UI plausibly serves, and even for them the expand interaction fails (Area 3, Phase 1 packet; task scores 0/1 across all archetypes on T2, T5, T7).

The evidence that this is a frame problem rather than a rendering problem is visible in what the UI does not show, not only in what it shows badly. There are no labels on the default view. There is no legend. The three Sky Islands regions share the same fill color (#B84C3A, phase-0 packet anchor 2), making the one geographic concept a local birder might recognize — the Sky Islands — visually indistinguishable across the three subranges. The map cannot communicate "Huachucas vs. Chiricahuas vs. Santa Ritas" without the user already knowing which polygon is which. A first-time visitor to the site sees colored blobs and numbered pips over a background that requires geographic pre-knowledge to parse.

The deeper trouble is that the ecoregion frame suppresses the spatial resolution the data actually carries. Observation `lat/lng` is on the wire and present in every response; the frontend grep produces zero matches for `o.lat|o.lng|observation.lat|observation.lng` in production code (Phase 1 packet, Surprise 2). The map visually suggests "sightings here" — a polygon covering thousands of square miles contains badges that appear to represent local clusters. In reality the badge position is the polygon's pole-of-inaccessibility: a computed centroid with no relation to any actual sighting. Area 1 calls this "actively misleading" spatial encoding (Phase 1 packet, Convergence 1). The ecoregion is not a useful spatial unit at the display level; it is an administrative grouping that was convenient for the ingest architecture and carried forward into the display layer without stress-testing whether it answers the spatial question a visiting birder actually asks, which is "where specifically should I go."

The tension this theme does not settle: whether the ecoregion concept itself should survive a reimagining as a filter or organizational unit even if it disappears as the primary display frame. A region-selector dropdown in a non-spatial UI would let a local birder filter to the Chiricahuas specifically; the concept has value. The issue is its promotion to primary metaphor, not its existence.

**Supporting evidence:** Phase 1 packet Convergence 4 (ecoregion framing excludes most plausible users); Phase 1 packet Surprise 3 (obsDt never read); Phase 0 packet anchor 2 (three Sky Islands same fill); Phase 1 packet Surprise 1 (parent_id column serves paint-order, not data hierarchy); Phase 2 packet Theme 2 (task T2/T5 score 0 on current, 2 on hybrid).

**Confidence:** High — convergent across Area 1, Area 3, and Iterator 1 independently.

**Caveats:** This theme treats the ecoregion frame as a categorical mismatch. Iterator 4's Counter 1 (Phase 2 packet Theme 4) offers a moderate-credibility counter: half of Area 1's failures are fixable in-metaphor. The theme's claim is that the unfixable half — spatial misdirection, no-label default view, Sky Islands disambiguation — are disqualifying. That claim is supported by Phase 1 Area 1's inherent-vs-fixable classification but is not validated by user research.

**Relation to other themes:** This theme is the "why" — the root account. Theme 2 (data legibility) describes what the frame suppresses. Theme 3 (engineering cost) describes what the frame demands in return for what it suppresses. Theme 4 (the knowable prototype gap) explains how the frame became load-bearing without early challenge.

---

### Theme 2: The Data Is Rich; the Display Is Silent

The evidence tells a consistent story about a backend that has been built well and a frontend that ignores most of what it receives. Phase 1 Area 4 documents 12 fields the UI drops at the display layer: `obsDt`, observation `lat/lng`, `howMany`, `subId`, `latestObsDt`, row-level `isNotable`, `locId/locName`, `taxonOrder`, `familyCode`, and hotspot `regionId`. Phase 2 Iterator 2 measures the wire: 344 species, 101 KB, 220 ms — there is no volume or latency argument for dropping these fields, and no UX argument that most of them are irrelevant.

The most damaging single omission is `obsDt`. The server orders its response by `obs_dt DESC` (observations.ts:147, Phase 1 packet Surprise 3). The spec mandates a `since` filter (phase-0 packet anchor: §Filters MVP, line 233-245). The filter bar exposes a time-window control. And the UI renders the result with no timestamp visible anywhere — no per-observation date, no "observed N hours ago," no most-recent-sighting indicator. The `since` control exists; the UI shows that a filter is active; the underlying data carries the information needed to surface recency meaningfully. All three exist simultaneously, and none of the three connects to an actual displayed timestamp. Task T7 ("what's new") scores zero not because the data is absent but because the pipeline drops the field at display time (Phase 1 packet Convergence 2; Phase 2 packet Theme 1 Corollary).

The second-most damaging omission is the lat/lng pair. It combines with the `obsDt` gap to make T2 ("where exactly") and T5 ("where to go") score zero. Every observation carries a coordinate. The UI maps it to a polygon centroid. A user who wants to visit a specific hotspot gets no more precision than "somewhere in Sonoran Desert — Tucson area," which spans hundreds of square kilometers. Iterator 2 confirms that at 344 rows, naive plotting of individual coordinates — all of them — is well within any rendering budget. No virtualization. No pagination. No backend change. The lat/lng values simply need to be read (Phase 2 packet Theme 1).

The backend pre-aggregation finding from Iterator 2 introduces a structural caveat: `/api/observations` returns one row per species, not one row per sighting. This is the right design for the current display (one badge per species per region) but it means the lat/lng attached to each row is the most-recent or most-representative observation coordinate for that species, not a point cloud of all sightings. Any redesign that wants per-checklist granularity — abundance over time, individual sighting detail — would need a backend aggregate endpoint. Phase 2 packet Theme 1 is explicit about this. The "data is rich" narrative is accurate at the species-diversity level and requires a caveat at the individual-sighting level.

The concept-level salvage inventory from Iterator 3 (Phase 2 packet Theme 6) reframes this theme constructively: five latent concepts — per-obs timestamps, hotspot freshness, per-obs location, checklist grouping, taxonomic ordering — are currently implementable with zero backend changes. They are "latent" because the data is there, the types carry the fields, and the API client already receives them. The reimagining does not need to invent a new backend; it needs to stop discarding what the backend already sends.

**Supporting evidence:** Phase 1 packet Convergence 2 (12 dropped fields documented); Phase 1 packet Surprise 2 (lat/lng on wire, zero frontend matches); Phase 1 packet Surprise 3 (obsDt server ORDER BY, never read); Phase 2 packet Theme 1 (volume measured: 344 obs / 101 KB); Phase 2 packet Theme 6 (5 latent concepts, zero backend changes required).

**Confidence:** High for the field-dropping claim; Medium for the "zero backend changes" claim, which was measured during an ingest stall (Phase 2 packet Theme 5) and may not reflect healthy-regime volumes.

**Caveats:** Iterator 4 Counter 2 (Phase 2 packet Theme 4) rates "dropped data is legitimate simplification" as moderate-to-weak credibility. `lat/lng`, `subId`, `howMany`, `locName` could defensibly stay dropped in some designs. `obsDt` is the one field Iterator 4 explicitly calls indefensible given the temporal filter the UI already exposes. The synthesis accepts this caveat: not every dropped field is an equal omission.

**Relation to other themes:** Theme 2 is the inverse of Theme 1. The ecoregion frame (Theme 1) requires coarsening the data to region-level aggregates; Theme 2 documents what that coarsening costs. Theme 3 shows the engineering resources spent maintaining the frame that does this coarsening. Together they create the core irony: enormous engineering investment in rendering infrastructure that suppresses data the backend delivers for free.

---

### Theme 3: The Engineering Ledger Is Deeply Unbalanced

The SVG map does not merely fail at UX — it does so at extraordinary cost. Area 2's count is precise: 1,000 LOC of production map-rendering code, 1,100 LOC of map-specific tests, 18 "here be dragons" comment blocks, 6 distinct SVG-specific correctness mechanisms, 8 rendering-fix PRs in the last 10 merges (Phase 1 packet Convergences 1 and 5). Two database migrations — 306 combined SQL LOC — exist because SVG rendering required a `parent_id` column for paint-order sort and polygon vertex clamping for z-fighting at the canvas level (Phase 1 packet Surprise 1). The rendering choice propagated backward into the data model.

The churn rate is the most telling number. Eight of the last ten merged PRs are rendering correctness work. This is not a sprint phenomenon; Phase 2 Iterator 5 shows the architectural pivot (per-region `<g>` structure to two-pass layer architecture) began within four days of first deploy and is still in progress on the current branch, `refactor/two-pass-map-render`, as of this analysis. The system is not stabilizing. The branch name is the diagnosis.

What makes this ledger striking is what the investment yields. Task scores: 6/14 across seven user tasks (Phase 2 packet Theme 2 table). No task scores 2 — the maximum score for "task fully supported" — under the current design. The rendering investment buys visual complexity without buying usability. The 1,000 LOC that maintain polygon layout, inscribed rect computation, pole-of-inaccessibility fallback, expand cap, paint-order sort, two-pass layering, and non-scaling stroke enforce a visual display whose highest-scoring task is "browse by family" at score 1 ("partial support with significant friction").

The red-team counter here is the most credible of the four Iterator 4 raised: "execution not design" has moderate credibility (Phase 2 packet Theme 4, Counter 4). A real map library like Mapbox would close approximately 80% of Area 2's dragons. The inscribed rect algorithm, the pole-of-inaccessibility fallback, the expand cap, the non-scaling stroke — all of these are solved problems in production mapping libraries. The engineering ledger is not inherent to "a map"; it is inherent to "a from-scratch SVG polygon map." This distinction matters for the brainstorm. The engineering cost argument is an argument against continuing to build the current implementation, not necessarily an argument against any spatial display.

Iterator 5's estimate that 3-5 of 18 dragons close with a focused week, while 13-15 are structural (Phase 2 packet Theme 3), suggests the ceiling on a focused-fix approach: significant engineering for modest UX return. The hybrid redesign path (Path C) scores 14/14 on task fit with lower ongoing complexity because it would lean on existing mapping infrastructure for the spatial mode rather than maintaining a bespoke SVG polygon renderer.

**Supporting evidence:** Phase 1 packet Convergences 1 and 5 (1,000 LOC map chain, 80% churn rate); Phase 1 packet Surprise 1 (migrations exist for SVG, not data); Phase 2 packet Theme 3 (Iterator 5 tombstone analysis, 3-5 dragon closure estimate); Phase 2 packet Theme 4 Counter 4 (execution-not-design moderate credibility); Phase 2 packet Theme 2 (task score table).

**Confidence:** High for the cost side of the ledger (LOC, churn, dragons are counted); Medium for the ceiling estimate on a focused-fix path (Iterator 5's 3-5 dragons is an informed estimate, not a measured bound).

**Caveats:** The "execution not design" counter is genuine and should not be dismissed. If the brainstorm concludes that a spatial display is the right frame (i.e., Path B or Path C), the engineering cost argument does not argue against spatial per se — it argues for using real mapping infrastructure rather than continuing from-scratch SVG.

**Relation to other themes:** Theme 3 is the "what it costs" account that gives Theme 1's "the frame is wrong" its urgency. A wrong frame that was cheap to maintain would be a different kind of problem. A wrong frame that consumes 80% of a developer's merge throughput is a crisis. Theme 4 (the knowable prototype gap) explains why the cost was not anticipated earlier.

---

### Theme 4: The Plan Was Wrong in a Knowable Way — and the Process Let It Be

The most process-relevant finding of the entire analysis comes from Iterator 5's tombstone reconstruction (Phase 2 packet Theme 3). Five specific plan assumptions from Plan 4 Task 9 were not merely underspecified — they were actively wrong on SVG fundamentals and tombstoned in production code within days. `transform-origin: center` became `transform-origin: 0 0` with a four-line comment explaining SVG coordinate basics. `.badge-stack { transform: scale(1.5) }` was tombstoned. The single-root-SVG-with-per-region-`<g>` structure became the two-pass layer architecture now living in the current branch. These are not edge cases that emerged from novel requirements; they are standard SVG behavior that a 2-hour rendering prototype would have surfaced before a single plan task was written.

Iterator 5's predictability taxonomy is the sharpest analytical tool in the Phase 2 output (Phase 2 packet Theme 3, predictability categories):

- "Predictable from SVG fundamentals" includes paint-order z-index, transform-origin, non-scaling-stroke, and drop-shadow coordinate space. A developer who had prototyped a multi-polygon SVG with interactive expand for two hours would have hit all four. These were knowable, not discovered.
- "Predictable from domain knowledge" includes the concave sky-island polygon geometry. A glance at Arizona sky-island geography — three isolated mountain ranges with irregular outlines — would have flagged the inscribed-rect and pole-of-inaccessibility requirements before plan authoring.
- "Genuinely emergent" covers only the exact scale values for EXPAND_MAX_BBOX_FRAC, the Safari vector-effect bug, and the pip-offset regression. These three were unforeseeable from static analysis; they required live implementation to discover.

Fourteen of seventeen rendering problems now managed in production fall in the first two categories. The process lesson is not that SVG is hard but that the plan committed to a specific SVG architecture — a fully custom polygon renderer with interactive expand — before any prototype validated SVG's behavior in that configuration. The happy-path spec's golden journey (load → expand Sky Islands → toggle notable → reload, Phase 1 packet Surprise 6) was written to validate rendering and URL state, not to validate any user task; this spec framing reflects how fully the rendering challenge absorbed the implementation perspective.

The tension this theme does not settle: whether the same process gap — plan commitment before prototype validation — is present in the current moment. The brainstorm is about to generate redesign options; the process evidence says that any option involving novel rendering or interaction mechanics should be prototyped before it is planned, not committed as a full task sequence.

**Supporting evidence:** Phase 2 packet Theme 3 (Iterator 5 tombstone list, 5 plan assumptions invalidated in production); Phase 2 packet Surprise 7 (transform-origin tombstone in styles.css:35); Phase 2 packet Surprise 8 (four-day plan-to-refactor interval); Phase 1 packet Surprise 6 (happy-path spec validates rendering, not user tasks).

**Confidence:** High that the tombstone facts are accurate (the comment blocks and git timeline are cited code). Medium that a 2-hour prototype would have caught them — plausible but counterfactual.

**Caveats:** Iterator 4's red-team did not specifically challenge this theme. It is the one conclusion that all five investigators and five iterators converged toward without a serious counter having been raised. That convergence should increase confidence but also flags this as a potential echo-chamber risk, which Iterator 4 explicitly named as a methodological concern (Phase 2 packet Theme 4 Blind Spots).

**Relation to other themes:** Theme 4 is the "how did we get here" account. Themes 1, 2, and 3 describe the current failure; Theme 4 explains the decision path that produced it. Importantly, it is the only theme with a forward implication for process rather than product: the brainstorm should stage validation before commitment, not after.

---

### Theme 5: The Scaffolding Is Sound — the Reimagining Inherits Real Assets

The unanimous Phase 1 finding that the non-map scaffolding is engineering-sound is the least-dramatic but most practically important fact in the evidence set. Area 5's KEEP/REFACTOR/DISCARD manifest (Phase 1 packet Convergence 3) identifies 653 LOC of production code that survives any redesign unchanged: `api/client.ts`, `data/use-species-detail.ts`, `FiltersBar.tsx`, `SpeciesPanel.tsx`, `derived.ts`, `url-state.ts`, `use-bird-data.ts`. Eight of sixteen e2e specs test design-agnostic behavior — accessibility, deep-links, error states, filters, history navigation, species panel — and survive unchanged. The URL contract (filter params, region param, species param) transfers intact because it is state-management logic, not rendering logic.

Iterator 3's concept-level inventory (Phase 2 packet Theme 6) enriches this finding beyond the file level. Nine UI-agnostic concepts are currently implemented and transfer cleanly: deep-linkable filter state, notable elevation, time-window filter, URL-driven detail panel, accessible-name-first interaction, axe-scan discipline, and three that are latent because they are data-present but display-suppressed (obsDt ordering, hotspot freshness, per-obs location). Seven map-shaped concepts survive in altered expression: colour-by-family, count chip, overflow summary, activity-level size encoding, region selection, region hierarchy, ecoregion taxonomy. Only one concept is map-bound and drops entirely: inline-expand / `computeExpandTransform`.

The species panel deserves specific note because it appears in multiple areas independently as "the strongest feature" (Area 5), "the best feature behind the worst interaction" (Area 3), and the one component where engineering investment clearly paid out in product value. `SpeciesPanel` is accessible, deep-linkable, ESC-dismissible, and tested. Its weakness is layout: `position: fixed` at `styles.css:94-100` was chosen to avoid reflowing the map, which means it will need rework in a non-map layout (Phase 2 packet Contradiction, Iterator 4 Counter 3). This is a refactor, not a rewrite.

The practical implication for the brainstorm is a starting inventory of genuine assets, not just constraints. The state management, filter logic, API client, species detail hook, and eight e2e specs are not legacy debt to work around — they are working infrastructure to build on. The brainstorm can direct its generative energy at the display layer, confident that the plumbing behind it is solid.

**Supporting evidence:** Phase 1 packet Convergence 3 (653 LOC KEEP, 8 spec KEEP); Phase 1 packet Surprise 4 (SpeciesPanel strongest feature buried behind weakest interaction); Phase 2 packet Theme 6 (22-concept inventory, 9 UI-agnostic, 1 map-bound); Phase 2 packet Contradiction re: SpeciesPanel layout needing refactor.

**Confidence:** High for the KEEP classification at the file and spec level (these are direct code citations). Medium for the concept-level transfer claims, which assume the reimagined UI preserves the general interaction patterns (filter bar, species panel, URL state) — a reasonable assumption but not proven.

**Caveats:** Iterator 4 Counter 3 partially upgrades some KEEP items to REFACTOR, specifically `SpeciesPanel` layout and potential `ApiClient` pagination extensions. The "scaffolding is sound" claim should be understood as "sound in architecture, not necessarily unchanged in layout." The ingestor stall (Phase 2 packet Theme 5) also means any "data is shippable today" claim is measured in a degraded regime; healthy-ingest volumes may be 4-6x higher, which is still below virtualization thresholds but worth noting.

**Relation to other themes:** Theme 5 is the "what we have to build on" account. It completes the narrative arc: Theme 1 names what fails and why; Theme 2 names what the failure costs in data terms; Theme 3 names what it costs in engineering terms; Theme 4 names how the failure path was entered; and Theme 5 names what survived and is genuinely valuable. The brainstorm inherits a situation that is worse than it looks at the product layer and better than it looks at the infrastructure layer.

---

## How the Themes Relate

The five themes are not independent failure modes — they are a causal chain with one feedback loop. The ecoregion frame (Theme 1) is the root decision; it forces a coarse spatial aggregation that drops the data fields most useful to users (Theme 2), and it requires a bespoke rendering engine to make those polygons interactive (Theme 3). Both of those costs were avoidable if a prototype had validated SVG behavior before plan commitment (Theme 4). But because the plan committed early and the rendering problems surfaced progressively, the engineering focus narrowed to correctness and the user-task framing never got pressure-tested against real user behavior. The one place where user-task thinking did dominate — the species panel — produced the codebase's strongest component (Theme 5). The feedback loop: sound scaffolding (Theme 5) makes the current failure recoverable, but it also masks the severity of the display-layer failure because the plumbing works fine and tests pass; this may have reduced the urgency signal until the churn rate became undeniable. Themes 1 through 4 stress-test Theme 5's optimism: the scaffolding is sound, but the interface it serves has failed five ways simultaneously, and the process that produced that interface did not catch the failure until after first deploy.

---

## Blind Spots

1. **User preference vs. task-fit analysis.** The entire evidence base is static analysis — code, screenshots, field-level greps, API measurements. No real user has been observed navigating bird-maps.com. Iterator 4 explicitly names "personal project bias" as a methodological risk (Phase 2 packet Theme 4 Blind Spots): the user may love the map visually and find the engineer-fatigue "ditch it" framing to be an overcorrection. A thematic lens cannot resolve this. What the themes say is that the map fails demonstrable task-fit tests; what they cannot say is whether those task-fit failures translate to user dissatisfaction, or whether the map has aesthetic or emotional value that a list-based redesign would sacrifice.

2. **Operational stability as a design constraint.** The ingestor stall (52+ hours, Phase 2 packet Theme 5) and the CDN gap (API not behind Cloudflare, Phase 2 packet Theme 5 Finding 3) are visible in the evidence but are outside the thematic frame — they are operational facts, not design facts. A risk lens or gap lens would foreground these. The thematic synthesis treats the data as "rich enough" on the basis of stall-regime measurements; if healthy-ingest volumes are 5x higher and the API remains un-cached, latency and bandwidth behavior could change the feasibility picture for certain redesign directions.

3. **Hybrid path mode-selection cost.** Path C (hybrid: non-spatial primary + optional geographic mode) dominates the task-fit matrix 14/14 (Phase 2 packet Theme 2). The thematic synthesis treats this as a positive finding — composable paths, shared state contract. What it does not interrogate is the mode-selection UX cost: how a user discovers and switches between non-spatial and spatial modes, whether two modes introduce more decision burden than one simpler mode, and whether the "optional geographic drill-down" actually gets used in practice. A gap lens would flag this as an open design question the brainstorm will need to resolve.

---

## Recommendations (High-Level)

These are process and framing recommendations for the brainstorm, not design proposals.

- The brainstorm should separate three questions that the evidence shows were previously conflated: (1) is ecoregion the right organizational frame, (2) is spatial display the right primary mode, and (3) is from-scratch SVG the right rendering approach. They have different answers.
- Any redesign option that introduces novel rendering mechanics should be prototyped before it is planned. The evidence identifies a 2-hour prototype gap as the root process failure; the brainstorm's process should close that gap for whatever option it chooses.
- The brainstorm should start from the 22-concept inventory (Iterator 3, Phase 2 packet Theme 6) as its vocabulary. These are proven or latent concepts, not hypothetical ones. Concepts that are latent — displayable with zero backend changes — deserve priority consideration because they improve task-fit without adding implementation risk.
- "Ditch the map" should be held as a working hypothesis, not a concluded fact. Iterator 4's Counter 1 has moderate credibility and deserves explicit consideration during brainstorming: is there a 1-2 week focused fix path with a well-understood ceiling? The evidence says 3-5 dragons close in a focused week while 13-15 are structural. Sizing that explicitly rather than assuming it is not viable is a low-cost step that sharpens the decision.
