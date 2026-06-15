import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { MultiPolygon } from 'geojson';
import { useStateArtboard } from './use-state-artboard.js';
import type { StateArtboardMapRef } from './use-state-artboard.js';
import {
  MASK_LAYER_ID,
  ARTBOARD_HALO_ID,
  ARTBOARD_OUTLINE_ID,
} from '@/components/map/geometry/artboard-layers.js';
import type {
  BasemapDescriptor,
  ThemeId,
} from '@/components/map/geometry/basemap-style.js';

/**
 * P2 ordering-invariant backfill for the consolidated state-artboard hook
 * (epic #884 · U13 / #898 — the #760/#762/#763/#765/#849/#850 nerve-center).
 *
 * The named incident regressions run end-to-end through `<MapCanvas>` against the
 * stateful fake map in `MapCanvas.test.tsx` (#765 reassert-and-survive-moveend,
 * #762 mask-first-layer, #763 within-filter + float-re-add-after-dark-swap, the
 * `[data-theme]` MutationObserver dedup) and stay green UNCHANGED — those are NOT
 * moved. THESE tests are the additional DIRECT `renderHook` re-assertion of the
 * four ordering invariants by name PLUS the `prevThemeRef` same-value guard, so
 * the load-bearing ordering of the consolidated hook is pinned at the hook
 * boundary (not only transitively through the component):
 *
 *   1. (3a-ii) restore-before-capture — on a state→state mask change the OLD
 *      isolation is restored BEFORE the new one is captured, so the new capture
 *      records the TRUE original filter (not the already-merged one).
 *   2. (3b) getLayer-guard defers via styleEpoch re-fire — while `state-mask-fill`
 *      is absent the float effect warns-and-returns (no moveLayer/addLayer); a
 *      `style.load` bumps styleEpoch, and once the mask layer is present the
 *      float effect re-fires and applies.
 *   3. (3b-teardown) keys on `maskPolygon` NOT `maskTheme` — a theme change does
 *      not tear down isolation/floats; only the mask unmounting does.
 *   4. (world-copies) re-arms on moveend — a `moveend` after an in-flight
 *      transform-clone clobber re-asserts the desired `renderWorldCopies` value.
 *
 *   + prevThemeRef same-value guard — a no-op `data-theme` write must NOT re-fire
 *     `setStyle` (the redundant-tile-refetch guard, comment-documented in the
 *     MutationObserver effect).
 *
 * `e2e/scope/state-artboard.spec.ts` is the live transform-clone-timing backstop.
 */

// Minimal isolatable basemap symbol layer (a `symbol` that paints a `text-field`,
// so `isLabelLayer` isolates it) + the #762 mask fill (the z-order anchor) + a
// stray basemap line layer painted ABOVE the mask (so the sink has something to
// move) + a cluster layer (the float anchor that sits above the mask). Order is
// array-paint order.
type StyleLayer = {
  id: string;
  type: string;
  source?: string;
  layout?: Record<string, unknown>;
};

const ISOLATABLE_LAYER: StyleLayer = {
  id: 'label_city',
  type: 'symbol',
  layout: { 'text-field': ['get', 'name'] },
};
const MASK_LAYER: StyleLayer = { id: MASK_LAYER_ID, type: 'fill' };
const STRAY_LINE: StyleLayer = { id: 'boundary_country', type: 'line' };
const CLUSTER_LAYER: StyleLayer = { id: 'clusters', type: 'circle', source: 'observations' };

const AZ_POLYGON: MultiPolygon = {
  type: 'MultiPolygon',
  coordinates: [
    [
      [
        [-114.8, 31.3],
        [-109.0, 31.3],
        [-109.0, 37.0],
        [-114.8, 37.0],
        [-114.8, 31.3],
      ],
    ],
  ],
};

const NM_POLYGON: MultiPolygon = {
  type: 'MultiPolygon',
  coordinates: [
    [
      [
        [-109.0, 31.3],
        [-103.0, 31.3],
        [-103.0, 37.0],
        [-109.0, 37.0],
        [-109.0, 31.3],
      ],
    ],
  ],
};

