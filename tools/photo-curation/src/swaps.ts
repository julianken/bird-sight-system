import type Database from 'better-sqlite3';

// ─────────────────────────────────────────────────────────────────────────────
// Swap selection — the "outscores the original" gate (photo-swap epic).
//
// COMPUTED, not stored: this is a pure read over photo_current / photo_score /
// photo_candidate. For every species the judge flagged for replacement
// (role='current' keep = 0) that HAS at least one scored, non-excluded
// candidate, it picks the best candidate and proposes it ONLY when it strictly
// outscores the current photo's quality_score (a tie keeps the original).
//
// It is the data behind the read-only `/pending-swaps` readout: a pre-commit
// glance at what `apply-swaps` WOULD do. It writes nothing and decides nothing —
// the human approve/deny path (photo_decision) and `apply-swaps` are unchanged.
// ─────────────────────────────────────────────────────────────────────────────

/** The species' live (current) photo + its judge score. */
export interface SwapCurrent {
  photoUrl: string;
  attribution: string;
  license: string;
  /** The judge's 0–100 quality estimate — the number the gate compares against. */
  qualityScore: number | null;
  rationale: string | null;
  fieldMarks: string[];
}

/** One scored candidate, marked selected (the proposed pick) or rejected. */
export interface SwapCandidate {
  candidateId: number;     // photo_candidate.id
  inatId: number;
  photoUrl: string;
  thumbPath: string;
  attribution: string;
  license: string;
  qualityScore: number | null;
  rationale: string | null;
  fieldMarks: string[];
  /** true for the single proposed candidate; false for every rejected alternate. */
  selected: boolean;
}

export interface SpeciesSwap {
  speciesCode: string;
  comName: string;
  sciName: string;
  family: string;
  current: SwapCurrent;
  /** All scored, non-excluded candidates, best-first. Each marked selected/rejected. */
  candidates: SwapCandidate[];
  /**
   * The best candidate IFF it strictly outscores the current photo's
   * quality_score; otherwise null ("no improvement found — keep original").
   */
  proposed: SwapCandidate | null;
  /** true iff a proposed replacement exists (best.qualityScore > current). */
  outscores: boolean;
  /** best.qualityScore − current.qualityScore (can be ≤ 0 when no improvement). */
  delta: number;
}

export interface SelectSwapsOpts {
  /**
   * Cap how many species are returned, worst-current-first (quality_score ASC).
   * Undefined = all. Applied AFTER the has-scored-candidates filter, so the cap
   * counts only species that actually have a candidate pool.
   */
  limit?: number;
}

interface FlaggedCurrentRow {
  species_code: string;
  com_name: string | null;
  sci_name: string | null;
  family: string | null;
  url: string | null;
  attribution: string | null;
  license: string | null;
  quality_score: number | null;
  rationale: string | null;
  field_marks: string | null;
}

interface CandidateScoreRow {
  candidate_id: number;
  inat_id: number;
  photo_url: string | null;
  thumb_path: string | null;
  attribution: string | null;
  license: string | null;
  quality_score: number | null;
  rationale: string | null;
  field_marks: string | null;
}

function parseMarks(s: string | null): string[] {
  if (!s) return [];
  try {
    const v = JSON.parse(s) as unknown;
    return Array.isArray(v) ? (v as string[]) : [];
  } catch {
    return [];
  }
}

/**
 * Compute the per-species swap selection for every keep=0 species that has at
 * least one scored, non-excluded candidate. Pure read — writes nothing.
 *
 * The "outscores the original" rule: the best candidate (highest quality_score,
 * tie-broken by lowest inat id) is proposed ONLY when its quality_score is
 * strictly greater than the current photo's quality_score. A tie at the boundary
 * (best == current) is NOT proposed — the original is kept. Species with no
 * scored candidates are omitted.
 */
export function selectSwaps(db: Database.Database, opts: SelectSwapsOpts = {}): SpeciesSwap[] {
  // keep=0 current rows, worst-current-first. The advisory `overall` is not the
  // gate; we order + compare on the judge's own quality_score (NULL last).
  const flagged = db.prepare(`
    SELECT pc.species_code, pc.com_name, pc.sci_name, pc.family,
           pc.url, pc.attribution, pc.license,
           ps.quality_score, ps.rationale, ps.field_marks
      FROM photo_current pc
      JOIN photo_score ps
        ON ps.species_code = pc.species_code AND ps.role = 'current'
     WHERE ps.keep = 0
     ORDER BY ps.quality_score ASC, pc.species_code ASC
  `).all() as FlaggedCurrentRow[];

  const candStmt = db.prepare(`
    SELECT cand.id AS candidate_id, cand.inat_id, cand.photo_url, cand.thumb_path,
           cand.attribution, cand.license,
           cs.quality_score, cs.rationale, cs.field_marks
      FROM photo_candidate cand
      JOIN photo_score cs
        ON cs.species_code = cand.species_code
       AND cs.role = 'candidate'
       AND cs.candidate_inat_id = cand.inat_id
     WHERE cand.species_code = ? AND cand.excluded = 0
     ORDER BY cs.quality_score DESC, cand.inat_id ASC
  `);

  const out: SpeciesSwap[] = [];
  for (const sp of flagged) {
    const candRows = candStmt.all(sp.species_code) as CandidateScoreRow[];
    if (candRows.length === 0) continue; // omit: no scored candidates to choose from

    // candRows is already best-first (quality_score DESC, inat_id ASC), so the
    // first row is the best candidate with the deterministic tie-break baked in.
    const currentScore = sp.quality_score ?? 0;
    const bestRow = candRows[0]!;
    const bestScore = bestRow.quality_score ?? 0;
    const outscores = bestScore > currentScore;
    const proposedInatId = outscores ? bestRow.inat_id : null;

    const candidates: SwapCandidate[] = candRows.map(c => ({
      candidateId: c.candidate_id,
      inatId: c.inat_id,
      photoUrl: c.photo_url ?? '',
      thumbPath: c.thumb_path ?? '',
      attribution: c.attribution ?? '',
      license: c.license ?? '',
      qualityScore: c.quality_score,
      rationale: c.rationale,
      fieldMarks: parseMarks(c.field_marks),
      selected: c.inat_id === proposedInatId,
    }));

    const proposed = proposedInatId === null
      ? null
      : candidates.find(c => c.inatId === proposedInatId) ?? null;

    out.push({
      speciesCode: sp.species_code,
      comName: sp.com_name ?? '',
      sciName: sp.sci_name ?? '',
      family: sp.family ?? '',
      current: {
        photoUrl: sp.url ?? '',
        attribution: sp.attribution ?? '',
        license: sp.license ?? '',
        qualityScore: sp.quality_score,
        rationale: sp.rationale,
        fieldMarks: parseMarks(sp.field_marks),
      },
      candidates,
      proposed,
      outscores,
      delta: bestScore - currentScore,
    });
  }

  const limit = opts.limit;
  if (typeof limit === 'number' && Number.isFinite(limit) && limit >= 0) {
    return out.slice(0, Math.floor(limit));
  }
  return out;
}
