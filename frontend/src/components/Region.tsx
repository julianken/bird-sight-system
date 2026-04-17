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
      {/* Decorative fill — pointer-events disabled so badge circles can intercept their own clicks */}
      <path
        className="region-shape"
        d={props.region.svgPath}
        fill={props.region.displayColor}
        stroke="#fff"
        strokeWidth={3}
        style={{ pointerEvents: 'none' }}
      />
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
      {/* Transparent overlay rendered above BadgeStack so region background receives
          clicks in the spaces between badge circles, while badges retain their own
          pointer events. Carries full accessibility attributes (role, aria-label,
          tabIndex, onKeyDown) as the interactive element in the AX tree. */}
      <path
        className="region-shape"
        d={props.region.svgPath}
        fill="transparent"
        stroke="none"
        role="button"
        tabIndex={0}
        aria-label={props.region.name}
        onClick={() => props.onSelect(props.region.id)}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            props.onSelect(props.region.id);
          }
        }}
        style={{ cursor: 'pointer', pointerEvents: 'all' }}
      />
    </g>
  );
}