/**
 * A stateful fake maplibre map exposing the {@link StateArtboardMap} surface.
 * Records the ordered op log so order-sensitive invariants (restore-before-
 * capture) are assertable, backs `renderWorldCopies` with real state (#765), and
 * exposes `__fire('moveend' | 'style.load')` so the test drives the listeners
 * the production effects register.
 */
function makeFakeMap(opts: { withMask: boolean }) {
  const layers: StyleLayer[] = opts.withMask
    ? [ISOLATABLE_LAYER, MASK_LAYER, STRAY_LINE, CLUSTER_LAYER]
    : [ISOLATABLE_LAYER];
  const filters: Record<string, unknown> = {};
  let renderWorldCopiesState = true;
  // Listener pools per event type (production uses bare `on`/`off`).
  const handlers: Record<string, Array<() => void>> = {};
  // Ordered op log of the calls whose SEQUENCE matters.
  const ops: string[] = [];

  const map = {
    // ── ArtboardMap surface ──────────────────────────────────────────────
    getStyle: () => ({ layers: layers.slice() }),
    getFilter: vi.fn((layerId: string) => {
      ops.push(`getFilter:${layerId}`);
      return filters[layerId];
    }),
    setFilter: vi.fn((layerId: string, filter: unknown) => {
      ops.push(`setFilter:${layerId}`);
      filters[layerId] = filter;
    }),
    getLayer: vi.fn((layerId: string) =>
      layers.find((l) => l.id === layerId) ?? null,
    ),
    getSource: vi.fn(() => null),
    addSource: vi.fn(),
    removeSource: vi.fn(),
    moveLayer: vi.fn((layerId: string) => {
      ops.push(`moveLayer:${layerId}`);
    }),
    addLayer: vi.fn((layer: Record<string, unknown>) => {
      ops.push(`addLayer:${String(layer.id)}`);
      layers.push({
        id: String(layer.id),
        type: String(layer.type),
        source: layer.source as string | undefined,
      });
    }),
    removeLayer: vi.fn((layerId: string) => {
      ops.push(`removeLayer:${layerId}`);
      const i = layers.findIndex((l) => l.id === layerId);
      if (i !== -1) layers.splice(i, 1);
    }),
    triggerRepaint: vi.fn(),
    // ── world-copies / style swap / events ──────────────────────────────
    getRenderWorldCopies: vi.fn(() => renderWorldCopiesState),
    setRenderWorldCopies: vi.fn((v: boolean) => {
      renderWorldCopiesState = v;
    }),
    setStyle: vi.fn(() => {
      ops.push('setStyle');
    }),
    on: vi.fn((type: string, cb: () => void) => {
      (handlers[type] ??= []).push(cb);
    }),
    off: vi.fn((type: string, cb: () => void) => {
      handlers[type] = (handlers[type] ?? []).filter((h) => h !== cb);
    }),
  };

  return {
    map,
    ops,
    filters,
    layers,
    // Test affordance: fire every registered listener for a given event type.
    fire(type: 'moveend' | 'style.load') {
      (handlers[type] ?? []).slice().forEach((cb) => cb());
    },
    handlerCount(type: 'moveend' | 'style.load') {
      return (handlers[type] ?? []).length;
    },
    // Test affordance: simulate react-map-gl having NOT yet re-added the mask.
    dropMaskLayer() {
      const i = layers.findIndex((l) => l.id === MASK_LAYER_ID);
      if (i !== -1) layers.splice(i, 1);
    },
    addMaskLayer() {
      if (!layers.find((l) => l.id === MASK_LAYER_ID)) {
        // Re-insert just after the isolatable label layer (array paint order).
        layers.splice(1, 0, MASK_LAYER, STRAY_LINE, CLUSTER_LAYER);
      }
    },
  };
}

function makeRef(map: unknown) {
  return { current: { getMap: () => map } as StateArtboardMapRef };
}

