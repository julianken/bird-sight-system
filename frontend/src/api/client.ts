import type {
  Hotspot, Observation, ObservationsResponse, SpeciesMeta, ObservationFilters,
  FamilySilhouette,
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
    // Defensive: tolerate three legacy shapes during the rollout window —
    // (a) bare Observation[] (pre-#456), (b) { data, meta } without `mode`
    // (post-#456, pre-#627), and (c) the discriminated union (#627).
    // Normalize all three to the discriminated union so callers can switch
    // on `mode` unconditionally.
    type LegacyEnvelope = { data: Observation[]; meta: { freshestObservationAt: string | null } };
    const raw = await this.get<ObservationsResponse | LegacyEnvelope | Observation[]>(
      url.pathname + url.search,
    );
    if (Array.isArray(raw)) {
      return { mode: 'observations', data: raw, meta: { freshestObservationAt: null } };
    }
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

  private async get<T>(path: string): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const res = await fetch(url, { method: 'GET' });
    if (!res.ok) {
      throw new ApiError(res.status, await res.text());
    }
    return (await res.json()) as T;
  }
}
