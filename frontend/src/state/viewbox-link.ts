import { MIN_ZOOM, MAX_INTERACTIVE_ZOOM } from '@/components/map/geometry/camera-config.js';

/**
 * viewbox-link — a pure, total-function codec that serializes a map camera
 * (+ an optional capture viewport) into a URL hash fragment and back.
 *
 * WHY a hash: the map camera is never in the URL today — it is derived from
 * scope via `fitBounds` in `App.tsx`. Epic #1238 makes an exact view a
 * copyable link; this codec is the string ↔ object foundation the capture
 * control (C2), the replay tool (C3), and the restore-on-load (C4) all build
 * on. No DOM, no app wiring lives here — `encodeViewbox` returns the fragment
 * (caller assigns it to `location.hash`); `decodeViewbox` takes a raw hash.
 *
 * WHY total decode: a shared link is hand-editable and truncatable. Decode
 * must degrade ANY garbage to a clean `null` ("normal load — derive the
 * camera from scope as usual"), and must NEVER throw and NEVER partial-apply
 * a half-parsed camera (which would strand the map at a corrupt position with
 * no affordance back). Recoverable-but-out-of-range values are CLAMPED, not
 * rejected, so a slightly-off link still opens near the intended view.
 *
 * Grammar: #map=<zoom>/<lat>/<lng>[/<bearing>[/<pitch>]][&v=<W>x<H>@<dpr>]
 * Field order is zoom/lat/lng (lat 2nd, lng 3rd — MapLibre hash order).
 */

export interface ViewboxCamera {
  zoom: number;
  lat: number;
  lng: number;
  bearing?: number; // omitted / 0 when north-up
  pitch?: number; // omitted / 0 when flat
}

export interface ViewboxViewport {
  w: number;
  h: number;
  dpr: number;
}

// Web Mercator latitude limit — the poles are unprojectable, so a link with a
// lat past this clamps here rather than to ±90 (which a MapLibre camera cannot
// represent). MapLibre uses the same ±85.051129 limit.
const MERCATOR_LAT_LIMIT = 85.05113;
const MAX_PITCH = 60;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Serialize a camera (+ optional viewport) into a hash fragment WITHOUT the
 * leading `#`. Fixed-decimal throughout (never `String(n)`) so `-110.9` and
 * `-110.90000` serialize identically and round-trip. Bearing/pitch are emitted
 * only when non-zero; a non-zero pitch with a zero bearing still emits the
 * bearing as `0.0` so the slash positions stay unambiguous.
 */
export function encodeViewbox(cam: ViewboxCamera, viewport?: ViewboxViewport): string {
  const bearing = cam.bearing ?? 0;
  const pitch = cam.pitch ?? 0;

  let value = `${cam.zoom.toFixed(3)}/${cam.lat.toFixed(5)}/${cam.lng.toFixed(5)}`;

  // A north-up flat view produces no trailing /0/0. Pitch implies a bearing
  // slot so the 5th field stays unambiguous — emit bearing (possibly 0.0)
  // whenever bearing OR pitch is non-zero.
  if (bearing !== 0 || pitch !== 0) {
    value += `/${bearing.toFixed(1)}`;
    if (pitch !== 0) {
      value += `/${pitch.toFixed(1)}`;
    }
  }

  let out = `map=${value}`;
  if (viewport) {
    out += `&v=${viewport.w}x${viewport.h}@${viewport.dpr}`;
  }
  return out;
}

/**
 * Parse a viewport from a `v=` sub-value (`<w>x<h>@<dpr>`). Returns the
 * viewport only when all three are positive finite numbers; otherwise
 * `undefined` (a malformed viewport is ignored, never an error).
 */
