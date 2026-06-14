# Phase 3 — Map surface redesign

**Status:** Not yet planned.

**Plan:** to be written via `superpowers:writing-plans` — output to `docs/plans/2026-XX-XX-sky-atlas-phase-3-map-surface.md`.

## Goal

Land the Sky Atlas map surface — cluster pills replace solid circles, newspaper lede replaces the count subhead, FamilyLegend revised (collapsed-by-default on mobile), header + Attribution link + Filters trigger + theme toggle. The map is the home route; this surface is the front door.

## What ships

| Change | File |
|---|---|
| `<MapSurface>` rewrite to consume new chrome + primitives | `frontend/src/components/MapSurface.tsx` |
| Newspaper lede + filter sentence + freshness meta | `<MapSurface>` context strip |
| MapLibre cluster layer config consumes `cluster.ts` thresholds | `frontend/src/components/map/geometry/observation-layers.ts` |
| `<ClusterPill>` overlay rendered as React `<Marker>`s on top of MapLibre | `<MapSurface>` rendering branch |
| `<FamilyLegend>` revision — collapsed by default on mobile, shape-paired swatches | `frontend/src/components/FamilyLegend.tsx` |
| Header chrome rewrite (wordmark, nav, attribution, filters, theme toggle) | `frontend/src/App.tsx` or new `<AppHeader>` component |
| Map basemap swap on `[data-theme]` change (MutationObserver wires from Phase 1) | `frontend/src/components/map/MapCanvas.tsx` |

## Dependencies

- **Requires Phase 1** (tokens + theme mechanic).
- **Requires Phase 2** (`<ClusterPill>`, `<FilterSentence>`, family-palette config).

## Acceptance criteria

- Map renders both light and dark modes with correct token resolution.
- Cluster pills pass the new axe assertion (`role="img"` + `aria-label="{count} sightings"`).
- FamilyLegend on mobile is collapsed on first load and after localStorage clear (resolves analysis Theme 3 default-state issue).
- Lede displays the correct of 4 templates based on filter state; period clause drops on stale data.
- Filter trigger badge displays accurate count; `<FilterSentence>` mounts and shows active narrative below lede.
- Map basemap swap on theme toggle is smooth (no FOUC during MapLibre style reload).

## Implementation order (within phase)

1. Build header chrome and wire it into `<App>` — visible improvement on its own
2. Rewrite `<MapSurface>` context strip (lede + filter sentence + freshness)
3. Add `<ClusterPill>` overlay; suppress MapLibre's own cluster styling
4. Revise `<FamilyLegend>`: shape-paired swatches, mobile-collapsed default, localStorage migration
5. Wire basemap swap on theme change

Each step is its own commit on the same PR; CI green at each commit.

## What this phase does NOT include

- Detail surface (Phase 4)
- Feed / species surfaces (Phase 5)
- Voice / metadata (Phase 6)
- Cluster-manifest keyboard sidebar (deferred v1.1)
- Geolocation "near me" default (deferred v1.1)
- Dark basemap (gated on G8; if G8 fails, Phase 3 ships light-only with theme toggle disabled or hidden)

## Cross-references

- Spec: [`../01-spec/architecture.md`](../01-spec/architecture.md), [`../01-spec/voice-and-content.md`](../01-spec/voice-and-content.md), [`../01-spec/components.md`](../01-spec/components.md)
- Visuals: [`../04-visuals/map-desktop-pair.png`](../04-visuals/map-desktop-pair.png), [`../04-visuals/mobile-triplet.png`](../04-visuals/mobile-triplet.png)
- Critique loops K3 (FamilyLegend mobile default): [`../03-research/critique-loops-summary.md`](../03-research/critique-loops-summary.md)
- G7 family × basemap contrast: [`../01-spec/open-questions.md`](../01-spec/open-questions.md)
