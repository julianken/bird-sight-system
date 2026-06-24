// frontend/scripts/map-consistency/capture.ts
import type { Page } from '@playwright/test';
import type { ObservationsResponse } from '@bird-watch/shared-types';
import type { Bbox, FamilyCount, GeoPoint, LedeRead, MarkerRead, NetworkView, ViewSnapshot, Viewport } from './types.js';
import type { RawView } from './camera.js';

const CELL_ARIA = /^(?<family>.+),\s+(?<count>\d+)\s+observations?$/;
const MARKER_ARIA = /^Cluster:\s+(?<total>\d+)\s+observations?,\s+(?<families>\d+)\s+families/;
// A cluster-pill's aria-label is `countNoun(count, 'sighting')` →
// "1,164 sightings" (thousands-separator commas, singular "sighting" at 1).
const PILL_ARIA = /^(?<total>[\d,]+)\s+sightings?$/;
// "cluster-pill cluster-pill--ember" → modifier "ember" (one of sky / sand / ember).
const PILL_MODIFIER = /\bcluster-pill--(?<color>[a-z]+)\b/;
const TILE_FAIL = /openfreemap|ERR_CONNECTION|failed to fetch.*tile/i;

export function normalizeNetwork(body: unknown, bbox: Bbox, zoom: number): NetworkView {
  const empty: NetworkView = { mode: 'unknown', bbox, zoom, truncated: false, freshestObservationAt: null, total: 0, familyCounts: [], points: [], speciesCount: null };
  if (!body || typeof body !== 'object' || !('mode' in body)) return empty;
  const r = body as ObservationsResponse;
  const fams = new Map<string, number>();
  const points: GeoPoint[] = [];
  let total = 0;
  let truncated = false;
  let freshest: string | null = null;
  if (r.mode === 'aggregated') {
    for (const b of r.buckets ?? []) {
      total += b.count;
      points.push({ lng: b.lng, lat: b.lat, count: b.count });
      for (const f of b.families ?? []) {
        const key = f.name ?? f.code;
        fams.set(key, (fams.get(key) ?? 0) + f.count);
      }
    }
    freshest = r.meta?.freshestObservationAt ?? null;
  } else if (r.mode === 'observations') {
    for (const o of r.data ?? []) { total += 1; points.push({ lng: o.lng, lat: o.lat, count: 1 }); }
    truncated = r.meta?.truncated === true;
    freshest = r.meta?.freshestObservationAt ?? null;
  }
  return { mode: r.mode, bbox, zoom, truncated, freshestObservationAt: freshest, total, familyCounts: [...fams].map(([family, count]) => ({ family, count })), points, speciesCount: null };
}

export async function readLede(page: Page): Promise<LedeRead> {
  const text = (await page.locator('[data-testid="map-lede"]').first().textContent().catch(() => '')) ?? '';
  const m = text.replace(/,/g, '').match(/(\d+)/);
  return { text: text.trim(), firstInt: m ? Number(m[1]) : null, unit: /species/.test(text) ? 'species' : /sighting/.test(text) ? 'sightings' : null };
}

export async function readLegend(page: Page): Promise<FamilyCount[]> {
  const toggle = page.locator('#family-legend-toggle');
  if (await toggle.count()) {
    if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click().catch(() => {});
    await page.waitForTimeout(150);
  }
  // Confirm the row testid live in the smoke (stale local tree: `family-legend-entry`).
  const rows = page.locator('aside.family-legend [data-testid="family-legend-entry"]');
  const out: FamilyCount[] = [];
  const n = await rows.count();
  for (let i = 0; i < n; i++) {
    const label = (await rows.nth(i).locator('.family-legend-entry-label').textContent().catch(() => '')) ?? '';
    const c = (await rows.nth(i).locator('.family-legend-entry-count').textContent().catch(() => '')) ?? '';
    out.push({ family: label.trim(), count: Number(c.replace(/,/g, '')) || 0 });
  }
  return out;
}

export async function readMarkers(page: Page): Promise<MarkerRead[]> {
  const out: MarkerRead[] = [];

  // (1) Grid markers — the family-cell `adaptive-grid-marker` form (kind:'grid').
  const grids = page.locator('[data-testid="adaptive-grid-marker"]');
  const n = await grids.count();
  for (let i = 0; i < n; i++) {
    const mk = grids.nth(i);
    const ma = ((await mk.getAttribute('aria-label')) ?? '').match(MARKER_ARIA);
    const cells = mk.locator('[data-testid^="adaptive-grid-marker-cell"]');
    const cellOut: FamilyCount[] = [];
    const cn = await cells.count();
    for (let j = 0; j < cn; j++) {
      const cm = ((await cells.nth(j).getAttribute('aria-label')) ?? '').match(CELL_ARIA);
      if (cm?.groups) cellOut.push({ family: cm.groups.family.trim(), count: Number(cm.groups.count) });
    }
    // Mobile markers collapse extra families into a "+N" overflow pill — its
    // presence means rendered cells legitimately under-count the marker's
    // families (MR-2/MR-3 carve-out `mobile-overflow`).
    const overflow = (await mk.locator('[data-testid="adaptive-grid-marker-overflow"]').count()) > 0;
    out.push({
      kind: 'grid',
      total: cellOut.reduce((s, c) => s + c.count, 0),
      markerTotal: ma?.groups ? Number(ma.groups.total) : null,
      familyCount: ma?.groups ? Number(ma.groups.families) : null,
      cells: cellOut,
      overflow,
    });
  }

  // (2) Cluster pills — the collapsed `.cluster-pill` form (kind:'pill', §5.2).
  // The capture was previously BLIND to these, so it read 0 markers at low zoom
  // (false MR-1) and undercounted rendered totals. A pill carries only a total
  // count (no family breakdown) in its aria-label "N sightings".
  const pills = page.locator('.cluster-pill');
  const pn = await pills.count();
  for (let i = 0; i < pn; i++) {
    const pl = pills.nth(i);
    const label = (await pl.getAttribute('aria-label')) ?? '';
    const pm = label.match(PILL_ARIA);
    const total = pm?.groups ? Number(pm.groups.total.replace(/,/g, '')) : 0;
    const cls = (await pl.getAttribute('class')) ?? '';
    const color = cls.match(PILL_MODIFIER)?.groups?.color;
    out.push({
      kind: 'pill',
      total,
      ...(color ? { color } : {}),
      markerTotal: total,
      familyCount: null,
      cells: [],
      overflow: false,
    });
  }

  return out;
}

export async function captureView(page: Page, raw: RawView, p: { scope: string; viewport: Viewport; zoom: number; center: { lng: number; lat: number } }): Promise<ViewSnapshot> {
  const network = normalizeNetwork(raw.responseBody, raw.requestBbox, raw.requestZoom);
  const [lede, legend, markers] = await Promise.all([readLede(page), readLegend(page), readMarkers(page)]);
  const inconclusive = raw.consoleErrors.some((e) => TILE_FAIL.test(e)) ? { reason: 'basemap tile CDN failure' } : undefined;
  return { url: raw.url, scope: p.scope, viewport: p.viewport, requestedZoom: p.zoom, requestedCenter: p.center, network, lede, legend, markers, consoleErrors: raw.consoleErrors, consoleWarnings: raw.consoleWarnings, inconclusive };
}
