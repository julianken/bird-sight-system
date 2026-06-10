import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import type { CriteriaScores, QualityReport, DeterministicReport } from '@bird-watch/photo-quality';
import { composeReport, defaultRubricConfig } from '@bird-watch/photo-quality';
import type { InatCandidate, DenyContext } from '@bird-watch/ingestor';
import { fetchInatCandidates as realFetchInatCandidates } from '@bird-watch/ingestor';
import { sha8 } from './hash.js';
import {
  selectUnreviewed, updateCurrentPhotoHash, upsertScore, markReviewed,
  insertCandidate, maxSourceRound, getScoreByHash,
} from './store.js';
import { scoreBatch, mimeFromUrl, extFromMime } from './sources.js';
import {
  Pacer, withBackoff, clampPool, realClock,
  EDGE_PACE_MS, INAT_PACE_MS, CANDIDATE_POOL_CAP,
  type Clock,
} from './pacing.js';

// ─────────────────────────────────────────────────────────────────────────────
// Bug 1 (#992) — orchestrator-driven scoring, split into two runnable Node
// halves that the score-current Workflow drives:
//
//   score-prepare  → select reviewed=0, download each photo to disk, emit a
//                    manifest JSON the dispatched Read-agents consume.
//   <agents>       → each Reads an imagePath, applies the judge prompt, returns
//                    {criteria,flags,rationale}. (NOT here — the Workflow script.)
//   score-commit   → composeReport → upsertScore(role='current') +
//                    updateCurrentPhotoHash + markReviewed.
//
// Both halves are plain Node (no `agent()`), so they unit-test with a temp
// sqlite + a stubbed download. The agent dispatch lives ONLY in the .mjs
// Workflow script, which is unrunnable in plain Node and unrunnable in the
// Workflow sandbox if it touched the filesystem/DB — so the two concerns are
// kept in separate runtimes (the bug the old hybrid .mjs runner had).
// ─────────────────────────────────────────────────────────────────────────────

/** One row of the prepare manifest — the agent-facing scoring input. */
export interface ManifestEntry {
  speciesCode: string;
  comName: string;
  sciName: string;
  family: string;
  /** Local path to the downloaded photo the score-agent `Read`s. */
  imagePath: string;
  /** sha8 of the photo bytes — stamped into photo_current so commit can re-key. */
  contentHash: string;
}

export interface PrepareDeps {
  /** Injected so unit tests never hit the network. */
  download: (url: string) => Promise<Buffer>;
  /** Cache dir for downloaded thumbs + the manifest. */
  thumbDir: string;
  /**
   * Injected clock so unit tests assert download pacing WITHOUT a real wait.
   * Defaults to the real `setTimeout`-backed clock.
   */
  clock?: Clock;
  /**
   * Min ms between successive bird-maps.com edge downloads (Cloudflare limits
   * 60 req/min/IP). Defaults to EDGE_PACE_MS (1100). Tests may lower it, but the
   * spacing is still asserted via the injected clock, not wall-time.
   */
  paceMs?: number;
}

export interface PrepareResult {
  picked: number;
  /** How many were skipped because their current content-hash is already scored. */
  skipped: number;
  /** External edge downloads actually performed (for the batch usage log). */
  downloads: number;
  /** Absolute path to the manifest JSON the operator hands to the score agents. */
  manifestPath: string;
  manifest: ManifestEntry[];
}

/**
 * score-prepare: select the next `limit` reviewed=0 rows (clamp [1,100], shared
 * with scoreBatch), download each photo into `<thumbDir>/<code>.<ext>`, stamp
 * the real content hash into photo_current (so score-commit can re-key the
 * score row by hash WITHOUT clobbering the attribution/license sync stored),
 * and write a manifest JSON to `<thumbDir>/manifest.json`. Returns the manifest
 * + its path. Per-row download failures abort the prepare (a bad URL is an
 * operator-visible signal — unlike a single bad candidate in the deny loop).
 *
 * Conservative external-API usage (#992 addendum):
 *   • No-rework: BEFORE downloading, skip any row whose already-stamped current
 *     content_hash is already scored (getScoreByHash) — never re-download or
 *     re-score an unchanged image.
 *   • Edge pacing: downloads are SERIAL and paced ≥ EDGE_PACE_MS (1.1 s) apart
 *     because the bird-maps.com edge (Cloudflare) limits 60 req/min/IP. The
 *     pacing is injectable (`deps.clock`/`deps.paceMs`) so tests assert spacing
 *     deterministically without a real wait.
 *   • Transient (429/5xx) downloads get jittered exponential backoff with a
 *     bounded retry count.
 *   • The batch logs how many external downloads it made.
 */
