# Phase 1 Packet — Shared Context for Phase 2 Iterators

The five Phase 1 investigators converged strongly. This packet compresses the outputs into convergences, contradictions, gaps, and surprises. Every Phase 2 iterator receives it verbatim plus their specific task.

The full Phase 1 reports live at `phase-1/area-{1..5}-*.md` if the iterator needs to drill into raw findings.

## Headline

The map-based design fails the stated product goal across every dimension independently investigated — visual legibility (Area 1), user-task fit (Area 3), engineering cost (Area 2), and surfaced-vs-dropped data (Area 4). The non-map scaffolding is sound and survives a redesign intact (Area 5). Reimagining is not starting from zero: roughly 33% of production LOC and 3 of 16 e2e specs are unchanged-KEEP; another 16% / 5 specs need selector updates.

## Convergences (all 5 areas agree)

1. **The SVG ecoregion map is the primary failure surface.** Area 1 classifies five UX failures as *inherent to the metaphor*: no semantic entry point, label collision in expand, Sky Islands fallback renders a giant grey blank, spatial encoding is actively misleading, overflow-pip dominance. Area 2 documents 18 "here be dragons" comment blocks and 6 distinct SVG-specific correctness mechanisms, none of which would exist in a non-SVG UI. Area 3 grades all 7 user tasks at 0 or 1 — no task scores 2. Area 5 classifies the entire map rendering chain (`Map.tsx`, `Region.tsx`, `Badge.tsx`, `BadgeStack.tsx`, `HotspotDot.tsx`, `geo/path.ts`) as DISCARD, totalling 1,000 LOC of production code.

2. **Rich data is being dropped at the display layer.** Area 4 documents 12 populated fields the UI ignores: `obsDt`, observation `lat/lng`, `howMany`, `subId`, `latestObsDt`, row-level `isNotable`, `locId/locName` (obs), `taxonOrder`, `familyCode` (species), hotspot `regionId`. Area 3 independently arrives at the same finding via tasks T2/T5/T7: "where exactly", "find where to go", "what's new" all fail because the UI drops the lat/lng and obsDt needed to answer them. The time axis is a ghost.

3. **The non-map scaffolding is engineering-sound and reusable.** Area 5 marks `api/client.ts` (51 LOC), `data/use-species-detail.ts` (72), `FiltersBar.tsx` (101), `SpeciesPanel.tsx` (93), `derived.ts` (38), and several smaller files as KEEP — 653 LOC of production code works unchanged. Area 4 agrees: the API surface supports temporal feed, spatial plot, hotspot list, species hub, and search list *without* backend changes. Area 3 notes `SpeciesPanel` is "the UI's strongest user-task component in isolation" and `useSpeciesDetail` "the cleanest hook in the codebase" (Area 5).

4. **The ecoregion framing excludes most plausible users.** Area 1: the map has no labels whatsoever; three Sky Islands share identical fill color; default view communicates nothing without prior knowledge. Area 3: "visiting birder or tourist: excluded from the primary use case"; "nature-curious non-birder: briefly engaged, quickly lost." Both areas converge on "local birder with prior ecoregion knowledge" being the only well-served archetype, and even for them the expand interaction fails.

5. **The rendering churn is not declining.** Area 2: 8 of the last 10 merged PRs (#93–#102) are rendering fixes — an 80% churn rate for the window. 10 of the last 30 are rendering-correctness work — 33% across the broader stream. Each fix resolves one acute problem while 16 more regression vectors remain actively managed via documented dragons-comments.

## Surprises worth elevating

1. **The `parent_id` column on the `regions` table exists to serve the SVG paint-order sort, not to model data hierarchy.** Area 2 traces `migrations/1700000011000:148-153` → `Map.tsx:60-87`. The data model was modified to serve the rendering engine. Similarly, migration `1700000012000` clamps polygon vertices purely because SVG z-fighting at the map canvas level. Two database migrations (306 SQL LOC combined) exist purely because of the SVG rendering choice.

2. **Observation `lat/lng` is on the wire and never read by the frontend.** Area 4 greps: `o\.lat|o\.lng|observation\.lat|observation\.lng` in `frontend/src/` — zero matches. The map visually suggests "sightings here" but actually displays "sightings somewhere in this polygon, shown at the polygon's pole-of-inaccessibility." This is what Area 1 identifies as *actively misleading* spatial encoding.

3. **`obsDt` is the server's `ORDER BY` key but the client never reads it.** Area 4: `observations.ts:147` orders by `obs_dt DESC`, yet no UI code dereferences the field on any observation. Area 3 independently notes the UI "presents a badge aggregate with no timeline, no per-observation timestamp" and scores T7 (what's new) at 0.

4. **The species panel is the strongest feature, buried behind the weakest interaction.** Area 5: `SpeciesPanel` + `useSpeciesDetail` are fully portable, deep-linkable, accessible, ESC-dismissible. Area 3: "the best feature is behind the worst interaction" — reaching the panel requires knowing which region to expand → surviving the expand → finding a badge → clicking it. No direct species-search-to-panel path in the primary flow.

5. **Label collision in expanded view is total, not partial.** Area 1: every label row in `bird-maps-sonoran-tucson-expanded.png` is illegible; the vertical row-stride was budgeted (`EXPANDED_LABEL_HEIGHT = 14`) but horizontal collision was never budgeted. Area 2 documents the dragons-comment at `BadgeStack.tsx:164-170`.

