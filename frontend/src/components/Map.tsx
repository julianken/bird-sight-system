import { useMemo } from 'react';
import type { Region as RegionT, Observation, Hotspot } from '@bird-watch/shared-types';
import { Region } from './Region.js';
import { HotspotDot } from './HotspotDot.js';

export interface MapProps {
  regions: RegionT[];
  observations: Observation[];
  hotspots: Hotspot[];
  expandedRegionId: string | null;
  selectedSpeciesCode: string | null;
  onSelectRegion: (id: string | null) => void;
  onSelectSpecies?: (code: string) => void;
  silhouetteFor: (silhouetteId: string | null) => string;
  colorFor: (silhouetteId: string | null) => string;
}

const VIEWBOX_W = 360;
const VIEWBOX_H = 380;
// Approx geographic bounding box for AZ used to project hotspot lat/lng -> SVG units
const GEO_MIN_LNG = -114.85;
const GEO_MAX_LNG = -109.05;
const GEO_MIN_LAT = 31.30;
const GEO_MAX_LAT = 37.00;

function project(lat: number, lng: number): { x: number; y: number } {
  const x = ((lng - GEO_MIN_LNG) / (GEO_MAX_LNG - GEO_MIN_LNG)) * VIEWBOX_W;
  const y = ((GEO_MAX_LAT - lat) / (GEO_MAX_LAT - GEO_MIN_LAT)) * VIEWBOX_H;
  return { x, y };
}

function groupBy<T, K>(arr: T[], key: (t: T) => K): globalThis.Map<K, T[]> {
  const m = new globalThis.Map<K, T[]>();
  for (const v of arr) {
    const k = key(v);
    const list = m.get(k);
    if (list) list.push(v); else m.set(k, [v]);
  }
  return m;
}

export function Map(props: MapProps) {
  const observationsByRegion = groupBy(props.observations, o => o.regionId ?? 'unknown');
  // Paint-order rule for the 9 AZ ecoregions. SVG has no z-index; document
  // order IS paint order. We want, in priority order:
  //   1. Parents painted before their children (sonoran-tucson before
  //      sky-islands-*, colorado-plateau before grand-canyon) so child
  //      polygons are visible and clickable at their centres. Fixes #80.
  //   2. The selected (expanded) region painted LAST so its stroke and
  //      badges are never cut by a neighbour's stroke/shape. Fixes #87.
  //   3. Stable alphabetical tiebreak so the DOM order is deterministic
  //      regardless of API result ordering — prevents silent drift if
  //      `getRegions()` ever changes its ORDER BY clause.
  //
  // We compute the "parent" set from `props.regions` directly (not from
  // `parentId === null`) so a region that IS referenced as a parent paints
  // first even if its own `parentId` happens to be null. This decouples
  // the comparator from the DB migration state that populates `parent_id`
  // — see migrations/1700000011000_fix_region_boundaries.sql:148-154.
  const orderedRegions = useMemo(() => {
    const parentIds = new Set<string>(
      props.regions
        .map(r => r.parentId)
        .filter((id): id is string => id !== null),
    );
    // A region is a "paint-before" (tier 0) if it is a root (parentId=null)
    // OR it is referenced as a parent of another region in this input set.
    // A region is "paint-after" (tier 1) only if it is purely a child with
    // no children of its own. Combining both properties keeps paint order
    // correct even when the DB drifts (see migration 11000) — any region
    // that is referenced as a parent paints first even if its own parentId
    // is stale, and any root paints first even if the defensive set misses it.
    const isPaintBefore = (r: RegionT) =>
      r.parentId === null || parentIds.has(r.id);
    return [...props.regions].sort((a, b) => {
      // Selected-last overrides everything: an expanded region must paint
      // after all others so neighbour strokes/shapes never cut its edges,
      // even if that region is itself a parent.
      const aSelected = a.id === props.expandedRegionId ? 1 : 0;
      const bSelected = b.id === props.expandedRegionId ? 1 : 0;
      if (aSelected !== bSelected) return aSelected - bSelected; // selected last
      const aTier = isPaintBefore(a) ? 0 : 1;
      const bTier = isPaintBefore(b) ? 0 : 1;
      if (aTier !== bTier) return aTier - bTier; // parents/roots first
      return a.id.localeCompare(b.id); // stable alphabetical
    });
  }, [props.regions, props.expandedRegionId]);

  return (
    <svg
      className="bird-map"
      viewBox={`0 0 ${VIEWBOX_W} ${VIEWBOX_H}`}
      preserveAspectRatio="xMidYMid meet"
      // Inline style beats `.bird-map { width: auto; height: auto }` in styles.css.
      // Without this the SVG sizes to its intrinsic viewBox (360/380 aspect) and
      // leaves ~40% horizontal gutters at 1440×900. The class's `max-height: 100%`
      // still protects against vertical overflow (PR #16's rule).
      style={{ width: '100%', height: '100%' }}
      role="application"
      aria-label="Arizona ecoregions map"
      onClick={e => {
        if (e.target === e.currentTarget) props.onSelectRegion(null);
      }}
    >
      {orderedRegions.map(r => {
        const isExpanded = props.expandedRegionId === r.id;
        const isDimmed = props.expandedRegionId !== null && !isExpanded;
        return (
          <g
            key={r.id}
            style={{
              opacity: isDimmed ? 0.2 : 1,
              transition: 'opacity 250ms ease, transform 350ms ease',
            }}
          >
            <Region
              region={r}
              observations={observationsByRegion.get(r.id) ?? []}
              expanded={isExpanded}
              selectedSpeciesCode={props.selectedSpeciesCode}
              onSelect={() => props.onSelectRegion(isExpanded ? null : r.id)}
              {...(props.onSelectSpecies !== undefined
                ? { onSelectSpecies: props.onSelectSpecies }
                : {})}
              silhouetteFor={props.silhouetteFor}
              colorFor={props.colorFor}
            />
          </g>
        );
      })}
      {props.expandedRegionId === null && props.hotspots.map(h => {
        const { x, y } = project(h.lat, h.lng);
        return (
          <HotspotDot
            key={h.locId}
            x={x}
            y={y}
            numSpeciesAlltime={h.numSpeciesAlltime}
            locName={h.locName}
          />
        );
      })}
    </svg>
  );
}
