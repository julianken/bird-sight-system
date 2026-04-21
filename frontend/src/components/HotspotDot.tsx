export interface HotspotDotProps {
  x: number;
  y: number;
  numSpeciesAlltime: number | null;
  locName: string;
}

/**
 * Radius constants for the hotspot dot (SVG user units; the map uses
 * viewBox="0 0 100 100" with a 1.58 px/unit desktop scale).
 *
 * The previous formula `MIN_R + log10(species) * 3` (MIN_R=3, MAX_R=11)
 * saturated at species ≈ 464 — every AZ eBird hotspot with hundreds of
 * species rendered at MAX_R, erasing the species-richness differentiation
 * the dot is meant to convey.
 *
 * The new formula uses area-proportional (sqrt) scaling: perceived dot
 * "weight" tracks circle area, and area ∝ r². If we want circle area to
 * be roughly linear in species count — so doubling species doubles visual
 * weight — then r ∝ sqrt(species). This is the standard proportional-
 * symbol-map convention (cf. d3-scale `scaleSqrt`).
 *
 * MAX_R=7 is tuned to be exactly half the default Badge radius of 14, so
 * hotspots read as secondary markers and don't visually compete with the
 * primary Badge symbols on the same map.
 *
 * REF_SPECIES=450 anchors the saturation point near the upper tail of
 * the actual AZ hotspot distribution (most cluster 100-400 species).
 * Subject to retune against real /api/hotspots output.
 *
 * These constants are intentionally kept as local file-scope `const`s for
 * this PR so the follow-up design-token refactor can hoist all sizing
 * tokens in a single diff without merge conflict.
 */
const MIN_R = 2;
const MAX_R = 7;
const REF_SPECIES = 450;

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

function radiusFor(species: number | null): number {
  if (!species || species <= 0) return MIN_R;
  const t = clamp01(species / REF_SPECIES);
  return MIN_R + Math.sqrt(t) * (MAX_R - MIN_R);
}

export function HotspotDot(props: HotspotDotProps) {
  return (
    <circle
      className="hotspot-dot"
      cx={props.x}
      cy={props.y}
      r={radiusFor(props.numSpeciesAlltime)}
      fill="#00A6F3"
      stroke="#fff"
      strokeWidth={1.5}
      // Keeps the 1.5-unit stroke at 1.5 CSS px regardless of the
      // viewBox-to-viewport mapping (~2.4x at 1440x900, ~1x at 390x844).
      // Also set in styles.css for completeness.
      vectorEffect="non-scaling-stroke"
    >
      <title>{props.locName}</title>
    </circle>
  );
}
