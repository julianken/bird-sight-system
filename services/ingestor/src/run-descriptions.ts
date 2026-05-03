import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  insertSpeciesDescription,
  type Pool,
} from '@bird-watch/db-client';
import { fetchInatTaxon, fetchInatTaxonSummary } from './inat/taxon-client.js';
import { fetchWikipediaSummary } from './wikipedia/client.js';
import { sanitizeText, sanitizeWikipediaExtract } from './wikipedia/sanitize.js';

const execFileAsync = promisify(execFile);

export interface RunDescriptionsArgs {
  pool: Pool;
  /**
   * Min millis between successive upstream calls. iNat / Wikipedia each
   * recommend ~1 rps — pacing keeps both round-trips comfortable. Tests
   * pass `paceMs: 0` to skip the wait.
   */
  paceMs?: number;
  /** Forwarded to fetchInatTaxon and fetchWikipediaSummary. Defaults to 1 (= 2 attempts total). */
  maxRetries?: number;
  retryBaseMs?: number;
}

export interface RunDescriptionsSummary {
  /**
   * Discriminator for the AnyRunSummary union in cli.ts. 'failure' iff every
   * species hit an error AND no description was written. Mixed runs
   * (some written, some failed, some skipped) are 'success' so Cloud Run
   * Jobs don't flag forward-progress runs as failed. Mirrors RunPhotosSummary.
   */
  status: 'success' | 'failure';
  /** Total rows iterated from species_meta (after the EXISTS filter). */
  speciesCount: number;
  /**
   * Successful end-to-end. Total of Wikipedia (source='wikipedia') AND
   * iNat-fallback (source='inat') writes. The iNat slice is broken out
   * separately as `descriptionsFromInat` for coverage telemetry.
   */
  descriptionsWritten: number;
  /**
   * No description written because (a) iNat search returned null, (b)
   * Wikipedia 404 AND iNat per-id summary also null, (c) Wikipedia 304
   * (matching ETag — the row already existed and is fresh), or (d) iNat
   * search returned a taxon with no Wikipedia URL.
   */
  descriptionsSkipped: number;
  /** Threw at any step (iNat error, Wikipedia error, sanitization, DB CHECK). */
  descriptionsFailed: number;
  /**
   * Subset of `descriptionsWritten` taken via the iNat-summary fallback path
   * (Wikipedia returned 404, iNat per-id returned a non-null `wikipedia_summary`,
   * sanitizeText accepted the body, row was written with `source='inat'`).
   * Coverage telemetry: `descriptionsFromInat / descriptionsWritten` is the
   * fraction of species that needed the fallback.
   */
  descriptionsFromInat: number;
  errors: Array<{ speciesCode: string; reason: string }>;
}

const DEFAULT_PACE_MS = 1_000;
const WIKIPEDIA_SOURCE = 'wikipedia' as const;
const INAT_SOURCE = 'inat' as const;
const WIKIPEDIA_LICENSE = 'CC-BY-SA-4.0' as const;

/**
 * Orchestrates the daily descriptions backfill: for each AZ-observed species,
 * resolve a Wikipedia title (via cached `species_meta.inat_taxon_id` or a
 * fresh iNat /v1/taxa lookup), fetch the REST summary with conditional GET
 * (using any prior `etag` from `species_descriptions`), sanitize the HTML
 * extract through DOMPurify, and persist via the upsert-on-conflict helper.
 *
 * Mirrors `run-photos.ts:55-162` shape: same paced loop, same EXISTS filter
 * to scope iteration to ~344 AZ-observed species, same per-species
 * try/catch isolation, same RunPhotosSummary discriminator. Per-species
 * failures (iNat 5xx, Wikipedia 5xx, sanitization out-of-bounds, DB CHECK
 * violation) are recorded in `errors[]` and never abort the run.
 */
