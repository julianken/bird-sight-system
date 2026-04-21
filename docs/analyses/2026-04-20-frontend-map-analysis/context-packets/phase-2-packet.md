# Phase 2 Packet — Shared Context for Phase 3 Synthesizers

The five Phase 2 iterators deepened the Phase 1 picture. Their findings cluster into six themes. This packet is the handoff to the three Phase 3 synthesizers, each of whom applies a different lens (thematic / risk-opportunity / gap-implication) to produce a Phase 3 output. Full iterator reports live at `phase-2/iterator-{1..5}-*.md`.

## Headline

Phase 2 confirms every Phase 1 convergence with caveats. The most actionable new findings: (a) data feasibility is not a volume problem — actual `?since=14d` is 344 species / 101 KB uncompressed, well under any threshold; (b) the path with strongest task-fit is **hybrid** (non-spatial primary + optional geographic mode, 14/14) not pure non-spatial (11/14) or pure new-basemap (9/14); (c) the plan was wrong on SVG fundamentals in a way that was knowable with a 2-hour prototype — this is a *process* lesson, not just an outcome lesson; (d) red-team finds the "execution not design" counter moderately credible: a real map library like Mapbox would close 80% of the dragons but wouldn't rescue the UX failures; (e) a production ingest incident is masking data volumes — ingestor stalled 52+ hours as of probe time.

---

## Theme 1: Feasibility is generous, not a constraint

Phase 1 Area 4 flagged unknown production volume as a risk. Iterator 2 measured and resolved it: **feasibility is not a volume problem**.

**Measured facts (2026-04-21 03:09Z):**
- `?since=14d`: 344 observations, 344 distinct species, 101 KB uncompressed, 220–280 ms median TTFB.
- `?since=30d`: 346 rows (only +2 over 14d — curve plateaus).
- `?since=14d&notable=true`: 53 rows.
- `/api/regions`: 2.4 KB.
- No virtualization needed for any feed. Naive SVG scatter plot (344 markers) works. `/api/species` index not needed — result set is the species index.

**Corollary from Iterator 1:** Every feasibility score jump between redesign paths is caused by **field resurrection** — reading `obsDt`, observation `lat/lng`, `locName`, `howMany`, `isNotable`, `latestObsDt`, `familyCode`, `taxonOrder` — not by new backend endpoints.

**The one semantic caveat (Iterator 2 Finding 1, new info):** The backend pre-aggregates `/api/observations` to **one row per species**, not one row per sighting. Any metric needing observation counts (checklist volume over time, abundance) requires a backend aggregate. Any metric on species counts (diversity, rarity, family distribution) is trivially shippable.

## Theme 2: Path C (hybrid) dominates by fit; Path A is closest runner-up

Iterator 1's task × surface × path matrix (7 tasks × 3 paths = 21 cells):

| Task | Current | Path A (non-spatial) | Path B (real basemap) | Path C (hybrid) |
|---|---|---|---|---|
| T1 — Notable now | 1 | **2** | 1 | **2** |
| T2 — Near a place | 0 | 1 | **2** | **2** |
| T3 — Species detail | 1 | **2** | 1 | **2** |
| T4 — Browse by family | 1 | **2** | 0 | **2** |
| T5 — Where to go | 0 | 1 | **2** | **2** |
| T6 — Diversity at a glance | 1 | 1 | **2** | **2** |
| T7 — What's new | 0 | **2** | 1 | **2** |
| **Totals** | 6/14 | **11/14** | 9/14 | **14/14** |

- **Path A wins** T1, T3, T4, T7 (feed-style, taxonomy, temporal — non-geographic questions).
- **Path B wins** T2, T5, T6 (where-questions — geographic dominates).
- **Path C wins** everything. Serves visiting birder best; casual non-birder second-best after Path A.
- **Path A and Path B are composable** — they share the same state contract and KEEP infrastructure. Path C formalises that composition.
- Path A task-surfaces: reverse-chron feed; species-first search with panel; hotspot ranked list.
- Path B task-surfaces: obs + hotspot scatter on tiled basemap; richness heat map.
- Path C task-surfaces: feed-primary with geographic drill-down; species hub with location context; hotspot hub with geographic placement.

## Theme 3: The plan was wrong on SVG fundamentals — a process lesson

Iterator 5 reconstructs the timeline. **Zero of 6 SVG correctness mechanisms** (inscribed rect, pole-of-inaccessibility, expand cap, paint-order sort, two-pass layers, non-scaling-stroke) existed in plan-4. Five specific plan assumptions were tombstoned in production code within days:

