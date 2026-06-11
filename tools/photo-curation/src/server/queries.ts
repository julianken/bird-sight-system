import type Database from 'better-sqlite3';
import type { DenyContext } from '@bird-watch/ingestor';

export type SortMode = 'worst-first' | 'best-first' | 'has-better-candidate' | 'recently-scored' | 'quality-score';
// 'needs-swap' = the judge's direct keep/replace gate (#969): keep=0. This is
// the canonical "needs replacement" set, NOT a composite threshold.
export type FilterMode = 'all' | 'flagged' | 'dead-sick' | 'distant' | 'in-hand' | 'soft' | 'marked-for-swap' | 'unscored' | 'needs-swap';

export interface Criteria {
  framing: number; subjectClarity: number; liveness: number;
  naturalness: number; pose: number; background: number; lighting: number;
}

export interface OverviewRow {
  speciesCode: string;
  comName: string;
  sciName: string;
  family: string;
  url: string;
  attribution: string;
  license: string;
  overall: number | null;     // composite (ADVISORY ranking, NOT the gate)
  verdict: string | null;      // derived from overall (ADVISORY)
  flags: string[];
  criteria: Criteria;
  // #969 Opus field-mark judge. `keep` is the GATE (false = needs replacement);
  // `qualityScore` is the judge's own 0–100 estimate; `fieldMarks` the diagnostic
  // marks it named. `keep` is null only for a legacy pre-#969 row (treated as kept).
  keep: boolean | null;
  qualityScore: number | null;
  fieldMarks: string[];
  rationale: string | null;
  scoredAt: string | null;
  bestCandidateOverall: number | null;
  markedForSwap: boolean;
  decisionAction: string | null;
  reviewed: boolean;   // photo_current.reviewed — false = awaiting the AI scoring pass
}

const ZERO_CRITERIA: Criteria = {
  framing: 0, subjectClarity: 0, liveness: 0, naturalness: 0, pose: 0, background: 0, lighting: 0,
};

interface RawRow {
  species_code: string; com_name: string; sci_name: string; family: string;
  url: string; attribution: string; license: string;
  overall: number | null; verdict: string | null; criteria_json: string | null;
  flags_json: string | null; rationale: string | null; scored_at: string | null;
  keep: number | null; quality_score: number | null; field_marks: string | null;
  best_candidate_overall: number | null;
  decision_action: string | null;
  reviewed: number;
}

// 'soft' = low subjectClarity (blur). Threshold mirrors the rubric's
// subjectClarity floor; tuned during calibration (Slice 10), 5 is a safe default.
const SOFT_CLARITY_MAX = 5;

function mapRow(r: RawRow): OverviewRow {
  let flags: string[] = [];
  if (r.flags_json) { try { flags = JSON.parse(r.flags_json) as string[]; } catch { flags = []; } }
  let criteria = ZERO_CRITERIA;
  if (r.criteria_json) { try { criteria = JSON.parse(r.criteria_json) as Criteria; } catch { /* keep zeros */ } }
  let fieldMarks: string[] = [];
  if (r.field_marks) { try { fieldMarks = JSON.parse(r.field_marks) as string[]; } catch { fieldMarks = []; } }
  // keep is null only when the row predates the #969 columns (or is unscored) →
  // treat null as kept (true). An explicit 0 = needs replacement.
  const keep = r.keep === null ? null : r.keep === 1;
  return {
    speciesCode: r.species_code, comName: r.com_name, sciName: r.sci_name, family: r.family,
    url: r.url, attribution: r.attribution, license: r.license,
    overall: r.overall, verdict: r.verdict, flags, criteria,
    keep, qualityScore: r.quality_score, fieldMarks,
    rationale: r.rationale, scoredAt: r.scored_at,
    bestCandidateOverall: r.best_candidate_overall,
    markedForSwap: r.decision_action === 'approve' || r.decision_action === 'pending',
    decisionAction: r.decision_action,
    reviewed: r.reviewed === 1,
  };
}