describe('useStateArtboard — ordering invariants (P2 backfill, #884 · U13)', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('data-theme');
  });
  afterEach(() => {
    document.documentElement.removeAttribute('data-theme');
    vi.restoreAllMocks();
  });

  // ── Invariant 1: (3a-ii) restore-before-capture ─────────────────────────
  it('(3a-ii) restores the OLD isolation BEFORE capturing the new one on a state→state mask change', () => {
    const fake = makeFakeMap({ withMask: true });
    const ref = makeRef(fake.map);

    // Initial state scope (AZ): captures the TRUE original (undefined) filter and
    // merges in the within expression.
    const { rerender } = renderHook(
      ({ poly }: { poly: MultiPolygon }) => useStateArtboard(ref, true, poly),
      { initialProps: { poly: AZ_POLYGON } },
    );

    // The label layer's stored filter is now the merged ['within', …] (no original).
    const mergedAfterAz = fake.filters['label_city'];
    expect(mergedAfterAz).toBeDefined();

    fake.ops.length = 0; // focus the log on the state→state transition only.

    // State→state in-place (AZ → NM): no style swap fires, so this runs purely
    // through the (3a-ii) mask-change effect.
    rerender({ poly: NM_POLYGON });

    // The restore (setFilter:label_city back to the TRUE original) MUST precede
    // the re-capture (getFilter:label_city). If capture ran first it would record
    // the already-merged filter as the "original" — the #763 double-merge bug.
    const restoreIdx = fake.ops.indexOf('setFilter:label_city');
    const captureIdx = fake.ops.indexOf('getFilter:label_city');
    expect(restoreIdx).toBeGreaterThanOrEqual(0);
    expect(captureIdx).toBeGreaterThanOrEqual(0);
    expect(restoreIdx).toBeLessThan(captureIdx);

    // And the NET stored filter after the transition is a SINGLE within-merge
    // over the TRUE original (undefined → `['within', <NM>]`), NOT a double-merge
    // (`['all', ['within', <AZ>], ['within', <NM>]]`). A bare 2-element ['within',…]
    // proves the restore reset to the true original BEFORE the re-capture+merge.
    const stored = fake.filters['label_city'] as unknown[];
    expect(Array.isArray(stored)).toBe(true);
    expect(stored[0]).toBe('within');
    expect(stored).toHaveLength(2);
  });

  // ── Invariant 2: (3b) getLayer-guard defers via styleEpoch re-fire ───────
  it('(3b) defers float/sink (debug, no moveLayer) while state-mask-fill is absent, then applies after a style.load re-fires the effect', () => {
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const fake = makeFakeMap({ withMask: true });
    const ref = makeRef(fake.map);

    // Simulate react-map-gl NOT having re-added the mask at first reconcile.
    fake.dropMaskLayer();

    renderHook(() => useStateArtboard(ref, true, AZ_POLYGON));

    // The float effect hit the getLayer guard: debug-and-return, NO moveLayer/addLayer.
    expect(debugSpy).toHaveBeenCalledWith(
      '[artboard] state-mask-fill not yet reconciled; deferring float/sink (self-heals on next reconcile)',
    );
    expect(
      fake.ops.some((o) => o.startsWith('moveLayer:') || o.startsWith('addLayer:')),
    ).toBe(false);

    // react-map-gl re-adds the mask on the reconcile; a style.load bumps
    // styleEpoch which re-fires the float effect — now the guard passes and the
    // floats apply (halo + outline addLayer, stray-sink moveLayer). Wrap in act:
    // the styleEpoch state bump must flush a re-render so the float effect re-runs.
    fake.addMaskLayer();
    act(() => {
      fake.fire('style.load');
    });

    expect(fake.ops).toContain(`addLayer:${ARTBOARD_HALO_ID}`);
    expect(fake.ops).toContain(`addLayer:${ARTBOARD_OUTLINE_ID}`);
    expect(fake.ops.some((o) => o.startsWith('moveLayer:'))).toBe(true);

    debugSpy.mockRestore();
  });

  // ── Invariant 3: (3b-teardown) keys on maskPolygon NOT maskTheme ─────────
  it('(3b-teardown) does NOT tear down on a theme change (keyed on maskPolygon, not maskTheme); tears down only on mask unmount', async () => {
    document.documentElement.setAttribute('data-theme', 'light');
    const fake = makeFakeMap({ withMask: true });
    const ref = makeRef(fake.map);

    const { rerender, unmount } = renderHook(
      ({ poly }: { poly: MultiPolygon | null }) =>
        useStateArtboard(ref, true, poly),
      { initialProps: { poly: AZ_POLYGON as MultiPolygon | null } },
    );

    fake.ops.length = 0;

    // A theme flip drives the MutationObserver (setStyle + re-tint). It MUST NOT
    // run the teardown cleanup; the float effect (keyed on `maskTheme`) re-tints
    // idempotently (removeFloatLayers THEN re-addFloatLayers), so the NET result
    // is the floats still PRESENT. MutationObserver delivers on a microtask, and
    // the maskTheme state bump re-fires the float effect — await the re-add.
    act(() => {
      document.documentElement.setAttribute('data-theme', 'dark');
    });
    await waitFor(() => expect(fake.map.setStyle).toHaveBeenCalled());
    await waitFor(() =>
      expect(fake.ops).toContain(`addLayer:${ARTBOARD_HALO_ID}`),
    );
    // The teardown signature would be a remove with NO subsequent re-add. Net
    // presence holds: the floats are in the live style after the theme change.
    expect(fake.layers.some((l) => l.id === ARTBOARD_HALO_ID)).toBe(true);
    expect(fake.layers.some((l) => l.id === ARTBOARD_OUTLINE_ID)).toBe(true);

    fake.ops.length = 0;

    // Now unmount the mask (scope → us): maskPolygon → null triggers the teardown
    // cleanup — restore filters + removeFloatLayers — and the float effect does
    // NOT re-add (its `if (!maskPolygon) return` guard fires). Net: floats GONE.
    act(() => {
      rerender({ poly: null });
    });
    expect(
      fake.ops.some(
        (o) =>
          o === `removeLayer:${ARTBOARD_HALO_ID}` ||
          o === `removeLayer:${ARTBOARD_OUTLINE_ID}`,
      ),
    ).toBe(true);
    // And they are NOT re-added — the teardown removed them for good (mask gone).
    expect(fake.ops.includes(`addLayer:${ARTBOARD_HALO_ID}`)).toBe(false);
    expect(fake.layers.some((l) => l.id === ARTBOARD_HALO_ID)).toBe(false);

    unmount();
  });

  // ── Invariant 4: (world-copies) re-arms on moveend ──────────────────────
  it('(world-copies) re-asserts the desired renderWorldCopies value on moveend after an in-flight clobber (#762/#765)', () => {
    const fake = makeFakeMap({ withMask: false });
    const ref = makeRef(fake.map);

    // No mask → desired renderWorldCopies = true. (Fake seeds it true, so the
    // initial idempotent apply is a no-op; the moveend reassert is what we pin.)
    renderHook(() => useStateArtboard(ref, true, null));

    // A handler is registered on moveend (the reassert listener).
    expect(fake.handlerCount('moveend')).toBeGreaterThan(0);

    // Simulate an in-flight fitBounds/flyTo transform-clone clobbering the value.
    fake.map.setRenderWorldCopies(false);
    expect(fake.map.getRenderWorldCopies()).toBe(false);

    // moveend fires (the clobbering animation finished): the reassert wins.
    fake.fire('moveend');
    expect(fake.map.getRenderWorldCopies()).toBe(true);
  });

  it('(world-copies) re-asserts FALSE on moveend while a mask is active', () => {
    const fake = makeFakeMap({ withMask: true });
    const ref = makeRef(fake.map);

    // Masked scope → desired renderWorldCopies = false. Seed it (clobbered) true.
    fake.map.setRenderWorldCopies(true);
    renderHook(() => useStateArtboard(ref, true, AZ_POLYGON));

    // The initial apply already drove it false (desired = false, was true).
    expect(fake.map.getRenderWorldCopies()).toBe(false);

    // Clobber back to true (in-flight clone), then moveend re-asserts false.
    fake.map.setRenderWorldCopies(true);
    fake.fire('moveend');
    expect(fake.map.getRenderWorldCopies()).toBe(false);
  });

  // ── prevThemeRef same-value guard ───────────────────────────────────────
  it('prevThemeRef guard: a NO-OP same-value data-theme write does NOT re-fire setStyle', async () => {
    document.documentElement.setAttribute('data-theme', 'light');
    const fake = makeFakeMap({ withMask: false });
    const ref = makeRef(fake.map);

    renderHook(() => useStateArtboard(ref, true, null));
    (fake.map.setStyle as ReturnType<typeof vi.fn>).mockClear();

    // Writing the SAME value the attribute already had: MutationRecord fires, but
    // the prevThemeRef short-circuit must keep setStyle from running. Flush the
    // observer microtask before asserting the negative.
    act(() => {
      document.documentElement.setAttribute('data-theme', 'light');
      document.documentElement.setAttribute('data-theme', 'light');
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(fake.map.setStyle).not.toHaveBeenCalled();
  });

  it('prevThemeRef guard: a GENUINE light→dark flip fires setStyle EXACTLY ONCE and re-tints the mask theme', async () => {
    document.documentElement.setAttribute('data-theme', 'light');
    const fake = makeFakeMap({ withMask: false });
    const ref = makeRef(fake.map);

    const { result } = renderHook(() => useStateArtboard(ref, true, null));
    (fake.map.setStyle as ReturnType<typeof vi.fn>).mockClear();
    expect(result.current.maskTheme).toBe('light');

    act(() => {
      document.documentElement.setAttribute('data-theme', 'dark');
    });

    await waitFor(() => expect(fake.map.setStyle).toHaveBeenCalledTimes(1));
    // The returned maskTheme re-tints in lockstep (consumed by the <Layer> paint).
    expect(result.current.maskTheme).toBe('dark');
  });

  it('returns maskTheme seeded from the current [data-theme] attribute at mount', () => {
    document.documentElement.setAttribute('data-theme', 'dark');
    const fake = makeFakeMap({ withMask: false });
    const ref = makeRef(fake.map);

    const { result } = renderHook(() => useStateArtboard(ref, true, null));
    expect(result.current.maskTheme).toBe('dark');
  });
});

