import { getJsonWithRetry } from './client.js';
import type { InatTaxon, InatTaxonSummary } from './types.js';

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

// Per-id projection. Unlike the search endpoint, `/v1/taxa/{id}` returns
// `wikipedia_summary` (plaintext extracted from the article). We only need
// the summary here — the run-descriptions orchestrator already has the id
// and wikipedia_url cached from the search-endpoint pass.
interface InatTaxaByIdResult {
  id: number;
  name: string;
  rank: string;
  wikipedia_summary: string | null;
  wikipedia_url?: string | null;
}

interface InatTaxaByIdResponse {
  total_results: number;
  page: number;
  per_page: number;
  results: InatTaxaByIdResult[];
}

/**
 * Fetches a single taxon record by id from iNaturalist's `/v1/taxa/{id}`
 * endpoint and returns just the `wikipedia_summary` plaintext field.
 *
 * The search endpoint (`/v1/taxa?q=...`, used by `fetchInatTaxon`) does NOT
 * surface `wikipedia_summary` — only the per-id endpoint does. Confirmed
 * empirically against iNat's live API; documented at the comment in
 * `fetchInatTaxon` above.
 *
 * Used exclusively by `run-descriptions.ts`'s Wikipedia-404 fallback branch:
 * when Wikipedia REST returns null (page deleted/renamed) AND the species
 * has a cached `inat_taxon_id`, the orchestrator calls this helper and
 * persists the returned summary as a `species_descriptions` row with
 * `source = 'inat'`. NEVER on the cold-cache happy path (would be wasted
 * bandwidth — the search endpoint already returned `wikipedia_url` and we'd
 * rather hit Wikipedia REST directly), NEVER on the warm-cache 304 path
 * (already has a description).
 *
 * Returns:
 * - `{ wikipediaSummary: string }` when iNat has a non-null summary.
 * - `{ wikipediaSummary: null }` when the taxon record exists but the
 *   summary is null (no Wikipedia cross-reference). Caller skips.
 * - `null` when iNat reports zero hits for the id (soft-deleted / merged
 *   taxon — rare). Caller skips.
 *
 * Retries once on transient failures (429, 5xx, network/timeout) via the
 * shared `getJsonWithRetry` helper, same as `fetchInatTaxon` and the photo
 * client. 4xx other than 429 throws immediately (programmer error).
 */
export async function fetchInatTaxonSummary(
  taxonId: number,
  opts: FetchInatTaxonOptions = {}
): Promise<InatTaxonSummary | null> {
  const baseUrl = opts.baseUrl ?? INAT_BASE_URL;
  const maxRetries = opts.maxRetries ?? 1;
  const retryBaseMs = opts.retryBaseMs ?? 250;
  const requestTimeoutMs = opts.requestTimeoutMs ?? 30_000;

  const url = new URL(`${baseUrl}/taxa/${taxonId}`);

  const body = await getJsonWithRetry<InatTaxaByIdResponse>(
    url,
    maxRetries,
    retryBaseMs,
    requestTimeoutMs
  );

  const first = body.results[0];
  if (!first) return null;

  return { wikipediaSummary: first.wikipedia_summary };
}