export function listOverview(
  db: Database.Database,
  opts: { sort: SortMode; filter: FilterMode },
): OverviewRow[] {
  const raw = db.prepare(`
    SELECT pc.species_code, pc.com_name, pc.sci_name, pc.family,
           pc.url, pc.attribution, pc.license, pc.reviewed,
           ps.overall, ps.verdict, ps.criteria_json, ps.flags_json, ps.rationale, ps.scored_at,
           ps.keep, ps.quality_score, ps.field_marks,
           (SELECT MAX(cs.overall)
              FROM photo_score cs
              JOIN photo_candidate cand
                ON cand.species_code = cs.species_code
               AND cand.inat_id = cs.candidate_inat_id
               AND cand.excluded = 0
             WHERE cs.species_code = pc.species_code AND cs.role = 'candidate') AS best_candidate_overall,
           pd.action AS decision_action
      FROM photo_current pc
      LEFT JOIN photo_score ps
        ON ps.species_code = pc.species_code AND ps.role = 'current'
      LEFT JOIN photo_decision pd
        ON pd.species_code = pc.species_code
  `).all() as RawRow[];

  let rows = raw.map(mapRow);

  // Filter
  rows = rows.filter(row => {
    switch (opts.filter) {
      case 'all': return true;
      case 'flagged': return row.flags.length > 0;
      case 'dead-sick': return row.flags.includes('dead') || row.flags.includes('sick');
      case 'distant': return row.flags.includes('distant');
      case 'in-hand': return row.flags.includes('in-hand');
      case 'soft': return row.criteria.subjectClarity > 0 && row.criteria.subjectClarity <= SOFT_CLARITY_MAX;
      case 'marked-for-swap': return row.markedForSwap;
      case 'unscored': return !row.reviewed;
      // #969 gate: the judge's direct keep/replace. keep===false is the
      // needs-replacement set (a scored row only — null/undefined is not "needs swap").
      case 'needs-swap': return row.keep === false;
    }
  });

  // Sort (stable; null overall sorts last on score-based modes)
  const byOverallAsc = (a: OverviewRow, b: OverviewRow) => (a.overall ?? Infinity) - (b.overall ?? Infinity);
  const byOverallDesc = (a: OverviewRow, b: OverviewRow) => (b.overall ?? -Infinity) - (a.overall ?? -Infinity);
  switch (opts.sort) {
    case 'worst-first': rows.sort(byOverallAsc); break;
    case 'best-first': rows.sort(byOverallDesc); break;
    // #969: rank by the judge's own quality estimate, desc (nulls last).
    case 'quality-score':
      rows.sort((a, b) => (b.qualityScore ?? -Infinity) - (a.qualityScore ?? -Infinity));
      break;
    case 'recently-scored':
      rows.sort((a, b) => (b.scoredAt ?? '').localeCompare(a.scoredAt ?? ''));
      break;
    case 'has-better-candidate':
      rows.sort((a, b) => {
        const ga = a.bestCandidateOverall !== null && a.overall !== null ? a.bestCandidateOverall - a.overall : -Infinity;
        const gb = b.bestCandidateOverall !== null && b.overall !== null ? b.bestCandidateOverall - b.overall : -Infinity;
        return gb - ga;
      });
      break;
  }
  return rows;
}

export interface CandidateView {
  candidateId: number;     // photo_candidate.id
  inatId: number;
  photoUrl: string;
  thumbPath: string;
  attribution: string;
  license: string;
  overall: number | null;
  verdict: string | null;
  flags: string[];
  criteria: Criteria;
  rationale: string | null;
  sourceRound: number;
}

export interface CurrentView {
  url: string; attribution: string; license: string;
  overall: number | null; verdict: string | null;
  flags: string[]; criteria: Criteria; rationale: string | null;
}

export interface SwapView {
  speciesCode: string; comName: string; sciName: string; family: string;
  current: CurrentView;
  proposed: CandidateView | null;     // top-scored non-excluded candidate
  alternates: CandidateView[];        // all non-excluded candidates, votes/score desc
}

function parseFlags(s: string | null): string[] {
  if (!s) return [];
  try { return JSON.parse(s) as string[]; } catch { return []; }
}
function parseCriteria(s: string | null): Criteria {
  if (!s) return { ...ZERO_CRITERIA };
  try { return JSON.parse(s) as Criteria; } catch { return { ...ZERO_CRITERIA }; }
}

