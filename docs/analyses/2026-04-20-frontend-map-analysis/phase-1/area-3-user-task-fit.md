# Investigation: Area 3 — User-Task Fit

## Summary

The spec commits to a single overarching task — "wander Arizona visually and discover what birds have been seen where, recently" — and then defines success almost entirely in rendering terms rather than user-outcome terms. The four filters (time window, notable toggle, family, species search) support a narrow set of concrete tasks, but the map metaphor makes the dominant task — location-based discovery — nearly impossible to accomplish without prior knowledge of ecoregion boundaries and names. The current design best serves a user who already knows both ecoregion geography and Arizona birding hotspots; it poorly serves or entirely excludes the visiting birder, the casual nature-curious user, and anyone trying to act on the "notable birds" task efficiently. Five of the seven tasks identified below score 0 or 1.

---

## Key Findings

### Finding 1: The spec's user task commitment is thin and rendering-centric

**Evidence:**

Spec §Goal (line 8): "A web application that lets a user wander Arizona visually and discover what birds have been seen where, recently. The map of Arizona is the centerpiece — divided into 9 birding-meaningful ecoregions rendered in a flat, geometric, poligap-style aesthetic."

Spec §Success criteria (lines 347–352):
- "A user can load the app, see Arizona divided into 9 ecoregions with sightings rendered as species-stacked badges with bird silhouettes."
- "Click any region → smoothly expands inline to show full badges with species names and counts."
- "Apply any of the four filters; URL updates; refreshing preserves state."
- "Data freshness: never more than 30 minutes stale during normal operation."
- "Cold-load to interactive map: under 2 seconds on broadband."

None of the success criteria describe a user goal — they describe rendering fidelity and mechanical correctness. The phrase "discover what birds have been seen where, recently" is the only user-outcome language in the spec. No user stories, no personas, no acceptance criteria framed as user actions with outcomes were committed.

Spec §Filters MVP (lines 233–244) defines four filter parameters: `since`, `notable`, `species`, `family`. These mechanically support filtering tasks but the spec does not state which user tasks motivate them or what a successful outcome looks like from a user perspective.

**Confidence:** High — read directly from spec text.

**Implication:** The product was designed around the rendering artifact (the map) rather than from user tasks outward. This is the root cause of the task-fit failures documented below; the tasks were never enumerated, so the map was never tested against them.

---

### Finding 2: The plan's promised experience is spatial exploration — a weak match for most birder tasks

**Evidence:**

Plan 4 Goal (lines 4–5): "Build the React + Vite frontend that renders Arizona as a stylized SVG of 9 ecoregions, places species-stacked badges with bird-silhouette icons inside each region, expands the selected region inline, supports four filters, and syncs everything to the URL for deep-linking."

Plan 4 Architecture (lines 6–7): "Single-page React app. Fetches `/api/regions`, `/api/hotspots`, and `/api/observations` once on mount and re-fetches `/api/observations` when filters change."

The plan frames the experience as spatial navigation: a user sees Arizona, orients by region, clicks a region to drill in. This is an exploration-first metaphor. It assumes the user has no prior intent — they arrive, visually scan the map, and discover. This assumption works for one archetype (casual nature-curious browser) but is actively hostile to the other two (local birder with a specific question, visiting birder looking for a location).

**Confidence:** High — inferred directly from plan text.

**Implication:** The architectural commitment to region-first exploration locked out intent-first user tasks (e.g., "show me notable birds right now" or "what's been seen near Tucson this week") before any code was written.

---

### Finding 3: The happy path spec reveals the author's mental model of the golden user journey

**Evidence:**

`frontend/e2e/happy-path.spec.ts` (lines 5–42): The golden path is: load map → expand a region (Sky Islands — Santa Ritas, accessed by label) → confirm URL updates → toggle Notable filter → reload and confirm state restored.

The test accesses the region by its accessible label string `'Sky Islands — Santa Ritas'`, not by any geographic orientation. The test author knows the ecoregion names. No step involves searching for a species, browsing by family, or locating a place by a recognisable geographic name. The happy path is a rendering/state-sync exercise, not a bird-discovery exercise.

**Confidence:** High — read from spec file directly.

**Implication:** The "golden journey" was designed to validate rendering and URL state, not to validate that any real user task succeeds. This is consistent with Finding 1: success criteria were rendering-centric from the start.

---

