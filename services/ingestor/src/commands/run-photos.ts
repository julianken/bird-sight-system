import {
  insertSpeciesPhoto,
  type Pool,
} from '@bird-watch/db-client';
import { fetchInatPhoto } from '../inat/client.js';
import { fetchInatTaxon } from '../inat/taxon-client.js';
import { fetchWikipediaLeadImage } from '../wikipedia/lead-image.js';
import { uploadToR2 } from '../r2/uploader.js';

export interface RunPhotosArgs {
  pool: Pool;
  /** When true, re-photograph species that already have a detail-panel row. */
  forceRefresh?: boolean;
  /**
   * Min millis between successive iNat calls. iNat documents 100 req/min as
   * the soft cap (https://www.inaturalist.org/pages/api+recommended+practices)
   * — pacing at ~1 req/sec keeps us comfortably under that and avoids 429s.
   * Tests pass `paceMs: 0` to skip the wait.
   */
  paceMs?: number;
}

export interface RunPhotosSummary {
  /**
   * Discriminator for the AnyRunSummary union in cli.ts. 'failure' iff every
   * species hit an error (zero forward progress) — anything else (full success,
   * mixed success/failure, all-skipped, empty species list) is 'success'. cli.ts
   * uses this to set process.exitCode; Cloud Run Jobs see exitCode=1 only on
   * total-failure runs, not on partial-progress ones.
   */
  status: 'success' | 'failure';
  /** Total rows iterated from species_meta. */
  speciesCount: number;
  /** Successful end-to-end (iNat or Wikipedia hit + R2 uploaded + species_photos row written). */
  photosFetched: number;
  /**
   * Subset of `photosFetched` taken via the Wikipedia lead-image fallback (the
   * iNat AZ -> US -> global cascade returned null, then the Wikipedia path
   * returned a CC-licensed lead image). Coverage telemetry: the fraction of
   * the 23 #483-affected species that the second-tier source actually
   * rescues. `photosFromWikipedia / photosFetched` is the post-merge coverage
   * delta we report on the PR.
   */
  photosFromWikipedia: number;
  /** No photo written because (a) iNat AND Wikipedia both returned null OR (b) species already had a non-null photo and forceRefresh was false. */
  photosSkipped: number;
  /** Threw at any step (iNat error, R2 error, or DB error). */
  photosFailed: number;
  errors: Array<{ speciesCode: string; reason: string }>;
}

const DEFAULT_PACE_MS = 1_000;
const PURPOSE = 'detail-panel';

/**
 * Orchestrates the monthly photo backfill: for each row in `species_meta`
 * without a `detail-panel` photo (or every row, when forceRefresh is true),
 * fetch a CC-licensed iNaturalist photo, mirror it to R2, and write the
 * resulting public CDN URL to `species_photos`. Per-species failures are
 * caught, recorded in the returned summary, and never abort the run.
 *
 * Called from the scheduled handler (task-8a). The orchestrator pattern
 * matches run-ingest.ts and run-taxonomy.ts: a pure function that returns
 * a summary and writes side effects through injected dependencies.
 */