- `transform-origin: center` → replaced by `transform-origin: 0 0` (`styles.css:13`, with 4-line comment). SVG origin fundamentals.
- `.region-expanded .badge-stack { transform: scale(1.5) }` → tombstoned at `styles.css:35`.
- One root SVG with per-region `<g>` → replaced by two-pass layer architecture (`Map.tsx:89-113`, in-flight on current branch).
- `boundingBoxOfPath`-only geometry → expanded to 302 LOC with `largestInscribedRect` + `poleOfInaccessibility`.
- "CSS transitions on `transform` are sufficient" → required 6 correctness mechanisms.

Iterator 5's three predictability categories:
- **Predictable from SVG fundamentals (not planned):** paint-order z-index, transform-origin, non-scaling-stroke, drop-shadow coordinate space. Catchable with a 2-hour prototype.
- **Predictable from domain knowledge (not planned):** concave sky-island polygons. Knowable to anyone who looked at AZ sky-island geography.
- **Genuinely emergent (unforeseeable from static analysis):** exact scale values for EXPAND_MAX_BBOX_FRAC, Safari vector-effect bug, pip-offset regression.

**Iterator 5's 1-week estimate:** 3–5 of 18 dragons would close with a focused week; 13–15 are structural to the SVG choice.

**Iterator 5's trajectory verdict:** Not stabilising. The current branch (`refactor/two-pass-map-render`) is still completing the architectural pivot initiated in PR #102, one day after first deploy.

## Theme 4: Red-team caveats — counters reframe, don't flip

Iterator 4 stress-tested Phase 1's four big convergences. None of the counters overturn the conclusion, but several warrant incorporation as caveats in Phase 3:

- **Counter 1: "SVG map underexecuted, not inherent"** — **Moderate credibility.** Half of Area 1's failures (colour legend, tap targets, affordance, vocabulary) are genuinely fixable in-metaphor; the label-collision geometry and spatial-misdirection are structural.
- **Counter 2: "Dropped data is legitimate simplification"** — **Moderate → Weak.** `lat/lng`, `subId`, `howMany`, `locName` could defensibly stay dropped. `obsDt` is indefensible — server sorts by it, spec mandates `since` filter, UI shows nothing temporal.
- **Counter 3: "KEEP is overstated"** — **Weak → Moderate.** `SpeciesPanel`'s `position: fixed` layout is documented as serving the *map* (`styles.css:94-100`) and may need rework. `ApiClient` may need pagination/sort extensions.
- **Counter 4 (bonus): "Execution, not design"** — **Moderate.** Mapbox/Leaflet would close ~80% of Area 2's dragons. But this counter doesn't touch the UX failures Area 1 identified. The most important separation: **"rendering pain" and "metaphor failure" are two decisions, not one.**

**Iterator 4's blind spots:**
- **Personal project bias** — user satisfaction and design preference may dominate theoretical task-fit; "ditch it" might be engineer fatigue reified as a design conclusion.
- **Collapsed decisions** — the convergence rolled "ecoregion taxonomy" + "polygon rendering" + "from-scratch SVG" into one verdict. These are three separable decisions.
- **No user research** — static analysis cannot resolve what a real user actually does.

## Theme 5: Operational incident surfaced during investigation

Not a design finding, but Phase 3 must acknowledge it because it affects every volume claim:

- **Iterator 2 Finding 2:** Newest observation at 14d is 52.76 hours old at probe time. `?since=1d` returns `[]`. `/api/hotspots` returns `[]`. Ingestor has not produced rows in 52+ hours.
- **Iterator 2 Finding 3:** API is direct Cloud Run with **no CDN, no gzip, no shared cache**. The apex site is Cloudflare-fronted; `api.bird-maps.com` is Google Frontend. `Cache-Control` directives are browser-only. The memory note says "Cloudflare fronts the deployment" — accurate for the apex, incomplete for the API.
- **Iterator 2 Finding 4:** Latency is healthy (220–280 ms median for 100 KB).

These are production concerns, not design questions, but Phase 3 synthesizers should caveat any "data is shippable today" claim with "measured during a stalled-ingest regime."

## Theme 6: Concept-level salvage is richer than file-level salvage

Iterator 3's 22-concept inventory (17 implemented + 5 latent) classifies concepts rather than files:

- **9 UI-AGNOSTIC:** deep-linkable filter state, notable elevation, time-window filter, URL-driven detail panel, accessible-name-first interaction, axe-scan discipline, `test.fail()` documentation pattern, species-stacked aggregation (`layoutBadges` 28 LOC inside 333 LOC DISCARD file), obsDt-ordering for feeds, hotspot-freshness indicator, per-obs location data, checklist grouping, taxonomic order — **transfer cleanly to any UI.**
- **7 MAP-SHAPED:** colour-by-family, count chip, overflow summary, activity-level size encoding, region selection, region hierarchy (parentId), ecoregion taxonomy — **concept survives, expression changes.**
- **1 MAP-BOUND:** inline-expand / `computeExpandTransform` — **drop from consideration.**
- **5 LATENT:** per-obs timestamps, hotspot freshness, per-obs location, checklist grouping, taxonomic ordering — **currently implementable with zero backend changes**; map directly onto the 3 tasks that score 0 under current UI (T2, T5, T7).

