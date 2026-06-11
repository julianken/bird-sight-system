import type Database from 'better-sqlite3';

// ─────────────────────────────────────────────────────────────────────────────
// Swap selection — two auto-gates + an operator override (swap-review v2).
//
// COMPUTED, not stored (except the operator override): this is a pure read over
// photo_current / photo_score / photo_candidate, plus the persisted operator
// pick in swap_selection. For every species the judge flagged for replacement
// (role='current' keep = 0) that HAS at least one scored, non-excluded candidate
// it picks a proposal through TWO auto-gates, then lets an operator override it:
//
//   1. Same-picture gate (cheapest dedup, no perceptual hash). bird-maps.com
//      sourced its live photos from iNaturalist, so iNat routinely returns the
//      BYTE-IDENTICAL image already live. A "swap" to the same bytes is never an
//      improvement, so any candidate whose content_hash equals the CURRENT
//      photo's content_hash is EXCLUDED from the pool before the best is picked.
//      If filtering leaves no candidate, the species is omitted (same as having
//      no candidates).
//   2. Minimum-improvement gate. Even a genuinely different photo is only a swap
//      when it clears the current by a real margin: the best NON-duplicate
//      candidate is proposed only when best − current >= MIN_IMPROVEMENT (20).
//      A marginal bump (Δ<20) keeps the original.
//
// Operator override (swap_selection): a curator can click a specific candidate
// on the pending-swaps page (POST /api/select-swap). When a swap_selection row
// exists for a species, it WINS over the auto gate: a chosen inat id makes that
// candidate the proposal (marked `operatorChosen`); an explicit NULL means
// "operator: no swap" (proposed = null). With no row, the two auto gates decide.
//
// It is the data behind the `/pending-swaps` screen and a pre-commit glance at
// what `apply-swaps` WOULD do. The compute writes nothing; only POST
// /api/select-swap mutates (the swap_selection row). The human approve/deny path
// (photo_decision) is unchanged.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Minimum quality_score margin (best − current) for the auto gate to propose a
 * swap. A candidate that beats the current by < MIN_IMPROVEMENT is a marginal
 * bump, not a swap, and the original is kept. Boundary is inclusive: Δ == 20
 * proposes; Δ == 19 does not.
 */
export const MIN_IMPROVEMENT = 20;

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
   * The proposal after both auto-gates AND any operator override:
   *   • operator override present (swap_selection row): the chosen candidate
   *     (with operatorChosen=true), or null for an explicit "operator: no swap".
   *   • no override: the best NON-duplicate candidate IFF it clears the current
   *     by best − current >= MIN_IMPROVEMENT (same-picture dups excluded first);
   *     otherwise null ("no improvement found — keep original").
   */
  proposed: SwapCandidate | null;
  /**
   * true iff the AUTO gate would propose a replacement — i.e. the best
   * non-duplicate candidate clears the current by Δ >= MIN_IMPROVEMENT. This is
   * the auto signal and is independent of any operator override (the page uses
   * it to show whether the current pick matches the auto recommendation).
   */
  outscores: boolean;
  /**
   * best(non-duplicate).qualityScore − current.qualityScore. Computed against
   * the best candidate AFTER same-picture dups are excluded (can be < 0 or <
   * MIN_IMPROVEMENT when no improvement clears the gate).
   */
  delta: number;
  /** true when `proposed` came from a persisted operator override, not the auto gate. */
  operatorChosen: boolean;
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
  /** The CURRENT photo's content hash — same-picture dups match on this. */
  cur_hash: string | null;
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
  /** The candidate's scored content hash — compared to cur_hash for the dedup gate. */
  content_hash: string | null;
}

