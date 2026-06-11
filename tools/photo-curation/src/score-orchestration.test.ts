import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { openDb } from './db.js';
import { upsertCurrentPhoto, upsertScore, getScoreByHash, selectUnreviewed, listCandidates, updateCurrentPhotoHash, getSourceAttempt, recordSourceAttempt } from './store.js';
import { sha8 } from './hash.js';
import {
  scorePrepare, scoreCommit, sourcePrepare, sourceCommit,
} from './score-orchestration.js';
import type { ScoreResult, SourceResult } from './score-orchestration.js';
import { makeFakeClock } from './test-clock.js';
import type { DeterministicReport, ImageInput, QualityReport, RubricConfig } from '@bird-watch/photo-quality';

/** A deterministic-gate stub that PASSES every image (default prepare behaviour). */
function passGate(): DeterministicReport {
  return { width: 1200, height: 1000, megapixels: 1.2, sharpness: 0.5, exposure: 0.9, aspectRatio: 1.2, passedGate: true, failReasons: [] };
}

/** A deterministic-gate stub that FAILS the given image (tiny / blurry / wrong-aspect). */
function failGate(reasons: string[] = ['below-min-megapixels']): DeterministicReport {
  return { width: 100, height: 100, megapixels: 0.01, sharpness: 0, exposure: 0, aspectRatio: 1, passedGate: false, failReasons: reasons };
}

// Instant clock so the prepare paths never incur a real ≥1.1 s pacing wait in
// the fast unit suite (the spacing itself is asserted in the dedicated pacing
// tests with a recording fake clock).
const instant = () => makeFakeClock();

