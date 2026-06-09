import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import type { MultiPolygon } from 'geojson';
import { BASEMAP_LIGHT, BASEMAP_DARK } from './basemap-style.js';
import {
  applyLabelIsolation,
  restoreLabelIsolation,
  bufferIsolationPolygon,
  applyArtboardFidelity,
  removeFloatLayers,
  MASK_LAYER_ID,
} from './artboard-layers.js';
import type { ArtboardMap } from './artboard-layers.js';

/**
 * State-artboard hook (the #884 · U13 / #898 nerve-center consolidation;
 * extracted verbatim from `MapCanvas.tsx`). Owns the ENTIRE artboard-fidelity
 * machinery as ONE indivisible unit — the recurrent
 * #760/#762/#763/#765/#849/#850 blank-map class lives here:
 *
 *   - the `renderWorldCopies` reassertion effect (#762/#765),
 *   - the four mask/label-isolation effects:
 *       (3a-i)  label isolation re-apply on THEME SWAP (`style.load` listener),
 *       (3a-ii) label isolation re-apply on MASK CHANGE,
 *       (3b)    float layers + stray-sink (post-reconcile, `styleEpoch`-keyed),
 *       (3b-teardown) restore filters + remove floats on mask unmount,
 *   - the `[data-theme]` MutationObserver that swaps the basemap (`setStyle`)
 *     and re-tints the mask fill (`setMaskTheme`).
 *
 * It is the SOLE owner of ALL state the moved effects own:
 *   - `maskTheme`        — reactive mask-fill theme (the ONLY value the parent
 *                          needs back; consumed by the `<Layer>` `paint` prop),
 *   - `savedFiltersRef`  — captured ORIGINAL basemap filters for exact teardown,
 *   - `maskPolygonRef`   — the live prop mirror the once-registered `style.load`
 *                          handler reads (fresh-closure pattern, #849/#351),
 *   - `styleEpoch`       — bumps once per `style.load`; re-fires the float effect
 *                          AFTER react-map-gl re-adds `state-mask-fill` (the
 *                          3a/3b reconcile-sequencing split, #763), and
 *   - `prevThemeRef`     — the MutationObserver's PRIVATE same-value de-dup guard
 *                          (a no-op `data-theme` write must NOT re-fire
 *                          `setStyle`).
 *
 * `styleEpoch` and `prevThemeRef` are fully PRIVATE (no parent/JSX consumer);
 * only `maskTheme` is returned. The `mapRef` + the `<Map>`/`<Source>`/`<Layer>`
 * JSX stay in `MapCanvas`; only the state + effects move here.
 *
 * ⚠ EXTRACT-AS-ONE-UNIT (#884 load-bearing guardrail): the 3a/3b halves must NOT
 * be collapsed/split. 3b's `getLayer('state-mask-fill')` guard depends on
 * react-map-gl having RE-ADDED the mask fill, which is deferred via the
 * `styleEpoch` re-fire from 3a-i. The camera↔`renderWorldCopies` race flows
 * through maplibre's animation loop (see `use-scope-camera.ts` #848), not a
 * shared React value. Effect registration ORDER is preserved 1:1 with HEAD.
 *
 * Behaviour-preserving: every effect body, its deps, and the exhaustive-deps
 * disables are 1:1 with the pre-extraction code. The named incident regression
 * tests (#765 reassert-and-survive-moveend, #762 mask-first-layer, #763
 * within-filter + float-re-add-after-dark-swap, the `[data-theme]`
 * MutationObserver dedup) run end-to-end through `<MapCanvas>` against the
 * stateful fake map in `MapCanvas.test.tsx` and stay green UNCHANGED; the
 * ordering invariants are additionally re-asserted directly in
 * `use-state-artboard.test.ts`. `e2e/state-artboard.spec.ts` is the live
 * transform-clone-timing backstop.
 */

/**
 * The minimal maplibre-map surface this hook's effects touch. Extends the
 * helper-module {@link ArtboardMap} (label-isolation / float-layer ops) with the
 * world-copies, style-swap, and event methods the artboard effects call
 * directly:
 *   - `getRenderWorldCopies` / `setRenderWorldCopies` — the #762/#765 reassert,
 *   - `setStyle` — the `[data-theme]` basemap swap,
 *   - `on` / `off` — `style.load` (theme-swap re-isolation) + `moveend`
 *     (world-copies reassert win against the in-flight transform-clone replay).
 *
 * `getLayer` is already part of {@link ArtboardMap}. Same narrow-shape idiom as
 * `use-scope-camera.ts`'s `ScopeCameraMap`: the surface documents exactly which
 * APIs the artboard machinery drives. The real `map` from
 * `mapRef.current.getMap()` is structurally compatible.
 */
export interface StateArtboardMap extends ArtboardMap {
  getRenderWorldCopies: () => boolean;
  setRenderWorldCopies: (renderWorldCopies: boolean) => void;
  setStyle: (style: unknown) => void;
  on: (type: 'style.load' | 'moveend', listener: () => void) => void;
  off: (type: 'style.load' | 'moveend', listener: () => void) => void;
}

/**
 * The minimal react-map-gl `MapRef` surface: only `getMap()`, returning a
 * {@link StateArtboardMap}. `mapRef.current?.getMap()` is the live maplibre
 * handle.
 */
export interface StateArtboardMapRef {
  getMap: () => StateArtboardMap;
}

/**
 * Consolidated state-artboard hook (#884 · U13 / #898). Wires ALL artboard
 * machinery — the four mask/label-isolation effects, the `[data-theme]`
 * MutationObserver (basemap + mask-fill swap), and the `renderWorldCopies`
 * reassertion — to the live `mapRef`, owning every piece of cross-effect state.
 *
 * @param mapRef       ref to the react-map-gl `MapRef` (`getMap()` → maplibre)
 * @param mapReady     gate: only touch the map once the `load` event fired
 * @param maskPolygon  the current state-scope mask polygon, or undefined/null
 * @returns `{ maskTheme }` — the reactive mask-fill theme the `<Layer>` paint
 *          prop reads. `styleEpoch` + `prevThemeRef` stay private to the hook.
 */