Actionable insight: `geo/path.ts` (301 LOC DISCARD) contains zero transferable concepts; `BadgeStack.tsx` (333 LOC DISCARD) contains one transferable concept (`layoutBadges`) in its first 28 lines.

---

## Surprises worth elevating to Phase 3

1. **Backend pre-aggregation (Iterator 2 Finding 1):** `/api/observations` returns one row per species, not one per sighting. Reframes which tasks are feasible and which need backend aggregate endpoints.
2. **API not behind Cloudflare (Iterator 2 Finding 3):** Infrastructure differs from the memory note; no shared caching benefit.
3. **Ingestor stalled (Iterator 2 Finding 2):** Operational incident. Volume numbers are measured in a degraded regime.
4. **30d-14d plateau (Iterator 2 Finding 7):** Only +2 rows from 14d to 30d at this volume. The since-slider is redundant past 14d in current regime.
5. **Grand Canyon has 2 observations in 14d (Iterator 2 Finding 6):** A ~40× density skew across regions that the equal-weight polygon encoding suppresses visually.
6. **SpeciesPanel layout serves the map (Iterator 4):** The `position: fixed` choice at `styles.css:94-100` is documented as deliberately not reflowing the map. Needs rework in a non-map layout.
7. **Plan tombstones prove wrongness (Iterator 5):** `transform-origin: center` and `.badge-stack { transform: scale(1.5) }` from Plan 4 Task 9 Step 4 are tombstoned in production `styles.css:35`. The plan was not merely under-specified; it was actively wrong on SVG fundamentals.
8. **Four-day plan-to-refactor interval (Iterator 5):** The per-region `<g>` structure from plan Task 9 lasted under 4 days before the two-pass refactor began. 8–12 rendering PRs fell in that window.

## Contradictions and tensions

- **"Fix in place" vs "Reimagine" is a 2-week spread, not a yes/no.** Iterator 4 Counter 1 (moderate credibility) + Iterator 5's 3–5 dragons fix estimate together suggest a 1–2 week focused rescue closes roughly half the UX pain. This is a real option that Phase 3 should size rather than dismiss.
- **Path B has strength on T2/T5/T6 but loses T4 entirely.** "Pure real basemap" is not a Pareto improvement. Path C is the only strictly-dominant option.
- **Iterator 4 Counter 3 partially upgrades Phase 1's KEEP classifications to REFACTOR** — specifically `SpeciesPanel` layout and `ApiClient` potential pagination extensions. Minor but worth noting.

## Gaps still open

1. **No user research.** Methodological limit of static analysis. Phase 3 should acknowledge this as an uncertainty, not close it.
2. **Ingestor root cause.** Operational issue; not within analysis scope.
3. **Healthy-ingestor volumes.** Current 344/14d is measured during stall; healthy number might be 1,500–2,000. Still clears virtualization thresholds but narrows the margin.
4. **`taxonOrder` completeness in seed.** Null is valid per type.
5. **`?region=` migration policy.** Existing bookmarks using the param will silently drop; redirect vs. silent-drop is a design decision.

---

## What Phase 3 is for

- **Synthesizer 1 (thematic):** Weave the six themes + new surprises into 3–5 coherent themes that tell the full story.
- **Synthesizer 2 (risk / opportunity):** Rate each finding's risk (if ignored) and opportunity (if acted on). Severity-rated.
- **Synthesizer 3 (gap / implication):** What can the brainstorm act on now? What needs resolution first? What remains unknown?

All three read the phase-0 packet + phase-1 packet + this packet + their lens-specific instructions. The phase-3 synthesizers do NOT read raw iterator reports unless necessary for a specific citation — the packets are the designed handoff.

## What Phase 3 is NOT for

- Proposing the replacement UI (that's the brainstorm).
- Library recommendations (Leaflet, Mapbox, deck.gl).
- Fixing the ingestor stall.
- Closing the user-research gap.

Phase 3 builds the narrative from evidence; the brainstorm builds the design.

---

## Phase 2 artifact index

- `phase-2/iterator-1-task-surface-matrix.md` — task × path scores, task-surfaces, composability, archetype fit.
- `phase-2/iterator-2-production-data-volume.md` — live API measurements, feasibility matrix, ingest-incident flag, infrastructure clarification.
- `phase-2/iterator-3-concept-salvage.md` — 22-concept inventory (17 current + 5 latent), each classified with code citation.
- `phase-2/iterator-4-red-team.md` — four counter-positions stress-tested, credibility-rated, blind spots surfaced.
- `phase-2/iterator-5-historical-timeline.md` — plan-vs-production tombstone analysis, predictability categories, dragon-closure estimate.
