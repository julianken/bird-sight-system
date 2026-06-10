import type Database from 'better-sqlite3';
import { markCandidatesExcluded } from './store.js';
// DenyContext is the Slice-3 sourcer's bias input — imported across the
// workspace boundary from the ingestor package (re-exported from its index).
import type { DenyContext } from '@bird-watch/ingestor';

export type DecisionAction = 'approve' | 'keep' | 'deny' | 'pending';

export interface Decision {
  speciesCode: string;
  action: DecisionAction;
  chosenCandidateId: number | null;
  denyReason: string | null;
  denyTags: string[];
  decidedAt: string | null;
  applied: boolean;
  appliedAt: string | null;
}

interface DecisionRow {
  species_code: string;
  action: DecisionAction;
  chosen_candidate_id: number | null;
  deny_reason: string | null;
  deny_tags_json: string | null;
  decided_at: string | null;
  applied: number;
  applied_at: string | null;
}

function rowToDecision(r: DecisionRow): Decision {
  return {
    speciesCode: r.species_code,
    action: r.action,
    chosenCandidateId: r.chosen_candidate_id,
    denyReason: r.deny_reason,
    denyTags: r.deny_tags_json ? (JSON.parse(r.deny_tags_json) as string[]) : [],
    decidedAt: r.decided_at,
    applied: r.applied === 1,
    appliedAt: r.applied_at,
  };
}

/** Read the staged decision; an untouched species reads as `pending`/unapplied. */
export function getDecision(db: Database.Database, speciesCode: string): Decision {
  const row = db.prepare(
    `SELECT * FROM photo_decision WHERE species_code=?`,
  ).get(speciesCode) as DecisionRow | undefined;
  if (!row) {
    return {
      speciesCode, action: 'pending', chosenCandidateId: null,
      denyReason: null, denyTags: [], decidedAt: null, applied: false, appliedAt: null,
    };
  }
  return rowToDecision(row);
}

/**
 * Upsert a decision row (PK species_code — re-deciding overwrites). Always
 * resets `applied=0`: a fresh decision must be re-applied. Only markApplied
 * sets `applied_at`.
 */
function upsertDecision(
  db: Database.Database,
  d: Pick<Decision, 'speciesCode' | 'action' | 'chosenCandidateId' | 'denyReason'> & { denyTags: string[] },
): void {
  db.prepare(
    `INSERT INTO photo_decision
       (species_code, action, chosen_candidate_id, deny_reason, deny_tags_json, decided_at, applied, applied_at)
     VALUES (@species_code, @action, @chosen_candidate_id, @deny_reason, @deny_tags_json, @decided_at, 0, NULL)
     ON CONFLICT(species_code) DO UPDATE SET
       action=excluded.action, chosen_candidate_id=excluded.chosen_candidate_id,
       deny_reason=excluded.deny_reason, deny_tags_json=excluded.deny_tags_json,
       decided_at=excluded.decided_at, applied=0, applied_at=NULL`,
  ).run({
    species_code: d.speciesCode,
    action: d.action,
    chosen_candidate_id: d.chosenCandidateId,
    deny_reason: d.denyReason,
    deny_tags_json: JSON.stringify(d.denyTags),
    decided_at: new Date().toISOString(),
  });
}

/** Stage an approval featuring `candidateInatId`. Nothing mutates prod until Slice-8 apply. */
export function stageApprove(db: Database.Database, speciesCode: string, candidateInatId: number): void {
  upsertDecision(db, {
    speciesCode, action: 'approve', chosenCandidateId: candidateInatId,
    denyReason: null, denyTags: [],
  });
}

/** Stage "keep the original" — no swap will be applied for this species. */
export function stageKeep(db: Database.Database, speciesCode: string): void {
  upsertDecision(db, {
    speciesCode, action: 'keep', chosenCandidateId: null, denyReason: null, denyTags: [],
  });
}

export interface DenyArgs {
  reason: string;
  tags: string[]; // quick-chips: 'too-dark','wrong-sex-morph','still-distant','cluttered-background','captive-feeder','not-sharp'
  shownInatIds: number[];
}

/**
 * Deny: record reason+tags, exclude the shown candidates so they never
 * re-appear, and return a DenyContext for the caller to feed into
 * fetchInatCandidates (Slice 3). The re-source itself (sources.ts →
 * scoreAndCacheCandidates) lands new candidates in a higher source_round; the
 * Slice-5 swap screen then refreshes.
 */
export function stageDeny(db: Database.Database, speciesCode: string, args: DenyArgs): DenyContext {
  upsertDecision(db, {
    speciesCode, action: 'deny', chosenCandidateId: null,
    denyReason: args.reason, denyTags: args.tags,
  });
  markCandidatesExcluded(db, speciesCode, args.shownInatIds);
  return { reason: args.reason, tags: args.tags };
}

/** Decisions ready to push: approved and not yet applied (consumed by Slice-8 apply-swaps). */
export function listPendingApplies(db: Database.Database): Decision[] {
  const rows = db.prepare(
    `SELECT * FROM photo_decision WHERE action='approve' AND applied=0 ORDER BY species_code`,
  ).all() as DecisionRow[];
  return rows.map(rowToDecision);
}

/** Mark a decision applied after a successful admin-endpoint call (Slice 8). */
export function markApplied(db: Database.Database, speciesCode: string): void {
  db.prepare(
    `UPDATE photo_decision SET applied=1, applied_at=? WHERE species_code=?`,
  ).run(new Date().toISOString(), speciesCode);
}