export function getSwapView(db: Database.Database, speciesCode: string): SwapView | null {
  const cur = db.prepare(`
    SELECT pc.com_name, pc.sci_name, pc.family, pc.url, pc.attribution, pc.license,
           ps.overall, ps.verdict, ps.criteria_json, ps.flags_json, ps.rationale
      FROM photo_current pc
      LEFT JOIN photo_score ps ON ps.species_code = pc.species_code AND ps.role = 'current'
     WHERE pc.species_code = ?
  `).get(speciesCode) as
    | { com_name: string; sci_name: string; family: string; url: string; attribution: string; license: string;
        overall: number | null; verdict: string | null; criteria_json: string | null; flags_json: string | null; rationale: string | null }
    | undefined;
  if (!cur) return null;

  const candRows = db.prepare(`
    SELECT cand.id AS candidate_id, cand.inat_id, cand.photo_url, cand.thumb_path,
           cand.attribution, cand.license, cand.source_round,
           cs.overall, cs.verdict, cs.criteria_json, cs.flags_json, cs.rationale
      FROM photo_candidate cand
      LEFT JOIN photo_score cs
        ON cs.species_code = cand.species_code
       AND cs.role = 'candidate'
       AND cs.candidate_inat_id = cand.inat_id
     WHERE cand.species_code = ? AND cand.excluded = 0
     ORDER BY cs.overall DESC, cand.inat_id ASC
  `).all(speciesCode) as {
    candidate_id: number; inat_id: number; photo_url: string; thumb_path: string;
    attribution: string; license: string; source_round: number;
    overall: number | null; verdict: string | null; criteria_json: string | null; flags_json: string | null; rationale: string | null;
  }[];

  const alternates: CandidateView[] = candRows.map(r => ({
    candidateId: r.candidate_id, inatId: r.inat_id, photoUrl: r.photo_url, thumbPath: r.thumb_path,
    attribution: r.attribution, license: r.license, overall: r.overall, verdict: r.verdict,
    flags: parseFlags(r.flags_json), criteria: parseCriteria(r.criteria_json),
    rationale: r.rationale, sourceRound: r.source_round,
  }));

  // `proposed` must be a SCORED candidate so the UI's proposed pick agrees with
  // denyAndAdvance, which only ever advances to an already-scored alternate
  // (overall NOT NULL). alternates[0] could be an unscored candidate (overall
  // null) — surfacing it as `proposed` would let the UI offer a replacement the
  // deny path would never advance to. Pick the top-ranked scored alternate; if
  // the pool is unscored-only, propose nothing until `source-candidates` scores
  // it. alternates is already ORDER BY cs.overall DESC, so the first one with a
  // non-null overall is the top scored candidate.
  const proposed = alternates.find(a => a.overall !== null) ?? null;

  return {
    speciesCode, comName: cur.com_name, sciName: cur.sci_name, family: cur.family,
    current: {
      url: cur.url, attribution: cur.attribution, license: cur.license,
      overall: cur.overall, verdict: cur.verdict,
      flags: parseFlags(cur.flags_json), criteria: parseCriteria(cur.criteria_json),
      rationale: cur.rationale,
    },
    proposed,
    alternates,
  };
}

export interface DecisionInput {
  speciesCode: string;
  action: 'approve' | 'keep' | 'deny' | 'pending';
  chosenCandidateId?: number;
  denyReason?: string;
  denyTags?: string[];
}

export function writeDecision(db: Database.Database, input: DecisionInput): void {
  db.prepare(`
    INSERT INTO photo_decision (species_code, action, chosen_candidate_id, deny_reason, deny_tags_json, decided_at, applied, applied_at)
    VALUES (@species_code, @action, @chosen_candidate_id, @deny_reason, @deny_tags_json, @decided_at, 0, NULL)
    ON CONFLICT(species_code) DO UPDATE SET
      action = excluded.action,
      chosen_candidate_id = excluded.chosen_candidate_id,
      deny_reason = excluded.deny_reason,
      deny_tags_json = excluded.deny_tags_json,
      decided_at = excluded.decided_at
  `).run({
    species_code: input.speciesCode,
    action: input.action,
    chosen_candidate_id: input.chosenCandidateId ?? null,
    deny_reason: input.denyReason ?? null,
    deny_tags_json: input.denyTags ? JSON.stringify(input.denyTags) : null,
    decided_at: new Date().toISOString(),
  });
}

export interface DenyInput {
  speciesCode: string;
  reason: string;
  tags: string[];        // quick-chip values: 'too-dark','wrong-sex-morph','still-distant','cluttered-background','captive-feeder','not-sharp'
  excludeIds: number[];  // iNat ids of the candidate(s) the reviewer just rejected (hide these)
}

export interface DenyResult {
  denyContext: DenyContext;            // reason/tags — the route logs it; the next source-candidates run consumes it
  next: CandidateView | null;          // next ALREADY-SCORED alternate from the pre-scored pool (instant advance)
  resourceRequested: boolean;          // true iff the pool was exhausted and resource_requested was set
}

