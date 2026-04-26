import { useEffect, useRef, useState } from 'react';
import type maplibregl from 'maplibre-gl';
import type { FamilySilhouette } from '@bird-watch/shared-types';
import {
  SPIDER_LEADER_COLOR,
  SPIDER_LEADER_WIDTH,
} from './spiderfy.js';
import {
  groupOverlapping,
  fanPositions,
  type StackInput,
} from './stack-fanout.js';

/** Source / layer ids for the auto-spider leader lines. */
export const AUTO_SPIDER_SOURCE_ID = 'auto-spider-leader-lines';
export const AUTO_SPIDER_LAYER_ID = 'auto-spider-leader-lines-layer';

/**
 * One leaf in the auto-spider state — carries the data needed to render a
 * StackedSilhouetteMarker at the fanned position.
 */
export interface AutoSpiderLeaf {
  subId: string;
  lngLat: [number, number];
  silhouette: { svgData: string | null; color: string };
  comName: string;
  familyCode: string | null;
  locName: string | null;
  obsDt: string;
  isNotable: boolean;
}

/**
 * One auto-spider stack — a group of co-located observations with their
 * fanned leaf positions.
 */
export interface AutoSpiderStack {
  stackId: string;
  centerLngLat: [number, number];
  leaves: AutoSpiderLeaf[];
}

export interface UseAutoSpiderArgs {
  /** Underlying maplibre-gl Map instance. `null` until the map mounts. */
  map: maplibregl.Map | null;
  /** Flips true after the map fires its initial `load` event. */
  mapReady: boolean;
  /**
   * Flips true after sprite registration (`map.addImage` Promise.all)
   * resolves — gates the unclustered-point symbol layer mount in
   * MapCanvas. The reconciler must wait for it before calling
   * `queryRenderedFeatures(..., { layers: ['unclustered-point'] })`,
   * which would otherwise throw "layer does not exist in the map's
   * style".
   */
  spritesReady: boolean;
  /**
   * Family silhouettes from `/api/silhouettes`. The reconciler reads
   * `svgData` + `color` per family to populate each leaf's silhouette
   * payload. When the array is empty the reconciler short-circuits — same
   * guard as the mosaic reconciler.
   */
  silhouettes: readonly FamilySilhouette[];
}

/**
 * Auto-spider reconciler — issue #277, Spider v2 Task 3 (extracted from
 * MapCanvas in #293).
 *
 * On every map `idle` (and once immediately on mount when the map is
 * ready), query the rendered unclustered-point features, project them to
 * screen coords, detect co-located stacks via `groupOverlapping`, and fan
 * each stack's members to distinct positions via `fanPositions`. Fanned
 * positions are unprojected back to lngLat so `<Marker>` placements stay
 * anchored to map coordinates across pan/zoom. The returned
 * AutoSpiderStack array drives the `<Marker>+<StackedSilhouetteMarker>`
 * render in MapCanvas and the `auto-spider-leader-lines` GeoJSON source
 * update.
 *
 * Short-circuit: when `silhouettes` is empty the effect returns early —
 * same guard as the mosaic reconciler. Pan/zoom does NOT close
 * auto-spider (it re-computes on the next idle). Escape only applies to
 * the click-driven spiderfy path; auto-spider has no concept of "closing".
 *
 * Source/layer lifecycle:
 *   - Source + layer are added once on the first reconcile that finds a
 *     non-empty stacks result (idempotent `getLayer` check before
 *     `addLayer`).
 *   - On subsequent reconciles the source is updated via `setData` rather
 *     than removed + re-added (avoids a flicker frame).
 *   - When no stacks are detected the source data is set to an empty
 *     FeatureCollection so leader lines disappear without removing the
 *     source.
 */
