import type Database from 'better-sqlite3';

export type SortMode = 'worst-first' | 'best-first' | 'has-better-candidate' | 'recently-scored';
export type FilterMode = 'all' | 'flagged' | 'dead-sick' | 'distant' | 'in-hand' | 'soft' | 'marked-for-swap' | 'unscored';

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
  overall: number | null;
  verdict: string | null;
  flags: string[];
  criteria: Criteria;
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
  return {
    speciesCode: r.species_code, comName: r.com_name, sciName: r.sci_name, family: r.family,
    url: r.url, attribution: r.attribution, license: r.license,
    overall: r.overall, verdict: r.verdict, flags, criteria,
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
    }
  });

  // Sort (stable; null overall sorts last on score-based modes)
  const byOverallAsc = (a: OverviewRow, b: OverviewRow) => (a.overall ?? Infinity) - (b.overall ?? Infinity);
  const byOverallDesc = (a: OverviewRow, b: OverviewRow) => (b.overall ?? -Infinity) - (a.overall ?? -Infinity);
  switch (opts.sort) {
    case 'worst-first': rows.sort(byOverallAsc); break;
    case 'best-first': rows.sort(byOverallDesc); break;
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