function parseViewport(raw: string): ViewboxViewport | undefined {
  // Destructure (not index) so `noUncheckedIndexedAccess` narrows each part to
  // `string | undefined`; the explicit `=== undefined` guards below then both
  // satisfy the type checker AND reject a missing `@dpr` / `<h>` at runtime.
  const [dimsPart, dprPart, ...restAt] = raw.split('@');
  // dimsPart is always present at runtime (split yields ≥1 element); the
  // explicit guard satisfies `noUncheckedIndexedAccess`. dprPart present +
  // no extra '@' ⇒ exactly one '@'.
  if (dimsPart === undefined || dprPart === undefined || restAt.length > 0) {
    return undefined;
  }
  const [wPart, hPart, ...restX] = dimsPart.split('x');
  if (wPart === undefined || hPart === undefined || restX.length > 0) {
    return undefined; // exactly one 'x'
  }

  const w = Number(wPart);
  const h = Number(hPart);
  const dpr = Number(dprPart);
  const positiveFinite = (n: number) => Number.isFinite(n) && n > 0;
  if (!positiveFinite(w) || !positiveFinite(h) || !positiveFinite(dpr)) {
    return undefined;
  }
  return { w, h, dpr };
}

/**
 * Decode a hash fragment back into a camera (+ optional viewport). Total —
 * never throws. Returns `null` when no camera is recoverable; otherwise clamps
 * recoverable values into range. A malformed viewport or unknown sub-key is
 * ignored without nulling the camera.
 */
export function decodeViewbox(
  hash: string,
): { camera: ViewboxCamera; viewport?: ViewboxViewport } | null {
  // 1. Strip a leading '#', split on '&', find the map= pair.
  const body = hash.startsWith('#') ? hash.slice(1) : hash;
  const pairs = body.split('&');

  let mapValue: string | null = null;
  let viewportRaw: string | null = null;
  for (const pair of pairs) {
    // Only split on the FIRST '=' so a value containing '=' is preserved.
    const eq = pair.indexOf('=');
    if (eq === -1) continue;
    const key = pair.slice(0, eq);
    const val = pair.slice(eq + 1);
    if (key === 'map') {
      mapValue = val;
    } else if (key === 'v') {
      viewportRaw = val;
    }
    // 6. All other / unknown sub-keys are ignored (forward-compatible).
  }

  if (mapValue === null) return null;

  // 2. Split on '/', require ≥3 fields; Number() rejects trailing garbage.
  const fields = mapValue.split('/');
  if (fields.length < 3) return null;

  const zoom = Number(fields[0]);
  const lat = Number(fields[1]);
  const lng = Number(fields[2]);
  if (Number.isNaN(zoom) || Number.isNaN(lat) || Number.isNaN(lng)) return null;

  // 3. Clamp recoverable values rather than reject. Zoom ceiling is the
  //    INTERACTIVE max (MAX_INTERACTIVE_ZOOM = 17, the camera `maxZoom` cap),
  //    NOT the fitBounds framing cap of 12 — a link captured at z16 must reopen
  //    at z16, and a hand-edited deep link to z20 clamps gracefully to 17
  //    (it still opens, just at the wall). Must equal the camera cap so the
  //    decoded camera is always a reachable position.
  const camera: ViewboxCamera = {
    zoom: clamp(zoom, MIN_ZOOM, MAX_INTERACTIVE_ZOOM),
    lat: clamp(lat, -MERCATOR_LAT_LIMIT, MERCATOR_LAT_LIMIT),
    lng: clamp(lng, -180, 180),
  };

  // 4. Optional bearing: NaN → drop; else normalize into [0, 360).
  if (fields.length >= 4) {
    const bearing = Number(fields[3]);
    if (!Number.isNaN(bearing)) {
      camera.bearing = ((bearing % 360) + 360) % 360;
    }
  }
  // Optional pitch: NaN → drop; else clamp into [0, 60].
  if (fields.length >= 5) {
    const pitch = Number(fields[4]);
    if (!Number.isNaN(pitch)) {
      camera.pitch = clamp(pitch, 0, MAX_PITCH);
    }
  }

  // 5. Parse the viewport if present; ignore (don't null the camera) if malformed.
  const viewport = viewportRaw !== null ? parseViewport(viewportRaw) : undefined;

  return viewport ? { camera, viewport } : { camera };
}
