import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import type {
  ImageInput, SpeciesContext, QualityReport, DeterministicReport,
  VisionJudge, RubricConfig,
} from '@bird-watch/photo-quality';
import {
  scoreImage as realScoreImage, assessDeterministic, composeOverall, defaultRubricConfig,
} from '@bird-watch/photo-quality';
import type { InatCandidate, DenyContext } from '@bird-watch/ingestor';
import { fetchInatCandidates as realFetchInatCandidates } from '@bird-watch/ingestor';
import type { SpeciesMeta, SpeciesWithPhoto } from '@bird-watch/shared-types';
import { sha8 } from './hash.js';
import {
  insertCandidate, upsertScore, getScoreByHash, maxSourceRound, upsertCurrentPhoto,
  updateCurrentPhotoHash, selectUnreviewed, markReviewed,
} from './store.js';
import {
  Pacer, withBackoff, clampPool, realClock,
  EDGE_PACE_MS, INAT_PACE_MS,
  type Clock,
} from './pacing.js';

/** Default thumb-cache dir for the production deny-loop entry point. */
const DEFAULT_THUMB_DIR = './thumb-cache';

/** Live thumbnail download (never used in unit tests, which inject `download`). */
async function downloadBytes(url: string): Promise<Buffer> {
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`download ${res.status} for ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

/** Injected I/O so unit tests never hit the real network / sharp / agent. */
export interface SourceDeps {
  fetchInatCandidates: (
    sciName: string,
    opts: { limit: number; excludeIds?: number[]; denyContext?: DenyContext },
  ) => Promise<InatCandidate[]>;
  download: (url: string) => Promise<Buffer>;
  scoreImage: (img: ImageInput, ctx: SpeciesContext, opts: { judge: VisionJudge; config: RubricConfig }) => Promise<QualityReport>;
  judge: VisionJudge;
  config: RubricConfig;
  thumbDir: string;
  /** Injected clock so unit tests assert pacing WITHOUT a real wall-clock wait. */
  clock?: Clock;
  /** Min ms between iNat fetches (≤1 req/sec). Defaults to INAT_PACE_MS (1100). */
  inatPaceMs?: number;
  /** Min ms between bird-maps.com edge downloads. Defaults to EDGE_PACE_MS (1100). */
  edgePaceMs?: number;
}

export interface SourceArgs {
  speciesCode: string;
  sciName: string;
  comName?: string;
  family?: string;
  limit: number;
  denyContext?: DenyContext;
  excludeIds?: number[];
}

export interface SourceSummary {
  speciesCode: string;
  fetched: number;
  scored: number;
  cached: number;
  failed: number;
  sourceRound: number;
  errors: Array<{ inatId: number; reason: string }>;
}

export function mimeFromUrl(url: string): string {
  const path = url.split('?')[0]?.toLowerCase() ?? url;
  if (path.endsWith('.png')) return 'image/png';
  if (path.endsWith('.webp')) return 'image/webp';
  return 'image/jpeg';
}

export function extFromMime(mime: string): string {
  if (mime === 'image/png') return 'png';
  if (mime === 'image/webp') return 'webp';
  return 'jpg';
}

/**
 * Fetch iNat top-N candidates for one species, cache each thumbnail, score it,
 * persist photo_candidate + photo_score. Re-sourcing (denyContext present)
 * lands in the next source_round and forwards the exclude ids + deny bias to
 * the Slice-3 sourcer. Per-candidate failures are isolated and recorded — one
 * bad thumbnail never aborts the species (mirrors run-photos.ts). The judge is
 * injected: unit tests pass FakeJudge; the source-candidates workflow passes the
 * real Claude Code agent-judge.
 */
export async function sourceCandidates(
  db: Database.Database, args: SourceArgs, deps: SourceDeps,
): Promise<SourceSummary> {
  const round = maxSourceRound(db, args.speciesCode) + 1;
  const summary: SourceSummary = {
    speciesCode: args.speciesCode,
    fetched: 0, scored: 0, cached: 0, failed: 0, sourceRound: round, errors: [],
  };

  const clock = deps.clock ?? realClock;
  const inatPacer = new Pacer(deps.inatPaceMs ?? INAT_PACE_MS, clock);
  const edgePacer = new Pacer(deps.edgePaceMs ?? EDGE_PACE_MS, clock);

  // Bound the iNat pool to the top ~12 (clamp the caller's limit) so no path
  // fans out an unbounded fetch.
  const cappedLimit = clampPool(args.limit);
  const fetchOpts: { limit: number; excludeIds?: number[]; denyContext?: DenyContext } = { limit: cappedLimit };
  if (args.excludeIds) fetchOpts.excludeIds = args.excludeIds;
  if (args.denyContext) fetchOpts.denyContext = args.denyContext;
  // iNat is third-party: pace + jittered backoff on 429/5xx (bounded retries).
  await inatPacer.gate();
  const fetched = await withBackoff(
    () => deps.fetchInatCandidates(args.sciName, fetchOpts), { clock },
  );
  const candidates = fetched.slice(0, cappedLimit);
  summary.fetched = candidates.length;

  await mkdir(deps.thumbDir, { recursive: true });

  const ctx: SpeciesContext = {
    speciesCode: args.speciesCode,
    comName: args.comName ?? '',
    sciName: args.sciName,
    family: args.family ?? '',
  };

  for (const cand of candidates) {
    try {
      // Pace the edge download (serial, ≥1.1 s) with jittered backoff on 429/5xx.
      await edgePacer.gate();
      const bytes = await withBackoff(() => deps.download(cand.photoUrl), { clock });
      const mime = mimeFromUrl(cand.photoUrl);
      const hash = sha8(bytes);
      const thumbPath = join(deps.thumbDir, `${args.speciesCode}-${cand.inatId}.${extFromMime(mime)}`);
      await writeFile(thumbPath, bytes);

      insertCandidate(db, {
        speciesCode: args.speciesCode,
        inatId: cand.inatId,
        photoUrl: cand.photoUrl,
        thumbPath,
        attribution: cand.attribution,
        license: cand.license,
        sourceRound: round,
      });

      // Cache check: skip the judge when this exact image is already scored.
      if (getScoreByHash(db, args.speciesCode, 'candidate', hash)) {
        summary.cached++;
        continue;
      }

      const report = await deps.scoreImage(
        { buffer: bytes, mime, sourceUrl: cand.photoUrl },
        ctx,
        { judge: deps.judge, config: deps.config },
      );
      upsertScore(db, {
        speciesCode: args.speciesCode, role: 'candidate',
        candidateInatId: cand.inatId, contentHash: hash, report,
      });
      summary.scored++;
    } catch (err) {
      summary.failed++;
      summary.errors.push({ inatId: cand.inatId, reason: err instanceof Error ? err.message : String(err) });
      // continue — one candidate's failure must not abort the species
    }
  }
  // eslint-disable-next-line no-console
  console.log(`[source-candidates] ${args.speciesCode}: external calls: 1 iNat fetch + ${candidates.length} edge download(s)`);
  return summary;
}

/**
 * The dep + arg bundle scoreAndCacheCandidates builds internally. The CALLER
 * must supply the `judge` (see below — it cannot be constructed in plain Node);
 * the remaining IO (fetchInatCandidates, download, scoreImage, thumb dir,
 * config) defaults to the production implementation but stays overridable so a
 * unit test can stub exactly what it needs. `sciName`/`comName`/`family`
 * default to the photo_current row.
 */
export interface ScoreAndCacheDeps extends SourceDeps {
  sciName: string;
  limit: number;
  comName: string;
  family: string;
}

interface CurrentRow { sci_name: string | null; com_name: string | null; family: string | null }

/**
 * Slice-5 deny-loop entry point. When the pre-scored candidate pool is
 * exhausted, a re-source reaches a fresh batch via
 * `scoreAndCacheCandidates(db, speciesCode, denyContext, excludeIds, deps)`; the
 * helper reads `sciName` from the `photo_current` row keyed by `speciesCode`
 * and constructs the production IO (real fetchInatCandidates, live download,
 * scoreImage, the thumb-cache dir) for any field the caller does not override.
 * Returns the COUNT of freshly sourced+scored candidates (a number), landing
 * them in the next source_round biased by the operator's reason/tags.
 *
 * `deps` is REQUIRED and MUST carry a `judge`. The vision judge is a Claude
 * Code `agent()` available ONLY inside the committed `.mjs` workflow — it
 * cannot be constructed in plain Node, so there is no production-default judge
 * and no no-IO standalone form. The caller (the source-candidates `.mjs`
 * workflow's agent-judge, or a unit test's FakeJudge) always supplies it.
 * Note: the Slice-5 review server (#972/#973) does NOT call this — its deny
 * loop queues a re-source via `photo_decision.resource_requested` — so the
 * required `deps` breaks no consumer.
 */
export async function scoreAndCacheCandidates(
  db: Database.Database,
  speciesCode: string,
  denyContext: DenyContext,
  excludeIds: number[],
  deps: Partial<ScoreAndCacheDeps> & Pick<ScoreAndCacheDeps, 'judge'>,
): Promise<number> {
  // sciName comes from the store (photo_current) unless a test overrides it.
  const row = db.prepare(
    `SELECT sci_name, com_name, family FROM photo_current WHERE species_code=?`,
  ).get(speciesCode) as CurrentRow | undefined;
  const sciName = deps.sciName ?? row?.sci_name ?? undefined;
  if (!sciName) {
    throw new Error(`no photo_current row (sci_name) for ${speciesCode} — run sync first`);
  }

  // The judge is required from the caller (the workflow's agent-judge / a test's
  // FakeJudge); the remaining IO defaults to the production implementation but
  // every field stays overridable for a unit test. The pacing seam (clock +
  // pace overrides) is forwarded only when the caller supplies it — production
  // omits it and sourceCandidates defaults to realClock + the spec pacing.
  const resolved: SourceDeps = {
    fetchInatCandidates: deps.fetchInatCandidates ?? realFetchInatCandidates,
    download: deps.download ?? downloadBytes,
    scoreImage: deps.scoreImage ?? realScoreImage,
    judge: deps.judge,
    config: deps.config ?? defaultRubricConfig,
    thumbDir: deps.thumbDir ?? DEFAULT_THUMB_DIR,
    ...(deps.clock !== undefined ? { clock: deps.clock } : {}),
    ...(deps.inatPaceMs !== undefined ? { inatPaceMs: deps.inatPaceMs } : {}),
    ...(deps.edgePaceMs !== undefined ? { edgePaceMs: deps.edgePaceMs } : {}),
  };

  const comName = deps.comName ?? row?.com_name ?? undefined;
  const family = deps.family ?? row?.family ?? undefined;
  const summary = await sourceCandidates(
    db,
    {
      speciesCode,
      sciName,
      ...(comName !== undefined ? { comName } : {}),
      ...(family !== undefined ? { family } : {}),
      // Bounded pool (clamped to ~12 inside sourceCandidates). Default to the cap.
      limit: deps.limit ?? clampPool(15),
      denyContext,
      excludeIds,
    },
    resolved,
  );
  // The contract return is the count of candidates freshly sourced into this
  // round that now carry a score — `scored` (freshly judged) PLUS `cached` (an
  // identical image already scored in a prior round, re-landed in the new
  // source_round). Both are "fresh candidates" Slice 5's deny route can advance
  // to; only `failed` (a download/score error) is excluded. A number, not a
  // summary object.
  return summary.scored + summary.cached;
}

// ─────────────────────────────────────────────────────────────────────────────
// sync (cheap, NO tokens) + the batched scoreBatch / scoreOne scoring module.
// ─────────────────────────────────────────────────────────────────────────────

export interface SyncDeps { apiBase: string } // e.g. https://api.bird-maps.com

export interface SyncSummary {
  total: number;
  upserted: number;
  skipped: number; // no live photo
  failed: number;
  errors: Array<{ speciesCode: string; reason: string }>;
}

/**
 * Cheap, NO-token snapshot. Reads the live detail-panel photo for each species
 * from prod read-api and upserts photo_current with reviewed = 0. A species with
 * no live photo (Wikipedia-only / family-silhouette fallback) is skipped +
 * counted. Idempotent: a re-run upserts new/changed photos back to reviewed = 0
 * — this is the "manually scan new photos" mechanism (no ingestor change, no
 * auto-gate). Writes NO score row; scoring is the separate scoreBatch pass.
 *
 * content_hash is left empty at sync time (an empty-string sentinel — Part A's
 * CurrentPhotoInput types it as a string and the column is nullable); scoreOne
 * re-stamps the real content hash once it downloads the bytes. The load-bearing
 * behavior is reviewed = 0 + selectUnreviewed visibility, not the hash value.
 */
export async function sync(
  db: Database.Database, speciesCodes: string[], deps: SyncDeps,
): Promise<SyncSummary> {
  const summary: SyncSummary = {
    total: speciesCodes.length, upserted: 0, skipped: 0, failed: 0, errors: [],
  };
  for (const code of speciesCodes) {
    try {
      const res = await fetch(`${deps.apiBase}/api/species/${code}`, {
        headers: { accept: 'application/json' },
      });
      if (!res.ok) throw new Error(`read-api ${res.status} for ${code}`);
      const meta = (await res.json()) as SpeciesMeta;
      if (!meta.photoUrl) { summary.skipped++; continue; }
      upsertCurrentPhoto(db, {
        speciesCode: code, comName: meta.comName, sciName: meta.sciName,
        family: meta.familyName, url: meta.photoUrl,
        attribution: meta.photoAttribution ?? '', license: meta.photoLicense ?? '',
        contentHash: '', // hash is computed at score time, not sync time
      });
      summary.upserted++;
    } catch (err) {
      summary.failed++;
      summary.errors.push({ speciesCode: code, reason: err instanceof Error ? err.message : String(err) });
    }
  }
  return summary;
}

/**
 * The whole-backlog snapshot (#992). Calls `GET /api/species/with-photos` ONCE
 * — the read-api endpoint that INNER-JOINs `species_meta` to
 * `species_photos(purpose='detail-panel')` and returns the ~715
 * observed-with-photos species in a single body — and upserts every row into
 * `photo_current` with reviewed = 0.
 *
 * This replaces the old no-`--species` path, which fetched `/api/species` (the
 * full 17.8k-code eBird taxonomy, no photoUrl) and then issued a per-species
 * `/api/species/:code` detail call each — ~17.8k requests, almost all `noPhoto`.
 * Because the endpoint already filters to species WITH a photo, there is no
 * `skipped` count here: every returned row carries a `photoUrl` and is upserted.
 *
 * Same idempotent, NO-token, reviewed=0 contract as `sync` (which the
 * `--species <code>` single path still uses via `/api/species/:code`).
 * content_hash is left empty at sync time; `scoreOne` re-stamps the real hash
 * when it downloads the bytes.
 */
export async function syncAll(
  db: Database.Database, deps: SyncDeps,
): Promise<SyncSummary> {
  const res = await fetch(`${deps.apiBase}/api/species/with-photos`, {
    headers: { accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`read-api ${res.status} for /api/species/with-photos`);
  const rows = (await res.json()) as SpeciesWithPhoto[];

  const summary: SyncSummary = {
    total: rows.length, upserted: 0, skipped: 0, failed: 0, errors: [],
  };
  for (const row of rows) {
    try {
      upsertCurrentPhoto(db, {
        speciesCode: row.code, comName: row.comName, sciName: row.sciName,
        family: row.family, url: row.photoUrl,
        attribution: row.photoAttribution ?? '', license: row.photoLicense ?? '',
        contentHash: '', // hash is computed at score time, not sync time
      });
      summary.upserted++;
    } catch (err) {
      summary.failed++;
      summary.errors.push({ speciesCode: row.code, reason: err instanceof Error ? err.message : String(err) });
    }
  }
  return summary;
}

/** One reviewed=0 row. selectUnreviewed returns rows of this shape. */
export interface UnreviewedRow {
  species_code: string; com_name: string; sci_name: string; family: string; url: string;
}

export interface ScoreBatchDeps {
  judge: VisionJudge;
  download: (url: string) => Promise<Buffer>;
  config: RubricConfig;
  scoreImage?: SourceDeps['scoreImage']; // test seam; defaults to the agent-free composer
  /** Injected clock so unit tests assert download pacing WITHOUT a real wait. */
  clock?: Clock;
  /** Min ms between bird-maps.com edge downloads. Defaults to EDGE_PACE_MS (1100). */
  edgePaceMs?: number;
}

export interface ScoreBatchSummary {
  picked: number; scored: number; gatedOut: number; cached: number; failed: number;
  /** External edge downloads actually performed (for the batch usage log). */
  downloads: number;
  errors: Array<{ speciesCode: string; reason: string }>;
}

/** A neutral deterministic report for the no-gate path (config has no deterministic block). */
function neutralDeterministic(): DeterministicReport {
  return {
    width: 0, height: 0, megapixels: 0, sharpness: 0, exposure: 0, aspectRatio: 0,
    passedGate: true, failReasons: [],
  };
}

/**
 * Default current-photo composer used when no `scoreImage` seam is injected.
 * Calls the injected judge and composes the report WITHOUT the sharp decode —
 * scoreOne already ran the deterministic gate. Composite math is defensive
 * (weights/thresholds/disqualifiers may be absent in a minimal test config).
 */
async function composeWithJudge(
  img: ImageInput, ctx: SpeciesContext, opts: { judge: VisionJudge; config: RubricConfig },
  deterministic: DeterministicReport,
): Promise<QualityReport> {
  const { judge, config } = opts;
  const { fieldMarks, criteria, flags, keep, qualityScore, rationale } =
    await judge.judge(img, ctx, config.judgePrompt ?? '');
  let overall = 0;
  if (config.weights) {
    overall = composeOverall(criteria, config.weights);
    for (const { flag, cap } of config.disqualifiers ?? []) {
      if (flags.includes(flag)) overall = Math.min(overall, cap);
    }
    overall = Math.round(overall * 10) / 10;
  }
  const t = config.thresholds;
  // overall/verdict are ADVISORY ranking; the GATE is the judge's `keep` (#969).
  const verdict: QualityReport['verdict'] = !t
    ? 'reject'
    : overall >= t.autoAccept ? 'great'
      : overall >= t.review ? 'good'
        : overall >= t.reject ? 'mediocre' : 'reject';
  return {
    overall, verdict, deterministic, criteria, flags,
    fieldMarks, keep, qualityScore,
    rationale, rubricVersion: config.version,
  };
}

/**
 * Score ONE reviewed=0 current photo: download → assessDeterministic gate (only
 * when the config carries a `deterministic` block and the bytes decode) →
 * gated-out composes a reject (NO judge call) else compose with the injected
 * judge → writeScore(role='current'). The agent is never imported here; the
 * committed workflow injects the real agent-judge, tests inject FakeJudge.
 */
export async function scoreOne(
  db: Database.Database, row: UnreviewedRow, deps: ScoreBatchDeps,
): Promise<'scored' | 'gated' | 'cached'> {
  // Jittered backoff on a transient (429/5xx) edge download; the caller
  // (scoreBatch) gates the serial pacing between rows.
  const bytes = await withBackoff(() => deps.download(row.url), { clock: deps.clock ?? realClock });
  const mime = mimeFromUrl(row.url);
  const hash = sha8(bytes);

  // Record the real content hash now that we have the bytes. A hash-ONLY update
  // (not a full upsertCurrentPhoto) so the attribution/license that `sync`
  // populated survive — the UnreviewedRow carries no attribution/license, so a
  // full re-stamp would clobber that load-bearing CC-BY metadata to ''.
  updateCurrentPhotoHash(db, row.species_code, hash);
  if (getScoreByHash(db, row.species_code, 'current', hash)) return 'cached';

  const img: ImageInput = { buffer: bytes, mime, sourceUrl: row.url };
  const ctx: SpeciesContext = {
    speciesCode: row.species_code, comName: row.com_name, sciName: row.sci_name, family: row.family,
  };

  // Deterministic gate: run only when the config carries a deterministic block.
  // A decode failure (sharp throwing on un-decodable bytes) is treated as a
  // gate fail, not a thrown error — the image never reaches the judge.
  let deterministic: DeterministicReport = neutralDeterministic();
  if (deps.config.deterministic) {
    try {
      deterministic = await assessDeterministic(img, deps.config.deterministic);
    } catch {
      deterministic = { ...neutralDeterministic(), passedGate: false, failReasons: ['undecodable'] };
    }
  }

  let report: QualityReport;
  let outcome: 'scored' | 'gated';
  if (!deterministic.passedGate) {
    // gated out — compose a reject from the deterministic report, NO judge call.
    report = {
      overall: 0, verdict: 'reject', deterministic,
      criteria: { framing: 0, subjectClarity: 0, liveness: 0, naturalness: 0, pose: 0, background: 0, lighting: 0 },
      flags: ['gate-fail'],
      // #994 pre-filter reject: keep:false is the gate, no judge ran.
      fieldMarks: [], keep: false, qualityScore: 0,
      rationale: `deterministic gate failed: ${deterministic.failReasons.join(', ')}`,
      rubricVersion: deps.config.version,
    };
    outcome = 'gated';
  } else if (deps.scoreImage) {
    // injected scoreImage seam (runs its own gate internally)
    report = await deps.scoreImage(img, ctx, { judge: deps.judge, config: deps.config });
    outcome = 'scored';
  } else {
    report = await composeWithJudge(img, ctx, { judge: deps.judge, config: deps.config }, deterministic);
    outcome = 'scored';
  }
  upsertScore(db, { speciesCode: row.species_code, role: 'current', candidateInatId: null, contentHash: hash, report });
  return outcome;
}

/** Clamp the batch limit into [1,100] (default caller passes 10). */
function clampLimit(n: number): number { return Math.max(1, Math.min(100, Math.trunc(n) || 1)); }

/**
 * Score the next `limit` reviewed=0 rows (default 10, clamp [1,100]) and mark
 * each reviewed. Resumable across sessions until the backlog clears. Per-species
 * isolation mirrors run-photos.ts. The committed score-current workflow calls
 * this with the real agent-judge; tests call it with FakeJudge + a stub download.
 */
export async function scoreBatch(
  db: Database.Database, limit: number, deps: ScoreBatchDeps,
): Promise<ScoreBatchSummary> {
  // selectUnreviewed (Part A) is the canonical reviewed=0 / oldest-first backlog
  // query; its rows carry the snake_case aliases scoreOne consumes directly.
  const rows: UnreviewedRow[] = selectUnreviewed(db, clampLimit(limit));
  const summary: ScoreBatchSummary = {
    picked: rows.length, scored: 0, gatedOut: 0, cached: 0, failed: 0, downloads: 0, errors: [],
  };
  const clock = deps.clock ?? realClock;
  const edgePacer = new Pacer(deps.edgePaceMs ?? EDGE_PACE_MS, clock);
  for (const row of rows) {
    try {
      // Serial edge pacing (≥1.1 s) between per-species downloads — gate first.
      await edgePacer.gate();
      const outcome = await scoreOne(db, row, deps);
      summary.downloads++; // scoreOne performed exactly one edge download
      if (outcome === 'scored') summary.scored++;
      else if (outcome === 'gated') summary.gatedOut++;
      else summary.cached++;
      markReviewed(db, row.species_code);
    } catch (err) {
      summary.failed++;
      summary.errors.push({ speciesCode: row.species_code, reason: err instanceof Error ? err.message : String(err) });
    }
  }
  // eslint-disable-next-line no-console
  console.log(`[score] external calls: ${summary.downloads} edge download(s)`);
  return summary;
}
// Expose the clamp so the CLI / workflow share one source of truth.
scoreBatch.clampLimit = clampLimit;
