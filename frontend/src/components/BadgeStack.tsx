import type { Observation } from '@bird-watch/shared-types';
import { Badge } from './Badge.js';
import { largestInscribedRect, poleOfInaccessibility } from '../geo/path.js';

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
  /**
   * Polygon svg path (absolute M/L/Z only, matching the seed contract).
   * BadgeStack computes the largest axis-aligned rectangle wholly inside
   * this polygon and lays badges out within that — the bbox x/y/width/
   * height props below are retained for the expanded-mode fallback (where
   * the whole polygon gets scaled to fill the canvas and bbox layout is
   * fine) and for specs that construct a BadgeStack directly.
   */
  polygonSvgPath?: string;
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

const MAX_BADGE_DIAMETER = 30;
/** Below this, a collapsed-region layout bails out to the single-badge
 * pole-of-inaccessibility fallback (see issue #59 AC #5). */
export const MIN_BADGE_DIAMETER = 14;
const PADDING = 4;

/** Max badges shown when the region is collapsed. The last slot becomes "+N more". */
const MAX_COLLAPSED_BADGES = 12;

interface GridLayout {
  /** Top-left corner of the cell region (in polygon-local SVG units). */
  x: number;
  y: number;
  /** Usable interior width/height. */
  width: number;
  height: number;
  /** Badge outer diameter in SVG units. */
  diameter: number;
  /** Cell pitch (diameter + padding). */
  cell: number;
  /** Columns that fit at this diameter. */
  cols: number;
  /** Whether the layout fell back to pole-of-inaccessibility (single badge). */
  fallback: boolean;
  /** If `fallback`, the pole centre for the single badge. */
  pole?: { x: number; y: number; radius: number };
}

/**
 * Compute a grid that fits `groupCount` badges wholly inside the polygon's
 * largest inscribed rectangle. If even one MIN_BADGE_DIAMETER-sized badge
 * can't fit in the rectangle, fall back to a single badge at the polygon's
 * pole-of-inaccessibility (inradius-centred, diameter clamped to 2·inradius).
 *
 * When no polygonSvgPath is provided (e.g. tests constructing BadgeStack
 * directly), the bbox-derived {x,y,width,height} props are used as the
 * inscribed rect — preserving historical behaviour.
 */
function computeGridLayout(
  polygonSvgPath: string | undefined,
  groupCount: number,
  bbox: { x: number; y: number; width: number; height: number },
): GridLayout {
  const rect = polygonSvgPath
    ? largestInscribedRect(polygonSvgPath)
    : bbox;
  // If inscribed-rect lookup returns zero (degenerate), fall back to bbox.
  const safe =
    rect.width > 0 && rect.height > 0 ? rect : bbox;

  const n = Math.max(1, groupCount);

  // Solve for the largest diameter d such that we can fit n cells of pitch
  // (d + PADDING) in `safe`, preferring a layout that's close to square.
  // Start at MAX_BADGE_DIAMETER and shrink; for 9 polygons × ≤12 badges this
  // is fast and pixel-precise.
  for (let d = MAX_BADGE_DIAMETER; d >= MIN_BADGE_DIAMETER; d--) {
    const pitch = d + PADDING;
    const cols = Math.floor(safe.width / pitch);
    const rows = Math.floor(safe.height / pitch);
    if (cols >= 1 && rows >= 1 && cols * rows >= n) {
      return {
        x: safe.x,
        y: safe.y,
        width: safe.width,
        height: safe.height,
        diameter: d,
        cell: pitch,
        cols,
        fallback: false,
      };
    }
  }

  // Couldn't fit even one MIN_BADGE_DIAMETER badge in the rectangle.
  // Use pole of inaccessibility for a single badge; diameter clamped to
  // min(MAX_BADGE_DIAMETER, 2·inradius) with a floor so the badge is
  // visible even in the tightest sky-island.
  const pole = polygonSvgPath
    ? poleOfInaccessibility(polygonSvgPath)
    : { x: bbox.x + bbox.width / 2, y: bbox.y + bbox.height / 2, radius: Math.min(bbox.width, bbox.height) / 2 };
  const poleDiameter = Math.max(
    MIN_BADGE_DIAMETER,
    Math.min(MAX_BADGE_DIAMETER, Math.floor(2 * pole.radius)),
  );
  return {
    x: safe.x,
    y: safe.y,
    width: safe.width,
    height: safe.height,
    diameter: poleDiameter,
    cell: poleDiameter + PADDING,
    cols: 1,
    fallback: true,
    pole,
  };
}

