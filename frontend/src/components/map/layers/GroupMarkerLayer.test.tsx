import { forwardRef, useImperativeHandle } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GroupMarkerLayer } from './GroupMarkerLayer.js';
import type { DeconflictGroup, DeconflictInput, RenderedShape } from '@/components/map/geometry/deconflict.js';
import type { ResolvedGrid } from '@/components/map/geometry/adaptive-grid.js';

/* ── Mocks ───────────────────────────────────────────────────────────────────
   The layer wraps every marker in <PresentationMarker>, which itself wraps the
   react-map-gl/maplibre <Marker>. The Marker mock forwardRefs + exposes a real
   getElement() node (so PresentationMarker's #459 role-strip effect runs and we
   can assert it), and renders children inline with lng/lat as data attributes.

   AdaptiveGridMarker and ClusterPill are mocked as lightweight test doubles so
   the dispatch (pill→ClusterPill, grid→AdaptiveGridMarker, silhouette→null) is
   assertable by data-testid without dragging in their full render trees. */
let markerSeq = 0;
vi.mock('react-map-gl/maplibre', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Marker: forwardRef(function Marker({ children, longitude, latitude }: any, ref: any) {
    const el = document.createElement('div');
    useImperativeHandle(ref, () => ({ getElement: () => el }), []);
    return (
      <div data-testid="mock-marker" data-lng={longitude} data-lat={latitude}>
        {children}
      </div>
    );
  }),
}));

vi.mock('./AdaptiveGridMarker.js', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  AdaptiveGridMarker: ({ onClick, onDrillIn, onSelectSpecies, ariaLabel }: any) => (
    <button
      type="button"
      data-testid="mock-grid-marker"
      data-aria={ariaLabel}
      data-has-drill={onDrillIn ? 'yes' : 'no'}
      data-has-select={onSelectSpecies ? 'yes' : 'no'}
      onClick={onClick}
    >
      {onDrillIn ? (
        <span data-testid="drill-trigger" onClick={() => onDrillIn()} />
      ) : null}
    </button>
  ),
}));

vi.mock('@/components/ds/ClusterPill.js', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ClusterPill: ({ count, onClick }: any) => (
    <button type="button" data-testid="mock-cluster-pill" data-count={count} onClick={onClick} />
  ),
}));

// Helpers --------------------------------------------------------------------

const GRID_1x1: ResolvedGrid = { tag: 'grid', cols: 1, rows: 1 };

function input(rendered: RenderedShape, over: Partial<DeconflictInput> = {}): DeconflictInput {
  return {
    cluster_id: 1,
    px: 0,
    py: 0,
    rendered,
    point_count: 3,
    uniqueFamilies: 1,
    longitude: -110.9,
    latitude: 32.2,
    ...over,
  };
}

function group(
  key: string,
  rendered: RenderedShape,
  over: Partial<DeconflictInput> = {},
): DeconflictGroup {
  return {
    anchor: input(rendered, over),
    memberIds: [1],
    key,
    ariaLabel: `aria-${key}`,
    leaves: [],
  };
}

const noop = () => {};