/**
 * Deny → advance (R4, §5.4). The serve server can't score (plain Node, no
 * Claude Code agent); the candidate pool is pre-scored ahead of the session by
 * the `source-candidates` workflow. So Deny:
 *   1. records action='deny' + reason/tags,
 *   2. marks the shown candidate(s) (input.excludeIds) excluded=1,
 *   3. returns the next already-scored, non-excluded alternate (the common,
 *      instant case) — picked by the same ORDER BY getSwapView uses,
 *   4. only when NO scored alternate remains, sets photo_decision.resource_requested=1
 *      so a later `source-candidates` run fetches+scores a fresh deny-biased batch.
 * This function never sources or scores — no scoreAndCacheCandidates call here.
 * "Scored" means a matching photo_score(role='candidate') row exists (overall NOT NULL).
 */
export function denyAndAdvance(db: Database.Database, input: DenyInput): DenyResult {
  let next: CandidateView | null = null;
  let resourceRequested = false;

  const tx = db.transaction(() => {
    writeDecision(db, {
      speciesCode: input.speciesCode, action: 'deny',
      denyReason: input.reason, denyTags: input.tags,
    });
    if (input.excludeIds.length > 0) {
      const placeholders = input.excludeIds.map(() => '?').join(',');
      db.prepare(`UPDATE photo_candidate SET excluded = 1 WHERE species_code = ? AND inat_id IN (${placeholders})`)
        .run(input.speciesCode, ...input.excludeIds);
    }

    // Next already-scored, non-excluded alternate (INNER JOIN drops unscored candidates).
    const row = db.prepare(`
      SELECT cand.id AS candidate_id, cand.inat_id, cand.photo_url, cand.thumb_path,
             cand.attribution, cand.license, cand.source_round,
             cs.overall, cs.verdict, cs.criteria_json, cs.flags_json, cs.rationale
        FROM photo_candidate cand
        JOIN photo_score cs
          ON cs.species_code = cand.species_code
         AND cs.role = 'candidate'
         AND cs.candidate_inat_id = cand.inat_id
       WHERE cand.species_code = ? AND cand.excluded = 0 AND cs.overall IS NOT NULL
       ORDER BY cs.overall DESC, cand.inat_id ASC
       LIMIT 1
    `).get(input.speciesCode) as {
      candidate_id: number; inat_id: number; photo_url: string; thumb_path: string;
      attribution: string; license: string; source_round: number;
      overall: number | null; verdict: string | null; criteria_json: string | null; flags_json: string | null; rationale: string | null;
    } | undefined;

    if (row) {
      next = {
        candidateId: row.candidate_id, inatId: row.inat_id, photoUrl: row.photo_url, thumbPath: row.thumb_path,
        attribution: row.attribution, license: row.license, overall: row.overall, verdict: row.verdict,
        flags: parseFlags(row.flags_json), criteria: parseCriteria(row.criteria_json),
        rationale: row.rationale, sourceRound: row.source_round,
      };
    } else {
      // pool exhausted → queue a re-source for the next source-candidates run
      db.prepare(`UPDATE photo_decision SET resource_requested = 1 WHERE species_code = ?`).run(input.speciesCode);
      resourceRequested = true;
    }
  });
  tx();

  return { denyContext: { reason: input.reason, tags: input.tags }, next, resourceRequested };
}

export interface UnreviewedRow {
  speciesCode: string;
  comName: string;
  url: string;
}

/**
 * Batched-scoring cursor (R2): the next `limit` species awaiting the AI scoring
 * pass (photo_current.reviewed = 0). The `score` workflow scores these, then
 * calls markReviewed() per row. Deterministic order so re-runs are resumable.
 */
export function selectUnreviewed(db: Database.Database, limit: number): UnreviewedRow[] {
  const rows = db.prepare(`
    SELECT species_code, com_name, url
      FROM photo_current
     WHERE reviewed = 0
     ORDER BY species_code ASC
     LIMIT ?
  `).all(limit) as { species_code: string; com_name: string; url: string }[];
  return rows.map(r => ({ speciesCode: r.species_code, comName: r.com_name, url: r.url }));
}

/** Mark a species AI-scored (reviewed = 1) after the score workflow writes its row. */
export function markReviewed(db: Database.Database, speciesCode: string): void {
  db.prepare(`UPDATE photo_current SET reviewed = 1 WHERE species_code = ?`).run(speciesCode);
}
