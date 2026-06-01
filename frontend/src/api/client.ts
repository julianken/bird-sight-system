import type {
  Hotspot, Observation, ObservationsResponse, SpeciesMeta, ObservationFilters,
  FamilySilhouette, StateSummary,
} from '@bird-watch/shared-types';

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
    if (f.bbox) url.searchParams.set('bbox', f.bbox.join(','));
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
    // `freshestObservationAt: null` — which would have broken the licensing
    // invariant "eBird credit visible ⟺ ≥1 observation marker rendered"
    // (deriveFreshness(null) → label '' → no eBird credit, despite markers).
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
