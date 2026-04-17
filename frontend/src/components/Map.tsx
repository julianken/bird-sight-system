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

  return (
    <svg
      className="bird-map"
      viewBox={`0 0 ${VIEWBOX_W} ${VIEWBOX_H}`}
      role="application"
      aria-label="Arizona ecoregions map"
      onClick={e => {
        if (e.target === e.currentTarget) props.onSelectRegion(null);
      }}
    >
      {props.regions.map(r => {
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
