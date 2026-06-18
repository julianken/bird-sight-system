import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  attrToThemeId,
  readActiveThemeIdFromDom,
  swapBasemap,
  useActiveThemeId,
} from './theme-state.js';
import type { BasemapDescriptor, ThemeId } from './geometry/basemap-style.js';
import { THEME_REGISTRY } from './geometry/basemap-style.js';

/**
 * C1.5 (#1213) — active-theme-id state + id-driven basemap-swap seam.
 *
 * The whole point of this child is a regression guard proving **the id/url —
 * not the kind — drives the basemap swap**. C1's `ThemeId` union is only the
 * cross-kind pair `positron`/`dark`, so the trap is unreachable through
 * `resolveDescriptor` alone. The pure `swapBasemap(map, descriptor)` helper +
 * synthetic same-kind `BasemapDescriptor` objects are the injection seam that
 * makes it reachable (see issue §"The injection seam").
 */

// A minimal maplibre-map spy: only the `setStyle` swap surface `swapBasemap`
// touches. The mask-theme setter is injected separately so the pure helper can
// run with no React. `setStyle` now receives a second options arg carrying the
// `transformStyle` pre-worker null-guard hook (#1230).
function makeMapSpy() {
  return {
    setStyle: vi.fn<
      (
        style: string,
        options?: {
          transformStyle?: (previous: unknown, next: unknown) => unknown;
        },
      ) => void
    >(),
  };
}

// Two SYNTHETIC descriptors that share `kind: 'dark'` but differ in `url`/`id`.
// They need NO registry entry (BasemapDescriptor is a plain interface), so the
// same-kind trap is exercised without widening `ThemeId`.
const SYN_DARK_A: BasemapDescriptor = {
  id: 'dark',
  url: 'syn://A',
  kind: 'dark',
  landColor: '#000000',
  markerHaloColor: '#ffffff',
  floatColors: { outline: '#fff', halo: '#fff' },
};
const SYN_DARK_B: BasemapDescriptor = {
  id: 'dark',
  url: 'syn://B',
  kind: 'dark',
  landColor: '#000000',
  markerHaloColor: '#ffffff',
  floatColors: { outline: '#fff', halo: '#fff' },
};

describe('theme-state — attrToThemeId / readActiveThemeIdFromDom (back-compat bridge)', () => {
  afterEach(() => {
    document.documentElement.removeAttribute('data-theme');
  });

  it('maps the [data-theme] attribute to a kind-consistent ThemeId', () => {
    expect(attrToThemeId('dark')).toBe('dark');
    expect(attrToThemeId('light')).toBe('positron');
    expect(attrToThemeId(null)).toBe('positron');
    // Any non-'dark' value resolves to positron (light kind) — the legacy
    // `=== 'dark'` semantics preserved.
    expect(attrToThemeId('whatever')).toBe('positron');
  });

  it('reads the active id from the live [data-theme] attribute', () => {
    document.documentElement.setAttribute('data-theme', 'dark');
    expect(readActiveThemeIdFromDom()).toBe('dark');
    document.documentElement.setAttribute('data-theme', 'light');
    expect(readActiveThemeIdFromDom()).toBe('positron');
    document.documentElement.removeAttribute('data-theme');
    expect(readActiveThemeIdFromDom()).toBe('positron');
  });
});

