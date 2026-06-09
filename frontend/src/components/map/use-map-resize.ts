import { useEffect } from 'react';
import type { RefObject } from 'react';

/**
 * Corrective `map.resize()` ResizeObserver hook (extracted from MapCanvas.tsx,
 * epic #884 · U9). The wrapper ref + its JSX stay in `MapCanvas`; only the
 * effect moves here.
 *
 * Corrective `map.resize()` on the S2 flex→fixed container transition (#737,
 * gap 8 of #761). Before S2 the map was a `flex: 1; min-height: 0` child of a
 * padded `<main>`; S2 hoisted it into `#map-layer` (`position: fixed; inset: 0`)
 * and `.map-surface` became `position: absolute; inset: 0`. That swaps the
 * CONTAINING BLOCK (a reparent/reflow), and maplibre's built-in observer on the
 * inner GL container does not always re-read `_containerDimensions` for the new
 * full-viewport box on the first paint — leaving a one-frame mis-sized canvas
 * (clipped tiles, off-by-padding marker projection).
 *
 * Fix: a `ResizeObserver` on the `data-testid="map-canvas"` wrapper (the box
 * whose containing block changed). It is the robust form because the box can
 * change AGAIN after the one-time reparent (theme-toggle reflow, the detail
 * rail/sheet opening alongside the fixed map, mobile URL-bar show/hide changing
 * 100vh). The observer is:
 *   - CAMERA-NEUTRAL: it only calls `map.resize()` — never `fitBounds`/`flyTo`/
 *     a refetch — so it cannot schedule a bbox `/api/observations` (the S4
 *     scope-gate invariant, report R1).
 *   - IDEMPOTENT / debounced: coalesced to the next animation frame so a burst
 *     of observer fires (including maplibre's own internal observer churn during
 *     the same reflow) collapses to a single `resize()`; a pending frame is
 *     guarded so we never stack rAFs.
 *   - DISCONNECTED on cleanup (observer + any pending rAF), so a `<Map>` remount
 *     across a scope pick leaks neither.
 * `mapReady`-gated so `getMap()` is live. The first observe-callback fire (which
 * ResizeObserver delivers on `observe()`) doubles as the one-shot post-`mapReady`
 * correction for the initial reparent.
 */

/**
 * The minimal maplibre-map surface this hook touches: only `resize()`.
 * Deliberately NOT maplibre's full `Map` (same idiom as `silhouette-sprite.ts`'s
 * `SpriteMap` and `artboard-layers.ts`'s `ArtboardMap`): the narrow shape keeps
 * the hook unit-testable against a spy and documents the exact dependency
 * surface — the camera-neutral invariant is visible in the type.
 */
export interface MapResizeMap {
  resize: () => void;
}

/**
 * The minimal react-map-gl `MapRef` surface: only `getMap()`, returning a
 * {@link MapResizeMap}. `mapRef.current?.getMap()` is the live maplibre handle.
 */
export interface MapResizeMapRef {
  getMap: () => MapResizeMap;
}

/** The wrapper element the observer watches (the `data-testid="map-canvas"` div). */
export type MapResizeTarget = Element;

/**
 * Observe `mapWrapperRef`'s box and issue a rAF-debounced, camera-neutral
 * `map.resize()` on every change (including the one-shot post-`mapReady`
 * reparent correction the observer delivers on `observe()`).
 *
 * @param mapRef        ref to the react-map-gl `MapRef` (`getMap()` → maplibre)
 * @param mapWrapperRef ref to the wrapper div whose containing block flips in S2
 * @param mapReady      gate: only wire the observer once `getMap()` is live
 */
export function useMapResize(
  mapRef: RefObject<MapResizeMapRef | null>,
  mapWrapperRef: RefObject<MapResizeTarget | null>,
  mapReady: boolean,
): void {
  useEffect(() => {
    if (!mapReady) return;
    const map = mapRef.current?.getMap();
    const wrapper = mapWrapperRef.current;
    if (!map || !wrapper || typeof ResizeObserver === 'undefined') return;

    let frame = 0;
    const observer = new ResizeObserver(() => {
      // Coalesce a burst of box changes (and maplibre's own internal observer
      // churn during the same reflow) into a single rAF-batched resize. Camera-
      // neutral: resize() recomputes the canvas/transform for the new box only.
      if (frame !== 0) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        map.resize();
      });
    });
    observer.observe(wrapper);

    return () => {
      observer.disconnect();
      if (frame !== 0) cancelAnimationFrame(frame);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mapReady is the
    // intentional gate; mapRef/mapWrapperRef are stable ref containers read
    // imperatively inside the effect (1:1 with the pre-extraction dep array).
  }, [mapReady]);
}