export async function scorePrepare(
  db: Database.Database, limit: number, deps: PrepareDeps,
): Promise<PrepareResult> {
  const rows = selectUnreviewed(db, scoreBatch.clampLimit(limit));
  await mkdir(deps.thumbDir, { recursive: true });

  const clock = deps.clock ?? realClock;
  const pacer = new Pacer(deps.paceMs ?? EDGE_PACE_MS, clock);

  const manifest: ManifestEntry[] = [];
  let skipped = 0;
  let downloads = 0;
  for (const row of rows) {
    // No-rework: if this species already carries a stamped current content_hash
    // that is already scored, skip it — never re-download an unchanged image.
    if (row.contentHash && getScoreByHash(db, row.species_code, 'current', row.contentHash)) {
      skipped++;
      continue;
    }

    // Pace the edge download (serial, ≥1.1 s) — gate BEFORE the request.
    await pacer.gate();
    const bytes = await withBackoff(() => deps.download(row.url), { clock });
    downloads++;
    const mime = mimeFromUrl(row.url);
    const hash = sha8(bytes);
    const imagePath = join(deps.thumbDir, `${row.species_code}.${extFromMime(mime)}`);
    await writeFile(imagePath, bytes);
    // Record the real content_hash now (hash-only update — preserves the
    // attribution/license sync populated). score-commit keys the score row by it.
    updateCurrentPhotoHash(db, row.species_code, hash);
    manifest.push({
      speciesCode: row.species_code,
      comName: row.com_name,
      sciName: row.sci_name,
      family: row.family,
      imagePath,
      contentHash: hash,
    });
  }

  const manifestPath = join(deps.thumbDir, 'manifest.json');
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  // eslint-disable-next-line no-console
  console.log(`[score-prepare] external calls: ${downloads} edge download(s); skipped ${skipped} already-scored`);
  return { picked: manifest.length, skipped, downloads, manifestPath, manifest };
}

/** One agent scoring result — the score-commit input shape. */
export interface ScoreResult {
  speciesCode: string;
  criteria: CriteriaScores;
  flags: string[];
  rationale: string;
}

export interface CommitSummary {
  committed: number;
  failed: number;
  errors: Array<{ speciesCode: string; reason: string }>;
}

interface CurrentHashRow { content_hash: string | null }

/** A neutral deterministic report — the agent path skips the sharp decode gate. */
function neutralDeterministic(): DeterministicReport {
  return {
    width: 0, height: 0, megapixels: 0, sharpness: 0, exposure: 0, aspectRatio: 0,
    passedGate: true, failReasons: [],
  };
}

/**
 * score-commit: for each agent result, composeReport(criteria, flags,
 * defaultRubricConfig) → {overall, verdict}, build a QualityReport, and persist
 * it via upsertScore(role='current') keyed by the content_hash score-prepare
 * stamped into photo_current. Then markReviewed clears the species from the
 * backlog. A result whose species has no photo_current row (or no stamped hash —
 * never prepared) is recorded as a failure, not thrown, so one stray result
 * never aborts a batch commit.
 */
export async function scoreCommit(
  db: Database.Database, results: ScoreResult[],
): Promise<CommitSummary> {
  const summary: CommitSummary = { committed: 0, failed: 0, errors: [] };
  for (const r of results) {
    try {
      const row = db.prepare(
        `SELECT content_hash FROM photo_current WHERE species_code=?`,
      ).get(r.speciesCode) as CurrentHashRow | undefined;
      const hash = row?.content_hash;
      if (!hash) {
        throw new Error(`no prepared photo_current row (content_hash) for ${r.speciesCode} — run score-prepare first`);
      }

      const { overall, verdict } = composeReport(r.criteria, r.flags, defaultRubricConfig);
      const report: QualityReport = {
        overall, verdict,
        deterministic: neutralDeterministic(),
        criteria: r.criteria,
        flags: r.flags,
        rationale: r.rationale,
        rubricVersion: defaultRubricConfig.version,
      };
      upsertScore(db, {
        speciesCode: r.speciesCode, role: 'current', candidateInatId: null,
        contentHash: hash, report,
      });
      // re-stamp the (already-stamped) hash defensively + clear the backlog flag.
      updateCurrentPhotoHash(db, r.speciesCode, hash);
      markReviewed(db, r.speciesCode);
      summary.committed++;
    } catch (err) {
      summary.failed++;
      summary.errors.push({ speciesCode: r.speciesCode, reason: err instanceof Error ? err.message : String(err) });
    }
  }
  return summary;
}