let db: Database.Database;
let workDir: string;
beforeEach(() => {
  db = openDb(':memory:');
  workDir = mkdtempSync(join(tmpdir(), 'photo-curate-'));
});
afterEach(() => {
  db.close();
  rmSync(workDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function seedCurrent(code: string, url: string): void {
  upsertCurrentPhoto(db, {
    speciesCode: code, comName: code.toUpperCase(), sciName: `Sci ${code}`,
    family: `Fam ${code}`, url,
    attribution: '(c) Jane Doe (CC BY)', license: 'cc-by', contentHash: '',
  });
}

describe('scorePrepare (Node, testable — Bug 1)', () => {
  it('selects the next N reviewed=0 rows, downloads each, writes a manifest, and clamps the limit', async () => {
    seedCurrent('aaa', 'https://photos.example/aaa.jpg');
    seedCurrent('bbb', 'https://photos.example/bbb.png');
    seedCurrent('ccc', 'https://photos.example/ccc.jpg');

    // Stub download: distinct bytes per url so contentHashes differ.
    const download = vi.fn(async (url: string) => Buffer.from(url));

    // limit 0 clamps up to 1 → only the oldest-by-code row (aaa). Gate passes so
    // this test stays focused on the download/manifest behaviour (no sharp decode).
    const result = await scorePrepare(db, 0, { download, thumbDir: workDir, clock: instant(), assessDeterministic: async () => passGate() });
    expect(result.picked).toBe(1);
    expect(existsSync(result.manifestPath)).toBe(true);

    const manifest = JSON.parse(readFileSync(result.manifestPath, 'utf8')) as Array<{
      speciesCode: string; comName: string; sciName: string; family: string;
      imagePath: string; contentHash: string;
    }>;
    expect(manifest).toHaveLength(1);
    expect(manifest[0]!.speciesCode).toBe('aaa');
    expect(manifest[0]!.comName).toBe('AAA');
    expect(manifest[0]!.sciName).toBe('Sci aaa');
    expect(manifest[0]!.family).toBe('Fam aaa');
    // The image was written to disk at the manifest path, extension from the url.
    expect(manifest[0]!.imagePath).toBe(join(workDir, 'aaa.jpg'));
    expect(existsSync(manifest[0]!.imagePath)).toBe(true);
    expect(manifest[0]!.contentHash).toMatch(/^[0-9a-f]{8}$/);

    // download was called exactly once (one row picked).
    expect(download).toHaveBeenCalledTimes(1);

    // The content hash was stamped into photo_current so score-commit can read it.
    const row = db.prepare(`SELECT content_hash FROM photo_current WHERE species_code=?`).get('aaa') as { content_hash: string };
    expect(row.content_hash).toBe(manifest[0]!.contentHash);
    // The row is NOT yet reviewed — score-commit marks it.
    expect(selectUnreviewed(db, 10).map(r => r.species_code)).toContain('aaa');
  });

  it('uses the correct file extension from the photo url (png/webp/jpg)', async () => {
    seedCurrent('pngsp', 'https://photos.example/pngsp.png');
    const download = vi.fn(async () => Buffer.from('png-bytes'));
    const result = await scorePrepare(db, 1, { download, thumbDir: workDir, clock: instant(), assessDeterministic: async () => passGate() });
    const manifest = JSON.parse(readFileSync(result.manifestPath, 'utf8')) as Array<{ imagePath: string }>;
    expect(manifest[0]!.imagePath).toBe(join(workDir, 'pngsp.png'));
  });
});

describe('scoreCommit (Node, testable — Bug 1)', () => {
  it('composes the report, upserts the score (role=current), and marks the species reviewed', async () => {
    seedCurrent('aaa', 'https://photos.example/aaa.jpg');
    // Simulate a prepare pass having stamped the content hash (gate passes).
    const download = vi.fn(async (url: string) => Buffer.from(url));
    await scorePrepare(db, 1, { download, thumbDir: workDir, clock: instant(), assessDeterministic: async () => passGate() });
    const hash = (db.prepare(`SELECT content_hash FROM photo_current WHERE species_code=?`).get('aaa') as { content_hash: string }).content_hash;

    // A strong photo → 'great'/'good'; a flagged one → capped reject.
    const results: ScoreResult[] = [
      {
        speciesCode: 'aaa',
        fieldMarks: ['rufous breast', 'gray head'],
        criteria: { framing: 9, subjectClarity: 10, liveness: 10, naturalness: 9, pose: 8, background: 8, lighting: 9 },
        flags: [],
        keep: true,
        qualityScore: 90,
        rationale: 'Tack-sharp wild adult on a natural perch.',
      },
    ];
    const summary = await scoreCommit(db, results);
    expect(summary.committed).toBe(1);
    expect(summary.failed).toBe(0);

    // Score row written with role=current, keyed by the stamped content hash.
    const stored = getScoreByHash(db, 'aaa', 'current', hash);
    expect(stored).not.toBeNull();
    expect(stored!.overall).toBeGreaterThan(0);
    expect(['great', 'good']).toContain(stored!.verdict);
    // #969: the gate (keep), qualityScore, and fieldMarks all persist.
    expect(stored!.keep).toBe(true);
    expect(stored!.qualityScore).toBe(90);
    expect(stored!.fieldMarks).toEqual(['rufous breast', 'gray head']);
    expect(stored!.rationale).toBe('Tack-sharp wild adult on a natural perch.');

    // The species is now reviewed (cleared from the backlog).
    expect(selectUnreviewed(db, 10)).toEqual([]);
  });

  it('applies disqualifier caps via composeReport (a flagged photo is capped low)', async () => {
    seedCurrent('inhand', 'https://photos.example/inhand.jpg');
    const download = vi.fn(async (url: string) => Buffer.from(url));
    await scorePrepare(db, 1, { download, thumbDir: workDir, clock: instant(), assessDeterministic: async () => passGate() });
    const hash = (db.prepare(`SELECT content_hash FROM photo_current WHERE species_code=?`).get('inhand') as { content_hash: string }).content_hash;

    // High sub-scores but an 'in-hand' flag → capped to a reject-ish overall.
    const results: ScoreResult[] = [
      {
        speciesCode: 'inhand',
        fieldMarks: ['streaked flanks'],
        criteria: { framing: 9, subjectClarity: 10, liveness: 10, naturalness: 2, pose: 9, background: 9, lighting: 9 },
        flags: ['in-hand'],
        keep: false,
        qualityScore: 35,
        rationale: 'Sharp but held in a banding grip — not a field-guide photo.',
      },
    ];
    await scoreCommit(db, results);
    const stored = getScoreByHash(db, 'inhand', 'current', hash);
    expect(stored).not.toBeNull();
    // in-hand caps overall at 35 (defaultRubricConfig disqualifiers).
    expect(stored!.overall).toBeLessThanOrEqual(35);
    expect(stored!.flags).toContain('in-hand');
  });

  it('GATE is the judge keep, not the composite: a HIGH-composite result with keep:false stores keep=false (needs replacement)', async () => {
    seedCurrent('hidden', 'https://photos.example/hidden.jpg');
    const download = vi.fn(async (url: string) => Buffer.from(url));
    await scorePrepare(db, 1, { download, thumbDir: workDir, clock: instant(), assessDeterministic: async () => passGate() });
    const hash = (db.prepare(`SELECT content_hash FROM photo_current WHERE species_code=?`).get('hidden') as { content_hash: string }).content_hash;

    // Tack-sharp, well-framed (great composite) but the judge said replace —
    // diagnostic marks hidden by pose. The stored gate must be keep=false even
    // though overall is auto-accept-high.
    const results: ScoreResult[] = [
      {
        speciesCode: 'hidden',
        fieldMarks: ['undertail pattern (NOT visible — tail-on)'],
        criteria: { framing: 9, subjectClarity: 10, liveness: 10, naturalness: 9, pose: 9, background: 9, lighting: 9 },
        flags: [],
        keep: false,
        qualityScore: 40,
        rationale: 'Sharp but tail-on — the diagnostic undertail pattern is not readable.',
      },
    ];
    await scoreCommit(db, results);
    const stored = getScoreByHash(db, 'hidden', 'current', hash);
    expect(stored).not.toBeNull();
    expect(stored!.overall).toBeGreaterThanOrEqual(75); // high composite (ranking)
    expect(stored!.keep).toBe(false);                   // but the gate says replace
    expect(stored!.qualityScore).toBe(40);
  });

  it('GATE is the judge keep, not the composite: a LOW-composite result with keep:true stores keep=true (kept)', async () => {
    seedCurrent('okay', 'https://photos.example/okay.jpg');
    const download = vi.fn(async (url: string) => Buffer.from(url));
    await scorePrepare(db, 1, { download, thumbDir: workDir, clock: instant(), assessDeterministic: async () => passGate() });
    const hash = (db.prepare(`SELECT content_hash FROM photo_current WHERE species_code=?`).get('okay') as { content_hash: string }).content_hash;

    // Mediocre sub-scores (low composite) but the judge kept it — marks readable.
    const results: ScoreResult[] = [
      {
        speciesCode: 'okay',
        fieldMarks: ['eye-ring', 'wing bars'],
        criteria: { framing: 5, subjectClarity: 5, liveness: 6, naturalness: 5, pose: 5, background: 4, lighting: 4 },
        flags: [],
        keep: true,
        qualityScore: 60,
        rationale: 'Soft snapshot but the eye-ring and wing bars are clearly readable.',
      },
    ];
    await scoreCommit(db, results);
    const stored = getScoreByHash(db, 'okay', 'current', hash);
    expect(stored).not.toBeNull();
    expect(stored!.overall).toBeLessThan(75); // low composite (ranking)
    expect(stored!.keep).toBe(true);          // but the gate kept it
  });

  it('records a failure for a result whose species has no photo_current row', async () => {
    const results: ScoreResult[] = [
      {
        speciesCode: 'ghost',
        fieldMarks: [],
        criteria: { framing: 5, subjectClarity: 5, liveness: 5, naturalness: 5, pose: 5, background: 5, lighting: 5 },
        flags: [],
        keep: true,
        qualityScore: 50,
        rationale: 'n/a',
      },
    ];
    const summary = await scoreCommit(db, results);
    expect(summary.committed).toBe(0);
    expect(summary.failed).toBe(1);
    expect(summary.errors[0]!.speciesCode).toBe('ghost');
  });
});

/** A flagged (below-review) current score so source-prepare picks the species. */
function seedFlaggedScore(code: string): void {
  const report: QualityReport = {
    overall: 30, verdict: 'reject',
    deterministic: { width: 0, height: 0, megapixels: 0, sharpness: 0, exposure: 0, aspectRatio: 0, passedGate: true, failReasons: [] },
    criteria: { framing: 3, subjectClarity: 3, liveness: 5, naturalness: 4, pose: 3, background: 3, lighting: 3 },
    flags: [], fieldMarks: [], keep: false, qualityScore: 30,
    rationale: 'soft + cluttered', rubricVersion: '0.2.0',
  };
  upsertScore(db, { speciesCode: code, role: 'current', candidateInatId: null, contentHash: 'cur00000', report });
}

/**
 * Seed a current-role score with an INDEPENDENTLY chosen composite (`overall`)
 * and gate (`keep`) so a test can construct the field-mark failure mode: HIGH
 * composite + keep=0 (PR #1004). content_hash is derived from the code so each
 * species gets its own row.
 */
function seedScore(code: string, s: { overall: number; keep: boolean; qualityScore: number }): void {
  const report: QualityReport = {
    overall: s.overall, verdict: s.keep ? 'good' : 'reject',
    deterministic: { width: 0, height: 0, megapixels: 0, sharpness: 0, exposure: 0, aspectRatio: 0, passedGate: true, failReasons: [] },
    criteria: { framing: 5, subjectClarity: 5, liveness: 5, naturalness: 5, pose: 5, background: 5, lighting: 5 },
    flags: [], fieldMarks: [], keep: s.keep, qualityScore: s.qualityScore,
    rationale: 'seed', rubricVersion: '0.2.0',
  };
  upsertScore(db, { speciesCode: code, role: 'current', candidateInatId: null, contentHash: `cur-${code}`, report });
}

describe('sourcePrepare (Node, testable — Bug 1 source-candidates split)', () => {
  it('fetches iNat candidates for FLAGGED species, downloads each, inserts candidate rows, and writes a manifest', async () => {
    seedCurrent('flag1', 'https://photos.example/flag1.jpg');
    seedFlaggedScore('flag1');
    // A second species that is NOT flagged (no below-review score) must be skipped.
    seedCurrent('good1', 'https://photos.example/good1.jpg');

    const fetchInatCandidates = vi.fn(async () => [
      { inatId: 11, photoUrl: 'https://inat.example/11.jpg', attribution: '(c) P (CC BY)', license: 'cc-by' },
      { inatId: 12, photoUrl: 'https://inat.example/12.png', attribution: '(c) Q (CC0)', license: 'cc0' },
    ]);
    const download = vi.fn(async (url: string) => Buffer.from(url));

    const result = await sourcePrepare(db, 5, { fetchInatCandidates, download, thumbDir: workDir, clock: instant() });
    // Only the flagged species was sourced.
    expect(fetchInatCandidates).toHaveBeenCalledTimes(1);
    expect(result.picked).toBe(2); // two candidates for flag1
    expect(existsSync(result.manifestPath)).toBe(true);

    const manifest = JSON.parse(readFileSync(result.manifestPath, 'utf8')) as Array<{
      speciesCode: string; inatId: number; imagePath: string; contentHash: string;
      attribution: string; license: string;
    }>;
    expect(manifest).toHaveLength(2);
    expect(manifest.map(m => m.inatId).sort()).toEqual([11, 12]);
    expect(manifest.every(m => m.speciesCode === 'flag1')).toBe(true);
    expect(manifest.every(m => existsSync(m.imagePath))).toBe(true);
    expect(manifest.find(m => m.inatId === 12)!.imagePath).toBe(join(workDir, 'flag1-12.png'));

    // Candidate rows were persisted (so the deny-loop can advance to them).
    const cands = listCandidates(db, 'flag1');
    expect(cands.map(c => c.inatId).sort()).toEqual([11, 12]);
  });

  // PR #1004: source-prepare's flagged-species predicate must MATCH the review
  // server's `needs-swap` filter (queries.ts: keep === false), NOT the advisory
  // composite threshold. The headline failure mode this guards: a technically
  // sharp photo with hidden field marks (HIGH overall but keep=0) appears in the
  // reviewer's needs-swap queue yet, on the old `overall < review` predicate,
  // would never get candidates sourced → empty pool.
  it('keys sourcing on the gate (keep=0), not the composite: sources a HIGH-composite keep=0 species and SKIPS a keep=1 species regardless of composite', async () => {
    // (a) HIGH composite (90) but the gate flagged it for replacement (keep=0):
    //     hidden field marks. This MUST be sourced — the old `overall < review`
    //     predicate would have excluded it (the bug PR #1004 fixes).
    seedCurrent('sharp1', 'https://photos.example/sharp1.jpg');
    seedScore('sharp1', { overall: 90, keep: false, qualityScore: 88 });
    // (b) LOW composite (20) but the gate KEPT it (keep=1): we're keeping it, so
    //     it must NOT be re-sourced even though the old composite predicate would
    //     have flagged it.
    seedCurrent('keep1', 'https://photos.example/keep1.jpg');
    seedScore('keep1', { overall: 20, keep: true, qualityScore: 25 });

    const fetchInatCandidates = vi.fn(async () => [
      { inatId: 21, photoUrl: 'https://inat.example/21.jpg', attribution: '(c) P (CC BY)', license: 'cc-by' },
    ]);
    const download = vi.fn(async (url: string) => Buffer.from(url));

    const result = await sourcePrepare(db, 5, { fetchInatCandidates, download, thumbDir: workDir, clock: instant() });

    // Exactly one species sourced — the keep=0 one — and only for it.
    expect(fetchInatCandidates).toHaveBeenCalledTimes(1);
    const manifest = JSON.parse(readFileSync(result.manifestPath, 'utf8')) as Array<{ speciesCode: string }>;
    expect(manifest.every(m => m.speciesCode === 'sharp1')).toBe(true);
    expect(listCandidates(db, 'sharp1').map(c => c.inatId)).toEqual([21]);
    // The kept (keep=1) species got NO candidates sourced, low composite notwithstanding.
    expect(listCandidates(db, 'keep1')).toHaveLength(0);
  });

  // Photo-swap epic: a species `--limit <n>` caps how many keep=0 species are
  // sourced per run (so an operator can source the N worst before scoring),
  // honoring the existing worst-first order (quality_score ASC, species_code ASC).
  // No limit (the default) = ALL keep=0 species (backward-compatible).
  it('species --limit sources only the N WORST-scored keep=0 species (quality_score ASC), leaving the rest untouched', async () => {
    // Three flagged (keep=0) species with distinct quality scores. Worst → best:
    // worst(10) < mid(40) < best(70). A fourth species is kept (keep=1) — never
    // a candidate for sourcing regardless of limit.
    seedCurrent('worst', 'https://photos.example/worst.jpg'); seedScore('worst', { overall: 10, keep: false, qualityScore: 10 });
    seedCurrent('mid', 'https://photos.example/mid.jpg'); seedScore('mid', { overall: 40, keep: false, qualityScore: 40 });
    seedCurrent('best', 'https://photos.example/best.jpg'); seedScore('best', { overall: 70, keep: false, qualityScore: 70 });
    seedCurrent('kept', 'https://photos.example/kept.jpg'); seedScore('kept', { overall: 20, keep: true, qualityScore: 25 });

    const fetchInatCandidates = vi.fn(async (sci: string) => {
      const id = sci.includes('worst') ? 1 : sci.includes('mid') ? 2 : 3;
      return [{ inatId: id, photoUrl: `https://inat.example/${id}.jpg`, attribution: '(c) P (CC BY)', license: 'cc-by' }];
    });
    const download = vi.fn(async (url: string) => Buffer.from(url));

    // limit 2 → only the two worst keep=0 species (worst=10, mid=40) are sourced.
    const result = await sourcePrepare(db, 5, { fetchInatCandidates, download, thumbDir: workDir, clock: instant() }, { limit: 2 });
    expect(fetchInatCandidates).toHaveBeenCalledTimes(2);
    const manifest = JSON.parse(readFileSync(result.manifestPath, 'utf8')) as Array<{ speciesCode: string }>;
    expect([...new Set(manifest.map(m => m.speciesCode))].sort()).toEqual(['mid', 'worst']);
    // The best-scored keep=0 species (just outside the limit) got NO candidates.
    expect(listCandidates(db, 'best')).toHaveLength(0);
    // The kept species is never sourced.
    expect(listCandidates(db, 'kept')).toHaveLength(0);
  });

  it('no species limit (default) sources ALL keep=0 species — backward-compatible', async () => {
    seedCurrent('a', 'https://photos.example/a.jpg'); seedScore('a', { overall: 10, keep: false, qualityScore: 10 });
    seedCurrent('b', 'https://photos.example/b.jpg'); seedScore('b', { overall: 40, keep: false, qualityScore: 40 });
    seedCurrent('c', 'https://photos.example/c.jpg'); seedScore('c', { overall: 70, keep: false, qualityScore: 70 });

    const fetchInatCandidates = vi.fn(async (sci: string) => {
      const id = sci.includes('a') ? 1 : sci.includes('b') ? 2 : 3;
      return [{ inatId: id, photoUrl: `https://inat.example/${id}.jpg`, attribution: '(c) P (CC BY)', license: 'cc-by' }];
    });
    const download = vi.fn(async (url: string) => Buffer.from(url));

    // No opts → every keep=0 species sourced (3 fetches).
    const result = await sourcePrepare(db, 5, { fetchInatCandidates, download, thumbDir: workDir, clock: instant() });
    expect(fetchInatCandidates).toHaveBeenCalledTimes(3);
    const manifest = JSON.parse(readFileSync(result.manifestPath, 'utf8')) as Array<{ speciesCode: string }>;
    expect([...new Set(manifest.map(m => m.speciesCode))].sort()).toEqual(['a', 'b', 'c']);
  });

  // Swap-review v2 §2: same-picture dedup at SOURCE time. bird-maps.com sourced
  // its live photos from iNat, so iNat routinely returns the byte-identical image
  // already live. Skipping it BEFORE insert/manifest means the (paid) Opus judge
  // never scores a photo we already have — the ≈20% resource win.
  it('SKIPS a candidate whose bytes hash to the current photo content_hash (not inserted, not in manifest); keeps distinct candidates', async () => {
    seedCurrent('dedupe', 'https://photos.example/dedupe.jpg');
    seedFlaggedScore('dedupe');

    // The download stub hashes Buffer.from(url). Candidate 11's bytes are the
    // SAME image as the current live photo, so stamp the current content_hash to
    // its sha8 — source-prepare must skip 11 and keep 12 (a distinct image).
    const dupUrl = 'https://inat.example/dup.jpg';
    const freshUrl = 'https://inat.example/fresh.jpg';
    updateCurrentPhotoHash(db, 'dedupe', sha8(Buffer.from(dupUrl)));

    const fetchInatCandidates = vi.fn(async () => [
      { inatId: 11, photoUrl: dupUrl, attribution: '(c) P (CC BY)', license: 'cc-by' },
      { inatId: 12, photoUrl: freshUrl, attribution: '(c) Q (CC0)', license: 'cc0' },
    ]);
    const download = vi.fn(async (url: string) => Buffer.from(url));

    const result = await sourcePrepare(db, 5, { fetchInatCandidates, download, thumbDir: workDir, clock: instant() });

    // 11 (byte-identical to live) is skipped; only 12 is sourced.
    expect(result.skippedDuplicates).toBe(1);
    expect(result.picked).toBe(1);
    const manifest = JSON.parse(readFileSync(result.manifestPath, 'utf8')) as Array<{ inatId: number }>;
    expect(manifest.map(m => m.inatId)).toEqual([12]);
    // The dup was never inserted as a candidate row (no judge will ever see it).
    expect(listCandidates(db, 'dedupe').map(c => c.inatId)).toEqual([12]);
  });
});

describe('sourceCommit (Node, testable — Bug 1 source-candidates split)', () => {
  it('composes + upserts a candidate score (role=candidate) keyed by inat id', async () => {
    seedCurrent('flag1', 'https://photos.example/flag1.jpg');
    seedFlaggedScore('flag1');
    const fetchInatCandidates = vi.fn(async () => [
      { inatId: 11, photoUrl: 'https://inat.example/11.jpg', attribution: '(c) P (CC BY)', license: 'cc-by' },
    ]);
    const download = vi.fn(async (url: string) => Buffer.from(url));
    const prep = await sourcePrepare(db, 5, { fetchInatCandidates, download, thumbDir: workDir, clock: instant() });
    const hash = prep.manifest[0]!.contentHash;

    const results: SourceResult[] = [
      {
        speciesCode: 'flag1', inatId: 11, contentHash: hash,
        fieldMarks: ['clean wild perch'],
        criteria: { framing: 9, subjectClarity: 9, liveness: 10, naturalness: 9, pose: 8, background: 8, lighting: 9 },
        flags: [],
        keep: true,
        qualityScore: 88,
        rationale: 'A much sharper wild alternate.',
      },
    ];
    const summary = await sourceCommit(db, results);
    expect(summary.committed).toBe(1);
    expect(summary.failed).toBe(0);

    const stored = getScoreByHash(db, 'flag1', 'candidate', hash);
    expect(stored).not.toBeNull();
    expect(stored!.candidateInatId).toBe(11);
    expect(['great', 'good']).toContain(stored!.verdict);
    expect(stored!.keep).toBe(true);
    expect(stored!.qualityScore).toBe(88);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// #974 — source-keyed skip ledger. source-prepare records a source_attempt per
// species it sources, and SKIPS species already searched under the run's source.
// source-commit resolves 'searched' → 'better-found' | 'exhausted'.
// ─────────────────────────────────────────────────────────────────────────────

describe('sourcePrepare — source_attempt skip + record (#974)', () => {
  it('records outcome=searched for each newly-sourced species, with the non-dup candidate count', async () => {
    seedCurrent('flag1', 'https://photos.example/flag1.jpg');
    seedFlaggedScore('flag1');
    const fetchInatCandidates = vi.fn(async () => [
      { inatId: 11, photoUrl: 'https://inat.example/11.jpg', attribution: '(c) P', license: 'cc-by' },
      { inatId: 12, photoUrl: 'https://inat.example/12.jpg', attribution: '(c) Q', license: 'cc0' },
    ]);
    const download = vi.fn(async (url: string) => Buffer.from(url));

    await sourcePrepare(db, 5, { fetchInatCandidates, download, thumbDir: workDir, clock: instant() });

    const attempt = getSourceAttempt(db, 'flag1', 'inat');
    expect(attempt).not.toBeNull();
    expect(attempt!.outcome).toBe('searched');
    expect(attempt!.candidatesFound).toBe(2);
    expect(attempt!.source).toBe('inat');
  });

  it('SKIPS a species already searched under the run source, but sources it under a DIFFERENT --source', async () => {
    seedCurrent('flag1', 'https://photos.example/flag1.jpg');
    seedFlaggedScore('flag1');
    const fetchInatCandidates = vi.fn(async () => [
      { inatId: 11, photoUrl: 'https://inat.example/11.jpg', attribution: '(c) P', license: 'cc-by' },
    ]);
    const download = vi.fn(async (url: string) => Buffer.from(url));

    // Pre-record an iNat attempt — flag1 is already searched under 'inat'.
    recordSourceAttempt(db, { speciesCode: 'flag1', source: 'inat', candidatesFound: 1, outcome: 'exhausted' });

    // source-prepare under the SAME source (default 'inat') must skip flag1.
    const inatRun = await sourcePrepare(
      db, 5, { fetchInatCandidates, download, thumbDir: workDir, clock: instant() },
    );
    expect(fetchInatCandidates).toHaveBeenCalledTimes(0);
    expect(inatRun.picked).toBe(0);

    // source-prepare under a DIFFERENT source CAN retry the iNat-exhausted species.
    const otherRun = await sourcePrepare(
      db, 5, { fetchInatCandidates, download, thumbDir: workDir, clock: instant() },
      { source: 'macaulay' },
    );
    expect(fetchInatCandidates).toHaveBeenCalledTimes(1);
    expect(otherRun.picked).toBe(1);
    // A fresh source_attempt row was recorded under the new source.
    expect(getSourceAttempt(db, 'flag1', 'macaulay')!.outcome).toBe('searched');
    // The original iNat row is untouched.
    expect(getSourceAttempt(db, 'flag1', 'inat')!.outcome).toBe('exhausted');
  });
});

describe('sourceCommit — outcome resolution (#974)', () => {
  // Seed a flagged current (quality_score 30) + a sourced candidate, then commit
  // an agent score for that candidate. The gate decides better-found / exhausted.
  async function prepCandidate(qs: number): Promise<string> {
    seedCurrent('flag1', 'https://photos.example/flag1.jpg');
    seedFlaggedScore('flag1'); // current quality_score = 30
    const fetchInatCandidates = vi.fn(async () => [
      { inatId: 11, photoUrl: 'https://inat.example/11.jpg', attribution: '(c) P', license: 'cc-by' },
    ]);
    const download = vi.fn(async (url: string) => Buffer.from(url));
    const prep = await sourcePrepare(db, 5, { fetchInatCandidates, download, thumbDir: workDir, clock: instant() });
    return prep.manifest[0]!.contentHash;
  }
  function commitWith(hash: string, qs: number): Promise<unknown> {
    const results: SourceResult[] = [{
      speciesCode: 'flag1', inatId: 11, contentHash: hash,
      fieldMarks: [], criteria: { framing: 8, subjectClarity: 8, liveness: 8, naturalness: 8, pose: 8, background: 8, lighting: 8 },
      flags: [], keep: true, qualityScore: qs, rationale: 'alt',
    }];
    return sourceCommit(db, results);
  }

  it("sets 'better-found' (with best_score) when a candidate clears the Δ>=20 gate", async () => {
    const hash = await prepCandidate(60);
    // candidate qs 60 vs current 30 → Δ30 ≥ 20 → better-found.
    await commitWith(hash, 60);
    const a = getSourceAttempt(db, 'flag1', 'inat');
    expect(a!.outcome).toBe('better-found');
    expect(a!.bestScore).toBe(60);
  });

  it("sets 'exhausted' when no candidate clears the gate (Δ<20)", async () => {
    const hash = await prepCandidate(45);
    // candidate qs 45 vs current 30 → Δ15 < 20 → exhausted.
    await commitWith(hash, 45);
    const a = getSourceAttempt(db, 'flag1', 'inat');
    expect(a!.outcome).toBe('exhausted');
  });

  it('resolves the outcome on the run source passed to sourceCommit', async () => {
    // Source under 'macaulay', then commit with the SAME source → that row resolves.
    seedCurrent('flag1', 'https://photos.example/flag1.jpg');
    seedFlaggedScore('flag1');
    const fetchInatCandidates = vi.fn(async () => [
      { inatId: 11, photoUrl: 'https://inat.example/11.jpg', attribution: '(c) P', license: 'cc-by' },
    ]);
    const download = vi.fn(async (url: string) => Buffer.from(url));
    const prep = await sourcePrepare(
      db, 5, { fetchInatCandidates, download, thumbDir: workDir, clock: instant() }, { source: 'macaulay' },
    );
    const hash = prep.manifest[0]!.contentHash;
    const results: SourceResult[] = [{
      speciesCode: 'flag1', inatId: 11, contentHash: hash, fieldMarks: [],
      criteria: { framing: 8, subjectClarity: 8, liveness: 8, naturalness: 8, pose: 8, background: 8, lighting: 8 },
      flags: [], keep: true, qualityScore: 70, rationale: 'alt',
    }];
    await sourceCommit(db, results, { source: 'macaulay' });
    expect(getSourceAttempt(db, 'flag1', 'macaulay')!.outcome).toBe('better-found');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Conservative external-API usage (#992 addendum). Spacing is asserted via an
// injected fake clock that advances virtual time only — NO real wait.
// ─────────────────────────────────────────────────────────────────────────────

describe('scorePrepare — conservative edge usage (#992)', () => {
  it('(b) downloads are SERIAL and paced ≥1.1 s apart (asserted via the fake clock)', async () => {
    seedCurrent('aaa', 'https://photos.example/aaa.jpg');
    seedCurrent('bbb', 'https://photos.example/bbb.jpg');
    seedCurrent('ccc', 'https://photos.example/ccc.jpg');

    const clock = makeFakeClock();
    // Record the virtual time at the moment each download STARTS.
    const downloadStarts: number[] = [];
    let inFlight = 0;
    let maxConcurrent = 0;
    const download = vi.fn(async (url: string) => {
      downloadStarts.push(clock.now());
      inFlight++;
      maxConcurrent = Math.max(maxConcurrent, inFlight);
      inFlight--;
      return Buffer.from(url);
    });

    const result = await scorePrepare(db, 3, { download, thumbDir: workDir, clock, assessDeterministic: async () => passGate() });
    expect(result.picked).toBe(3);
    expect(result.downloads).toBe(3);
    // Serial: never more than one download in flight.
    expect(maxConcurrent).toBe(1);
    // First download starts immediately; each later one ≥1100 ms after the prior.
    expect(downloadStarts).toHaveLength(3);
    expect(downloadStarts[1]! - downloadStarts[0]!).toBeGreaterThanOrEqual(1100);
    expect(downloadStarts[2]! - downloadStarts[1]!).toBeGreaterThanOrEqual(1100);
    // Exactly two pacing waits for three downloads.
    expect(clock.sleeps.filter(s => s >= 1100)).toHaveLength(2);
  });

  it('(c) SKIPS a species whose current content-hash is already scored — no re-download', async () => {
    seedCurrent('done', 'https://photos.example/done.jpg');
    seedCurrent('todo', 'https://photos.example/todo.jpg');

    // First pass: download + score 'done' so its content-hash lands in photo_score.
    const download1 = vi.fn(async (url: string) => Buffer.from(url));
    const first = await scorePrepare(db, 10, { download: download1, thumbDir: workDir, clock: instant(), assessDeterministic: async () => passGate() });
    expect(first.downloads).toBe(2);
    // Commit a score for 'done' (its stamped current hash), leave 'todo' unscored.
    const doneHash = (db.prepare(`SELECT content_hash FROM photo_current WHERE species_code=?`).get('done') as { content_hash: string }).content_hash;
    upsertScore(db, {
      speciesCode: 'done', role: 'current', candidateInatId: null, contentHash: doneHash,
      report: {
        overall: 80, verdict: 'good',
        deterministic: { width: 0, height: 0, megapixels: 0, sharpness: 0, exposure: 0, aspectRatio: 0, passedGate: true, failReasons: [] },
        criteria: { framing: 8, subjectClarity: 8, liveness: 8, naturalness: 8, pose: 8, background: 8, lighting: 8 },
        flags: [], fieldMarks: [], keep: true, qualityScore: 80,
        rationale: 'already scored', rubricVersion: '0.2.0',
      },
    });

    // Second pass: 'done' already has a scored content-hash → skipped, no download.
    const download2 = vi.fn(async (url: string) => Buffer.from(url));
    const second = await scorePrepare(db, 10, { download: download2, thumbDir: workDir, clock: instant(), assessDeterministic: async () => passGate() });
    expect(second.skipped).toBe(1);
    expect(second.picked).toBe(1); // only 'todo' was prepared
    // 'done' was never re-downloaded.
    const downloadedUrls = download2.mock.calls.map(c => c[0]);
    expect(downloadedUrls).not.toContain('https://photos.example/done.jpg');
    expect(downloadedUrls).toContain('https://photos.example/todo.jpg');
    expect(second.manifest.map(m => m.speciesCode)).toEqual(['todo']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Deterministic pre-filter in score-prepare (#994). After downloading each
// image's bytes, scorePrepare runs the FREE deterministic gate; a gate-FAILING
// image is auto-rejected (a reject report is persisted the same way score-commit
// would, role='current', the species is marked reviewed) and EXCLUDED from the
// manifest, so a tiny/blurry/wrong-aspect photo never reaches a (paid) judge.
// assessDeterministic is injected so the tests stay fast (no sharp decode).
// ─────────────────────────────────────────────────────────────────────────────
describe('scorePrepare — deterministic pre-filter (#994)', () => {
  it('(a) auto-rejects a gate-FAILING image: writes a reject report, marks reviewed, and KEEPS it out of the manifest — no judge dispatch', async () => {
    seedCurrent('bad', 'https://photos.example/bad.jpg');

    const download = vi.fn(async (url: string) => Buffer.from(url));
    // Gate fails for every image.
    const assessDeterministic = vi.fn(async () => failGate(['below-min-megapixels', 'below-min-sharpness']));

    const result = await scorePrepare(db, 1, { download, thumbDir: workDir, clock: instant(), assessDeterministic });

    // It was downloaded + gate-checked, but NOT placed in the manifest the judge agents read.
    expect(assessDeterministic).toHaveBeenCalledTimes(1);
    expect(result.manifest.map(m => m.speciesCode)).toEqual([]);
    expect(result.picked).toBe(0);
    expect(result.gateRejected).toBe(1);

    // A reject report was persisted (role='current') keyed by the stamped content hash.
    const hash = (db.prepare(`SELECT content_hash FROM photo_current WHERE species_code=?`).get('bad') as { content_hash: string }).content_hash;
    const stored = getScoreByHash(db, 'bad', 'current', hash);
    expect(stored).not.toBeNull();
    expect(stored!.overall).toBe(0);
    expect(stored!.verdict).toBe('reject');
    // #994 pre-filter runs BEFORE the judge: keep:false with no judge output.
    expect(stored!.keep).toBe(false);
    expect(stored!.fieldMarks).toEqual([]);
    expect(stored!.rationale).toMatch(/deterministic gate failed/);
    expect(stored!.rationale).toMatch(/below-min-megapixels/);

    // The species is cleared from the backlog (reviewed=1) just like a committed score.
    expect(selectUnreviewed(db, 10).map(r => r.species_code)).not.toContain('bad');

    // The manifest JSON written to disk is empty too.
    const manifestOnDisk = JSON.parse(readFileSync(result.manifestPath, 'utf8')) as unknown[];
    expect(manifestOnDisk).toEqual([]);
  });

  it('(b) a gate-PASSING image goes to the manifest (and is NOT pre-rejected)', async () => {
    seedCurrent('good', 'https://photos.example/good.jpg');

    const download = vi.fn(async (url: string) => Buffer.from(url));
    const assessDeterministic = vi.fn(async () => passGate());

    const result = await scorePrepare(db, 1, { download, thumbDir: workDir, clock: instant(), assessDeterministic });

    expect(result.manifest.map(m => m.speciesCode)).toEqual(['good']);
    expect(result.picked).toBe(1);
    expect(result.gateRejected).toBe(0);

    // No score row was pre-written — scoring happens at the judge + commit step.
    const hash = (db.prepare(`SELECT content_hash FROM photo_current WHERE species_code=?`).get('good') as { content_hash: string }).content_hash;
    expect(getScoreByHash(db, 'good', 'current', hash)).toBeNull();
    // Still in the backlog until the judge commit marks it reviewed.
    expect(selectUnreviewed(db, 10).map(r => r.species_code)).toContain('good');
  });

  it('(c) returns/logs judged N / gate-rejected M / already-scored skipped K across a mixed batch', async () => {
    // already-scored 'done', gate-fail 'bad', gate-pass 'good'.
    seedCurrent('done', 'https://photos.example/done.jpg');
    seedCurrent('bad', 'https://photos.example/bad.jpg');
    seedCurrent('good', 'https://photos.example/good.jpg');

    // Pre-stamp + pre-score 'done' so the no-rework skip fires.
    const firstDownload = vi.fn(async (url: string) => Buffer.from(url));
    await scorePrepare(db, 10, { download: firstDownload, thumbDir: workDir, clock: instant(), assessDeterministic: async () => passGate() });
    const doneHash = (db.prepare(`SELECT content_hash FROM photo_current WHERE species_code=?`).get('done') as { content_hash: string }).content_hash;
    upsertScore(db, {
      speciesCode: 'done', role: 'current', candidateInatId: null, contentHash: doneHash,
      report: {
        overall: 80, verdict: 'good',
        deterministic: { width: 0, height: 0, megapixels: 0, sharpness: 0, exposure: 0, aspectRatio: 0, passedGate: true, failReasons: [] },
        criteria: { framing: 8, subjectClarity: 8, liveness: 8, naturalness: 8, pose: 8, background: 8, lighting: 8 },
        flags: [], fieldMarks: [], keep: true, qualityScore: 80,
        rationale: 'already scored', rubricVersion: '0.2.0',
      },
    });

    const logs: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((msg?: unknown) => { logs.push(String(msg)); });

    const download = vi.fn(async (url: string) => Buffer.from(url));
    // 'bad' fails the gate, 'good' passes.
    const assessDeterministic = vi.fn(async (img: ImageInput, _det: RubricConfig['deterministic']) =>
      img.buffer.toString().includes('bad') ? failGate() : passGate());

    const second = await scorePrepare(db, 10, { download, thumbDir: workDir, clock: instant(), assessDeterministic });
    logSpy.mockRestore();

    expect(second.picked).toBe(1);        // 'good' judged
    expect(second.gateRejected).toBe(1);  // 'bad' rejected
    expect(second.skipped).toBe(1);       // 'done' already scored
    expect(second.manifest.map(m => m.speciesCode)).toEqual(['good']);

    // The batch log surfaces all three counts.
    const line = logs.find(l => l.includes('judged') && l.includes('gate-rejected'));
    expect(line).toBeTruthy();
    expect(line).toMatch(/judged 1/);
    expect(line).toMatch(/gate-rejected 1/);
    expect(line).toMatch(/skipped 1/);
  });
});

describe('sourcePrepare — conservative iNat usage (#992)', () => {
  it('(a) paces iNat fetches ≥1 s between species (asserted via the fake clock)', async () => {
    seedCurrent('f1', 'https://photos.example/f1.jpg');
    seedFlaggedScore('f1');
    seedCurrent('f2', 'https://photos.example/f2.jpg');
    seedFlaggedScore('f2');

    const clock = makeFakeClock();
    // Record the virtual time at each iNat fetch (one per flagged species).
    const fetchStarts: number[] = [];
    const fetchInatCandidates = vi.fn(async (sci: string) => {
      fetchStarts.push(clock.now());
      const id = sci.includes('f1') ? 11 : 21;
      return [{ inatId: id, photoUrl: `https://inat.example/${id}.jpg`, attribution: '(c) P (CC BY)', license: 'cc-by' }];
    });
    const download = vi.fn(async (url: string) => Buffer.from(url));

    const result = await sourcePrepare(db, 12, { fetchInatCandidates, download, thumbDir: workDir, clock });
    expect(fetchInatCandidates).toHaveBeenCalledTimes(2);
    expect(result.inatFetches).toBe(2);
    expect(fetchStarts).toHaveLength(2);
    // The second species' iNat fetch begins ≥1100 ms after the first's.
    expect(fetchStarts[1]! - fetchStarts[0]!).toBeGreaterThanOrEqual(1100);
  });

  it('(d) caps the candidate pool to ~12 per species even when more are returned, and when a larger pool is requested', async () => {
    seedCurrent('big', 'https://photos.example/big.jpg');
    seedFlaggedScore('big');

    // iNat (stubbed) returns 30; the cap must hold both on the requested limit
    // AND on the post-fetch slice.
    const fetchInatCandidates = vi.fn(async (_sci: string, opts: { limit: number }) => {
      // The tool must request a bounded limit (≤12), not 30.
      expect(opts.limit).toBeLessThanOrEqual(12);
      return Array.from({ length: 30 }, (_v, i) => ({
        inatId: 1000 + i, photoUrl: `https://inat.example/${1000 + i}.jpg`,
        attribution: '(c) P (CC BY)', license: 'cc-by',
      }));
    });
    const download = vi.fn(async (url: string) => Buffer.from(url));

    const result = await sourcePrepare(db, 30, { fetchInatCandidates, download, thumbDir: workDir, clock: instant() });
    // No more than 12 candidates sourced + downloaded.
    expect(result.picked).toBeLessThanOrEqual(12);
    expect(result.picked).toBe(12);
    expect(result.downloads).toBe(12);
    expect(download).toHaveBeenCalledTimes(12);
  });

  it('aborts a species (not the batch) when its iNat fetch fails persistently', async () => {
    seedCurrent('bad', 'https://photos.example/bad.jpg');
    seedFlaggedScore('bad');
    seedCurrent('ok', 'https://photos.example/ok.jpg');
    seedFlaggedScore('ok');

    const fetchInatCandidates = vi.fn(async (sci: string) => {
      if (sci.includes('bad')) throw Object.assign(new Error('429'), { status: 429 });
      return [{ inatId: 77, photoUrl: 'https://inat.example/77.jpg', attribution: '(c) P (CC BY)', license: 'cc-by' }];
    });
    const download = vi.fn(async (url: string) => Buffer.from(url));

    const result = await sourcePrepare(db, 12, {
      fetchInatCandidates, download, thumbDir: workDir, clock: instant(),
    });
    // The bad species was aborted; the good one still produced a candidate.
    expect(result.manifest.map(m => m.speciesCode)).toEqual(['ok']);
    expect(listCandidates(db, 'bad')).toEqual([]);
    expect(listCandidates(db, 'ok').map(c => c.inatId)).toEqual([77]);
  });
});