/* ──────────────────────────────────────────────────────────────────────────
   #1124 [S1] restore-path re-sanitization test REMOVED (#1230).

   The test asserted that `useStateArtboard`'s scope → us teardown re-ran a
   live-map `sanitizeNullNumericFilters` to re-guard road-shield filters that
   `restoreLabelIsolation` wrote back raw. Under #1230 the style reaches the map
   ALREADY null-guarded at the source (the constructor gets a pre-sanitized
   OBJECT via `loadSanitizedStyle`; every `setStyle` swap routes through
   `transformStyle`), so `applyLabelIsolation` captures the GUARDED live filters
   and `restoreLabelIsolation` writes guarded filters back — there is no raw
   filter to re-introduce. The band-aid (and this test guarding it) are obsolete.
   ────────────────────────────────────────────────────────────────────────── */

/* ──────────────────────────────────────────────────────────────────────────
   C1.5 (#1213) — id-driven basemap swap: the END-TO-END regression guard for
   the lossy-trigger trap.

   The swap effect now depends on the active `ThemeId`, not the `[data-theme]`
   attribute. The trap: the attribute is 'light'|'dark' only, so a kind-keyed
   trigger can never swap BETWEEN two same-kind themes — leaving 3 of the 5
   themes unreachable. C1's `ThemeId` union is still only the cross-kind pair
   `positron`/`dark`, so we exercise the same-kind path through the hook's
   INJECTED `resolver`: register two synthetic same-kind descriptors and assert
   an id change between them re-runs the effect and calls `setStyle(newUrl)`
   through the REAL wiring (effect → `swapBasemap`), not just the pure helper.
   ────────────────────────────────────────────────────────────────────────── */

const SYN_DARK_A: BasemapDescriptor = {
  id: 'dark',
  url: 'syn://dark-A',
  kind: 'dark',
  landColor: '#000000',
  markerHaloColor: '#ffffff',
  floatColors: { outline: '#fff', halo: '#fff' },
};
const SYN_DARK_B: BasemapDescriptor = {
  id: 'dark',
  url: 'syn://dark-B',
  kind: 'dark',
  landColor: '#000000',
  markerHaloColor: '#ffffff',
  floatColors: { outline: '#fff', halo: '#fff' },
};

// Two SAME-KIND (light) synthetic descriptors keyed by DISTINCT light ids. Used
// by the belt-re-seed regression: a `positron`→`bright`-style change keeps
// `[data-theme]` === 'light', so the belt observer that re-seeds the de-dup ref
// from the ATTRIBUTE (pre-C7) would collapse the active id to its kind-bridge
// value ('positron') and desync the ref from the actually-swapped id.
const SYN_LIGHT_POSITRON: BasemapDescriptor = {
  id: 'positron',
  url: 'syn://light-positron',
  kind: 'light',
  landColor: '#ffffff',
  markerHaloColor: '#ffffff',
  floatColors: { outline: '#000', halo: '#000' },
};
const SYN_LIGHT_BRIGHT: BasemapDescriptor = {
  id: 'bright',
  url: 'syn://light-bright',
  kind: 'light',
  landColor: '#ffffff',
  markerHaloColor: '#ffffff',
  floatColors: { outline: '#000', halo: '#000' },
};