/** A persisted operator override: chosen inat id (null = explicit "no swap"). */
interface SwapSelectionRow {
  species_code: string;
  chosen_inat_id: number | null;
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
 * least one scored, non-excluded, NON-DUPLICATE candidate. Reads photo_current /
 * photo_score / photo_candidate plus the persisted operator override in
 * swap_selection; writes nothing.
 *
 * Two auto-gates then an operator override decide `proposed`:
 *   1. Same-picture gate — every candidate whose content_hash equals the
 *      current photo's content_hash is dropped from the pool BEFORE the best is
 *      chosen (iNat byte-identical re-serve is never an improvement). If that
 *      leaves no candidate, the species is OMITTED (same as no candidates).
 *   2. Minimum-improvement gate — the best remaining candidate (highest
 *      quality_score, tie-broken by lowest inat id) is proposed by the auto gate
 *      ONLY when best − current >= MIN_IMPROVEMENT (20). A smaller margin keeps
 *      the original. `outscores` reflects THIS auto decision.
 *   3. Operator override — when a swap_selection row exists for the species it
 *      WINS: a chosen inat id is the proposal (operatorChosen=true); an explicit
 *      NULL chosen_inat_id is "operator: no swap" (proposed=null,
 *      operatorChosen=true). With no row, gate 2's auto proposal is used.
 */
export function selectSwaps(db: Database.Database, opts: SelectSwapsOpts = {}): SpeciesSwap[] {
  // keep=0 current rows, worst-current-first. The advisory `overall` is not the
  // gate; we order + compare on the judge's own quality_score (NULL last).
  // ps.content_hash AS cur_hash drives the same-picture dedup.
  const flagged = db.prepare(`
    SELECT pc.species_code, pc.com_name, pc.sci_name, pc.family,
           pc.url, pc.attribution, pc.license,
           ps.quality_score, ps.rationale, ps.field_marks,
           ps.content_hash AS cur_hash
      FROM photo_current pc
      JOIN photo_score ps
        ON ps.species_code = pc.species_code AND ps.role = 'current'
     WHERE ps.keep = 0
     ORDER BY ps.quality_score ASC, pc.species_code ASC
  `).all() as FlaggedCurrentRow[];

  // cs.content_hash surfaces the candidate's scored image hash so the
  // same-picture gate can compare it to the current photo's cur_hash.
  const candStmt = db.prepare(`
    SELECT cand.id AS candidate_id, cand.inat_id, cand.photo_url, cand.thumb_path,
           cand.attribution, cand.license,
           cs.quality_score, cs.rationale, cs.field_marks, cs.content_hash
      FROM photo_candidate cand
      JOIN photo_score cs
        ON cs.species_code = cand.species_code
       AND cs.role = 'candidate'
       AND cs.candidate_inat_id = cand.inat_id
     WHERE cand.species_code = ? AND cand.excluded = 0
     ORDER BY cs.quality_score DESC, cand.inat_id ASC
  `);

  // Operator overrides keyed by species_code. swap_selection may not exist on a
  // legacy store opened before this migration; treat a missing table as "no
  // overrides" so the readout still works (the page's POST path creates it).
  const overrides = readSwapSelections(db);

  const out: SpeciesSwap[] = [];
  for (const sp of flagged) {
    const allCandRows = candStmt.all(sp.species_code) as CandidateScoreRow[];

    // Gate 1 — same-picture dedup: drop any candidate byte-identical to the
    // live photo (content_hash == current cur_hash) BEFORE picking best.
    const candRows = sp.cur_hash
      ? allCandRows.filter(c => c.content_hash !== sp.cur_hash)
      : allCandRows;
    if (candRows.length === 0) continue; // omit: no non-duplicate candidate to choose from

    // candRows is best-first (quality_score DESC, inat_id ASC), so the first row
    // is the best NON-duplicate candidate with the deterministic tie-break.
    const currentScore = sp.quality_score ?? 0;
    const bestRow = candRows[0]!;
    const bestScore = bestRow.quality_score ?? 0;
    const delta = bestScore - currentScore;
    // Gate 2 — minimum-improvement: auto-propose only at Δ >= MIN_IMPROVEMENT.
    const outscores = delta >= MIN_IMPROVEMENT;
    const autoInatId = outscores ? bestRow.inat_id : null;

    // Gate 3 — operator override wins over the auto pick when a row exists.
    const override = overrides.get(sp.species_code);
    const operatorChosen = override !== undefined;
    // The override's chosen id must still be a live (non-excluded, non-dup)
    // candidate; if it no longer is, fall back to "no swap" rather than a stale id.
    const overrideInatId =
      override !== undefined && override.chosen_inat_id !== null &&
      candRows.some(c => c.inat_id === override.chosen_inat_id)
        ? override.chosen_inat_id
        : null;
    const proposedInatId = operatorChosen ? overrideInatId : autoInatId;

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
      delta,
      operatorChosen,
    });
  }

  const limit = opts.limit;
  if (typeof limit === 'number' && Number.isFinite(limit) && limit >= 0) {
    return out.slice(0, Math.floor(limit));
  }
  return out;
}

/**
 * Read all persisted operator overrides into a species_code → row map. A store
 * opened before the swap_selection migration has no such table; we detect that
 * (sqlite throws "no such table") and return an empty map so the readout still
 * computes the pure auto gates.
 */
function readSwapSelections(db: Database.Database): Map<string, SwapSelectionRow> {
  const map = new Map<string, SwapSelectionRow>();
  try {
    const rows = db.prepare(
      `SELECT species_code, chosen_inat_id FROM swap_selection`,
    ).all() as SwapSelectionRow[];
    for (const r of rows) map.set(r.species_code, r);
  } catch {
    // swap_selection table absent (legacy store) — no overrides.
  }
  return map;
}