6. **The happy-path e2e spec tests rendering, not bird-discovery.** Area 3: `happy-path.spec.ts` golden path is load → expand Sky Islands → toggle notable → reload. Uses region accessible-label string (`'Sky Islands — Santa Ritas'`), never searches for a species or finds a place. "The 'golden journey' was designed to validate rendering and URL state, not to validate that any real user task succeeds."

7. **History-nav.spec.ts is `test.fail()` on both tests** — documenting a known `replaceState` vs `pushState` bug. This spec belongs in KEEP because intent is design-agnostic (Area 5).

8. **The generic silhouette renders for every species.** Area 1: badge color is the sole per-species visual differentiator. `App.tsx:28-30` returns `GENERIC_SILHOUETTE.path` unconditionally. No legend exists. A user looking at the default view has no way to decode any colour.

## Contradictions and tensions to flag

Minor and resolvable, but worth naming:

- **Area 5 reclassifies `happy-path.spec.ts` as DISCARD** whereas the phase-0 packet and Area 2 implied REFACTOR. Area 5's reasoning (one non-map assertion, already covered elsewhere) is convincing. **Treat as DISCARD going forward.**
- **LOC totals vs. percentages** — Area 5's combined-totals math hits a snag because the phase-0 packet's "2566 LOC total" included production source only, not e2e. Production-source KEEP/REFACTOR/DISCARD = 33% / 16% / 51% (from Area 5's table §7). Total-frontend-including-tests numbers are larger in both directions.
- **"Keep hotspot display?"** — Area 4 classifies `Hotspot.latestObsDt` as "dropped, ignored" and `Hotspot.numSpeciesAlltime` as "used (for log-scale radius)." Area 5 classifies `HotspotDot.tsx` as DISCARD. Whether hotspot-centric UI survives is a design question, unresolved by Phase 1.
- **`getRegions()` survival** — Area 5 flags the `ApiClient.getRegions()` call as ambiguous (may have zero utility in a map-less UI, or may be used for a region-selector dropdown). Unresolved.
- **Family-dropdown completeness** — Area 4 surfaces a latent coupling not previously flagged: the family dropdown reflects only families present in the current `?since=` window, not all AZ families. Any taxonomic browser would want a stable `/api/families` endpoint.

## Gaps to fill in Phase 2

1. **No actual user research.** Area 1 and Area 3 both infer from code and screenshots; neither can report what users actually do. This is a methodological limit of static analysis, not a specific question Phase 2 can close.
2. **Production data volume unmeasured.** Area 4 flags: unknown row count for `?since=14d` in real AZ usage; no client-side perf numbers; compression unknown. This matters for feasibility claims about "temporal feed" or "unpaginated search list."
3. **Rendering-problem timeline.** Area 2 quantifies *how much* rendering churn exists but not *when* each problem first surfaced — whether they were knowable at plan-authoring time or emerged only during implementation. The answer informs the brainstorm's process: is the map design unfit in principle, or unfit because it was committed to before stress-testing?
4. **"Salvageable concepts vs salvageable files."** Area 5's manifest is file-level. Some concepts — species-stacked aggregation, colour-by-family, notable flag, overflow indication, count-chip — live inside DISCARD files but are themselves reusable ideas. An iterator should extract the concept list.
5. **"Ditch the map" is ambiguous.** The user said to ditch the map; they didn't say drop the spatial concept entirely. A replacement could be (a) a non-spatial UI (list / feed / grid / timeline / cards) or (b) a spatial UI on a real geographic basemap (Leaflet / Mapbox / deck.gl) or (c) a hybrid with spatial-optional modes. Phase 2 should distinguish these without picking one.
6. **Red-team check on convergences.** Every report converged. Either the map is genuinely as broken as all five investigators found, or the phase-0 packet primed them to find this conclusion. A deliberate red-team iteration should argue the strongest counter-position.

## What Phase 2 is NOT for

- Proposing replacement designs or interaction patterns.
- Comparing specific libraries.
- Re-taking screenshots.
- Editing any frontend code.
- Re-deriving anything Phase 1 already established.

Phase 2 deepens. It does not replicate Phase 1.

## Output contract for every iterator

Write to `{ARTIFACT_ROOT}/phase-2/iterator-{N}-{focus}.md` before returning. Follow `/Users/j/.claude/skills/analysis-funnel/references/phase-templates.md` §Phase 2 template. Cite every claim. Confidence levels required. Relate findings back to specific Phase 1 areas (which convergence, which gap, which surprise you are extending or contradicting).

---

## Raw Phase 1 artifact index

- `phase-1/area-1-visual-ux-audit.md` — 9 findings, screenshot-grounded, inherent-vs-fixable classification.
- `phase-1/area-2-rendering-complexity-audit.md` — 7 findings with quantified complexity tables, 18 dragons comments enumerated, 30-PR churn classification.
- `phase-1/area-3-user-task-fit.md` — 7 findings + task-fit matrix + user archetype assessment + misdirection inventory.
- `phase-1/area-4-data-api-surface.md` — 7 findings + endpoint × cache × cadence table + consumer field audit + UI-shape feasibility matrix.
- `phase-1/area-5-salvage-map.md` — KEEP/REFACTOR/DISCARD manifest across production source, styles, unit tests, e2e specs + URL contract + replacement boundary + invariants list.
