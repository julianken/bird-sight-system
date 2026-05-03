import type {
  Hotspot, Observation, SpeciesMeta, ObservationFilters,
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

  getObservations(f: ObservationFilters = {}): Promise<Observation[]> {
    const url = new URL('/api/observations', 'http://x');
    if (f.since) url.searchParams.set('since', f.since);
    if (f.notable === true) url.searchParams.set('notable', 'true');
    if (f.speciesCode) url.searchParams.set('species', f.speciesCode);
    if (f.familyCode) url.searchParams.set('family', f.familyCode);
    return this.get<Observation[]>(url.pathname + url.search);
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