### Finding 4: The species detail panel (SpeciesPanel) is functionally isolated and well-implemented but has no discovery path

**Evidence:**

`frontend/src/components/SpeciesPanel.tsx` (lines 29–93): The panel opens when `speciesCode` is non-null, fetches `/api/species/:code`, and renders common name, scientific name, and family name. ESC and close button both dismiss. Accessible with `role="complementary"` and `aria-labelledby`.

`frontend/src/state/url-state.ts` (lines 37–38): `speciesCode` and `familyCode` both persist in URL state as `?species=` and `?family=` params, enabling deep-linking directly to a species view.

The panel serves the task "I saw X — tell me more" only if the user already knows the species code or common name to type. The only discovery path is: see a badge on the map → click it → panel opens. But the badge has no visible species name in the default (unexpanded) view (badges show only generic silhouette + color in default state; species names only appear after region expansion, per spec §Components). So the task "I saw X — tell me more" requires: know which region to expand → expand → find the badge → click. Each step presupposes prior knowledge.

**Confidence:** High — code confirms panel behavior; screenshot `bird-maps-default-1440.png` confirms badges carry no species labels in default state.

**Implication:** The SpeciesPanel is the UI's strongest user-task component in isolation (it renders detail cleanly, it deep-links, it handles ESC), but it is buried behind two prerequisite steps that require knowledge the user is trying to acquire.

---

### Finding 5: The ecoregion framing assumes an ecological mental model that most users do not have

**Evidence:**

The 9 region IDs (inferred from `url-state.ts` `?region=` param and the happy path spec): `colorado-plateau`, `lower-colorado-mojave`, `mogollon-rim`, `sonoran-phoenix`, `sonoran-tucson`, `grand-canyon`, `sky-islands-chiricahuas`, `sky-islands-huachucas`, `sky-islands-santa-ritas`.

Screenshot `bird-maps-default-1440.png`: The map shows no labels on any region polygon. There are no city names, no county lines, no state outline visible. A user who wants "birds near Tucson" must know that Tucson falls in the `sonoran-tucson` polygon, not in `sonoran-phoenix` or a Sky Islands region — none of which is labeled on the map. The only way to learn region identity is to click and look at what expands, or to guess.

The region names themselves use ecological/ornithological vocabulary: "Mogollon Rim," "Chiricahuas," "Lower Colorado/Mojave." "Grand Canyon" is recognisable. "Sonoran-Phoenix" and "Sonoran-Tucson" map approximately to user mental models of city-centered geography, but only approximately — the Sonoran-Tucson polygon extends well beyond the city's bounds and includes rural southeast Arizona.

Three of the 9 regions share an identical fill color `#B84C3A` (all Sky Islands variants — Chiricahuas, Huachucas, Santa Ritas, confirmed in phase-0 packet §Loadbearing fact 2). On the default map view, these three adjacent polygons are visually indistinguishable from one another without clicking each.

**Confidence:** High — screenshot evidence confirms absence of labels; color-sharing confirmed in phase-0 packet; region names from plan and spec.

**Implication:** A visiting birder or casual user cannot answer "which polygon is where I am going?" from the default view. The ecoregion taxonomy is meaningful to ornithologists planning trips along ecological gradients, but it is opaque to the two largest probable user groups: casual browsers and location-oriented visitors.

---

### Finding 6: The expand interaction delivers species names but at the cost of total spatial context loss

**Evidence:**

Screenshot `bird-maps-sonoran-tucson-expanded.png`: When Sonoran-Tucson is expanded, the polygon fills roughly 60% of the canvas (capped by `EXPAND_MAX_BBOX_FRAC = 0.6`, `frontend/src/components/Region.tsx:18`). All other regions are visible but dimmed; no labels appear on them. The expanded region shows a 4-column badge grid with species labels beneath each row — but the labels from four badges per row collide into unreadable strings: "Great Hbesdeny Cahyon Tantus Wren," "Brown-dBroadelBlack Ithrob Parchuloxia," and so on.

The expand interaction thus destroys geographic context (the other regions are de-emphasized) without delivering the user's actual goal (readable species names). It trades spatial orientation for legibility, and then fails to deliver legibility.

Screenshot `bird-maps-huachucas-expanded.png`: Sky Islands — Huachucas expands to a large red polygon containing a single giant grey badge (the pole-of-inaccessibility fallback, `BadgeStack.tsx:189-258` per phase-0 packet). The badge carries no species name, no count chip. The user gets no information about what birds have been seen there.

