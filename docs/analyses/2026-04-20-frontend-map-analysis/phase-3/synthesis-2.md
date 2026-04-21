# Synthesis: Risk and Opportunity

## Synthesis Approach

This synthesis applies a risk / opportunity lens to the three-phase evidence base accumulated across five Phase 1 investigators, five Phase 2 iterators, and the two compiled packets. Every finding is rated for severity and likelihood (risks) or value unlock and cost-to-realise (opportunities). The synthesis does not propose designs; it maps the decision space the brainstorm must navigate.

Severity scale used throughout:

- **Critical** — Realisation causes irreversible damage: lost work, broken user trust at scale, or permanently foreclosed options.
- **High** — Realisation materially sets back the project or permanently degrades user value; recovery takes weeks or requires a full pivot.
- **Medium** — Realisation costs multiple days of work or misdirects the brainstorm; correctable but expensive.
- **Low** — Realisation is an inconvenience or a minor quality miss; easily corrected.

---

## Core Narrative

The bird-watch frontend is not failing because of bugs. It is failing because a spatial metaphor (ecoregion polygons) was applied to a dataset and user population that have no intrinsic need for spatial ecoregion framing. The rendering churn — eight of the last ten merged PRs are correctness fixes — is the visible symptom, but the root cause is that every engineering decision downstream of "draw SVG polygons" generated a class of geometric correctness problems that did not exist in the original spec and would not exist in any non-SVG rendering. The database was modified to serve the renderer (Phase 1 Packet, Surprise 1: `parent_id` column, polygon vertex clamping migration), not the other way around. The plan committed these decisions before a single SVG was rendered at production dimensions (Phase 2 Packet, Theme 3: plan tombstones confirmed within four days of first deploy).

The opportunity picture is symmetrically generous. The backend is already delivering 344 species with geolocation, timestamps, family taxonomy, hotspot coordinates, and notable flags on every `?since=14d` request — 101 KB uncompressed, well inside any rendering budget (Phase 2 Theme 1). The UI reads none of the fields that would answer the three tasks currently scored at zero: "near a place," "where to go," "what's new." The KEEP scaffolding (33% of production LOC: API client, URL state, FiltersBar, SpeciesPanel, derived) is engineering-sound and survives redesign intact (Phase 1 Packet, Convergence 3). A thoughtful reimagining does not start from zero; it starts from a working data pipeline, a working filter/state/panel layer, and a dataset that is generous in both fields and volume.

---

## Risk Inventory

### R1 — Rendering churn escalates to blocking

- **Severity:** High — Each PR cycle costs 1–3 days of engineering time on a solo project. At the current rate (eight of ten PRs), the project has effectively no capacity for feature work.
- **Likelihood:** Near-certain (if status quo persists)
- **Evidence:** Phase 0 Packet, Anchor 6: PR sequence #80 → #81 → #87 → #99 → #88 → #100 → #93 → #98 → #77 → #78 → #94 → #96 → #101 → #92 — fourteen PRs with rendering correctness in their summary. Phase 2 Packet, Theme 3: Iterator 5 estimates 3–5 of 18 dragons are closeable in a focused week; 13–15 are structural to the SVG choice.
- **What it looks like if realised:** The current branch (`refactor/two-pass-map-render`) is already mid-pivot (Phase 2 Theme 3, Iterator 5 trajectory verdict). A reimagining decision arrives after two more architectural refactors, not before one.
- **Mitigation handle:** The brainstorm decision gates further SVG investment. Once a path is chosen, the DISCARD manifest (Phase 1 Packet, Convergence 1) creates a clean stop-loss.

### R2 — Ingestor stall masks data volume assumptions

