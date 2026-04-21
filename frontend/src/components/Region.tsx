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

const VIEWBOX = { w: 360, h: 380 };
const EXPAND_PAD = 0.85; // leave ~7.5% margin on each side of the expanded region
/**
 * Cap the effective bbox (post-transform) to this fraction of the viewBox on
 * its constraining axis. Policy (b) in issue #88: small regions
 * (Sky Islands) would otherwise multiply their linear size by 7–9×, which
 * blows the fallback badge inside them up to ~90% of the viewport (see issue
 * body for the 1305×685 CSS-px measurement). 0.60 keeps the "focus"
 * affordance (scaled region still clearly dominates the canvas) while
 * preventing the catastrophic blowup. Paired with EXPAND_PAD: the final
 * scaled bbox never exceeds 0.60 × 0.85 = 0.51 of the viewBox on the
 * constraining axis.
 */
const EXPAND_MAX_BBOX_FRAC = 0.6;

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

/**
 * Compose a translate+scale string that centres the given region polygon
 * in the viewBox and scales it to ~EXPAND_PAD of the viewBox on its
 * constraining axis — EXCEPT when the region is tiny enough that doing so
 * would multiply its linear size past EXPAND_MAX_BBOX_FRAC of the viewBox.
 * In that case we fall back to a scale that keeps the largest dimension
 * inside the cap, so the selection is unambiguous ("this region is the
 * focus") without the badge-blowup side effect.
 *
 * See issue #88 for the scale table: Sky Islands go from ~7-9×
 * (catastrophic) to ~4.9-6.2× (large but bounded). Policy (b) — cap the
 * result bbox rather than the multiplier — preserves the "fill-the-canvas"
 * affordance on small regions where a flat MAX_EXPAND_SCALE would make
 * them render at a barely-visible fraction of the viewBox.
 */
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
  // Target scale = fit the bbox to EXPAND_PAD of the constraining axis.
  const targetScale = Math.min(viewBox.w / width, viewBox.h / height) * EXPAND_PAD;
  // Cap scale = largest scale such that the scaled bbox fits inside
  // EXPAND_MAX_BBOX_FRAC of the viewBox on both axes.
  const capScale = Math.min(
    (viewBox.w * EXPAND_MAX_BBOX_FRAC) / width,
    (viewBox.h * EXPAND_MAX_BBOX_FRAC) / height,
  );
  const scale = Math.min(targetScale, capScale);
  const cx = minX + width / 2;
  const cy = minY + height / 2;
  const tx = viewBox.w / 2 - cx * scale;
  const ty = viewBox.h / 2 - cy * scale;
  return `translate(${tx} ${ty}) scale(${scale})`;
}

export function Region(props: RegionProps) {
  const bbox = boundingBoxOfPath(props.region.svgPath);
  const padding = 8;
  const stackX = bbox.x + padding;
  const stackY = bbox.y + padding;
  const stackW = bbox.width - padding * 2;
  const stackH = bbox.height - padding * 2;

  const expandTransform = props.expanded
    ? computeExpandTransform(props.region.svgPath)
    : undefined;

  return (
    <g
      className={`region${props.expanded ? ' region-expanded' : ''}`}
      data-region-id={props.region.id}
      transform={expandTransform}
    >
      <path
        className="region-shape"
        d={props.region.svgPath}
        fill={props.region.displayColor}
        stroke="#fff"
        strokeWidth={3}
        // Keep the 3-unit stroke in CSS pixels regardless of the .region-expanded
        // scale(s) transform (s ~ 3-9 across regions). Also declared in
        // styles.css; the JSX attribute is belt-and-braces for Safari < 16,
        // which intermittently ignored class-selector vector-effect rules.
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
      {props.observations.length > 0 && (
        <BadgeStack
          observations={props.observations}
          polygonSvgPath={props.region.svgPath}
          x={stackX}
          y={stackY}
          width={stackW}
          height={stackH}
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
      )}
    </g>
  );
}