// ─────────────────────────────────────────────────────────────────────────────
// source-candidates split (analogous to score-prepare / score-commit). The
// prepare half fetches a DEEP iNat pool per FLAGGED species (current overall <
// thresholds.review), downloads + inserts each candidate, and emits a manifest
// the parallel score agents Read; the commit half persists the agent scores as
// role='candidate' so Slice 5's deny route can advance to an already-scored
// alternate. Same no-`agent()`-in-Node discipline as the score halves.
// ─────────────────────────────────────────────────────────────────────────────

/** One row of the source-prepare manifest — one iNat candidate per entry. */
export interface SourceManifestEntry {
  speciesCode: string;
  comName: string;
  sciName: string;
  family: string;
  inatId: number;
  imagePath: string;
  contentHash: string;
  attribution: string;
  license: string;
}

export interface SourcePrepareDeps {
  fetchInatCandidates?: (
    sciName: string,
    opts: { limit: number; excludeIds?: number[]; denyContext?: DenyContext },
  ) => Promise<InatCandidate[]>;
  download: (url: string) => Promise<Buffer>;
  thumbDir: string;
  /** Injected clock so unit tests assert pacing WITHOUT a real wait. */
  clock?: Clock;
  /** Min ms between iNat species fetches (≤1 req/sec). Defaults to INAT_PACE_MS (1100). */
  inatPaceMs?: number;
  /** Min ms between bird-maps.com edge downloads. Defaults to EDGE_PACE_MS (1100). */
  edgePaceMs?: number;
}

export interface SourcePrepareResult {
  /** number of candidates sourced across all flagged species */
  picked: number;
  /** iNat species fetches actually performed (for the batch usage log). */
  inatFetches: number;
  /** External edge downloads actually performed (for the batch usage log). */
  downloads: number;
  manifestPath: string;
  manifest: SourceManifestEntry[];
}

interface FlaggedRow {
  species_code: string; com_name: string | null; sci_name: string | null; family: string | null;
}

/**
 * source-prepare: find every FLAGGED species (a scored current photo below the
 * rubric review threshold), fetch up to `pool` fresh iNat candidates for each,
 * download + write each thumb to `<thumbDir>/<code>-<inatId>.<ext>`, persist a
 * `photo_candidate` row (next source_round), and write a manifest the score
 * agents Read. NO judge call here — scoring is the agent + commit step.
 *
 * Conservative external-API usage (#992 addendum):
 *   • iNat is third-party: the per-species fetch is paced ≥ INAT_PACE_MS
 *     (1.1 s, ≤1 req/sec) and the pool is capped to CANDIDATE_POOL_CAP (~12) so
 *     it never fans out unbounded.
 *   • Each iNat fetch and each edge download gets jittered exponential backoff
 *     on 429/5xx; a species whose iNat fetch fails persistently is ABORTED
 *     (recorded + skipped), not the whole batch.
 *   • Edge downloads are serial + paced ≥ EDGE_PACE_MS (Cloudflare 60/min/IP).
 *   • Pacing is injectable (`deps.clock`/`deps.inatPaceMs`/`deps.edgePaceMs`)
 *     so tests assert spacing deterministically without a real wait.
 *   • The batch logs how many external calls (iNat fetches + downloads) it made.
 */
