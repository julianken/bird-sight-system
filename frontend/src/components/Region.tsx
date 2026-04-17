import type { Region as RegionT, Observation } from '@bird-watch/shared-types';
import { BadgeStack } from './BadgeStack.js';
import { boundingBoxOfPath } from '../geo/path.js';

export interface RegionProps {
  region: RegionT;
  observations: Observation[];
  expanded: boolean;
  selectedSpeciesCode?: string | null;
  onSelect: (regionId: string) => void;
  onSelectSpecies?: (speciesCode: string) => void;
  silhouetteFor: (silhouetteId: string | null) => string;
  colorFor: (silhouetteId: string | null) => string;
}

export function Region(props: RegionProps) {
  const bbox = boundingBoxOfPath(props.region.svgPath);
  const padding = 8;
  const stackX = bbox.x + padding;
  const stackY = bbox.y + padding;
  const stackW = bbox.width - padding * 2;
  const stackH = bbox.height - padding * 2;

  return (
    <g
      className={`region${props.expanded ? ' region-expanded' : ''}`}
      data-region-id={props.region.id}
    >
      <path
        className="region-shape"
        d={props.region.svgPath}
        fill={props.region.displayColor}
        stroke="#fff"
        strokeWidth={3}
        role="button"
        aria-label={props.region.name}
        tabIndex={0}
        onClick={() => props.onSelect(props.region.id)}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            props.onSelect(props.region.id);
          }
        }}
        style={{ cursor: 'pointer' }}
      />
      {props.observations.length > 0 && (
        <BadgeStack
          observations={props.observations}
          x={stackX}
          y={stackY}
          width={stackW}
          height={stackH}
          silhouetteFor={props.silhouetteFor}
          colorFor={props.colorFor}
          {...(props.onSelectSpecies !== undefined
            ? { onSelectSpecies: props.onSelectSpecies }
            : {})}
          {...(props.selectedSpeciesCode !== undefined
            ? { selectedSpeciesCode: props.selectedSpeciesCode }
            : {})}
        />
      )}
    </g>
  );
}
