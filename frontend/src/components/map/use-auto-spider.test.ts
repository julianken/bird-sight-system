import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import type maplibregl from 'maplibre-gl';
import type { FamilySilhouette } from '@bird-watch/shared-types';
import { useAutoSpider } from './use-auto-spider.js';

/* ── Smoke tests for the extracted useAutoSpider hook (issue #293) ─────
   The full behavioral coverage lives in MapCanvas.test.tsx — those tests
   render the parent and exercise the reconciler end-to-end through the
   `idle` and `load` event handlers. These hook-level smokes only pin two
   short-circuit paths so a regression that breaks them surfaces in
   isolation. Anything more elaborate would duplicate the integration
   coverage in MapCanvas.test.tsx. */

const SILHOUETTES: FamilySilhouette[] = [
  {
    familyCode: 'tyrannidae',
    color: '#C77A2E',
    svgData: 'M0 0L1 1Z',
    source: 'placeholder',
    license: 'CC0',
    commonName: 'Tyrant Flycatchers',
    creator: null,
  },
];

describe('useAutoSpider', () => {
  it('returns [] initially when map is null', () => {
    const { result } = renderHook(() =>
      useAutoSpider({
        map: null,
        mapReady: false,
        spritesReady: false,
        silhouettes: SILHOUETTES,
      }),
    );
    expect(result.current).toEqual([]);
  });

  it('short-circuits without side effects when silhouettes is empty', () => {
    // A fully-stocked map mock — every method is a spy. With silhouettes
    // empty the effect must return early before invoking anything on the
    // map. This protects the AC #2 short-circuit (ingest cache miss /
    // API failure on cold load).
    const map = {
      on: vi.fn(),
      off: vi.fn(),
      getLayer: vi.fn(),
      getSource: vi.fn(),
      addSource: vi.fn(),
      addLayer: vi.fn(),
      querySourceFeatures: vi.fn(),
      queryRenderedFeatures: vi.fn(),
      project: vi.fn(),
      unproject: vi.fn(),
      getContainer: vi.fn(),
    } as unknown as maplibregl.Map;

    const { result } = renderHook(() =>
      useAutoSpider({
        map,
        mapReady: true,
        spritesReady: true,
        silhouettes: [],
      }),
    );
    expect(result.current).toEqual([]);
    // No listener registration — no `idle`/`load` `on()` call, no source
    // / layer mutation. If the short-circuit regresses, every spy below
    // would record at least one invocation.
    expect((map.on as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
    expect((map.off as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
    expect((map.addSource as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
    expect((map.addLayer as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
    expect((map.querySourceFeatures as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it('does NOT register listeners when mapReady is false', () => {
    // Mirror of the silhouettes-empty case for the mapReady gate.
    const map = {
      on: vi.fn(),
      off: vi.fn(),
      getLayer: vi.fn(),
      getSource: vi.fn(),
      addSource: vi.fn(),
      addLayer: vi.fn(),
      querySourceFeatures: vi.fn(),
      queryRenderedFeatures: vi.fn(),
      project: vi.fn(),
      unproject: vi.fn(),
      getContainer: vi.fn(),
    } as unknown as maplibregl.Map;

    const { result } = renderHook(() =>
      useAutoSpider({
        map,
        mapReady: false,
        spritesReady: true,
        silhouettes: SILHOUETTES,
      }),
    );
    expect(result.current).toEqual([]);
    expect((map.on as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it('does NOT register listeners when spritesReady is false', () => {
    // Mirror of the silhouettes-empty case for the spritesReady gate —
    // pins the cold-load guard that prevents the reconciler from
    // querying a not-yet-mounted symbol layer.
    const map = {
      on: vi.fn(),
      off: vi.fn(),
      getLayer: vi.fn(),
      getSource: vi.fn(),
      addSource: vi.fn(),
      addLayer: vi.fn(),
      querySourceFeatures: vi.fn(),
      queryRenderedFeatures: vi.fn(),
      project: vi.fn(),
      unproject: vi.fn(),
      getContainer: vi.fn(),
    } as unknown as maplibregl.Map;

    const { result } = renderHook(() =>
      useAutoSpider({
        map,
        mapReady: true,
        spritesReady: false,
        silhouettes: SILHOUETTES,
      }),
    );
    expect(result.current).toEqual([]);
    expect((map.on as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });
});
