import { getJsonWithRetry } from './client.js';
import type { InatTaxon } from './types.js';

const INAT_BASE_URL = 'https://api.inaturalist.org/v1';

// Internal projection of the iNat /v1/taxa response we care about. The real
// payload includes ~30 fields per result (ancestors, default_photo, conservation
// status, observations_count, etc.) — we only need id and wikipedia_url to
// satisfy the consumer contract in `InatTaxon`. matched_term is captured to
// document the resolution path (subspecies / synonym) but not surfaced.
interface InatTaxaResult {
  id: number;
  name: string;
  rank: string;
  matched_term?: string;
  wikipedia_url: string | null;
}

interface InatTaxaResponse {
  total_results: number;
  page: number;
  per_page: number;
  results: InatTaxaResult[];
}

export interface FetchInatTaxonOptions {
  baseUrl?: string;
  /** Total attempts on transient failures (429 / 5xx). Default 1 retry => 2 total attempts. */
  maxRetries?: number;
  retryBaseMs?: number;
  requestTimeoutMs?: number;
}

/**
 * Resolves a binomial scientific name to an iNaturalist taxon record via the
 * `/v1/taxa` search endpoint.
 *
 * iNat's `rank=species` + `matched_term` resolves both trinomials (e.g.
 * *Setophaga coronata coronata*) and cross-genus synonyms (e.g. *Dendroica
 * coronata* → *Setophaga coronata*) in a single call — verified live against
 * `https://api.inaturalist.org/v1/taxa?q=...&rank=species&is_active=true`.
 * No client-side synonym retry loop is needed.
 *
 * Returns `null` when iNat reports zero hits — callers (child #371's
 * `run-descriptions.ts`) will treat null as "no iNat record; skip the
 * Wikipedia fallback path for this species".
 *
 * Retries once on transient failures (429, 5xx, network/timeout) via the
 * shared `getJsonWithRetry` helper. 4xx other than 429 throws immediately
 * (programmer error — retrying would only obscure the bug).
 *
 * Note: `wikipedia_summary` is intentionally NOT in this return shape — the
 * search endpoint does not populate it. Child #374 owns the per-id
 * (`/v1/taxa/{id}`) fetch path that surfaces the summary text.
 */
export async function fetchInatTaxon(
  sciName: string,
  opts: FetchInatTaxonOptions = {}
): Promise<InatTaxon | null> {
  const baseUrl = opts.baseUrl ?? INAT_BASE_URL;
  const maxRetries = opts.maxRetries ?? 1;
  const retryBaseMs = opts.retryBaseMs ?? 250;
  const requestTimeoutMs = opts.requestTimeoutMs ?? 30_000;

  const url = new URL(`${baseUrl}/taxa`);
  url.searchParams.set('q', sciName);
  url.searchParams.set('rank', 'species');
  url.searchParams.set('is_active', 'true');
  url.searchParams.set('per_page', '1');

  const body = await getJsonWithRetry<InatTaxaResponse>(
    url,
    maxRetries,
    retryBaseMs,
    requestTimeoutMs
  );

  const first = body.results[0];
  if (!first) return null;

  return {
    inatTaxonId: first.id,
    wikipediaUrl: first.wikipedia_url,
  };
}