describe('useStateArtboard — id-driven basemap swap (C1.5 · #1213)', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('data-theme');
  });
  afterEach(() => {
    document.documentElement.removeAttribute('data-theme');
    vi.restoreAllMocks();
  });

  it('SAME-KIND id change re-runs the swap effect and calls setStyle(newUrl) through the real wiring (the lossy-trigger trap)', () => {
    const fake = makeFakeMap({ withMask: false });
    const ref = makeRef(fake.map);

    // Injected resolver over two SAME-KIND synthetic descriptors keyed by id.
    const synRegistry: Record<string, BasemapDescriptor> = {
      darkA: SYN_DARK_A,
      darkB: SYN_DARK_B,
    };
    const resolver = (id: ThemeId): BasemapDescriptor =>
      synRegistry[id as string] ?? SYN_DARK_A;

    const { rerender } = renderHook(
      ({ id }: { id: ThemeId }) =>
        useStateArtboard(ref, true, null, id, resolver),
      { initialProps: { id: 'darkA' as ThemeId } },
    );

    // Initial mount swapped to darkA's url.
    expect(fake.map.setStyle).toHaveBeenCalledWith('syn://dark-A', {
      transformStyle: expect.any(Function),
    });
    (fake.map.setStyle as ReturnType<typeof vi.fn>).mockClear();

    // Change the id to a DIFFERENT SAME-KIND theme. SYN_DARK_A.kind === darkB.kind
    // ('dark'), so a kind-keyed trigger would NOT fire — the trap. The id-driven
    // effect re-runs and swaps to darkB's url.
    rerender({ id: 'darkB' as ThemeId });

    expect(SYN_DARK_A.kind).toBe(SYN_DARK_B.kind); // proves same-kind
    expect(SYN_DARK_A.url).not.toBe(SYN_DARK_B.url); // but different urls
    expect(fake.map.setStyle).toHaveBeenCalledTimes(1);
    expect(fake.map.setStyle).toHaveBeenCalledWith('syn://dark-B', {
      transformStyle: expect.any(Function),
    });
  });

  it('de-dups on the id: re-rendering with an UNCHANGED id does NOT re-fire setStyle', () => {
    const fake = makeFakeMap({ withMask: false });
    const ref = makeRef(fake.map);

    const { rerender } = renderHook(
      ({ id }: { id: ThemeId }) => useStateArtboard(ref, true, null, id),
      { initialProps: { id: 'positron' as ThemeId } },
    );
    (fake.map.setStyle as ReturnType<typeof vi.fn>).mockClear();

    // Same id again: the effect's deps include the id, but the id-keyed de-dup
    // guard (prevThemeIdRef) short-circuits the swap.
    rerender({ id: 'positron' as ThemeId });
    expect(fake.map.setStyle).not.toHaveBeenCalled();
  });

  it('back-compat bridge: a legacy setAttribute(data-theme, dark) resolves to the dark id and swaps (keeps basemap-dark-flip.spec.ts green)', async () => {
    document.documentElement.setAttribute('data-theme', 'light');
    const fake = makeFakeMap({ withMask: false });
    const ref = makeRef(fake.map);

    // Default resolver (resolveDescriptor) + default activeThemeId (attr-bridged
    // 'positron'): the belt MutationObserver routes the attribute through the same
    // id-driven path. This is exactly how the existing e2e drives the theme.
    renderHook(() => useStateArtboard(ref, true, null));
    (fake.map.setStyle as ReturnType<typeof vi.fn>).mockClear();

    act(() => {
      document.documentElement.setAttribute('data-theme', 'dark');
    });

    // The belt observer mapped 'dark' → the `dark` id and swapped to the real
    // dark tile URL through swapBasemap.
    await waitFor(() =>
      expect(fake.map.setStyle).toHaveBeenCalledWith(
        'https://tiles.openfreemap.org/styles/dark',
        { transformStyle: expect.any(Function) },
      ),
    );
  });

  // ── C7 (#1219) belt-re-seed regression ────────────────────────────────────
  // The belt MutationObserver effect re-seeds `prevThemeIdRef` on every run. C7
  // re-seeds it from the ACTIVE THEME ID (the id the primary effect swapped to),
  // NOT from `attrToThemeId([data-theme])`. The trap: a SAME-KIND id change keeps
  // `[data-theme]` === 'light', so the old attribute re-seed would set the ref to
  // 'positron' (the kind bridge) even when the live basemap is `bright` — a
  // desync that would wrongly de-dup the next swap back to positron. With the
  // active-id re-seed the ref stays consistent with the live basemap.
  it('belt re-seed from the active id: a SAME-KIND id change still swaps the basemap (the desync trap)', () => {
    // [data-theme] stays 'light' throughout — the kind never changes, so the
    // OLD belt re-seed `attrToThemeId('light')` always produced 'positron'.
    document.documentElement.setAttribute('data-theme', 'light');
    const fake = makeFakeMap({ withMask: false });
    const ref = makeRef(fake.map);

    const synRegistry: Record<string, BasemapDescriptor> = {
      positron: SYN_LIGHT_POSITRON,
      bright: SYN_LIGHT_BRIGHT,
    };
    const resolver = (id: ThemeId): BasemapDescriptor =>
      synRegistry[id as string] ?? SYN_LIGHT_POSITRON;

    // Mount with the NON-positron light id `bright`. The primary effect swaps to
    // bright and sets prevThemeIdRef='bright'. The OLD belt effect (which ran on
    // mount) then re-seeded prevThemeIdRef = attrToThemeId('light') = 'positron'
    // — CLOBBERING the correct 'bright' even though the live basemap is bright.
    const { rerender } = renderHook(
      ({ id }: { id: ThemeId }) =>
        useStateArtboard(ref, true, null, id, resolver),
      { initialProps: { id: 'bright' as ThemeId } },
    );

    expect(SYN_LIGHT_POSITRON.kind).toBe(SYN_LIGHT_BRIGHT.kind); // same-kind
    expect(fake.map.setStyle).toHaveBeenCalledWith('syn://light-bright', {
      transformStyle: expect.any(Function),
    });
    (fake.map.setStyle as ReturnType<typeof vi.fn>).mockClear();

    // bright → positron: SAME kind ('light'), [data-theme] unchanged. With the
    // OLD attribute re-seed the ref was clobbered to 'positron' at mount, so
    // this swap is WRONGLY de-duped ('positron' === ref) and sticks on bright.
    // With the active-id re-seed the ref tracked 'bright', so positron swaps.
    rerender({ id: 'positron' as ThemeId });
    expect(fake.map.setStyle).toHaveBeenCalledTimes(1);
    expect(fake.map.setStyle).toHaveBeenCalledWith('syn://light-positron', {
      transformStyle: expect.any(Function),
    });
  });
});