- **Severity:** High — Volume feasibility claims rest on 344 rows measured during a 52-hour stall. Healthy-ingestor volume may be 1,500–2,000 rows (Phase 2 Packet, Gap 3), which still clears virtualization thresholds but narrows the margin and changes feed-interaction latency.
- **Likelihood:** Likely (healthy volume is almost certainly higher than stall volume)
- **Evidence:** Phase 2 Packet, Theme 5: Iterator 2 Finding 2 — newest observation 52.76 hours old at probe time; `?since=1d` returns `[]`; `/api/hotspots` returns `[]`. Phase 2 Packet, Gap 3: "healthy number might be 1,500–2,000."
- **What it looks like if realised:** A feed or scatter-plot designed for 344 rows behaves acceptably at 1,500 but may require pagination or virtualization logic that was not budgeted in the brainstorm.
- **Mitigation handle:** Resolve ingestor stall before the brainstorm finalises any path; re-measure volumes at healthy ingest. Alternatively, size any candidate design against a 2,000-row worst-case before committing.

### R3 — Reimagining recreates the ecoregion-taxonomy problem in a new medium

- **Severity:** High — The ecoregion framing produced three failures simultaneously: spatial misdirection, equal-weight visual encoding for unequal data density (Grand Canyon 2 obs vs. Sonoran 40×, Phase 2 Packet, Surprise 5), and an excluded user population. A new design organised around a different wrong taxonomy (e.g., county lines, admin regions) replicates the problem class.
- **Likelihood:** Possible
- **Evidence:** Phase 1 Packet, Convergence 4: "local birder with prior ecoregion knowledge" is the only well-served archetype. Phase 2 Packet, Theme 4, Iterator 4 blind spot: "Collapsed decisions — ecoregion taxonomy + polygon rendering + from-scratch SVG" were bundled into one decision; they can be separated.
- **What it looks like if realised:** A redesign organised around county or state administrative regions reproduces the spatial-misdirection failure (observation lat/lng still unused) and the equal-weight encoding failure (admin area size uncorrelated with bird density). The brainstorm mistakes "no SVG" for "no taxonomy problem."
- **Mitigation handle:** The brainstorm must explicitly name the organising taxonomy of any spatial component and verify it aligns with actual bird distribution data (density skew is 40×, not 2×).

### R4 — SpeciesPanel KEEP assumption breaks under non-map layout

- **Severity:** Medium — `SpeciesPanel` is the strongest user-task component (Phase 1 Packet, Surprise 4). If its layout assumption (`position: fixed`, documented as "deliberately not reflowing the map," `styles.css:94-100`, Phase 2 Packet, Surprise 6) is carried forward without rework, the panel's behaviour in a non-map layout is undefined.
- **Likelihood:** Likely (map-specific layout assumption needs rework in any non-map layout)
- **Evidence:** Phase 2 Packet, Theme 4, Counter 3: Iterator 4 partially upgrades SpeciesPanel from KEEP to REFACTOR specifically on the layout question. `styles.css:94-100` is the load-bearing reference.
- **What it looks like if realised:** Panel appears over a list or feed at wrong z-index, or the fixed positioning creates a dead zone in the primary content area. Early prototyping surfaces this; ignoring it during brainstorm causes a mid-implementation rework.
- **Mitigation handle:** The brainstorm should treat SpeciesPanel as REFACTOR-layout, not KEEP-as-is. The interaction logic, hook, and deep-link contract are KEEP; the CSS positioning block needs explicit redesign.

### R5 — URL-state migration silently breaks existing bookmarks

- **Severity:** Medium — `?region=sky-islands-huachucas` is a deep-link contract advertised in the current URL state. If the reimagining drops regions, any bookmarked URL silently delivers an empty or broken view.
- **Likelihood:** Likely (region param has no obvious successor in non-spatial paths)
- **Evidence:** Phase 2 Packet, Gap 5: "`?region=` migration policy. Existing bookmarks using the param will silently drop; redirect vs. silent-drop is a design decision." Phase 1 Packet covers `url-state.ts` as a KEEP file — the module survives but the `region` param's semantics change.
- **What it looks like if realised:** A user who bookmarked a region-specific view lands on a broken or undifferentiated default view post-redesign, with no redirect and no explanation.
- **Mitigation handle:** The brainstorm must produce a `?region=` migration policy before the plan is written: redirect to a region-filtered feed/list, preserve as a filter parameter, or display a graceful "this view has changed" message.

