import type { MouseEvent, CSSProperties } from 'react';
import type { AdaptiveTile, ResolvedGrid } from './adaptive-grid.js';
import { visibleCapacity } from './adaptive-grid.js';
import { FALLBACK_SILHOUETTE_PATH } from './silhouette-fallback.js';

/**
 * `<AdaptiveGridMarker>` — pure display component for the adaptive cluster
 * grid (epic #539, spec `docs/specs/2026-05-14-adaptive-cluster-grid-design.md`
 * §4.3–4.8, §5.1). Renders a 1×1 / 2×1 / 2×2 / 3×3 / 4×4 grid (or 3×3 with a
 * "+N more" overflow indicator on mobile) of family silhouettes with per-cell
 * count badges.
 *
 * The marker is a **pure display component**: it never inspects its own
 * shape to choose between parent-domain actions. The caller selects the
 * click handler (`zoomToExpansion` vs `openObsPanel`) based on
 * `isSingleLeaf(clusterId)` before rendering — see spec §4.5.
 *
 * Hit-extender contract (spec §4.4, corrected per Phase 0 issue #541):
 *   - The outer `<button>` IS the click surface.
 *   - `tabIndex={-1}` (spec §4.7 — keyboard users use the skip-link to the
 *     FeedSurface list landmark).
 *   - A transparent overlay `<span class="adaptive-grid-marker__hit">`
 *     extends OUTWARD via per-axis `top/bottom/left/right` style values
 *     so the hit zone is ≥44×44 (fine pointer) or ≥48×48 (coarse). The
 *     spec's prose §4.4 formula (`inset: min(0, (44-size)/2)`) is wrong on
 *     two counts: (a) for `size < 44` the inner value is positive so the
 *     min clamps to 0 (no extension at all), and (b) for non-square
 *     markers a single scalar leaves the short axis under 44. The
 *     per-axis form below is the corrected formula from issue #541.
 *
 * Tile variants (spec §5.1):
 *   - `rendered`: catalogue loaded, family has CC-licensed art → paint
 *     halo + colored path. Notable amber ring layers BEFORE the path
 *     (spec AC8, inherited from StackedSilhouetteMarker).
 *   - `fallback`: catalogue loaded, no art for this family → generic
 *     placeholder shape at opacity 0.5.
 *   - `pending`: catalogue not loaded yet → animated shimmer skeleton.
 *     Distinct from `fallback` so a cold-load map doesn't look like a
 *     coverage gap (spec §5.1 type comment).
 *
 * Two-tier ARIA (spec §4.6): the parent passes a fully-constructed
 * `ariaLabel` plus optional `describedByListId` + `describedByItems` (an
 * `<ul>` of up to 9 family enumerations). The marker never builds the
 * label string itself — the parent owns the per-state label format from
 * the §4.6 table.
 */

export interface AdaptiveGridMarkerProps {
  /** Narrowed by the parent — pill is rendered by a sibling component. */
  shape: ResolvedGrid;
  /**
   * Tiles in render order (already sorted descending count by
   * `aggregateClusterFamilies`). Length is ≤ `visibleCapacity(shape)`;
   * empty trailing slots render as transparent padders.
   */
  tiles: ReadonlyArray<AdaptiveTile>;
  /** Cluster's full `point_count` (drives badge visibility for the 1×1 single-obs case). */
  totalCount: number;
  /** For aria-label parity; not currently rendered (parent threads label). */
  uniqueFamilies: number;
  /** Pre-built per spec §4.6 table — the parent owns label format. */
  ariaLabel: string;
  /** Optional id of the visually-hidden `<ul>` for two-tier disclosure. */
  describedByListId?: string;
  /** Up to 9 family enumeration strings (8 + "and N more families"). */
  describedByItems?: ReadonlyArray<string>;
  /** `useMediaQuery('(pointer: coarse)')` — raises hit zone to 48×48. */
  isCoarsePointer?: boolean;
  /** Phase 0 AC8 — paint amber ring before silhouette path. */
  isNotable?: boolean;
  /** Species name for the notable single-obs case (unused today; reserved). */
  notableSpeciesName?: string;
  onClick: (e: MouseEvent<HTMLButtonElement>) => void;
}

// Layout constants — match MosaicMarker's 22px tile / 2px gap (issue #248).
const CELL_PX = 22;
const GRID_GAP_PX = 2;
const GRID_PADDING_PX = 3;

const HIT_MIN_FINE = 44;
const HIT_MIN_COARSE = 48;

const NOTABLE_AMBER = '#f59e0b';

function markerDimensions(shape: ResolvedGrid): { width: number; height: number } {
  const width = shape.cols * CELL_PX + (shape.cols - 1) * GRID_GAP_PX + 2 * GRID_PADDING_PX;
  const height = shape.rows * CELL_PX + (shape.rows - 1) * GRID_GAP_PX + 2 * GRID_PADDING_PX;
  return { width, height };
}

