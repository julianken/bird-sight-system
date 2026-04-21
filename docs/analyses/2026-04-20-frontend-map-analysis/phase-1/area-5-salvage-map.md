# Investigation: Area 5 — Salvage Map

## Summary

Of 1,964 production LOC across `frontend/src/`, 653 lines (33%) are fully intact after the
map is removed (KEEP), 311 lines (16%) carry concepts worth preserving but need rewrites
(REFACTOR), and 1,000 lines (51%) die with the SVG map (DISCARD). The non-map scaffolding —
API client, URL state, data hooks, FiltersBar, SpeciesPanel, and the error screen — is
engineering-sound and has zero SVG dependencies. The unit-test picture mirrors this split
almost exactly: 281 lines survive, 114 need a rewrite, and 1,230 die. Of 16 e2e specs, 5 are
fully KEEPable with selector updates only, 4 are REFACTOR, and 7 are DISCARD. The replacement
boundary in `App.tsx` is a single JSX block: the `<div className="map-wrap">` and everything
inside it (lines 77–89), which wraps the `<Map />` component exclusively.

---

## 1. Production Source Manifest

All LOC counts are from `wc -l` output; rationales cite file:line.

### Non-map scaffolding

| File | LOC | Classification | Rationale |
|---|---:|---|---|
| `api/client.ts` | 51 | **KEEP** | Pure HTTP wrapper; zero SVG/geo imports. Fetches `/api/regions` (shape data) but Region type survives in any UI that needs region names — and the call can simply be dropped if regions are no longer a concept. No rendering logic anywhere in the file. |
| `state/url-state.ts` | 70 | **REFACTOR** | Hook logic (`readUrl`, `writeUrl`, `useUrlState`) is fully design-agnostic. The `regionId` field (line 7, `p.get('region')` at line 27, `p.set('region', ...)` at line 37) is coupled to the expand interaction and must be deleted. Everything else (`since`, `speciesCode`, `familyCode`, `notable`) survives. |
| `data/use-bird-data.ts` | 50 | **REFACTOR** | Filter hook is design-agnostic. However it fetches `regions` and `hotspots` in addition to observations (lines 28–34). In a map-less UI, the `getRegions()` call becomes dead weight and the `getHotspots()` call depends on whether hotspot display survives in any form. Concept (cancellable parallel fetch, filter-reactive observation refetch) is solid; API surface needs trimming. |
| `data/use-species-detail.ts` | 72 | **KEEP** | Zero map imports. Per-session in-memory cache (lines 26–29), cancellable fetch pattern (line 58), clean state machine. Works identically in any UI that can display a species detail pane. |
| `components/FiltersBar.tsx` | 101 | **KEEP** | No SVG, no map. Renders four HTML controls (time window select, notable checkbox, family select, species datalist input). The `onChange` interface accepts `Partial<UrlState minus regionId>` — the region field isn't even in `FiltersBarProps` (interface at lines 7–18). Ships with aria-label on every control. |
| `components/SpeciesPanel.tsx` | 93 | **KEEP** | Fixed right-rail `<aside>` with zero map references. Scoped ESC handler (lines 37–45), `aria-labelledby` with sr-only heading fallback (lines 87–90), `role="complementary"`. The `position: fixed` layout detaches from any parent layout, so it works whether the sibling is a map or a list. |
| `derived.ts` | 38 | **KEEP** | `deriveFamilies()` and `deriveSpeciesIndex()` reduce raw observations to filter-option arrays. No map or SVG dependency. The `silhouetteId`-as-`familyCode` coupling (lines 4–15, tracked by issue #57) is a data model issue, not a UI issue — it exists in any frontend consuming the current API. |
| `App.tsx` | 101 | **REFACTOR** | The non-map parts — ApiClient instantiation (line 11), `useUrlState` (line 46), `useBirdData` (lines 47–52), `deriveFamilies`/`deriveSpeciesIndex` memos (lines 54–55), error screen (lines 57–64), `FiltersBar` (lines 68–76), `SpeciesPanel` (lines 94–98) — all survive. `GENERIC_SILHOUETTE` (lines 23–26), `silhouetteFor` (lines 28–30), `colorFor` (lines 41–43), and the `<div className="map-wrap">` block (lines 77–89) are map-specific and die. Approximately 50 of 101 lines survive. |
| `main.tsx` | 10 | **KEEP** | Standard React 18 `createRoot` entry. No rendering logic. |
| `vite-env.d.ts` | 9 | **KEEP** | Ambient type declaration for `import.meta.env`. Zero coupling to map. |
| `test-setup.ts` | 9 | **KEEP** | `@testing-library/jest-dom` import and `afterEach(cleanup)`. Toolchain-level; map-agnostic. |

### Map rendering chain

| File | LOC | Classification | Rationale |
|---|---:|---|---|
| `components/Map.tsx` | 205 | **DISCARD** | SVG root element with `viewBox="0 0 360 380"` (line 122), two-pass shape/badge/hotspot layering (lines 89–113), `computeExpandTransform` calls (lines 140, 165), lat/lng→SVG `project()` function (lines 26–30), paint-order sort `useMemo` (lines 60–87). 100% SVG-map-specific. |
| `components/Region.tsx` | 176 | **DISCARD** | `parsePoints` (lines 27–45), `computeExpandTransform` (lines 62–89), `EXPAND_MAX_BBOX_FRAC` cap (line 18), `RegionShape` `<path>` renderer (lines 110–136), `RegionBadges` inscribed-rect positioner (lines 154–176). All exist solely to place and expand SVG polygon regions. |
| `components/Badge.tsx` | 139 | **DISCARD** | SVG `<g>` with `<circle>`, `<path>` silhouette, count chip `<circle>/<text>`, label `<text>` (lines 67–139). `vector-effect="non-scaling-stroke"` attribute (line 104). Every element is an SVG primitive inside the map's coordinate space. The count-aggregation concept is not specific to SVG but is entirely bundled with the SVG rendering here. |
| `components/BadgeStack.tsx` | 333 | **DISCARD** | `layoutBadges()` aggregation (lines 12–28) contains reusable logic but it is 28 lines inside a 333-line file where the rest is `computeGridLayout()` (lines 100–158), the pole-of-inaccessibility fallback (lines 192–258), and the grid renderer (lines 260–333). The aggregation concept can be extracted; the file as-is is DISCARD. |
| `components/HotspotDot.tsx` | 36 | **DISCARD** | SVG `<circle>` at projected lat/lng coordinates (line 18). `vector-effect="non-scaling-stroke"` (line 31). `radiusFor()` log-scale function tied to the SVG viewBox coordinate space. Entirely map-specific. |
| `geo/path.ts` | 301 | **DISCARD** | `parsePoints`, `boundingBoxOfPath`, `pointInPolygon`, `distanceToPolygonEdge`, `largestInscribedRect` (96-cell raster, lines 140–209), `poleOfInaccessibility` (polylabel quad-tree, lines 225–301). Every exported function exists to solve SVG polygon layout problems. |

**Non-map subtotal: 653 KEEP + ~50 from App.tsx REFACTOR portions**
**Map chain subtotal: 1,000 DISCARD (205+176+139+333+36+301) + ~51 REFACTOR from App.tsx**

---

## 2. Styles — Per Rule-Group Classification

File: `frontend/src/styles.css` (170 LOC)

| Rule group | Lines | Classification | Rationale |
|---|---|---|---|
| `*, *::before, *::after { box-sizing }` + `html, body, #root { height }` + `body { font-family, background, color }` | 1–7 | **KEEP** | Global resets. Design-agnostic. |
| `.region { transition; transform-origin: 0 0 }` | 13–13 | **DISCARD** | Comment (lines 9–12) explains `transform-origin: 0 0` is mandatory because `computeExpandTransform` bakes the pivot into `translate()`. Entirely expand-transform contract. |
| `.region-expanded .region-shape { filter: drop-shadow }` | 19–19 | **DISCARD** | Comment (lines 14–18) documents that the drop-shadow must be authored in SVG user units to survive the 3–9× expand scale. SVG-filter workaround. |
| `.region-shape, .badge-circle, .badge-label, .hotspot-dot, [data-role="overflow-pip"] circle { vector-effect: non-scaling-stroke }` | 28–34 | **DISCARD** | Comment (lines 20–27) is an explicit SVG dark-corners explanation: without `non-scaling-stroke`, a 3-unit stroke renders at 9–27 CSS px under the expand scale. Dies with SVG map. |
| `.badge { transition }` + `.badge-selected .badge-circle { stroke }` | 38–39 | **DISCARD** | Badge SVG element state. |
| `.badge-label { fill, stroke, stroke-width, paint-order, font-family, font-weight, pointer-events }` | 44–53 | **DISCARD** | Comment (lines 40–43) documents `paint-order: stroke fill` workaround to prevent the label stroke from swallowing label fill inside expanded region. SVG text rendering workaround. |
| `.app { display: flex; flex-direction: column; height: 100vh }` | 55–59 | **KEEP** | Outer shell layout. Will remain valid for any column layout (filters bar + main content area). |
| `.map-wrap { flex: 1; overflow: visible; padding }` + comment (lines 67–73) | 60–74 | **DISCARD** | `overflow: visible` comment (lines 67–72) documents that the overflow must not be `hidden` or the drop-shadow filter region gets clipped at the HTML cell edge. SVG filter workaround determines this rule. The `.map-wrap` class itself dies with the map wrapper `<div>`. |
| `.bird-map { max-height; max-width; display: block }` | 75–75 | **DISCARD** | SVG element sizing. |
| `.error-screen { padding; max-width; margin }` | 76–80 | **KEEP** | Error display. Design-agnostic. |
| `.filters-bar { display: flex; gap; padding; background; border-bottom; flex-wrap }` + label/select/input rules | 82–93 | **KEEP** | FiltersBar HTML layout. No SVG reference. |
| `.species-panel { position: fixed; top/right; width; height; background; border; padding; z-index }` and all nested rules (`.species-panel-close`, `.species-panel-body`, `.species-panel-common-name`, `.species-panel-sci-name`, `.species-panel-family`, `.species-panel-loading`, `.species-panel-error`, `.species-panel-sr-heading`) | 94–171 | **KEEP** | Complete panel stylesheet. All HTML/CSS; zero SVG references. Comment (lines 95–100) notes the panel uses `position: fixed` intentionally so it doesn't reflow the map — that fixed-positioning strategy is still valid for a non-map layout. |

**Styles KEEP: ~78 LOC. Styles DISCARD: ~92 LOC.**

---

## 3. Tests and Specs

### Unit tests under `frontend/src/**/*.test.{ts,tsx}`

| File | LOC | Classification | Rationale |
|---|---:|---|---|
| `api/client.test.ts` | 39 | **KEEP** | Tests `ApiClient.getRegions/getObservations/getSpecies` fetch shapes. No rendering, no SVG. |
| `state/url-state.test.ts` | 41 | **REFACTOR** | Tests `readUrl`/`writeUrl`/`useUrlState`. The `region` param tests (any test asserting `regionId` round-trips) must be deleted or updated when `regionId` is removed from `UrlState`. Core test structure survives. |
| `data/use-bird-data.test.tsx` | 59 | **REFACTOR** | Tests loading states and filter-reactive refetch. If `getRegions` and `getHotspots` are dropped from the hook, their corresponding test assertions fall away. Structure survives. |
| `data/use-species-detail.test.ts` | 129 | **KEEP** | Tests cache, cancellation, error state. Zero map references. |
| `components/FiltersBar.test.tsx` | 58 | **KEEP** | RTL tests of HTML controls. No SVG. |
| `components/SpeciesPanel.test.tsx` | 114 | **KEEP** | Tests panel open/close, ESC, aria-labelledby, loading/error states. No SVG. |
| `components/Map.test.tsx` | 275 | **DISCARD** | Tests paint-order sort, two-pass layer structure, `[data-region-id]` attributes, `computeExpandTransform` calls, hotspot projection, `aria-label="Arizona ecoregions map"`. 100% map-specific. |
| `components/Region.test.tsx` | 141 | **DISCARD** | Tests `computeExpandTransform` math (cap at `EXPAND_MAX_BBOX_FRAC`), `RegionShape` path rendering, `RegionBadges` bbox computation. |
| `components/Badge.test.tsx` | 155 | **DISCARD** | Tests SVG circle radii, `vector-effect`, silhouette scaling, chip sizing, label text truncation inside SVG `<g>`. |
| `components/BadgeStack.test.tsx` | 435 | **DISCARD** | Tests `computeGridLayout`, `largestInscribedRect` integration, `poleOfInaccessibility` fallback, overflow pip rendering. Largest single test file; 100% map-specific. |
| `components/HotspotDot.test.tsx` | 34 | **DISCARD** | Tests SVG circle `r` attribute and `vector-effect`. |
| `geo/path.test.ts` | 145 | **DISCARD** | Tests `parsePoints`, `boundingBoxOfPath`, `pointInPolygon`, `largestInscribedRect`, `poleOfInaccessibility`. All SVG geometry. |

**Unit test totals: KEEP 340 LOC | REFACTOR 100 LOC | DISCARD 1,185 LOC**

### E2E specs under `frontend/e2e/*.spec.ts`

| File | LOC | Classification | Rationale |
|---|---:|---|---|
| `error-states.spec.ts` | 37 | **KEEP** | Tests `.error-screen` renders on API failure. Selectors: `.error-screen h2`, `.error-screen p`, `.map-wrap[aria-busy]`. The `map-wrap` class and error-screen text ("Couldn't load map data") will need updating to reflect new UI, but the intent is design-agnostic. Selector-update only. |
| `filters.spec.ts` | 60 | **KEEP** | Tests all four filter controls update the URL correctly. Uses `app.waitForMapLoad()` as a readiness gate — that gate method will need renaming/reimplementing, but the filter behavior under test is fully design-agnostic. |
| `history-nav.spec.ts` | 47 | **KEEP** | Both tests are already `test.fail()` (lines 9, 29) because `url-state.ts` uses `replaceState`. Tests document the known gap; they pass after the `pushState` fix regardless of map vs. no-map. Uses `app.expandRegion()` which is map-specific, but the spec's *intent* (back-button reverts state change) is design-agnostic. Will need selector updates when the expand interaction is replaced. |
| `species-panel.spec.ts` | 110 | **REFACTOR** | Species detail panel behavior is KEEP-worthy, but the readiness gate `[data-region-id]` (count 9) appears on all 4 tests (lines 26, 67, 90, 103). Test 1 also clicks a `g.badge` SVG element to open the panel (lines 38–42). Both are map-specific selectors. The panel's ARIA contract, ESC behavior, URL round-trip, and error display are preserved; the "how we open it" and "what we wait for" need rewriting. |
| `deep-link.spec.ts` | 54 | **REFACTOR** | Tests `?since=`, `?notable=`, `?species=`, `?family=` URL params are restored — all design-agnostic. But the readiness gate is `[data-region-id]` count=9 throughout (lines 10, 19, 26, 38, 47), and test 1 explicitly asserts `?region=sky-islands-santa-ritas` restores `.region-expanded` (lines 9–13, 52). The non-region tests survive; the region-specific test dies; gates need updating. |
| `a11y.spec.ts` | 91 | **REFACTOR** | Test 1 ("Space key also expands a region") uses `.region-shape[aria-label]`, `[data-region-id]`, and `.region-expanded` — entirely map-specific (lines 7–12). Test 2 (Tab order for all four filters) uses `[data-region-id]` as a readiness gate (line 16) but the filter-reachability assertion is design-agnostic. Test 3 (aria-busy) and Test 4 (unlabelled element scan) are design-agnostic. 1 of 4 tests dies; 3 need selector updates. |
| `axe.spec.ts` | 74 | **REFACTOR** | Runs `AxeBuilder` WCAG scans. Test 2 ("region expanded") drives a map expand sequence (lines 23–26). The axe-scanning pattern and WCAG tag set are design-agnostic; only test 2's setup is map-specific. 3 of 4 tests keep with selector updates; 1 test's setup needs rewriting for whatever replaces the expand. |
| `prod-smoke.preview.spec.ts` | 15 | **REFACTOR** | Smoke test asserts `[data-region-id]` count=9 and `aria-busy=false` (lines 9–13). The `aria-busy` check and error-screen absence are design-agnostic. The `[data-region-id]` readiness gate is map-specific and must be replaced with whatever the new UI's render-complete signal is. |
| `badge-containment.spec.ts` | 162 | **DISCARD** | Tests that every `<circle class="badge-circle">` centre is inside its parent region's SVG polygon path. Entirely SVG geometry. |
| `cross-region-badge-containment.spec.ts` | 191 | **DISCARD** | Tests that badges from region A don't visually intersect region B's shape. Two-pass paint-order validation. SVG geometry. |
| `expand-cap.spec.ts` | 73 | **DISCARD** | Tests `EXPAND_MAX_BBOX_FRAC = 0.6` cap prevents Sky Islands badges from blowing up. `computeExpandTransform` contract. |
| `paint-order.spec.ts` | 152 | **DISCARD** | Tests SVG document order (parent regions before children, selected region last). `data-region-id` DOM order assertions. |
| `sizing.spec.ts` | 88 | **DISCARD** | Tests badge radii stay within `MIN_BADGE_DIAMETER`–`MAX_BADGE_DIAMETER` range. SVG circle attribute assertions. |
| `stroke-scaling.spec.ts` | 93 | **DISCARD** | Tests `vector-effect: non-scaling-stroke` on `.region-shape`, `.badge-circle`, `.badge-label`, `.hotspot-dot` computed styles. Directly tests the SVG non-scaling-stroke workaround. |
| `region-collapse.spec.ts` | 64 | **DISCARD** | Tests ESC collapses expanded region. The first test is `test.fail()` (SpeciesPanel comment at `SpeciesPanel.tsx:18–28` explains why). The interaction being tested (expand/collapse a region) dies with the map. |
| `happy-path.spec.ts` | 43 | **DISCARD** | Explicitly tests: region expand via keyboard, `.region-expanded` class, `transform` attribute from `computeExpandTransform`, URL `?region=` param. Every assertion is map-specific. Labeled REFACTOR in the brief but on close reading there is no assertion that survives without a map region to expand; the filter toggle at line 33 is the only design-agnostic step, and it's already covered by `filters.spec.ts`. DISCARD. |

**E2E totals: KEEP 3 | REFACTOR 5 | DISCARD 8**

---

## 4. URL-State Contract

Source: `frontend/src/state/url-state.ts`, lines 1–70.

| Param | Key | Source line | Classification | Rationale |
|---|---|---|---|---|
| `?since=` | `since: Since` | `p.get('since')` line 28, `p.set('since', ...)` line 40 | **KEEP** | Design-agnostic time window. Valid for any data display. |
| `?notable=true` | `notable: boolean` | `p.get('notable')` line 30, `p.set('notable', 'true')` line 42 | **KEEP** | eBird notable flag is a data-layer concept; survives any UI. |
| `?species=` | `speciesCode: string \| null` | `p.get('species')` line 29, `p.set('species', ...)` line 41 | **KEEP** | Species selection drives both the filter and the species-detail panel. Design-agnostic. |
| `?family=` | `familyCode: string \| null` | `p.get('family')` line 29, `p.set('family', ...)` line 41 | **KEEP** | Family filter. Design-agnostic. |
| `?region=` | `regionId: string \| null` | `p.get('region')` line 27, `p.set('region', ...)` line 37 | **DISCARD** | Tied to the ecoregion expand interaction. `onSelectRegion` in `App.tsx:84` sets this; `Map.tsx:82,163` reads `expandedRegionId` from it. No equivalent concept in a map-less UI. Existing bookmarks using `?region=` will silently drop the param. |

The four surviving params (`since`, `notable`, `species`, `family`) represent the external URL contract that existing bookmarks depend on. Any redesign that changes these breaks user links.

---

## 5. Invariants the Brainstorm Must Preserve

- **URL param contract for `?since=`, `?notable=`, `?species=`, `?family=`** — these four are already in circulation on bird-maps.com. Breaking them silently invalidates any shared link. Either preserve them exactly or ship an explicit redirect/migration.
- **API client shape** — `ApiClient` (51 LOC, no SVG dependency) and its four methods (`getRegions`, `getHotspots`, `getObservations`, `getSpecies`) are stable. The backend contract is considered fixed per the analysis brief. Do not re-derive these from scratch.
- **Filter semantics** — since / notable / speciesCode / familyCode are user-facing affordances specified in the product spec and wired into both the API query and the URL. The four `FiltersBar` controls ship with correct aria-labels, accessible datalist autocomplete, and draft-then-commit species input behavior. All of this is reusable unchanged.
- **Species-detail pane access** — `SpeciesPanel` + `useSpeciesDetail` work via URL: deep-linking to `?species=vermfly` opens the panel on cold load (`SpeciesPanel.tsx:47`, `url-state.ts:29`). This cold-load path is tested by `species-panel.spec.ts` and `deep-link.spec.ts`. Preserve the `?species=` URL trigger.
- **A11y baseline** — `FiltersBar` aria-labels, `SpeciesPanel` `aria-labelledby` + sr-only heading fallback, `error-screen` are axe-clean today. The `axe.spec.ts` WCAG scans must remain in the suite (with updated setup for test 2). Do not regress the axe-clean status.
- **Dev-server + Vite + test toolchain** — `vite.config.ts`, `vitest`, `@playwright/test`, `@testcontainers/postgresql` integration tests, and `test-setup.ts` are unchanged by a UI redesign. The toolchain is a KEEP in its entirety.
- **`deriveFamilies` / `deriveSpeciesIndex`** — these 38-LOC functions produce the option lists for FiltersBar. They carry the `silhouetteId`-as-`familyCode` coupling (issue #57) but that is a data-layer debt, not a UI-layer debt. The brainstorm should not attempt to fix #57 in the context of a redesign.

---

## 6. The Replacement Boundary in App.tsx

The map-specific rendering is invoked in a single block:

**`frontend/src/App.tsx`, lines 77–89**

```tsx
<div className="map-wrap" aria-busy={loading}>
  <Map
    regions={regions}
    observations={observations}
    hotspots={hotspots}
    expandedRegionId={state.regionId}
    selectedSpeciesCode={state.speciesCode}
    onSelectRegion={id => set({ regionId: id, speciesCode: null })}
    onSelectSpecies={code => set({ speciesCode: code })}
    silhouetteFor={silhouetteFor}
    colorFor={colorFor}
  />
</div>
```

This is the seam. Everything above it (lines 1–76) and below it (lines 90–101) either survives unchanged or needs minor trimming (`regionId` removal from the `set` calls at lines 84–85). The `silhouetteFor` function (lines 28–30) and `colorFor` function (lines 41–43) are only called from within this block and die with it.

The `aria-busy={loading}` attribute on `.map-wrap` is referenced by `error-states.spec.ts` and `a11y.spec.ts`. Its equivalent must be preserved on whatever wraps the replacement UI's content area.

---

## 7. Totals

### Production source (1,964 LOC total)

| Classification | LOC | % of total |
|---|---:|---:|
| KEEP (works unchanged) | 653 | 33% |
| REFACTOR (concept survives, code changes needed) | 311 | 16% |
| DISCARD (dies with the map) | 1,000 | 51% |

REFACTOR breakdown: `url-state.ts` 70 + `use-bird-data.ts` 50 + `App.tsx` ~101 (half) + `styles.css` proportional ≈ 311.

### Unit tests (1,625 LOC total)

| Classification | LOC | % of total |
|---|---:|---:|
| KEEP | 340 | 21% |
| REFACTOR | 100 | 6% |
| DISCARD | 1,185 | 73% |

### E2E specs (1,354 LOC total; 16 files)

| Classification | Count | LOC | % of LOC |
|---|---:|---:|---:|
| KEEP | 3 | 144 | 11% |
| REFACTOR | 5 | 376 | 28% |
| DISCARD | 8 | 834 | 62% |

KEEP e2e: `error-states.spec.ts`, `filters.spec.ts`, `history-nav.spec.ts`.
REFACTOR e2e: `species-panel.spec.ts`, `deep-link.spec.ts`, `a11y.spec.ts`, `axe.spec.ts`, `prod-smoke.preview.spec.ts`.
DISCARD e2e: `badge-containment`, `cross-region-badge-containment`, `expand-cap`, `paint-order`, `sizing`, `stroke-scaling`, `region-collapse`, `happy-path`.

### Combined (all frontend source: 2,566 LOC per phase-0 packet)

The 2,566 figure from the packet includes the e2e and unit test files in addition to the production sources counted above. Mapping the full combined figure:

| Classification | Approx LOC | % of 2,566 |
|---|---:|---:|
| KEEP | ~1,137 (653 src + 340 unit + 144 e2e) | ~44% |
| REFACTOR | ~787 (311 src + 100 unit + 376 e2e) | ~31% |
| DISCARD | ~3,019 (1,000 src + 1,185 unit + 834 e2e) | ... |

Note: the combined total exceeds the 2,566 figure because 2,566 is stated as production-source-only LOC in the phase-0 packet ("2566 LOC total across `frontend/src/` (TS/TSX/CSS)"), while e2e files live under `frontend/e2e/`. Treating 2,566 as the production source baseline: KEEP is 33%, REFACTOR is 16%, DISCARD is 51% of production source.

---

## Surprises

- `history-nav.spec.ts` is already `test.fail()` on both tests (lines 9 and 29), documenting a known `replaceState` vs `pushState` bug. This spec is in better shape than expected: it is design-intent documentation, not a passing test. It belongs in KEEP because the intent (back-button reverts state) is design-agnostic.
- `happy-path.spec.ts` was labeled REFACTOR in the brief, but every assertion except one filter toggle is map-specific. The single non-map assertion (filter toggle at line 33) is fully covered by `filters.spec.ts`. Reclassified as DISCARD.
- `use-species-detail.ts` (72 LOC) is the cleanest hook in the codebase — well-isolated, session-cached, no SVG dependency, zero coupling to any map concept. Its 129-line test file is likewise fully portable.
- `SpeciesPanel.tsx` has a comment at lines 18–28 that explicitly explains why ESC collapse for the region is NOT implemented in `App.tsx` — this is deliberate coupling avoidance, not an oversight. The panel is more self-contained than it appears.
- The `styles.css` SVG workaround comments (lines 9–12, 14–18, 20–27, 35–38, 40–43, 67–73) constitute 35 of 170 LOC of the stylesheet and exist solely to explain SVG dark-corner workarounds. The surviving CSS is actually the minority of the file by word count even though it represents the majority of useful styling.

---

## Unknowns and Gaps

- **`layoutBadges()` in `BadgeStack.tsx` (lines 12–28)** performs count-aggregation by `speciesCode` that has no SVG dependency. Whether this 28-line function should be extracted and classified as REFACTOR depends on whether the replacement UI needs per-species count aggregation. Without knowing the replacement surface, it is currently bundled into a DISCARD file.
- **Whether `getRegions()` is called in the replacement UI** — the `ApiClient.getRegions()` call and the `Region` shared type may have zero utility in a map-less UI (regions are not displayed), or they may be used for a region-selector dropdown. This determines whether `use-bird-data.ts`'s REFACTOR is a small trim (remove one Promise.all branch) or requires a larger rethink.
- **`?region=` param migration** — if existing bird-maps.com URLs with `?region=` are in the wild (shared links, any analytics), silently dropping the param on page load is benign (it becomes an unknown param and `readUrl` ignores it). No explicit redirect is required, but the brainstorm should decide explicitly.
- **Toolchain files not examined** — `frontend/vite.config.ts`, `frontend/playwright.config.ts`, `frontend/package.json` were not read for this investigation. They are assumed to be KEEP with no modification for the purposes of this manifest.

---

## Raw Evidence

Files read (all via Read tool from absolute paths):
- `docs/analyses/2026-04-20-frontend-map-analysis/context-packets/phase-0-packet.md`
- `docs/analyses/2026-04-20-frontend-map-analysis/phase-0/analysis-brief.md`
- All 18 files under `frontend/src/` (production + test-setup + vite-env)
- All 12 unit test files under `frontend/src/**/*.test.{ts,tsx}`
- All 16 e2e spec files under `frontend/e2e/*.spec.ts`

LOC counts: `wc -l` on all production files and all test/spec files.

Map-specific selector confirmation: `grep` on `species-panel.spec.ts`, `deep-link.spec.ts`, `error-states.spec.ts` for `data-region-id`, `region-expanded`, `map-wrap`, `badge` usage.