### R6 — Path selection ceiling mismatched to implementation rubric

- **Severity:** Medium — Iterator 1 scores Path C (hybrid) at 14/14 (Phase 2 Packet, Theme 2). If the brainstorm selects Path C but the implementation plan is authored at a Path A (non-spatial) rubric — without the geographic mode, hotspot scatter, or map integration — the resulting product delivers 11/14 while claiming 14/14.
- **Likelihood:** Possible (Path C's geographic mode is the harder, later-shipped half; a plan under time pressure may deprioritise it indefinitely)
- **Evidence:** Phase 2 Packet, Theme 2: "Path A and B are composable." Phase 2 Packet, Contradiction: "Fix in place vs. Reimagine is a 2-week spread, not a yes/no." The composability is a feature but also a temptation to ship Path A and defer Path B indefinitely.
- **What it looks like if realised:** Six months after the reimagining, the geographic mode is still "coming soon." T2 (near a place), T5 (where to go), and T6 (diversity at a glance) remain at score 1, same as current status quo minus the SVG pain.
- **Mitigation handle:** If Path C is chosen, the brainstorm must define a concrete milestone that gates "geographic mode ships" — a date or a feature flag — before the plan is written. Otherwise scope Path A explicitly and call Path B a future phase.

### R7 — "Ditch the map" misread as "ditch spatial entirely"

- **Severity:** Medium — The user's stated intent is to ditch the SVG ecoregion map (Phase 0 Packet, Situation). Iterator 4's blind spot flags: "personal project bias — user satisfaction and design preference may dominate theoretical task-fit; 'ditch it' might be engineer fatigue reified as a design conclusion" (Phase 2 Packet, Theme 4).
- **Likelihood:** Possible
- **Evidence:** Phase 2 Packet, Theme 2: Path B (real basemap) scores 9/14 and wins T2, T5, T6 — the geographic tasks. A pure non-spatial Path A leaves these at score 1. The user said "ditch the map," not "ditch geography." These are separable decisions (Phase 2 Packet, Theme 4, Counter 4).
- **What it looks like if realised:** The brainstorm produces a feed/list design, ships it, and the user six weeks later says "I miss being able to see where the birds are." Path B or C has to be retrofitted under time pressure.
- **Mitigation handle:** The brainstorm must explicitly ask the user to distinguish the two decisions: "ditch SVG ecoregion polygons" vs. "ditch geography entirely." The answer changes the optimal path and the implementation scope.

### R8 — No CDN/gzip on API; assumption of caching benefit is wrong

- **Severity:** Medium — The memory note states "Cloudflare fronts the deployment." This is accurate for the apex domain (`bird-maps.com`) but incorrect for the API (`api.bird-maps.com`), which is Google Frontend with no shared caching (Phase 2 Packet, Theme 5, Iterator 2 Finding 3). Any design that assumes cache-assisted latency on the API is building on an incorrect premise.
- **Likelihood:** Near-certain (the infrastructure state is confirmed by iterator measurement)
- **Evidence:** Phase 2 Packet, Theme 5: "API is direct Cloud Run with no CDN, no gzip, no shared cache. `Cache-Control` directives are browser-only."
- **What it looks like if realised:** A real-time feed design that refreshes on filter change issues full 101 KB uncompressed payloads to every client on every request. At 1,500 healthy-ingest rows, this could be 400–600 KB per request without compression.
- **Mitigation handle:** Enable gzip compression (Hono `compress()` middleware or Cloud Run response compression) before or concurrent with the redesign. This is a one-line change with ~90% payload reduction (Phase 2 Packet, Theme 5, Iterator 2 Finding 3 note on compression).

### R9 — Backend species-dedup semantics misunderstood

- **Severity:** Medium — The API returns one row per species, not one row per sighting (Phase 2 Packet, Theme 1, Corollary). Any design that assumes row count equals observation count, or that time-series abundance charts are derivable from current data, is wrong.
- **Likelihood:** Possible (the dedup is non-obvious from field names; `obsDt` on the row is last-observed date, not first or all dates)
- **Evidence:** Phase 2 Packet, Theme 1: "The backend pre-aggregates `/api/observations` to one row per species, not one row per sighting. Any metric needing observation counts (checklist volume over time, abundance) requires a backend aggregate."
- **What it looks like if realised:** A "sightings over time" histogram shows 344 bars (one per species, one date each) instead of thousands of individual sightings. The visual is wrong and the user is misled about data volume.
- **Mitigation handle:** The brainstorm must distinguish species-level metrics (diversity, rarity, family distribution — all feasible) from observation-level metrics (abundance over time, checklist counts — require a new backend aggregate). Mark the latter as out-of-scope for Phase 4 unless a backend endpoint is scoped explicitly.

### R10 — Process failure repeats: plan authored before prototype validation

- **Severity:** High — Five of six SVG correctness mechanisms were discoverable with a 2-hour prototype at production dimensions before the plan was written (Phase 2 Packet, Theme 3). Three of the five plan assumptions were tombstoned within four days. The plan was wrong on SVG fundamentals that are covered in the SVG specification.
- **Likelihood:** Possible (the same failure mode recurs if the planning process does not include a mandatory prototype gate)
- **Evidence:** Phase 2 Packet, Theme 3: "Catchable with a 2-hour prototype." Iterator 5's predictability categories: "Predictable from SVG fundamentals (not planned)," "Predictable from domain knowledge (not planned)." Phase 2 Packet, Surprise 7: `transform-origin: center` and `.badge-stack { transform: scale(1.5) }` tombstoned in production `styles.css:35`.
- **What it looks like if realised:** The next plan picks a rendering approach (e.g., tiled basemap with custom marker clustering) and commits it in detail before validating that the chosen approach handles the 344-marker case at 390×844 (mobile) dimensions. The first four PRs after ship are clustering-radius correctness fixes.
- **Mitigation handle:** The brainstorm output should include a mandatory prototype gate: "before the plan is written, render N representative observations in the candidate UI at mobile and desktop dimensions and confirm no correctness mechanisms beyond what is specified in the plan are required." This is Opportunity O7 below.

---

## Opportunity Inventory

Value-unlock scale: **High** (directly enables 2+ currently-failing user tasks or eliminates a blocking engineering cost), **Medium** (improves one failing task or reduces engineering cost meaningfully), **Low** (quality improvement, marginal task improvement).

Cost-to-realise scale: **Low** (zero backend changes; frontend-only; < 1 day), **Medium** (1–3 days; may touch API client or styles), **High** (new backend endpoint or architectural change; > 3 days).

### O1 — Resurrect `obsDt` to enable the time axis

- **Value unlock:** High — `obsDt` is the server's `ORDER BY` key (Phase 1 Packet, Surprise 3: `observations.ts:147`). Displaying it enables T7 (what's new) to move from score 0 to score 2. It also enables reverse-chronological feed sorting, "seen today" indicators, and feed freshness signals.
- **Cost to realise:** Low — Zero backend changes. The field is on the wire; the frontend never reads it (Phase 1 Packet, Surprise 3: `o.obsDt` grep returns zero frontend matches).
- **Evidence:** Phase 2 Packet, Theme 1, Corollary: "Any metric on species counts is trivially shippable." Phase 1 Packet, Convergence 2: "time axis is a ghost."

