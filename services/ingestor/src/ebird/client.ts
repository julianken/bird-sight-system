import type { EbirdObservation, EbirdHotspot } from './types.js';

export interface EbirdClientOptions {
  apiKey: string;
  baseUrl?: string;
  maxRetries?: number;
  retryBaseMs?: number;
}

export interface FetchRecentOptions {
  back?: number;       // 1–30 days; default 14
  maxResults?: number; // default 10000
}

export class EbirdClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly maxRetries: number;
  private readonly retryBaseMs: number;

  constructor(opts: EbirdClientOptions) {
    this.apiKey = opts.apiKey;
    this.baseUrl = opts.baseUrl ?? 'https://api.ebird.org/v2';
    this.maxRetries = opts.maxRetries ?? 3;
    this.retryBaseMs = opts.retryBaseMs ?? 250;
  }

  async fetchRecent(
    regionCode: string,
    o: FetchRecentOptions = {}
  ): Promise<EbirdObservation[]> {
    const url = new URL(`${this.baseUrl}/data/obs/${regionCode}/recent`);
    url.searchParams.set('back', String(o.back ?? 14));
    url.searchParams.set('maxResults', String(o.maxResults ?? 10_000));
    return this.getJson<EbirdObservation[]>(url);
  }

  async fetchNotable(
    regionCode: string,
    o: FetchRecentOptions = {}
  ): Promise<EbirdObservation[]> {
    const url = new URL(`${this.baseUrl}/data/obs/${regionCode}/recent/notable`);
    url.searchParams.set('back', String(o.back ?? 14));
    url.searchParams.set('detail', 'simple');
    return this.getJson<EbirdObservation[]>(url);
  }

  async fetchHotspots(regionCode: string): Promise<EbirdHotspot[]> {
    const url = new URL(`${this.baseUrl}/ref/hotspot/${regionCode}`);
    url.searchParams.set('fmt', 'json');
    return this.getJson<EbirdHotspot[]>(url);
  }

  async fetchHistoric(
    regionCode: string,
    y: number, m: number, d: number
  ): Promise<EbirdObservation[]> {
    const url = new URL(
      `${this.baseUrl}/data/obs/${regionCode}/historic/${y}/${m}/${d}`
    );
    url.searchParams.set('maxResults', '10000');
    return this.getJson<EbirdObservation[]>(url);
  }

  private async getJson<T>(url: URL): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const res = await fetch(url, {
          headers: { 'x-ebirdapitoken': this.apiKey, accept: 'application/json' },
        });
        if (res.status >= 500) {
          throw new EbirdServerError(res.status, await res.text());
        }
        if (!res.ok) {
          const body = await res.text();
          throw new EbirdClientError(res.status, body);
        }
        return (await res.json()) as T;
      } catch (err) {
        lastError = err;
        if (err instanceof EbirdClientError) throw err; // 4xx — don't retry
        if (attempt === this.maxRetries) break;
        const delay = this.retryBaseMs * 2 ** attempt;
        await sleep(delay);
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }
}

export class EbirdClientError extends Error {
  constructor(public status: number, public body: string) {
    super(`eBird client error ${status}: ${body}`);
    this.name = 'EbirdClientError';
  }
}
export class EbirdServerError extends Error {
  constructor(public status: number, public body: string) {
    super(`eBird server error ${status}: ${body}`);
    this.name = 'EbirdServerError';
  }
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }
