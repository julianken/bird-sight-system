export interface BadgeProps {
  x: number;
  y: number;
  count: number;
  silhouettePath: string;
  color: string;
  comName: string;
  selected?: boolean;
  onClick?: () => void;
  /**
   * Outer radius in polygon-local SVG units. Defaults to `DEFAULT_RADIUS`
   * (14) to preserve behaviour for callers that don't size the badge
   * explicitly. Polygon-aware layout (`BadgeStack`) overrides this for
   * small regions so a 30-unit-wide sky-island still gets a contained
   * circle, and scales the count chip + silhouette proportionally.
   */
  radius?: number;
  /**
   * When true, render a visible `<text>` label with `comName` below the
   * circle (issue #54). The label is marked `aria-hidden="true"` because
   * the parent `<g>` already carries `aria-label={comName}`; rendering
   * the name twice in the accessibility tree would cause screen readers
   * to double-announce. Defaults to false — collapsed regions have no
   * room for labels (that's what the "+N more" overflow pip is for).
   */
  expanded?: boolean;
}

export const DEFAULT_RADIUS = 14;

/** Hard cap on visible label length before we append an ellipsis. SVG
 * `<text>` does not support CSS text-overflow, so we truncate JS-side.
 * The full common name stays in the parent `<g>`'s `aria-label` so
 * screen-reader output is unaffected by truncation. */
const MAX_LABEL_CHARS = 14;

function truncateLabel(name: string): string {
  if (name.length <= MAX_LABEL_CHARS) return name;
  return `${name.slice(0, MAX_LABEL_CHARS)}…`;
}

export function Badge(props: BadgeProps) {
  const cursor = props.onClick ? 'pointer' : 'default';
  const radius = props.radius ?? DEFAULT_RADIUS;
  // Chip + stroke + text sizing all scale proportionally to the radius so
  // a small badge still reads as a badge (not a fat-stroke disc with a
  // detached chip). These constants were chosen by eye at RADIUS=14 (chip
  // ≈ half the circle, stroke ≈ 1/7 the diameter); `scale` adapts them
  // when BadgeStack sizes a small region's badge below the default.
  const scale = radius / DEFAULT_RADIUS;
  const chipRadius = 7 * scale;
  const strokeWidth = 2 * scale;
  const chipFontSize = 9 * scale;
  return (
    <g
      className={`badge${props.selected ? ' badge-selected' : ''}`}
      transform={`translate(${props.x},${props.y})`}
      onClick={props.onClick}
      role={props.onClick ? 'button' : undefined}
      tabIndex={props.onClick ? 0 : undefined}
      aria-label={`${props.comName}${props.count > 1 ? ` (${props.count} sightings)` : ''}`}
      style={{ cursor }}
      onKeyDown={props.onClick ? (e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          props.onClick!();
        }
      }) : undefined}
    >
      <circle
        className="badge-circle"
        r={radius}
        fill={props.color}
        stroke="#fff"
        strokeWidth={strokeWidth}
      />
      <g transform={`translate(-${radius},-${radius}) scale(${(radius * 2) / 24})`}>
        <path d={props.silhouettePath} fill="#fff" />
      </g>
      {props.count > 1 && (
        <g transform={`translate(${radius - 2 * scale},${-radius + 2 * scale})`}>
          <circle r={chipRadius} fill="#1a1a1a" />
          <text
            textAnchor="middle"
            dominantBaseline="central"
            fill="#fff"
            fontSize={chipFontSize}
            fontWeight="bold"
            fontFamily="-apple-system, sans-serif"
          >
            {props.count}
          </text>
        </g>
      )}
      {props.expanded && (
        <text
          className="badge-label"
          aria-hidden="true"
          textAnchor="middle"
          dominantBaseline="hanging"
          x={0}
          y={radius + 3 * scale}
          fontSize={Math.max(9, radius * 0.6)}
        >
          {truncateLabel(props.comName)}
        </text>
      )}
    </g>
  );
}