export function AdaptiveGridMarker(props: AdaptiveGridMarkerProps) {
  const {
    shape,
    tiles,
    totalCount,
    ariaLabel,
    describedByListId,
    describedByItems,
    isCoarsePointer,
    isNotable,
    onClick,
  } = props;

  const visibleN = visibleCapacity(shape);
  const { width: markerWidth, height: markerHeight } = markerDimensions(shape);

  // Per-axis hit-extender — corrected formula from issue #541.
  // For non-square markers (e.g. 2×1 = 52×28), a single scalar `inset` using
  // max(w,h) would leave the short axis at 28px. Each axis extends OUTWARD
  // by half its own deficit so BOTH dimensions reach the WCAG target.
  const hitMin = isCoarsePointer ? HIT_MIN_COARSE : HIT_MIN_FINE;
  const widthDeficit = Math.max(0, hitMin - markerWidth);
  const heightDeficit = Math.max(0, hitMin - markerHeight);
  const hitOverlayStyle: CSSProperties = {
    position: 'absolute',
    top: -heightDeficit / 2,
    bottom: -heightDeficit / 2,
    left: -widthDeficit / 2,
    right: -widthDeficit / 2,
    background: 'transparent',
    pointerEvents: 'auto',
  };

  // The badge is hidden ONLY when both the cluster total is 1 AND the cell
  // count is 1 — i.e. the single-observation case, where the marker reads
  // identically to today's individual marker (spec §4.3).
  const showBadgeFor = (cellCount: number): boolean => totalCount > 1 || cellCount > 1;

  return (
    <button
      type="button"
      tabIndex={-1}
      data-testid="adaptive-grid-marker"
      className="adaptive-grid-marker"
      aria-label={ariaLabel}
      aria-describedby={describedByListId}
      onClick={onClick}
      style={{
        position: 'relative',
        padding: 0,
        border: 'none',
        background: 'transparent',
        cursor: 'pointer',
        width: markerWidth,
        height: markerHeight,
      }}
    >
      <span
        data-testid="adaptive-grid-marker-hit"
        className="adaptive-grid-marker__hit"
        aria-hidden="true"
        style={hitOverlayStyle}
      />
      <div
        className="adaptive-grid-marker__grid"
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${shape.cols}, ${CELL_PX}px)`,
          gridTemplateRows: `repeat(${shape.rows}, ${CELL_PX}px)`,
          gap: GRID_GAP_PX,
          padding: GRID_PADDING_PX,
          position: 'relative',
        }}
      >
        {tiles.slice(0, visibleN).map((tile, i) => (
          <TileCell
            key={`${tile.familyCode}-${i}`}
            tile={tile}
            showBadge={showBadgeFor(tile.count)}
            isNotable={isNotable}
          />
        ))}
        {shape.tag === 'grid-overflow' && (
          <div
            data-testid="adaptive-grid-marker-overflow"
            className="adaptive-grid-marker__cell adaptive-grid-marker__overflow"
          >
            +{shape.hiddenCount}
          </div>
        )}
      </div>
      {describedByListId && describedByItems && (
        <ul id={describedByListId} className="sr-only">
          {describedByItems.map((item, idx) => (
            <li key={idx}>{item}</li>
          ))}
        </ul>
      )}
    </button>
  );
}

interface TileCellProps {
  tile: AdaptiveTile;
  showBadge: boolean;
  isNotable?: boolean;
}

function TileCell({ tile, showBadge, isNotable }: TileCellProps) {
  if (tile.kind === 'pending') {
    return (
      <div
        data-testid="adaptive-grid-marker-cell-pending"
        className="adaptive-grid-marker__cell adaptive-grid-marker__cell--pending"
        aria-hidden="true"
      />
    );
  }

  if (tile.kind === 'fallback') {
    return (
      <div
        data-testid="adaptive-grid-marker-cell-fallback"
        className="adaptive-grid-marker__cell adaptive-grid-marker__cell--fallback"
        style={{ opacity: 0.5 }}
      >
        <svg
          viewBox="0 0 24 24"
          width={CELL_PX}
          height={CELL_PX}
          aria-hidden="true"
          focusable="false"
          preserveAspectRatio="xMidYMid meet"
        >
          <path d={FALLBACK_SILHOUETTE_PATH} fill={tile.color} />
        </svg>
        {showBadge && <Badge count={tile.count} />}
      </div>
    );
  }

  // rendered
  return (
    <div
      data-testid="adaptive-grid-marker-cell-rendered"
      className="adaptive-grid-marker__cell"
    >
      <svg
        viewBox="0 0 24 24"
        width={CELL_PX}
        height={CELL_PX}
        aria-hidden="true"
        focusable="false"
        preserveAspectRatio="xMidYMid meet"
      >
        {/*
          Paint order (back → front), matching StackedSilhouetteMarker:
            1. Amber notable ring (only if isNotable)
            2. White halo path (behind silhouette for contrast)
            3. Colored silhouette path
        */}
        {isNotable && (
          <circle
            cx="12"
            cy="12"
            r="11"
            fill="none"
            stroke={NOTABLE_AMBER}
            strokeWidth="2"
          />
        )}
        <path
          d={tile.svgData}
          fill="none"
          stroke="white"
          strokeWidth="2"
          strokeLinejoin="round"
        />
        <path d={tile.svgData} fill={tile.color} />
      </svg>
      {showBadge && <Badge count={tile.count} />}
    </div>
  );
}

function Badge({ count }: { count: number }) {
  return (
    <span
      data-testid="adaptive-grid-marker-badge"
      className="adaptive-grid-marker__badge"
      style={{
        // Inline box-shadow keeps the 1px white stroke contract verifiable
        // in jsdom (which does not load <link> stylesheets). The CSS rule
        // in ds-primitives.css replicates this for the production render.
        boxShadow: '0 0 0 1px rgba(255,255,255,0.9)',
      }}
    >
      {count}
    </span>
  );
}