export function useAutoSpider({
  map,
  mapReady,
  spritesReady,
  silhouettes,
}: UseAutoSpiderArgs): AutoSpiderStack[] {
  /**
   * Auto-spider stacks. Reconciled on every map `idle` by the effect
   * below. Each entry holds one fanned stack: the center lngLat, and the
   * fanned leaves with their projected marker positions. Cleared to []
   * when no stacks are visible.
   */
  const [autoSpiderStacks, setAutoSpiderStacks] = useState<AutoSpiderStack[]>(
    [],
  );

  // The reconciler reads `silhouettes` on every pass. A ref keeps the
  // closure fresh without re-registering the map listeners (registration
  // is keyed only on the map instance + readiness flags, NOT on the
  // silhouettes array contents).
  const silhouettesRef = useRef(silhouettes);
  silhouettesRef.current = silhouettes;

  useEffect(() => {
    // AC #2: short-circuit when silhouettes aren't loaded yet.
    if (silhouettes.length === 0) return undefined;
    if (!mapReady) return undefined;
    // The auto-spider reconciler queries the 'unclustered-point' layer, which
    // is JSX-conditioned on spritesReady. Calling queryRenderedFeatures with a
    // layers filter that names a not-yet-mounted layer raises
    // "layer does not exist in the map's style". Wait until spritesReady flips.
    if (!spritesReady) return undefined;
    if (!map) return undefined;

    // Build once per effect pass (dep array: [silhouettes.length, mapReady,
    // spritesReady, map]). Silhouettes change at most once per session
    // (empty → populated), so rebuilding on every idle would be wasteful at
    // production obs counts.
    const silByFamily = new Map<string, { svgData: string | null; color: string }>();
    for (const s of silhouettesRef.current) {
      silByFamily.set(s.familyCode.toLowerCase(), {
        svgData: s.svgData,
        color: s.color,
      });
    }

    // Defensive — protects against future async yields in `reconcile`.
    // Today reconcile is synchronous so this flag never fires; kept for
    // forward-compatibility.
    let cancelled = false;

    const reconcile = () => {
      if (cancelled) return;
      const currentSilhouettes = silhouettesRef.current;
      if (currentSilhouettes.length === 0) return;

      // Defensive belt-and-suspenders: catch the case where the layer is
      // removed between effect runs (style reload, hot-module replacement).
      // querySourceFeatures itself doesn't throw on a missing layer (it
      // queries the source, not the layer), but the source-readiness
      // lifecycle still depends on the symbol layer having mounted, so we
      // keep this check as a proxy for "rendering pipeline is alive".
      if (!map.getLayer('unclustered-point')) return;

      // Query the underlying GeoJSON source directly — NOT the rendered
      // layer. The unclustered-point layer carries an
      // `['!=', ['get', 'inStack'], true]` filter (Task 4) so once the
      // reconciler stamps `inStack=true` on a feature, queryRenderedFeatures
      // would stop returning it on subsequent idles, causing the reconciler
      // to "forget" the stack and unstack it on the next idle, which then
      // re-stacks it, and so on — a feedback loop that flickered the
      // viewport (issue #277). querySourceFeatures bypasses layer filters
      // and reads the raw source data, so the reconciler always sees the
      // originally-stacked features.
      const rawFeatures = (map.querySourceFeatures('observations', {
        // Match the unclustered-point layer's first clause — return only
        // unclustered features. We then apply the viewport filter manually
        // below to preserve queryRenderedFeatures' viewport-only semantic
        // (querySourceFeatures returns features in all rendered TILES, which
        // can extend beyond the visible viewport).
        filter: ['!', ['has', 'point_count']],
      }) ?? []) as Array<{
        properties?: Record<string, unknown>;
        geometry?: { type: string; coordinates: unknown };
      }>;

      // querySourceFeatures returns one feature per tile boundary a feature
      // crosses; dedupe by subId so the same obs doesn't end up in multiple
      // stacks (which would produce React duplicate-key warnings on the
      // stacked-silhouette-marker JSX). Same shape as the mosaic
      // reconciler's dedupe on cluster_id above.
      const seenSubIds = new Set<string>();
      const features = rawFeatures.filter((f) => {
        const subId = f.properties?.['subId'];
        if (typeof subId !== 'string') return false;
        if (seenSubIds.has(subId)) return false;
        seenSubIds.add(subId);
        return true;
      });

      // Compute viewport bounds for the manual filter below. getContainer()
      // returns the map's wrapper div; getBoundingClientRect gives device-
      // pixel dimensions that match map.project's screen-coord output.
      const container = map.getContainer();
      const { width: viewportWidth, height: viewportHeight } =
        container.getBoundingClientRect();

      // Build StackInput array — one per feature with screen projection.
      const inputs: StackInput[] = [];
      for (const f of features) {
        const props = f.properties;
        if (!props) continue;
        const geom = f.geometry;
        if (!geom || geom.type !== 'Point') continue;
        const coords = geom.coordinates as [number, number];
        if (!Array.isArray(coords) || coords.length < 2) continue;

        const subId = props.subId as string | undefined;
        if (!subId) continue;

        const comName = (props.comName as string | undefined) ?? '';
        const familyCode = (props.familyCode as string | null | undefined) ?? null;
        const locName = (props.locName as string | null | undefined) ?? null;
        const obsDt = (props.obsDt as string | undefined) ?? '';
        const isNotable = Boolean(props.isNotable);
        const silhouetteId = (props.silhouetteId as string | undefined) ?? '';
        const color = (props.color as string | undefined) ?? '#888888';

        // Project lngLat → screen coords.
        const screen = map.project([coords[0], coords[1]]);

        // Viewport filter — querySourceFeatures returns features in all
        // rendered tiles (which extend beyond the visible viewport on
        // tile boundaries). queryRenderedFeatures(undefined, ...) only
        // returned viewport-visible features, so we replicate that here.
        if (
          screen.x < 0 ||
          screen.x > viewportWidth ||
          screen.y < 0 ||
          screen.y > viewportHeight
        ) {
          continue;
        }

        inputs.push({
          subId,
          comName,
          familyCode,
          silhouetteId,
          color,
          isNotable,
          obsDt,
          locName,
          screen: { x: screen.x, y: screen.y },
          lngLat: [coords[0], coords[1]],
        });
      }

      // Detect co-located stacks.
      const stacks = groupOverlapping(inputs);

      if (cancelled) return;

      // Build AutoSpiderStack array from detected stacks.
      const nextStacks: AutoSpiderStack[] = [];
      const leaderFeatures: Array<{
        type: 'Feature';
        geometry: { type: 'LineString'; coordinates: [[number, number], [number, number]] };
        properties: Record<string, string>;
      }> = [];

      for (const [si, stack] of stacks.entries()) {
        const stackId = `stack-${si}`;
        const fanned = fanPositions(stack);
        const leaves: AutoSpiderLeaf[] = [];

        for (const fan of fanned) {
          // Find the matching input member.
          const member = stack.members.find((m) => m.subId === fan.subId);
          if (!member) continue;

          // Unproject screen → lngLat for the Marker placement. The
          // `{ x, y }` literal is a structural match for maplibre's
          // `PointLike`, but the strict typing from `maplibregl.Map.unproject`
          // expects a class-instance `Point`. Cast widens the param to the
          // looser `PointLike` semantic the runtime actually accepts —
          // matches the `as any` pattern MapCanvas uses elsewhere on this
          // intra-package boundary. The return is also widened so the
          // `'lng' in ...` runtime branch (which handles both maplibre's
          // LngLat and the `[lng, lat]` tuple shape returned by some test
          // mocks) typechecks.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const unprojected = (map.unproject as (p: any) => any)({
            x: fan.screen.x,
            y: fan.screen.y,
          }) as { lng: number; lat: number } | [number, number];
          const leafLng =
            'lng' in unprojected
              ? (unprojected as { lng: number }).lng
              : (unprojected as [number, number])[0];
          const leafLat =
            'lat' in unprojected
              ? (unprojected as { lat: number }).lat
              : (unprojected as [number, number])[1];
          const leafLngLat: [number, number] = [leafLng, leafLat];

          // Resolve silhouette svgData from silhouettesRef (NOT from feature
          // properties — silhouetteId is a sprite name, not svgData).
          const familyKey = member.familyCode?.toLowerCase() ?? null;
          const sil = familyKey ? silByFamily.get(familyKey) : undefined;
          const silhouette = {
            svgData: sil?.svgData ?? null,
            color: sil?.color ?? member.color,
          };

          leaves.push({
            subId: member.subId,
            lngLat: leafLngLat,
            silhouette,
            comName: member.comName,
            familyCode: member.familyCode,
            locName: member.locName,
            obsDt: member.obsDt,
            isNotable: member.isNotable,
          });

          // One LineString per leaf: origin = stack center lngLat → leaf lngLat.
          leaderFeatures.push({
            type: 'Feature',
            geometry: {
              type: 'LineString',
              coordinates: [stack.centerLngLat, leafLngLat],
            },
            properties: { subId: member.subId, stackId },
          });
        }

        if (leaves.length > 0) {
          nextStacks.push({ stackId, centerLngLat: stack.centerLngLat, leaves });
        }
      }

      if (cancelled) return;

      // Update leader-line source. The source persists across reconcile
      // passes; add it once (idempotent getLayer check) then use setData.
      const leaderGeoJson = {
        type: 'FeatureCollection' as const,
        features: leaderFeatures,
      };

      const rawSource = map.getSource(AUTO_SPIDER_SOURCE_ID);
      const existingSource =
        rawSource != null &&
        typeof (rawSource as unknown as { setData?: unknown }).setData ===
          'function'
          ? (rawSource as unknown as { setData: (data: unknown) => void })
          : null;

      if (!existingSource) {
        // First reconcile that touches the source (or mock returned a non-
        // GeoJSON source without setData — treat as absent). Add source + layer.
        // Guard against double-add on re-render by checking getLayer first.
        if (!rawSource) {
          map.addSource(AUTO_SPIDER_SOURCE_ID, {
            type: 'geojson',
            data: leaderGeoJson,
          });
        }
        if (!map.getLayer(AUTO_SPIDER_LAYER_ID)) {
          map.addLayer({
            id: AUTO_SPIDER_LAYER_ID,
            type: 'line',
            source: AUTO_SPIDER_SOURCE_ID,
            paint: {
              'line-color': SPIDER_LEADER_COLOR,
              'line-width': SPIDER_LEADER_WIDTH,
            },
          });
        }
      } else {
        existingSource.setData(leaderGeoJson);
      }

      setAutoSpiderStacks((prev) =>
        prev.length === 0 && nextStacks.length === 0 ? prev : nextStacks,
      );
    };

    const onLoad = () => { reconcile(); };
    const onIdle = () => { reconcile(); };
    map.on('load', onLoad);
    map.on('idle', onIdle);
    // Run once immediately for maps already at rest.
    reconcile();

    return () => {
      cancelled = true;
      map.off('load', onLoad);
      map.off('idle', onIdle);
    };
    // Re-register when silhouettes flip empty↔populated, when the map first
    // becomes ready, OR when sprites finish registering (spritesReady is the
    // gate that lets the unclustered-point layer mount; we must wait for it
    // before querying that layer). The closure reads live silhouettes via
    // silhouettesRef.
  }, [silhouettes.length, mapReady, spritesReady, map]);

  return autoSpiderStacks;
}
