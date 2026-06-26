import { AdaptiveGridMarker } from './AdaptiveGridMarker.js';
import { PresentationMarker } from './PresentationMarker.js';
import { ClusterPill } from '@/components/ds/ClusterPill.js';
import type { DeconflictGroup } from '@/components/map/geometry/deconflict.js';

/**
 * GroupMarkerLayer — presentational dispatch for the unified deconflict render
 * (issue #554), extracted verbatim from `MapCanvas.tsx` (epic #884 · U11 / #896).
 *
 * Iterates the `groups` slice — one entry per overlap component — and dispatches
 * to `<ClusterPill>`, the canvas symbol layer (null), or `<AdaptiveGridMarker>`
 * based on the anchor's `rendered.kind`. The spatial-bucket key (`group.key`) is
 * stable when the anchor stays in the same ~14px bucket, so React's reconciler
 * doesn't churn under pan (#552 churn class).
 *
 * Presentational only: holds NO map ref, inspects no shape to pick a domain
 * action. The parent (`MapCanvas`) owns all handlers (`onGroupClick`,
 * `onSelectSpecies`, `onDrillIn`) and derived state; this component selects which
 * handler each branch wires and renders. Exemplar idiom: `AdaptiveGridMarker.tsx`.
 */
interface GroupMarkerLayerProps {
  groups: DeconflictGroup[];
  isCoarsePointer: boolean;
  detailOpen: boolean;
  /** `MapCanvas.handleGroupClick` — receives the group + (for pills) the clicked element. */
  onGroupClick: (group: DeconflictGroup, anchorEl?: HTMLElement | null) => void;
  /** `MapCanvas`'s `onSelectSpecies` prop, threaded through to grid markers. */
  onSelectSpecies?: (speciesCode: string) => void;
  /** `MapCanvas.handleDrillInToCenter`, invoked from the grid marker's "+N more". */
  onDrillIn: (center: [number, number]) => void;
}

export function GroupMarkerLayer({
  groups,
  isCoarsePointer,
  detailOpen,
  onGroupClick,
  onSelectSpecies,
  onDrillIn,
}: GroupMarkerLayerProps) {
  return (
    <>
      {groups.map((g) => {
        const { anchor } = g;
        // longitude/latitude are populated for every production input
        // (the reconciler push above); fall back to 0 only to satisfy
        // the optional-typed signature for unit-test consumers.
        const longitude = anchor.longitude ?? 0;
        const latitude = anchor.latitude ?? 0;
        if (anchor.rendered.kind === 'pill') {
          return (
            <PresentationMarker
              key={g.key}
              longitude={longitude}
              latitude={latitude}
              anchor="center"
            >
              <ClusterPill
                // #1277: the pill badge reflects EVERY cluster the deconflict
                // group absorbed, not just the anchor — otherwise a filtered
                // view drops the non-anchor members' counts. For a solo group
                // `renderedTotal === anchor.point_count`, so unmerged pills are
                // unchanged.
                count={g.renderedTotal}
                onClick={(e) => onGroupClick(g, e.currentTarget)}
              />
            </PresentationMarker>
          );
        }
        if (anchor.rendered.kind === 'silhouette') {
          // Silhouette-only group (no cluster overlaps this silhouette).
          // The canvas-painted symbol layer already paints it at the
          // correct lng/lat — no React marker needed. Returning null
          // keeps the loop's render output sparse so React doesn't
          // reconcile an empty marker.
          return null;
        }
        return (
          <PresentationMarker
            key={g.key}
            longitude={longitude}
            latitude={latitude}
          >
            <AdaptiveGridMarker
              shape={anchor.rendered.shape}
              tiles={anchor.tiles ?? []}
              // #1277: conserve the group's full count — sum of every absorbed
              // cluster, not just the anchor. For a solo group this equals
              // `anchor.point_count`, so unmerged grid markers are unchanged.
              totalCount={g.renderedTotal}
              uniqueFamilies={anchor.uniqueFamilies}
              ariaLabel={g.ariaLabel}
              isCoarsePointer={isCoarsePointer}
              isNotable={anchor.isNotable ?? false}
              detailOpen={detailOpen}
              onClick={() => onGroupClick(g)}
              {...(onSelectSpecies ? {
                onSelectSpecies: (code: string) => onSelectSpecies(code),
              } : {})}
              {...(anchor.longitude !== undefined && anchor.latitude !== undefined
                ? {
                    // #859: the per-family <CellPopover> "+N more" eases the
                    // camera into this marker's cell center — the SAME active
                    // drill-in the cluster-list path uses. The marker decides
                    // (via tile.speciesCount) whether to actually offer it.
                    onDrillIn: () => onDrillIn([longitude, latitude]),
                  }
                : {})}
            />
          </PresentationMarker>
        );
      })}
    </>
  );
}
