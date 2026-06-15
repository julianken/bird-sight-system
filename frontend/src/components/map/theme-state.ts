import { useState, useMemo, useCallback } from 'react';
import {
  resolveDescriptor,
  type BasemapDescriptor,
  type BasemapKind,
  type ThemeId,
} from '@/components/map/geometry/basemap-style.js';
import { transformStyleSanitizeNull } from '@/components/map/geometry/basemap-style-sanitizer.js';

/**
 * Active-theme-id state + id-driven basemap-swap seam (C1.5 · #1213).
 *
 * The basemap swap used to be keyed on the `[data-theme]` attribute, which only
 * ever holds `'light'`|`'dark'` — a LOSSY trigger. With the 5-theme model there
 * are two dark-kind themes (`dark`, `fiord`) and three light-kind
 * (`positron`/`bright`/`liberty`); switching WITHIN a kind never changes the
 * attribute, so a kind-keyed observer can never reach 3 of the 5 themes.
 *
 * This module makes the active `ThemeId` the reactive source of truth and the
 * swap effect depend on the **id**, re-resolving the descriptor whenever the id
 * changes — including between two same-kind themes. C1's `ThemeId` union is
 * still only `positron`/`dark` (two DIFFERENT kinds), so the same-kind path is
 * unreachable through `resolveDescriptor` alone; the two seams below make it
 * testable WITHOUT widening `ThemeId`:
 *
 *   1. `swapBasemap(map, descriptor, setMaskTheme)` — the pure unit that performs
 *      ONE swap. It takes the resolved `BasemapDescriptor` as an ARGUMENT and
 *      never calls `resolveDescriptor`, so a same-kind regression test can call
 *      it directly with two synthetic descriptors that share `kind` but differ in
 *      `url`/`id`. Asserting it issues a fresh `setStyle` for the second url
 *      proves the URL — not the kind — drives the swap.
 *   2. `useActiveThemeId(resolver?)` — an injectable `resolver` (default
 *      `resolveDescriptor`) lets tests register synthetic same-kind ids and assert
 *      an id change between them re-resolves the descriptor.
 *
 * Until C7's `applyTheme`/`resolveInitialTheme` owns the persisted write path,
 * the active id is seeded from the current `[data-theme]` attribute via the
 * back-compat bridge below (`'dark'`→`dark` id, else `positron`). That bridge is
 * what keeps the existing `basemap-dark-flip.spec.ts` green — it drives the theme
 * by `setAttribute('data-theme', …)`, which still resolves to a kind-consistent
 * id and swaps the basemap exactly as today. Behavior-preserving: no visible
 * change.
 *
 * Spec: docs/design/01-spec/architecture.md §"Light / dark mode". Epic #1221.
 */

/**
 * Back-compat bridge: map a `[data-theme]` attribute value to a kind-consistent
 * `ThemeId`. Preserves the legacy `=== 'dark'` semantics — `'dark'` → the
 * `dark`-kind id, every other value (including `null`) → the `positron`-kind id.
 * This is the one-line bridge the existing attribute-driven e2e relies on.
 */
export function attrToThemeId(attr: string | null): ThemeId {
  return attr === 'dark' ? 'dark' : 'positron';
}

/**
 * Read the active `ThemeId` from the live `<html data-theme>` attribute. SSR-safe
 * (returns the `positron` default when `document` is unavailable).
 */
export function readActiveThemeIdFromDom(): ThemeId {
  if (typeof document === 'undefined') return 'positron';
  return attrToThemeId(document.documentElement.getAttribute('data-theme'));
}

/**
 * The minimal maplibre-map surface a basemap swap touches: just `setStyle`.
 *
 * The optional second arg carries MapLibre's `transformStyle` hook (the only
 * `StyleSwapOptions` field the swap uses), so the swap can null-guard the
 * fetched style BEFORE it is committed to the worker (#1230). Typed loosely
 * (`unknown` style operands) so the structural mock in the unit test — and the
 * real `maplibre-gl` `Map.setStyle` (whose `transformStyle` is
 * `(prev?: StyleSpecification, next: StyleSpecification) => StyleSpecification`)
 * — both satisfy it without importing the heavy maplibre type here.
 */
