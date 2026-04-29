import {
  insertSpeciesPhoto,
  type Pool,
} from '@bird-watch/db-client';
import { fetchInatPhoto } from './inat/client.js';
import { uploadToR2 } from './r2/uploader.js';

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
  /** Total rows iterated from species_meta. */
  speciesCount: number;
  /** Successful end-to-end (iNat hit + R2 uploaded + species_photos row written). */
  photosFetched: number;
  /** No photo written because (a) iNat returned null OR (b) species already had a non-null photo and forceRefresh was false. */
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

  // Fetch all species rows alongside any existing detail-panel photo URL via
  // a LEFT JOIN. One round-trip beats N queries for the per-row "do you
  // already have a photo?" check; the species_meta count is in the low
  // hundreds today, so the join cost is negligible.
  const { rows } = await args.pool.query<{
    species_code: string;
    sci_name: string;
    photo_url: string | null;
  }>(
    `SELECT sm.species_code, sm.sci_name, sp.url AS photo_url
       FROM species_meta sm
       LEFT JOIN species_photos sp
         ON sp.species_code = sm.species_code
        AND sp.purpose = $1
      ORDER BY sm.species_code`,
    [PURPOSE]
  );

  const summary: RunPhotosSummary = {
    speciesCount: rows.length,
    photosFetched: 0,
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
      const photo = await fetchInatPhoto(sciName);
      if (photo === null) {
        // iNat had no hit for this species. That's a normal outcome (rare
        // birds, recent splits, etc.) — log via the summary and move on.
        // eslint-disable-next-line no-console
        console.log(
          `[run-photos] ${speciesCode} (${sciName}): iNat returned no photo, skipping`
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

  return summary;
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
