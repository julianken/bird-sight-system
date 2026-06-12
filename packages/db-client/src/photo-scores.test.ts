import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { startTestDb, type TestDb } from './test-helpers.js';
import { insertPhotoScores, getPhotoScores } from './photo-scores.js';
import { upsertSpeciesMeta } from './species.js';
import type { PhotoScoreRow } from '@bird-watch/shared-types';

let db: TestDb;
beforeAll(async () => { db = await startTestDb(); }, 90_000);
afterAll(async () => { await db?.stop(); });

// species_photo_scores FKs species_code → species_meta(species_code). Each test
// truncates both and seeds the parent rows it needs.
beforeEach(async () => {
  await db.pool.query('TRUNCATE species_photo_scores, species_meta CASCADE');
  await upsertSpeciesMeta(db.pool, [
    { speciesCode: 'vermfly', comName: 'Vermilion Flycatcher', sciName: 'Pyrocephalus rubinus',
      familyCode: 'tyrannidae', familyName: 'Tyrant Flycatchers', taxonOrder: 30501 },
    { speciesCode: 'annhum', comName: "Anna's Hummingbird", sciName: 'Calypte anna',
      familyCode: 'trochilidae', familyName: 'Hummingbirds', taxonOrder: 4001 },
  ]);
});

const baseRow: PhotoScoreRow = {
  speciesCode: 'vermfly',
  contentHash: 'sha256-aaa',
  model: 'claude-opus-4-8',
  rubricVersion: 'v1',
  keep: true,
  qualityScore: 8.5,
  criteria: { sharpness: 9, pose: 8, lighting: 7, background: 6, framing: 8, fieldMarks: 9, naturalness: 8 },
  fieldMarks: ['red underparts', 'dark mask'],
  rationale: 'Sharp, diagnostic, keep.',
};

describe('insertPhotoScores', () => {
  it('inserts N rows and returns N', async () => {
    const n = await insertPhotoScores(db.pool, [
      baseRow,
      { ...baseRow, speciesCode: 'annhum', contentHash: 'sha256-bbb', keep: false },
    ]);
    expect(n).toBe(2);
    const { rows } = await db.pool.query('SELECT COUNT(*)::int AS c FROM species_photo_scores');
    expect(rows[0].c).toBe(2);
  });

  it('returns 0 for an empty input', async () => {
    expect(await insertPhotoScores(db.pool, [])).toBe(0);
  });

  it('re-inserting the same (species_code, content_hash, model, rubric_version) is a no-op', async () => {
    expect(await insertPhotoScores(db.pool, [baseRow])).toBe(1);
    // Same conflict tuple, different payload — ON CONFLICT DO NOTHING keeps the
    // original row and reports 0 inserted.
    expect(await insertPhotoScores(db.pool, [{ ...baseRow, keep: false, rationale: 'changed' }])).toBe(0);
    const { rows } = await db.pool.query('SELECT COUNT(*)::int AS c FROM species_photo_scores');
    expect(rows[0].c).toBe(1);
    const fetched = await getPhotoScores(db.pool, { model: 'claude-opus-4-8', rubricVersion: 'v1' });
    expect(fetched).toHaveLength(1);
    // Append-only: the FIRST write wins, the conflicting re-insert is dropped.
    expect(fetched[0].keep).toBe(true);
    expect(fetched[0].rationale).toBe('Sharp, diagnostic, keep.');
  });

  it('a different model, rubric_version, or content_hash for the same species appends a new row', async () => {
    expect(await insertPhotoScores(db.pool, [baseRow])).toBe(1);
    expect(await insertPhotoScores(db.pool, [{ ...baseRow, model: 'gemini-2.5-flash' }])).toBe(1);
    expect(await insertPhotoScores(db.pool, [{ ...baseRow, rubricVersion: 'v2' }])).toBe(1);
    expect(await insertPhotoScores(db.pool, [{ ...baseRow, contentHash: 'sha256-zzz' }])).toBe(1);
    const { rows } = await db.pool.query(
      `SELECT COUNT(*)::int AS c FROM species_photo_scores WHERE species_code = 'vermfly'`,
    );
    expect(rows[0].c).toBe(4);
  });
});

describe('getPhotoScores', () => {
  it('returns only rows matching the (model, rubricVersion) pin', async () => {
    await insertPhotoScores(db.pool, [
      baseRow,
      { ...baseRow, contentHash: 'sha256-bbb', speciesCode: 'annhum' },
      // Different pin — must be excluded.
      { ...baseRow, model: 'gemini-2.5-flash' },
      { ...baseRow, rubricVersion: 'v2' },
    ]);
    const pinned = await getPhotoScores(db.pool, { model: 'claude-opus-4-8', rubricVersion: 'v1' });
    expect(pinned).toHaveLength(2);
    expect(pinned.every(r => r.model === 'claude-opus-4-8' && r.rubricVersion === 'v1')).toBe(true);
    expect(pinned.map(r => r.speciesCode).sort()).toEqual(['annhum', 'vermfly']);
  });

  it('round-trips criteria/fieldMarks JSONB and the keep verdict', async () => {
    await insertPhotoScores(db.pool, [baseRow]);
    const [row] = await getPhotoScores(db.pool, { model: 'claude-opus-4-8', rubricVersion: 'v1' });
    expect(row.speciesCode).toBe('vermfly');
    expect(row.contentHash).toBe('sha256-aaa');
    expect(row.keep).toBe(true);
    expect(row.qualityScore).toBeCloseTo(8.5);
    expect(row.criteria).toEqual(baseRow.criteria);
    expect(row.fieldMarks).toEqual(['red underparts', 'dark mask']);
    expect(row.rationale).toBe('Sharp, diagnostic, keep.');
  });

  it('round-trips NULL quality_score and NULL criteria/fieldMarks (deterministic-gate row)', async () => {
    await insertPhotoScores(db.pool, [
      { speciesCode: 'annhum', contentHash: 'sha256-gate', model: 'deterministic-gate',
        rubricVersion: 'v1', keep: false, qualityScore: null, criteria: null,
        fieldMarks: null, rationale: null },
    ]);
    const [row] = await getPhotoScores(db.pool, { model: 'deterministic-gate', rubricVersion: 'v1' });
    expect(row.keep).toBe(false);
    expect(row.qualityScore).toBeNull();
    expect(row.criteria).toBeNull();
    expect(row.fieldMarks).toBeNull();
    expect(row.rationale).toBeNull();
  });

  it('returns [] when no row matches the pin', async () => {
    await insertPhotoScores(db.pool, [baseRow]);
    expect(await getPhotoScores(db.pool, { model: 'nonexistent', rubricVersion: 'v9' })).toEqual([]);
  });
});