export function BadgeStack(props: BadgeStackProps) {
  const allGroups = layoutBadges(props.observations);
  const isExpanded = props.expanded ?? false;

  // Expanded mode: use bbox directly (the whole region is scaled up to the
  // canvas by Region's `computeExpandTransform`, so the polygon already
  // fills the screen — inscribed-rect math would just shrink the usable
  // area inside the expanded view unnecessarily). Expanded mode also adds
  // a label row per badge (issue #54); vertical cell pitch grows to
  // prevent the next row's badge from overlapping the previous row's
  // label text.
  const bbox = { x: props.x, y: props.y, width: props.width, height: props.height };
  const EXPANDED_LABEL_HEIGHT = 14; // ~9px label + 5px padding; matches Badge's font-size floor.
  const layout = isExpanded
    ? {
        x: bbox.x,
        y: bbox.y,
        width: bbox.width,
        height: bbox.height,
        diameter: MAX_BADGE_DIAMETER,
        cell: MAX_BADGE_DIAMETER + PADDING,
        // Row stride must clear the label; horizontal stride stays
        // `cell` so columns remain tight.
        rowStride: MAX_BADGE_DIAMETER + PADDING + EXPANDED_LABEL_HEIGHT,
        cols: Math.max(1, Math.floor(bbox.width / (MAX_BADGE_DIAMETER + PADDING))),
        fallback: false as const,
      }
    : computeGridLayout(props.polygonSvgPath, allGroups.length, bbox);

  // Fallback path: single badge at the pole of inaccessibility with an
  // overflow pip showing total species count. This guarantees the badge's
  // inscribed circle is wholly contained in the polygon (AC #1).
  if (!isExpanded && layout.fallback && layout.pole) {
    const primary = allGroups[0];
    if (!primary) return <g className="badge-stack" />;
    const overflow = allGroups.length - 1;
    const r = layout.diameter / 2;
    const onSelectSpecies = props.onSelectSpecies;
    return (
      <g className="badge-stack">
        <Badge
          key={primary.speciesCode}
          x={layout.pole.x}
          y={layout.pole.y}
          radius={r}
          count={primary.count}
          silhouettePath={props.silhouetteFor(primary.silhouetteId)}
          color={props.colorFor(primary.silhouetteId)}
          comName={primary.comName}
          selected={props.selectedSpeciesCode === primary.speciesCode}
          {...(onSelectSpecies !== undefined
            ? { onClick: () => onSelectSpecies(primary.speciesCode) }
            : {})}
        />
        {overflow > 0 && (
          <g
            key="overflow-pip"
            data-role="overflow-pip"
            role="img"
            aria-label={`${overflow} more species — expand region to view`}
            transform={`translate(${layout.pole.x + r * 0.7},${layout.pole.y - r * 0.7})`}
          >
            <circle r={Math.max(5, r * 0.4)} fill="#888" />
            <text
              textAnchor="middle"
              dominantBaseline="central"
              fill="#fff"
              fontSize={Math.max(6, r * 0.45)}
              fontWeight="bold"
              fontFamily="-apple-system, sans-serif"
            >
              +{overflow}
            </text>
          </g>
        )}
      </g>
    );
  }

  // Determine which groups to render and whether we need an overflow pip.
  const cols = Math.max(1, layout.cols);
  const overflow = !isExpanded && allGroups.length > MAX_COLLAPSED_BADGES
    ? allGroups.length - (MAX_COLLAPSED_BADGES - 1)
    : 0;
  const groups = isExpanded
    ? allGroups
    : allGroups.slice(0, overflow > 0 ? MAX_COLLAPSED_BADGES - 1 : MAX_COLLAPSED_BADGES);
  const r = layout.diameter / 2;

  // Row stride differs from column stride only in expanded mode, where
  // we reserve extra vertical space for the label text below each circle.
  const rowStride = 'rowStride' in layout && typeof layout.rowStride === 'number'
    ? layout.rowStride
    : layout.cell;

  return (
    <g className="badge-stack">
      {groups.map((g, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const cx = layout.x + (col + 0.5) * layout.cell;
        const cy = layout.y + (row + 0.5) * rowStride;
        const onSelectSpecies = props.onSelectSpecies;
        return (
          <Badge
            key={g.speciesCode}
            x={cx}
            y={cy}
            radius={r}
            count={g.count}
            silhouettePath={props.silhouetteFor(g.silhouetteId)}
            color={props.colorFor(g.silhouetteId)}
            comName={g.comName}
            selected={props.selectedSpeciesCode === g.speciesCode}
            expanded={isExpanded}
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
        const cx = layout.x + (col + 0.5) * layout.cell;
        const cy = layout.y + (row + 0.5) * rowStride;
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
