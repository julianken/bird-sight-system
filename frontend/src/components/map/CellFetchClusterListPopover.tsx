import { ClusterListPopover } from './ClusterListPopover.js';
import type { ClusterListPopoverProps } from './ClusterListPopover.js';
import { useCellSpecies } from '../../data/cell-species.js';
import type { ApiClient } from '../../api/client.js';
import type { ObservationFilters } from '@bird-watch/shared-types';

/**
 * #859 — wrapper that drives a top-level `<ClusterListPopover>` (the
 * `<ClusterPill>` click path in `MapCanvas`, #717) with the low-zoom
 * per-cell species fetch. Calling `useCellSpecies` requires a component
 * boundary (Rules of Hooks); MapCanvas can't call the hook inline for a
 * conditionally-mounted popover, so this thin wrapper owns the hook and
 * forwards the resolved `cellSpecies` state.
 *
 * Mounted only when the pill click happened in aggregated mode AND a client
 * is available. The fetch fires on mount (the popover is, by definition, open
 * when this is rendered), drilling the whole cluster at synthetic `zoom=6`.
 *
 * #859 fix: the ClusterPill aggregates a MULTI-CELL supercluster. Fetching the
 * single 0.125° cell at its centroid (`center` + `gridZoom`) misses most/all of
 * its observations (the centroid cell is frequently empty), so the caller
 * passes the cluster's union `bbox` (`bboxFromLeaves`) which `useCellSpecies`
 * uses INSTEAD of the centroid cell. `center`/`gridZoom` remain the fallback
 * when no leaf bbox is available.
 */
export interface CellFetchClusterListPopoverProps
  extends Omit<ClusterListPopoverProps, 'cellSpecies'> {
  client: ApiClient;
  center: readonly [number, number];
  gridZoom: number;
  /** Union bbox of the cluster's member leaves; overrides the centroid cell. */
  bbox?: [number, number, number, number];
  since?: ObservationFilters['since'];
  stateCode?: string;
}

export function CellFetchClusterListPopover(props: CellFetchClusterListPopoverProps) {
  const { client, center, gridZoom, bbox, since, stateCode, ...popoverProps } = props;
  const cellSpecies = useCellSpecies(client, {
    active: true,
    center,
    gridZoom,
    ...(bbox ? { bbox } : {}),
    ...(since ? { since } : {}),
    ...(stateCode ? { stateCode } : {}),
  });
  return <ClusterListPopover {...popoverProps} cellSpecies={cellSpecies} />;
}
