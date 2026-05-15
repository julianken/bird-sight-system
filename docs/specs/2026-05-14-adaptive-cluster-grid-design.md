# AdaptiveGridMarker — design

Replace today's split `<MosaicMarker>` (≤8 obs, fixed 2×2 + single overall badge) and `<ClusterPill>` (≥9 obs, numeric pill) with one component, `<AdaptiveGridMarker>`, whose shape scales with the cluster's unique-family count and whose cells carry per-family observation counts. Delete auto-spider entirely; raise `clusterMaxZoom` from 14 → 22 so the same component renders at every zoom level, including coincident-point disambiguation that auto-spider previously handled.

Status: **brainstorming complete, plan-body authorship pending prototype gates** (see §10).

## 1. Background

### What exists today

- `frontend/src/components/map/MapCanvas.tsx:1016-1023` configures MapLibre clustering with `clusterMaxZoom=14, clusterRadius=50`. Constants in `observation-layers.ts:152-153`.
- Clusters with `point_count ≤ 8` render as `<MosaicMarker>` — 2×2 CSS grid of family silhouettes, single overall observation-count badge (`MosaicMarker.tsx:108-175`). Limit `CLUSTER_MOSAIC_MAX_POINTS=8` at `observation-layers.ts:163`.
- Clusters with `point_count ≥ 9` render as `<ClusterPill>` in three tiers (`sky`/`sand`/`ember`) — numeric pill like "1640".
- At `z ≥ 14`: individual `<PresentationMarker>` per observation. An **auto-spider** reconciler (`use-auto-spider.ts`) fans coincident points on a 70px ring, capped at 8 leaves (`fan-layout.ts:33`). Click-driven spidering was deleted in #280; what exists is the always-on auto-fan reconciler.
- Family aggregation: `aggregateClusterFamilies` in `cluster-mosaic.ts:80-95` sorts descending by family count, alphabetical tiebreak. `MosaicTile.count` (`cluster-mosaic.ts:52`) is computed and threaded to the renderer **but never displayed**.

### Why this is wrong now

Three concrete problems surfaced in the 2026-05-14 investigation:

1. **Box-of-4 carries an overall observation-count badge, not per-family counts.** The user sees "7" overlaid on four silhouettes but cannot tell which family contributes which observations. The per-cell count is already in `MosaicTile.count` — just not rendered.
2. **Cluster previews disappear above 8 observations.** The dominant visual at AZ overview zoom is numeric pills (e.g. "1640"), giving zero species-composition signal. The mosaic is reserved for the smallest clusters where it's least needed.
3. **Auto-spider has a hard cap of 8 leaves.** At dense hotspots (Tucson 1640 obs, Madera Canyon 1085 obs, Ash Canyon 1132 obs), the fan is essentially decorative — users cycle through pill → smaller pill → mosaic → 8-leaf fan over multiple click-and-zoom cycles before reaching individual silhouettes.

### Measured data shape (informs sizing)

From `https://api.bird-maps.com/api/observations` on 2026-05-14 (18,086 AZ observations, clustered with production config):

| Zoom band | p50 species/cluster | p90 | p95 | p99 | Max |
|---|---|---|---|---|---|
| 8–10 (state view) | 4 | 34 | 58 | 112 | 168 |
| 11–13 (county view) | 2 | 15 | 23 | 53 | 112 |
| 14–16 (hotspot detail) | 2 | 12 | 18 | 40 | 88 |

Cumulative grid coverage (% of clusters whose species fit, no overflow):

| Grid size | z 8–10 | z 11–13 | z 14–16 |
|---|---|---|---|
| 2×2 (today) | 50.4% | 68.5% | 74.8% |
| 3×3 | 67.0% | 83.5% | 87.4% |
| 4×3 | 72.0% | 87.9% | 91.3% |
| 4×4 | 77.4% | 92.1% | 94.4% |
| 6×6 | ~91% | ~98% | ~99% |

Top-10 worst clusters in AZ are well-known hotspots (Portal/Chiricahuas, Ash Canyon, Paton Center, Sweetwater Wetlands, Madera Canyon, etc.) with 100–168 species each.

**Implication:** no grid size retires overflow at state view. Spidering can be retired at z ≥ 11 with a 4×4 grid (92%+ coverage); state-view long-tail clusters need a pill fallback regardless.

## 2. Goals · Non-goals

**Goals**

1. One marker component handles every cluster, at every zoom level, with no UX mode switch.
2. Each cell carries the observation count for that family in the cluster.
3. Per-cell coverage scales with the cluster's unique-family count (1×1 → 4×4 grid · then pill fallback).
4. Auto-spider disappears entirely. Coincident-point disambiguation comes from the cluster grid never decomposing.
5. No measurable regression at the bird-maps.com data volume on canonical viewports (390×844, 768×1024, 1024×768, 1440×900, 1920×1080).

**Non-goals**

