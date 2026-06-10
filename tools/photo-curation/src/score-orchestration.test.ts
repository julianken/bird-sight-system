import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { openDb } from './db.js';
import { upsertCurrentPhoto, upsertScore, getScoreByHash, selectUnreviewed, listCandidates } from './store.js';
import {
  scorePrepare, scoreCommit, sourcePrepare, sourceCommit,
} from './score-orchestration.js';
import type { ScoreResult, SourceResult } from './score-orchestration.js';
import { makeFakeClock } from './test-clock.js';
import type { QualityReport } from '@bird-watch/photo-quality';

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

    // limit 0 clamps up to 1 → only the oldest-by-code row (aaa).
    const result = await scorePrepare(db, 0, { download, thumbDir: workDir, clock: instant() });
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
    const result = await scorePrepare(db, 1, { download, thumbDir: workDir, clock: instant() });
    const manifest = JSON.parse(readFileSync(result.manifestPath, 'utf8')) as Array<{ imagePath: string }>;
    expect(manifest[0]!.imagePath).toBe(join(workDir, 'pngsp.png'));
  });
});

describe('scoreCommit (Node, testable — Bug 1)', () => {
  it('composes the report, upserts the score (role=current), and marks the species reviewed', async () => {
    seedCurrent('aaa', 'https://photos.example/aaa.jpg');
    // Simulate a prepare pass having stamped the content hash.
    const download = vi.fn(async (url: string) => Buffer.from(url));
    await scorePrepare(db, 1, { download, thumbDir: workDir, clock: instant() });
    const hash = (db.prepare(`SELECT content_hash FROM photo_current WHERE species_code=?`).get('aaa') as { content_hash: string }).content_hash;

    // A strong photo → 'great'/'good'; a flagged one → capped reject.
    const results: ScoreResult[] = [
      {
        speciesCode: 'aaa',
        criteria: { framing: 9, subjectClarity: 10, liveness: 10, naturalness: 9, pose: 8, background: 8, lighting: 9 },
        flags: [],
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
    expect(stored!.rationale).toBe('Tack-sharp wild adult on a natural perch.');

    // The species is now reviewed (cleared from the backlog).
    expect(selectUnreviewed(db, 10)).toEqual([]);
  });

  it('applies disqualifier caps via composeReport (a flagged photo is capped low)', async () => {
    seedCurrent('inhand', 'https://photos.example/inhand.jpg');
    const download = vi.fn(async (url: string) => Buffer.from(url));
    await scorePrepare(db, 1, { download, thumbDir: workDir, clock: instant() });
    const hash = (db.prepare(`SELECT content_hash FROM photo_current WHERE species_code=?`).get('inhand') as { content_hash: string }).content_hash;

    // High sub-scores but an 'in-hand' flag → capped to a reject-ish overall.
    const results: ScoreResult[] = [
      {
        speciesCode: 'inhand',
        criteria: { framing: 9, subjectClarity: 10, liveness: 10, naturalness: 2, pose: 9, background: 9, lighting: 9 },
        flags: ['in-hand'],
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

  it('records a failure for a result whose species has no photo_current row', async () => {
    const results: ScoreResult[] = [
      {
        speciesCode: 'ghost',
        criteria: { framing: 5, subjectClarity: 5, liveness: 5, naturalness: 5, pose: 5, background: 5, lighting: 5 },
        flags: [],
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
    flags: [], rationale: 'soft + cluttered', rubricVersion: '0.1.0',
  };
  upsertScore(db, { speciesCode: code, role: 'current', candidateInatId: null, contentHash: 'cur00000', report });
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
        criteria: { framing: 9, subjectClarity: 9, liveness: 10, naturalness: 9, pose: 8, background: 8, lighting: 9 },
        flags: [],
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

    const result = await scorePrepare(db, 3, { download, thumbDir: workDir, clock });
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
    const first = await scorePrepare(db, 10, { download: download1, thumbDir: workDir, clock: instant() });
    expect(first.downloads).toBe(2);
    // Commit a score for 'done' (its stamped current hash), leave 'todo' unscored.
    const doneHash = (db.prepare(`SELECT content_hash FROM photo_current WHERE species_code=?`).get('done') as { content_hash: string }).content_hash;
    upsertScore(db, {
      speciesCode: 'done', role: 'current', candidateInatId: null, contentHash: doneHash,
      report: {
        overall: 80, verdict: 'good',
        deterministic: { width: 0, height: 0, megapixels: 0, sharpness: 0, exposure: 0, aspectRatio: 0, passedGate: true, failReasons: [] },
        criteria: { framing: 8, subjectClarity: 8, liveness: 8, naturalness: 8, pose: 8, background: 8, lighting: 8 },
        flags: [], rationale: 'already scored', rubricVersion: '0.1.0',
      },
    });

    // Second pass: 'done' already has a scored content-hash → skipped, no download.
    const download2 = vi.fn(async (url: string) => Buffer.from(url));
    const second = await scorePrepare(db, 10, { download: download2, thumbDir: workDir, clock: instant() });
    expect(second.skipped).toBe(1);
    expect(second.picked).toBe(1); // only 'todo' was prepared
    // 'done' was never re-downloaded.
    const downloadedUrls = download2.mock.calls.map(c => c[0]);
    expect(downloadedUrls).not.toContain('https://photos.example/done.jpg');
    expect(downloadedUrls).toContain('https://photos.example/todo.jpg');
    expect(second.manifest.map(m => m.speciesCode)).toEqual(['todo']);
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
