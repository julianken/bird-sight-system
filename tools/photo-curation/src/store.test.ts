import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb } from './db.js';
import {
  upsertCurrentPhoto, upsertScore, getScoreByHash,
  insertCandidate, listCandidates, markCandidatesExcluded,
  selectUnreviewed, markReviewed, updateCurrentPhotoHash,
  setSwapSelection, getSwapSelection,
} from './store.js';
import type { QualityReport } from '@bird-watch/photo-quality';

let db: Database.Database;
beforeEach(() => { db = openDb(':memory:'); });
afterEach(() => { db.close(); });

const report: QualityReport = {
  overall: 82,
  verdict: 'good',
  deterministic: {
    width: 1200, height: 900, megapixels: 1.08, sharpness: 140,
    exposure: 0.9, aspectRatio: 1.333, passedGate: true, failReasons: [],
  },
  criteria: {
    framing: 8, subjectClarity: 9, liveness: 10, naturalness: 9,
    pose: 7, background: 8, lighting: 8,
  },
  flags: [],
  fieldMarks: ['rufous breast', 'gray head', 'yellow bill'],
  keep: true,
  qualityScore: 84,
  rationale: 'Sharp perched adult, natural perch, good light.',
  rubricVersion: '1.0.0',
};

describe('store', () => {
  it('upserts and reads back the current photo', () => {
    upsertCurrentPhoto(db, {
      speciesCode: 'amerob', comName: 'American Robin', sciName: 'Turdus migratorius',
      family: 'Turdidae', url: 'https://photos.bird-maps.com/species/amerob.aaaaaaaa.jpg',
      attribution: '(c) X (CC BY)', license: 'cc-by', contentHash: 'deadbeef',
    });
    const row = db.prepare(`SELECT * FROM photo_current WHERE species_code=?`).get('amerob') as any;
    expect(row.com_name).toBe('American Robin');
    expect(row.content_hash).toBe('deadbeef');
  });

  it('upsertScore round-trips JSON columns and getScoreByHash finds it (the cache check)', () => {
    upsertScore(db, {
      speciesCode: 'amerob', role: 'current', candidateInatId: null,
      contentHash: 'deadbeef', report,
    });
    const found = getScoreByHash(db, 'amerob', 'current', 'deadbeef');
    expect(found).not.toBeNull();
    expect(found!.overall).toBe(82);
    expect(found!.verdict).toBe('good');
    expect(found!.criteria.subjectClarity).toBe(9);
    expect(found!.flags).toEqual([]);
    // #969: keep is the gate, fieldMarks + qualityScore round-trip too.
    expect(found!.keep).toBe(true);
    expect(found!.qualityScore).toBe(84);
    expect(found!.fieldMarks).toEqual(['rufous breast', 'gray head', 'yellow bill']);
    expect(found!.rubricVersion).toBe('1.0.0');
  });

  it('round-trips keep=false (the needs-replacement gate) and missing fieldMarks as []', () => {
    upsertScore(db, {
      speciesCode: 'badsp', role: 'current', candidateInatId: null,
      contentHash: 'cafef00d',
      report: { ...report, keep: false, qualityScore: 31, fieldMarks: [] },
    });
    const found = getScoreByHash(db, 'badsp', 'current', 'cafef00d');
    expect(found!.keep).toBe(false);
    expect(found!.qualityScore).toBe(31);
    expect(found!.fieldMarks).toEqual([]);
  });

  it('getScoreByHash returns null for an unscored hash (drives the cache miss path)', () => {
    expect(getScoreByHash(db, 'amerob', 'current', 'nope')).toBeNull();
  });

  it('upsertScore is idempotent on (species_code, role, content_hash)', () => {
    const args = {
      speciesCode: 'amerob' as const, role: 'current' as const,
      candidateInatId: null, contentHash: 'deadbeef', report,
    };
    upsertScore(db, args);
    upsertScore(db, { ...args, report: { ...report, overall: 99 } });
    const n = (db.prepare(`SELECT COUNT(*) c FROM photo_score`).get() as { c: number }).c;
    expect(n).toBe(1);
    expect(getScoreByHash(db, 'amerob', 'current', 'deadbeef')!.overall).toBe(99);
  });

  it('insert/list/exclude candidates round-trip with excluded filtering', () => {
    insertCandidate(db, {
      speciesCode: 'amerob', inatId: 111, photoUrl: 'https://inat/111/medium.jpg',
      thumbPath: './thumb-cache/amerob-111.jpg', attribution: '(c) A (CC BY)',
      license: 'cc-by', sourceRound: 0,
    });
    insertCandidate(db, {
      speciesCode: 'amerob', inatId: 222, photoUrl: 'https://inat/222/medium.jpg',
      thumbPath: './thumb-cache/amerob-222.jpg', attribution: '(c) B (CC0)',
      license: 'cc0', sourceRound: 0,
    });
    expect(listCandidates(db, 'amerob').length).toBe(2);
    markCandidatesExcluded(db, 'amerob', [111]);
    expect(listCandidates(db, 'amerob').map(c => c.inatId)).toEqual([222]);
    expect(listCandidates(db, 'amerob', { includeExcluded: true }).length).toBe(2);
  });

  it('selectUnreviewed returns up to `limit` reviewed=0 rows; markReviewed flips one (the batched-score loop)', () => {
    const mk = (code: string) => upsertCurrentPhoto(db, {
      speciesCode: code, comName: code, sciName: code, family: 'Turdidae',
      url: `https://photos.bird-maps.com/species/${code}.aaaaaaaa.jpg`,
      attribution: '(c) X (CC BY)', license: 'cc-by', contentHash: 'deadbeef',
    });
    mk('amerob'); mk('btbwar'); mk('wlswar');
    // all three start reviewed=0 (column default); limit caps the batch
    expect(selectUnreviewed(db, 2).length).toBe(2);
    expect(selectUnreviewed(db, 10).map(r => r.speciesCode).sort())
      .toEqual(['amerob', 'btbwar', 'wlswar']);
    // scoring amerob removes it from the unreviewed backlog
    markReviewed(db, 'amerob');
    expect(selectUnreviewed(db, 10).map(r => r.speciesCode).sort())
      .toEqual(['btbwar', 'wlswar']);
  });

  it('markReviewed is idempotent (calling it twice leaves the row scored)', () => {
    upsertCurrentPhoto(db, {
      speciesCode: 'amerob', comName: 'American Robin', sciName: 'Turdus migratorius',
      family: 'Turdidae', url: 'https://photos.bird-maps.com/species/amerob.aaaaaaaa.jpg',
      attribution: '(c) X (CC BY)', license: 'cc-by', contentHash: 'deadbeef',
    });
    markReviewed(db, 'amerob');
    markReviewed(db, 'amerob'); // idempotent
    expect(selectUnreviewed(db, 10)).toEqual([]);
  });

  it('updateCurrentPhotoHash sets content_hash WITHOUT touching attribution/license', () => {
    upsertCurrentPhoto(db, {
      speciesCode: 'amerob', comName: 'American Robin', sciName: 'Turdus migratorius',
      family: 'Turdidae', url: 'https://photos.bird-maps.com/species/amerob.aaaaaaaa.jpg',
      attribution: '(c) Jane Doe (CC BY 4.0)', license: 'cc-by-4.0', contentHash: '',
    });
    updateCurrentPhotoHash(db, 'amerob', 'cafebabe');
    const row = db.prepare(`SELECT attribution, license, content_hash FROM photo_current WHERE species_code=?`).get('amerob') as any;
    expect(row.content_hash).toBe('cafebabe');
    expect(row.attribution).toBe('(c) Jane Doe (CC BY 4.0)');
    expect(row.license).toBe('cc-by-4.0');
  });
});

