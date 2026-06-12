import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import type Database from 'better-sqlite3';
import { openDb } from '../db.js';
import {
  buildEvalRows,
  mulberry32,
  shuffleInPlace,
  DEFAULT_SEED,
  parseCriteria,
  criteriaFromRecord,
  resolveBaselinePin,
  DEFAULT_BASELINE_MODEL,
  DEFAULT_BASELINE_RUBRIC,
  type ScoreReader,
} from './build-dataset.js';
import { CRITERIA_KEYS, type CriteriaScores, contentHash } from '@bird-watch/photo-quality';
import type { PhotoScoreRow } from '@bird-watch/shared-types';

let db: Database.Database;
let thumbDir: string;

beforeEach(() => {
  db = openDb(':memory:');
  thumbDir = mkdtempSync(join(tmpdir(), 'eval-thumbs-'));
});
afterEach(() => {
  db.close();
  rmSync(thumbDir, { recursive: true, force: true });
});

/** The frozen-baseline rubric stamp every fixture row shares unless overridden. */
const RUBRIC = '0.2.1';

/**
 * Insert one `photo_current` metadata row (the LOCAL review-store join the eval
 * still reads species name/family/url from; the SCORE comes from the injected
 * prod reader, #1073).
 */
function seedCurrent(
  code: string,
  fields: { comName: string; sciName: string; family: string; url?: string | null },
): void {
  db.prepare(
    `INSERT INTO photo_current (species_code, com_name, sci_name, family, url, content_hash)
     VALUES (?, ?, ?, ?, ?, NULL)`,
  ).run(
    code,
    fields.comName,
    fields.sciName,
    fields.family,
    fields.url === undefined ? `https://photos.bird-maps.com/${code}.jpg` : fields.url,
  );
}

/**
 * Write image bytes `<code>.<ext>` into thumbDir and RETURN their canonical
 * content hash, so a fixture score row can be pinned to the exact local bytes
 * (the same-bytes guarantee, #1073). Distinct `code` → distinct bytes → distinct
 * hash, so a mismatch is engineered by pinning a score to a *different* hash.
 */
function writeImage(code: string, ext = 'jpg'): string {
  const bytes = Buffer.from(`image-bytes-for-${code}.${ext}`);
  writeFileSync(join(thumbDir, `${code}.${ext}`), bytes);
  return contentHash(bytes);
}

/**
 * Build a `PhotoScoreRow` for the prod baseline pin. `contentHash` defaults to a
 * sentinel that will NOT match any local image — callers that want a hash match
 * pass the value returned by {@link writeImage}.
 */
function scoreRow(
  code: string,
  fields: {
    contentHash?: string;
    keep: boolean;
    qualityScore: number | null;
    criteria?: Record<string, number> | null;
    rationale?: string | null;
    model?: string;
    rubricVersion?: string;
  },
): PhotoScoreRow {
  return {
    speciesCode: code,
    contentHash: fields.contentHash ?? `no-match-${code}`,
    model: fields.model ?? DEFAULT_BASELINE_MODEL,
    rubricVersion: fields.rubricVersion ?? RUBRIC,
    keep: fields.keep,
    qualityScore: fields.qualityScore,
    criteria: fields.criteria ?? null,
    fieldMarks: null,
    rationale: fields.rationale ?? 'sharp wild adult, diagnostic marks visible',
  };
}

/** An injected reader that returns the given fixture rows (no DB, no network). */
function reader(rows: PhotoScoreRow[]): ScoreReader {
  return () => Promise.resolve(rows);
}