- Per-cell tap targets. The whole marker is one tap target.
- API changes. Per-family counts already derivable client-side from `getClusterLeaves` + `aggregateClusterFamilies`.
- Changes to the observation panel, the FeedSurface, or any non-marker map UI.
- Changes to the basemap, attribution layout, or floating "Bird families in view" component.

## 3. Decision: Approach A — Grid Everywhere

The brainstorm considered three approaches. **Approach A** was chosen because it is the only approach where "retire spidering, let the grid handle disambiguation" is literally true at every zoom level.

| Approach | Coincident points at z ≥ 14 | Auto-spider | Trade-off |
|---|---|---|---|
| **A · Grid Everywhere (chosen)** | Cluster into a 2×1 or larger grid (clusterMaxZoom=22) | Deleted entirely | One marker model end-to-end; perf cost addressed in §10 |
| B · Two-tier, accept stack regression | Stack pixel-perfectly | Deleted | Reintroduces the problem auto-spider solved |
| C · Two-tier + stack-badge popover | Single marker with "×N" badge + tap-to-list popover | Replaced with popover | Three marker types; new UI component; contradicts the grid-as-disambiguator principle |

## 4. Design

### 4.1 Adaptive grid shape

`pickGridShape(uniqueFamilies, pointCount) → GridShape` returns a discriminated union:

```ts
type Dim = 1 | 2 | 3 | 4;
type PositiveInt = number & { readonly __brand: 'PositiveInt' };
declare function toPositiveInt(n: number): PositiveInt;  // throws on n < 1

type GridShape =
  | { tag: 'grid'; cols: Dim; rows: Dim }                      // visibleCapacity = cols*rows
  | { tag: 'grid-overflow'; cols: Dim; rows: Dim; hiddenCount: PositiveInt }   // visibleCapacity = cols*rows - 1 (reserved for "+N")
  | { tag: 'pill' };

type ResolvedGrid = Exclude<GridShape, { tag: 'pill' }>;       // what AdaptiveGridMarker receives

// Helper, not a stored field — derived deterministically:
declare function visibleCapacity(shape: ResolvedGrid): number;
// grid       → cols * rows
// grid-overflow → cols * rows - 1
```

The separate `grid-overflow` tag is deliberate: the previous `{ tag:'grid'; capacity; overflow }` shape made it constructible to express nonsense (`overflow > 0` with `capacity === cols*rows`, or `capacity` inconsistent with `cols*rows`). The discriminated union makes "overflow reserves a cell" representable only via the dedicated tag. `Dim` typing prevents arbitrary integers in dimension fields.

Rules (desktop · viewport > 480px):

| Unique families | Shape | Visible capacity |
|---|---|---|
| 1 | `{tag:'grid', cols:1, rows:1}` | 1 |
| 2 | `{tag:'grid', cols:2, rows:1}` | 2 |
| 3–4 | `{tag:'grid', cols:2, rows:2}` | 4 |
| 5–9 | `{tag:'grid', cols:3, rows:3}` | 9 |
| 10–16 | `{tag:'grid', cols:4, rows:4}` | 16 |

**Pill fallback** when `uniqueFamilies > 16 OR point_count > 64`. The observation-count cap exists because raising `clusterMaxZoom` to 22 produces dense low-zoom clusters whose DOM cost as 4×4 grids regresses against today's lightweight pills (see §10 Gate 2). The Tucson 1640-obs cluster stays a pill at z = 8; as the user zooms in, smaller fragments emerge with `point_count ≤ 64` and `uniqueFamilies ≤ 16` and become grids.

**Mobile cap** at viewport ≤ 480px: the 4×4 case collapses to `{tag:'grid-overflow', cols:3, rows:3, hiddenCount: uniqueFamilies - 8}`. Concretely, `pickGridShape(12, /*pointCount*/ 12, /*isMobile*/ true) → {tag:'grid-overflow', cols:3, rows:3, hiddenCount: 4}`. Visible capacity is 8 (the 9th cell is the "+N more" indicator). Prevents adjacent 104×104 markers from overlapping on 390-wide viewports.

### 4.2 Family ordering

Existing logic in `aggregateClusterFamilies` (`cluster-mosaic.ts:80-95`) is correct: descending by observation count, alphabetical tiebreak on `familyCode`. The function moves unchanged into `adaptive-grid.ts` (see §5.2). Behavioral invariants preserved verbatim — including the null-familyCode dropout case from `Observation`'s LEFT-JOIN contract — and explicitly retested (§7).

### 4.3 Per-cell observation-count badge