**Confidence:** High — visible in screenshots; behavior confirmed by phase-0 packet §Loadbearing fact 4 and 3.

**Implication:** The expand interaction, which is the primary drill-in mechanism for every user task, fails at both information delivery tasks it is supposed to serve: identifying species in a region and understanding how many are there.

---

### Finding 7: No user task for "what's been seen recently / what's new" is served despite the data being present

**Evidence:**

`frontend/src/state/url-state.ts` (lines 3–11): `since` is a first-class URL param with values `1d | 7d | 14d | 30d`. Default is `14d`. The notable toggle (`notable: boolean`) is also persisted.

`frontend/src/components/FiltersBar.tsx` (lines 43–54): The time window select and notable checkbox are rendered and functional — changing them triggers `/api/observations` re-fetch.

However: in the default view (`bird-maps-default-1440.png`), no per-observation timestamps are visible. Toggling "Notable only" re-renders the map with fewer badges, but there is no indication of when those notable observations occurred, in what order they arrived, or what is "new since yesterday." The map aggregates observations by region; temporal ordering is destroyed at the display level.

The spec explicitly stores `obsDt` on observations (phase-0 packet §Loadbearing fact 9: observations include `obsDt`). The current UI does not display it anywhere — not in badges, not in the expanded view, not in SpeciesPanel. A user who wants "what's new since yesterday" can set the time window to `1d` and see the resulting badge set, but cannot identify which specific observations are new, when they were submitted, or who submitted them.

**Confidence:** High — code confirms `since` filter works; screenshots confirm no temporal display; spec confirms `obsDt` is present in data.

**Implication:** The "staying current" task is partially gated by the filter but the data richness (timestamps, submission metadata) is entirely suppressed by the map metaphor.

---

## Task-Fit Matrix

### Identified User Tasks

The following 7 jobs-to-be-done were derived from the spec's goal statement, filter design, and the API's data surface. Each is graded 0–2 against the current UI.

| # | Task (Job-to-be-Done) | Grade | Justification |
|---|---|---|---|
| T1 | **Notable/rare birds in AZ right now** | 1 | "Notable only" toggle exists and filters correctly (`FiltersBar.tsx:56-63`). But the output is a re-rendered badge map — no list of notable birds, no timestamp, no indication of how rare or new each observation is. The task is gated but the answer is not readable. |
| T2 | **What's been seen near a specific place** | 0 | No place-name search, no geocoder, no hotspot-name display. The user must know which unlabeled polygon covers their location. Hotspot dots render at 0 visible size in default view (phase-0 packet §Loadbearing fact 5: "0 hotspot dots visible"). Tucson is inferrable from "Sonoran-Tucson" but only if the user recognises the name. |
| T3 | **I saw X — tell me more** | 1 | SpeciesPanel (`SpeciesPanel.tsx`) renders scientific name, family, and common name well. But getting there requires: (a) knowing which region to expand, (b) surviving the expand interaction, (c) finding and clicking the badge. No direct species search path that goes immediately to the panel — the species filter exists but filters the map display, not opens a panel. |
| T4 | **Browse by family (warblers, raptors, etc.)** | 1 | Family dropdown in FiltersBar exists and fires the `?family=` param. However the result is a re-filtered badge map with no family-level summary, no species list, no count by region. The user can narrow to one family but still reads a map of colored circles. |
| T5 | **Find where to go for a species I want to see** | 0 | No path to this task. Species filter narrows to observations of a species; the map shows which region(s) have badges for it. But no hotspot dots are visible at default zoom (phase-0 §Loadbearing fact 5), and the badge-to-region mapping does not tell the user which specific location to visit. `obsDt`, `lat`, `lng` on observations are not displayed. |
| T6 | **Understand bird diversity across AZ at a glance** | 1 | The default map view shows 9 regions with colored badge clusters, which gives a rough spatial impression of diversity. But overflow pips ("+77," "+67," "+64") mean the most species-rich regions show the least information — the user sees a number, not species. Three Sky Islands sharing the same color are indistinguishable. The impression is plausible but misleading. |
| T7 | **Stay current — what's new since yesterday** | 0 | The `since=1d` filter narrows observations, but no temporal ordering or "new" marking is visible. The UI presents a badge aggregate with no timeline, no per-observation timestamp, no indication of what changed. |

