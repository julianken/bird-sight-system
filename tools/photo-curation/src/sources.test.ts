import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb } from './db.js';
import { listCandidates, getScoreByHash, upsertCurrentPhoto } from './store.js';
import { sourceCandidates, scoreAndCacheCandidates } from './sources.js';
import { FakeJudge } from './judge.js';
import { makeFakeClock } from './test-clock.js';
import type { RubricConfig } from '@bird-watch/photo-quality';
import type { InatCandidate, DenyContext } from '@bird-watch/ingestor';

// Minimal default rubric for the test — Slice 2 ships the real defaultRubricConfig.
const config = {
  version: '1.0.0',
  deterministic: { minMegapixels: 0.3, minSharpness: 10, allowedAspect: [0.5, 2.0] },
  weights: { framing: 0.15, subjectClarity: 0.2, liveness: 0.15, naturalness: 0.2, pose: 0.1, background: 0.1, lighting: 0.1 },
  disqualifiers: [{ flag: 'dead', cap: 20 }],
  thresholds: { autoAccept: 75, review: 50, reject: 30 },
  judgePrompt: 'rate this bird photo',
} as unknown as RubricConfig;

let db: Database.Database;
beforeEach(() => { db = openDb(':memory:'); });
afterEach(() => { db.close(); vi.restoreAllMocks(); });

const candidates: InatCandidate[] = [
  { inatId: 111, photoUrl: 'https://inat/111/medium.jpg', attribution: '(c) A (CC BY)', license: 'cc-by' },
  { inatId: 222, photoUrl: 'https://inat/222/medium.jpg', attribution: '(c) B (CC0)', license: 'cc0' },
];

function deps(fetchSpy: (sci: string, o: { limit: number; excludeIds?: number[]; denyContext?: DenyContext }) => Promise<InatCandidate[]>) {
  return {
    fetchInatCandidates: fetchSpy,
    // download returns distinct bytes per url so each gets a distinct content hash
    download: vi.fn(async (url: string) => Buffer.from(url)),
    scoreImage: vi.fn(async (img: { buffer: Buffer; mime: string }) => ({
      overall: 80, verdict: 'good' as const,
      deterministic: { width: 1, height: 1, megapixels: 1, sharpness: 1, exposure: 1, aspectRatio: 1, passedGate: true, failReasons: [] },
      criteria: { framing: 8, subjectClarity: 8, liveness: 8, naturalness: 8, pose: 8, background: 8, lighting: 8 },
      flags: [], fieldMarks: ['wing bars'], keep: true, qualityScore: 80,
      rationale: 'ok', rubricVersion: '1.0.0',
    })),
    judge: new FakeJudge({}),
    config,
    thumbDir: '/tmp/photo-curation-test-thumbs',
    // Instant clock so iNat/edge pacing advances virtual time only — no real wait.
    clock: makeFakeClock(),
  };
}

