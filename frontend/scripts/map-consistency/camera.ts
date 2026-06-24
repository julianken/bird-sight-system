// frontend/scripts/map-consistency/camera.ts
import type { BrowserContext, Page, Response } from '@playwright/test';
import { encodeViewbox, type ViewboxCamera } from '@/state/viewbox-link.js';
import { VIEWPORTS, type Bbox, type Viewport } from './types.js';

export interface OpenViewParams {
  scope: string; // 'us' | 'US-AZ'
  center: { lng: number; lat: number };
  zoom: number;
  viewport: Viewport;
  filters?: { since?: string; family?: string; species?: string; notable?: boolean };
}
export interface RawView {
  url: string;
  requestUrl: string;
  requestBbox: Bbox;
  requestZoom: number;
  responseBody: unknown;
  consoleErrors: string[];
  consoleWarnings: string[];
}

function buildUrl(baseUrl: string, p: OpenViewParams): string {
  const cam: ViewboxCamera = { zoom: p.zoom, lat: p.center.lat, lng: p.center.lng };
  const q = new URLSearchParams();
  if (p.scope === 'us' || p.scope === 'US') q.set('scope', 'us');
  else q.set('state', p.scope);
  if (p.filters?.since) q.set('since', p.filters.since);
  if (p.filters?.family) q.set('family', p.filters.family);
  if (p.filters?.species) q.set('species', p.filters.species);
  if (p.filters?.notable) q.set('notable', 'true');
  const vp = VIEWPORTS[p.viewport];
  // ViewboxViewport is { w, h, dpr } (NOT width/height), and encodeViewbox returns
  // the fragment WITHOUT a leading '#' — e.g. "map=9.000/32.22175/-110.97648&v=1440x900@1".
  // (bot review #1268: wrong field names silently emit &v=undefinedxundefined@1.)
  let hash = encodeViewbox(cam, { w: vp.width, h: vp.height, dpr: vp.dpr });
  if (!hash.startsWith('#')) hash = `#${hash}`;
  return `${baseUrl.replace(/\/$/, '')}/?${q.toString()}${hash}`;
}

function parseObsParams(reqUrl: string): { bbox?: Bbox; zoom?: number } {
  const u = new URL(reqUrl);
  const b = u.searchParams.get('bbox');
  const z = u.searchParams.get('zoom');
  return { bbox: b ? (b.split(',').map(Number) as Bbox) : undefined, zoom: z != null ? Number(z) : undefined };
}
const bboxCenter = (b: Bbox) => ({ lng: (b[0] + b[2]) / 2, lat: (b[1] + b[3]) / 2 });

function waitForMatchingObs(page: Page, p: OpenViewParams, timeoutMs: number): Promise<Response> {
  const ZOOM_EPS = 0.6;
  // Absolute floor for the center match (governs high zoom, where the view is
  // small and a near-exact center is expected). At LOW zoom the camera snaps to
  // the scope's fitBounds bounds — e.g. a z3 national view frames the whole US
  // (bbox lat 20–52, center 36), so the hash's requested center (39) is off by
  // ~3°. A fixed 0.75° floor wrongly rejects that genuine match. So the
  // tolerance also scales with HALF the request's own bbox span: the wider the
  // served view, the more center drift is normal. half-span at z3 ≈ 16° lng /
  // 8° lat — comfortably admits the 0.5°/3° national drift while still rejecting
  // a differently-framed fetch. (Live-tuned: C2 z3 smoke timed out at 0.75°.)
  const CENTER_FLOOR_DEG = 0.75;
  const SPAN_FRACTION = 0.5;
  return page.waitForResponse((res) => {
    if (!/\/api\/observations\b/.test(res.url())) return false;
    const { bbox, zoom } = parseObsParams(res.url());
    if (bbox === undefined || zoom === undefined) return false;
    if (Math.abs(zoom - p.zoom) > ZOOM_EPS) return false;
    const c = bboxCenter(bbox);
    const lngTol = Math.max(CENTER_FLOOR_DEG, Math.abs(bbox[2] - bbox[0]) * SPAN_FRACTION);
    const latTol = Math.max(CENTER_FLOOR_DEG, Math.abs(bbox[3] - bbox[1]) * SPAN_FRACTION);
    return Math.abs(c.lng - p.center.lng) <= lngTol && Math.abs(c.lat - p.center.lat) <= latTol;
  }, { timeout: timeoutMs });
}

export async function openView(
  context: BrowserContext,
  baseUrl: string,
  p: OpenViewParams,
  opts?: { settleMs?: number; timeoutMs?: number },
): Promise<{ page: Page; raw: RawView }> {
  const vp = VIEWPORTS[p.viewport];
  const page = await context.newPage();
  await page.setViewportSize({ width: vp.width, height: vp.height });
  const consoleErrors: string[] = [];
  const consoleWarnings: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
    else if (m.type() === 'warning') consoleWarnings.push(m.text());
  });
  const url = buildUrl(baseUrl, p);
  const matched = waitForMatchingObs(page, p, opts?.timeoutMs ?? 15000);
  await page.goto(url, { waitUntil: 'commit' });
  const response = await matched;
  // Settle long enough for the adaptive-grid markers AND the family legend list
  // to finish rendering post-match before capture reads the DOM. Live-tuned
  // against prod (C2 smoke): at 1200ms both the legend `<ul>` and the markers
  // were still empty; 2500ms reliably yields the full set (19 markers / 49
  // legend rows at the z9 Tucson camera).
  await page.waitForTimeout(opts?.settleMs ?? 2500); // let markers + legend re-render post-match
  const { bbox, zoom } = parseObsParams(response.url());
  const responseBody = await response.json().catch(() => null);
  return { page, raw: { url, requestUrl: response.url(), requestBbox: bbox!, requestZoom: zoom!, responseBody, consoleErrors, consoleWarnings } };
}