**Score summary:** T1, T3, T4, T6 each score 1 (served poorly). T2, T5, T7 score 0 (not served). No task scores 2. The spec's explicit goal — "discover what birds have been seen where, recently" — decomposes into T2 (where) and T7 (recently), both of which score 0.

---

## The Ecoregion Framing's Cost

The 9 ecoregion names fall into two recognisability groups:

**Broadly recognisable:** Grand Canyon, Sonoran-Phoenix, Sonoran-Tucson. A tourist or day-tripper can map these to places they intend to visit.

**Ecologist vocabulary:** Colorado Plateau, Lower Colorado/Mojave, Mogollon Rim, Sky Islands (three sub-regions). A visiting birder planning a Sky Islands trip may know these terms; a casual user from outside Arizona almost certainly does not.

The critical failure is that the map carries no labels whatsoever in the default view (`bird-maps-default-1440.png`). A user who does not already know the ecoregion layout must either click each polygon experimentally to learn its name (no affordance signals which polygon is which before clicking), or bring prior knowledge that the map does not supply. This means the map's primary orientation function — "where am I looking?" — requires external context.

The badge grid position within a polygon is not geographically meaningful. Badges are laid out in a grid rastered from the largest-inscribed-rect algorithm (`geo/path.ts:140-209`, phase-0 packet §Loadbearing fact 4). A user scanning the badge grid for a species might infer that a badge in the top-left of the polygon corresponds to the top-left of the geographic region. It does not. This creates an active misinformation risk: the spatial metaphor suggests geographic meaning that the rendering system explicitly does not supply.

---

## User Archetype Assessment

### (a) Local birder who knows AZ well

This user knows ecoregion names, can navigate the unlabeled polygon map by shape recognition, and understands why the Huachucas and Chiricahuas are separate Sky Islands. The current design serves them better than the other archetypes — they can orient by shape and name. However, even this user is poorly served by: the unreadable label collisions in expand view (`bird-maps-sonoran-tucson-expanded.png`), the total information loss in the Huachucas expand view (`bird-maps-huachucas-expanded.png`), and the absence of any temporal ordering for "what's new." The local birder's expert knowledge compensates for orientation failures but cannot compensate for display failures once the region is expanded.

### (b) Visiting birder or tourist

This user typically arrives with a target location (Tucson, Sedona, Grand Canyon) or a target species list. They cannot reliably identify unlabeled polygons. Even "Sonoran-Tucson" is partially ambiguous — does it include Saguaro National Park? Madera Canyon? The expand reveals no hotspot-level information. The visiting birder needs "where exactly" and "what's there now"; the UI delivers neither. Grade: excluded from the primary use case.

### (c) Nature-curious non-birder

This user might be willing to visually explore a "pretty map of Arizona birds." The default view (`bird-maps-default-1440.png`) has some aesthetic appeal — flat colored regions, colored circles. But within seconds: no bird names visible without clicking (species labels only appear post-expand), expand fails to deliver readable names, the color encoding has no legend, and the generic silhouette means every badge looks identical. The non-birder's curiosity is not rewarded. On mobile (`bird-maps-mobile-390.png`), the map is roughly 350px square with 30% empty space below; badges are near-unclickable. Grade: briefly engaged, quickly lost.

**Design serves best:** Local birder with prior ecoregion knowledge — but even for them, the expand view's failures make the primary drill-in mechanism unusable.

**Design excludes:** Visiting birder and casual non-birder. These are the two largest probable audience segments for a public-facing bird observation web app.

---

## Active Misdirections in the Current UI

1. **Badge position within polygon implies geographic placement.** It does not — badges are grid-laid into the largest inscribed rectangle. A Sonoran-Tucson badge in the lower-right of the polygon is not from the southeastern part of that ecoregion. The spatial metaphor actively misleads. (Source: phase-0 packet §Suspected unknowns; `geo/path.ts:140-209`.)

2. **Three identical polygons for three Sky Islands sub-regions.** The same fill color `#B84C3A` on Chiricahuas, Huachucas, and Santa Ritas (phase-0 §Loadbearing fact 2) means a user cannot distinguish three birding destinations that are genuinely very different (elevation profiles, species assemblages). The visual collapse is particularly damaging because Sky Islands birding is a specific, high-value use case.

