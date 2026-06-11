import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb } from './db.js';
import { upsertCurrentPhoto, upsertScore, insertCandidate, setSwapSelection } from './store.js';
import { selectSwaps } from './swaps.js';
import type { QualityReport } from '@bird-watch/photo-quality';

let db: Database.Database;
beforeEach(() => { db = openDb(':memory:'); });
afterEach(() => db.close());

function seedCurrent(code: string, comName: string, contentHash = `cur-${code}`): void {
  upsertCurrentPhoto(db, {
    speciesCode: code, comName, sciName: `Sci ${code}`, family: `Fam ${code}`,
    url: `https://photos.bird-maps.com/${code}.jpg`,
    attribution: `(c) Owner ${code}`, license: 'cc-by', contentHash,
  });
}

/**
 * A current-photo score row. keep=0 = needs replacement. The score's
 * content_hash (role='current') is the live image hash the same-picture gate
 * compares against; pass `contentHash` to match a seedCurrent dup hash.
 */
function seedCurrentScore(
  code: string, s: { keep: boolean; qualityScore: number; contentHash?: string },
): void {
  const report: QualityReport = {
    overall: s.qualityScore, verdict: s.keep ? 'good' : 'reject',
    deterministic: { width: 0, height: 0, megapixels: 0, sharpness: 0, exposure: 0, aspectRatio: 0, passedGate: true, failReasons: [] },
    criteria: { framing: 5, subjectClarity: 5, liveness: 5, naturalness: 5, pose: 5, background: 5, lighting: 5 },
    flags: [], fieldMarks: ['eye-ring'], keep: s.keep, qualityScore: s.qualityScore,
    rationale: `current ${code} rationale`, rubricVersion: '0.2.0',
  };
  upsertScore(db, {
    speciesCode: code, role: 'current', candidateInatId: null,
    contentHash: s.contentHash ?? `cur-${code}`, report,
  });
}

/** A candidate photo + its scored row (role='candidate'). */
function seedCandidate(
  code: string, inatId: number,
  s: { qualityScore: number; keep?: boolean; marks?: string[]; excluded?: boolean; contentHash?: string },
): void {
  const contentHash = s.contentHash ?? `cand-${code}-${inatId}`;
  insertCandidate(db, {
    speciesCode: code, inatId, photoUrl: `https://inaturalist-open-data.s3.amazonaws.com/${inatId}.jpg`,
    thumbPath: `thumb-cache/${code}-${inatId}.jpg`, attribution: `(c) iNat ${inatId}`,
    license: 'cc-by', sourceRound: 1,
  });
  if (s.excluded) {
    db.prepare(`UPDATE photo_candidate SET excluded=1 WHERE species_code=? AND inat_id=?`).run(code, inatId);
  }
  const report: QualityReport = {
    overall: s.qualityScore, verdict: 'good',
    deterministic: { width: 0, height: 0, megapixels: 0, sharpness: 0, exposure: 0, aspectRatio: 0, passedGate: true, failReasons: [] },
    criteria: { framing: 7, subjectClarity: 7, liveness: 7, naturalness: 7, pose: 7, background: 7, lighting: 7 },
    flags: [], fieldMarks: s.marks ?? ['wing bars'], keep: s.keep ?? true, qualityScore: s.qualityScore,
    rationale: `candidate ${inatId} rationale`, rubricVersion: '0.2.0',
  };
  upsertScore(db, { speciesCode: code, role: 'candidate', candidateInatId: inatId, contentHash, report });
}

