import type { EbirdObservation, EbirdHotspot, EbirdTaxon } from './types.js';

export interface EbirdClientOptions {
  apiKey: string;
  baseUrl?: string;
  maxRetries?: number;
  retryBaseMs?: number;
  requestTimeoutMs?: number;
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
  private readonly requestTimeoutMs: number;

  constructor(opts: EbirdClientOptions) {
    this.apiKey = opts.apiKey;
    this.baseUrl = opts.baseUrl ?? 'https://api.ebird.org/v2';
    this.maxRetries = opts.maxRetries ?? 3;
    this.retryBaseMs = opts.retryBaseMs ?? 250;
    this.requestTimeoutMs = opts.requestTimeoutMs ?? 30_000;
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

  /**
   * Fetches the full eBird taxonomy (~17k rows including issf/spuh/slash/form/
   * hybrid sub-categories). The `cat=species` parameter is an eBird server-side
   * hint but does not actually restrict the response — callers MUST still filter
   * to `category === 'species'` before writing to species_meta.
   */
  async fetchTaxonomy(): Promise<EbirdTaxon[]> {
    const url = new URL(`${this.baseUrl}/ref/taxonomy/ebird`);
    url.searchParams.set('cat', 'species');
    url.searchParams.set('fmt', 'json');
    url.searchParams.set('locale', 'en');
    url.searchParams.set('version', 'latest');
    return this.getJson<EbirdTaxon[]>(url);
  }

  private async getJson<T>(url: URL): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const res = await fetch(url, {
          headers: { 'x-ebirdapitoken': this.apiKey, accept: 'application/json' },
          signal: AbortSignal.timeout(this.requestTimeoutMs),
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
        // Full-jitter exponential backoff (AWS write-up variant).
        // Timeouts (AbortError) are treated as transient — same retry path as 5xx.
        const backoff = this.retryBaseMs * Math.pow(2, attempt);
        const withJitter = Math.floor(Math.random() * backoff);
        await sleep(withJitter);
      }
    }
    // If the final error is a timeout, surface a clear EbirdServerError.
    if (isAbortError(lastError)) {
      throw new EbirdServerError(0, `Request timed out after ${this.requestTimeoutMs}ms`);
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
/** True for both manual AbortController aborts and AbortSignal.timeout() expirations. */
function isAbortError(err: unknown): boolean {
  return err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError');
}