export interface SwappableMap {
  setStyle: (
    style: string,
    options?: { transformStyle?: (previous: unknown, next: unknown) => unknown },
  ) => void;
}

/**
 * The ONE place a basemap URL reaches `setStyle` (#1230 chokepoint). Routes
 * every `setStyle(url, …)` through MapLibre's `transformStyle` hook so the
 * fetched style is null-guarded BEFORE the worker commits it — so a null-prone
 * numeric comparison in the new style (bright/liberty POI rank filters, etc.)
 * never logs `warnOnce("Expected value to be of type number, but found null
 * instead.")` from the worker thread. Shared by both the theme swap
 * (`swapBasemap`) and the Retry re-set (MapCanvas), DRY'ing the only two
 * `setStyle` entry points onto one sanitized call. (The CONSTRUCTOR's initial
 * paint has no `transformStyle` hook and is guarded separately via a
 * pre-sanitized style OBJECT — `loadSanitizedStyle` in the sanitizer module.)
 */
export function setBasemapStyle(map: SwappableMap, url: string): void {
  map.setStyle(url, { transformStyle: transformStyleSanitizeNull });
}

/**
 * Pure, id-driven basemap swap (injection seam #1). Performs exactly ONE swap
 * from a RESOLVED descriptor:
 *
 *   - `setBasemapStyle(map, descriptor.url)` — re-points the basemap at the
 *     descriptor's URL (the url, NOT the kind, drives this) via the shared
 *     transform-guarded setter, and
 *   - `setMaskTheme(descriptor.kind)` — re-tints the state-artboard mask fill in
 *     lockstep (consumed by the `<Layer>` `paint` prop in `MapCanvas`).
 *
 * It receives the descriptor as an ARGUMENT and never calls `resolveDescriptor`,
 * so the same-kind regression guard can drive it directly with two synthetic
 * descriptors that share `kind` but differ in `url`. Same-value de-dup is the
 * CALLER's concern (keyed on the id), so this helper always performs the swap.
 */
export function swapBasemap(
  map: SwappableMap,
  descriptor: BasemapDescriptor,
  setMaskTheme: (kind: BasemapKind) => void,
): void {
  setBasemapStyle(map, descriptor.url);
  setMaskTheme(descriptor.kind);
}

/**
 * The shape `useActiveThemeId` returns: the active id, its resolved descriptor,
 * and the setter that drives an id change (re-resolving the descriptor).
 */
export interface ActiveThemeIdState {
  themeId: ThemeId;
  descriptor: BasemapDescriptor;
  setThemeId: (id: ThemeId) => void;
}

/**
 * Active-theme-id state primitive (injection seam #2). Exposes `setThemeId` to
 * drive an id change; the descriptor is re-resolved from the id on every change
 * — INCLUDING between two same-kind themes.
 *
 * Seeding (C8 · #1220): when `initialId` is supplied it is the seed — this is the
 * FULL id the app resolves at boot (`resolveInitialTheme`, which honors a stored
 * `bright`/`liberty`/`fiord`), so a non-default light/dark theme round-trips
 * across reload instead of collapsing to positron/dark. When `initialId` is
 * omitted (MapCanvas's legacy call, tests) the seed falls back to the
 * `[data-theme]` attribute via {@link readActiveThemeIdFromDom} — the lossy
 * but kind-correct bridge that keeps the existing attribute-driven e2e green.
 *
 * @param resolver maps an id → descriptor. Defaults to the production
 *   `resolveDescriptor` (a closed `THEME_REGISTRY` lookup). Tests override it
 *   with a map of synthetic same-kind descriptors so the same-kind transition is
 *   reachable without widening `ThemeId` or touching `knip.ts`.
 * @param initialId optional explicit seed id (App-level boot resolution).
 */
export function useActiveThemeId(
  resolver: (id: ThemeId) => BasemapDescriptor = resolveDescriptor,
  initialId?: ThemeId,
): ActiveThemeIdState {
  const [themeId, setThemeId] = useState<ThemeId>(
    () => initialId ?? readActiveThemeIdFromDom(),
  );
  const descriptor = useMemo(() => resolver(themeId), [resolver, themeId]);
  const setThemeIdStable = useCallback((id: ThemeId) => {
    setThemeId(id);
  }, []);
  return { themeId, descriptor, setThemeId: setThemeIdStable };
}
