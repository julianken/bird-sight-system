import type { MouseEvent } from 'react';
import { FALLBACK_SILHOUETTE_PATH } from './silhouette-fallback.js';
import { readToken, notableColor } from './observation-layers.js';

/**
 * Single-purpose visible-silhouette marker for Spider v2 auto-fan leaves
 * (issue #277). Renders a family-colored inline SVG silhouette with:
 *
 *  - White halo (painted FIRST so it sits BEHIND the colored path)
 *  - Optional amber notable ring (painted before the halo so it sits
 *    outermost, matching the SDF notable-ring layer from PR #246)
 *  - `<button>` wrapper for keyboard accessibility (Tab + Enter/Space)
 *  - Full aria-label combining comName, familyCode, locName, obsDt
 *
 * Mirrors MosaicMarker's inline-SVG pattern but is a single-observation
 * marker, not a cluster tile.
 */

/** Marker diameter in px. Larger than mosaic tiles since it's one bird. */
const MARKER_SIZE_PX = 32;

export interface StackedSilhouetteMarkerProps {
  silhouette: { svgData: string | null; color: string };
  comName: string;
  familyCode: string | null;
  locName: string | null;
  obsDt: string;
  isNotable: boolean;
  onClick: (e: MouseEvent<HTMLButtonElement>) => void;
}

/**
 * Build an aria-label from the observation fields.
 * Segments with null values are omitted so the label never contains the
 * literal string "null".
 */
function buildAriaLabel(
  comName: string,
  familyCode: string | null,
  locName: string | null,
  obsDt: string,
): string {
  return [comName, familyCode, locName, obsDt]
    .filter((v): v is string => v !== null)
    .join(' — ');
}

export function StackedSilhouetteMarker({
  silhouette,
  comName,
  familyCode,
  locName,
  obsDt,
  isNotable,
  onClick,
}: StackedSilhouetteMarkerProps) {
  const path = silhouette.svgData ?? FALLBACK_SILHOUETTE_PATH;
  const color = silhouette.color;
  const ariaLabel = buildAriaLabel(comName, familyCode, locName, obsDt);

  function handleClick(e: MouseEvent<HTMLButtonElement>) {
    e.stopPropagation();
    onClick(e);
  }

  return (
    <button
      type="button"
      data-testid="stacked-silhouette-marker"
      aria-label={ariaLabel}
      onClick={handleClick}
      style={{
        padding: 0,
        border: 'none',
        background: 'transparent',
        cursor: 'pointer',
        width: MARKER_SIZE_PX,
        height: MARKER_SIZE_PX,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.25))',
      }}
    >
      <svg
        viewBox="0 0 24 24"
        width={MARKER_SIZE_PX}
        height={MARKER_SIZE_PX}
        aria-hidden="true"
        focusable="false"
        preserveAspectRatio="xMidYMid meet"
      >
        {/*
          Paint order (back → front):
            1. Amber notable ring (circle) — outermost ring, only if notable
            2. White halo path — behind the silhouette for contrast
            3. Colored silhouette path — the family bird shape
        */}
        {isNotable && (
          <circle
            cx="12"
            cy="12"
            r="11"
            fill="none"
            stroke={notableColor()}
            strokeWidth="2"
          />
        )}
        {/* White halo — painted BEFORE the colored path so it sits behind */}
        <path
          d={path}
          fill="none"
          stroke="white"
          strokeWidth="2"
          strokeLinejoin="round"
        />
        {/* Colored silhouette — painted AFTER halo, sits on top */}
        <path d={path} fill={color} />
      </svg>
    </button>
  );
}
