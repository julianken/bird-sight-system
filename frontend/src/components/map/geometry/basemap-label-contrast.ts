/**
 * Dark-mode basemap label contrast enforcement (#1128).
 *
 * bird-maps dark mode does NOT apply a CSS filter — it swaps the basemap to a
 * DIFFERENT MapLibre style via `setStyle` (`BASEMAP_DARK =
 * https://tiles.openfreemap.org/styles/dark`; see basemap-style.ts). That dark
 * style ships LIGHT-mode label text colors (`hsl(0,0%,37%)` / `#656565` /
 * `rgba(80,78,78,1)` …), so at z14 every basemap symbol layer carrying a
 * `text-field` fails WCAG AA against the dark canvas (`background-color`
 * `rgb(12,12,12)`): the near-black `water_name` label sits at ~1.07 contrast —
 * effectively invisible — and the `hsl()`/gray road + place labels at ~3.0–3.4,
 * all below the 4.5 AA floor. The dark style's halos are dark too
 * (`rgba(0,0,0,0.7)`), so they don't help.
 *
 * `enforceDarkLabelContrast(map, descriptor)` recolors the FAILING label layers
 * to an AA-passing LIGHT text + DARK halo, preserving the light-style visual
 * hierarchy (roads brightest, place a notch muted, water tinted). It runs at
 * `style.load` — co-located with `sanitizeNullNumericFilters` (basemap-null-
 * filter.ts) — so it re-applies on initial load AND on every basemap `setStyle`
 * swap / Retry re-set, mirroring the same re-apply contract.
 *
 * #1214 (C2) decoupled this helper from hardcoded facts about two specific
 * styles. The injected `BasemapDescriptor` now carries them:
 *   - **Style-level no-op gates on `descriptor.kind`.** A non-dark descriptor
 *     returns immediately — no background-luminance guess. (Was a luminance read
 *     of the bg layer; the bg is no longer consulted.)
 *   - **The recolor palette is `descriptor.darkLabelTextColors`** — the declared
 *     per-tier source of truth, not module-level constants.
 *   - **The per-layer canvas reference is `descriptor.landColor`** — the declared
 *     dominant land, against which the MEASURED-contrast gate runs.
 *   - **Label detection is `isLabelLayer`** (basemap-style.ts) — a `symbol` layer
 *     with a `text-field` whose `source` is NOT `observations`. This excludes the
 *     app's own observation symbol layers from recolor (a deliberate, scoped
 *     behavior change vs the old source-less inline check).
 *
 * It is STRUCTURAL and FAILS OPEN:
 *   - **No-op off the dark kind.** `descriptor.kind !== 'dark'` → returns without
 *     touching anything (light styles are never recolored).
 *   - **No hardcoded layer-id list.** Every `isLabelLayer` whose CURRENT
 *     `text-color` fails AA *against `descriptor.landColor`* is recolored; the id
 *     only chooses the palette tier (road / place / water), with a sensible
 *     default.
 *   - **Per-layer MEASURED gate.** The gate is the measured current contrast vs
 *     the declared land, recomputed each pass. This is the correctness core: on a
 *     NON-near-black dark land (fiord) a label already ≥ AA is left alone, and
 *     only a failing label is recolored. It is ALSO what makes the helper
 *     idempotent — after the first pass a layer's text-color is already a light
 *     value that passes AA → it is skipped on every subsequent pass.
 *   - **Never adds/removes layers**, only `setPaintProperty`. Wrapped in
 *     try/catch so a malformed style after a swap can never throw out of the
 *     `style.load` handler. A layer whose `text-color` is an expression we
 *     can't parse to a constant color is left untouched (not a crash).
 */
import { isLabelLayer, type BasemapDescriptor } from './basemap-style.js';

/** WCAG AA contrast floor for normal-size text. */
const AA_CONTRAST = 4.5;

/** Near-canvas dark halo so the light text separates from light features too. */
const LABEL_HALO = 'rgba(8,10,14,0.85)';

/**
 * Minimal maplibre-map surface this pass needs. The per-layer object on
 * `getStyle().layers[]` carries `source` + `layout` so `isLabelLayer` is the
 * single label oracle (no separate `getLayoutProperty` round-trip for
 * detection). Trivially mockable.
 */
export interface LabelContrastMap {
  getStyle: () =>
    | {
        layers?: Array<{
          id: string;
          type?: string;
          source?: string;
          layout?: Record<string, unknown>;
        }>;
      }
    | undefined;
  getPaintProperty: (layerId: string, name: string) => unknown;
  setPaintProperty: (layerId: string, name: string, value: unknown) => void;
}

/**
 * Parse a constant CSS color string the basemap styles emit — `#rgb`/`#rrggbb`,
 * `rgb()/rgba()`, `hsl()/hsla()` — into `[r,g,b]` (0–255). Returns `null` for
 * anything that isn't a parseable constant color (e.g. a maplibre expression
 * array like `["interpolate", …]`, or `'transparent'`), so the caller can skip
 * it rather than crash. Alpha is intentionally ignored: contrast is computed
 * against the opaque canvas and a partially-transparent dark label color (e.g.
 * the style's `hsla(0,0%,0%,0.7)`) is still "dark" for gating purposes.
 */
