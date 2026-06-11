import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import type {
  CriteriaScores, QualityReport, DeterministicReport, ImageInput, RubricConfig,
} from '@bird-watch/photo-quality';
import {
  composeReport, defaultRubricConfig,
  assessDeterministic as realAssessDeterministic,
} from '@bird-watch/photo-quality';
import type { InatCandidate, DenyContext } from '@bird-watch/ingestor';
import { fetchInatCandidates as realFetchInatCandidates } from '@bird-watch/ingestor';
import { sha8 } from './hash.js';
import {
  selectUnreviewed, updateCurrentPhotoHash, upsertScore, markReviewed,
  insertCandidate, maxSourceRound, getScoreByHash,
  recordSourceAttempt, setSourceAttemptOutcome,
} from './store.js';
import { selectSwaps } from './swaps.js';
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
  /**
   * The FREE deterministic gate (#994). Run on each downloaded image BEFORE it
   * reaches the (paid) judge: a tiny/blurry/wrong-aspect image gate-fails and is
   * auto-rejected here, never entering the manifest the judge agents read.
   * Injected so unit tests can drive the gate-fail/gate-pass branches without a
   * real sharp decode. Defaults to the package's real `assessDeterministic`.
   */
  assessDeterministic?: (
    img: ImageInput, det: RubricConfig['deterministic'],
  ) => Promise<DeterministicReport>;
}

export interface PrepareResult {
  picked: number;
  /** How many were skipped because their current content-hash is already scored. */
  skipped: number;
  /**
   * How many were auto-rejected by the deterministic gate (#994) — a reject
   * report was persisted (role='current') + the species marked reviewed, and the
   * image was EXCLUDED from the manifest so it never reaches a (paid) judge.
   */
  gateRejected: number;
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
  const assessDet = deps.assessDeterministic ?? realAssessDeterministic;

  const manifest: ManifestEntry[] = [];
  let skipped = 0;
  let gateRejected = 0;
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

    // FREE deterministic pre-filter (#994): the bytes are already on disk, so run
    // the same gate scoreImage runs (assessDeterministic). A gate-FAILING image
    // (tiny/blurry/wrong-aspect) is auto-rejected HERE — a reject report is
    // persisted the same way score-commit writes (upsertScore role='current' +
    // markReviewed) — and is EXCLUDED from the manifest, so it never reaches a
    // (paid) judge. A gate-PASSING image continues to the manifest as before.
    const deterministic = await assessDet({ buffer: bytes, mime }, defaultRubricConfig.deterministic);
    if (!deterministic.passedGate) {
      const report = gateRejectReport(deterministic);
      upsertScore(db, {
        speciesCode: row.species_code, role: 'current', candidateInatId: null,
        contentHash: hash, report,
      });
      markReviewed(db, row.species_code);
      gateRejected++;
      continue;
    }

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
  console.log(`[score-prepare] external calls: ${downloads} edge download(s); judged ${manifest.length} / gate-rejected ${gateRejected} / already-scored skipped ${skipped}`);
  return { picked: manifest.length, skipped, gateRejected, downloads, manifestPath, manifest };
}

/**
 * One agent scoring result — the score-commit input shape. The Opus field-mark
 * judge (#969) returns the diagnostic `fieldMarks`, its DIRECT `keep` (the gate),
 * and its own `qualityScore` alongside the criteria/flags/rationale.
 */
