# Cell species popover — design

Per-cell hover preview + click popover that reveals the species composition behind each adaptive-grid family cell. Click on a species row navigates to the existing `SpeciesDetailSurface` via the `?detail=<speciesCode>` URL param. Mobile collapses the per-cell affordance into a single cluster-level list popover. Pill click behavior is preserved (zoom to expansion).

Status: **brainstorming complete; plan-body authorship pending issue triage + PR #555 merge**.

## 1. Background

### What exists today

- `frontend/src/components/map/AdaptiveGridMarker.tsx` renders 1×1 to 4×4 silhouette grids; each cell is a `<TileCell>` displaying one family's silhouette + an optional count badge.
- The whole marker is **one tap target** (spec `docs/specs/2026-05-14-adaptive-cluster-grid-design.md` §2 explicit non-goal: per-cell tap targets). Click anywhere on a grid marker → `easeTo(anchor.lngLat, max(memberIds.expansionZoom))`.
- Per-family aggregation in `frontend/src/components/map/adaptive-grid.ts:151` (`aggregateClusterFamilies`) collapses leaves to `{familyCode, count}`; species-level detail is dropped.
- `SpeciesDetailSurface` is reached via `onSelectSpecies(speciesCode)` (`frontend/src/App.tsx:218-219`) — global view of one species (recent obs across all of AZ, no spatial filter).
- URL state managed by `useUrlState` with shape `{view, detail}` where `view='detail'` triggers the species surface.

### Why this is wrong now

Users have no way to see WHICH species drive a family cell's count. A "Tyrant Flycatchers (47)" cell could be 47 Black Phoebes OR 12 species in equal proportion — the badge can't say. Clicking a marker zooms (loses context) but doesn't drill into the family. Reaching SpeciesDetailSurface from a map cluster requires a 3+ step path through the species view; there is no direct cluster → species drilldown.

### User-provided constraints

From the 2026-05-15 brainstorm session:

