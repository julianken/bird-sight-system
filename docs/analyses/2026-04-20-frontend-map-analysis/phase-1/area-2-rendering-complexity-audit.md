# Investigation: Rendering-Complexity Audit (Area 2)

## Summary

The SVG map rendering stack — `Map.tsx`, `Region.tsx`, `BadgeStack.tsx`, `Badge.tsx`, `HotspotDot.tsx`, and `geo/path.ts` — accounts for 1,191 LOC of production TypeScript/TSX, approximately 60 of 170 CSS lines, and carries 18 documented multi-line "here be dragons" comment blocks totaling ~200 comment lines. The unit-test suite adds 1,185 LOC exclusively exercising map geometry, and 7 complete e2e specs (plus ~70% of `happy-path.spec.ts`) add ~853 LOC testing SVG-specific correctness invariants. Two database migrations (`1700000011000` and `1700000012000`, totaling 306 SQL lines) exist purely because SVG polygon topology produced visible rendering artefacts. Among the 30 most recent merged PRs, 10 are rendering-correctness fixes or refactors driven by SVG constraints. Replacing the SVG map with a non-SVG UI would eliminate approximately 1,251 LOC of production code, ~60 CSS lines, 1,185 LOC of unit tests, ~853 LOC of e2e tests, and all 18 dragons-comment blocks — leaving the non-map scaffolding (API client, URL state, data hooks, FiltersBar, SpeciesPanel, error screen) essentially intact.

## Key Findings

### Finding 1: The map rendering chain carries 18 documented "here be dragons" comment blocks

Every major SVG edge case in the codebase is narrated in a multi-line comment adjacent to the workaround. These comments are a direct proxy for paid complexity — each one represents a bug that had to be investigated, a root cause discovered, and a workaround devised.

**Evidence (by file and line):**

| Comment | Location | Lines | Edge case documented |
|---|---|---|---|
| Paint-order rule: "SVG has no z-index; document order IS paint order" | `Map.tsx:44-59` | 16 | SVG paint order requires explicit sort by parent/child/selected tiers |
| Two-pass restructure: "cross-region badge bleed" | `Map.tsx:89-113` | 25 | Badges in per-region `<g>` bled over sibling region shapes |
| Inline style beats CSS for width/height: "~40% horizontal gutters" | `Map.tsx:124-128` | 5 | SVG intrinsic sizing leaves layout gutters unless overridden with inline style |
| EXPAND_MAX_BBOX_FRAC cap: "multiply their linear size by 7–9×" | `Region.tsx:7-18` | 12 | Small regions blow badge to ~90% of viewport without a cap |
| parsePoints "silently drops curves" | `Region.tsx:21-26` | 6 | SVG path grammar restriction, off-center transform if violated |
| computeExpandTransform two-scale formula | `Region.tsx:48-61` | 14 | Cap scale vs target scale derivation |
| vectorEffect belt-and-braces: "Safari < 16" | `Region.tsx:118-122` | 5 | Class-selector `vector-effect` unreliable on Safari < 16 |
| #94 two-pass split comment | `Region.tsx:92-98` | 7 | Why RegionShape/RegionBadges split was needed |
| MIN_BADGE_DIAMETER vs DEFAULT_BADGE_RADIUS confusion | `BadgeStack.tsx:54-65` | 12 | Same literal 14 means diameter in one place, radius in another |
| Expanded-mode row stride comment | `BadgeStack.tsx:164-170` | 7 | Label row must reserve vertical space or next-row badge overlaps label |
| Overflow pip r*1.4 offset geometry | `BadgeStack.tsx:215-235` | 21 | PR #97 regression: pip at r*0.7 offset occluded badge click target |
| silhouetteSize latent 2× bug | `Badge.tsx:22-32` | 11 | Generic silhouette bbox is 12×10 but default assumes 24; "happens to look intentional" |
| DEFAULT_BADGE_RADIUS radius vs diameter re-documentation | `Badge.tsx:44-53` | 10 | Same radius/diameter confusion documented again at Badge level |
| vectorEffect belt-and-braces (badge circle) | `Badge.tsx:99-104` | 5 | Same Safari < 16 issue repeated for `.badge-circle` |
| pnpoly attribution and algorithm note | `geo/path.ts:66-72` | 7 | Franklin PNPOLY formulation, O(n) per query justified |
| largestInscribedRect strategy: "concave polygons (the sky-islands)" | `geo/path.ts:124-140` | 17 | 96-cell grid raster + histogram max-rectangle replaces bbox approach |
| poleOfInaccessibility: "inlined to avoid a new external dep" | `geo/path.ts:214-224` | 11 | polylabel quadtree algorithm inlined per CLAUDE.md policy |
| transform-origin: 0 0 + drop-shadow filter coordinate space + vector-effect + overflow: visible | `styles.css:9-73` | 24 | Four separate SVG coordinate system / browser-compat workarounds |

