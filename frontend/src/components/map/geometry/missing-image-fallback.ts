/**
 * `styleimagemissing` fallback (issue #947).
 *
 * OpenFreeMap's dark + fiord styles reference `icon-image: ["step", ["zoom"],
 * "circle-11", 9, ""]` on the place_town/place_city/place_city_large symbol
 * layers, but their sprite only ships `circle_11` (underscore) — an upstream
 * hyphen/underscore drift. positron/bright/liberty don't reference it, which is
 * why the warning was dark/fiord-only. maplibre, unable to resolve `circle-11`,
 * fires `styleimagemissing` and `warnOnce`s `Image "circle-11" could not be
 * loaded …`, polluting the console (especially once C8 made theme-swapping —
 * and thus dark/fiord loads — frequent).
 *
 * This is maplibre's documented remedy: register a single global
 * `styleimagemissing` listener that adds a 1×1 fully-transparent image for ANY
 * missing id (not just `circle-11`), guarded by `hasImage` so we never re-add.
 * A transparent placeholder makes the symbol render as nothing — exactly what
 * the `circle-11` step expression already evaluates to at the zooms where the
 * sprite is absent — while silencing the warning structurally.
 *
 * Lifecycle: the image registry and event listeners survive `setStyle`, so this
 * registers ONCE per map lifetime (called from MapCanvas's `handleLoad`). The
 * 1×1 RGBA buffer is `new Uint8Array(4)` — all zero ⇒ alpha 0 ⇒ transparent.
 *
 * Consumes a minimal structural surface (same idiom as `silhouette-sprite.ts`'s
 * `SpriteMap` and `artboard-layers.ts`'s `ArtboardMap`), so it unit-tests
 * against a tiny spy with no WebGL. `addImage`'s raw-image overload
 * (`{ width, height, data }`) is the maplibre-gl 5.x shape (verified against
 * 5.x docs — the `StyleImageMissingEvent` carries `id`).
 */
export interface MissingImageMap {
  hasImage: (id: string) => boolean;
  addImage: (
    id: string,
    image: { width: number; height: number; data: Uint8Array },
  ) => void;
  on: (type: 'styleimagemissing', listener: (e: { id: string }) => void) => unknown;
}

/**
 * Register the once-per-map `styleimagemissing` fallback. Adds a 1×1
 * transparent placeholder for the missing id, guarded by `hasImage` (no-op when
 * the id is already registered — defends against double-fire / re-entrancy).
 */
export function registerMissingImageFallback(map: MissingImageMap): void {
  map.on('styleimagemissing', (e) => {
    if (map.hasImage(e.id)) return;
    map.addImage(e.id, { width: 1, height: 1, data: new Uint8Array(4) });
  });
}