describe('sourceCandidates', () => {
  it('fetches, persists candidates + scores, and caches by content hash', async () => {
    const fetchSpy = vi.fn(async () => candidates);
    const d = deps(fetchSpy);
    await sourceCandidates(db, { speciesCode: 'amerob', sciName: 'Turdus migratorius', limit: 15 }, d);

    expect(listCandidates(db, 'amerob').map(c => c.inatId).sort()).toEqual([111, 222]);
    expect(getScoreByHash(db, 'amerob', 'candidate', 'wrong-hash')).toBeNull(); // sanity: wrong-hash miss
    expect(d.scoreImage).toHaveBeenCalledTimes(2);
  });

  it('does NOT re-score a candidate whose content hash is already scored', async () => {
    const fetchSpy = vi.fn(async () => candidates);
    const d = deps(fetchSpy);
    await sourceCandidates(db, { speciesCode: 'amerob', sciName: 'Turdus migratorius', limit: 15 }, d);
    expect(d.scoreImage).toHaveBeenCalledTimes(2);
    // second run with the same candidates → same bytes → same hashes → 0 new judge calls
    d.scoreImage.mockClear();
    await sourceCandidates(db, { speciesCode: 'amerob', sciName: 'Turdus migratorius', limit: 15 }, d);
    expect(d.scoreImage).toHaveBeenCalledTimes(0);
  });

  it('lands re-sourced candidates in a higher source_round and forwards the DenyContext + exclude ids', async () => {
    const fetchSpy = vi.fn(async () => candidates);
    const d = deps(fetchSpy);
    await sourceCandidates(db, { speciesCode: 'amerob', sciName: 'Turdus migratorius', limit: 15 }, d);
    const denyContext: DenyContext = { reason: 'too distant', tags: ['still-distant'] };
    await sourceCandidates(db, {
      speciesCode: 'amerob', sciName: 'Turdus migratorius', limit: 15,
      denyContext, excludeIds: [111, 222],
    }, d);
    // the sourcer was told to exclude the already-shown ids and got the bias
    const lastCall = fetchSpy.mock.calls.at(-1)!;
    expect(lastCall[1].excludeIds).toEqual([111, 222]);
    expect(lastCall[1].denyContext).toEqual(denyContext);
    // re-source landed in round 1
    const round1 = (db.prepare(`SELECT MAX(source_round) m FROM photo_candidate WHERE species_code=?`).get('amerob') as { m: number }).m;
    expect(round1).toBe(1);
  });

  it('isolates a per-candidate failure (one bad download does not abort the species)', async () => {
    const fetchSpy = vi.fn(async () => candidates);
    const d = deps(fetchSpy);
    d.download = vi.fn(async (url: string) => {
      if (url.includes('111')) throw new Error('thumb 404');
      return Buffer.from(url);
    });
    const summary = await sourceCandidates(db, { speciesCode: 'amerob', sciName: 'Turdus migratorius', limit: 15 }, d);
    expect(summary.scored).toBe(1);
    expect(summary.failed).toBe(1);
    expect(listCandidates(db, 'amerob').map(c => c.inatId)).toEqual([222]);
  });
});

describe('scoreAndCacheCandidates (the Slice-5 deny-loop entry point)', () => {
  it('reads sciName from photo_current, returns the fresh-candidate count, and forwards the DenyContext + exclude ids (deps injected as the unit-test seam)', async () => {
    const fetchSpy = vi.fn(async () => candidates);
    const d = deps(fetchSpy);
    // seed round 0 + the photo_current row scoreAndCacheCandidates reads sciName from
    upsertCurrentPhoto(db, {
      speciesCode: 'amerob', comName: 'American Robin', sciName: 'Turdus migratorius',
      family: 'Turdidae', url: 'https://photos.bird-maps.com/species/amerob.aaaaaaaa.jpg',
      attribution: '(c) X (CC BY)', license: 'cc-by', contentHash: 'deadbeef',
    });
    await sourceCandidates(db, { speciesCode: 'amerob', sciName: 'Turdus migratorius', limit: 15 }, d);
    fetchSpy.mockClear();
    // Slice-5 deny loop calls the 4-arg form; the optional deps is the test seam only.
    const denyContext: DenyContext = { reason: 'captive feeder', tags: ['captive-feeder'] };
    const count = await scoreAndCacheCandidates(db, 'amerob', denyContext, [111, 222], d);
    // returns the COUNT of freshly sourced+scored candidates (a number, not a summary object)
    expect(count).toBe(2);
    // re-source landed in round 1
    const round1 = (db.prepare(`SELECT MAX(source_round) m FROM photo_candidate WHERE species_code=?`).get('amerob') as { m: number }).m;
    expect(round1).toBe(1);
    const lastCall = fetchSpy.mock.calls.at(-1)!;
    // sciName came from the photo_current row, not the caller
    expect(lastCall[0]).toBe('Turdus migratorius');
    expect(lastCall[1].denyContext).toEqual(denyContext);
    expect(lastCall[1].excludeIds).toEqual([111, 222]);
  });
});