### O2 — Resurrect observation `lat/lng` to enable "near a place" and "where to go"

- **Value unlock:** High — Reading `lat` and `lng` from each observation enables T2 (near a place) and T5 (where to go) to move from score 0 toward score 2. These are the two tasks where Path B wins and Path A cannot improve beyond score 1.
- **Cost to realise:** Low (non-spatial display: show coordinates as text, enable distance-sort) to Medium (scatter plot on a geographic basemap).
- **Evidence:** Phase 1 Packet, Surprise 2: "`o.lat|o.lng` grep returns zero frontend matches." Phase 0 Packet, Anchor 1: observation lat/lng is on the API response. Phase 2 Packet, Theme 2: T2 and T5 score 0 currently, 2 on Path B, 2 on Path C.

### O3 — Resurrect `locName` and `howMany` to enable observation-level narrative

- **Value unlock:** Medium — Showing the hotspot name and count per row turns an abstract species badge into a readable sighting record ("3 Vermilion Flycatchers at Patagonia Lake SP"). This serves T3 (species detail) and the casual non-birder archetype without geographic commitment.
- **Cost to realise:** Low — Both fields are on the wire and unused by the frontend (Phase 1 Packet, Convergence 2).
- **Evidence:** Phase 2 Packet, Theme 1: "`locName`, `howMany`... any metric on species counts is trivially shippable."

