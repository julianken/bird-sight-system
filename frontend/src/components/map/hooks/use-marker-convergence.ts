import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import type { MapSourceDataEvent } from 'maplibre-gl';

/**
 * Marker-convergence watchdog (#1236) — fully self-contained.
 *
 * THE BUG: after a scope change, the adaptive-grid reconciler (MapCanvas) only
 * reconnects to a z>=6 `observations` swap via the camera `idle` event, which
 * can fire too early or never re-fire on a quiescent map — stranding the prior
 * scope's markers until the user pans.
 *
 * THIS HOOK owns everything end-to-end and touches NO existing map code:
 *   - its OWN `idle` listener STAMPS convergence (idle => settled + PAINTED =>
 *     MapCanvas's own idle->reconcile reflects the latest data => safe to record
 *     "current data is on screen");
 *   - its OWN `sourcedata` listener DRIVES a refresh via `map.triggerRepaint()`
 *     the instant the worker finishes (re)clustering — provoking the EXISTING
 *     idle->reconcile, with no reach into it;
 *   - a bounded watchdog `triggerRepaint`s until convergence, so the refresh
 *     happens without a user pan.
 *
 * REMOVABILITY: the whole feature is THIS FILE + ONE call line in MapCanvas.
 * `reconcile`/`onIdle`/`onLoad`/the commit are untouched. To turn it off, revert
 * the PR (or delete this file + the call line). Nothing to un-thread.
 *
 * WHY STAMP ONLY ON `idle`: `isSourceLoaded` is the worker "clustering done"
 * flag, NOT a paint signal; `queryRenderedFeatures` reads the painted frame.
 * `idle` (fired only at `!isMoving() && loaded()`) is the only settled+painted
 * signal — so `sourcedata`/the watchdog only DRIVE, never stamp.
 */

/** Narrow maplibre surface this hook touches — keeps it spy-testable. */
export interface ConvergenceMap {
  triggerRepaint(): void;
  on(type: 'idle', listener: () => void): unknown;
  on(type: 'sourcedata', listener: (e: MapSourceDataEvent) => void): unknown;
  off(type: 'idle', listener: () => void): unknown;
  off(type: 'sourcedata', listener: (e: MapSourceDataEvent) => void): unknown;
}

/** Minimal react-map-gl MapRef surface: `getMap()` → {@link ConvergenceMap}. */
export interface ConvergenceMapRef {
  getMap(): ConvergenceMap | undefined;
}

export interface MarkerConvergenceTelemetry {
  attempts: number;
  elapsedMs: number;
}

export interface MarkerConvergenceOptions {
  budgetMs?: number;
  backoffMs?: readonly number[];
  onTelemetry?: (t: MarkerConvergenceTelemetry) => void;
  now?: () => number;
}

const DEFAULT_BACKOFF = [100, 200, 400, 800] as const;
const DEFAULT_BUDGET_MS = 2000;

/**
 * @param mapRef      react-map-gl MapRef (`getMap()` → maplibre handle)
 * @param mapReady    gate: only wire listeners/watchdog once `getMap()` is live
 * @param dataVersion any value whose IDENTITY changes when the rendered data
 *                    changes (pass the `geojson` FeatureCollection). The hook
 *                    only compares identity; it never reads it.
 */
export function useMarkerConvergence(
  mapRef: RefObject<ConvergenceMapRef | null>,
  mapReady: boolean,
  dataVersion: unknown,
  options: MarkerConvergenceOptions = {},
): void {
  const {
    budgetMs = DEFAULT_BUDGET_MS,
    backoffMs = DEFAULT_BACKOFF,
    onTelemetry,
    now,
  } = options;

  // Render-phase data-generation counter: bumps when the rendered data identity
  // changes. The "expected" side. (Same "compare-prev-prop-in-render" idiom the
  // MapCanvas #872 boundsKey clear uses; no setState.)
  const dataGenRef = useRef(0);
  const prevDataVersionRef = useRef(dataVersion);
  if (prevDataVersionRef.current !== dataVersion) {
    prevDataVersionRef.current = dataVersion;
    dataGenRef.current += 1;
  }
  const dataGen = dataGenRef.current;

  // The "displayed" side: stamped by THIS hook's own idle listener.
  const committedGenRef = useRef(0);

  // Listeners — own `idle` (stamp) + `sourcedata` (drive). Registered once the
  // map is live; touches no existing map code.
  useEffect(() => {
    if (!mapReady) return;
    const map = mapRef.current?.getMap();
    if (!map) return;

    // idle => settled + PAINTED => MapCanvas's own idle->reconcile reflects the
    // latest data on this frame => safe to record dataGen as displayed.
    const onIdle = () => {
      committedGenRef.current = dataGenRef.current;
    };

    let sourceDataFrame = 0;
    const onSourceData = (e: MapSourceDataEvent) => {
      if (e.sourceId !== 'observations' || !e.isSourceLoaded) return;
      // The worker-done signal for the clustered observations GeoJSON source is
      // `isSourceLoaded` flipping true — verified live to arrive with
      // sourceDataType UNDEFINED (the `content` subtype fires earlier, while the
      // source is still unloaded). So gate ONLY on sourceId + isSourceLoaded (the
      // canonical MapLibre HTML-cluster pattern); rAF-coalesce absorbs the rest.
      if (sourceDataFrame !== 0) return;
      // Drive: provoke the EXISTING idle->reconcile the instant the worker
      // finishes (re)clustering. rAF-coalesced (sourcedata is chatty).
      sourceDataFrame = requestAnimationFrame(() => {
        sourceDataFrame = 0;
        map.triggerRepaint();
      });
    };

    map.on('idle', onIdle);
    map.on('sourcedata', onSourceData);
    return () => {
      map.off('idle', onIdle);
      map.off('sourcedata', onSourceData);
      if (sourceDataFrame !== 0) cancelAnimationFrame(sourceDataFrame);
    };
  }, [mapReady]);

  // Watchdog — re-arms per data generation; triggerRepaints (manufacturing
  // stamping idles) until committedGen catches up, then self-cancels.
  useEffect(() => {
    if (!mapReady) return;
    const reflected = () => committedGenRef.current >= dataGen;
    // Zero-cost exit: already reflected (the common case, incl. cold-mount
    // dataGen===0). No repaint, no telemetry.
    if (reflected()) return;

    const map = mapRef.current?.getMap();
    if (!map) return;

    const clock = now ?? (() => performance.now());
    const start = clock();
    let cancelled = false;
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const stop = () => {
      cancelled = true;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    };

    const tick = () => {
      timer = null;
      if (cancelled || reflected()) return stop();
      if (clock() - start >= budgetMs) {
        // Backstop: one more repaint (guaranteed-refresh attempt via the
        // existing idle->reconcile — no camera move, no refetch) + record it.
        map.triggerRepaint();
        onTelemetry?.({ attempts, elapsedMs: clock() - start });
        return stop();
      }
      attempts += 1;
      map.triggerRepaint();
      const delay = backoffMs[Math.min(attempts - 1, backoffMs.length - 1)] ?? 0;
      timer = setTimeout(tick, delay);
    };

    tick();
    return stop;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dataGen is the
    // intentional re-arm key; mapReady gates liveness. mapRef/committedGenRef
    // are stable ref containers read imperatively; options read once.
  }, [dataGen, mapReady]);
}
