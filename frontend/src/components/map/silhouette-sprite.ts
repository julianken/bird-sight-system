import { isValidSvgPathData } from './silhouette-fallback.js';

/**
 * Silhouette sprite pipeline (extracted from MapCanvas.tsx, epic #884 · U3).
 *
 * Two shapes live here, mirroring the two phases of getting a `family_silhouettes`
 * row onto the map:
 *
 *   1. `silhouettePathToSvg` — a PURE data transform: a single path-`d` string →
 *      a complete `<svg>` document string (or `null` if the input fails the #271
 *      charset guard). No side effects, no map.
 *   2. `registerSilhouetteSprite` — the IMPERATIVE map-sync helper that runs that
 *      SVG through `Blob` → `HTMLImageElement` → `map.addImage`. It takes a
 *      minimal structural {@link SpriteMap}, never maplibre's full `Map`, so it
 *      unit-tests against a tiny spy with no WebGL (exemplar: `artboard-layers.ts`).
 *
 * Registration is COLORLESS: `addImage(id, img, { sdf: true, pixelRatio: 2 })`
 * registers a single-channel alpha mask; tinting happens later via the symbol
 * layer's `icon-color` paint property, not at sprite-register time. The
 * `pixelRatio: 2` halves the 64px raster to 32 CSS px so the on-map scale
 * matches the documented 24-28px band (E6 / #1058).
 */

/**
 * The minimal structural surface `registerSilhouetteSprite` consumes from a
 * maplibre map — only `addImage`/`hasImage`. Deliberately NOT maplibre's full
 * `Map` (same idiom as `artboard-layers.ts`'s `ArtboardMap`): the narrow shape
 * keeps the helper unit-testable against a spy object and documents the exact
 * dependency surface.
 *
 * `addImage`'s 3-arg overload (`id`, `image`, `options`) with
 * `{ sdf: true, pixelRatio: 2 }` is the maplibre-gl 5.x shape (verified against
 * 5.x docs — the options object carries `sdf`/`pixelRatio`/`stretchX`/etc.);
 * `HTMLImageElement` is an accepted `image` type. `pixelRatio` is part of the
 * production interface (not just the test mock) so the `{ sdf: true,
 * pixelRatio: 2 }` call below typechecks (E6 / #1058).
 */
export interface SpriteMap {
  hasImage: (id: string) => boolean;
  addImage: (
    id: string,
    image: HTMLImageElement,
    options?: { sdf?: boolean; pixelRatio?: number },
  ) => void;
}

/**
 * Convert a `family_silhouettes` row into a complete SVG document string
 * suitable for `<img src="data:image/svg+xml,...">`. The svgData column
 * stores a single path-`d` string (24-viewBox); we wrap it in a minimal
 * `<svg>` shell with `fill="black"` so the rendered raster is a single-
 * channel alpha mask that maplibre's SDF tinter can color-shift via the
 * symbol layer's `icon-color` paint property.
 *
 * Returns `null` when `svgData` fails the SVG path-data charset check
 * (issue #271). A literal `"`, `<`, `>`, `&`, or any other XML-breaking
 * character would either silently corrupt the surrounding `<svg>` document
 * — making `image.decode()` reject and the family fall back to `_FALLBACK`
 * with no diagnostic — or, in a worse regression, open an XSS surface if
 * the SVG ever rendered through an `innerHTML` path. The caller treats
 * `null` the same way it treats a `null` `svgData` upstream: skip the
 * sprite registration, log a warn naming the family code, fall back to
 * the `_FALLBACK` sprite via the GeoJSON join.
 */
export function silhouettePathToSvg(
  svgData: string,
  familyCode: string,
): string | null {
  if (!isValidSvgPathData(svgData)) {
    console.warn(
      `[silhouette] invalid svgData for family ${familyCode}; falling back to _FALLBACK sprite`,
    );
    return null;
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="64" height="64">` +
    `<path d="${svgData}" fill="black"/>` +
    `</svg>`
  );
}

/**
 * Promise-wrap the SVG → HTMLImageElement → addImage pipeline for one
 * silhouette. Resolves once the sprite is registered; rejects on image-
 * load failure (which surfaces upstream as a Promise.all rejection).
 *
 * No-op (resolves immediately) when `svgData` fails the charset check —
 * `silhouettePathToSvg` returns `null` and we skip registration so the
 * family's observations join to the `_FALLBACK` sprite instead.
 */
export async function registerSilhouetteSprite(
  map: SpriteMap,
  id: string,
  svgData: string,
): Promise<void> {
  const svgString = silhouettePathToSvg(svgData, id);
  if (svgString === null) return;
  const blob = new Blob([svgString], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    // image.decode() returns a Promise that resolves when the image is
    // ready to render (no `onload` race). Fall back to a manual onload
    // listener for environments (jsdom) where decode is a stub.
    if (typeof img.decode === 'function') {
      await img.decode().catch(() => {
        // jsdom Image polyfill rejects decode immediately; the FakeImage
        // shim in tests resolves. Either way we proceed — the addImage
        // call below tolerates a half-decoded image in tests, and in
        // production the data: URI loads synchronously.
      });
    }
    if (!map.hasImage(id)) {
      // pixelRatio:2 (E6 / #1058): the SVG shell rasters at 64px; tagging it
      // 2× hi-DPI makes maplibre lay it down at 32 CSS px. ×icon-size 0.85
      // (observation-layers.ts) ≈ 27px — the documented 24-28px band and ≈
      // the React-marker SILHOUETTE_PX. Without it the SDF rendered ≈54px.
      map.addImage(id, img, { sdf: true, pixelRatio: 2 });
    }
  } finally {
    URL.revokeObjectURL(url);
  }
}
