import type Database from 'better-sqlite3';
import type { QualityReport, CriteriaScores, Verdict } from '@bird-watch/photo-quality';

export interface CurrentPhotoInput {
  speciesCode: string;
  comName: string;
  sciName: string;
  family: string;
  url: string;
  attribution: string;
  license: string;
  contentHash: string;
}

export type ScoreRole = 'current' | 'candidate';

export interface ScoreInput {
  speciesCode: string;
  role: ScoreRole;
  candidateInatId: number | null;
  contentHash: string;
  report: QualityReport;
}

export interface StoredScore {
  speciesCode: string;
  role: ScoreRole;
  candidateInatId: number | null;
  contentHash: string;
  overall: number;
  verdict: Verdict;
  criteria: CriteriaScores;
  flags: string[];
  rationale: string;
  rubricVersion: string;
  scoredAt: string;
}

export interface CandidateInput {
  speciesCode: string;
  inatId: number;
  photoUrl: string;
  thumbPath: string;
  attribution: string;
  license: string;
  sourceRound: number;
}

export interface StoredCandidate extends CandidateInput {
  id: number;
  excluded: boolean;
}

/** Upsert the snapshot of a species' live photo (PK species_code). */
export function upsertCurrentPhoto(db: Database.Database, p: CurrentPhotoInput): void {
  db.prepare(
    `INSERT INTO photo_current
       (species_code, com_name, sci_name, family, url, attribution, license, content_hash)
     VALUES (@speciesCode, @comName, @sciName, @family, @url, @attribution, @license, @contentHash)
     ON CONFLICT(species_code) DO UPDATE SET
       com_name=excluded.com_name, sci_name=excluded.sci_name, family=excluded.family,
       url=excluded.url, attribution=excluded.attribution, license=excluded.license,
       content_hash=excluded.content_hash`,
  ).run(p);
}

/**
 * A reviewed=0 backlog row. Carries BOTH casings: the camelCase fields are the
 * Part A contract; the snake_case aliases (`species_code`, `com_name`,
 * `sci_name`) match the raw DB column names so Slice-4b's batched scorer
 * (`scoreOne`/`scoreBatch`) and its `sync.test.ts` can consume `selectUnreviewed`
 * rows directly without a casing remap. Both views are always present and equal.
 */
export interface UnreviewedPhoto {
  speciesCode: string;
  comName: string;
  sciName: string;
  family: string;
  url: string;
  attribution: string;
  license: string;
  contentHash: string;
  // snake_case aliases (raw column names) — kept in sync with the camelCase view.
  species_code: string;
  com_name: string;
  sci_name: string;
}

interface CurrentPhotoRow {
  species_code: string;
  com_name: string;
  sci_name: string;
  family: string;
  url: string;
  attribution: string;
  license: string;
  content_hash: string;
}

/**
 * The batched-`score` backlog query: up to `limit` photo_current rows with
 * reviewed=0 (not yet AI-scored), oldest-first by species_code. Part B's
 * `score` workflow pulls a batch (default 10, max 100), agent-scores each, and
 * calls markReviewed to clear it from the backlog — resumable across sessions.
 * `limit` is clamped to [1,100] by the caller (the CLI `--limit` flag).
 */
export function selectUnreviewed(db: Database.Database, limit: number): UnreviewedPhoto[] {
  const rows = db.prepare(
    `SELECT species_code, com_name, sci_name, family, url, attribution, license, content_hash
       FROM photo_current WHERE reviewed=0 ORDER BY species_code ASC LIMIT ?`,
  ).all(limit) as CurrentPhotoRow[];
  return rows.map(r => ({
    speciesCode: r.species_code,
    comName: r.com_name,
    sciName: r.sci_name,
    family: r.family,
    url: r.url,
    attribution: r.attribution,
    license: r.license,
    contentHash: r.content_hash,
    // snake_case aliases for the Slice-4b batched scorer.
    species_code: r.species_code,
    com_name: r.com_name,
    sci_name: r.sci_name,
  }));
}

/** Mark a species' current photo AI-scored (reviewed=1) — clears it from selectUnreviewed. Idempotent. */
export function markReviewed(db: Database.Database, speciesCode: string): void {
  db.prepare(`UPDATE photo_current SET reviewed=1 WHERE species_code=?`).run(speciesCode);
}

/**
 * Upsert a scoring report keyed by (species_code, role, content_hash). The
 * unique index makes this the idempotent cache row: a re-score of the same
 * image overwrites in place. JSON columns hold criteria + flags.
 */