export async function runPhotos(args: RunPhotosArgs): Promise<RunPhotosSummary> {
  const paceMs = args.paceMs ?? DEFAULT_PACE_MS;
  const forceRefresh = args.forceRefresh ?? false;

  // Fetch species rows alongside any existing detail-panel photo URL via a
  // LEFT JOIN. One round-trip beats N queries for the per-row "do you
  // already have a photo?" check.
  //
  // The EXISTS filter narrows the iteration to species actually observed in
  // the ingest region. The taxonomy ingest writes the *full* eBird taxonomy
  // (~24k species) to species_meta, but only ~715 of those have rows in
  // `observations` under national (CONUS) ingest as of 2026-05 (was ~344 in
  // the AZ-only era pre-flip). Without the filter, every iteration of an
  // unobserved species would be a no-op iNat round-trip — the filter caps
  // wall-clock at the observed cohort.
  //
  // PR #679 (2026-05-20) set `INAT_PLACE_ID=''` on the Cloud Run Job, so the
  // iNat cascade in `inat/client.ts` now starts at Tier 2 (US) rather than
  // Tier 1 (region=AZ). Combined with the Wikipedia lead-image fallback
  // (#483), the post-backfill coverage is 708/715 = 99.0% — the 7 residuals
  // are all named hybrids that neither source tracks under the combined
  // binomial, and the family-silhouette fallback renders for them.
  //
  // Wall-clock budget: ~715 species × ~1.2s/species (US-tier hit + 1s pace +
  // R2 upload) ≈ 858s worst-case cold-cache. The Cloud Run Job timeout is
  // 900s (`infra/terraform/ingestor.tf`), bumped from 600s after the first
  // post-flip backfill timed out mid-cascade and relied on max_retries=1.
  //
  // `inat_taxon_id` is projected so the Wikipedia lead-image fallback (added
  // in #483) can re-use the cached taxon id when present — saving one iNat
  // /v1/taxa round-trip per fallback. When null, the fallback resolves the
  // binomial via fetchInatTaxon and writes the id back to species_meta as a
  // side effect, matching run-descriptions.ts:198's cache-warmth contract.
  const { rows } = await args.pool.query<{
    species_code: string;
    sci_name: string;
    inat_taxon_id: string | null;
    photo_url: string | null;
  }>(
    `SELECT sm.species_code, sm.sci_name, sm.inat_taxon_id,
            sp.url AS photo_url
       FROM species_meta sm
       LEFT JOIN species_photos sp
         ON sp.species_code = sm.species_code
        AND sp.purpose = $1
      WHERE EXISTS (
        SELECT 1 FROM observations o
         WHERE o.species_code = sm.species_code
      )
      ORDER BY sm.species_code`,
    [PURPOSE]
  );

  const summary: RunPhotosSummary = {
    status: 'success',
    speciesCount: rows.length,
    photosFetched: 0,
    photosFromWikipedia: 0,
    photosSkipped: 0,
    photosFailed: 0,
    errors: [],
  };

  let firstCall = true;
  for (const row of rows) {
    const speciesCode = row.species_code;
    const sciName = row.sci_name;

    // Skip species that already have a non-null detail-panel photo, unless
    // the caller asked us to refresh them.
    if (!forceRefresh && row.photo_url !== null) {
      summary.photosSkipped++;
      continue;
    }

    // Pace iNat calls. Skip the wait before the first call; otherwise a
    // run with N species sits idle for paceMs * N when paceMs * (N-1)
    // would do.
    if (!firstCall && paceMs > 0) {
      await sleep(paceMs);
    }
    firstCall = false;

    try {
      // Tier 1: iNaturalist cascade (AZ -> US -> global), per PR #350. This
      // is the historical happy path — ~91% of AZ-observed species land a
      // photo here. The remaining ~6% (warblers, vagrants, recent migrants)
      // fall through to the Wikipedia tier below.
      let photo: { url: string; attribution: string; license: string } | null =
        await fetchInatPhoto(sciName);
      let viaWikipedia = false;

      // Tier 2 (new in #483): Wikipedia lead image. Resolve the article via
      // iNat /v1/taxa (cached on species_meta.inat_taxon_id when warm), then
      // pull the lead image URL + license metadata from the summary +
      // imageinfo endpoints. Returns null when the article has no lead
      // image OR the image isn't on the CC / PD whitelist (fair-use,
      // ARR). The downstream family-silhouette fallback in
      // <SpeciesDetailSurface> picks up species the Wikipedia tier also
      // can't satisfy — there is intentionally no Tier 3 photo source.
      if (photo === null) {
        const wikiPhoto = await resolveWikipediaPhoto(
          args.pool,
          speciesCode,
          sciName,
          row.inat_taxon_id
        );
        if (wikiPhoto !== null) {
          photo = wikiPhoto;
          viaWikipedia = true;
        }
      }

      if (photo === null) {
        // Both upstreams empty. Normal outcome for ~2% residual species
        // (Wikipedia stubs, all-fair-use coverage). Log + skip; the
        // family-silhouette fallback at SpeciesDetailSurface.tsx:38-107
        // renders the placeholder.
        // eslint-disable-next-line no-console
        console.log(
          `[run-photos] ${speciesCode} (${sciName}): iNat + Wikipedia both returned no photo, skipping`
        );
        summary.photosSkipped++;
        continue;
      }

      // Derive the destKey from the speciesCode + the source file's
      // extension. Falls back to .jpg when the URL has no extension; the R2
      // uploader's content-type detection will still classify the bytes
      // correctly via the extension we choose.
      const destKey = buildDestKey(speciesCode, photo.url);
      const publicUrl = await uploadToR2(photo.url, destKey);

      await insertSpeciesPhoto(args.pool, {
        speciesCode,
        purpose: PURPOSE,
        url: publicUrl,
        attribution: photo.attribution,
        license: photo.license,
      });
      summary.photosFetched++;
      if (viaWikipedia) {
        summary.photosFromWikipedia++;
        // eslint-disable-next-line no-console
        console.log(
          `[run-photos] ${speciesCode} (${sciName}): rescued via Wikipedia lead image`
        );
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      // eslint-disable-next-line no-console
      console.error(
        `[run-photos] ${speciesCode} (${sciName}) failed: ${reason}`
      );
      summary.photosFailed++;
      summary.errors.push({ speciesCode, reason });
      // continue — one species's failure must not abort the run
    }
  }

  if (summary.photosFailed > 0 && summary.photosFetched === 0) {
    summary.status = 'failure';
  }
  return summary;
}

/**
 * Resolves the Wikipedia article for a species and returns its CC-licensed
 * lead image, or null when one isn't available. Two paths:
 *   - warm cache: `species_meta.inat_taxon_id` is populated, so we can
 *     fetch the article URL via iNat /v1/taxa without a fresh resolution.
 *     (We still pay the iNat round-trip because the search endpoint is
 *     where `wikipedia_url` lives — the per-id endpoint only exposes
 *     wikipedia_summary, which is plaintext, not a URL.)
 *   - cold cache: `inat_taxon_id` is null. Resolve via fetchInatTaxon and
 *     write the id back to species_meta as a side effect — matches
 *     run-descriptions.ts:198's cache-warmth pattern so subsequent runs
 *     short-circuit.
 *
 * Returns null whenever any step in the chain can't satisfy the lookup
 * (iNat had no taxon, taxon has no wikipedia_url, URL is malformed,
 * Wikipedia summary has no lead image, lead image isn't CC-licensed). The
 * orchestrator treats null as "skip — fall through to family silhouette".
 */
async function resolveWikipediaPhoto(
  pool: Pool,
  speciesCode: string,
  sciName: string,
  cachedTaxonId: string | null
): Promise<{ url: string; attribution: string; license: string } | null> {
  // Resolve the article URL via iNat /v1/taxa. We always go through the
  // search endpoint (not the per-id endpoint) because only the search
  // result surfaces `wikipedia_url`. The taxon-id cache pays off here only
  // as a "we know iNat has a record for this species" signal, not as a
  // round-trip saver. That's acceptable: the lead-image fallback runs at
  // most ~23 times per backfill (the issue #483 cohort) — total wall time
  // under 10s even at 1 req/sec.
  const taxon = await fetchInatTaxon(sciName);
  if (taxon === null) {
    // eslint-disable-next-line no-console
    console.log(
      `[run-photos] ${speciesCode} (${sciName}): iNat /v1/taxa returned no record, no Wikipedia fallback possible`
    );
    return null;
  }

  // Write the id back to species_meta on cold-cache hits so the descriptions
  // job (and any other downstream taxon-id consumer) doesn't have to
  // re-resolve. Mirrors run-descriptions.ts:198.
  if (cachedTaxonId === null) {
    await pool.query(
      `UPDATE species_meta SET inat_taxon_id = $1 WHERE species_code = $2`,
      [taxon.inatTaxonId, speciesCode]
    );
  }

  if (taxon.wikipediaUrl === null) {
    // eslint-disable-next-line no-console
    console.log(
      `[run-photos] ${speciesCode} (${sciName}): iNat taxon has no wikipedia_url, no Wikipedia fallback possible`
    );
    return null;
  }

  const title = extractWikipediaTitle(taxon.wikipediaUrl);
  if (title === null) {
    // eslint-disable-next-line no-console
    console.log(
      `[run-photos] ${speciesCode} (${sciName}): could not parse Wikipedia title from ${taxon.wikipediaUrl}`
    );
    return null;
  }

  const leadImage = await fetchWikipediaLeadImage(title);
  if (leadImage === null) {
    // eslint-disable-next-line no-console
    console.log(
      `[run-photos] ${speciesCode} (${sciName}): Wikipedia article "${title}" has no CC-licensed lead image`
    );
    return null;
  }
  return leadImage;
}

/**
 * Extracts the Wikipedia page title from a `https://*.wikipedia.org/wiki/<title>`
 * URL. iNat returns the URL un-decoded (e.g. `Anna%27s_hummingbird`); we
 * decode here so the lead-image client's `encodeURIComponent` produces the
 * canonical round-trip without double-escaping. Mirrors the helper in
 * run-descriptions.ts:418 — duplicated here rather than exported because
 * the two consumers diverge enough that a shared module would be premature
 * abstraction (descriptions parses cached prior_attribution_url URLs, photos
 * always parses iNat-fresh URLs).
 */
function extractWikipediaTitle(wikipediaUrl: string): string | null {
  try {
    const u = new URL(wikipediaUrl);
    const match = u.pathname.match(/^\/wiki\/(.+)$/);
    if (!match) return null;
    return decodeURIComponent(match[1]!);
  } catch {
    return null;
  }
}

const KNOWN_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp']);

/**
 * Build the R2 object key for a species photo. Format: `<speciesCode><ext>`,
 * with the extension drawn from the source URL when recognised, falling back
 * to `.jpg`. The detail-panel purpose is implicit in the storage layout —
 * task-8b can layer prefixes (e.g., `detail-panel/<code><ext>`) without
 * changing this function's contract if needed.
 */
function buildDestKey(speciesCode: string, sourceUrl: string): string {
  const pathOnly = sourceUrl.split('?')[0]?.split('#')[0] ?? sourceUrl;
  const dot = pathOnly.toLowerCase().lastIndexOf('.');
  if (dot < 0) return `${speciesCode}.jpg`;
  const ext = pathOnly.slice(dot).toLowerCase();
  if (!KNOWN_EXTS.has(ext)) return `${speciesCode}.jpg`;
  return `${speciesCode}${ext}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