### O4 — Resurrect row-level `isNotable` to enable finer notable elevation

- **Value unlock:** Medium — The current notable filter (`?notable=true`) filters at the API level. Row-level `isNotable` on each observation would enable a non-spatial design to visually distinguish notable and non-notable sightings within the same feed without re-fetching. Supports T1 (notable now) moving to score 2.
- **Cost to realise:** Low — Field is on the wire (Phase 1 Packet, Convergence 2); frontend reads the URL param but never the per-row field.
- **Evidence:** Phase 0 Packet, Anchor area-4 coverage; Phase 2 Packet, Theme 1 field list.

### O5 — Resurrect `taxonOrder` and `familyCode` for taxonomic browsing

- **Value unlock:** Medium — `taxonOrder` enables "browse by family in taxonomic order" (T4), which scores 1 currently and 2 under Path A and C. `familyCode` enables the family-colour encoding to be corrected (Phase 0 Anchor 7: current coupling of `silhouetteId` as `familyCode` is a tracked bug, issue #57).
- **Cost to realise:** Low — Both fields are on the API response. `taxonOrder` may contain nulls (Phase 2 Packet, Gap 4), requiring a null-handling policy.
- **Evidence:** Phase 1 Packet, Convergence 2: "familyCode (species)" listed as dropped field. Phase 0 Packet, Anchor 7: issue #57 tracks the deferred refactor.

### O6 — Gzip/compression: ~90% payload reduction at negligible cost

- **Value unlock:** High — 101 KB uncompressed becomes roughly 10 KB compressed. At healthy ingest volumes (1,500–2,000 rows), this difference between ~400–600 KB and ~40–60 KB is the difference between a design that works at mobile data rates and one that does not.
- **Cost to realise:** Low — One middleware line on the Hono server or a Cloud Run response-compression setting. No API contract change. No frontend change.
- **Evidence:** Phase 2 Packet, Theme 5, Iterator 2 Finding 3: "~90% payload reduction available as a free win." Phase 2 Packet, Risk R8 above: no current CDN or gzip on `api.bird-maps.com`.

### O7 — Mandatory prototype gate before plan authorship

- **Value unlock:** High — Iterator 5 categorises five of six SVG correctness mechanisms as "predictable from SVG fundamentals" — catchable with a 2-hour prototype (Phase 2 Packet, Theme 3). A gate that requires rendering representative data at production dimensions before a plan is committed would have prevented 8–12 rendering PRs and the ongoing two-pass refactor.
- **Cost to realise:** Low — A process decision, not a code change. Costs 2–4 hours of prototyping time; saves weeks of correctness-fix cycles.
- **Evidence:** Phase 2 Packet, Theme 3: "Catchable with a 2-hour prototype." Iterator 5 tombstone evidence: `styles.css:13`, `styles.css:35`.

### O8 — 49% usable scaffolding enables a true incremental migration

- **Value unlock:** High — 33% KEEP + 16% REFACTOR = 49% of production LOC survives. This means the reimagining can follow the strangler-fig pattern: deploy the new primary surface while the old map is still present behind a feature flag, then remove the DISCARD files once the new surface is validated.
- **Cost to realise:** Medium — Requires a feature-flag wrapper and careful boundary management at the KEEP/REFACTOR/DISCARD boundary. The boundary is already mapped (Phase 1, Area 5 manifest).
- **Evidence:** Phase 1 Packet, Convergence 3: "653 LOC of production code works unchanged." Phase 1 Packet, Headline: "roughly 33% of production LOC and 3 of 16 e2e specs are unchanged-KEEP; another 16% / 5 specs need selector updates."

### O9 — Path A / Path B composability enables staged delivery

- **Value unlock:** High — Path A and B are composable (Phase 2 Packet, Theme 2): they share the same state contract and KEEP infrastructure. Shipping Path A first gives the user a working, task-fit product in less time; layering Path B as a mode later avoids coupling all geographic complexity into the first release.
- **Cost to realise:** Medium — Requires the brainstorm to explicitly define the state-contract boundary between modes, so the Path B geographic mode can be added without rearchitecting the Path A feed.
- **Evidence:** Phase 2 Packet, Theme 2: "Path A and Path B are composable — they share the same state contract and KEEP infrastructure. Path C formalises that composition."

### O10 — 5 latent concepts implementable with zero backend changes

- **Value unlock:** Medium — Iterator 3 identifies five latent concepts that move the three zero-scoring tasks directly: per-obs timestamps (`obsDt`), per-obs location (`lat/lng`), hotspot freshness (`latestObsDt`), checklist grouping (`subId`), and taxonomic ordering (`taxonOrder`). Together these address T2, T5, and T7 (all currently at 0).
- **Cost to realise:** Low to Medium — All fields are on the wire. Implementation cost is display logic only; no backend changes required.
- **Evidence:** Phase 2 Packet, Theme 6: "5 LATENT: currently implementable with zero backend changes; map directly onto the 3 tasks that score 0 under current UI."

### O11 — `layoutBadges` concept is portable from a DISCARD file

- **Value unlock:** Low — The species-stacked aggregation concept (`layoutBadges`, 28 LOC inside `BadgeStack.tsx:1-28`, a 333-LOC DISCARD file) is UI-agnostic and reusable as a visual grouping primitive in any non-spatial design.
- **Cost to realise:** Low — Extract 28 LOC from a DISCARD file before deletion.
- **Evidence:** Phase 2 Packet, Theme 6: "`BadgeStack.tsx` (333 LOC DISCARD) contains one transferable concept (`layoutBadges`) in its first 28 lines."

---

## Risk x Opportunity Matrix

The table pairs high-severity risks against the highest-value opportunities. Column headers are opportunities that also function as risk mitigations. Cells note whether the opportunity directly addresses the risk.

| Risk | O1 obsDt | O2 lat/lng | O6 Gzip | O7 Prototype gate | O8 Scaffolding reuse | O9 Staged delivery |
|---|---|---|---|---|---|---|
| R1 Rendering churn escalates | — | — | — | Breaks the cycle | Enables DISCARD cleanly | Stop-loss at Path A |
| R2 Ingestor stall masks volume | — | — | Required if vol 5× | Size at 2k rows | — | Path A first while vol resolves |
| R3 Reimagining recreates taxonomy problem | — | Grounds taxonomy in real lat/lng | — | Validate density skew early | — | — |
| R6 Path C ceiling vs. Path A rubric | — | — | — | — | — | Explicit Path B milestone |
| R7 "Ditch map" misread | — | Directly surfaces geographic value | — | Geographic prototype clarifies | — | Path B as explicit mode |
| R8 No CDN/gzip | — | — | Eliminates directly | — | — | — |
| R10 Process failure repeats | — | — | — | Eliminates directly | — | — |

Key intersections the brainstorm must size before choosing a path:
1. R10 + O7 — The prototype gate is the single highest-leverage process intervention. It eliminates the primary root cause of the current churn (R1) and is the process answer to R10.
2. R7 + O2 + O9 — If the user wants geography, O2 (lat/lng resurrection) is the minimum viable geographic feature; O9 (staged delivery) lets it ship as a second phase without blocking the feed.
3. R2 + O6 — Gzip must be enabled before healthy ingest volumes are assumed to be within budget.

---

## Top 5 Takeaways for the Brainstorm

These are ordered by decision-forcing weight — the degree to which the brainstorm cannot proceed without resolving them.

**1. Resolve the "ditch SVG" vs. "ditch geography" question before all else (R7).**
The user said "ditch the map." The brainstorm must determine whether this means "ditch SVG ecoregion polygons" or "ditch geographic UI entirely." The answer determines whether Path A or Path C is the target, which changes implementation scope by weeks. No design conversation is meaningful until this is answered.

**2. Commit to a prototype gate as a process output of this brainstorm (O7, R10).**
The Phase 4 plan that emerges from this brainstorm must include a mandatory "render N representative observations at mobile and desktop dimensions, confirm no unspecified correctness mechanisms required" gate before the plan body is written. The failure mode that produced 8–12 rendering PRs is reproducible in any rendering approach and is preventable only at the process level.

**3. The five latent fields are the highest-ROI intervention and require zero backend changes (O1, O2, O4, O5, O10).**
`obsDt`, `lat`/`lng`, `isNotable` (row-level), `taxonOrder`, and `locName` are on every API response and are never read by the frontend. Reading them is the difference between three tasks scoring 0 and those same tasks scoring 2. The brainstorm should treat these as the first-day wins of any path.

**4. Enable gzip before scoping any design that assumes mobile viability (O6, R8).**
101 KB uncompressed at 344 rows becomes 400–600 KB at healthy ingest volumes without compression. This is not a design question; it is an infrastructure prerequisite. The brainstorm should flag it as a "before launch" gate on any new path, not a design consideration.

**5. SpeciesPanel is REFACTOR-layout, not KEEP-as-is (R4).**
The `position: fixed` layout assumption at `styles.css:94-100` is documented as serving the map's non-reflow requirement. Any non-map layout must explicitly redesign this block. The brainstorm should not treat SpeciesPanel as a free asset; it is an asset that requires a layout rework before it is usable in a non-map context.

---

## Confidence Assessment

**Overall confidence: Medium-High.**

The risk inventory rests on a large and internally-consistent evidence base: five Phase 1 investigations, five Phase 2 iterations, live API measurements, and source-code citations. The opportunity inventory rests on the same base plus the concept-salvage inventory (Iterator 3) and the task × path matrix (Iterator 1). No risk or opportunity in this synthesis is inferred without a direct citation.

Two factors constrain confidence below "High":

1. **No user research.** Static analysis cannot determine what a real user actually does or what they would value in a redesigned product. The task-fit matrix is analytically derived, not empirically validated. If the user's actual use pattern diverges from the seven tasks defined in Area 3, some opportunity ratings would shift.

2. **Volumes measured during ingestor stall.** The feasibility claims (O6, O2, R2) are all conditioned on 344-row measurements. Healthy-ingest volumes are estimated, not measured. This uncertainty propagates into any opportunity rated relative to data volume.

Both of these are documented as methodological limits, not investigative failures.

---

## Blind Spots

**1. User intent depth (better surfaced by a thematic lens).**
This risk lens treats "ditch the map" as an unambiguous input and catalogues risks around misreading it. A thematic lens would probe more deeply: what emotional or aesthetic register does the user want? Is the frustration about the SVG complexity specifically, or about the ecoregion abstraction, or about the solo-developer maintenance burden, or all three? Risk analysis cannot resolve motivation — it can only flag the consequence of getting it wrong.

**2. Opportunity sequencing and dependency (better surfaced by a gap/implication lens).**
The opportunities are rated individually but not sequenced. O6 (gzip) is a prerequisite for O2 (lat/lng in a feed at healthy volume), which is a prerequisite for O9 (staged delivery including geographic mode). A gap/implication synthesis would surface the dependency graph and identify which opportunities block others. This synthesis leaves that ordering to the brainstorm.

**3. Engineering-effort distribution (not surfaced by this lens at all).**
Risk and opportunity ratings assume a single developer with finite time. Some high-value opportunities (O2 with a real basemap, O9 staged delivery) carry "Medium" cost ratings that may be three times longer than the ratings suggest for a solo developer without prior basemap experience. A gap/implication or thematic lens that explicitly models the effort envelope would catch this.
