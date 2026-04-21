import type { Region as RegionT, Observation } from '@bird-watch/shared-types';
import { BadgeStack } from './BadgeStack.js';
import { boundingBoxOfPath } from '../geo/path.js';

const VIEWBOX = { w: 360, h: 380 };
const EXPAND_PAD = 0.85; // leave ~7.5% margin on each side of the expanded region

// Parses ONLY absolute `M x y` / `L x y` commands. The 9 seeded AZ region paths
// (see migrations/1700000008000_seed_regions.sql) use exactly this subset, and
// any future paths in the same seed should too. If someone authors a curve (`C`,
// `Q`, `S`, `T`, `A`), a relative command (`m`, `l`), or the shortcuts `H`/`V`,
// this parser silently drops them and `computeExpandTransform` returns an
// off-center transform. Extend this parser (or use getBBox() from the DOM) if
// the seed grammar changes.
function parsePoints(svgPath: string): Array<{ x: number; y: number }> {
  const tokens = svgPath.split(/[\s,]+/).filter(Boolean);
  const points: Array<{ x: number; y: number }> = [];
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i];
    if (t === 'M' || t === 'L') {
      const x = parseFloat(tokens[i + 1] ?? '0');
      const y = parseFloat(tokens[i + 2] ?? '0');
      points.push({ x, y });
      i += 3;
    } else if (t === 'Z' || t === 'z') {
      i += 1; // closing verb — no coordinates to skip
    } else {
      i += 1;
    }
  }
  return points;
}

export function computeExpandTransform(
  svgPath: string,
  viewBox: { w: number; h: number } = VIEWBOX,
): string {
  const points = parsePoints(svgPath);
  if (points.length === 0) return '';
  const xs = points.map(p => p.x);
  const ys = points.map(p => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const width = maxX - minX;
  const height = maxY - minY;
  if (width === 0 || height === 0) return '';
  const scale = Math.min(viewBox.w / width, viewBox.h / height) * EXPAND_PAD;
  const cx = minX + width / 2;
  const cy = minY + height / 2;
  const tx = viewBox.w / 2 - cx * scale;
  const ty = viewBox.h / 2 - cy * scale;
  return `translate(${tx} ${ty}) scale(${scale})`;
}

// ---------------------------------------------------------------------------
// #94 two-pass refactor: `Region` is split into two pure leaf renderers.
// `RegionShape` draws the <path>. `RegionBadges` positions the <BadgeStack>.
// Map.tsx owns the per-region <g> that carries `className`, `data-region-id`,
// `transform`, `opacity`, and `transition`. This makes cross-region badge
// bleed impossible by construction: all shapes paint in `.shapes-layer`
// before any badge paints in `.badges-layer`.
// ---------------------------------------------------------------------------

export interface RegionShapeProps {
  region: RegionT;
  onSelect: (regionId: string) => void;
}

/**
 * Pure <path> renderer for a region polygon. Has no opinion on container
 * structure — the callsite (Map.tsx) provides the `<g>` wrapper that owns
 * `className`, `data-region-id`, and the expand transform.
 */
export function RegionShape(props: RegionShapeProps) {
  return (
    <path
      className="region-shape"
      d={props.region.svgPath}
      fill={props.region.displayColor}
      stroke="#fff"
      strokeWidth={3}
      // Keep the 3-unit stroke in CSS pixels regardless of the .region-expanded
      // scale(s) transform (s ~ 3-9 across regions). Also declared in
      // styles.css; the JSX attribute is belt-and-braces for Safari < 16,
      // which intermittently ignored class-selector vector-effect rules. See #98.
      vectorEffect="non-scaling-stroke"
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
  );
}

export interface RegionBadgesProps {
  region: RegionT;
  observations: Observation[];
  expanded: boolean;
  selectedSpeciesCode?: string | null;
  onSelectSpecies?: (speciesCode: string) => void;
  silhouetteFor: (silhouetteId: string | null) => string;
  colorFor: (silhouetteId: string | null) => string;
}

/**
 * Pure <BadgeStack> positioner. Computes the bbox-inset layout rectangle
 * from the region polygon and delegates all rendering to BadgeStack.
 * `observations` is assumed to be non-empty — the Map call-site skips the
 * wrapper entirely when a region has no observations.
 */
export function RegionBadges(props: RegionBadgesProps) {
  const bbox = boundingBoxOfPath(props.region.svgPath);
  const padding = 8;
  return (
    <BadgeStack
      observations={props.observations}
      polygonSvgPath={props.region.svgPath}
      x={bbox.x + padding}
      y={bbox.y + padding}
      width={bbox.width - padding * 2}
      height={bbox.height - padding * 2}
      expanded={props.expanded}
      silhouetteFor={props.silhouetteFor}
      colorFor={props.colorFor}
      {...(props.onSelectSpecies !== undefined
        ? { onSelectSpecies: props.onSelectSpecies }
        : {})}
      {...(props.selectedSpeciesCode !== undefined
        ? { selectedSpeciesCode: props.selectedSpeciesCode }
        : {})}
    />
  );
}