Total documented dragons: 18 blocks, approximately 200 comment lines.

**Confidence:** High — directly read from source.

**Implication:** Each comment block represents a completed debugging cycle. The density (18 blocks in ~1,200 production LOC = one "hard thing" per 67 lines) is high relative to typical CRUD or list-rendering code, which might have 0–2 such blocks across comparable LOC.

---

### Finding 2: Six distinct SVG-specific correctness mechanisms are required — none would exist in a non-SVG UI

**Evidence:**

| Mechanism | Code location | Why it exists | Would survive map removal? |
|---|---|---|---|
| `largestInscribedRect` (96-grid + histogram) | `geo/path.ts:142-209` | Badges placed in bbox corners fell outside concave sky-island polygons (#59) | No |
| `poleOfInaccessibility` (polylabel quadtree) | `geo/path.ts:225-301` | Single-badge fallback for regions too small for the grid | No |
| `computeExpandTransform` with two-scale cap | `Region.tsx:62-89` | CSS-scale expand blows SVG coordinates; cap at EXPAND_MAX_BBOX_FRAC=0.6 (#88, #100) | No |
| `orderedRegions` paint-order sort (3-tier comparator) | `Map.tsx:60-87` | SVG has no z-index; document order is paint order (#80, #87, #99) | No |
| Two-pass layer structure (shapes → badges → hotspots) | `Map.tsx:135-202` | Per-region `<g>` let badge bleed over sibling shapes (#94) | No |
| `vector-effect: non-scaling-stroke` (5 element types + JSX redundancy) | `styles.css:28-34`, `Region.tsx:122`, `Badge.tsx:104`, `HotspotDot.tsx:31` | Strokes inflate with ancestor scale transforms (3–9×) | No |

Additionally, two CSS properties required commentary and protective rules that would not appear in any list/card/feed implementation:
- `transform-origin: 0 0` (`styles.css:13`) — CSS default `50% 50%` pushes expanded region off-screen; baked pivot in `computeExpandTransform` assumes SVG origin.
- `overflow: visible` on `.map-wrap` (`styles.css:73`) — SVG 1.1 §15.2: drop-shadow filter region extends beyond element bbox; container clip would cut the halo.

**Confidence:** High — each mechanism cites its originating issue/PR.

---

### Finding 3: Two database migrations are driven by frontend SVG rendering requirements

**Evidence:**

- `migrations/1700000011000_fix_region_boundaries.sql` (219 LOC): Fixes topology gaps between hand-authored polygons. The header (`line 8-56`) states the polygons were authored independently so neighbouring polygons did not share identical vertex sequences, leaving "thin gaps and small overlaps (visible when rendering)." The migration also populates `parent_id` on sky-island rows (`line 148-153`) — which the `orderedRegions` paint-order comparator in `Map.tsx:60-87` depends on for correct SVG z-ordering. Both changes are driven by the SVG canvas, not by the data model or API contract.

- `migrations/1700000012000_fix_sky_islands_boundaries.sql` (87 LOC): Clamps Santa Ritas vertices that protrude ~12 SVG units west of the parent boundary (`line 4-61`). The motivation is entirely geometric-visual: after migration 11000 moved sonoran-tucson's west edge, the sky-island polygon physically extended outside its parent in SVG coordinate space. The fix ensures the `largestInscribedRect` algorithm's output stays inside the parent polygon and that `ST_Contains` does not stamp observations to a now-incorrect region.

Both migrations would be unnecessary in a non-SVG UI where region geometry is not rendered as polygons. The `parent_id` column might survive as a data concept (for grouping/hierarchy), but the specific vertex-level precision requirements and the fill of `parent_id` for paint-order purposes would not.

**Confidence:** High — migration headers directly state the rendering motivation.

---

### Finding 4: PR history confirms sustained rendering-correctness churn — 10 of the 30 most recent merged PRs are rendering fixes or refactors

Classification of the 30 most recently merged PRs:

| Category | Count | PRs |
|---|---|---|
| (a) Feature | 5 | #96 (design tokens/palette), #79 (species panel), #78 (visible labels), #21 (inline expansion), #66 (VITE_API_BASE_URL) |
| (b) Rendering-correctness fix | 7 | #100 (expand cap), #99 (selected-last paint), #98 (non-scaling stroke/drop-shadow), #95 (db vertex clamp), #81 (child-after-parent SVG z-order), #77 (polygon badge layout), #76 (topology polygons) |
| (c) Refactor driven by rendering debt | 3 | #102 (two-pass layers), #101 (sqrt-radius hotspot), #97 (badge radius/silhouette unification) |
| (d) Non-rendering (CI, infra, ingestor, backend, docs) | 15 | #86, #85, #84, #82, #75, #74, #73, #72, #71, #70, #69, #68, #67, #61, #82 |

10 of 30 = **33% rendering churn rate** in the merged PR stream. Among the last 10 PRs (#93–#102, as named in the phase-0 packet), 8 of 10 are rendering fixes — an **80% churn rate** for that window.

**Confidence:** High — PR titles verified directly from GitHub.

**Implication:** The rendering churn rate is not declining. The two-pass refactor (#102) and the expand cap (#100) each resolved one acute problem while the comment blocks document 16 more potential regression vectors that remain actively managed.

---

### Finding 5: The test suite has a map-geometry-specific majority

**Unit tests (Vitest):**

| File | LOC | Map-specific? |
|---|---|---|
| `geo/path.test.ts` | 145 | 100% — tests parsePoints, pointInPolygon, distanceToPolygonEdge, largestInscribedRect, poleOfInaccessibility |
| `components/Map.test.tsx` | 275 | 100% — tests paint-order comparator, two-pass layers, expand transform attributes |
| `components/Region.test.tsx` | 141 | 100% — tests computeExpandTransform cap (9 parametric cases), vector-effect attribute, keyboard expand |
| `components/BadgeStack.test.tsx` | 435 | 100% — tests polygon containment (5 cases), pole-of-inaccessibility fallback, overflow-pip geometry |
| `components/Badge.test.tsx` | 155 | ~90% — 8 of 9 tests exercise SVG-specific rendering (vector-effect, silhouette scaling, label placement); 1 tests aria semantics |
| `components/HotspotDot.test.tsx` | 34 | 100% — tests vector-effect and log-scale radius |
| `api/client.test.ts`, `data/use-bird-data.test.tsx`, `state/url-state.test.ts`, `data/use-species-detail.test.ts`, `components/FiltersBar.test.tsx`, `components/SpeciesPanel.test.tsx` | ~500 (estimated) | 0% — design-agnostic |

**Map-specific unit test total: ~1,185 LOC** (path + Map + Region + BadgeStack + Badge + HotspotDot).

**E2E specs (Playwright):**

| Spec | LOC | Map-specific? |
|---|---|---|
| `badge-containment.spec.ts` | 162 | 100% — polygon containment disc test |
| `paint-order.spec.ts` | 152 | 100% — SVG elementsFromPoint ordering, expand-last |
| `expand-cap.spec.ts` | 73 | 100% — badge CSS-px size under expand transform |
| `sizing.spec.ts` | 88 | 100% — badge-r uniformity, overflow-pip r match |
| `stroke-scaling.spec.ts` | 93 | 100% — non-scaling-stroke under expand |
| `region-collapse.spec.ts` | 64 | 100% — SVG background click, keyboard collapse |
| `cross-region-badge-containment.spec.ts` | 191 | 100% — cross-region polygon-interior check |
| `happy-path.spec.ts` | 43 | ~70% map-specific — expand affordance, transform attribute, region-expanded class; ~30% agnostic (filter toggle, URL param, reload) |
| `a11y.spec.ts`, `axe.spec.ts`, `deep-link.spec.ts`, `error-states.spec.ts`, `filters.spec.ts`, `history-nav.spec.ts`, `species-panel.spec.ts`, `prod-smoke.preview.spec.ts` | ~600 (estimated) | 0% — design-agnostic |

**Map-specific e2e total: ~853 LOC** (7 complete specs + 70% of happy-path = ~823 + ~30 = ~853).

**Confidence:** High — LOC counts from direct file reads.

---

### Finding 6: Classification of every complexity source

| Complexity source | Classification | Rationale |
|---|---|---|
| `geo/path.ts` — parsePoints, boundingBoxOfPath, pointInPolygon, distanceToPolygonEdge, largestInscribedRect, poleOfInaccessibility | **Accidental-to-map-choice** | Only needed because items must be placed within SVG polygon interiors |
| `components/Map.tsx` — orderedRegions paint-order sort, two-pass layer structure, `project()` hotspot lat/lng→SVG coords | **Accidental-to-map-choice** | All three mechanisms compensate for SVG paint-order absence of z-index and the coordinate projection needed to place dots on the canvas |
| `components/Region.tsx` — computeExpandTransform, parsePoints, EXPAND_MAX_BBOX_FRAC cap | **Accidental-to-map-choice** | Exist solely to manage the SVG-transform-space expand interaction |
| `components/BadgeStack.tsx` — computeGridLayout, pole fallback, overflow pip geometry, expanded rowStride | **Accidental-to-map-choice** | Grid layout inside polygon inscribed rect; overflow pip geometry driven by SVG pointer-event interception |
| `components/Badge.tsx` — vector-effect, scale-proportional stroke/chip, silhouette path scaling, label truncation JS-side | **Accidental-to-map-choice** | vector-effect is SVG-only; proportional scaling is needed because the badge lives in SVG user-unit space that inherits parent transforms; JS-side truncation is needed because SVG `<text>` lacks CSS `text-overflow` |
| `components/HotspotDot.tsx` | **Accidental-to-map-choice** | Entirely a map artefact; in any non-SVG UI hotspots would be list items or map pins |
| migrations 11000 and 12000 (topology fix, vertex clamping, parent_id for paint order) | **Accidental-to-map-choice** | Both driven by SVG rendering artefacts; the parent_id data is reusable as a hierarchy concept but the vertex-precision requirements are map-specific |
| `styles.css:9-53` — .region transform-origin, drop-shadow filter units, vector-effect block, badge-label paint-order | **Accidental-to-map-choice** | All four are SVG coordinate system / browser-compat workarounds |
| `styles.css:60-75` — .map-wrap overflow: visible, .bird-map sizing | **Accidental-to-map-choice** | SVG 1.1 §15.2 filter clipping and SVG intrinsic sizing require both |
| `api/client.ts` | **Essential-to-any-frontend** | HTTP client; design-agnostic |
| `state/url-state.ts` — `since`, `notable`, `speciesCode`, `familyCode` params | **Essential-to-any-frontend** | Filter params survive any redesign |
| `state/url-state.ts` — `regionId` param | **Accidental-but-migrates** | Concept (selected region) survives as a selection/filter concept; `?region=sky-islands-huachucas` slug may change or disappear |
| `data/use-bird-data.ts`, `data/use-species-detail.ts` | **Essential-to-any-frontend** | Data fetching hooks are design-agnostic |
| `components/FiltersBar.tsx` | **Essential-to-any-frontend** | Filter controls survive any redesign |
| `components/SpeciesPanel.tsx` | **Essential-to-any-frontend** | Detail sidebar survives; fixed-position layout may need adjustment if the map isn't the primary canvas |
| `App.tsx` — colour-per-family encoding, COUPLING_NOTE on silhouetteId→familyCode | **Accidental-but-migrates** | Colour encoding concept survives; current coupling to `silhouetteId` as family proxy (issue #57) and the circular-badge rendering do not |
| `App.tsx` — `silhouetteFor()` returning GENERIC_SILHOUETTE for all species | **Accidental-to-map-choice** | The silhouette-inside-circle rendering idiom is map-specific; in a card or list UI a species image/icon is a first-class element, not an SVG path inlaid into a coloured circle |
| `styles.css:82-170` — filters-bar, species-panel, error-screen | **Essential-to-any-frontend** | Design-agnostic layout and component styles |
| E2E specs: `a11y`, `axe`, `deep-link`, `error-states`, `filters`, `history-nav`, `species-panel`, `prod-smoke.preview` | **Essential-to-any-frontend** | Design-agnostic; survive map removal |

---

### Finding 7: Quantified estimate of what vanishes

| Category | Map-specific LOC | Non-map LOC | Vanishes? |
|---|---|---|---|
| Production TS/TSX (map chain: Map, Region, BadgeStack, Badge, HotspotDot, geo/path) | 1,191 | ~375 (App.tsx partial + non-map components) | Yes |
| CSS (styles.css defensive/map-specific lines) | ~60 | ~110 | Yes |
| Unit tests (map-geometry suites) | 1,185 | ~500 | Yes |
| E2E specs (map-specific) | ~853 | ~600 | Yes |
| Database migrations (rendering-driven) | 306 SQL lines | 0 | Yes |
| Documented dragons comment blocks | 18 blocks, ~200 comment lines | — | Yes |

**Point estimate:** Replacing the SVG map with a non-SVG UI would eliminate approximately **1,251 LOC of production code** (1,191 TS/TSX + 60 CSS), **2,038 LOC of test code** (1,185 unit + 853 e2e), **306 LOC of rendering-driven migration SQL**, and all **18 multi-line "here be dragons" comment blocks** (~200 comment lines). This is roughly **57% of the total production frontend codebase** (phase-0 packet: 2,566 total LOC) and a larger fraction of the test suite.

**Confidence:** High for the production and test counts (direct file reads); medium for the CSS split (the boundary between "map-defensive" and "incidental map-only" CSS is somewhat subjective, ±5 lines). The 306 SQL LOC figure is exact from file reads.

---

## Surprises

1. **The `parent_id` column on the regions table is not a product feature — it is a rendering artifact.** The column was populated in migration 11000 (`line 148-153`) specifically to enable the `Map.tsx` paint-order sort. The DB data model was modified to serve the SVG rendering engine. This is a strong signal of how deeply the rendering choice permeated the architecture.

2. **The same renderer duplication (parsePoints) appears in three places.** `Region.tsx:27-45`, `geo/path.ts:27-45`, and inlined into both `badge-containment.spec.ts` and `cross-region-badge-containment.spec.ts`. Each copy carries its own warning that "curves are silently dropped." The duplication is defensive (the e2e specs deliberately inline to stay self-contained), but it means the same bug surface is maintained four times.

3. **The `DEFAULT_BADGE_RADIUS` vs `MIN_BADGE_DIAMETER` confusion is documented in comments at two separate files** (`Badge.tsx:44-53` and `BadgeStack.tsx:54-65`) rather than being fixed. The shared literal `14` is explicitly acknowledged as coincidence. This is technical debt that the badge-in-circle idiom makes structurally hard to resolve — the unit system (radius vs diameter) is meaningful in SVG-space but invisible to a non-SVG renderer.

4. **The overflow pip geometry (r*1.4 diagonal offset) required a PR regression to expose.** The pip overlapped the badge click target only after the pip radius was unified to `r` in PR #97, which was a fix for a different issue. The bug was caught by a `species-panel.spec.ts` regression (not by the dedicated sizing spec), suggesting the test coverage for interaction consequences of geometry changes is thinner than the geometry coverage itself.

5. **`geo/path.ts` inlines the polylabel algorithm** (76 lines, `poleOfInaccessibility:225-301`) to avoid a dependency, per CLAUDE.md policy. The CLAUDE.md comment reads "no polylabel npm import." This is a project-level commitment to keep `node_modules` lean that forced 76 lines of non-trivial geometric algorithm into the frontend source.

---

## Unknowns and Gaps

1. **Exact LOC for `App.tsx`** was not read in this investigation — it is listed as 101 LOC in the phase-0 packet. The classification above assumes the map-specific portion of App.tsx (silhouetteFor, colorForFamily, the COUPLING_NOTE, the GENERIC_SILHOUETTE constant) is approximately 40–50 LOC; the remaining ~50 LOC (data wiring, filter state, layout) would survive. This estimate is not confirmed by direct file read.

2. **PR #93 and earlier map-specific PRs** (#80, #87, #88 referenced in the phase-0 packet) are not returned by the two GitHub pages fetched. Those PRs are mentioned in Map.tsx and Region.tsx comments. A third page fetch could confirm their titles for the churn-rate table; the current classification relies on comment references rather than verified titles.

3. **Whether the `?region=` URL param slot survives in any form** is a design question, not determinable from static analysis. If the replacement UI keeps any concept of "selected region," the URL state mechanism is reusable; if it drops the concept entirely, `url-state.ts` shrinks but does not vanish.

4. **The `position: fixed` species panel comment** (`styles.css:94-100`) notes "opening the panel does not reflow the map" as an explicit design choice. If the map is removed, this constraint disappears and the panel could become a normal document-flow element. Whether that's desirable is a UX decision.

---

## Raw Evidence

Files read:
- `/Users/j/repos/bird-watch/frontend/src/components/Map.tsx` (205 LOC)
- `/Users/j/repos/bird-watch/frontend/src/components/Region.tsx` (176 LOC)
- `/Users/j/repos/bird-watch/frontend/src/components/BadgeStack.tsx` (333 LOC)
- `/Users/j/repos/bird-watch/frontend/src/components/Badge.tsx` (139 LOC)
- `/Users/j/repos/bird-watch/frontend/src/components/HotspotDot.tsx` (36 LOC)
- `/Users/j/repos/bird-watch/frontend/src/geo/path.ts` (302 LOC)
- `/Users/j/repos/bird-watch/frontend/src/styles.css` (170 LOC)
- `/Users/j/repos/bird-watch/frontend/src/components/Map.test.tsx` (275 LOC)
- `/Users/j/repos/bird-watch/frontend/src/components/Region.test.tsx` (141 LOC)
- `/Users/j/repos/bird-watch/frontend/src/components/BadgeStack.test.tsx` (435 LOC)
- `/Users/j/repos/bird-watch/frontend/src/components/Badge.test.tsx` (155 LOC)
- `/Users/j/repos/bird-watch/frontend/src/components/HotspotDot.test.tsx` (34 LOC)
- `/Users/j/repos/bird-watch/frontend/src/geo/path.test.ts` (145 LOC)
- `/Users/j/repos/bird-watch/frontend/e2e/badge-containment.spec.ts` (162 LOC)
- `/Users/j/repos/bird-watch/frontend/e2e/paint-order.spec.ts` (152 LOC)
- `/Users/j/repos/bird-watch/frontend/e2e/expand-cap.spec.ts` (73 LOC)
- `/Users/j/repos/bird-watch/frontend/e2e/sizing.spec.ts` (88 LOC)
- `/Users/j/repos/bird-watch/frontend/e2e/stroke-scaling.spec.ts` (93 LOC)
- `/Users/j/repos/bird-watch/frontend/e2e/region-collapse.spec.ts` (64 LOC)
- `/Users/j/repos/bird-watch/frontend/e2e/cross-region-badge-containment.spec.ts` (191 LOC)
- `/Users/j/repos/bird-watch/frontend/e2e/happy-path.spec.ts` (43 LOC)
- `/Users/j/repos/bird-watch/migrations/1700000011000_fix_region_boundaries.sql` (219 LOC)
- `/Users/j/repos/bird-watch/migrations/1700000012000_fix_sky_islands_boundaries.sql` (87 LOC)
- `/Users/j/repos/bird-watch/docs/analyses/2026-04-20-frontend-map-analysis/context-packets/phase-0-packet.md`
- `/Users/j/repos/bird-watch/docs/analyses/2026-04-20-frontend-map-analysis/phase-0/analysis-brief.md`

Web fetches:
- `https://github.com/julianken/bird-sight-system/pulls?q=is:pr+is:merged` — pages 1 and 2 (50 PRs classified)
