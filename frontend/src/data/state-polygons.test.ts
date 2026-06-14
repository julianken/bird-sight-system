import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { MultiPolygon } from 'geojson';
import {
  useStatePolygon,
  __resetStatePolygonsCache,
  STATE_POLYGONS_URL,
  type StatePolygonMap,
} from './state-polygons.js';

/**
 * #760/#762 — client state-mask polygons. The hook lazy-fetches
 * `/state-polygons.json` (the code→MultiPolygon asset emitted by
 * `scripts/data/generate-state-boundaries.mjs`), module-caches it single-flight, and
 * resolves the geometry for the active state scope. `null` for a null/unknown
 * code or a rejected fetch (graceful degrade — never throws).
 */

const AZ: MultiPolygon = {
  type: 'MultiPolygon',
  coordinates: [
    [
      [
        [-114, 31],
        [-109, 31],
        [-109, 37],
        [-114, 37],
        [-114, 31],
      ],
    ],
  ],
};

const NM: MultiPolygon = {
  type: 'MultiPolygon',
  coordinates: [
    [
      [
        [-109, 31],
        [-103, 31],
        [-103, 37],
        [-109, 37],
        [-109, 31],
      ],
    ],
  ],
};

const FIXTURE: StatePolygonMap = { 'US-AZ': AZ, 'US-NM': NM };

function stubFetchOk(body: unknown): ReturnType<typeof vi.fn> {
  const fn = vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(body),
  } as Response);
  vi.stubGlobal('fetch', fn);
  return fn;
}

describe('useStatePolygon', () => {
  beforeEach(() => {
    __resetStatePolygonsCache();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('cache-busts the asset URL with the dataset version', () => {
    expect(STATE_POLYGONS_URL).toBe('/state-polygons.json?v=1');
  });

  it('resolves the geometry for a known state code', async () => {
    stubFetchOk(FIXTURE);
    const { result } = renderHook(() => useStatePolygon('US-AZ'));
    await waitFor(() => expect(result.current).toEqual(AZ));
  });

  it('returns null for a null code (us / chooser scope) and never fetches', async () => {
    const fetchMock = stubFetchOk(FIXTURE);
    const { result } = renderHook(() => useStatePolygon(null));
    expect(result.current).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns null for an unknown code (asset has no such state)', async () => {
    stubFetchOk(FIXTURE);
    const { result } = renderHook(() => useStatePolygon('US-ZZ'));
    // Give the fetch a tick to resolve; result stays null.
    await waitFor(() => {});
    expect(result.current).toBeNull();
  });

  it('returns null on a rejected fetch (no throw — degrades to the plain view)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    const { result } = renderHook(() => useStatePolygon('US-AZ'));
    await waitFor(() => {});
    expect(result.current).toBeNull();
  });

  it('single-flight: concurrent consumers share one fetch', async () => {
    const fetchMock = stubFetchOk(FIXTURE);
    const a = renderHook(() => useStatePolygon('US-AZ'));
    const b = renderHook(() => useStatePolygon('US-NM'));
    await waitFor(() => expect(a.result.current).toEqual(AZ));
    await waitFor(() => expect(b.result.current).toEqual(NM));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('switching code re-resolves from the cache without a second fetch', async () => {
    const fetchMock = stubFetchOk(FIXTURE);
    const { result, rerender } = renderHook(({ code }) => useStatePolygon(code), {
      initialProps: { code: 'US-AZ' as string | null },
    });
    await waitFor(() => expect(result.current).toEqual(AZ));
    rerender({ code: 'US-NM' });
    await waitFor(() => expect(result.current).toEqual(NM));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('__resetStatePolygonsCache clears the memo between tests (a fresh fetch fires)', async () => {
    const first = stubFetchOk(FIXTURE);
    const { result } = renderHook(() => useStatePolygon('US-AZ'));
    await waitFor(() => expect(result.current).toEqual(AZ));
    expect(first).toHaveBeenCalledTimes(1);

    __resetStatePolygonsCache();
    const second = stubFetchOk(FIXTURE);
    const { result: r2 } = renderHook(() => useStatePolygon('US-AZ'));
    await waitFor(() => expect(r2.current).toEqual(AZ));
    expect(second).toHaveBeenCalledTimes(1);
  });
});