export async function sourcePrepare(
  db: Database.Database, pool: number, deps: SourcePrepareDeps,
): Promise<SourcePrepareResult> {
  const fetchInat = deps.fetchInatCandidates ?? realFetchInatCandidates;
  await mkdir(deps.thumbDir, { recursive: true });

  const clock = deps.clock ?? realClock;
  const inatPacer = new Pacer(deps.inatPaceMs ?? INAT_PACE_MS, clock);
  const edgePacer = new Pacer(deps.edgePaceMs ?? EDGE_PACE_MS, clock);
  const cappedPool = clampPool(pool);

  const flagged = db.prepare(
    `SELECT c.species_code, c.com_name, c.sci_name, c.family
       FROM photo_score s
       JOIN photo_current c ON c.species_code = s.species_code
      WHERE s.role = 'current' AND s.overall < ?
      ORDER BY s.overall ASC`,
  ).all(defaultRubricConfig.thresholds.review) as FlaggedRow[];

  const manifest: SourceManifestEntry[] = [];
  let inatFetches = 0;
  let downloads = 0;
  for (const sp of flagged) {
    if (!sp.sci_name) continue; // can't source without a scientific name
    const sciName = sp.sci_name;
    const round = maxSourceRound(db, sp.species_code) + 1;

    // iNat is third-party: pace ≤1 req/sec between species AND bound the pool.
    // A persistent iNat failure aborts THIS species, not the batch.
    await inatPacer.gate();
    let candidates: InatCandidate[];
    try {
      candidates = await withBackoff(
        () => fetchInat(sciName, { limit: cappedPool }), { clock },
      );
      inatFetches++;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[source-prepare] iNat fetch failed for ${sp.species_code} — skipping species: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }

    for (const cand of candidates.slice(0, cappedPool)) {
      await edgePacer.gate();
      const bytes = await withBackoff(() => deps.download(cand.photoUrl), { clock });
      downloads++;
      const mime = mimeFromUrl(cand.photoUrl);
      const hash = sha8(bytes);
      const imagePath = join(deps.thumbDir, `${sp.species_code}-${cand.inatId}.${extFromMime(mime)}`);
      await writeFile(imagePath, bytes);
      insertCandidate(db, {
        speciesCode: sp.species_code, inatId: cand.inatId, photoUrl: cand.photoUrl,
        thumbPath: imagePath, attribution: cand.attribution, license: cand.license,
        sourceRound: round,
      });
      manifest.push({
        speciesCode: sp.species_code,
        comName: sp.com_name ?? '',
        sciName,
        family: sp.family ?? '',
        inatId: cand.inatId,
        imagePath,
        contentHash: hash,
        attribution: cand.attribution,
        license: cand.license,
      });
    }
  }

  const manifestPath = join(deps.thumbDir, 'candidates-manifest.json');
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  // eslint-disable-next-line no-console
  console.log(`[source-prepare] external calls: ${inatFetches} iNat fetch(es) + ${downloads} edge download(s)`);
  return { picked: manifest.length, inatFetches, downloads, manifestPath, manifest };
}

/** One agent candidate-scoring result. Carries the inat id + content hash. */
export interface SourceResult {
  speciesCode: string;
  inatId: number;
  contentHash: string;
  criteria: CriteriaScores;
  flags: string[];
  rationale: string;
}

/**
 * source-commit: composeReport each agent candidate result and persist it as
 * role='candidate' keyed by (species_code, content_hash) with the inat id, so
 * the review server's deny route can advance to a scored alternate. A missing
 * content hash is recorded as a failure, not thrown.
 */
export async function sourceCommit(
  db: Database.Database, results: SourceResult[],
): Promise<CommitSummary> {
  const summary: CommitSummary = { committed: 0, failed: 0, errors: [] };
  for (const r of results) {
    try {
      if (!r.contentHash) {
        throw new Error(`missing contentHash for ${r.speciesCode} candidate ${r.inatId} — re-run source-prepare`);
      }
      const { overall, verdict } = composeReport(r.criteria, r.flags, defaultRubricConfig);
      const report: QualityReport = {
        overall, verdict,
        deterministic: neutralDeterministic(),
        criteria: r.criteria,
        flags: r.flags,
        rationale: r.rationale,
        rubricVersion: defaultRubricConfig.version,
      };
      upsertScore(db, {
        speciesCode: r.speciesCode, role: 'candidate', candidateInatId: r.inatId,
        contentHash: r.contentHash, report,
      });
      summary.committed++;
    } catch (err) {
      summary.failed++;
      summary.errors.push({ speciesCode: r.speciesCode, reason: err instanceof Error ? err.message : String(err) });
    }
  }
  return summary;
}