describe('theme-state — swapBasemap (pure, injection-seam #1)', () => {
  it('issues map.setStyle(descriptor.url) and routes the kind to setMaskTheme', () => {
    const map = makeMapSpy();
    const setMaskTheme = vi.fn();

    swapBasemap(map, THEME_REGISTRY.dark, setMaskTheme);

    expect(map.setStyle).toHaveBeenCalledTimes(1);
    expect(map.setStyle).toHaveBeenCalledWith(
      THEME_REGISTRY.dark.url,
      // #1230: the swap MUST carry the pre-worker null-guard transform.
      expect.objectContaining({ transformStyle: expect.any(Function) }),
    );
    expect(setMaskTheme).toHaveBeenCalledWith('dark');
  });

  it('does NOT call resolveDescriptor — it consumes the descriptor argument', () => {
    // swapBasemap takes the resolved descriptor; the URL comes straight off the
    // argument. We prove this by passing a synthetic descriptor whose url is NOT
    // in any registry entry and asserting setStyle gets exactly that url.
    const map = makeMapSpy();
    swapBasemap(map, SYN_DARK_A, vi.fn());
    expect(map.setStyle).toHaveBeenCalledWith('syn://A', expect.anything());
  });

  // ── #1230: the transformStyle hook actually null-guards the fetched style ──
  it('wires a transformStyle that null-guards the incoming style BEFORE the worker', () => {
    const map = makeMapSpy();
    swapBasemap(map, SYN_DARK_A, vi.fn());
    const options = map.setStyle.mock.calls[0][1];
    expect(options?.transformStyle).toBeTypeOf('function');
    // Feed the wired transform a bright-like null-prone POI rank filter and
    // assert it comes back null-guarded — the exact rewrite that stops the
    // worker `warnOnce`.
    const rawStyle = {
      layers: [
        { id: 'poi_r7', type: 'symbol', filter: ['>=', ['get', 'rank'], 7] },
      ],
    };
    const guarded = options!.transformStyle!(undefined, rawStyle) as typeof rawStyle;
    expect(guarded.layers[0].filter).toEqual([
      'all',
      ['has', 'rank'],
      ['>=', ['get', 'rank'], 7],
    ]);
  });

  // ── Same-kind regression guard (the lossy-trigger trap) ──────────────────
  it('SAME-KIND regression guard: two descriptors with the SAME kind but different url each issue a fresh setStyle (url/id, not kind, drives the swap)', () => {
    const map = makeMapSpy();
    const setMaskTheme = vi.fn();

    // Both descriptors are kind 'dark'. A kind-keyed mechanism would treat the
    // second swap as a no-op (kind unchanged) and SKIP setStyle('syn://B') — the
    // exact bug that left 3 of 5 themes unreachable. swapBasemap is url-driven,
    // so each call re-issues setStyle with its own descriptor.url.
    swapBasemap(map, SYN_DARK_A, setMaskTheme);
    swapBasemap(map, SYN_DARK_B, setMaskTheme);

    expect(SYN_DARK_A.kind).toBe(SYN_DARK_B.kind); // proves they are same-kind
    expect(SYN_DARK_A.url).not.toBe(SYN_DARK_B.url); // but different urls
    expect(map.setStyle).toHaveBeenCalledTimes(2);
    expect(map.setStyle).toHaveBeenNthCalledWith(1, 'syn://A', expect.anything());
    // The crux: the SECOND call issued setStyle with the SECOND url. A kind-keyed
    // implementation would fail here (it would skip the second swap).
    expect(map.setStyle).toHaveBeenNthCalledWith(2, 'syn://B', expect.anything());
  });
});

describe('theme-state — useActiveThemeId (state + injectable resolver, seam #2)', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('data-theme');
  });
  afterEach(() => {
    document.documentElement.removeAttribute('data-theme');
  });

  it('seeds the active id + descriptor from the current [data-theme] attribute', () => {
    document.documentElement.setAttribute('data-theme', 'dark');
    const { result } = renderHook(() => useActiveThemeId());
    expect(result.current.themeId).toBe('dark');
    expect(result.current.descriptor).toBe(THEME_REGISTRY.dark);
  });

  it('defaults to positron when no attribute is set', () => {
    const { result } = renderHook(() => useActiveThemeId());
    expect(result.current.themeId).toBe('positron');
    expect(result.current.descriptor).toBe(THEME_REGISTRY.positron);
  });

  it('re-resolves the descriptor when the id is set', () => {
    const { result } = renderHook(() => useActiveThemeId());
    expect(result.current.themeId).toBe('positron');

    act(() => {
      result.current.setThemeId('dark');
    });

    expect(result.current.themeId).toBe('dark');
    expect(result.current.descriptor).toBe(THEME_REGISTRY.dark);
  });

  it('accepts an injectable resolver so tests can register synthetic same-kind ids (seam #2)', () => {
    // Register a resolver over two SAME-KIND synthetic descriptors keyed by id.
    // (We reuse the production `dark` id plus a second synthetic id cast in, since
    // the resolver signature is `(id: ThemeId) => BasemapDescriptor` and the seam
    // is exactly that the resolver — not a closed registry lookup — supplies the
    // descriptor.)
    const synRegistry: Record<string, BasemapDescriptor> = {
      darkA: SYN_DARK_A,
      darkB: SYN_DARK_B,
    };
    const resolver = (id: ThemeId): BasemapDescriptor =>
      synRegistry[id as string] ?? THEME_REGISTRY.positron;

    const { result } = renderHook(() => useActiveThemeId(resolver));

    act(() => {
      result.current.setThemeId('darkA' as ThemeId);
    });
    expect(result.current.descriptor).toBe(SYN_DARK_A);
    expect(result.current.descriptor.url).toBe('syn://A');

    // Switch between two SAME-KIND synthetic ids: the descriptor (and url) MUST
    // change even though kind does not — the injectable-resolver seam makes the
    // same-kind transition reachable end-to-end.
    act(() => {
      result.current.setThemeId('darkB' as ThemeId);
    });
    expect(result.current.descriptor).toBe(SYN_DARK_B);
    expect(result.current.descriptor.url).toBe('syn://B');
    expect(SYN_DARK_A.kind).toBe(SYN_DARK_B.kind);
  });
});
