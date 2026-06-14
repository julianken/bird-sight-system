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
 * `enforceDarkLabelContrast(map)` recolors the FAILING label layers to an
 * AA-passing LIGHT text + DARK halo, preserving the light-style visual
 * hierarchy (roads brightest, place a notch muted, water tinted). It runs at
 * `style.load` — co-located with `sanitizeNullNumericFilters` (basemap-null-
 * filter.ts) — so it re-applies on initial load AND on every `[data-theme]`
 * `setStyle` swap / Retry re-set, mirroring the same re-apply contract.
 *
 * It is STRUCTURAL and FAILS OPEN:
 *   - **No-op on the light style.** It reads the background layer's luminance
 *     first; on the light positron style (bg ≈ rgb(242,243,240), luminance
 *     ≈ 0.9) it returns without touching anything. Only a genuinely-dark canvas
 *     (luminance < DARK_BG_LUMINANCE) is recolored.
 *   - **No hardcoded layer-id list.** Every `symbol` layer with a `text-field`
 *     whose CURRENT `text-color` fails AA is recolored; the id only chooses the
 *     palette tier (road / place / water), with a sensible default.
 *   - **Idempotent.** The gate is the MEASURED current contrast, recomputed each
 *     pass. After the first pass a layer's text-color is already a light value
 *     that passes AA → it is skipped on every subsequent pass.
 *   - **Never adds/removes layers**, only `setPaintProperty`. Wrapped in
 *     try/catch so a malformed style after a swap can never throw out of the
 *     `style.load` handler. A layer whose `text-color` is an expression we
 *     can't parse to a constant color is left untouched (not a crash).
 */

/** WCAG AA contrast floor for normal-size text. */
const AA_CONTRAST = 4.5;

/**
 * Luminance below which the canvas counts as "dark" and we recolor. The dark
 * style's bg is rgb(12,12,12) (luminance ≈ 0.0017); positron's is
 * rgb(242,243,240) (luminance ≈ 0.90). 0.2 sits comfortably between, so the
 * gate is robust to either basemap shifting its exact bg shade.
 */
const DARK_BG_LUMINANCE = 0.2;

/**
 * AA-passing light text palette (verified ≥ 4.5 vs rgb(12,12,12) — see the
 * unit test). Deliberately muted grays, not pure white (#fff glares). The
 * hierarchy mirrors the light style: roads brightest, place a notch muted,
 * water a lightened cousin of the light style's `#495e91`.
 *
 * Exported (#1217 / C5) so the contrast audit in basemap-label-contrast.test.ts
 * asserts the REAL symbols against each registered dark-kind land, never a
 * hand-copied mirror. Values are unchanged — exporting is the only edit.
 */
export const ROAD_TEXT = '#d8d8d8';
export const PLACE_TEXT = '#c4c4c4';
export const WATER_TEXT = '#9db4d8';
/** Near-canvas dark halo so the light text separates from light features too. */
const LABEL_HALO = 'rgba(8,10,14,0.85)';

/** Minimal maplibre-map surface this pass needs. Trivially mockable. */
export interface LabelContrastMap {
  getStyle: () => { layers?: Array<{ id: string; type?: string }> } | undefined;
  getPaintProperty: (layerId: string, name: string) => unknown;
  getLayoutProperty: (layerId: string, name: string) => unknown;
  setPaintProperty: (layerId: string, name: string, value: unknown) => void;
}

/**
 * Parse a constant CSS color string the basemap styles emit — `#rgb`/`#rrggbb`,
 * `rgb()/rgba()`, `hsl()/hsla()` — into `[r,g,b]` (0–255). Returns `null` for
 * anything that isn't a parseable constant color (e.g. a maplibre expression
 * array like `["interpolate", …]`), so the caller can skip it rather than crash.
 * Alpha is intentionally ignored: contrast is computed against the opaque canvas
 * and a partially-transparent dark label color (e.g. the style's
 * `hsla(0,0%,0%,0.7)`) is still "dark" for gating purposes.
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

/** Choose the palette tier from the layer id (light-style hierarchy). */
function textColorForLayer(id: string): string {
  const lower = id.toLowerCase();
  if (lower.includes('highway') || lower.includes('road') || lower.includes('shield')) {
    return ROAD_TEXT;
  }
  if (lower.includes('water') || lower.includes('marine') || lower.includes('ocean')) {
    return WATER_TEXT;
  }
  return PLACE_TEXT; // place_*, country_*, and any other label default
}

/**
 * Recolor every failing basemap label layer on a genuinely-dark canvas to an
 * AA-passing light text + dark halo. No-op on the light style; idempotent;
 * fails open. See the file-level comment for the full contract.
 */
export function enforceDarkLabelContrast(map: LabelContrastMap): void {
  try {
    const layers = map.getStyle()?.layers ?? [];

    // ── Fail-open dark detection ──────────────────────────────────────────
    // Find the background layer; only proceed if its color is genuinely dark.
    const bg = layers.find((l) => l.type === 'background');
    if (!bg) return;
    const bgRgb = parseColorToRgb(map.getPaintProperty(bg.id, 'background-color'));
    if (!bgRgb) return; // can't read the canvas → don't touch anything
    if (luminanceFromRgb(bgRgb) >= DARK_BG_LUMINANCE) return; // light style → no-op

    for (const layer of layers) {
      if (layer.type !== 'symbol') continue;
      // Only layers that actually render text.
      if (map.getLayoutProperty(layer.id, 'text-field') == null) continue;

      const current = parseColorToRgb(map.getPaintProperty(layer.id, 'text-color'));
      // Skip layers whose text-color is an expression we can't parse (don't crash).
      if (!current) continue;

      // Idempotent: gate on the MEASURED current contrast. After our first pass
      // the color is already a light value that passes → skipped next time.
      if (contrastFromRgb(current, bgRgb) >= AA_CONTRAST) continue;

      map.setPaintProperty(layer.id, 'text-color', textColorForLayer(layer.id));
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