export async function runDescriptions(
  args: RunDescriptionsArgs
): Promise<RunDescriptionsSummary> {
  const paceMs = args.paceMs ?? DEFAULT_PACE_MS;
  const fetchOpts: { maxRetries?: number; retryBaseMs?: number } = {};
  if (args.maxRetries !== undefined) fetchOpts.maxRetries = args.maxRetries;
  if (args.retryBaseMs !== undefined) fetchOpts.retryBaseMs = args.retryBaseMs;

  // One round-trip beats N queries: fetch species + cached inat_taxon_id +
  // any existing description's etag and attribution_url in a single LEFT
  // JOIN. The EXISTS filter narrows iteration to ~344 AZ-observed species —
  // the iNat client falls back through tiers (AZ → US → global) so a "skip
  // species without AZ observations" filter would mean we never describe an
  // AZ-rare bird; but taxonomy ingest persists ~24k species globally, and we
  // only care about describing ones users actually see in AZ.
  //
  // prior_attribution_url is the Wikipedia page URL we persisted on the
  // previous run. When BOTH inat_taxon_id and prior_attribution_url are
  // populated, the orchestrator short-circuits the iNat /v1/taxa lookup and
  // proceeds directly to a conditional Wikipedia GET — saving one round-trip
  // per species per cron tick. iNat is still called for first-fetch and for
  // species where iNat returned a different wikipediaUrl on the previous run
  // (the row exists but inat_taxon_id is null).
  const { rows } = await args.pool.query<{
    species_code: string;
    sci_name: string;
    inat_taxon_id: string | null;
    prior_etag: string | null;
    prior_attribution_url: string | null;
  }>(
    `SELECT sm.species_code, sm.sci_name, sm.inat_taxon_id,
            sd.etag            AS prior_etag,
            sd.attribution_url AS prior_attribution_url
       FROM species_meta sm
       LEFT JOIN species_descriptions sd
         ON sd.species_code = sm.species_code
      WHERE EXISTS (
        SELECT 1 FROM observations o
         WHERE o.species_code = sm.species_code
      )
      ORDER BY sm.species_code`
  );

  const summary: RunDescriptionsSummary = {
    status: 'success',
    speciesCount: rows.length,
    descriptionsWritten: 0,
    descriptionsSkipped: 0,
    descriptionsFailed: 0,
    descriptionsFromInat: 0,
    errors: [],
  };

  let firstCall = true;
  for (const row of rows) {
    const speciesCode = row.species_code;
    const sciName = row.sci_name;

    // Pace upstream calls. Skip the wait before the first call; otherwise a
    // run with N species sits idle for paceMs * N when paceMs * (N-1) suffices.
    if (!firstCall && paceMs > 0) {
      await sleep(paceMs);
    }
    firstCall = false;

    try {
      // 1. Resolve the Wikipedia URL. Two paths:
      //    (a) Cached: prior_attribution_url AND inat_taxon_id are both set.
      //        Reuse the cached URL — saves one round-trip per cron tick.
      //    (b) Fresh / partial-cache: call iNat /v1/taxa to resolve the
      //        binomial. Write the id back to species_meta for next time.
      //    The cached path is what makes the daily cron cheap on steady-state
      //    runs (most Wikipedia pages don't change day-to-day, so the
      //    follow-up conditional GET is also a fast 304).
      //
      // Track the resolved iNat taxon id alongside the Wikipedia URL so the
      // Wikipedia-404 fallback branch below can hit /v1/taxa/{id} without
      // re-resolving the binomial.
      let wikipediaUrl: string;
      let inatTaxonId: number | null = row.inat_taxon_id !== null
        ? Number(row.inat_taxon_id)
        : null;
      if (row.inat_taxon_id !== null && row.prior_attribution_url !== null) {
        wikipediaUrl = row.prior_attribution_url;
      } else {
        const taxon = await fetchInatTaxon(sciName, fetchOpts);
        if (taxon === null) {
          // iNat had no hit. That's normal for rare birds, recent splits, etc.
          // eslint-disable-next-line no-console
          console.log(
            `[run-descriptions] ${speciesCode} (${sciName}): iNat returned no taxon, skipping`
          );
          summary.descriptionsSkipped++;
          continue;
        }

        inatTaxonId = taxon.inatTaxonId;

        // Write back the iNat id so subsequent runs use it.
        if (row.inat_taxon_id === null) {
          await args.pool.query(
            `UPDATE species_meta SET inat_taxon_id = $1 WHERE species_code = $2`,
            [taxon.inatTaxonId, speciesCode]
          );
        }

        if (taxon.wikipediaUrl === null) {
          // iNat has the taxon but no Wikipedia cross-reference. Skip — the
          // iNat-fallback path requires a Wikipedia URL to attribute against
          // anyway (the per-id `wikipedia_summary` only exists when there's
          // a Wikipedia article; null cross-ref correlates with null summary).
          // eslint-disable-next-line no-console
          console.log(
            `[run-descriptions] ${speciesCode} (${sciName}): iNat taxon has no wikipedia_url, skipping`
          );
          summary.descriptionsSkipped++;
          continue;
        }
        wikipediaUrl = taxon.wikipediaUrl;
      }

      const wikipediaTitle = extractWikipediaTitle(wikipediaUrl);
      if (wikipediaTitle === null) {
        summary.descriptionsFailed++;
        summary.errors.push({
          speciesCode,
          reason: `Could not parse Wikipedia title from URL: ${wikipediaUrl}`,
        });
        continue;
      }

      // 2. Fetch the Wikipedia summary with conditional GET against any prior
      //    etag from species_descriptions. priorEtag is only set when we
      //    actually have one; otherwise we send no If-None-Match header (the
      //    helper's contract).
      const summaryFetchOpts: {
        maxRetries?: number;
        retryBaseMs?: number;
        priorEtag?: string;
      } = { ...fetchOpts };
      if (row.prior_etag !== null) summaryFetchOpts.priorEtag = row.prior_etag;
      const wiki = await fetchWikipediaSummary(wikipediaTitle, summaryFetchOpts);

      if (wiki === null) {
        // Wikipedia 404 — page deleted or renamed. Try the iNat-summary
        // fallback (added in #374): hit /v1/taxa/{id} for the cached id and
        // persist iNat's `wikipedia_summary` plaintext as a row with
        // source='inat'. This is the whole reason the per-id endpoint exists
        // in our pipeline — coverage on AZ-rare/vagrant species (Cave
        // Swallow, Glossy Ibis) where Wikipedia REST returns 404 but iNat
        // mirrors the article body.
        //
        // The fallback ONLY fires here (Wikipedia 404 branch) — never on the
        // 200 happy path (would be wasted bandwidth) and never on the 304
        // warm-cache path (already has a row).
        if (inatTaxonId === null) {
          // No cached id and the iNat search returned non-null taxon above
          // (otherwise we'd have continued earlier) — this branch is
          // unreachable in practice, but defend against a future refactor
          // that decouples the paths.
          // eslint-disable-next-line no-console
          console.log(
            `[run-descriptions] ${speciesCode} (${sciName}): Wikipedia 404 with no cached iNat id, skipping`
          );
          summary.descriptionsSkipped++;
          continue;
        }

        const inatSummary = await fetchInatTaxonSummary(inatTaxonId, fetchOpts);
        if (inatSummary === null || inatSummary.wikipediaSummary === null) {
          // Both upstreams empty — log and skip.
          // eslint-disable-next-line no-console
          console.log(
            `[run-descriptions] ${speciesCode} (${sciName}): Wikipedia 404 + iNat summary null, skipping`
          );
          summary.descriptionsSkipped++;
          continue;
        }

        // Sanitize the iNat plaintext (strip any tags as defense-in-depth,
        // trim, enforce 50..8192 length). SanitizationError surfaces in the
        // outer catch as a per-species failure.
        const sanitizedFallbackBody = sanitizeText(inatSummary.wikipediaSummary);

        await insertSpeciesDescription(args.pool, {
          speciesCode,
          source: INAT_SOURCE,
          body: sanitizedFallbackBody,
          // iNat's wikipedia_summary is extracted from the same Wikipedia
          // article, so the license is unchanged. The DB CHECK is unchanged
          // by #374 and still requires a CC-BY-SA variant.
          license: WIKIPEDIA_LICENSE,
          // No upstream Wikipedia revision/etag on the fallback path — those
          // belong to Wikipedia REST's conditional-GET semantics, not iNat's.
          revisionId: null,
          etag: null,
          // Prefer the cached Wikipedia URL when present so the frontend's
          // "Read more on Wikipedia" link still goes to the same article;
          // fall back to the iNat taxon page if the URL parser couldn't
          // produce one (defensive — wikipediaUrl is always set here by
          // construction).
          attributionUrl: wikipediaUrl,
        });
        summary.descriptionsWritten++;
        summary.descriptionsFromInat++;
        continue;
      }

      if (wiki.notModified) {
        // 304 — page hasn't changed since priorEtag. The existing row stays
        // as-is. This is the whole point of the conditional GET: skip
        // sanitize + DB write entirely on the unchanged-page common case.
        summary.descriptionsSkipped++;
        continue;
      }

      // 3. Sanitize. DOMPurify + length CHECK. SanitizationError is
      //    per-species — caught below.
      const sanitizedBody = sanitizeWikipediaExtract(wiki.extractHtml);

      // 4. Persist. The DB CHECK fires loudly if a future refactor produces
      //    an unexpected license code; that's the third line of defense
      //    after sanitize bounds + the upstream's hard-coded CC-BY-SA-4.0.
      const revisionId =
        wiki.revisionId && /^\d+$/.test(wiki.revisionId)
          ? Number(wiki.revisionId)
          : null;
      await insertSpeciesDescription(args.pool, {
        speciesCode,
        source: WIKIPEDIA_SOURCE,
        body: sanitizedBody,
        license: wiki.license,
        revisionId,
        etag: wiki.etag,
        attributionUrl: wikipediaUrl,
      });
      summary.descriptionsWritten++;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      // eslint-disable-next-line no-console
      console.error(
        `[run-descriptions] ${speciesCode} (${sciName}) failed: ${reason}`
      );
      summary.descriptionsFailed++;
      summary.errors.push({ speciesCode, reason });
      // continue — one species's failure must not abort the run
    }
  }

  if (summary.descriptionsFailed > 0 && summary.descriptionsWritten === 0) {
    summary.status = 'failure';
  }

  // Cache-purge fork: when descriptions actually landed AND the env opt-in is
  // set, shell out to scripts/purge-species-cache.sh to invalidate the
  // /api/species/* prefix at the Cloudflare edge. Default off in tests
  // (DESCRIPTIONS_PURGE_CACHE unset) so the integration tests don't try to
  // hit the live Cloudflare API. The script itself is shipped --dry-run-only
  // initially; flipping that gate is a follow-up.
  if (
    summary.descriptionsWritten > 0 &&
    process.env.DESCRIPTIONS_PURGE_CACHE === '1'
  ) {
    try {
      // The script lives at the repo root; resolve from the ingestor's
      // working dir. In Cloud Run the bundle ships only services/ingestor/dist
      // — the script must be COPYed into the image for this to work, which
      // is the next infra change after the initial ship. Until then, a
      // failed shell-out is logged and ignored.
      await execFileAsync('scripts/purge-species-cache.sh', ['--dry-run']);
      // eslint-disable-next-line no-console
      console.log('[run-descriptions] cache purge invoked');
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      // eslint-disable-next-line no-console
      console.warn(
        `[run-descriptions] cache purge failed (non-fatal): ${reason}`
      );
    }
  }

  return summary;
}

/**
 * Extracts the Wikipedia page title from a `https://*.wikipedia.org/wiki/<title>`
 * URL. iNat returns the URL un-decoded (e.g. `Anna%27s_hummingbird`); we pass
 * it through verbatim so the caller's `encodeURIComponent` doesn't double-encode.
 *
 * Returns null on a malformed URL — caller treats as a per-species failure.
 */
function extractWikipediaTitle(wikipediaUrl: string): string | null {
  try {
    const u = new URL(wikipediaUrl);
    // /wiki/<title> path segment.
    const match = u.pathname.match(/^\/wiki\/(.+)$/);
    if (!match) return null;
    // Decode percent-escapes in the title so the caller (fetchWikipediaSummary)
    // re-encodes via encodeURIComponent without double-escaping. iNat returns
    // titles like 'Anna%27s_hummingbird' — decoding to "Anna's_hummingbird"
    // and then re-encoding produces the canonical %27 round-trip.
    return decodeURIComponent(match[1]!);
  } catch {
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