describe('GroupMarkerLayer', () => {
  beforeEach(() => {
    markerSeq = 0;
  });

  it("renders a ClusterPill for a 'pill' anchor, passing its count", () => {
    render(
      <GroupMarkerLayer
        groups={[group('g-pill', { kind: 'pill', count: 7 }, { point_count: 7 })]}
        isCoarsePointer={false}
        detailOpen={false}
        onGroupClick={noop}
        onDrillIn={noop}
      />,
    );
    const pill = screen.getByTestId('mock-cluster-pill');
    expect(pill).toHaveAttribute('data-count', '7');
    expect(screen.queryByTestId('mock-grid-marker')).toBeNull();
  });

  it("renders an AdaptiveGridMarker for a 'grid' anchor", () => {
    render(
      <GroupMarkerLayer
        groups={[group('g-grid', { kind: 'grid', shape: GRID_1x1 })]}
        isCoarsePointer={false}
        detailOpen={false}
        onGroupClick={noop}
        onDrillIn={noop}
      />,
    );
    const grid = screen.getByTestId('mock-grid-marker');
    expect(grid).toHaveAttribute('data-aria', 'aria-g-grid');
    expect(screen.queryByTestId('mock-cluster-pill')).toBeNull();
  });

  it("renders NOTHING for a 'silhouette' anchor (canvas symbol layer paints it)", () => {
    render(
      <GroupMarkerLayer
        groups={[group('g-sil', { kind: 'silhouette' })]}
        isCoarsePointer={false}
        detailOpen={false}
        onGroupClick={noop}
        onDrillIn={noop}
      />,
    );
    expect(screen.queryByTestId('mock-marker')).toBeNull();
    expect(screen.queryByTestId('mock-grid-marker')).toBeNull();
    expect(screen.queryByTestId('mock-cluster-pill')).toBeNull();
  });

  it('dispatches a mixed slice: pill + grid + silhouette → pill, grid, (null)', () => {
    render(
      <GroupMarkerLayer
        groups={[
          group('g-pill', { kind: 'pill', count: 4 }, { point_count: 4 }),
          group('g-grid', { kind: 'grid', shape: GRID_1x1 }),
          group('g-sil', { kind: 'silhouette' }),
        ]}
        isCoarsePointer={false}
        detailOpen={false}
        onGroupClick={noop}
        onDrillIn={noop}
      />,
    );
    expect(screen.getAllByTestId('mock-cluster-pill')).toHaveLength(1);
    expect(screen.getAllByTestId('mock-grid-marker')).toHaveLength(1);
    // pill + grid render markers; silhouette renders none → 2 markers total.
    expect(screen.getAllByTestId('mock-marker')).toHaveLength(2);
  });

  it('keys each marker on g.key — stable identity under re-render (#552 churn class)', () => {
    const groups = [group('bucket-A', { kind: 'pill', count: 2 }, { point_count: 2 })];
    const { rerender } = render(
      <GroupMarkerLayer
        groups={groups}
        isCoarsePointer={false}
        detailOpen={false}
        onGroupClick={noop}
        onDrillIn={noop}
      />,
    );
    const first = screen.getByTestId('mock-marker');
    // Re-render with a NEW group array but the SAME key → React reuses the node.
    rerender(
      <GroupMarkerLayer
        groups={[group('bucket-A', { kind: 'pill', count: 5 }, { point_count: 5 })]}
        isCoarsePointer={false}
        detailOpen={false}
        onGroupClick={noop}
        onDrillIn={noop}
      />,
    );
    const second = screen.getByTestId('mock-marker');
    // Same DOM node identity ⇒ React reconciled by key, did not remount.
    expect(second).toBe(first);
    expect(screen.getByTestId('mock-cluster-pill')).toHaveAttribute('data-count', '5');
  });

  it('forwards the clicked element to onGroupClick from a pill click', () => {
    const onGroupClick = vi.fn();
    render(
      <GroupMarkerLayer
        groups={[group('g-pill', { kind: 'pill', count: 3 }, { point_count: 3 })]}
        isCoarsePointer={false}
        detailOpen={false}
        onGroupClick={onGroupClick}
        onDrillIn={noop}
      />,
    );
    const pill = screen.getByTestId('mock-cluster-pill');
    fireEvent.click(pill);
    expect(onGroupClick).toHaveBeenCalledTimes(1);
    // arg 0 = the group; arg 1 = the clicked element (e.currentTarget).
    expect(onGroupClick.mock.calls[0][0].key).toBe('g-pill');
    expect(onGroupClick.mock.calls[0][1]).toBe(pill);
  });

  it('passes the group (no element) to onGroupClick from a grid-marker click', () => {
    const onGroupClick = vi.fn();
    render(
      <GroupMarkerLayer
        groups={[group('g-grid', { kind: 'grid', shape: GRID_1x1 })]}
        isCoarsePointer={false}
        detailOpen={false}
        onGroupClick={onGroupClick}
        onDrillIn={noop}
      />,
    );
    fireEvent.click(screen.getByTestId('mock-grid-marker'));
    expect(onGroupClick).toHaveBeenCalledTimes(1);
    expect(onGroupClick.mock.calls[0][0].key).toBe('g-grid');
  });

  it('wires onDrillIn with the anchor lng/lat when both coords are present', () => {
    const onDrillIn = vi.fn();
    render(
      <GroupMarkerLayer
        groups={[group('g-grid', { kind: 'grid', shape: GRID_1x1 }, { longitude: -111, latitude: 34 })]}
        isCoarsePointer={false}
        detailOpen={false}
        onGroupClick={noop}
        onDrillIn={onDrillIn}
      />,
    );
    expect(screen.getByTestId('mock-grid-marker')).toHaveAttribute('data-has-drill', 'yes');
    fireEvent.click(screen.getByTestId('drill-trigger'));
    expect(onDrillIn).toHaveBeenCalledWith([-111, 34]);
  });

  it('omits onDrillIn when the anchor lacks coordinates', () => {
    render(
      <GroupMarkerLayer
        groups={[group('g-grid', { kind: 'grid', shape: GRID_1x1 }, { longitude: undefined, latitude: undefined })]}
        isCoarsePointer={false}
        detailOpen={false}
        onGroupClick={noop}
        onDrillIn={noop}
      />,
    );
    expect(screen.getByTestId('mock-grid-marker')).toHaveAttribute('data-has-drill', 'no');
  });

  it('threads onSelectSpecies through to the grid marker only when provided', () => {
    const { rerender } = render(
      <GroupMarkerLayer
        groups={[group('g-grid', { kind: 'grid', shape: GRID_1x1 })]}
        isCoarsePointer={false}
        detailOpen={false}
        onGroupClick={noop}
        onDrillIn={noop}
      />,
    );
    expect(screen.getByTestId('mock-grid-marker')).toHaveAttribute('data-has-select', 'no');

    rerender(
      <GroupMarkerLayer
        groups={[group('g-grid', { kind: 'grid', shape: GRID_1x1 })]}
        isCoarsePointer={false}
        detailOpen={false}
        onGroupClick={noop}
        onDrillIn={noop}
        onSelectSpecies={() => {}}
      />,
    );
    expect(screen.getByTestId('mock-grid-marker')).toHaveAttribute('data-has-select', 'yes');
  });
});