describe('mulberry32 / shuffleInPlace', () => {
  it('mulberry32 is deterministic for a fixed seed', () => {
    const a = mulberry32(123);
    const b = mulberry32(123);
    const seqA = [a(), a(), a()];
    const seqB = [b(), b(), b()];
    expect(seqA).toEqual(seqB);
    expect(seqA.every((x) => x >= 0 && x < 1)).toBe(true);
  });

  it('shuffleInPlace permutes deterministically per seed', () => {
    const arr1 = ['a', 'b', 'c', 'd', 'e'];
    const arr2 = ['a', 'b', 'c', 'd', 'e'];
    shuffleInPlace(arr1, mulberry32(7));
    shuffleInPlace(arr2, mulberry32(7));
    expect(arr1).toEqual(arr2);
    expect([...arr1].sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
  });
});

describe('resolveBaselinePin', () => {
  it('defaults to the frozen Opus pin (claude-opus-4-8 / 0.2.1)', () => {
    expect(resolveBaselinePin({})).toEqual({
      model: 'claude-opus-4-8',
      rubricVersion: '0.2.1',
    });
    expect(DEFAULT_BASELINE_MODEL).toBe('claude-opus-4-8');
    expect(DEFAULT_BASELINE_RUBRIC).toBe('0.2.1');
  });

  it('respects BASELINE_MODEL / BASELINE_RUBRIC overrides', () => {
    expect(
      resolveBaselinePin({ BASELINE_MODEL: 'gemini-2.5-flash', BASELINE_RUBRIC: '0.3.0' }),
    ).toEqual({ model: 'gemini-2.5-flash', rubricVersion: '0.3.0' });
  });

  it('falls back to defaults for empty-string env vars', () => {
    expect(resolveBaselinePin({ BASELINE_MODEL: '', BASELINE_RUBRIC: '' })).toEqual({
      model: 'claude-opus-4-8',
      rubricVersion: '0.2.1',
    });
  });
});

describe('buildEvalRows', () => {
  // The injected prod reader supplies the scores; the local store supplies the
  // species metadata + image, hash-verified.
  it('builds one row per baseline score with correct input/expected and contentHash', async () => {
    const hRobin = writeImage('amerob');
    const hCard = writeImage('norcar', 'png');
    const hSparrow = writeImage('houspa', 'webp');
    const hPigeon = writeImage('rocpig');
    seedCurrent('amerob', { comName: 'American Robin', sciName: 'Turdus migratorius', family: 'Turdidae' });
    seedCurrent('norcar', { comName: 'Northern Cardinal', sciName: 'Cardinalis cardinalis', family: 'Cardinalidae' });
    seedCurrent('houspa', { comName: 'House Sparrow', sciName: 'Passer domesticus', family: 'Passeridae' });
    seedCurrent('rocpig', { comName: 'Rock Pigeon', sciName: 'Columba livia', family: 'Columbidae' });

    const rows = await buildEvalRows(db, {
      thumbDir,
      getScores: reader([
        scoreRow('amerob', { contentHash: hRobin, keep: true, qualityScore: 88 }),
        scoreRow('norcar', { contentHash: hCard, keep: true, qualityScore: 91 }),
        scoreRow('houspa', { contentHash: hSparrow, keep: false, qualityScore: 40 }),
        scoreRow('rocpig', { contentHash: hPigeon, keep: false, qualityScore: 30 }),
      ]),
    });
    expect(rows).toHaveLength(4);

    const robin = rows.find((r) => r.input.speciesCode === 'amerob')!;
    expect(robin.input).toEqual({
      readPath: join(thumbDir, 'amerob.jpg'),
      imageUrl: 'https://photos.bird-maps.com/amerob.jpg',
      speciesCode: 'amerob',
      comName: 'American Robin',
      sciName: 'Turdus migratorius',
      family: 'Turdidae',
    });
    expect(robin.expected).toEqual({ keep: true, qualityScore: 88 });
    expect(robin.metadata).toEqual({ contentHash: hRobin, expectedRubricVersion: '0.2.1' });

    // Image resolved by extension glob, not hardcoded .jpg — readPath is LOCAL.
    expect(basename(rows.find((r) => r.input.speciesCode === 'norcar')!.input.readPath)).toBe('norcar.png');
    expect(basename(rows.find((r) => r.input.speciesCode === 'houspa')!.input.readPath)).toBe('houspa.webp');

    const pigeon = rows.find((r) => r.input.speciesCode === 'rocpig')!;
    expect(pigeon.expected).toEqual({ keep: false, qualityScore: 30 });
  });

  // keep is a real boolean off the prod row; qualityScore is carried verbatim.
  it('carries keep (boolean) and qualityScore straight off the prod score row', async () => {
    const h = writeImage('coales');
    seedCurrent('coales', { comName: 'C', sciName: 'C c', family: 'Fam' });

    const rows = await buildEvalRows(db, {
      thumbDir,
      getScores: reader([scoreRow('coales', { contentHash: h, keep: true, qualityScore: 62 })]),
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].expected).toEqual({ keep: true, qualityScore: 62 });
  });

  // TDD: one image missing → that row skipped + note logged (the existing
  // absent-image skip behaviour, preserved under the prod read).
  it('skips a score whose image is missing and logs a note', async () => {
    const hRobin = writeImage('amerob');
    const hCard = writeImage('norcar');
    const hPigeon = writeImage('rocpig');
    // houspa image deliberately absent.
    for (const c of ['amerob', 'norcar', 'houspa', 'rocpig']) {
      seedCurrent(c, { comName: c, sciName: `${c} s`, family: 'Fam' });
    }

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const rows = await buildEvalRows(db, {
      thumbDir,
      getScores: reader([
        scoreRow('amerob', { contentHash: hRobin, keep: true, qualityScore: 88 }),
        scoreRow('norcar', { contentHash: hCard, keep: true, qualityScore: 91 }),
        scoreRow('houspa', { keep: false, qualityScore: 40 }),
        scoreRow('rocpig', { contentHash: hPigeon, keep: false, qualityScore: 30 }),
      ]),
    });
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.input.speciesCode).sort()).toEqual(['amerob', 'norcar', 'rocpig']);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('houspa');
    expect(warn.mock.calls[0][0]).toContain('no cached image');
    warn.mockRestore();
  });

  // #1073 same-bytes integrity: a local image whose hash ≠ the score's
  // content_hash is skipped (logged), mirroring the absent-image skip — Gemini
  // must never score different bytes than the Opus baseline did.
  it('skips a score whose local image hash ≠ the baseline content_hash and logs a note', async () => {
    const hRobin = writeImage('amerob'); // real local hash
    writeImage('norcar'); // present, but the score below pins a DIFFERENT hash
    seedCurrent('amerob', { comName: 'American Robin', sciName: 'Turdus migratorius', family: 'Turdidae' });
    seedCurrent('norcar', { comName: 'Northern Cardinal', sciName: 'Cardinalis cardinalis', family: 'Cardinalidae' });

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const rows = await buildEvalRows(db, {
      thumbDir,
      getScores: reader([
        scoreRow('amerob', { contentHash: hRobin, keep: true, qualityScore: 88 }),
        // contentHash deliberately does NOT match norcar's local bytes.
        scoreRow('norcar', { contentHash: 'deadbeef', keep: true, qualityScore: 91 }),
      ]),
    });
    expect(rows.map((r) => r.input.speciesCode)).toEqual(['amerob']);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('norcar');
    expect(warn.mock.calls[0][0]).toMatch(/hash|content_hash/i);
    warn.mockRestore();
  });

  // A matching hash is kept (the positive half of the same-bytes test).
  it('keeps a score whose local image hash matches the baseline content_hash', async () => {
    const h = writeImage('amerob');
    seedCurrent('amerob', { comName: 'American Robin', sciName: 'Turdus migratorius', family: 'Turdidae' });

    const rows = await buildEvalRows(db, {
      thumbDir,
      getScores: reader([scoreRow('amerob', { contentHash: h, keep: true, qualityScore: 88 })]),
    });
    expect(rows.map((r) => r.input.speciesCode)).toEqual(['amerob']);
    expect(rows[0].metadata.contentHash).toBe(h);
  });

  // A score with no local photo_current metadata row can't be built → skipped.
  it('skips a score with no local photo_current metadata row and logs a note', async () => {
    const hRobin = writeImage('amerob');
    writeImage('orphan'); // image exists but no photo_current row
    seedCurrent('amerob', { comName: 'American Robin', sciName: 'Turdus migratorius', family: 'Turdidae' });

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const rows = await buildEvalRows(db, {
      thumbDir,
      getScores: reader([
        scoreRow('amerob', { contentHash: hRobin, keep: true, qualityScore: 88 }),
        scoreRow('orphan', { keep: true, qualityScore: 70 }),
      ]),
    });
    expect(rows.map((r) => r.input.speciesCode)).toEqual(['amerob']);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('orphan');
    expect(warn.mock.calls[0][0]).toContain('photo_current');
    warn.mockRestore();
  });

  // TDD: sample:2 over 2-keep/2-not → exactly 1 keep + 1 not, exact codes pinned.
  it('stratified sample:2 returns exactly 1 keep + 1 not with the pinned species_codes for the default seed', async () => {
    // Reader order fixes the pre-shuffle stratum order:
    //   keep = [amerob, norcar], not = [houspa, rocpig]
    const h: Record<string, string> = {};
    for (const c of ['amerob', 'norcar', 'houspa', 'rocpig']) {
      h[c] = writeImage(c);
      seedCurrent(c, { comName: c, sciName: `${c} s`, family: 'Fam' });
    }

    const rows = await buildEvalRows(db, {
      thumbDir,
      sample: 2,
      getScores: reader([
        scoreRow('amerob', { contentHash: h.amerob, keep: true, qualityScore: 88 }),
        scoreRow('norcar', { contentHash: h.norcar, keep: true, qualityScore: 91 }),
        scoreRow('houspa', { contentHash: h.houspa, keep: false, qualityScore: 40 }),
        scoreRow('rocpig', { contentHash: h.rocpig, keep: false, qualityScore: 30 }),
      ]),
    });
    expect(rows).toHaveLength(2);
    expect(rows.filter((r) => r.expected.keep)).toHaveLength(1);
    expect(rows.filter((r) => !r.expected.keep)).toHaveLength(1);
    // Pins mulberry32(DEFAULT_SEED) + Fisher–Yates: norcar (keep) then houspa (not).
    expect(rows.map((r) => r.input.speciesCode)).toEqual(['norcar', 'houspa']);
  });

  // The pin must be tied to the documented default seed value.
  it('uses 0xb12d as the default seed (rendered from the issue label 0xB1RD)', () => {
    expect(DEFAULT_SEED).toBe(0xb12d);
  });

  // TDD: sample:3 (odd) over 2-keep/2-not → rounding rule keepTake=2, notTake=1.
  it('stratified sample:3 applies the rounding rule (keepTake=round(3*2/4)=2, notTake=1)', async () => {
    const h: Record<string, string> = {};
    for (const c of ['amerob', 'norcar', 'houspa', 'rocpig']) {
      h[c] = writeImage(c);
      seedCurrent(c, { comName: c, sciName: `${c} s`, family: 'Fam' });
    }

    const rows = await buildEvalRows(db, {
      thumbDir,
      sample: 3,
      getScores: reader([
        scoreRow('amerob', { contentHash: h.amerob, keep: true, qualityScore: 88 }),
        scoreRow('norcar', { contentHash: h.norcar, keep: true, qualityScore: 91 }),
        scoreRow('houspa', { contentHash: h.houspa, keep: false, qualityScore: 40 }),
        scoreRow('rocpig', { contentHash: h.rocpig, keep: false, qualityScore: 30 }),
      ]),
    });
    expect(rows).toHaveLength(3);
    expect(rows.filter((r) => r.expected.keep)).toHaveLength(2);
    expect(rows.filter((r) => !r.expected.keep)).toHaveLength(1);
    // Pins the deterministic order for the default seed: norcar, amerob (keep), houspa (not).
    expect(rows.map((r) => r.input.speciesCode)).toEqual(['norcar', 'amerob', 'houspa']);
  });

  // When a species has two cached extensions, the chosen file must be
  // DETERMINISTIC (readdir order is filesystem-dependent). The resolver sorts
  // the listing, so `.jpg` (sorts before `.png`) wins — and the HASH-VERIFY
  // pins to that sort-first file's bytes.
  it('deterministically resolves a two-extension species to the sort-first file', async () => {
    const hJpg = writeImage('amerob', 'jpg');
    writeImage('amerob', 'png');
    seedCurrent('amerob', { comName: 'American Robin', sciName: 'Turdus migratorius', family: 'Turdidae' });

    const rows = await buildEvalRows(db, {
      thumbDir,
      getScores: reader([scoreRow('amerob', { contentHash: hJpg, keep: true, qualityScore: 88 })]),
    });
    expect(rows).toHaveLength(1);
    expect(basename(rows[0].input.readPath)).toBe('amerob.jpg');
  });

  it('returns all rows unsampled when sample is omitted', async () => {
    const h = writeImage('amerob');
    seedCurrent('amerob', { comName: 'American Robin', sciName: 'Turdus migratorius', family: 'Turdidae' });
    const rows = await buildEvalRows(db, {
      thumbDir,
      getScores: reader([scoreRow('amerob', { contentHash: h, keep: true, qualityScore: 88 })]),
    });
    expect(rows).toHaveLength(1);
  });

  // #1037 decision 2 (now via the pin): det-gate rows carry
  // model='deterministic-gate', so the pinned `getPhotoScores(..., model:opus)`
  // never returns them — they cannot reach the dataset.
  it('never sees deterministic-gate rows because the pin filters them out at the reader', async () => {
    const hRobin = writeImage('amerob');
    const hCard = writeImage('norcar');
    for (const c of ['amerob', 'norcar']) seedCurrent(c, { comName: c, sciName: `${c} s`, family: 'Fam' });

    // The injected reader stands in for `getPhotoScores(pool, {model:'claude-opus-4-8', …})`:
    // it returns ONLY Opus rows (the det-gate rows don't match the model filter).
    const rows = await buildEvalRows(db, {
      thumbDir,
      getScores: reader([
        scoreRow('amerob', { contentHash: hRobin, keep: true, qualityScore: 88 }),
        scoreRow('norcar', { contentHash: hCard, keep: false, qualityScore: 40 }),
      ]),
    });
    expect(rows.map((r) => r.input.speciesCode).sort()).toEqual(['amerob', 'norcar']);
  });

  // #1037 decision 1: every row carries the rubric version it was judged under.
  it('populates metadata.expectedRubricVersion from the score row rubric_version', async () => {
    const hRobin = writeImage('amerob');
    const hCard = writeImage('norcar');
    seedCurrent('amerob', { comName: 'American Robin', sciName: 'Turdus migratorius', family: 'Turdidae' });
    seedCurrent('norcar', { comName: 'Northern Cardinal', sciName: 'Cardinalis cardinalis', family: 'Cardinalidae' });

    const rows = await buildEvalRows(db, {
      thumbDir,
      getScores: reader([
        scoreRow('amerob', { contentHash: hRobin, keep: true, qualityScore: 88 }),
        scoreRow('norcar', { contentHash: hCard, keep: false, qualityScore: 40 }),
      ]),
    });
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(row.metadata.expectedRubricVersion).toBe('0.2.1');
  });

  // #1037 decision 1: the invariant is asserted over the FULL fetched set BEFORE
  // sampling. With the prod pin it's trivially satisfied, but the guard still
  // fails loud on a mixed-version reader fixture (a defensive backstop).
  it('throws on a mixed rubric_version baseline even when sampling', async () => {
    for (const c of ['amerob', 'norcar', 'houspa', 'rocpig']) {
      writeImage(c);
      seedCurrent(c, { comName: c, sciName: `${c} s`, family: 'Fam' });
    }
    const rows = [
      scoreRow('amerob', { keep: true, qualityScore: 88 }),
      scoreRow('norcar', { keep: true, qualityScore: 91 }),
      scoreRow('houspa', { keep: false, qualityScore: 40 }),
      scoreRow('rocpig', { keep: false, qualityScore: 30, rubricVersion: '0.2.2' }),
    ];
    await expect(buildEvalRows(db, { thumbDir, sample: 2, getScores: reader(rows) })).rejects.toThrow(
      /mixed rubric_version/i,
    );
    await expect(buildEvalRows(db, { thumbDir, sample: 2, getScores: reader(rows) })).rejects.toThrow(
      /0\.2\.1.*0\.2\.2|0\.2\.2.*0\.2\.1/s,
    );
  });

  it('throws on an empty baseline (no version to pin the judge prompt to)', async () => {
    await expect(buildEvalRows(db, { thumbDir, getScores: reader([]) })).rejects.toThrow(
      /no scores returned/i,
    );
  });

  // #1067: the R2 URL is logged VERBATIM (mixed extensions) — distinct from the
  // LOCAL readPath.
  it('carries photo_current.url verbatim (mixed extensions) as imageUrl, distinct from readPath', async () => {
    const hRobin = writeImage('amerob'); // local cache is .jpg even though the R2 URL is .jpeg
    const hCard = writeImage('norcar', 'png');
    seedCurrent('amerob', {
      comName: 'American Robin', sciName: 'Turdus migratorius', family: 'Turdidae',
      url: 'https://photos.bird-maps.com/amerob.jpeg',
    });
    seedCurrent('norcar', {
      comName: 'Northern Cardinal', sciName: 'Cardinalis cardinalis', family: 'Cardinalidae',
      url: 'https://photos.bird-maps.com/norcar.png',
    });

    const rows = await buildEvalRows(db, {
      thumbDir,
      getScores: reader([
        scoreRow('amerob', { contentHash: hRobin, keep: true, qualityScore: 88 }),
        scoreRow('norcar', { contentHash: hCard, keep: true, qualityScore: 91 }),
      ]),
    });
    const robin = rows.find((r) => r.input.speciesCode === 'amerob')!;
    expect(robin.input.imageUrl).toBe('https://photos.bird-maps.com/amerob.jpeg');
    expect(robin.input.readPath).toBe(join(thumbDir, 'amerob.jpg'));
    expect(robin.input.imageUrl).not.toBe(robin.input.readPath);

    const card = rows.find((r) => r.input.speciesCode === 'norcar')!;
    expect(card.input.imageUrl).toBe('https://photos.bird-maps.com/norcar.png');
  });

  // A NULL photo_current.url becomes '' (the verbatim contract carries no URL).
  it('uses empty-string imageUrl when photo_current.url is NULL', async () => {
    const h = writeImage('amerob');
    seedCurrent('amerob', { comName: 'American Robin', sciName: 'Turdus migratorius', family: 'Turdidae', url: null });
    const rows = await buildEvalRows(db, {
      thumbDir,
      getScores: reader([scoreRow('amerob', { contentHash: h, keep: true, qualityScore: 88 })]),
    });
    expect(rows[0].input.imageUrl).toBe('');
  });

  // #1067: the Opus per-axis sub-scores ride into expected.criteria (now from
  // the prod JSONB `criteria`, already deserialized to an object).
  it('populates expected.criteria from a prod criteria object', async () => {
    const criteria: CriteriaScores = { framing: 8, subjectClarity: 7, liveness: 10, naturalness: 4, pose: 6, background: 5, lighting: 9 };
    const h = writeImage('amerob');
    seedCurrent('amerob', { comName: 'American Robin', sciName: 'Turdus migratorius', family: 'Turdidae' });
    const rows = await buildEvalRows(db, {
      thumbDir,
      getScores: reader([scoreRow('amerob', { contentHash: h, keep: true, qualityScore: 88, criteria })]),
    });
    expect(rows[0].expected.criteria).toEqual(criteria);
  });

  // #1067: a NULL criteria must yield `undefined` (an axis-skip), NOT `{}`.
  it('leaves expected.criteria undefined (not {}) for a NULL criteria', async () => {
    const h = writeImage('amerob');
    seedCurrent('amerob', { comName: 'American Robin', sciName: 'Turdus migratorius', family: 'Turdidae' });
    const rows = await buildEvalRows(db, {
      thumbDir,
      getScores: reader([scoreRow('amerob', { contentHash: h, keep: true, qualityScore: 88, criteria: null })]),
    });
    expect(rows[0].expected.criteria).toBeUndefined();
    expect('criteria' in rows[0].expected).toBe(false);
  });
});

