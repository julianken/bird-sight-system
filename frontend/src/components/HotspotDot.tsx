export interface HotspotDotProps {
  x: number;
  y: number;
  numSpeciesAlltime: number | null;
  locName: string;
}

const MIN_R = 3;
const MAX_R = 11;

function radiusFor(species: number | null): number {
  if (!species || species <= 0) return MIN_R;
  // log scale: 50 species ≈ MIN_R+1, 500 species ≈ MAX_R
  const r = MIN_R + Math.log10(species) * 3;
  return Math.min(MAX_R, Math.max(MIN_R, r));
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
