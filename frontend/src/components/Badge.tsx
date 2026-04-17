export interface BadgeProps {
  x: number;
  y: number;
  count: number;
  silhouettePath: string;
  color: string;
  comName: string;
  selected?: boolean;
  onClick?: () => void;
}

const RADIUS = 14;
const CHIP_RADIUS = 7;

export function Badge(props: BadgeProps) {
  const cursor = props.onClick ? 'pointer' : 'default';
  return (
    <g
      className={`badge${props.selected ? ' badge-selected' : ''}`}
      transform={`translate(${props.x},${props.y})`}
      onClick={props.onClick}
      role={props.onClick ? 'button' : undefined}
      tabIndex={props.onClick ? 0 : undefined}
      aria-label={`${props.comName}${props.count > 1 ? ` (${props.count} sightings)` : ''}`}
      style={{ cursor }}
    >
      <circle
        className="badge-circle"
        r={RADIUS}
        fill={props.color}
        stroke="#fff"
        strokeWidth={2}
      />
      <g transform={`translate(-${RADIUS},-${RADIUS}) scale(${(RADIUS * 2) / 24})`}>
        <path d={props.silhouettePath} fill="#fff" />
      </g>
      {props.count > 1 && (
        <g transform={`translate(${RADIUS - 2},${-RADIUS + 2})`}>
          <circle r={CHIP_RADIUS} fill="#1a1a1a" />
          <text
            textAnchor="middle"
            dominantBaseline="central"
            fill="#fff"
            fontSize={9}
            fontWeight="bold"
            fontFamily="-apple-system, sans-serif"
          >
            {props.count}
          </text>
        </g>
      )}
    </g>
  );
}
