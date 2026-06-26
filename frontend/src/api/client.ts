import type {
  Hotspot, Observation, ObservationsResponse, SpeciesMeta, ObservationFilters,
  FamilySilhouette, StateSummary, SpeciesDictEntry,
} from '@bird-watch/shared-types';
import { canonicalFetchBboxParam, perObsFetchBboxParam, serializeBbox, snapFetchBboxParam } from '@bird-watch/geo';

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

  // #874 — in-flight /api/observations dedup + cancellation. Rapid scope/pan
  // changes (CA→NV→TX) fire several observations fetches in quick succession;
  // without this a superseded fetch keeps running (wasted origin work, and the
  // late one can resolve AFTER an earlier one and race the rendered state), and
  // a byte-identical concurrent request issues a redundant second network call.
  //
  //  - `observationsInFlight` tracks the CURRENTLY-live observations request:
  //    its full request key, its AbortController (so a superseding fetch can
  //    cancel it), and the shared promise (so a concurrent byte-identical key
  //    coalesces onto it instead of hitting the network again).
  //
  // Scoped to /api/observations ONLY — other endpoints (hotspots, states,
  // species, silhouettes) are immutable/idempotent and never superseded, so
  // they keep the plain `get<T>` path with no signal.
  private observationsInFlight:
    | { key: string; controller: AbortController; promise: Promise<ObservationsResponse> }
    | null = null;

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
      //
      // #873 — STATE-SCOPE FIXED ENVELOPE (aggregated path only). When a state is
      // scoped AND we know its fixed envelope (`stateBbox` from /api/states) AND
      // we're in aggregated mode (`zoom < 6`), send the state's FIXED envelope
      // (snapped outward to the cache grid) instead of the center-varying
      // canonical viewport box. Every viewport/pan of a state then collapses to
      // ONE Cloudflare key per (state, zoom, filters) → CF HIT after the first
      // load (and warmable), and the origin query becomes state-tight (killing
      // the 12-14s CONUS scan-then-clip). Render is unchanged: the server already
      // clips the result to the state polygon via ST_Intersects (response is
      // viewport-independent), and the frontend clips display to the viewport via
      // filterBucketsByBounds. STRICTLY zoom < 6 — at zoom >= 6 the per-obs path
      // applies a 10k-row truncation brake (observations.ts:241) that relies on
      // the viewport bbox narrowing a dense state; substituting the whole-state
      // envelope there would flip `truncated:true` and change what renders. So we
      // mirror #868/#869 and touch only the aggregated branch.
      const useStateEnvelope =
        f.stateCode !== undefined && f.stateBbox !== undefined &&
        f.zoom !== undefined && f.zoom < 6;
      // #1292 — at zoom >= 6 (per-observation mode) the viewport bbox was
      // serialized via `canonicalFetchBboxParam`, which is a PASSTHROUGH at
      // z>=6 → plain `serializeBbox` → `.toFixed(2)`. Once the viewport span
      // drops below ~0.01° (≈ z17) that flattens W to equal E (and S to equal
      // N) → a degenerate ZERO-AREA bbox → the server returns 0 rows → all
      // markers vanish ("No recent sightings"). `perObsFetchBboxParam` snaps
      // the edges OUTWARD to a fine 0.0025° grid and serializes at `.toFixed(4)`
      // so the box can never degenerate at any zoom, stays a tight superset of
      // the viewport (MapLibre still clips the off-screen margin — no visible
      // change, no under-fetch), collapses nearby pans to one cache key, and
      // stays trivially under the validate.ts 45×25 area cap. zoom < 6 keeps the
      // aggregated `.toFixed(2)` paths EXACTLY as-is (cache-warmer key match).
      const bboxParam = useStateEnvelope
        ? snapFetchBboxParam(f.stateBbox!, f.zoom!)
        : f.zoom !== undefined
          ? f.zoom >= 6
            ? perObsFetchBboxParam(f.bbox)
            : canonicalFetchBboxParam(f.bbox, f.zoom)
          : serializeBbox(f.bbox);
      url.searchParams.set('bbox', bboxParam);
    }
    if (f.zoom !== undefined) url.searchParams.set('zoom', String(f.zoom));
    // #735 — the data invariant: only send `?state=` when a state is scoped.
    // UNSCOPED and the explicit `?scope=us` escape hatch BOTH leave
    // `stateCode` unset, so the backend stays byte-for-byte untouched (no
    // `?state=` ⇒ unclipped national query, locked decision #4).
    if (f.stateCode) url.searchParams.set('state', f.stateCode);

    const key = url.pathname + url.search;

    // #874 — coalesce a concurrent byte-identical request onto the in-flight
    // promise (no second network call). The key is the full path+search, so two
    // invocations with identical filters share one fetch; a different key falls
    // through to supersede-cancel below.
    if (this.observationsInFlight && this.observationsInFlight.key === key) {
      return this.observationsInFlight.promise;
    }

    // #874 — supersede-cancel: a NEW, distinct observations request aborts the
    // prior in-flight one (rapid scope/pan change). The aborted promise rejects
    // with a DOMException `AbortError`; callers (use-bird-data.ts) ignore that
    // name so a deliberately-cancelled fetch never surfaces as a UI error.
    this.observationsInFlight?.controller.abort();

    const controller = new AbortController();
    const promise = this.fetchObservations(key, controller.signal)
      .finally(() => {
        // Clear the slot only if it still points at THIS request — a later
        // supersede may have already replaced it.
        if (this.observationsInFlight?.controller === controller) {
          this.observationsInFlight = null;
        }
      });
    this.observationsInFlight = { key, controller, promise };
    return promise;
  }

  /**
   * #874 — the single network leg for /api/observations, isolated so the dedup
   * bookkeeping in `getObservations` stays readable. Passes the abort `signal`
   * to `fetch` and normalizes the (legacy | discriminated) envelope.
   *
   * Tolerates two shapes — (a) `{ data, meta }` without `mode` (post-#456,
   * pre-#627) and (b) the discriminated union (#627) — normalizing both to the
   * discriminated union so callers can switch on `mode` unconditionally.
   *
   * The bare-Observation[] branch (pre-#456) was REMOVED in #830 (item B,
   * Remedy 1): the live read-api never returns a bare array, and that branch
   * was the only path that could yield non-empty `data` with a fabricated
   * `freshestObservationAt: null`. Keeping the normalization is still correct
   * defensive hygiene.
   */
  private async fetchObservations(
    path: string,
    signal: AbortSignal,
  ): Promise<ObservationsResponse> {
    type LegacyEnvelope = { data: Observation[]; meta: { freshestObservationAt: string | null } };
    const raw = await this.get<ObservationsResponse | LegacyEnvelope>(path, signal);
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

  // The distinct species REPRESENTED in the current scope — the source for the
  // FiltersBar Species combobox (replaces the full ~17.8k global dictionary as
  // the candidate list). Sends ONLY the non-species, non-viewport filters:
  // `species`/`bbox`/`zoom` are deliberately NOT forwarded even if present on
  // the filter object, so the combobox keeps offering every sibling species
  // while one is active (no self-narrowing) and stays the same complete list at
  // any zoom. Same `{code,comName,familyCode}` shape as the dictionary; plain
  // idempotent GET (CDN/browser-cached — no in-flight dedup needed).
  getSpeciesInScope(
    f: Pick<ObservationFilters, 'since' | 'notable' | 'familyCode' | 'stateCode'> = {},
  ): Promise<SpeciesDictEntry[]> {
    const url = new URL('/api/species-in-scope', 'http://x');
    if (f.since) url.searchParams.set('since', f.since);
    if (f.notable === true) url.searchParams.set('notable', 'true');
    if (f.familyCode) url.searchParams.set('family', f.familyCode);
    if (f.stateCode) url.searchParams.set('state', f.stateCode);
    return this.get<SpeciesDictEntry[]>(url.pathname + url.search);
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

  private async get<T>(path: string, signal?: AbortSignal): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    // `RequestInit.signal` is `AbortSignal | null`; only attach the property
    // when a signal exists (exactOptionalPropertyTypes forbids `signal: undefined`).
    const init: RequestInit = signal ? { method: 'GET', signal } : { method: 'GET' };
    const res = await fetch(url, init);
    if (!res.ok) {
      throw new ApiError(res.status, await res.text());
    }
    return (await res.json()) as T;
  }
}
