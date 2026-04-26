import type { MouseEvent } from 'react';
import type { MosaicTile } from './cluster-mosaic.js';

/**
 * Inline-SVG 2×2 mosaic marker for clusters with `point_count <= 8` (issue
 * #248). Each tile shows a family silhouette in the family's seeded color.
 * A count badge sits at the bottom-right and reports the cluster's total
 * point_count (NOT the visible-tile sum — the badge is the count of all
 * leaves, including those filtered out for tile capacity or null
 * familyCode).
 *
 * The marker is a `<button>` so screen-reader users get the same click
 * affordance the layer-bound cluster handler exposes for sighted users.
 * `onClick` is called with the React MouseEvent so the parent can decide
 * whether to delegate to the cluster zoom-into handler or hand off to
 * spiderfy (issue #247).
 *
 * Tile fallback (svgData null OR family unseeded) is rendered as a
 * generic placeholder shape at 50% opacity. Same visual grammar as
 * FamilyLegend's per-row fallback so the user sees a consistent "we know
 * something is here, but the silhouette isn't curated yet" cue.
 */

export interface MosaicMarkerProps {
  /**
   * Top-N (≤4) tiles built via `buildMosaicTiles`. Order is the
   * positional order in the 2×2 grid (TL → TR → BL → BR). Empty array
   * is permitted — the marker still renders the count badge.
   */
  tiles: MosaicTile[];
  /**
   * Cluster's full point_count. Drives the badge text + the aria-label.
   * Distinct from `tiles.length` because tiles is capped at 4 AND skips
   * leaves with null familyCode.
   */
  totalCount: number;
  /**
   * Click handler — wired by MapCanvas to either the existing zoom-into
   * cluster path (low zoom) or, eventually, the spiderfy handler (#247
   * at zoom >= CLUSTER_MAX_ZOOM). Receives the raw React event so the
   * parent can call `e.stopPropagation()` if needed to defang the
   * underlying layer-bound click.
   */
  onClick: (e: MouseEvent<HTMLButtonElement>) => void;
}

/**
 * Per-cell pixel size. Bumped above the 14-per-tile suggestion in the issue
 * gotchas — at 14×14 the silhouettes lose recognizability against the
 * 24-unit viewBox. 22×22 keeps tiles legible without making the composite
 * marker overflow its anchor footprint.
 */
const TILE_PX = 22;
const GRID_GAP_PX = 2;

/** Composite marker dimension: 2 tiles + 1 inter-tile gap on each axis. */
const MARKER_SIZE_PX = TILE_PX * 2 + GRID_GAP_PX;

/**
 * Generic placeholder shape for fallback tiles. Filled in the family's
 * seeded color (so the cell still color-codes) but at 50% opacity so it
 * doesn't read as authoritative.
 */
const FALLBACK_PATH = 'M12 4 a8 8 0 1 0 0.0001 0 z';

interface TileCellProps {
  tile: MosaicTile;
  /** Index in the 4-cell grid; drives data-position for CSS targeting. */
  index: number;
}

function TileCell({ tile, index }: TileCellProps) {
  const path = tile.svgData ?? FALLBACK_PATH;
  return (
    <span
      data-testid="mosaic-tile"
      data-fallback={tile.isFallback ? 'true' : 'false'}
      data-position={index}
      style={{
        width: TILE_PX,
        height: TILE_PX,
        background: '#ffffffd9',
        borderRadius: 3,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <svg
        viewBox="0 0 24 24"
        width={TILE_PX - 4}
        height={TILE_PX - 4}
        aria-hidden="true"
        focusable="false"
        preserveAspectRatio="xMidYMid meet"
      >
        <path
          d={path}
          fill={tile.color}
          opacity={tile.isFallback ? 0.5 : 1}
        />
      </svg>
    </span>
  );
}

export function MosaicMarker({ tiles, totalCount, onClick }: MosaicMarkerProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Cluster of ${totalCount} observations — zoom in or click to expand`}
      data-testid="cluster-mosaic-marker"
      style={{
        position: 'relative',
        // Padding=0 so the 2×2 grid sets the marker footprint; remove the
        // default UA button padding/border so the marker sits flush at
        // its lng/lat anchor.
        padding: 0,
        border: 'none',
        background: 'transparent',
        cursor: 'pointer',
        width: MARKER_SIZE_PX,
        height: MARKER_SIZE_PX,
        display: 'inline-grid',
        gridTemplateColumns: `${TILE_PX}px ${TILE_PX}px`,
        gridTemplateRows: `${TILE_PX}px ${TILE_PX}px`,
        gap: GRID_GAP_PX,
        // Subtle drop shadow to lift the marker off basemap fill — same
        // role as FamilyLegend's panel shadow but lighter.
        filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.25))',
      }}
    >
      {tiles.map((t, i) => (
        <TileCell key={`${t.familyCode}-${i}`} tile={t} index={i} />
      ))}
      {/*
        Pad the grid to 4 cells so the count badge always anchors at the
        same bottom-right corner regardless of how many tiles populated.
        Empty padders are visually transparent.
      */}
      {Array.from({ length: 4 - tiles.length }, (_, i) => (
        <span
          key={`empty-${i}`}
          aria-hidden="true"
          style={{ width: TILE_PX, height: TILE_PX }}
        />
      ))}
      <span
        data-testid="mosaic-count-badge"
        style={{
          position: 'absolute',
          right: -4,
          bottom: -4,
          minWidth: 18,
          height: 18,
          padding: '0 4px',
          borderRadius: 9,
          background: '#1a1a1a',
          color: '#fff',
          fontSize: 11,
          lineHeight: '18px',
          fontWeight: 700,
          textAlign: 'center',
          // Defensive: badge sits over a tile corner; drop shadow keeps it
          // legible against the white tile background.
          boxShadow: '0 1px 2px rgba(0,0,0,0.4)',
        }}
      >
        {totalCount}
      </span>
    </button>
  );
}