3. **Overflow pips bury the most information-dense regions.** The Sonoran-Phoenix region shows "+77" (default view screenshot), meaning 77 species are hidden. The regions with the richest observations show the least information. A user who clicks that pip gets the expand view, which itself fails to display names legibly. The pip creates a promise the expand cannot keep.

4. **"Notable only" toggle fires a map re-render, not a notable-bird list.** The user who wants to know "what rare birds are in AZ this week" toggles Notable, sees a sparser badge set, and still cannot read species names without expanding. The filter serves data correctness but not the user's intent.

---

## Surprises

- The SpeciesPanel is genuinely well-implemented in isolation — accessible, ESC-dismissible, deep-linkable — but its access path through the map makes it nearly unreachable for most user journeys. The best feature is behind the worst interaction.
- The spec's success criteria contain zero user-outcome statements. This is not a code problem — it is a product specification problem that manifests as no user-task anchor for any rendering or interaction decision.
- The `obsDt` field is captured per-observation at ingest and available on the API but is invisible to the user at every layer of the UI. The spec explicitly defines `since` filtering, which depends on `obsDt`, but the field's value is never surfaced directly.
- The `lat`/`lng` fields on observations (phase-0 §Loadbearing fact 9) are present in the API response but unused by the current UI — all geographic display is region-aggregated. The data to answer "where exactly was this seen" exists but is discarded at the display boundary.

---

## Unknowns and Gaps

- **No real user research exists.** All task grades are inferred from code behavior and spec text, not from actual user sessions. It is unknown whether the local birder archetype is even the intended primary audience, or whether the product was built more as a technical demonstration.
- **Hotspot dot behavior is unconfirmed beyond default view.** Phase-0 confirms 0 hotspot dots visible in default view. Whether hotspot dots appear and become meaningful in the expanded view was not confirmed from screenshots (only default and two expanded states were captured).
- **The family filter's utility is contingent on seed data.** `filters.spec.ts` lines 22–23 show the test skips if `count <= 1` (no families loaded). Whether this filter is usable in production with real seed data is unknown.
- **Whether the ecoregion taxonomy resonates with actual eBird users** is not assessable from code alone. eBird uses county-level and hotspot-level geography, not ecoregion taxonomy. Users coming from eBird's own interface may find the 9-region coarseness disorienting in a different direction than casual users.

---

## Raw Evidence

- `/Users/j/repos/bird-watch/docs/specs/2026-04-16-bird-watch-design.md` — §Goal line 8, §Filters lines 233–244, §Success criteria lines 345–352
- `/Users/j/repos/bird-watch/docs/plans/2026-04-16-plan-4-frontend.md` — lines 4–9 (Goal + Architecture)
- `/Users/j/repos/bird-watch/frontend/src/App.tsx` — lines 28–30 (silhouetteFor returns GENERIC), lines 32–43 (colorFor coupling note), lines 66–101 (composition: FiltersBar + Map + SpeciesPanel)
- `/Users/j/repos/bird-watch/frontend/src/components/FiltersBar.tsx` — lines 43–99 (four filter controls)
- `/Users/j/repos/bird-watch/frontend/src/components/SpeciesPanel.tsx` — lines 47–93 (detail panel render)
- `/Users/j/repos/bird-watch/frontend/src/state/url-state.ts` — lines 3–11 (UrlState type), lines 36–46 (writeUrl, confirms which params persist)
- `/Users/j/repos/bird-watch/frontend/e2e/happy-path.spec.ts` — lines 5–42 (golden path: expand by label, toggle notable, reload)
- `/Users/j/repos/bird-watch/frontend/e2e/species-panel.spec.ts` — lines 15–109 (species panel flows)
- `/Users/j/repos/bird-watch/frontend/e2e/filters.spec.ts` — lines 5–60 (filter interaction flows)
- `phase-0/screenshots/bird-maps-default-1440.png` — default view: no region labels, overflow pips visible, 0 species names
- `phase-0/screenshots/bird-maps-sonoran-tucson-expanded.png` — label collision visible: "Great Hbesdeny Cahyon Tantus Wren"
- `phase-0/screenshots/bird-maps-huachucas-expanded.png` — single giant grey badge, no species name, no count
- `phase-0/screenshots/bird-maps-mobile-390.png` — 350px map, 30% empty below, near-unclickable badges
- `/Users/j/repos/bird-watch/docs/analyses/2026-04-20-frontend-map-analysis/context-packets/phase-0-packet.md` — §Loadbearing facts 1–8
