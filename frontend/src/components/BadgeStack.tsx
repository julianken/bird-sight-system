import type { Observation } from '@bird-watch/shared-types';
import { Badge } from './Badge.js';

export interface BadgeGroup {
  speciesCode: string;
  comName: string;
  silhouetteId: string | null;
  count: number;
}

export function layoutBadges(observations: Observation[]): BadgeGroup[] {
  const map = new Map<string, BadgeGroup>();
  for (const o of observations) {
    const existing = map.get(o.speciesCode);
    if (existing) {
      existing.count += 1;
    } else {
      map.set(o.speciesCode, {
        speciesCode: o.speciesCode,
        comName: o.comName,
        silhouetteId: o.silhouetteId,
        count: 1,
      });
    }
  }
  return Array.from(map.values()).sort((a, b) => b.count - a.count);
}

export interface BadgeStackProps {
  observations: Observation[];
  x: number;
  y: number;
  width: number;
  height: number;
  silhouetteFor: (silhouetteId: string | null) => string;
  colorFor: (silhouetteId: string | null) => string;
  onSelectSpecies?: (speciesCode: string) => void;
  selectedSpeciesCode?: string | null;
}

const BADGE_DIAMETER = 30;
const PADDING = 4;

export function BadgeStack(props: BadgeStackProps) {
  const groups = layoutBadges(props.observations);
  const cols = Math.max(1, Math.floor(props.width / (BADGE_DIAMETER + PADDING)));

  return (
    <g className="badge-stack">
      {groups.map((g, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const cx = props.x + (col + 0.5) * (BADGE_DIAMETER + PADDING);
        const cy = props.y + (row + 0.5) * (BADGE_DIAMETER + PADDING);
        return (
          <Badge
            key={g.speciesCode}
            x={cx}
            y={cy}
            count={g.count}
            silhouettePath={props.silhouetteFor(g.silhouetteId)}
            color={props.colorFor(g.silhouetteId)}
            comName={g.comName}
            selected={props.selectedSpeciesCode === g.speciesCode}
            onClick={
              props.onSelectSpecies
                ? () => props.onSelectSpecies!(g.speciesCode)
                : undefined
            }
          />
        );
      })}
    </g>
  );
}