export function upsertScore(db: Database.Database, s: ScoreInput): void {
  db.prepare(
    `INSERT INTO photo_score
       (species_code, role, candidate_inat_id, content_hash, overall, verdict,
        criteria_json, flags_json, rationale, rubric_version, scored_at)
     VALUES (@species_code, @role, @candidate_inat_id, @content_hash, @overall, @verdict,
        @criteria_json, @flags_json, @rationale, @rubric_version, @scored_at)
     ON CONFLICT(species_code, role, content_hash) DO UPDATE SET
       candidate_inat_id=excluded.candidate_inat_id, overall=excluded.overall,
       verdict=excluded.verdict, criteria_json=excluded.criteria_json,
       flags_json=excluded.flags_json, rationale=excluded.rationale,
       rubric_version=excluded.rubric_version, scored_at=excluded.scored_at`,
  ).run({
    species_code: s.speciesCode,
    role: s.role,
    candidate_inat_id: s.candidateInatId,
    content_hash: s.contentHash,
    overall: s.report.overall,
    verdict: s.report.verdict,
    criteria_json: JSON.stringify(s.report.criteria),
    flags_json: JSON.stringify(s.report.flags),
    rationale: s.report.rationale,
    rubric_version: s.report.rubricVersion,
    scored_at: new Date().toISOString(),
  });
}

interface ScoreRow {
  species_code: string;
  role: ScoreRole;
  candidate_inat_id: number | null;
  content_hash: string;
  overall: number;
  verdict: Verdict;
  criteria_json: string;
  flags_json: string;
  rationale: string;
  rubric_version: string;
  scored_at: string;
}

/**
 * The cache check: return the stored report for this image content hash, or
 * null when unscored. The orchestrator calls this BEFORE scoreImage to avoid a
 * redundant (paid) judge call.
 */
export function getScoreByHash(
  db: Database.Database, speciesCode: string, role: ScoreRole, contentHash: string,
): StoredScore | null {
  const row = db.prepare(
    `SELECT * FROM photo_score WHERE species_code=? AND role=? AND content_hash=?`,
  ).get(speciesCode, role, contentHash) as ScoreRow | undefined;
  if (!row) return null;
  return {
    speciesCode: row.species_code,
    role: row.role,
    candidateInatId: row.candidate_inat_id,
    contentHash: row.content_hash,
    overall: row.overall,
    verdict: row.verdict,
    criteria: JSON.parse(row.criteria_json) as CriteriaScores,
    flags: JSON.parse(row.flags_json) as string[],
    rationale: row.rationale,
    rubricVersion: row.rubric_version,
    scoredAt: row.scored_at,
  };
}

/** Insert a sourced candidate. Ignores a duplicate (species, inat_id, round). */
export function insertCandidate(db: Database.Database, c: CandidateInput): void {
  db.prepare(
    `INSERT OR IGNORE INTO photo_candidate
       (species_code, inat_id, photo_url, thumb_path, attribution, license, source_round)
     VALUES (@speciesCode, @inatId, @photoUrl, @thumbPath, @attribution, @license, @sourceRound)`,
  ).run(c);
}

interface CandidateRow {
  id: number;
  species_code: string;
  inat_id: number;
  photo_url: string;
  thumb_path: string;
  attribution: string;
  license: string;
  excluded: number;
  source_round: number;
}

/** List candidates for a species, newest round first; excludes `excluded=1` by default. */
export function listCandidates(
  db: Database.Database, speciesCode: string, opts: { includeExcluded?: boolean } = {},
): StoredCandidate[] {
  const where = opts.includeExcluded
    ? `species_code=?`
    : `species_code=? AND excluded=0`;
  const rows = db.prepare(
    `SELECT * FROM photo_candidate WHERE ${where} ORDER BY source_round DESC, id ASC`,
  ).all(speciesCode) as CandidateRow[];
  return rows.map(r => ({
    id: r.id,
    speciesCode: r.species_code,
    inatId: r.inat_id,
    photoUrl: r.photo_url,
    thumbPath: r.thumb_path,
    attribution: r.attribution,
    license: r.license,
    excluded: r.excluded === 1,
    sourceRound: r.source_round,
  }));
}

/**
 * Mark the given iNat ids excluded for a species (deny → remove from the next
 * swap screen). Scoped by species_code because the candidate uniqueness key is
 * (species_code, inat_id, source_round) — inat_id is NOT unique on its own, so
 * an unscoped `WHERE inat_id=?` could over-exclude a same-id row under another
 * species.
 */
export function markCandidatesExcluded(
  db: Database.Database, speciesCode: string, inatIds: number[],
): void {
  if (inatIds.length === 0) return;
  const stmt = db.prepare(
    `UPDATE photo_candidate SET excluded=1 WHERE species_code=? AND inat_id=?`,
  );
  const tx = db.transaction((ids: number[]) => { for (const id of ids) stmt.run(speciesCode, id); });
  tx(inatIds);
}

/** Highest source_round seen for a species (-1 when none) — the re-source counter. */
export function maxSourceRound(db: Database.Database, speciesCode: string): number {
  const row = db.prepare(
    `SELECT COALESCE(MAX(source_round), -1) AS r FROM photo_candidate WHERE species_code=?`,
  ).get(speciesCode) as { r: number };
  return row.r;
}