describe('parseCriteria', () => {
  it('parses a full 7-axis blob', () => {
    const criteria: CriteriaScores = { framing: 8, subjectClarity: 7, liveness: 10, naturalness: 4, pose: 6, background: 5, lighting: 9 };
    expect(parseCriteria(JSON.stringify(criteria))).toEqual(criteria);
  });

  it('returns undefined for NULL or empty input', () => {
    expect(parseCriteria(null)).toBeUndefined();
    expect(parseCriteria('')).toBeUndefined();
  });

  it('returns undefined for an empty object (no axes — never {})', () => {
    expect(parseCriteria('{}')).toBeUndefined();
  });

  it('returns undefined for a partial blob missing an axis (skip, never fabricate)', () => {
    const partial: Record<string, number> = {};
    for (const k of CRITERIA_KEYS) partial[k] = 5;
    delete partial.lighting;
    expect(parseCriteria(JSON.stringify(partial))).toBeUndefined();
  });

  it('returns undefined for a malformed blob rather than throwing', () => {
    expect(parseCriteria('{not json')).toBeUndefined();
    expect(parseCriteria('[1,2,3]')).toBeUndefined();
    expect(parseCriteria('"a string"')).toBeUndefined();
  });
});

describe('criteriaFromRecord', () => {
  it('coerces a full 7-axis record', () => {
    const criteria: CriteriaScores = { framing: 8, subjectClarity: 7, liveness: 10, naturalness: 4, pose: 6, background: 5, lighting: 9 };
    expect(criteriaFromRecord(criteria)).toEqual(criteria);
  });

  it('returns undefined for null', () => {
    expect(criteriaFromRecord(null)).toBeUndefined();
  });

  it('returns undefined for an empty object (no axes — never {})', () => {
    expect(criteriaFromRecord({})).toBeUndefined();
  });

  it('returns undefined for a partial record missing an axis (skip, never fabricate)', () => {
    const partial: Record<string, number> = {};
    for (const k of CRITERIA_KEYS) partial[k] = 5;
    delete partial.pose;
    expect(criteriaFromRecord(partial)).toBeUndefined();
  });
});