export interface ScoreResult {
  speciesCode: string;
  fieldMarks: string[];
  criteria: CriteriaScores;
  flags: string[];
  keep: boolean;
  qualityScore: number;
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

const ZERO_CRITERIA: CriteriaScores = {
  framing: 0, subjectClarity: 0, liveness: 0, naturalness: 0,
  pose: 0, background: 0, lighting: 0,
};

/**
 * The deterministic-gate auto-reject report (#994), mirroring the gate-fail
 * short-circuit in @bird-watch/photo-quality's scoreImage: zeroed criteria, no
 * judge flags, overall 0 / verdict 'reject', and a rationale that names the
 * failed gate reasons. score-prepare persists this for a gate-failing image so
 * the image is rejected WITHOUT a (paid) judge call.
 */
function gateRejectReport(deterministic: DeterministicReport): QualityReport {
  return {
    overall: 0,
    verdict: 'reject',
    deterministic,
    criteria: { ...ZERO_CRITERIA },
    flags: [],
    // #994 pre-filter reject: junk image, never judged. keep:false is the gate.
    fieldMarks: [],
    keep: false,
    qualityScore: 0,
    rationale: `deterministic gate failed: ${deterministic.failReasons.join(', ')}`,
    rubricVersion: defaultRubricConfig.version,
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

      // overall/verdict rank for the review UI; the GATE is the judge's `keep`.
      const { overall, verdict } = composeReport(r.criteria, r.flags, defaultRubricConfig, {
        keep: r.keep, qualityScore: r.qualityScore,
      });
      const report: QualityReport = {
        overall, verdict,
        deterministic: neutralDeterministic(),
        criteria: r.criteria,
        flags: r.flags,
        fieldMarks: r.fieldMarks,
        keep: r.keep,
        qualityScore: r.qualityScore,
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
// prepare half fetches a DEEP iNat pool per species the gate flagged for
// replacement (current photo_score.keep = 0), downloads + inserts each
// candidate, and emits a manifest the parallel score agents Read; the commit
// half persists the agent scores as role='candidate' so Slice 5's deny route
// can advance to an already-scored alternate. Same no-`agent()`-in-Node
// discipline as the score halves.
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
  /**
   * How many candidates were SKIPPED because their downloaded bytes hash to the
   * species' CURRENT live photo content_hash (same-picture dedup, swap-review
   * v2 §2). A skipped dup is never inserted and never enters the manifest, so
   * the (paid) judge never scores a photo we already have.
   */
  skippedDuplicates: number;
  manifestPath: string;
  manifest: SourceManifestEntry[];
}

interface FlaggedRow {
  species_code: string; com_name: string | null; sci_name: string | null; family: string | null;
  /** The species' CURRENT live photo content hash — same-picture dups match it. */
  content_hash: string | null;
}

/**
 * source-prepare: find every species the gate flagged for replacement (a scored
 * current photo with `keep = 0` — the SAME "needs replacement" predicate the
 * review server's `needs-swap` filter uses, NOT the advisory `overall <
 * review` composite), fetch up to `pool` fresh iNat candidates for each,
 * download + write each thumb to `<thumbDir>/<code>-<inatId>.<ext>`, persist a
 * `photo_candidate` row (next source_round), and write a manifest the score
 * agents Read. NO judge call here — scoring is the agent + commit step.
 *
 * Why `keep = 0`, not `overall < review` (#969 / PR #1004): the gate is the
 * judge's direct keep/replace boolean, and the review UI surfaces exactly the
 * `keep = 0` set as `needs-swap`. Sourcing MUST key on the same predicate or it
 * is incoherent — a technically-sharp photo with hidden field marks (HIGH
 * composite but `keep = 0`) appears in the reviewer's needs-swap queue yet, on
 * the old composite predicate, would never get replacement candidates sourced,
 * leaving an empty candidate pool. `keep = 1` is never re-sourced (we're keeping
 * it); a legacy/unscored NULL `keep` is treated as kept and likewise skipped —
 * matching `needs-swap` (which also excludes NULL).
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
 *   • Same-picture dedup (swap-review v2 §2): after a candidate is downloaded
 *     and its sha8 computed, if it equals the species' CURRENT live photo
 *     content_hash (iNat re-served the byte-identical image already live), the
 *     candidate is SKIPPED — not inserted, not added to the manifest — so the
 *     (paid) judge never scores a photo we already have. `skippedDuplicates`
 *     counts these (≈20% of candidates in a real run).
 */
/** The default image source key for a source-prepare/commit run (#974). */
export const DEFAULT_SOURCE = 'inat';

/** Optional caps for a source-prepare run. */
export interface SourcePrepareOpts {
  /**
   * Cap on how many keep=0 species to source this run. Undefined (the default)
   * sources ALL keep=0 species (backward-compatible). When set, applies
   * `LIMIT <limit>` to the worst-first (quality_score ASC) flagged query, so the
   * operator sources the N worst-scored needs-replacement species per run.
   */
  limit?: number;
  /**
   * The image source being searched (#974). Defaults to DEFAULT_SOURCE ('inat').
   * The flagged-species query EXCLUDES any species that already has a
   * source_attempt row for THIS source, so a second `source-prepare --source
   * inat` never re-sources an already-searched species (no re-picking the same
   * images); a DIFFERENT --source is unaffected and CAN retry an iNat-exhausted
   * species. Each newly-sourced species gets a recordSourceAttempt(outcome=
   * 'searched') row; source-commit later resolves it to 'better-found' or
   * 'exhausted'.
   */
  source?: string;
}

export async function sourcePrepare(
  db: Database.Database, pool: number, deps: SourcePrepareDeps,
  opts: SourcePrepareOpts = {},
): Promise<SourcePrepareResult> {
  const fetchInat = deps.fetchInatCandidates ?? realFetchInatCandidates;
  await mkdir(deps.thumbDir, { recursive: true });

  const clock = deps.clock ?? realClock;
  const inatPacer = new Pacer(deps.inatPaceMs ?? INAT_PACE_MS, clock);
  const edgePacer = new Pacer(deps.edgePaceMs ?? EDGE_PACE_MS, clock);
  const cappedPool = clampPool(pool);

  // Gate-coherent sourcing (#969 / PR #1004): select the species whose current
  // photo the judge flagged for replacement (keep = 0) — IDENTICAL to the review
  // server's `needs-swap` filter (queries.ts). `overall` is advisory-only now, so
  // order by the judge's own quality estimate (worst first); gate-rejected #994
  // rows carry quality_score = 0 and so sort first.
  // An optional species `--limit` caps how many keep=0 species are sourced this
  // run (worst-first). A positive integer applies `LIMIT ?`; anything else (the
  // default) sources ALL keep=0 species. Clamp to a non-negative integer so a
  // stray 0/negative/NaN never produces a malformed LIMIT.
  const rawLimit = opts.limit;
  const speciesLimit =
    typeof rawLimit === 'number' && Number.isFinite(rawLimit) && rawLimit >= 1
      ? Math.floor(rawLimit)
      : null;
  // Source-keyed skip (#974): exclude any species that ALREADY has a
  // source_attempt row for THIS source — once iNat has been searched for a
  // species, the next `source-prepare --source inat` never re-sources it (no
  // re-picking the same images). A different --source has its own ledger rows
  // and so CAN retry an iNat-exhausted species.
  const source = opts.source ?? DEFAULT_SOURCE;
  const flagged = db.prepare(
    `SELECT c.species_code, c.com_name, c.sci_name, c.family, c.content_hash
       FROM photo_score s
       JOIN photo_current c ON c.species_code = s.species_code
      WHERE s.role = 'current' AND s.keep = 0
        AND c.species_code NOT IN (SELECT species_code FROM source_attempt WHERE source = ?)
      ORDER BY s.quality_score ASC, c.species_code ASC
      ${speciesLimit !== null ? 'LIMIT ?' : ''}`,
  ).all(...(speciesLimit !== null ? [source, speciesLimit] : [source])) as FlaggedRow[];

  const manifest: SourceManifestEntry[] = [];
  let inatFetches = 0;
  let downloads = 0;
  let skippedDuplicates = 0;
  for (const sp of flagged) {
    if (!sp.sci_name) continue; // can't source without a scientific name
    const sciName = sp.sci_name;
    const round = maxSourceRound(db, sp.species_code) + 1;
    // The species' live photo hash (read once) — a candidate whose bytes match
    // it is the SAME picture iNat already served us; skip it (swap-review v2 §2).
    const currentHash = sp.content_hash;

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

    // Count only the REAL (non-same-picture) candidates this species yielded,
    // so the source_attempt ledger reflects the genuine candidate pool. The
    // same-picture dedup below increments this only for inserted candidates.
    let speciesCandidates = 0;
    for (const cand of candidates.slice(0, cappedPool)) {
      await edgePacer.gate();
      const bytes = await withBackoff(() => deps.download(cand.photoUrl), { clock });
      downloads++;
      const mime = mimeFromUrl(cand.photoUrl);
      const hash = sha8(bytes);
      // Same-picture dedup (#974): iNat re-served the byte-identical live photo.
      // A swap to the same bytes is never an improvement, so do NOT insert it and
      // do NOT add it to the manifest — the judge never scores a photo we have.
      if (currentHash && hash === currentHash) {
        skippedDuplicates++;
        continue;
      }
      const imagePath = join(deps.thumbDir, `${sp.species_code}-${cand.inatId}.${extFromMime(mime)}`);
      await writeFile(imagePath, bytes);
      insertCandidate(db, {
        speciesCode: sp.species_code, inatId: cand.inatId, photoUrl: cand.photoUrl,
        thumbPath: imagePath, attribution: cand.attribution, license: cand.license,
        sourceRound: round,
      });
      speciesCandidates++;
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

    // Record this species as searched under the run's source (#974). Only real
    // (non-duplicate) candidates are counted; outcome='searched' is resolved to
    // 'better-found'/'exhausted' by source-commit. This row is what makes the
    // NEXT `source-prepare --source <source>` skip the species.
    recordSourceAttempt(db, {
      speciesCode: sp.species_code,
      source,
      candidatesFound: speciesCandidates,
      outcome: 'searched',
    });
  }

  const manifestPath = join(deps.thumbDir, 'candidates-manifest.json');
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  // eslint-disable-next-line no-console
  console.log(`[source-prepare] external calls: ${inatFetches} iNat fetch(es) + ${downloads} edge download(s); sourced ${manifest.length} / same-picture skipped ${skippedDuplicates}`);
  return { picked: manifest.length, inatFetches, downloads, skippedDuplicates, manifestPath, manifest };
}

/** One agent candidate-scoring result. Carries the inat id + content hash. */
export interface SourceResult {
  speciesCode: string;
  inatId: number;
  contentHash: string;
  fieldMarks: string[];
  criteria: CriteriaScores;
  flags: string[];
  keep: boolean;
  qualityScore: number;
  rationale: string;
}

/** Optional knobs for a source-commit run. */
export interface SourceCommitOpts {
  /**
   * The image source whose source_attempt rows to resolve (#974). Defaults to
   * DEFAULT_SOURCE ('inat') — must match the source-prepare run that staged the
   * candidates. After committing the candidate scores, each species in the batch
   * has its 'searched' attempt resolved to 'better-found' (a non-duplicate
   * candidate clears the Δ≥MIN_IMPROVEMENT gate) or 'exhausted' (searched,
   * nothing better — stays needs-swap but future sourcing under this source
   * skips it).
   */
  source?: string;
}

/**
 * source-commit: composeReport each agent candidate result and persist it as
 * role='candidate' keyed by (species_code, content_hash) with the inat id, so
 * the review server's deny route can advance to a scored alternate. A missing
 * content hash is recorded as a failure, not thrown.
 *
 * Outcome resolution (#974): after the candidate scores are upserted, each
 * distinct species in the batch has its source_attempt outcome resolved by
 * reusing the swap gate (selectSwaps, whose `outscores`/`delta` encode the SAME
 * same-picture-exclusion + Δ≥MIN_IMPROVEMENT logic apply-swaps uses — no
 * duplicated threshold). If the best non-duplicate committed candidate would be
 * auto-proposed → 'better-found' with best_score; otherwise → 'exhausted'.
 */
export async function sourceCommit(
  db: Database.Database, results: SourceResult[], opts: SourceCommitOpts = {},
): Promise<CommitSummary> {
  const summary: CommitSummary = { committed: 0, failed: 0, errors: [] };
  const committedSpecies = new Set<string>();
  for (const r of results) {
    try {
      if (!r.contentHash) {
        throw new Error(`missing contentHash for ${r.speciesCode} candidate ${r.inatId} — re-run source-prepare`);
      }
      const { overall, verdict } = composeReport(r.criteria, r.flags, defaultRubricConfig, {
        keep: r.keep, qualityScore: r.qualityScore,
      });
      const report: QualityReport = {
        overall, verdict,
        deterministic: neutralDeterministic(),
        criteria: r.criteria,
        flags: r.flags,
        fieldMarks: r.fieldMarks,
        keep: r.keep,
        qualityScore: r.qualityScore,
        rationale: r.rationale,
        rubricVersion: defaultRubricConfig.version,
      };
      upsertScore(db, {
        speciesCode: r.speciesCode, role: 'candidate', candidateInatId: r.inatId,
        contentHash: r.contentHash, report,
      });
      committedSpecies.add(r.speciesCode);
      summary.committed++;
    } catch (err) {
      summary.failed++;
      summary.errors.push({ speciesCode: r.speciesCode, reason: err instanceof Error ? err.message : String(err) });
    }
  }

  // Resolve each committed species' 'searched' source_attempt to a terminal
  // sourcing outcome by reusing selectSwaps' gate. A species appears in the
  // selectSwaps output only when it has ≥1 non-duplicate scored candidate; its
  // `outscores` is true iff the best such candidate clears Δ≥MIN_IMPROVEMENT (the
  // exact predicate apply-swaps would propose on). No row for the species (no
  // non-dup candidate) → nothing cleared → 'exhausted'.
  if (committedSpecies.size > 0) {
    const source = opts.source ?? DEFAULT_SOURCE;
    const swapByCode = new Map(selectSwaps(db).map(s => [s.speciesCode, s]));
    for (const code of committedSpecies) {
      const swap = swapByCode.get(code);
      if (swap?.outscores) {
        // best non-dup candidate's quality_score = current + delta (delta is
        // computed against the best candidate AFTER same-picture dedup). Use the
        // gate's own number rather than re-deriving so the two never diverge.
        const bestScore = (swap.current.qualityScore ?? 0) + swap.delta;
        setSourceAttemptOutcome(db, code, source, 'better-found', Math.round(bestScore));
      } else {
        setSourceAttemptOutcome(db, code, source, 'exhausted');
      }
    }
  }
  return summary;
}
