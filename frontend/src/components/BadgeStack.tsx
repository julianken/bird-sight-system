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
  expanded?: boolean;
  silhouetteFor: (silhouetteId: string | null) => string;
  colorFor: (silhouetteId: string | null) => string;
  onSelectSpecies?: (speciesCode: string) => void;
  selectedSpeciesCode?: string | null;
}

const BADGE_DIAMETER = 30;
const PADDING = 4;

/** Max badges shown when the region is collapsed. The last slot becomes "+N more". */
const MAX_COLLAPSED_BADGES = 12;

export function BadgeStack(props: BadgeStackProps) {
  const allGroups = layoutBadges(props.observations);
  const isExpanded = props.expanded ?? false;
  const cols = Math.max(1, Math.floor(props.width / (BADGE_DIAMETER + PADDING)));

  // Determine which groups to render and whether we need an overflow pip.
  const overflow = !isExpanded && allGroups.length > MAX_COLLAPSED_BADGES
    ? allGroups.length - (MAX_COLLAPSED_BADGES - 1)
    : 0;
  const groups = isExpanded
    ? allGroups
    : allGroups.slice(0, overflow > 0 ? MAX_COLLAPSED_BADGES - 1 : MAX_COLLAPSED_BADGES);

  return (
    <g className="badge-stack">
      {groups.map((g, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const cx = props.x + (col + 0.5) * (BADGE_DIAMETER + PADDING);
        const cy = props.y + (row + 0.5) * (BADGE_DIAMETER + PADDING);
        const onSelectSpecies = props.onSelectSpecies;
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
            {...(onSelectSpecies !== undefined
              ? { onClick: () => onSelectSpecies(g.speciesCode) }
              : {})}
          />
        );
      })}
      {overflow > 0 && (() => {
        // Render "+N more" pip in the slot after the last badge
        const pipIdx = groups.length;
        const col = pipIdx % cols;
        const row = Math.floor(pipIdx / cols);
        const cx = props.x + (col + 0.5) * (BADGE_DIAMETER + PADDING);
        const cy = props.y + (row + 0.5) * (BADGE_DIAMETER + PADDING);
        const r = BADGE_DIAMETER / 2;
        return (
          <g
            key="overflow-pip"
            data-role="overflow-pip"
            role="img"
            aria-label={`${overflow} more species — expand region to view`}
            transform={`translate(${cx},${cy})`}
          >
            <circle r={r} fill="#888" />
            <text
              textAnchor="middle"
              dominantBaseline="central"
              fill="#fff"
              fontSize={9}
              fontWeight="bold"
              fontFamily="-apple-system, sans-serif"
            >
              +{overflow}
            </text>
          </g>
        );
      })()}
    </g>
  );
}
