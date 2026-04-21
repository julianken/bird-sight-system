# Iteration: Historical Timeline — When Did Each Rendering Problem First Appear?

## Assignment

Reconstruct the chronological timeline of rendering problem discovery: which problems were knowable at plan-authoring time (2026-04-16), which emerged only during implementation, and what the evidence says about the current trajectory and remaining work.

---

## Findings

### Finding 1: Plan-4 committed to five specific rendering assumptions, all of which were overturned within days of execution

The architecture section of plan-4 (line 7) states: "The Map is one root SVG; each region is an SVG `<g>` whose `transform` animates via CSS to drive the inline-expansion effect... CSS transitions on `transform` are sufficient."

Task 9 Step 4 (plan line 1432) specified the expansion CSS as:
```
.region { transition: transform 350ms ease; transform-origin: center; }
.region-expanded .badge-stack { transform: scale(1.5); transform-origin: center; }
```

Every one of these assertions was wrong, and the evidence is in the production codebase itself:

- `transform-origin: center` is tombstoned and replaced with `transform-origin: 0 0` at `styles.css:13`, with an explicit explanation: `computeExpandTransform` bakes the pivot into its translate component; `center` (50% 50%) pre/post-translates the transform and pushes the expanded region off-screen.
- `.region-expanded .badge-stack { transform: scale(1.5) }` is explicitly tombstoned at `styles.css:35` ("Removed: .region-expanded .badge-stack { transform: scale(1.5) ... } The parent .region <g> now scales the entire group via its inline transform attribute, so badges scale with it automatically").
- The "one root SVG; each region is a `<g>`" structure is replaced by the two-pass layer architecture (`Map.tsx:89-113`): separate `.shapes-layer` and `.badges-layer` groups, with the per-region `<g>` split into `RegionShape` + `RegionBadges` leaf components (#94, #102).
- "CSS transitions on `transform` are sufficient" — the final implementation requires `computeExpandTransform` (18 lines in `Region.tsx:62-89`), `EXPAND_MAX_BBOX_FRAC` cap, a 3-tier paint-order sort (`orderedRegions`, `Map.tsx:60-87`), and `vector-effect: non-scaling-stroke` on 5 element types.

**Confidence:** High — the tombstone comment at `styles.css:35` is direct physical evidence that the plan's CSS was implemented and then removed. The `transform-origin: 0 0` comment at `styles.css:9-13` explains exactly why `center` failed.

**Relation to Phase 1:** Extends Area 2 Finding 2 (six SVG-specific correctness mechanisms) by establishing that zero of the six were planned; all six were discovered post-implementation.

**Significance:** The plan was not merely under-specified — it committed to the wrong mechanism for the core interaction. The `transform-origin: center` bug is the kind of thing a 30-minute SVG prototype would have caught before a single task was written.

---

### Finding 2: The `geo/path.ts` trajectory reveals the concave-polygon problem was entirely unforeseeable from plan text — but foreseeable from domain knowledge

Plan-4 Task 8 Step 4 (line 1181) specified `geo/path.ts` with a single function: `boundingBoxOfPath`. That is the entire planned implementation of the geometry library.

Production `geo/path.ts` is 302 lines with six functions: `parsePoints`, `boundingBoxOfPath`, `pointInPolygon`, `distanceToPolygonEdge`, `largestInscribedRect` (96-cell grid raster), and `poleOfInaccessibility` (76-line inlined polylabel quadtree). The latter is explicitly documented as inlined "to avoid a new external dep" (`geo/path.ts:219`).

The chain of discovery:
1. `boundingBoxOfPath` was implemented per plan.
2. Badges placed at bbox corners fell outside concave sky-island polygons (issue #59, referenced at `BadgeStack.test.tsx:147`).
3. `pointInPolygon` + `distanceToPolygonEdge` were added to determine containment.
4. `largestInscribedRect` (96-cell grid + histogram max-rectangle) replaced the bbox approach for non-expanded mode.
5. `poleOfInaccessibility` was added as the single-badge fallback when even the largest inscribed rectangle is too small for one badge.

The sky-island polygons are documented as concave in `geo/path.ts:124-140`. The phrase "the sky-islands" appears in that comment, indicating the shape of these specific regions was the trigger. The plan mentions "9 ecoregions" but never characterises their geometry. Anyone who had looked at a map of Arizona's sky-island archipelago would know these are small, irregularly shaped mountain masses — not convex rectangles.

**Confidence:** High for the discovery chain (code evidence is direct); medium for the counterfactual ("knowable in advance") — a developer familiar with Arizona geography would have flagged concavity; one who hadn't looked at the actual polygons would not.

**Relation to Phase 1:** Extends Area 2 Finding 6 (`largestInscribedRect` classified as accidental-to-map-choice). This finding establishes *when* it became accidental: after the first rendering pass with real polygon data.

---

### Finding 3: The paint-order and two-pass problems were predictable from SVG fundamentals — and are the most expensive cluster

SVG has no z-index. Document order is paint order. This is stated in the SVG 1.1 specification and is the first thing any SVG tutorial covers. The plan's per-region `<g>` structure placed each region's polygon and its badges as siblings inside the same group, and rendered all regions in API response order. This produces two independent failures:

- **Child regions obscured by parent strokes** (issue #80, PR #81): a sky-island polygon paints before its parent sonoran-tucson, but sonoran-tucson's stroke re-paints over the sky-island's interior. Fix required the 3-tier `orderedRegions` comparator (`Map.tsx:60-87`) and the `parent_id` migration column in `migrations/1700000011000_fix_region_boundaries.sql:148-153`.

- **Cross-region badge bleed** (PR #94, #102): badges in per-region `<g>` paint before sibling region shapes wherever their bounding boxes overlap. Fix required splitting the render into `.shapes-layer` and `.badges-layer` — the two-pass architecture that is still being completed in the current branch (`refactor/two-pass-map-render`, commit `c5053ca`).

Both problems are direct consequences of SVG paint order that would have been caught by any developer who had used SVG for UI layout before. The plan shows no evidence of SVG experience: it does not mention z-ordering, layer management, or document order. The fact that `parent_id` was added to the database schema to serve the paint-order sort (Area 2, Finding 3) means the plan's omission cascaded into the data model.

The two-pass refactor (PR #102) is the most recent architectural pivot. The current branch name `refactor/two-pass-map-render` and the most recent commit (`c5053ca` — "scope paint-order/sizing/expand-cap specs to two-pass layers") confirm this work is in-flight as of 2026-04-20 — four days after plan authoring, and one day after the first deploy.

**Confidence:** High — the tombstoned CSS, the branch name, and the PR sequence are all direct evidence. The predictability judgment is high-confidence: SVG paint order is not obscure knowledge.

**Relation to Phase 1:** Extends Area 2 Finding 4 (rendering churn). This finding identifies paint-order as the predictable-but-missed cluster and establishes that it is the most expensive in terms of architectural reach (data model modification).

---

### Finding 4: The stroke-scaling and drop-shadow problems emerged only after the expand transform was at realistic scale values

`vector-effect: non-scaling-stroke` (`styles.css:28-34`, `Region.tsx:122`, `Badge.tsx:104`) was not in the plan. The expand transform scale `s` ranges from ~3 to ~9 across the 9 regions. Without `non-scaling-stroke`, a 3-unit stroke renders at 9-27 CSS pixels — "engulfing the outline it's supposed to trace" (`styles.css:21-26`).

The drop-shadow issue (`styles.css:14-19`) is related: the filter was initially authored in CSS pixels, then discovered to inherit the ancestor scale transform, producing a 28-112px halo rather than the intended ~3.5-14px halo. The fix moved the filter to SVG user units (issue #93, PR #98).

The Safari `vector-effect` incompatibility (class-selector `vector-effect` unreliable on Safari < 16, `Region.tsx:118-122`) is a second-order discovery: CSS carried the attribute, but Safari needed the JSX `vectorEffect` attribute redundantly on 5 element types.

All three of these — stroke scaling, filter coordinate space, and Safari compat — are not discoverable from the plan text because they depend on what scale values the expand transform actually produces at runtime. Without rendering at real region dimensions, the problem is invisible.

**Confidence:** High — the comments in `styles.css:14-34` and `Region.tsx:118-122` directly document the discovery and fix.

---

### Finding 5: The overflow pip regression demonstrates the brittleness of the current geometry — fixes for one bug are causing new bugs

PR #97 unified the badge radius and silhouette sizing constants (reducing the four-site divergence of `DEFAULT_BADGE_RADIUS`, `MIN_BADGE_DIAMETER`, `MAX_BADGE_DIAMETER`). The PR's bot review caught a regression: unifying the overflow pip radius to `r` (matching the badge radius) while keeping the `r * 0.7` offset from when the pip was `Math.max(5, r*0.4)` caused the pip to overlap the badge by 13 units and intercept its pointer events (`BadgeStack.tsx:215-235`). The fix was changing the offset to `r * 1.4`.

This is documented at `BadgeStack.tsx:225-235` and confirmed by a `species-panel.spec.ts` regression — the geometry bug was caught not by the geometry test suite but by a panel-interaction test.

**Confidence:** High — the comment at `BadgeStack.tsx:235` names the PR and the regression test file explicitly.

**Relation to Phase 1:** Extends Area 2 Surprise 4 ("overflow pip geometry required a PR regression to expose"). This finding establishes the causal chain: badge radius unification → pip offset stale → pointer-event interception → caught by unrelated spec.

---

## Chronological Narrative

**Plan-authoring week (2026-04-16 — before first commit):** The plan committed to five rendering assumptions that were incompatible with SVG fundamentals: `transform-origin: center` (wrong pivot), `scale(1.5)` on the badge stack (wrong mechanism), a single-level per-region `<g>` (ignores paint order), `boundingBoxOfPath`-only geometry (ignores concavity), and no `vector-effect` mention. None of the 6 correctness mechanisms existed in the plan. There was no task for "validate rendering at full observation volume" or "prototype expand at representative region dimensions." The plan was all green-path.

**First rendering pass (~PRs #76-#79):** Topology gaps between independently-authored polygons became visible immediately — polygons share edges but not vertex sequences, leaving thin gaps and overlaps. PR #76 = migration 11000 (219 SQL lines to fix topology + populate `parent_id`). Badge placement at bbox corners fell outside concave sky-island polygons (issue #59 → PR #77 = polygon badge layout, which spawned `pointInPolygon`, `largestInscribedRect`, `poleOfInaccessibility` additions to `geo/path.ts`). Visible labels added in expanded mode (issue #54, PR #78).

**Paint-order wave (~PRs #80-#87, #99):** SVG z-index absence discovered. Child sky-island polygons were being occluded by parent strokes (#80, #81). Selected region needed to paint last (#87, fixed again in #99 after the two-pass refactor broke the guarantee). The `orderedRegions` 3-tier comparator introduced. The `parent_id` column in the DB was the fix that propagated into the data model.

**Expand-transform and concave-geometry wave (~PRs #88-#95):** Sky Islands regions are tiny (bbox ~30×45 SVG units). Expanding them to fill the canvas produced 7-9x scale, blowing the pole-of-inaccessibility badge to ~90% of the viewport (issue #88, documented at `Region.tsx:7-18`). `computeExpandTransform` with `EXPAND_MAX_BBOX_FRAC = 0.6` cap introduced (PR #100). Santa Ritas vertices protruding outside parent boundary required migration 12000 (PR #95).

**Stroke-and-filter wave (~PRs #93-#98):** Expand transform scale values now known to be 3-9x. Non-scaling stroke needed on all 5 SVG element types plus Safari JSX redundancy (PR #98). Drop-shadow filter coordinate space corrected from CSS pixels to SVG user units (#98). Both are documented in `styles.css:9-53`.

**Two-pass architecture (#94 → #102, current):** Per-region `<g>` structure let badge groups bleed over sibling region shapes. PR #94 initiated the `RegionShape`/`RegionBadges` split. PR #102 completed the structural refactor. The current in-flight work (`refactor/two-pass-map-render`, commit `c5053ca`) is scoping all existing e2e specs to two-pass selectors.

**Geometry unification (#97, #101):** Radius/diameter constant confusion documented at two sites. Overflow pip regression discovered and fixed. Hotspot radius changed to sqrt scale (#101).

**Time elapsed from plan to two-pass refactor:** At most 4 days (plan 2026-04-16, first deploy 2026-04-19, analysis 2026-04-20, two-pass still in progress). The per-region structure from Task 9 lasted fewer than 4 days before the two-pass refactor was initiated. Approximately 8-12 rendering PRs fell within that window.

---

## Resolved Questions

**Gap 3 from Phase 1 packet** ("Rendering-problem timeline — whether problems were knowable at plan-authoring time or emerged only during implementation") is now answered. The problems cluster into three categories:

- **Predictable from SVG fundamentals (not planned):** Paint-order z-index, `transform-origin: center` failure, `non-scaling-stroke` on scaled elements, drop-shadow filter coordinate space. These would have been caught by a 2-hour SVG prototype or by any developer with SVG layout experience.
- **Predictable from domain knowledge (not planned):** Concave sky-island polygons requiring `largestInscribedRect`/`poleOfInaccessibility`. Knowable to anyone who had looked at Arizona's sky-island geography before authoring the plan.
- **Emergent from runtime interaction (unforeseeable):** Exact scale values for `EXPAND_MAX_BBOX_FRAC`, pip offset regression from badge-radius unification, Safari `vector-effect` class-selector bug. These required the combination of real polygon dimensions + actual browser rendering to surface.

---

## Remaining Unknowns

- The exact commit hash for the initial implementation of `transform-origin: center` and `.badge-stack { transform: scale(1.5) }` — the tombstone comment confirms it was implemented and removed, but the commit date cannot be determined without `git log` access.
- Whether the two-pass refactor PR #102 is merged or still open — the current branch name suggests the e2e scoping work (commit `c5053ca`) is a follow-up task that outlasted the structural PR.
- The exact issue creation dates for #59 (badge containment) and #88 (expand cap) — these would sharpen the discovery timeline to specific calendar days rather than PR-sequence order.

---

## Revised Understanding

The three-verdict questions:

**Was the map design's unfitness predictable from plan-4?** Partially. The plan's unfitness on SVG fundamentals (paint order, `transform-origin`, `non-scaling-stroke`) was entirely predictable — these are documented SVG behaviors findable in any SVG tutorial. A 2-hour design review with a simple prototype at representative dimensions would have surfaced all three. The concave-polygon geometry problem was predictable to anyone familiar with Arizona geography but not to a developer working from a generic "9 ecoregions" description. The runtime-emergent problems (exact scale values, Safari compat, pip regression) were genuinely unforeseeable without execution. The plan's most load-bearing wrong decision was `transform-origin: center` — the SVG origin is `0 0`, not `50% 50%`, and `computeExpandTransform` bakes the pivot into the translate component. This decision is wrong for any SVG transform-based animation and is findable in MDN in 5 minutes.

**Is the current trajectory stabilising or worsening?** Not stabilising. The current branch (`refactor/two-pass-map-render`) is still completing the architectural pivot initiated in PR #102. Every new rendering fix (paint-order, two-pass, expand-cap, non-scaling-stroke) has required updating the test suite, which itself is 1,185 LOC of map-specific unit tests and 853 LOC of map-specific e2e specs. The tombstone comment at `styles.css:35` and the active two-pass branch confirm the implementation is still in architectural motion, not in maintenance mode.

**1 more week of focused rendering work: how many of the 18 dragons would close?** Honest estimate: 3-5 of 18 would close. The fixable ones are: the `DEFAULT_BADGE_RADIUS`/`MIN_BADGE_DIAMETER` unification (documented as "out of scope" in ticket #89 and #92 — 1 week is enough), the `silhouetteSize` latent 2x bug (fixable once a non-generic silhouette lands), and the horizontal label collision in expanded view (the `EXPANDED_LABEL_HEIGHT = 14` row stride without horizontal collision budgeting at `BadgeStack.tsx:164-170`). The remaining 13-15 dragons are structural to the SVG choice: `transform-origin: 0 0` baked assumption, `computeExpandTransform` two-scale formula, `non-scaling-stroke` belt-and-braces Safari redundancy, paint-order 3-tier sort, `largestInscribedRect` 96-grid algorithm, `poleOfInaccessibility` 76-line quadtree, and the four CSS coordinate-system workarounds. These problems do not close — they are managed.

---

## Raw Evidence

Files read:
- `/Users/j/repos/bird-watch/docs/plans/2026-04-16-plan-4-frontend.md` (Tasks 8, 9, architecture section)
- `/Users/j/repos/bird-watch/frontend/src/components/Map.tsx` (205 LOC)
- `/Users/j/repos/bird-watch/frontend/src/components/Region.tsx` (176 LOC)
- `/Users/j/repos/bird-watch/frontend/src/components/BadgeStack.tsx` (333 LOC, especially lines 54-65, 164-170, 215-235)
- `/Users/j/repos/bird-watch/frontend/src/components/Badge.tsx` (lines 1-60)
- `/Users/j/repos/bird-watch/frontend/src/styles.css` (170 LOC, especially lines 9-53)
- `/Users/j/repos/bird-watch/frontend/src/geo/path.ts` (lines 1-100, 140-230)
- `/Users/j/repos/bird-watch/migrations/1700000011000_fix_region_boundaries.sql` (lines 1-60)
- `/Users/j/repos/bird-watch/migrations/1700000012000_fix_sky_islands_boundaries.sql` (lines 1-30)
- `/Users/j/repos/bird-watch/docs/analyses/2026-04-20-frontend-map-analysis/context-packets/phase-1-packet.md`
- `/Users/j/repos/bird-watch/docs/analyses/2026-04-20-frontend-map-analysis/phase-1/area-2-rendering-complexity-audit.md`
- `/Users/j/repos/bird-watch/docs/analyses/2026-04-20-frontend-map-analysis/phase-0/analysis-brief.md`

Key grep evidence: absence of `largestInscribedRect`, `poleOfInaccessibility`, `computeExpandTransform`, `EXPAND_MAX_BBOX_FRAC`, `orderedRegions`, `non-scaling-stroke` from plan-4 text (zero matches on targeted grep of plan file); `transform-origin: center` and `.badge-stack { transform: scale(1.5) }` present in plan Task 9 Step 4, tombstoned in production `styles.css:35`.