describe('swap_selection (operator override)', () => {
  it('getSwapSelection returns null when no override exists', () => {
    expect(getSwapSelection(db, 'norcar')).toBeNull();
  });

  it('setSwapSelection upserts a chosen candidate, then clears to "no swap" (null)', () => {
    // Operator picks candidate 4242 for norcar.
    setSwapSelection(db, 'norcar', 4242);
    const picked = getSwapSelection(db, 'norcar');
    expect(picked).not.toBeNull();
    expect(picked!.chosenInatId).toBe(4242);
    expect(typeof picked!.decidedAt).toBe('string');

    // Re-pick a different candidate — upsert in place (PK species_code).
    setSwapSelection(db, 'norcar', 9001);
    expect(getSwapSelection(db, 'norcar')!.chosenInatId).toBe(9001);
    expect(
      (db.prepare(`SELECT COUNT(*) AS n FROM swap_selection WHERE species_code='norcar'`).get() as { n: number }).n,
    ).toBe(1);

    // Explicit "no swap": chosen_inat_id NULL is recorded (NOT a delete).
    setSwapSelection(db, 'norcar', null);
    const noSwap = getSwapSelection(db, 'norcar');
    expect(noSwap).not.toBeNull();
    expect(noSwap!.chosenInatId).toBeNull();
  });
});