- Visual: bottom-right of each cell, 14px tall pill, `#1a1a1a` background, white tabular digits.
- **Box-shadow stroke** `0 0 0 1px rgba(255,255,255,0.9)` for guaranteed 3:1 contrast against any basemap tile underneath. Resolves the WCAG 1.4.11 contrast concern that today's `#ffffffd9` tile alpha cannot guarantee against varied terrain.
- **Hidden when `cell.count === 1`.** A 1×1 grid with count=1 looks visually identical to today's individual observation marker. Default to silence; only show count when count > 1.
- Counts are integers, no thousand-separators (cells max out at three digits in practice — the largest cell would be the Tucson cluster's dominant family at ≈800 obs of one family).

### 4.4 Hit-extender overlay

Marker visual geometry (28 / 52 / 78 / 104) is independent of the hit zone. A transparent overlay element wraps each marker:

- `pointer:fine` → 44×44 min (WCAG 2.5.5 AAA target size, matching existing `MapMarkerHitLayer.tsx:53` `HIT_SIZE_DESKTOP=40` — proposed raised to 44 to clear AAA).
- `pointer:coarse` → 48×48 min (matches existing `HIT_SIZE_COARSE=48`).
- Positioned via `inset: min(0, (44 - markerSize) / 2)` (a negative value extends the box outward by half the deficit). A 1×1 (28×28) marker gets `inset: -8` → 44×44 hit zone. A 4×4 (104×104) marker gets `inset: 0` → its own bounding box.
- The overlay is the `<button>`; the visual marker is its child. ARIA attributes live on the overlay.

### 4.5 Tap behavior — parent routes the click

The marker is a **pure display component**. `MapCanvas.tsx` selects the click handler before rendering:

```ts
const onClick = isSingleLeaf(clusterId)
  ? () => openObsPanel(subId)
  : () => zoomToExpansion(clusterId);

<AdaptiveGridMarker shape={shape} tiles={tiles} onClick={onClick} … />
```

The marker never inspects its own data shape to choose between two parent-domain actions. `isSingleLeaf(clusterId)` is a one-liner helper in `MapCanvas.tsx` that returns `true` iff the supercluster feature reports `point_count === 1`. The behavior collapses to "tapping a single-observation marker opens its obs panel directly" — identical to today's individual-marker UX, no regression.

### 4.6 Two-tier ARIA disclosure

Concise label (always announced) plus a visually-hidden enumeration. Pattern:

| Marker state | `aria-label` | `aria-describedby` target |
|---|---|---|
| 1×1, count=1 | `"Single observation: Cooper's Hawk."` | none |
| 1×1, count=2 (coincident) | `"2 coincident observations: Cooper's Hawk and Sharp-shinned Hawk. Activate to zoom in."` | none |
| Grid (any size) | `"Cluster: 47 observations, 11 families. Activate to zoom in."` | `#marker-${clusterId}-families` |
| Pill | `"Cluster: 1640 observations, 47 families. Activate to zoom in."` | `#marker-${clusterId}-families` |

The describedby target is a `<ul class="visually-hidden">` rendered inside the button. Up to 8 list items; if the cluster has more, the 9th item reads `"and N more families"`. This caps the label at scannable length while preserving information-equivalence with sighted users (per WCAG 1.3.1).

The count=2 coincident case explicitly names both species — recovering disambiguation that auto-spider previously gave SR users via separate fanned buttons.

### 4.7 Inherited tab-order contract

The hit layer is **intentionally NOT in the global Tab order** (`tabIndex={-1}`), per the existing comment at `MapMarkerHitLayer.tsx:14-17`. A skip-link in `MapSurface` routes Tab traffic to the `FeedSurface` list landmark, which is the proper keyboard-navigable surface for a 7,000+ marker view.

The redesign inherits this. **The spec re-states this explicitly** because a future implementer could reasonably assume `tabIndex={0}` for buttons and break the existing contract.

### 4.8 Marker remount keying

`AdaptiveGridMarker` is keyed by `cluster_id` (supercluster's stable ID). Supercluster issues different IDs at different zoom levels, so zoom transitions naturally remount markers. This is the existing `MosaicMarker` contract and is preserved.

## 5. Component API

### 5.1 `AdaptiveGridMarker.tsx`

```ts
interface AdaptiveGridMarkerProps {
  shape: ResolvedGrid;                // narrowed by parent — pill rendered separately
  tiles: ReadonlyArray<AdaptiveTile>;  // length ≤ visibleCapacity(shape), sorted by aggregateClusterFamilies
  totalCount: number;                  // point_count
  uniqueFamilies: number;              // for aria-label
  onClick: (e: MouseEvent<HTMLButtonElement>) => void;
  isCoarsePointer?: boolean;           // wired via useMediaQuery('(pointer: coarse)')
}

// Discriminated union — matches existing MosaicTile precedent at cluster-mosaic.ts:42-58.
// Keeps the field name `svgData` (consistent with FamilySilhouette.svgData in shared-types/index.ts);
// no surprise rename. Fallback variant carries only the fields actually rendered.
// `pending` distinguishes "catalogue not loaded yet" from "loaded but no art for this family" —
// without it both cases render as fallback (opacity 0.5) and a cold-load map is indistinguishable
// from a real coverage gap.
type AdaptiveTile =
  | { kind: 'rendered'; familyCode: string; svgData: string; color: string; count: number }
  | { kind: 'fallback'; familyCode: string; color: string; count: number }     // catalogue loaded, no art for this family
  | { kind: 'pending'; familyCode: string; count: number };                     // catalogue not loaded yet (render skeleton)
```

The marker takes a `ResolvedGrid` (pill is unreachable at the type level — `Exclude<GridShape, { tag: 'pill' }>`). The parent renders `<ClusterPill>` directly for `shape.tag === 'pill'`. `isMobileViewport` is no longer threaded — the mobile cap is already encoded in `shape.tag === 'grid-overflow'`.

`tiles.length` may be less than `visibleCapacity(shape)` when fewer families are present than the grid can hold. Empty slots render as transparent padders in the marker (existing behavior, preserved). When `shape.tag === 'grid-overflow'`, the last visible slot is always the "+N more" indicator using `shape.hiddenCount` — never a tile.

### 5.2 `adaptive-grid.ts`

```ts
export function pickGridShape(
  uniqueFamilies: number,
  pointCount: number,
  isMobileViewport: boolean
): GridShape

export function buildAdaptiveTiles(
  leaves: ObservationFeature[],
  capacity: number
): AdaptiveTile[]

// moved unchanged from cluster-mosaic.ts:80-95
export function aggregateClusterFamilies(
  leaves: ObservationFeature[]
): FamilyAggregate[]
```

### 5.3 Memoization

`MapCanvas.tsx:704-722` runs the cluster-leaves + family-aggregation chain on every map `idle` (registered at `MapCanvas.tsx:742`). Today this is bounded by `CLUSTER_MOSAIC_MAX_POINTS=8`; the redesign removes that ceiling, so worst-case is 1640 leaves iterated per marker per idle for the Tucson hotspot.

There are **three separable caching concerns** the implementation must address:

**Concern A — Render-pass stability.** The derived `tiles: ReadonlyArray<AdaptiveTile>` passed to `<AdaptiveGridMarker>` should not be a new identity on every render when the inputs haven't changed, or `React.memo` on the marker is defeated. Solution: `useMemo` at the parent keyed on `[zoom, cluster_id, point_count, silhouettesVersion]` (see Concern C for the version token). Garbage-collected by React when the cluster leaves the viewport. Idiomatic React.

**Concern B — Async-call avoidance across idle ticks.** `getClusterLeaves` is an async supercluster call. Running it for every visible cluster on every `idle` event is the actual perf hot path. This caching layer lives *outside* React render — a module-scoped `Map<string, Promise<AdaptiveTile[]>>` in `MapCanvas.tsx` keyed on **`${zoom}:${cluster_id}:${point_count}`** (zoom is `Math.floor(map.getZoom())` to handle fractional values from continuous-zoom devices). The zoom prefix is load-bearing: supercluster's integer `cluster_id` values can collide across zoom levels, and without it the cache will silently return a stale tile array from a different zoom's leaf set. Eviction: at the end of each `idle` handler, drop entries whose `zoom:cluster_id` is not present in the current viewport's feature set. **Rejected-Promise eviction**: if a stored Promise rejects, the cache entry is deleted in the same microtask (a `.catch()` cleanup at insert time) so a transient supercluster failure does not poison the cache for the lifetime of the cluster. The rejection is logged once via the project's standard error path; tests assert that a retry after rejection re-invokes `getClusterLeaves` rather than returning the rejected Promise.

**Concern C — Catalogue rebuild invalidation.** Supercluster's index is rebuilt when `silhouettes.length` changes (this is the existing effect-deps trigger at `MapCanvas.tsx:760`). After a rebuild, spatially equivalent clusters can be assigned different `cluster_id` values, and downstream silhouette resolution may produce different `svgData` for the same family if the catalogue rows changed. The implementation must:

1. **Generation counter + race-safe commit.** Introduce a module-scoped monotonic `cacheGeneration: number` in `MapCanvas.tsx`. The effect body increments this counter and wholesale-clears the Concern B `Map` whenever it re-registers. Each `reconcile` invocation captures `const myGen = cacheGeneration` at its top; before calling `setMosaics(next)`, it checks `myGen === cacheGeneration` and no-ops the commit if the generation has advanced. This closes the race where an in-flight reconcile from the prior catalogue commits stale tiles after a refresh.
2. **`silhouettesVersion` is a monotonic integer, not `silhouettes.length`.** A length-only proxy misses in-place row replacement (same count, different `svgData` — Phylopic refreshes, low-res→hi-res swaps). The version increments on every catalogue write in the same place where supercluster's index is rebuilt. The useMemo key carries `silhouettesVersion`, not `silhouettes.length`.
3. **Upstream silhouette resolution.** Resolve silhouette `svgData` for each family **upstream** of `buildAdaptiveTiles` rather than reading `silhouettesRef.current` inside the tile-builder. Today's `buildMosaicTiles` does the wrong thing at `MapCanvas.tsx:714` — reading from a ref bypasses every memo key. The new signature is pure: `buildAdaptiveTiles(leaves, silhouettesById, shape) → ReadonlyArray<AdaptiveTile>`. The caller resolves `silhouettesById` once per reconcile and threads it explicitly. Tests pass `silhouettesById` as an argument and verify identical-leaf inputs with different catalogues produce different `svgData`.

All three are **functional requirements** — the §10 Gate 1 p99 bound depends on hitting Concern B's cache for unchanged clusters AND on the catalogue not silently invalidating it on every load. The plan body's first task is to write the failing perf assertion, then add the three layers to make it pass.

**Test-only escape hatch.** The module-scoped `Map` of Concern B is not multi-instance safe and survives `afterEach` unless explicitly cleared. Export a `__resetAdaptiveGridCacheForTesting()` function from `MapCanvas.tsx` (gated by `if (process.env.NODE_ENV === 'test')` to keep it out of prod bundles) and call it in a `beforeEach`. This avoids state leakage between unit tests and avoids the surprise during Vite HMR sessions in dev.

## 6. File map

### New (5)

| File | Purpose |
|---|---|
| `frontend/src/components/map/AdaptiveGridMarker.tsx` | Pure display component for 1×1 through 4×4 grids |
| `frontend/src/components/map/AdaptiveGridMarker.test.tsx` | Render assertions: per-cell badge, badge-hidden-at-1, sizing, mobile cap |
| `frontend/src/components/map/adaptive-grid.ts` | `pickGridShape`, `buildAdaptiveTiles`, re-export `aggregateClusterFamilies` |
| `frontend/src/components/map/adaptive-grid.test.ts` | Shape-picker rules, tile-builder edges |
| `frontend/e2e/map-adaptive-grid.spec.ts` | E2E for grid render, pill fallback, zoom progression |

### Deleted (14)

| File | Reason |
|---|---|
| `frontend/src/components/map/MosaicMarker.tsx` | Superseded by `AdaptiveGridMarker` |
| `frontend/src/components/map/MosaicMarker.test.tsx` | Replaced |
| `frontend/src/components/map/cluster-mosaic.ts` | Constants and `aggregateClusterFamilies` moved into `adaptive-grid.ts` |
| `frontend/src/components/map/cluster-mosaic.test.ts` | Behaviors copied into `adaptive-grid.test.ts` (see §7) |
| `frontend/src/components/map/StackedSilhouetteMarker.tsx` | Single-purpose marker for auto-spider fan leaves (#277); orphaned by auto-spider deletion |
| `frontend/src/components/map/StackedSilhouetteMarker.test.tsx` | |
| `frontend/src/components/map/use-auto-spider.ts` | Auto-spider deleted |
| `frontend/src/components/map/use-auto-spider.test.ts` | |
| `frontend/src/components/map/stack-fanout.ts` | |
| `frontend/src/components/map/stack-fanout.test.ts` | |
| `frontend/src/components/map/fan-layout.ts` | |
| `frontend/src/components/map/fan-layout.test.ts` | |
| `frontend/e2e/map-stack-fanout.spec.ts` | |
| `frontend/e2e/map-cluster-mosaic.spec.ts` | Renamed and rewritten as `map-adaptive-grid.spec.ts`; old spec deleted in same commit |

### Modified (3)

| File | Changes |
|---|---|
| `frontend/src/components/map/MapCanvas.tsx` | Raise `clusterMaxZoom` 14 → 22 (1016-1023). Remove auto-spider block (1073-1100), including `import StackedSilhouetteMarker` at line 43. Swap `<MosaicMarker>` for `<AdaptiveGridMarker>`. Raise `getClusterLeaves` limit (706) from `CLUSTER_MOSAIC_MAX_POINTS` to `point_count`. Add the two memo layers from §5.3. Audit effect-deps array around line 760 (currently re-registers only on `silhouettes.length`/`mapReady`). |
| `frontend/src/components/map/observation-layers.ts` | Drop `CLUSTER_MOSAIC_MAX_POINTS = 8` (163). Bump `CLUSTER_MAX_ZOOM` 14 → 22 (152). Remove `inStack` plumbing (42-61, 121-126, 278, 336) — both the property declarations in the GeoJSON feature type AND every filter clause that branches on it. This is a public GeoJSON-feature-shape change; cross-check `frontend/src/components/map/**` for any other reader of the `inStack` property. |
| `frontend/e2e/axe.spec.ts` | Extend `:55` aria-label assertion to cover grid marker labels and the visually-hidden `<ul>` describedby target. |

### Kept

| File | Why |
|---|---|
| `frontend/src/components/ds/ClusterPill.tsx` + `.test.tsx` | Used by parent for pill fallback (>16 families OR >64 obs). Existing tier visuals (sky/sand/ember) unchanged. |
| `frontend/src/components/map/MapMarkerHitLayer.tsx` | Pattern reused for the hit-extender overlay |
| `frontend/e2e/ds-primitives.spec.ts` | ClusterPill tier preview tests unchanged |

## 7. Test strategy

### Unit (`adaptive-grid.test.ts`)

Shape-picker rules (each test name pins one rule):

- `pickGridShape(1, 1, false) → {tag:'grid', cols:1, rows:1}`
- `pickGridShape(2, …) → 2×1`, `pickGridShape(3, …) → 2×2`, `pickGridShape(4, …) → 2×2`
- `pickGridShape(5..9, …) → 3×3`; `pickGridShape(10..16, …) → 4×4`
- **Family-cap fires alone**: `pickGridShape(17, 30, false) → {tag:'pill'}` (uniqueFamilies > 16, pointCount well under 64)
- **Count-cap fires alone**: `pickGridShape(8, 65, false) → {tag:'pill'}` (family rule alone would give 3×3; pointCount > 64 forces pill)
- **Boundary (count)**: `pickGridShape(8, 64, false) → {tag:'grid', cols:3, rows:3}` (count = 64 inclusive, no pill)
- **Boundary (family + count co-fire)**: `pickGridShape(16, 65, false) → {tag:'pill'}` (locks count-cap at the family-cap boundary — catches a `>` vs `>=` boundary mutation)
- **Boundary (max grid)**: `pickGridShape(16, 64, false) → {tag:'grid', cols:4, rows:4}`
- **Mobile cap**: `pickGridShape(12, 12, true) → {tag:'grid-overflow', cols:3, rows:3, hiddenCount: 4}`
- **Mobile boundary**: `pickGridShape(8, 8, true) → {tag:'grid', cols:3, rows:3}` (no overflow when families fit)
- **Mobile boundary**: `pickGridShape(9, 9, true) → {tag:'grid-overflow', cols:3, rows:3, hiddenCount: 1}` (first overflow case)

Tile-builder rules:

- `buildAdaptiveTiles(200 leaves, 20 unique families, capacity=16) → 16 tiles, descending count`
- **`toPositiveInt` invariant**: `toPositiveInt(1) → 1 (typed)`, `toPositiveInt(0)` throws, `toPositiveInt(-1)` throws, `toPositiveInt(1.5)` throws (constructor enforces positive *integer* domain)
- **Null-familyCode dropout** (LEFT JOIN miss per `Observation` contract): leaves with `familyCode === null` are silently dropped — copied verbatim from `cluster-mosaic.test.ts` so the invariant is preserved
- **Under-capacity** when fewer families than capacity: `buildAdaptiveTiles(5 leaves, 2 families, capacity=4) → 2 tiles` (not 4 — caller pads visually)
- **Fallback by null `svgData`**: leaves whose resolved silhouette `svgData === null` produce tiles with `kind === 'fallback'` — preserved from prior `cluster-mosaic.test.ts`

Memoization (Concerns A, B, C from §5.3):

- `useMemo` reuses tile-array identity when `[zoom, cluster_id, point_count, silhouettesVersion]` is unchanged
- Module-scoped async cache returns the cached `Promise<tiles>` and skips the `getClusterLeaves` call when all four key components match
- Cache invalidates when `point_count` changes for the same `cluster_id` at the same `zoom`
- **Cache uses zoom-prefixed key** — `${zoom}:${cluster_id}:${point_count}` — and a test asserts that the same `cluster_id:point_count` at two different zoom levels produces two independent cache entries (catches collisions silent in an unprefixed key)
- Cache evicts entries whose `zoom:cluster_id` is not in the current viewport feature-set
- **Catalogue invalidation**: when `silhouettes.length` changes (catalogue load / refresh), the module-scoped `Map` is wholesale-cleared and `useMemo` recomputes (silhouettesVersion delta busts the key)
- **Upstream silhouette resolution**: `buildAdaptiveTiles(leaves, silhouettesById, shape)` is pure — it does NOT read from any ref. A regression test asserts that calling it with two different `silhouettesById` arguments returns differently-resolved tiles, even with identical `leaves`
- **Rejected-Promise eviction**: `getClusterLeaves` rejection on a cache key removes the entry in the same microtask. A retry on the same key re-invokes the underlying call (does NOT return the rejected Promise). Test name: `"Concern B cache: rejected getClusterLeaves promise is evicted, retry invokes the underlying call"`
- **Rejection log channel**: a single `console.warn` per `${zoom}:${cluster_id}` per session (rate-limited via a `Set<string>` of warned keys) — matches the existing `MapCanvas.tsx:187` pattern. Tests assert exactly one warning emitted for repeated rejections on the same key
- **Race-safe commit**: the `cacheGeneration` counter increments on every effect re-registration; an in-flight reconcile captures its generation at entry and no-ops `setMosaics` if the generation has advanced. Test name: `"reconcile does not commit tiles when cacheGeneration advanced mid-flight"`
- **`silhouettesVersion` invalidates on in-place replacement**: two catalogue snapshots with identical `length` but different `svgData` for the same `familyCode` bust the useMemo key. Test name: `"silhouettesVersion bump invalidates memo even when silhouettes.length is unchanged"`

### Component (`AdaptiveGridMarker.test.tsx`)

- Renders 1×1 with NO badge when `totalCount === 1`
- Renders 1×1 with badge "5" when `totalCount === 5` (single-family cluster)
- Renders 2×2 with 4 per-cell badges in descending count order
- Renders fallback tile (opacity 0.5) for tiles with `kind === 'fallback'` (preserved from `cluster-mosaic` behavior — see §5.1 type)
- Renders "+N more" cell when `shape.tag === 'grid-overflow'` (mobile 3×3 case)
- **aria-label single-observation case**: `"Single observation: Cooper's Hawk."` exactly when `totalCount === 1`
- **aria-label coincident-pair case**: `"2 coincident observations: <comName1> and <comName2>. Activate to zoom in."` exactly when `totalCount === 2` and `cols === 1`
- **aria-label grid case**: `"Cluster: 47 observations, 11 families. Activate to zoom in."` for any multi-cell grid
- **aria-label pill case**: identical-format label when `shape.tag === 'pill'`
- aria-describedby target exists for grids and pills, has at most 9 list items (8 families + "and N more")
- **Hit-extender overlay element has `tabIndex === -1`** (inherits the §4.7 contract — load-bearing, easy to silently break)
- Hit-extender overlay element has `getBoundingClientRect()` ≥ 44×44 (`pointer:fine`) or ≥ 48×48 (`pointer:coarse`)
- **Dark-mode badge contrast**: with `data-theme="dark"` applied, badge's `getComputedStyle().boxShadow` includes the 1px white stroke specified in §4.3
- **Notable indicator preserved (AC8, inherited from `StackedSilhouetteMarker.test.tsx:183-221`)**: a 1×1 grid for an `isNotable: true` leaf renders an amber `<circle>` ring inside the tile SVG; a non-notable leaf does NOT render the circle; the circle's DOM order precedes the halo path (z-order test)
- **Empty-catalogue render path**: when `silhouettesById` is empty (catalogue not loaded yet — distinct from "loaded but this family has no art"), the marker MUST NOT render as a 100%-fallback grid (visually indistinguishable from a real coverage gap). Spec choice: introduce a third `AdaptiveTile` variant `{ kind: 'pending'; familyCode; count }` for the catalogue-unloaded case, rendered as a skeleton/shimmer rather than the opacity-0.5 fallback. Test name: `"empty silhouette catalogue: renders skeleton, NOT a 100%-fallback grid"`

### E2E (`map-adaptive-grid.spec.ts`)

- AZ overview at z=8: at least one pill visible (Tucson hotspot)
- Zoom to z=12: at least one 4×4 grid visible
- Zoom to z=16: at least one 2×1 or 1×1 grid visible
- Pinch-zoom z=8 → z=15: no `auto-spider-leader-lines-layer` in rendered layer list; no `inStack`-keyed DOM attributes anywhere on the page
- No DOM `[data-fallback="true"]` in a count=1 1×1 (single-observation shouldn't be a fallback)
- Axe assertions on aria-describedby contents
- **Perf-budget regression assertion (Gate 1)**: wall-clock-based `performance.measure('mosaic-reconcile')` p99 < 16ms during a scripted pinch-zoom z=8 → z=15 at 390×844 with ≥ 344 seeded rows. **Gated by `process.env.CI_PERF_GATE`** and runs in a dedicated `.github/workflows/perf-gate.yml` workflow with a `runs-on: ubuntu-latest-4-cores` runner (or the smallest stable larger runner the project's plan supports). Wall-clock perf budgets on the default 2-vCPU runner are too flaky for the project's `retries: 0` policy.
- **DOM-marker-count regression assertion (Gate 2 in default CI)**: visible-marker count via `page.locator('[data-testid=adaptive-grid-marker], [data-testid=cluster-pill]').count()` ≤ 2500 at each canonical viewport. Deterministic counter, not wall-clock — safe in the default Mergify-gated `e2e` workflow.
- **Cache-hit-rate proxy assertion (alternative to wall-clock)**: instrumented counter via a test hook exposes `getClusterLeavesCallCount` per pinch-zoom session; asserts call count ≤ 2× the visible-cluster count over the entire gesture (i.e., cache hits dominate). Deterministic, safe in default CI.

## 8. Inherited and preserved behavior

The redesign deliberately preserves several pieces of today's UX that the surface area might otherwise sweep up:

- Fallback silhouettes (opacity 0.5) for families without Phylopic art
- ClusterPill tier visuals (`sky`/`sand`/`ember`)
- Map skip-link routing keyboard Tab traffic to FeedSurface
- Hit-layer `tabIndex={-1}` contract
- MutationObserver on `[data-theme]` for basemap style change
- Light + dark theme parity

## 9. Risks and open questions

### Resolved during brainstorm

| Risk | Resolution |
|---|---|
| Per-cell tap targets create AC surface explosion | Whole marker is one tap target |
| Null-return sentinel from `pickGridShape` | Use discriminated union `{tag:'grid'} \| {tag:'pill'}` |
| Tap-routing logic in display component | Parent (MapCanvas) routes; marker stays pure |
| WCAG 2.5.5 at 28×28 | Hit-extender overlay at 44/48 |
| Badge contrast in dark mode | 1px white box-shadow stroke |
| 16-cell aria-label too long | Two-tier disclosure with visually-hidden `<ul>` (max 8 items + "N more") |
| SR disambiguation loss from spider deletion | Coincident-pairs get rich label naming both species |
| Mobile grid overlap | 3×3 cap at ≤480px |

### Open — deferred to plan body

| Risk | Where it gets answered |
|---|---|
| `clusterMaxZoom=22` perf cost (supercluster init, DOM marker count) | Prototype phase, §10 Gate 1 and Gate 2 |
| Effect-deps audit at `MapCanvas.tsx:760` | Plan body implementation task |
| Supercluster's 1-point-cluster edge case (does it emit `point_count=1` clusters or fall back to raw points at max zoom?) | Prototype phase, documented learning |

### Tier-2 refactors

*Tier-2* here means: real but not gating the prototype gate or first ship. Land in this work if convenient, otherwise file as follow-ups.

- Add a `useMediaQuery('(pointer: coarse)')` hook if one doesn't exist (the hit-layer already needs it)
- Add a `useMediaQuery('(max-width: 480px)')` hook for the mobile 3×3 cap

## 10. Prototype-phase gates

Per `CLAUDE.md`'s Prototype Gate convention, the plan body cannot be authored until all four gates pass on a working prototype.

### Gate 1 · Reconcile time (perf)

Instrument `performance.mark` brackets around the `mosaics` state update in `MapCanvas.tsx:716` and `performance.measure` between them.

- **Pass**: p99 measure duration < 16ms (one frame budget) at 390×844 with ≥ 344 canned rows during a pinch-zoom from z=8 → z=15.
- **Fail**: reduce `clusterMaxZoom` cap, or tighten the observation-count pill threshold below 64.

### Gate 2 · DOM-marker ceiling (perf, NEW)

`observation-layers.ts:163` carries an explicit comment that "HTML markers don't scale beyond ~5k visible (DOM perf)."

- **Pass**: ≤ 2,500 visible markers at each canonical viewport (5 viewports × 2 themes = 10 captures). 50% safety margin against the documented ceiling.
- **Fail**: tighten observation-count or unique-family thresholds, or re-evaluate `clusterMaxZoom` cap.

### Gate 3 · Hit-target size (a11y)

- **Pass**: `getBoundingClientRect()` of every `[data-testid=adaptive-grid-marker]`'s overlay element is ≥ 44×44 on `pointer:fine` and ≥ 48×48 on `pointer:coarse`, asserted in e2e.
- **Fail**: hit-extender CSS is wrong; fix and re-measure.

### Gate 4 · Console hygiene (CLAUDE.md)

- **Pass**: 0 errors and 0 warnings via `browser_console_messages` at every canonical viewport, during pan and pinch-zoom, light and dark themes.
- **Fail**: dirty console is a Tier-1 reviewer finding regardless of cause.

## 11. Sequencing

After all four gates pass on the prototype:

1. The plan body (`docs/plans/<date>-adaptive-cluster-grid.md`) is authored via `superpowers:writing-plans`.
2. The plan is decomposed into independent PRs at the right level of CI gate granularity (per `feedback_plan_ci_coupling`). Likely structure:
   - **PR1** — Add `adaptive-grid.ts` + `AdaptiveGridMarker.tsx` behind a feature flag (default off). Add the new unit + component tests. No `MapCanvas.tsx` wiring yet. CI green throughout — the new code is unreachable without the flag.
   - **PR2** — Atomically: flip the flag default to on, wire `AdaptiveGridMarker` into `MapCanvas.tsx`, delete the auto-spider subsystem (use-auto-spider, stack-fanout, fan-layout, leader-lines layer, StackedSilhouetteMarker), AND delete the legacy mosaic files (`MosaicMarker.tsx`, `cluster-mosaic.ts` + their tests, `map-stack-fanout.spec.ts`). Single PR because splitting it leaves an intermediate state where `cluster-mosaic.ts`'s `aggregateClusterFamilies` export is dead — knip fires and blocks the Mergify queue.
   - **PR3** — Documentation + spec linkbacks. Update `docs/specs/2026-04-16-bird-watch-design.md §Frontend` to reference this design.
3. Each PR follows the project's PR workflow (`pr-workflow` skill) and passes the canonical 5-viewport × 2-theme screenshot capture (`pr-screenshots-via-user-attachments`).
4. Bot review via `julianken-bot` subagent before queueing.

## 12. References

- Investigation findings (live visual, code, density): conducted 2026-05-14, summarized in the brainstorming session that produced this spec
- Three specialist critique passes (React, perf, a11y): all returned REVISE; findings folded in
- Validation pass (cross-tier React specialist): confirmed 7/9 findings, identified 1 overstatement (P3) and 1 missing blocker (P4 — 5k DOM ceiling, now Gate 2)
- Existing visual companion mockups: `.superpowers/brainstorm/9350-1778805841/content/` (gitignored)
- Related prior plan: `docs/plans/2026-04-26-spider-v2/` (the deletion of click-driven spidering #280)
- Architecture spec: `docs/specs/2026-04-16-bird-watch-design.md` §Frontend
- Token mapping (relevant to badge/tile colors): `docs/specs/2026-05-09-v3-token-mapping.md`
