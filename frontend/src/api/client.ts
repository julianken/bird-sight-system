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
    // Defensive: tolerate three legacy shapes during the rollout window —
    // (a) bare Observation[] (pre-#456), (b) { data, meta } without `mode`
    // (post-#456, pre-#627), and (c) the discriminated union (#627).
    // Normalize all three to the discriminated union so callers can switch
    // on `mode` unconditionally.
    type LegacyEnvelope = {
      data: Observation[];
      meta: { freshestObservationAt: string | null; truncated?: boolean; totalCount?: number };
    };
    const raw = await this.get<ObservationsResponse | LegacyEnvelope | Observation[]>(
      url.pathname + url.search,
    );
    if (Array.isArray(raw)) {
      return {
        mode: 'observations',
        data: raw,
        meta: { freshestObservationAt: null, truncated: false, totalCount: raw.length },
      };
    }
    if (!('mode' in raw)) {
      return {
        mode: 'observations',
        data: raw.data,
        meta: {
          freshestObservationAt: raw.meta.freshestObservationAt,
          // #647 — legacy envelopes (pre-#647) don't carry truncated/totalCount.
          // Default to "not truncated" with totalCount = data.length so the
          // banner stays hidden during the rollout window.
          truncated: raw.meta.truncated ?? false,
          totalCount: raw.meta.totalCount ?? raw.data.length,
        },
      };
    }
    return raw;
  }

  getSpecies(code: string): Promise<SpeciesMeta> {
    return this.get<SpeciesMeta>(`/api/species/${encodeURIComponent(code)}`);
  }

  getSilhouettes(): Promise<FamilySilhouette[]> {
    return this.get<FamilySilhouette[]>('/api/silhouettes');
  }

  /**
   * Per-species monthly observation counts for the phenology chart on
   * SpeciesDetailSurface. The endpoint returns a sparse array — months
   * with zero observations are omitted — so the consuming component is
   * responsible for zero-filling to all 12 months before rendering.
   * Throws `ApiError` on non-2xx (PhenologyChart catches and renders
   * `null` on error so the surrounding surface stays usable).
   */
  getPhenology(code: string): Promise<Array<{ month: number; count: number }>> {
    return this.get<Array<{ month: number; count: number }>>(
      `/api/species/${encodeURIComponent(code)}/phenology`
    );
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
