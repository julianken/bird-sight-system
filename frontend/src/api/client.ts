import type {
  Hotspot, Observation, ObservationsResponse, SpeciesMeta, ObservationFilters,
  FamilySilhouette, StateSummary, SpeciesDictEntry,
} from '@bird-watch/shared-types';
import { canonicalFetchBboxParam, serializeBbox } from '@bird-watch/geo';

export interface ApiClientOptions {
  baseUrl?: string;
}

export class ApiError extends Error {
  constructor(public status: number, public body: string) {
    super('Something went wrong — please try again');
  }
}

export class ApiClient {
  private readonly baseUrl: string;

  constructor(opts: ApiClientOptions = {}) {
    this.baseUrl = opts.baseUrl ?? '';
  }

  getHotspots(): Promise<Hotspot[]> {
    return this.get<Hotspot[]>('/api/hotspots');
  }

  async getObservations(f: ObservationFilters = {}): Promise<ObservationsResponse> {
    const url = new URL('/api/observations', 'http://x');
    if (f.since) url.searchParams.set('since', f.since);
    if (f.notable === true) url.searchParams.set('notable', 'true');
    if (f.speciesCode) url.searchParams.set('species', f.speciesCode);
    if (f.familyCode) url.searchParams.set('family', f.familyCode);
    if (f.bbox) {
      // #868 — reconstruct a CANONICAL fetch bbox from (snapped-midpoint, zoom)
      // so every device at the same view collapses to ONE Cloudflare cache key
      // (scheme a, fixed-size). This supersedes the #866/#867 edge-snap (scheme
      // b), whose key still depended on the pixel-viewport extent — a 390px
      // phone and a 1440px desktop at the same center minted different keys, so
      // the warmer's anchors never matched real device-derived keys (prod MISS
      // confirmed 2026-06-04). Canonicalization applies only in the aggregated
      // path (zoom < 6); at zoom >= 6 `canonicalFetchBboxParam` is a passthrough
      // — reconstructing a fixed box past the validate.ts area cap would 400.
      // Done at fetch-time (not App.tsx state) so it also covers the #847
      // scope-change reseed, which writes the RAW scopeBounds envelope.
      //
      // No count inflation: the lede / family-legend "in view" totals derive from
      // filterBucketsByBounds(buckets, viewportBounds) against the RAW map bounds
      // (App.tsx, frontend/src/lib/viewport-filter.ts) — the canonical superset's
      // extra buckets fall outside viewportBounds and are clipped before counting.
      const bboxParam = f.zoom !== undefined
        ? canonicalFetchBboxParam(f.bbox, f.zoom)
        : serializeBbox(f.bbox);
      url.searchParams.set('bbox', bboxParam);
    }
    if (f.zoom !== undefined) url.searchParams.set('zoom', String(f.zoom));
    // #735 — the data invariant: only send `?state=` when a state is scoped.
    // UNSCOPED and the explicit `?scope=us` escape hatch BOTH leave
    // `stateCode` unset, so the backend stays byte-for-byte untouched (no
    // `?state=` ⇒ unclipped national query, locked decision #4).
    if (f.stateCode) url.searchParams.set('state', f.stateCode);
    // Tolerate two shapes — (a) { data, meta } without `mode` (post-#456,
    // pre-#627) and (b) the discriminated union (#627) — normalizing both to the
    // discriminated union so callers can switch on `mode` unconditionally.
    //
    // The bare-Observation[] branch (pre-#456) was REMOVED in #830 (item B,
    // Remedy 1): the live read-api never returns a bare array, and that branch
    // was the only path that could yield non-empty `data` with a fabricated
    // `freshestObservationAt: null`. Keeping the normalization is still correct
    // defensive hygiene. (The licensing invariant that #830 tied to the freshness
    // label changed under #828: the always-visible eBird credit now lives in the
    // bottom-right .map-attribution corner, gated on map-visible rather than on a
    // freshness label, so the deleted deriveFreshness path no longer gates it.)
    type LegacyEnvelope = { data: Observation[]; meta: { freshestObservationAt: string | null } };
    const raw = await this.get<ObservationsResponse | LegacyEnvelope>(
      url.pathname + url.search,
    );
    if (!('mode' in raw)) {
      return { mode: 'observations', data: raw.data, meta: raw.meta };
    }
    return raw;
  }

  getSpecies(code: string): Promise<SpeciesMeta> {
    return this.get<SpeciesMeta>(`/api/species/${encodeURIComponent(code)}`);
  }

  // #859 — the long-lived `code → { comName, familyCode }` dictionary served
  // at GET /api/species (no trailing segment, distinct from the per-species
  // detail route above). The frontend fetches this once and joins it against
  // the species codes carried in aggregated buckets so low-zoom popovers can
  // render real common names without a per-click fetch. Immutable-cached
  // server-side (~9 KB gzip); the consuming hook caches it for the tab.
  getSpeciesDictionary(): Promise<SpeciesDictEntry[]> {
    return this.get<SpeciesDictEntry[]>('/api/species');
  }

  getSilhouettes(): Promise<FamilySilhouette[]> {
    return this.get<FamilySilhouette[]>('/api/silhouettes');
  }

  // #740 (C6) — the CONUS state name + envelope table backing the scope
  // chooser/control `<select>` and the state-scope camera `fitBounds`. One row
  // per `CONUS_STATE_CODES` entry, name-sorted server-side (#732/#748). The
  // payload is build-time-stable (seed-driven) and served with a 7d immutable
  // Cache-Control, so `useStates` caches it for the tab lifetime.
  getStates(): Promise<StateSummary[]> {
    return this.get<StateSummary[]>('/api/states');
  }

  private async get<T>(path: string): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const res = await fetch(url, { method: 'GET' });
    if (!res.ok) {
      throw new ApiError(res.status, await res.text());
    }
    return (await res.json()) as T;
  }
}