export function useStateArtboard(
  mapRef: RefObject<StateArtboardMapRef | null>,
  mapReady: boolean,
  maskPolygon: MultiPolygon | null | undefined,
): { maskTheme: 'light' | 'dark' } {
  /**
   * Reactive theme for the state-artboard mask fill (#760/#762). Seeded from the
   * current `[data-theme]` attribute and flipped by the SAME MutationObserver
   * that swaps the basemap (below) — so the gray mask re-paints in lockstep with
   * the basemap on a light/dark toggle. react-map-gl diffs the `<Layer>` `paint`
   * prop, so updating this state re-paints the fill with no remount.
   */
  const [maskTheme, setMaskTheme] = useState<'light' | 'dark'>(() =>
    typeof document !== 'undefined' &&
    document.documentElement.getAttribute('data-theme') === 'dark'
      ? 'dark'
      : 'light',
  );

  // #763 — artboard FIDELITY imperative state.
  //
  // `savedFiltersRef` holds the basemap symbol layers' ORIGINAL filters captured
  // when `applyLabelIsolation` ran, so `restoreLabelIsolation` can undo the
  // `['within', …]` merge exactly when the mask unmounts (scope → us/chooser).
  //
  // `maskPolygonRef` mirrors the current prop so the ONCE-registered
  // `style.load` handler (which would otherwise close over a stale value) reads
  // the live polygon at swap time. Updated synchronously on render.
  const savedFiltersRef = useRef<ReturnType<typeof applyLabelIsolation> | null>(
    null,
  );
  const maskPolygonRef = useRef<MultiPolygon | null>(maskPolygon ?? null);
  maskPolygonRef.current = maskPolygon ?? null;
  // `styleEpoch` bumps once per `style.load` (i.e. per theme `setStyle` swap).
  // It is a dep of the float/sink effect so that effect RE-RUNS after the new
  // style finishes loading — by which time react-map-gl's reconcile has re-added
  // `state-mask-fill`, so the guard passes and the float layers (which `setStyle`
  // dropped) are restored. Without this, a theme swap left the artboard with NO
  // halo/outline until the next unrelated render.
  const [styleEpoch, setStyleEpoch] = useState(0);

  // #762/#765 — `renderWorldCopies` reassertion across an IN-PLACE scope change.
  //
  // The declarative `renderWorldCopies={maskPolygon == null}` prop (on the
  // `<MapView>` in MapCanvas) is necessary (react-map-gl/maplibre does NOT reset
  // an ABSENT setting to its default — it retains the last value, so the prop
  // must always carry an explicit value), but it is not sufficient on the
  // `state → us` transition. That transition also changes `boundsKey`, which
  // re-fires the camera effect and starts a `fitBounds` animation. maplibre's
  // animation captures a CLONE of the current transform (with the OLD
  // `renderWorldCopies: false`) and re-`apply`s it every animation frame —
  // clobbering the `true` that react-map-gl set declaratively. The net live
  // result was world copies stuck OFF after leaving a state scope for
  // `?scope=us` (PR #765 bot review, reproduced live: `getRenderWorldCopies()`
  // stayed `false`).
  //
  // Reassert imperatively on `maskPolygon` change AND on `moveend` (when the
  // clobbering animation has finished) so the explicit value wins the race.
  // Idempotent: a no-op when the map already matches the desired value.
  useEffect(() => {
    if (!mapReady) return;
    const map = mapRef.current?.getMap();
    if (!map) return;
    const desired = maskPolygon == null;
    const apply = () => {
      if (map.getRenderWorldCopies() !== desired) {
        map.setRenderWorldCopies(desired);
      }
    };
    apply();
    // Win the race against an in-flight fitBounds/flyTo transform-clone replay.
    map.on('moveend', apply);
    return () => {
      map.off('moveend', apply);
    };
  }, [mapReady, maskPolygon]);

  // ───────────────────────────────────────────────────────────────────────────
  // #763 — artboard FIDELITY: label isolation + clean exterior + float layers.
  //
  // ⚠ RECONCILE-SEQUENCING SPLIT (do NOT collapse this into one effect/handler).
  //
  // `map.setStyle()` (fired by the [data-theme] MutationObserver below) clears
  // and asynchronously reloads ALL layers — dropping both the merged label
  // filters AND the float layers — so everything must be re-applied after each
  // swap. But the two halves have DIFFERENT timing requirements:
  //
  //   (3a) Label-filter isolation re-applies in `style.load`. Basemap symbol
  //        layers exist immediately on style load and `applyLabelIsolation`
  //        needs NO reference to `state-mask-fill`, so it is safe there.
  //
  //   (3b) The float `addLayer` + the `moveLayer` stray-sink re-apply from the
  //        SEPARATE `maskPolygon`-watching effect below — NOT from `style.load`.
  //        react-map-gl re-adds its managed declarative layers (including
  //        `state-mask-fill`) on the NEXT React reconcile, which has NOT
  //        happened yet when `style.load` fires. `moveLayer(x, 'state-mask-fill')`
  //        or an `addLayer(..., 'state-mask-fill')` inside `style.load` therefore
  //        throws `Cannot move layer before non-existing layer`. The effect
  //        below re-fires on the next render (after the reconcile), so the
  //        reference layer exists — and it still GUARDS on
  //        `getLayer('state-mask-fill')` (warn-and-return, never call through).
  //
  // Collapsing (3b) back into the `style.load` handler reintroduces that throw.
  // ───────────────────────────────────────────────────────────────────────────

  // (3a-i) Label isolation re-apply on THEME SWAP. Registered ONCE after
  // `mapReady` as a `style.load` listener (which fires after each
  // MutationObserver `setStyle`); the handler reads the live `maskPolygon` from
  // a ref so it needs no re-registration on prop change. Basemap symbol layers
  // exist immediately on `style.load`, and `applyLabelIsolation` needs no
  // reference to `state-mask-fill`, so this is safe here (unlike the float/sink
  // half — see the sequencing comment above).
  useEffect(() => {
    if (!mapReady) return;
    const map = mapRef.current?.getMap();
    if (!map) return;

    const onStyleLoad = () => {
      const poly = maskPolygonRef.current;
      // Bump the epoch unconditionally so the float/sink effect re-runs after
      // EVERY style reload (it re-adds the floats `setStyle` dropped, once the
      // reconcile has re-added `state-mask-fill`).
      setStyleEpoch((n) => n + 1);
      if (!poly) return; // no state scope → no isolation (us/chooser untouched)
      try {
        // The within test uses the OUTWARD-BUFFERED polygon (so near-border
        // interior labels survive); the #762 mask FILL keeps the EXACT polygon.
        savedFiltersRef.current = applyLabelIsolation(
          map,
          bufferIsolationPolygon(poly),
        );
      } catch {
        /* defensive — style churn after a swap; QA detects un-isolated labels */
      }
    };

    map.on('style.load', onStyleLoad);
    return () => {
      map.off('style.load', onStyleLoad);
    };
    // mapReady-only: the handler reads maskPolygon from a ref, so it must NOT
    // re-register on every prop change (that would leak listeners).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady]);

  // (3a-ii) Label isolation re-apply on MASK CHANGE (initial mount, chooser/us →
  // state, state → state in-place). Distinct from the `style.load` listener:
  // those transitions do NOT swap the style, so no `style.load` fires. On a
  // state → state change the OLD isolation must be restored before the NEW one
  // is captured+applied (else the new `applyLabelIsolation` would capture the
  // already-merged `['all', original, within]` filter as the "original").
  useEffect(() => {
    if (!mapReady) return;
    const map = mapRef.current?.getMap();
    if (!map) return;
    if (!maskPolygon) return; // us/chooser: teardown effect restores originals
    try {
      if (savedFiltersRef.current) {
        restoreLabelIsolation(map, savedFiltersRef.current);
        savedFiltersRef.current = null;
      }
      savedFiltersRef.current = applyLabelIsolation(
        map,
        bufferIsolationPolygon(maskPolygon),
      );
    } catch {
      /* defensive — style churn; QA detects un-isolated labels */
    }
  }, [mapReady, maskPolygon]);

  // (3b) Float layers + stray-sink — runs from a `maskPolygon`-watching,
  // `mapReady`-gated effect (also keyed on `maskTheme` so the float re-tints on
  // a theme swap). It fires AFTER react-map-gl's reconcile has (re-)added
  // `state-mask-fill`, and `addFloatLayers` is idempotent (removes any prior
  // instance before re-adding), so re-running it on a theme change re-tints
  // cleanly without thrashing the LABEL filters (which are owned by the (3a)
  // `style.load` handler and the separate teardown effect below).
  useEffect(() => {
    if (!mapReady) return;
    const map = mapRef.current?.getMap();
    if (!map) return;
    if (!maskPolygon) return;

    // Guard: state-mask-fill MUST exist before any moveLayer/insert anchored to
    // it. If react-map-gl has not re-added it yet, warn and return — the effect
    // re-fires on the next render once the reconcile lands it. Calling through
    // is the exact `Cannot move layer before non-existing layer` throw the
    // 3a/3b split exists to avoid.
    if (map.getLayer(MASK_LAYER_ID) == null) {
      console.warn(
        '[artboard] state-mask-fill not yet reconciled; deferring float/sink',
      );
      return;
    }
    try {
      applyArtboardFidelity(map, maskPolygon, maskTheme);
    } catch {
      /* defensive — layer/style churn after a swap */
    }
    // `styleEpoch` re-runs this AFTER a theme `setStyle`+`style.load` so the
    // floats `setStyle` dropped are re-added once `state-mask-fill` is back.
  }, [mapReady, maskPolygon, maskTheme, styleEpoch]);

  // (3b-teardown) Restore label filters + remove float layers when the mask
  // unmounts (scope → us/chooser) OR the component unmounts. Keyed ONLY on
  // `maskPolygon` (NOT `maskTheme`) so a theme swap — which re-applies isolation
  // via (3a) `style.load` against the NEW style — does not trigger a stale
  // restore against filters the `setStyle` already cleared. Guarded against a
  // disposed map / missing layers (the helpers wrap their MapLibre calls).
  useEffect(() => {
    if (!mapReady) return;
    if (!maskPolygon) return; // only arm teardown while a mask is active
    return () => {
      const liveMap = mapRef.current?.getMap();
      if (!liveMap) return;
      try {
        if (savedFiltersRef.current) {
          restoreLabelIsolation(liveMap, savedFiltersRef.current);
          savedFiltersRef.current = null;
        }
        removeFloatLayers(liveMap);
      } catch {
        /* defensive — map gone after a swap or unmount */
      }
    };
  }, [mapReady, maskPolygon]);

  // [data-theme] observer — swap basemap when user toggles theme.
  // Registered after mapReady so the map instance is guaranteed to exist.
  // Cleaned up on unmount to prevent leaks. The observer is the single
  // source of truth for basemap-vs-theme coupling — no prop drilling.
  // Dark URL aliasing (G8): BASEMAP_DARK may resolve to the same
  // visual tiles as light during the rollout window; the swap mechanism
  // is correct regardless. See docs/design/01-spec/open-questions.md.
  //
  // Same-value guard: MutationRecord fires on every attribute write,
  // including writes that set the SAME value the attribute already had
  // (e.g. setAttribute('data-theme', 'light') when it's already 'light').
  // Without the prevTheme ref, a no-op write would trigger setStyle and
  // a redundant tile re-fetch.
  const prevThemeRef = useRef<'light' | 'dark' | null>(null);
  useEffect(() => {
    if (!mapReady) return;
    const map = mapRef.current?.getMap();
    if (!map) return;

    // Seed the prev ref with the current attribute value so the first
    // observed mutation only fires setStyle when the value genuinely flips.
    prevThemeRef.current =
      document.documentElement.getAttribute('data-theme') === 'dark'
        ? 'dark'
        : 'light';

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (
          mutation.type === 'attributes' &&
          mutation.attributeName === 'data-theme'
        ) {
          const next: 'light' | 'dark' =
            document.documentElement.getAttribute('data-theme') === 'dark'
              ? 'dark'
              : 'light';
          if (next === prevThemeRef.current) return;
          prevThemeRef.current = next;
          const style = next === 'dark' ? BASEMAP_DARK : BASEMAP_LIGHT;
          map.setStyle(style);
          // #760/#762: re-paint the state-artboard mask fill in lockstep with
          // the basemap swap. The mask <Layer> reads `maskTheme`; react-map-gl
          // diffs `paint` so this re-tints the gray with no remount.
          setMaskTheme(next);
        }
      }
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });

    return () => observer.disconnect();
  }, [mapReady]);

  return { maskTheme };
}