describe('selectSwaps', () => {
  it('(a) the best candidate OUTSCORES the current → that candidate is proposed', () => {
    seedCurrent('housfi', 'House Finch');
    seedCurrentScore('housfi', { keep: false, qualityScore: 30 });
    seedCandidate('housfi', 100, { qualityScore: 55 });
    seedCandidate('housfi', 200, { qualityScore: 80 }); // best

    const results = selectSwaps(db);
    expect(results).toHaveLength(1);
    const r = results[0]!;
    expect(r.speciesCode).toBe('housfi');
    expect(r.comName).toBe('House Finch');

    // current carries its quality score + rationale + photo url.
    expect(r.current.qualityScore).toBe(30);
    expect(r.current.rationale).toBe('current housfi rationale');
    expect(r.current.photoUrl).toBe('https://photos.bird-maps.com/housfi.jpg');

    // best = the 80-scored candidate (200); proposed = best since 80 > 30.
    expect(r.proposed).not.toBeNull();
    expect(r.proposed!.inatId).toBe(200);
    expect(r.proposed!.qualityScore).toBe(80);
    expect(r.outscores).toBe(true);
    expect(r.delta).toBe(50); // 80 - 30

    // candidates: all candidates, each marked selected/rejected. 200 selected.
    expect(r.candidates.map(c => c.inatId).sort((a, b) => a - b)).toEqual([100, 200]);
    expect(r.candidates.find(c => c.inatId === 200)!.selected).toBe(true);
    expect(r.candidates.find(c => c.inatId === 100)!.selected).toBe(false);
    // candidate field marks + attribution surface for the readout.
    expect(r.candidates.find(c => c.inatId === 200)!.fieldMarks).toEqual(['wing bars']);
    expect(r.candidates.find(c => c.inatId === 200)!.attribution).toBe('(c) iNat 200');
  });

  it('(b) NO candidate outscores the current → proposed=null, outscores=false (keep original)', () => {
    seedCurrent('amerob', 'American Robin');
    seedCurrentScore('amerob', { keep: false, qualityScore: 60 });
    seedCandidate('amerob', 300, { qualityScore: 50 });
    seedCandidate('amerob', 400, { qualityScore: 55 }); // best candidate, still < 60

    const r = selectSwaps(db)[0]!;
    expect(r.proposed).toBeNull();
    expect(r.outscores).toBe(false);
    expect(r.delta).toBe(-5); // best(55) - current(60)
    // No candidate is selected when none outscores.
    expect(r.candidates.every(c => !c.selected)).toBe(true);
  });

  it('(c) a TIE at the boundary (best == current) is NOT proposed (strict >)', () => {
    seedCurrent('bewwre', "Bewick's Wren");
    seedCurrentScore('bewwre', { keep: false, qualityScore: 70 });
    seedCandidate('bewwre', 500, { qualityScore: 70 }); // exactly equal

    const r = selectSwaps(db)[0]!;
    expect(r.proposed).toBeNull();
    expect(r.outscores).toBe(false);
    expect(r.delta).toBe(0);
    expect(r.candidates.every(c => !c.selected)).toBe(true);
  });

  it('(d) a keep=0 species with NO scored candidates is OMITTED', () => {
    seedCurrent('withcand', 'With Cand');
    seedCurrentScore('withcand', { keep: false, qualityScore: 20 });
    seedCandidate('withcand', 600, { qualityScore: 75 });

    // keep=0 but no candidates sourced/scored yet — omitted.
    seedCurrent('nocand', 'No Cand');
    seedCurrentScore('nocand', { keep: false, qualityScore: 20 });

    const codes = selectSwaps(db).map(r => r.speciesCode);
    expect(codes).toContain('withcand');
    expect(codes).not.toContain('nocand');
  });

  it('excludes a kept (keep=1) species even if it has scored candidates', () => {
    seedCurrent('keepme', 'Keep Me');
    seedCurrentScore('keepme', { keep: true, qualityScore: 40 });
    seedCandidate('keepme', 700, { qualityScore: 90 });

    expect(selectSwaps(db).map(r => r.speciesCode)).not.toContain('keepme');
  });

  it('ignores EXCLUDED candidates when picking best/proposed', () => {
    seedCurrent('exsp', 'Excluded Sp');
    seedCurrentScore('exsp', { keep: false, qualityScore: 30 });
    seedCandidate('exsp', 800, { qualityScore: 90, excluded: true }); // denied earlier
    seedCandidate('exsp', 900, { qualityScore: 55 }); // Δ25 ≥ 20 → proposed

    const r = selectSwaps(db)[0]!;
    // 800 excluded → best is 900; proposed because 55 − 30 = 25 ≥ MIN_IMPROVEMENT.
    expect(r.proposed!.inatId).toBe(900);
    expect(r.candidates.map(c => c.inatId)).toEqual([900]);
  });

  it('tie-breaks equal-top candidates deterministically by lowest inat id', () => {
    seedCurrent('tiesp', 'Tie Sp');
    seedCurrentScore('tiesp', { keep: false, qualityScore: 30 });
    seedCandidate('tiesp', 1200, { qualityScore: 80 });
    seedCandidate('tiesp', 1100, { qualityScore: 80 }); // same score, lower id → wins

    const r = selectSwaps(db)[0]!;
    expect(r.proposed!.inatId).toBe(1100);
  });

  // ── Swap-review v2 gates (same-picture dedup + minimum-improvement Δ≥20) ──

  it('(g1) EXCLUDES a same-picture candidate (content_hash == current) and never proposes it', () => {
    seedCurrent('dupsp', 'Dup Sp', 'samehash');
    seedCurrentScore('dupsp', { keep: false, qualityScore: 30, contentHash: 'samehash' });
    // 100 is byte-identical to the live photo (iNat returned the image already live).
    // Even though it scores far above the current, it is never a real improvement.
    seedCandidate('dupsp', 100, { qualityScore: 95, contentHash: 'samehash' });
    // 200 is a genuinely different photo that clears the Δ≥20 gate.
    seedCandidate('dupsp', 200, { qualityScore: 60, contentHash: 'otherhash' });

    const r = selectSwaps(db)[0]!;
    // The same-picture dup is filtered out entirely — not in candidates, not proposed.
    expect(r.candidates.map(c => c.inatId)).toEqual([200]);
    expect(r.proposed!.inatId).toBe(200);
    expect(r.delta).toBe(30); // 60 − 30, computed against the non-dup best
  });

  it('(g2) a species whose ONLY candidate is the same-picture dup is OMITTED entirely', () => {
    seedCurrent('onlydup', 'Only Dup', 'samebytes');
    seedCurrentScore('onlydup', { keep: false, qualityScore: 20, contentHash: 'samebytes' });
    seedCandidate('onlydup', 300, { qualityScore: 90, contentHash: 'samebytes' });

    // After filtering the dup, no candidate remains → omitted (same as no-candidates).
    expect(selectSwaps(db).map(r => r.speciesCode)).not.toContain('onlydup');
  });

  it('(g3) Δ boundary: a candidate beating current by exactly 19 is NOT proposed; by exactly 20 IS', () => {
    // current 50; best candidate 69 → Δ19 < MIN_IMPROVEMENT(20) → not proposed.
    seedCurrent('d19', 'Delta 19');
    seedCurrentScore('d19', { keep: false, qualityScore: 50 });
    seedCandidate('d19', 400, { qualityScore: 69 });

    const r19 = selectSwaps(db).find(r => r.speciesCode === 'd19')!;
    expect(r19.proposed).toBeNull();
    expect(r19.outscores).toBe(false);
    expect(r19.delta).toBe(19);
    expect(r19.candidates.every(c => !c.selected)).toBe(true);

    // current 50; best candidate 70 → Δ20 == MIN_IMPROVEMENT → proposed.
    seedCurrent('d20', 'Delta 20');
    seedCurrentScore('d20', { keep: false, qualityScore: 50 });
    seedCandidate('d20', 500, { qualityScore: 70 });

    const r20 = selectSwaps(db).find(r => r.speciesCode === 'd20')!;
    expect(r20.proposed!.inatId).toBe(500);
    expect(r20.outscores).toBe(true);
    expect(r20.delta).toBe(20);
  });

  it('(g4) compares against the best NON-duplicate candidate, not the global best when the global best is a dup', () => {
    seedCurrent('nondup', 'Non Dup', 'liveimg');
    seedCurrentScore('nondup', { keep: false, qualityScore: 30, contentHash: 'liveimg' });
    // Global best (95) is the same-picture dup → excluded. Best non-dup is 700 (58).
    seedCandidate('nondup', 600, { qualityScore: 95, contentHash: 'liveimg' });
    seedCandidate('nondup', 700, { qualityScore: 58, contentHash: 'fresh-a' });
    seedCandidate('nondup', 800, { qualityScore: 40, contentHash: 'fresh-b' });

    const r = selectSwaps(db)[0]!;
    // 700 (best non-dup) is the comparison + the proposal, NOT the 95 dup.
    expect(r.proposed!.inatId).toBe(700);
    expect(r.delta).toBe(28); // 58 − 30
    expect(r.candidates.map(c => c.inatId).sort((a, b) => a - b)).toEqual([700, 800]);
  });

  // ── Operator override (swap_selection) ──

  it('(o1) an operator override WINS over the auto best (proposes the chosen candidate, marks operatorChosen)', () => {
    seedCurrent('ovr', 'Override Sp');
    seedCurrentScore('ovr', { keep: false, qualityScore: 30 });
    seedCandidate('ovr', 100, { qualityScore: 90 }); // auto-best (Δ60)
    seedCandidate('ovr', 200, { qualityScore: 55 }); // operator's pick

    // No override → auto picks the 90.
    expect(selectSwaps(db)[0]!.proposed!.inatId).toBe(100);
    expect(selectSwaps(db)[0]!.operatorChosen).toBe(false);

    // Operator overrides to 200; it now wins despite the 90 being the auto-best.
    setSwapSelection(db, 'ovr', 200);
    const r = selectSwaps(db)[0]!;
    expect(r.proposed!.inatId).toBe(200);
    expect(r.operatorChosen).toBe(true);
    // `outscores` still reflects the AUTO signal (auto-best 90 clears Δ20).
    expect(r.outscores).toBe(true);
    expect(r.candidates.find(c => c.inatId === 200)!.selected).toBe(true);
    expect(r.candidates.find(c => c.inatId === 100)!.selected).toBe(false);
  });

  it('(o2) an explicit NULL override is "operator: no swap" (proposed=null, operatorChosen=true)', () => {
    seedCurrent('nosw', 'No Swap Sp');
    seedCurrentScore('nosw', { keep: false, qualityScore: 30 });
    seedCandidate('nosw', 300, { qualityScore: 90 }); // auto would propose this

    setSwapSelection(db, 'nosw', null);
    const r = selectSwaps(db)[0]!;
    expect(r.proposed).toBeNull();
    expect(r.operatorChosen).toBe(true);
    expect(r.candidates.every(c => !c.selected)).toBe(true);
  });

  it('orders species worst-current-first (quality_score ASC) and honors an optional limit', () => {
    seedCurrent('w', 'Worst'); seedCurrentScore('w', { keep: false, qualityScore: 10 }); seedCandidate('w', 1, { qualityScore: 60 });
    seedCurrent('m', 'Mid'); seedCurrentScore('m', { keep: false, qualityScore: 40 }); seedCandidate('m', 2, { qualityScore: 60 });
    seedCurrent('b', 'Best'); seedCurrentScore('b', { keep: false, qualityScore: 70 }); seedCandidate('b', 3, { qualityScore: 90 });

    const all = selectSwaps(db);
    expect(all.map(r => r.speciesCode)).toEqual(['w', 'm', 'b']);

    // limit=2 → only the two worst-current species, still worst-first.
    const limited = selectSwaps(db, { limit: 2 });
    expect(limited.map(r => r.speciesCode)).toEqual(['w', 'm']);
  });
});