1. **Hover on a cell reveals its species breakdown.** Example: hover a 3-Hummingbird cell → tooltip shows "2× Anna's Hummingbird, 1× Costa's Hummingbird".
2. **Click on a cluster cell opens a popover for THAT cell** — does NOT zoom. (Pills still zoom; pill click handler unchanged.)
3. **Click on a species row navigates to SpeciesDetailSurface.** Routing is via the existing `?detail=<speciesCode>` URL param. (An earlier draft scoped the detail surface to the cluster's bounding box via a `?bbox=` query param; that path was never wired up and has since been removed — see §4.9.)
4. **No zoom-in path from grids is required.** Existing MapLibre zoom controls (pinch, scroll, +/- buttons) are sufficient.

## 2. Goals · Non-goals

**Goals**

1. Surface per-cell species composition with `count × comName` rows.
2. Hover = lightweight preview; click = full popover with clickable species links.
3. Mobile (≤ 480 px viewport) gets a single cluster-level list popover instead of per-cell affordances (WCAG 2.5.5 sidestep — see §4.6).
4. Clicking a species row navigates to `SpeciesDetailSurface` via the existing `?detail=<speciesCode>` URL param.
5. Preserve existing single-leaf (`point_count === 1`) tap-to-obs UX.
6. Preserve existing pill click → zoom behavior.
7. Preserve existing aria-describedby family list (spec §4.6) — popover augments, doesn't replace.

**Non-goals**

- Per-cell tap zones on mobile. The whole-marker tap → cluster list path stays the mobile interaction.
- New visual changes to the adaptive grid cells themselves (size, color, silhouette rendering all unchanged).
- A "zoom into cluster" affordance inside the popover. Existing MapLibre zoom controls are sufficient.
- Changes to the `onSelectSpecies(speciesCode)` signature. It stays single-arg; the popover calls it with just the species code.
- Deconflict layer changes (issue #554). The popover renders OVER the deconflict-resolved marker positions; no geometry tension.
- **Telemetry / analytics events on cell hover or click.** Out of scope; the project has no analytics surface today; a separate effort owns that decision.
- **SSR / no-JS rendering of the popover.** bird-maps.com is statically hosted with JS required for the map; the existing aria-describedby family-list `<ul>` (preserved per §8) remains the JS-off fallback.
- **RTL script handling for hybrid taxa with non-Latin `comName`.** eBird emits some non-Latin script for international hybrids (rare in AZ-scope data); the spec uses LTR defaults. RTL handling is a future cross-cutting concern, not this feature.
- **Print / PDF rendering.** The popover is an overlay; it does not survive `window.print()`. Not addressed.

## 3. Decision summary

Locked during the 2026-05-15 brainstorm:

| Decision | Choice | Notes |
|---|---|---|
| Species cap per cell | Top 8 + "and N more" footer | At AZ scale, ~50 distinct species possible in pathological cells (tyrant flycatchers in migration); 8 is the bounded fit. |
| Trigger surface (desktop) | Hover + keyboard focus + touch tap on cells | Per-cell tap reverses spec §2's non-goal. Reconciled via §4.6 below. |
| Trigger surface (mobile) | Whole-marker tap → cluster list popover | Sidesteps WCAG 2.5.5 — 22×22 cells fail; mobile gets a single 48×48 tap surface. |
| Hover preview vs click popover | Different content | Preview = top 3, no links, "click for more" footer. Click popover = top 8 + links. Two components. |
| Species link target | `SpeciesDetailSurface` via existing `?detail=<speciesCode>` | Routes through the existing detail param; no new query param. (The brainstorm originally proposed a `bbox` URL param to scope the surface; that path was never wired and was removed — see §4.9.) |
| Spuh/slash observation handling | Render every row; link conditional on `speciesCode !== null` | No numeric gaps; non-clickable rows render as plain text. |
| Cluster zoom path from grids | None (intentional) | User waives — existing MapLibre zoom controls are sufficient. |
| Pill click | Unchanged (zoom to expansion) | |

## 4. Design

### 4.1 Data shape

`AdaptiveTile` gains a `species` field on all three variants. Existing fields preserved verbatim.

```ts
export interface SpeciesAggregate {
  /** Common name — display string AND grouping key. Always present per eBird API contract. */
  comName: string;
  /** eBird 6-char code. `null` for some spuh/slash/hybrid taxa where eBird returns no code. */
  speciesCode: string | null;
  /** Observations of this taxon in this cluster. */
  count: number;
}

export type AdaptiveTile =
  | { kind: 'rendered'; familyCode: string; svgData: string; color: string;
      count: number; species: ReadonlyArray<SpeciesAggregate> }
  | { kind: 'fallback'; familyCode: string; color: string;
      count: number; species: ReadonlyArray<SpeciesAggregate> }
  | { kind: 'pending';  familyCode: string;
      count: number; species: ReadonlyArray<SpeciesAggregate> };
```

**Invariant**: `sum(tile.species[].count) === tile.count` — the popover's family header total reconciles to the badge.

### 4.2 New aggregator

```ts
export function aggregateClusterSpecies(
  leaves: ClusterLeafFeature[],
): Map<string /* familyCode */, ReadonlyArray<SpeciesAggregate>>;
```

Behavior:

- Group leaves by `comName` within each `familyCode`. `comName` is the visible identifier; `speciesCode` may collide across spuh/slash entries but `comName` does not.
- Sort within each family: descending count, ascending `comName` (tie-break for stable render order — matches existing `aggregateClusterFamilies` pattern at `adaptive-grid.ts:151-166`).
- Drop leaves with `familyCode === null` (cannot bucket into a tile cell).
- Preserve leaves with `speciesCode === null` (the row renders; link is conditionally disabled — see §4.4).

### 4.3 Tile builder integration

`buildAdaptiveTiles` (`adaptive-grid.ts:185`) runs both aggregators and threads the right species slice onto each tile:

```ts
const families = aggregateClusterFamilies(leaves);
const speciesByFamily = aggregateClusterSpecies(leaves);
const visible = families.slice(0, visibleCapacity(shape));
return visible.map((fam): AdaptiveTile => {
  const speciesForFam = speciesByFamily.get(fam.familyCode) ?? [];
  // ... existing variant resolution (rendered / fallback / pending) ...
  // species: speciesForFam is threaded onto the returned tile.
});
```

The empty-array fallback handles the theoretically-impossible case of "family present but no species" — defensive against future schema drift.

### 4.4 Components

| Component | Status | Role |
|---|---|---|
| `<CellHoverPreview>` | NEW | Compact `role="tooltip"` element. Top 3 species, no links, footer reads "Click for more". |
| `<CellPopover>` | NEW | Non-modal `role="dialog"`. Family header + top 8 species + "…and N more" footer + clickable species rows (only when `speciesCode !== null`). Footer text reads "Click or tap for full list" — never "Click for more" (tap on hybrid laptops triggers the same popover the click does, so the imperative reads correctly in both input modes). |
| `<ClusterListPopover>` | NEW | Mobile-only. `role="dialog"`. Collapsible family sections, top 8 species per family, "Done" button bottom. |
| `<TileCell>` | EXTENDED | Desktop: hover/focus/click handlers + ARIA wiring. Mobile: visual only. |
| `<AdaptiveGridMarker>` | EXTENDED | Mobile outer-button tap opens `<ClusterListPopover>`. Desktop outer-button click is a no-op (cells handle their own clicks). |
| `<SpeciesDetailSurface>` | UNCHANGED | Reached via `?detail=<speciesCode>`; keeps its existing `{ speciesCode, apiClient }` props (see §5.4). |

### 4.5 Trigger surface

**Desktop (viewport > 480 px, `pointer:fine`)**:

| Surface | Action | UI |
|---|---|---|
| `<TileCell>` mouseenter | show preview | `<CellHoverPreview>` positioned below cell, smart-flips above if no room |
| `<TileCell>` mouseleave | dismiss after 250 ms | unless click-promoted; 250 ms allows mouse-to-popover travel |
| `<TileCell>` click / Enter / Space | promote preview to popover | `<CellPopover>` pinned; preview dismissed |
| `<TileCell>` focus (keyboard) | show preview | identical to mouseenter |
| `<TileCell>` blur (keyboard) | dismiss | unless click-promoted |
| Popover ESC / click-outside | dismiss popover | focus returns to triggering `<TileCell>` |

**Mobile / coarse-pointer (`pointer:coarse` regardless of viewport width)**:

Partition predicate is `pointer:coarse` ALONE — not viewport width. iPad portrait (768×1024), large Android tablets, and any device whose primary pointer is touch get the cluster-list popover. Hybrid devices that report `pointer:fine` AND `pointer:coarse` use the FIRST listed `(pointer:fine)` matcher (`window.matchMedia('(pointer: fine)').matches === true` → desktop path). This guarantees iPad portrait (a canonical viewport per `CLAUDE.md`) gets the popover that survives WCAG 2.5.5, and no tablet falls into the broken 22×22-tap-target gap.


| Surface | Action | UI |
|---|---|---|
| `<AdaptiveGridMarker>` outer button tap | open cluster list | `<ClusterListPopover>` slides up from the marker |
| Popover ESC / tap-outside / "Done" button | dismiss popover | focus returns to outer button |

### 4.6 Spec §2 (per-cell tap targets non-goal) reconciliation

The original `docs/specs/2026-05-14-adaptive-cluster-grid-design.md` §2 declared "Per-cell tap targets" a non-goal. This spec REVERSES that on **pointer:fine devices only**:

- pointer:fine (mouse, fine touchpad): per-cell click/hover/focus targets at 22×22 native. WCAG 2.5.5 (44×44 min) applies to *pointer activation targets* but excludes pointer:fine — confirmed by W3C WCAG 2.2 Understanding doc §2.5.5. Hover and keyboard focus surfaces are not gated by 2.5.5.
- pointer:coarse: per-cell tap targets are NOT exposed. The whole-marker tap → cluster list popover preserves the spec §2 non-goal on touch devices.

**Hit-extender overlay change (load-bearing)**: the existing `<span data-testid="adaptive-grid-marker-hit">` at `AdaptiveGridMarker.tsx:154-159` currently sets `pointerEvents: 'auto'` and sits BEFORE the grid `<div>` in DOM order with `position: absolute`. On `pointer:fine` it will intercept every cell click. The fix is mechanical and explicit: when `isCoarsePointer === false`, set the overlay's inline style to `pointerEvents: 'none'`. The overlay stays in place for layout-extending purposes but stops eating events; clicks fall through to the grid, where each cell's own `<button>` is the target. On `pointer:coarse` the overlay keeps `pointerEvents: 'auto'` so the whole-marker tap still resolves to the marker root. This is a one-line ternary inside `hitOverlayStyle`.

### 4.7 Keyboard model (desktop)

The existing `tabIndex={-1}` on the outer marker button stays (prior spec §4.7 — skip-link → FeedSurface remains the global keyboard path). Per-cell focusability is **opt-in via a dedicated keyboard entry point**:

**Keyboard entry point (CONCRETE)**: A new skip-link inside `MapSurface` — "Explore map markers" — appears immediately after the existing "Skip to species list" skip-link. Activating it sets focus to the FIRST currently-rendered `<TileCell>` (top-left cell of the first marker in the viewport, ordered by `groups[0].anchor.px`). Cells become temporarily focusable (`tabIndex={0}`) for the duration of the keyboard session. The skip-link is visually hidden by default and revealed on focus per the existing skip-link convention in `frontend/src/styles.css`. This is the ONLY new globally Tab-reachable affordance the feature adds. **Empty-viewport state**: when `groups.length === 0` (zoomed out beyond data, hydrating, error state), the skip-link is suppressed via `aria-hidden="true"` AND removed from tab order (`tabIndex={-1}`) so it cannot be focused into a no-op state.

After the entry point activates, a roving-tabindex pattern applies:

- Default: cells `tabIndex={-1}`, marker `tabIndex={-1}`. Global Tab order untouched.
- On entry via the new skip-link OR on outer-marker `mouseenter`: cells in the FOCUSED marker flip to `tabIndex={0}` (roving). Arrow keys move focus between cells (arrow-key direction order — row-major vs column-major — deferred to plan body; not load-bearing). Each focus shows the hover preview. Tab moves to the next marker's first cell; Shift+Tab to the previous marker's last cell.
- On `mouseleave` AND 30 s of no cell-focus activity (BOTH conditions): cells revert to `tabIndex={-1}` and the keyboard session ends.
- On ESC during preview: dismisses preview but keeps cell focusable. On ESC during popover: dismisses popover, focus returns to the cell, cell remains focusable.
- On Esc when no preview/popover is open: ends the keyboard session immediately; focus returns to the skip-link.

### 4.8 ARIA pattern

| | `<CellHoverPreview>` | `<CellPopover>` | `<ClusterListPopover>` |
|---|---|---|---|
| `role` | `tooltip` | `dialog` (non-modal) | `dialog` (non-modal) |
| Trigger wiring | `aria-describedby` on `<TileCell>` → preview id (ONLY this id; cells do NOT inherit the outer marker's describedby) | `aria-haspopup="dialog"` + `aria-expanded={isOpen}` on `<TileCell>` (the cell, not the marker) | Same as `<CellPopover>` but on outer `<AdaptiveGridMarker>` button |
| Labeling | `<TileCell>` `aria-label` is its OWN accessible name (e.g., "Hummingbirds, 8 observations"). The outer marker's `aria-describedby` family-list stays on the OUTER button — cells do not inherit it. | `aria-labelledby` → popover heading | `aria-labelledby` → popover heading ("Cluster: N obs, M families") |
| Focus management | None (tooltips don't take focus) | Focus moves to popover heading on open; ESC returns to `<TileCell>` | Focus moves to "Done" button on open; ESC / "Done" returns to outer button |
| WCAG 1.4.13 dismissible | Yes — ESC dismisses preview without moving the pointer | N/A | N/A |

**Preserved (no change)**: the existing `aria-describedby` family-list `<ul>` on the outer marker (prior spec §4.6) is unchanged. Screen-reader users who never engage with a cell still get the family enumeration. The new popover is supplementary per WCAG 1.3.1.

**ARIA tree on focused cell** (concrete — pinned by test in §7):

```
<button class="adaptive-grid-marker" tabIndex={-1}
        aria-label="Cluster: 47 observations, 11 families. Activate to zoom in."
        aria-describedby="marker-{id}-families">       ← outer; existing
  <ul id="marker-{id}-families" class="sr-only">…</ul> ← family list; existing
  <div class="adaptive-grid-marker__grid">
    <button class="adaptive-grid-marker__cell" tabIndex={0}     ← cell; NEW focusability
            aria-label="Hummingbirds, 8 observations"
            aria-describedby="cell-{id}-{familyCode}-preview"   ← cell's OWN describedby
            aria-haspopup="dialog"
            aria-expanded={isPopoverOpen}>
      {silhouette + badge}
    </button>
    {/* additional cells */}
  </div>
</button>
<div role="tooltip" id="cell-{id}-{familyCode}-preview">…</div>  ← preview; NEW
```

SR announcement on cell focus: `"Hummingbirds, 8 observations. <preview-content>. Has popup dialog."`. The outer marker's `aria-describedby` does NOT propagate to the cell (cells set their own `aria-describedby` which takes precedence in this scope).

### 4.9 Routing + URL state

Clicking a species row navigates to the species detail surface via the existing
`?detail=<speciesCode>` URL param — no new query param.

```
?detail=<speciesCode>
```

**`onSelectSpecies` signature** (single-arg):

```ts
const onSelectSpecies = useCallback(
  (speciesCode: string) => set({ detail: speciesCode }),
  [set],
);
```

- The popover species link calls `onSelectSpecies(speciesCode)`; App writes only
  `?detail=`. The detail rail/sheet renders in place over the still-mounted map
  (#663) — no `?view=detail` write; backward-compat with legacy `?view=detail`
  deep-links is handled in `useUrlState`.
- All callsites are single-arg; there is no second argument.

> **Removed (dead):** an earlier Phase-3 draft routed a `bbox` URL param
> (`?bbox=<minLng>,<minLat>,<maxLng>,<maxLat>`) to filter the detail surface's
> observation list and render a "Filtered to selected area / View all
> observations" banner. The banner's `observations` prop was never populated by
> any wrapper, so it always read "0 observations" and the list never rendered;
> the `?bbox=` param had no consumer beyond that dead banner (it never touched
> the map camera or the `/api/observations` fetch). The whole path —
> `?bbox=` parse/serialize, the `BBox` type, `getClusterBbox`, the banner, and
> the observation list — was removed (tracker #568). The separate viewport
> `/api/observations` bbox filter (`debouncedBbox`) and the state-camera
> envelope (`StateSummary.bbox`) are unrelated and remain.

### 4.10 Single-leaf preservation

When the cluster's `point_count === 1` (1×1 grid, count=1, the single-leaf path):

- Outer-button click bypasses the cell-popover path entirely.
- Opens the obs popover directly via `setSelectedObs(obs)` (matches existing `handleGroupClick` single-leaf branch at `MapCanvas.tsx:1213-1224`).
- No regression to the existing one-tap-to-obs UX.

**This path applies equally to anchored AND displaced single-leaf markers.** The silhouette-displacement layer (#554) renders displaced single-observation silhouettes as separate `<PresentationMarker>` floats with inline SVG (`MapCanvas.tsx:~1462`). Those floats inherit the single-leaf path: their click opens the obs popover, not a cell popover. Displaced silhouettes do NOT participate in the per-cell hover/popover affordances introduced by this spec — they have no grid cells to host them.

### 4.11 Spuh / slash / hybrid handling

eBird returns several non-species taxa, each with a `comName` but variable `speciesCode`:

| Taxon type | Example `comName` | `speciesCode` |
|---|---|---|
| Species | "Cooper's Hawk" | `coohaw` |
| Spuh | "Sandpiper sp." | spuh code (e.g. `sandpip`) or null |
| Slash | "Cooper's/Sharp-shinned Hawk" | slash code or null |
| Hybrid | "Mallard × American Black Duck" | hybrid code or null |

Behavior:

- All four render as rows in `<CellHoverPreview>` / `<CellPopover>` / `<ClusterListPopover>`.
- `speciesCode !== null` → row renders as `<a>` (or `<button>`) linking to `SpeciesDetailSurface` via `?detail=<speciesCode>`.
- `speciesCode === null` → row renders as plain `<span>`. SR announces "12 Sandpiper sp." without a "Link" suffix, signaling the row is unactionable.
- Counts always reconcile: `sum(species[].count) === tile.count`.

## 5. Component API

### 5.1 `<CellHoverPreview>`

```ts
interface CellHoverPreviewProps {
  /** Family code for the cell. Used for the header (display name resolved via `prettyFamily`). */
  familyCode: string;
  /** Total observations of this family in the cluster (matches the badge). */
  familyCount: number;
  /** Species in descending count order. Capped at 3 by the consumer. */
  species: ReadonlyArray<SpeciesAggregate>;
  /** Anchor element for positioning. */
  anchorEl: HTMLElement;
  /** Optional id used by the trigger's `aria-describedby`. */
  id?: string;
}
```

### 5.2 `<CellPopover>`

```ts
interface CellPopoverProps {
  familyCode: string;
  familyCount: number;
  /** All species for this family (consumer slices to top 8 + computes "and N more"). */
  species: ReadonlyArray<SpeciesAggregate>;
  /** Anchor element for positioning. */
  anchorEl: HTMLElement;
  /** Invoked when user dismisses (ESC, click-outside, blur out). */
  onDismiss: () => void;
  /** Invoked when user clicks a species row. Calls `onSelectSpecies(speciesCode)`. */
  onSelectSpecies: (speciesCode: string) => void;
}
```

### 5.3 `<ClusterListPopover>`

```ts
interface ClusterListPopoverProps {
  /** All families in the cluster, sorted by `aggregateClusterFamilies`. */
  families: ReadonlyArray<FamilyAggregate>;
  /** Species lookup keyed by familyCode. */
  speciesByFamily: ReadonlyMap<string, ReadonlyArray<SpeciesAggregate>>;
  /** Total point_count for the cluster header. */
  totalCount: number;
  /** Total unique families for the cluster header. */
  uniqueFamilies: number;
  onDismiss: () => void;
  onSelectSpecies: (speciesCode: string) => void;
}
```

### 5.4 `<SpeciesDetailSurface>`

No extension. The species link routes via `?detail=<speciesCode>` only;
`<SpeciesDetailSurface>` keeps its existing `{ speciesCode, apiClient }` props.

> **Removed (dead):** an earlier draft added a `bbox?: BBox | null` prop that
> filtered the observation list and rendered a "Filtered to selected area"
> banner. The prop was never populated by any wrapper and the whole path was
> removed (tracker #568) — see the §4.9 note.

## 6. File map

### New (7)

| File | Purpose |
|---|---|
| `frontend/src/components/map/CellHoverPreview.tsx` | Hover preview component |
| `frontend/src/components/map/CellHoverPreview.test.tsx` | Unit tests (top-3 cap, role=tooltip, dismiss timing) |
| `frontend/src/components/map/CellPopover.tsx` | Click popover component |
| `frontend/src/components/map/CellPopover.test.tsx` | Unit tests (top-8 cap, links conditional on speciesCode, focus management, ESC dismiss) |
| `frontend/src/components/map/ClusterListPopover.tsx` | Mobile cluster list popover |
| `frontend/src/components/map/ClusterListPopover.test.tsx` | Unit tests (sheet shape, collapsible families, focus trap, "Done" return) |
| `frontend/e2e/map-cell-popover.spec.ts` | E2E for desktop + mobile flows + species-link navigation |

### Modified (4)

| File | Changes |
|---|---|
| `frontend/src/components/map/adaptive-grid.ts` | Add `SpeciesAggregate` type, `aggregateClusterSpecies(leaves)`, thread species onto `AdaptiveTile`. Existing function signatures preserved. |
| `frontend/src/components/map/AdaptiveGridMarker.tsx` | Extend `<TileCell>` with hover/focus/click handlers (desktop). Extend outer button to open `<ClusterListPopover>` on mobile. Wire ARIA roles. |
| `frontend/src/components/map/MapCanvas.tsx` | Wire `onSelectSpecies(code)` through to App via the existing single-arg prop. |
| `frontend/src/App.tsx` | `onSelectSpecies(speciesCode)` writes `?detail=` via `useUrlState`. |
| `frontend/src/components/SpeciesDetailSurface.tsx` | Unchanged props (`{ speciesCode, apiClient }`); renders the species detail body. |

### Kept

| File | Why |
|---|---|
| `frontend/src/components/map/deconflict.ts` + tests | Cluster geometry / displacement is orthogonal to popover behavior. |
| `frontend/src/components/map/ClusterPill.tsx` + tests | Pill click handler unchanged (still zoom). |
| `frontend/src/components/map/observation-layers.ts` | Layer specs unchanged. |
| `frontend/e2e/marker-overlap.spec.ts` (#554) | Pairwise overlap test unchanged; popover renders OVER markers, not as a marker. |

## 7. Test strategy

### Unit (`adaptive-grid.test.ts`)

New tests for `aggregateClusterSpecies`:

- Groups leaves by `comName` within `familyCode`; sort descending count, ascending comName.
- Null `familyCode` leaves are dropped; null `speciesCode` leaves are preserved with `speciesCode: null`.
- Count reconciliation: `sum(species[].count) === aggregateClusterFamilies()[i].count` for every family.
- Multiple slash/spuh entries with same `comName` merge into one row (count summed).
- Empty leaves → empty map.

### Component (`CellHoverPreview.test.tsx`)

- Renders top 3 species in descending count order; ignores any beyond top 3.
- `role="tooltip"` set; element has the expected `id`.
- Footer reads "Click for more" only when family has > 3 species; absent otherwise.
- `prefers-reduced-motion: reduce` disables fade animation (instant show/hide).
- Forced-colors mode uses `ButtonText` / `ButtonBorder` per `styles.css:1747` pattern.

### Component (`CellPopover.test.tsx`)

- Renders top 8 species; "…and N more species" footer shows N when family has > 8 species; absent when ≤ 8.
- Clickable rows have `role="link"` and resolve `speciesCode !== null`; rows with `speciesCode === null` render as `<span>` with no link.
- Clicking a clickable row calls `onSelectSpecies(speciesCode)`.
- ESC dismisses; focus returns to the triggering `<TileCell>`.
- `aria-labelledby` resolves to the popover heading element.
- Family count `(47)` reconciles to `sum(species[].count)` (visually + via test assertion).

### Component (`ClusterListPopover.test.tsx`)

- Renders all families from the cluster; family rows are collapsible (initially top 2 families expanded, rest collapsed).
- Top 8 species per family when expanded; "and N more" footer when > 8.
- "Done" button + ESC dismisses; focus returns to the outer marker button.
- Focus trap inside the popover while open (Tab/Shift+Tab cycles within).

### Component (`AdaptiveGridMarker.test.tsx`) — extensions

- Desktop (mocked `matchMedia('(pointer: fine)')` → true): per-cell mouseenter triggers `<CellHoverPreview>` with the expected `species` slice.
- Mobile/coarse (mocked `(pointer: coarse)` → true): outer-button tap opens `<ClusterListPopover>`; per-cell handlers are NOT attached.
- Single-leaf cluster (`point_count === 1`): outer-button click opens obs popover (existing path), NOT the cell popover.
- **Hit-extender pointer-events on `pointer:fine`**: inspect the rendered hit-overlay's computed `pointer-events` style — must be `'none'`. On `pointer:coarse` must be `'auto'`. Locks the §4.6 reconciliation in code.
- **ARIA tree snapshot on focused cell**: render the marker, focus a cell, snapshot the rendered DOM tree, assert (1) cell has its own `aria-describedby` (preview id), NOT the outer marker's family-list id; (2) cell has `aria-haspopup="dialog"` and `aria-expanded="false"` initially; (3) outer marker's `aria-describedby` still points at the family-list `<ul>`.

### E2E (`map-cell-popover.spec.ts`)

- **Desktop @ 1440×900**: hover the Tucson Hummingbirds cell → preview shows top 3 species; click promotes to popover; click "Anna's Hummingbird" → URL changes to `?detail=anhumm`; SpeciesDetailSurface renders.
- **Desktop keyboard**: activate the new "Explore map markers" skip-link → focus lands on the first cell; preview appears on focus; Enter opens popover; ESC dismisses; focus returns to cell. Arrow keys move focus between cells; Tab moves to the next marker's first cell.
- **Tablet @ 768×1024 (`pointer:coarse`)**: tap marker → cluster list popover slides up (NOT per-cell — confirms the `pointer:coarse` partition).
- **Mobile @ 390×844**: tap marker → cluster list popover slides up; expand "Tyrant Flycatchers"; tap "Black Phoebe" → URL changes to `?detail=<code>` and SpeciesDetailSurface renders; tap "Done" returns to map.
- **Smart-flip positioning at viewport edge**: position a marker so its preview would clip the bottom of the viewport; assert the preview renders ABOVE the cell instead of below. Mirror test for top/left/right.
- **Popover-vs-marker overlap**: extend the #554 falsifiable test to assert popovers don't overlap any cluster marker when open.

## 8. Inherited and preserved behavior

- Spec `docs/specs/2026-05-14-adaptive-cluster-grid-design.md` §4.5 single-leaf path (`point_count === 1` → obs popover) preserved.
- Spec §4.6 aria-describedby family-list `<ul>` preserved verbatim — popover augments, doesn't replace.
- Spec §4.7 outer-marker `tabIndex={-1}` preserved as default — per-cell focus is opt-in via interaction.
- Pill click handler (zoom to expansion) unchanged.
- Deconflict layer (#554) unchanged.
- Light + dark theme parity; reduced-motion + forced-colors handling.
- `MapMarkerHitLayer` (the hit overlay for unclustered observations at high zoom) unchanged.

## 9. Risks and open questions

### Resolved during brainstorm

| Risk | Resolution |
|---|---|
| Spec §2 (per-cell tap targets non-goal) | Reversed on `pointer:fine` only; `pointer:coarse` preserves the non-goal via cluster-list popover. |
| WCAG 2.5.5 on 22×22 cells | `pointer:fine` is excluded from 2.5.5; coarse uses 48×48 whole-marker tap. |
| Spuh/slash observations creating numeric gaps | Render every row; conditional link. Counts reconcile. |
| Spec §4.7 keyboard skip-link convention | Dedicated "Explore map markers" skip-link entry point + opt-in roving tabindex on cells. Global Tab order gains exactly one new item. |
| Hover "gap" between cell and preview | 250 ms mouseleave delay allows mouse-to-popover travel. |
| Touch-device hover discoverability | Coarse pointer has no hover; cluster-list popover replaces it with a tap-driven flow. |

### Resolved during 2026-05-15 critique pass

| Risk | Resolution |
|---|---|
| Hit-extender overlay swallowing cell clicks on `pointer:fine` | `pointerEvents: 'none'` on the overlay when `isCoarsePointer === false`. Test in `AdaptiveGridMarker.test.tsx` pins it. |
| ARIA describedby composition ambiguity | §4.8 specifies the exact tree on a focused cell; snapshot test pins it. |
| Mobile breakpoint missing iPad portrait | Partition predicate changed from `viewport ≤ 480 px` to `pointer:coarse`. iPad portrait now correctly gets cluster-list popover. |
| Keyboard entry to per-cell focus | Committed: new "Explore map markers" skip-link inside `MapSurface`. |
| Displaced-silhouette popover interaction | §4.10 extended: displaced single-leaf silhouettes inherit the single-leaf path (obs popover); no cell popover. |
| Hover-preview footer copy | Changed from "Click for more" to "Click or tap for full list". |
| Out-of-scope concerns (telemetry, SSR, RTL, print) | Enumerated as explicit non-goals in §2. |

### Open — deferred to plan body

| Risk | Where it gets answered |
|---|---|
| Per-cell positioning math at the edges of the viewport (smart-flip above/below) — Floating-UI dep or hand-rolled? | Plan body — recommend Floating-UI for the maintenance win |
| `<ClusterListPopover>` collapse-state persistence: do collapsed families stay collapsed across opens, or reset each time? | Plan body |
| Roving tabindex implementation: arrow-key navigation order (row-major vs column-major)? | Plan body |
| "First-load" race: a cell's `species` array may be empty if leaves haven't fully resolved. Render path? Skeleton row count? | Plan body |

### Tier-2 refactors

- Extract a `<Popover>` primitive in `frontend/src/components/ds/` to share infrastructure between `<CellPopover>` and `<ClusterListPopover>`. Both need focus management + positioning + dismiss logic. If a primitive doesn't exist after the spike, it should.
- Extract a `<SpeciesCount>` row primitive — used by hover preview, popover, AND `<ClusterListPopover>`. ~10 LOC each currently; shared row prevents drift in count formatting.

## 10. Sequencing

This spec gates Issue #556 (per the user's instruction to file an epic after spec approval). The implementation sequence under that epic is **4 phases** (parent-spec amend folded into Phase 3 per the 2026-05-15 bot-review pass on #556):

1. **Phase 0** — Data layer: `aggregateClusterSpecies` + `AdaptiveTile.species` thread + `speciesCode` propagation through `observationsToGeoJson` and `ClusterLeafFeature` + test-fixture updates + unit tests. CI green; no UI changes.
2. **Phase 1** — `<CellHoverPreview>` + `<CellPopover>` + `<TileCell>` desktop wiring + minimum-viable "Explore map markers" skip-link behind a feature flag (`VITE_FF_CELL_POPOVER`). Default off. Existing tests + new component tests all green.
3. **Phase 2** — `<ClusterListPopover>` + mobile wiring behind the same flag. Depends on Phase 1 (shared `AdaptiveGridMarker.tsx` mutations); ships AFTER Phase 1. Playwright config gains a `coarse-pointer` project for `pointer:coarse` media-query emulation.
4. **Phase 3** — species-row → `?detail=<speciesCode>` routing wired through `App` (single-arg `onSelectSpecies`) + full e2e spec + **atomic** flag flip + cleanup in one PR (matches PR #546's `VITE_FF_ADAPTIVE_GRID` precedent — deletes runtime branching alongside the env-default flip in `.env.example`) + spec amend to `docs/specs/2026-05-14-adaptive-cluster-grid-design.md` §2 reflecting the reversal. (The original plan added a `SpeciesDetailSurface` client-side `bbox` filter + `useUrlState` bbox here; that path was never wired and was removed — see §4.9.)

Each phase is its own PR. All 4 phases preserve the prototype-gate convention from `CLAUDE.md` (no UI changes commit without screenshots from the 5 canonical viewports × 2 themes).

## 11. References

- User brainstorm session: 2026-05-15, 6 decision points captured at `.superpowers/brainstorm/76416-1778888056/content/`
- Opus critique pass: 2026-05-15, 10 findings (1 BLOCKER, 4 IMPORTANT, 5 SUGGESTION), all folded into the §4 design or §9 resolved table.
- Related spec: `docs/specs/2026-05-14-adaptive-cluster-grid-design.md` (parent design)
- Related issue: #554 (deconflict layer — orthogonal but adjacent)
- Related PR: #555 (deconflict + silhouette displacement — queued via Mergify at the time of writing)
- WAI-ARIA tooltip pattern: https://www.w3.org/WAI/ARIA/apg/patterns/tooltip/
- WAI-ARIA dialog (non-modal) pattern: https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/
- WCAG 2.5.5 Target Size (Enhanced): https://www.w3.org/WAI/WCAG22/Understanding/target-size-enhanced.html
- WCAG 1.4.13 Content on Hover or Focus: https://www.w3.org/WAI/WCAG22/Understanding/content-on-hover-or-focus.html