export function parseColorToRgb(input: unknown): [number, number, number] | null {
  if (typeof input !== 'string') return null;
  const s = input.trim().toLowerCase();

  if (s.startsWith('#')) {
    let h = s.slice(1);
    if (h.length === 3) h = h.replace(/(.)/g, '$1$1');
    if (h.length !== 6) return null;
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    if ([r, g, b].some(Number.isNaN)) return null;
    return [r, g, b];
  }

  const inner = (prefix: string): number[] | null => {
    if (!s.startsWith(prefix)) return null;
    const open = s.indexOf('(');
    const close = s.lastIndexOf(')');
    if (open < 0 || close < 0) return null;
    const parts = s
      .slice(open + 1, close)
      .split(',')
      .map((p) => Number.parseFloat(p));
    if (parts.some(Number.isNaN)) return null;
    return parts;
  };

  const rgb = inner('rgb');
  if (rgb) {
    const [r, g, b] = rgb;
    if (r === undefined || g === undefined || b === undefined) return null;
    return [clamp255(r), clamp255(g), clamp255(b)];
  }

  const hsl = inner('hsl');
  if (hsl) {
    const [h, sat, light] = hsl;
    if (h === undefined || sat === undefined || light === undefined) return null;
    return hslToRgb(h, sat / 100, light / 100);
  }

  return null;
}

function clamp255(n: number): number {
  return Math.min(255, Math.max(0, n));
}

function hslToRgb(h: number, sat: number, light: number): [number, number, number] {
  const c = (1 - Math.abs(2 * light - 1)) * sat;
  const hp = ((h % 360) + 360) % 360 / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = light - c / 2;
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

/** WCAG 2.2 relative luminance from sRGB `[r,g,b]` (0–255). */
function luminanceFromRgb([r, g, b]: [number, number, number]): number {
  const lin = (c: number): number => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio between two parsed colors. */
function contrastFromRgb(
  a: [number, number, number],
  b: [number, number, number],
): number {
  const la = luminanceFromRgb(a);
  const lb = luminanceFromRgb(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * Choose the palette tier from the layer id (light-style hierarchy) and return
 * the COLOR from the descriptor's `darkLabelTextColors`. The id heuristic
 * selects WHICH tier; the descriptor supplies the value.
 */
function textColorForLayer(
  id: string,
  tiers: { road: string; place: string; water: string },
): string {
  const lower = id.toLowerCase();
  if (lower.includes('highway') || lower.includes('road') || lower.includes('shield')) {
    return tiers.road;
  }
  if (lower.includes('water') || lower.includes('marine') || lower.includes('ocean')) {
    return tiers.water;
  }
  return tiers.place; // place_*, country_*, and any other label default
}

/**
 * Recolor every failing basemap label layer on a dark-kind basemap to an
 * AA-passing light text + dark halo. No-op off the dark kind; idempotent; fails
 * open. See the file-level comment for the full contract.
 */
export function enforceDarkLabelContrast(
  map: LabelContrastMap,
  descriptor: BasemapDescriptor,
): void {
  try {
    // ── Style-level kind gate ─────────────────────────────────────────────
    // Only dark-kind basemaps are recolored. (Replaces the old bg-luminance
    // guess: the canvas polarity is a declared fact on the descriptor.)
    if (descriptor.kind !== 'dark') return;

    // A dark-kind descriptor MUST declare its per-tier dark-label palette
    // (registry invariant). Missing it is a registry bug — fail open rather
    // than recolor with `undefined`.
    const tiers = descriptor.darkLabelTextColors;
    if (!tiers) return;

    // The per-layer measured-contrast gate runs against the descriptor's
    // declared land (the source of truth), not a re-read of the bg layer.
    const landRgb = parseColorToRgb(descriptor.landColor);
    if (!landRgb) return; // can't read the declared canvas → don't touch anything

    const layers = map.getStyle()?.layers ?? [];

    for (const layer of layers) {
      // Single label oracle: symbol + text-field, NOT an observations layer.
      if (!isLabelLayer(layer)) continue;

      const current = parseColorToRgb(map.getPaintProperty(layer.id, 'text-color'));
      // Skip layers whose text-color is an expression / `transparent` we can't
      // parse (don't crash, don't measure an unparseable color).
      if (!current) continue;

      // Idempotent + per-layer correctness: gate on the MEASURED current
      // contrast vs the declared land. After our first pass the color is
      // already a light value that passes → skipped next time. On a
      // mid-luminance dark land a label already ≥ AA is left untouched.
      if (contrastFromRgb(current, landRgb) >= AA_CONTRAST) continue;

      map.setPaintProperty(layer.id, 'text-color', textColorForLayer(layer.id, tiers));
      map.setPaintProperty(layer.id, 'text-halo-color', LABEL_HALO);

      // A 0-width halo doesn't read; bump to 1 so the dark halo actually
      // separates the label. Leave an already-wide halo as the style set it.
      const haloWidth = map.getPaintProperty(layer.id, 'text-halo-width');
      if (typeof haloWidth !== 'number' || haloWidth < 1) {
        map.setPaintProperty(layer.id, 'text-halo-width', 1);
      }
    }
  } catch {
    /* defensive — style churn after a swap; QA detects any residual low-contrast */
  }
}
