import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import type Database from 'better-sqlite3';
import { openDb } from '../db.js';
import { buildEvalRows, mulberry32, shuffleInPlace, DEFAULT_SEED } from './build-dataset.js';

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

/**
 * Insert one photo_current + one role='current' photo_score for a species.
 * `rubricVersion` defaults to the baseline's real provenance stamp ('0.2.1');
 * `rationale` defaults to an Opus-style sentence — pass the det-gate prefix
 * ('deterministic gate failed: …') to seed a heuristic (non-Opus) verdict.
 */
function seedCurrent(
  code: string,
  fields: {
    comName: string;
    sciName: string;
    family: string;
    contentHash: string;
    keep: number | null;
    qualityScore: number | null;
    overall: number;
    rationale?: string | null;
    rubricVersion?: string | null;
  },
): void {
  db.prepare(
    `INSERT INTO photo_current (species_code, com_name, sci_name, family, content_hash)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(code, fields.comName, fields.sciName, fields.family, fields.contentHash);
  db.prepare(
    `INSERT INTO photo_score (species_code, role, content_hash, overall, verdict,
                              criteria_json, flags_json, keep, quality_score, rationale,
                              rubric_version, scored_at)
     VALUES (?, 'current', ?, ?, 'good', '{}', '[]', ?, ?, ?, ?, 'now')`,
  ).run(
    code,
    fields.contentHash,
    fields.overall,
    fields.keep,
    fields.qualityScore,
    fields.rationale === undefined ? 'sharp wild adult, diagnostic marks visible' : fields.rationale,
    fields.rubricVersion === undefined ? '0.2.1' : fields.rubricVersion,
  );
}

/** Write a zero-byte image file `<code>.<ext>` into thumbDir. */
function writeImage(code: string, ext = 'jpg'): void {
  writeFileSync(join(thumbDir, `${code}.${ext}`), '');
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

describe('buildEvalRows', () => {
  // TDD #1: 4 currents (2 keep / 2 not, all keep non-null) + 4 images → 4 rows.
  it('builds one row per current with correct input/expected and contentHash', () => {
    seedCurrent('amerob', { comName: 'American Robin', sciName: 'Turdus migratorius', family: 'Turdidae', contentHash: 'h-amerob', keep: 1, qualityScore: 88, overall: 80 });
    seedCurrent('norcar', { comName: 'Northern Cardinal', sciName: 'Cardinalis cardinalis', family: 'Cardinalidae', contentHash: 'h-norcar', keep: 1, qualityScore: 91, overall: 85 });
    seedCurrent('houspa', { comName: 'House Sparrow', sciName: 'Passer domesticus', family: 'Passeridae', contentHash: 'h-houspa', keep: 0, qualityScore: 40, overall: 45 });
    seedCurrent('rocpig', { comName: 'Rock Pigeon', sciName: 'Columba livia', family: 'Columbidae', contentHash: 'h-rocpig', keep: 0, qualityScore: 30, overall: 35 });
    writeImage('amerob');
    writeImage('norcar', 'png');
    writeImage('houspa', 'webp');
    writeImage('rocpig');

    const rows = buildEvalRows(db, { thumbDir });
    expect(rows).toHaveLength(4);

    const robin = rows.find((r) => r.input.speciesCode === 'amerob')!;
    expect(robin.input).toEqual({
      imagePath: join(thumbDir, 'amerob.jpg'),
      speciesCode: 'amerob',
      comName: 'American Robin',
      sciName: 'Turdus migratorius',
      family: 'Turdidae',
    });
    expect(robin.expected).toEqual({ keep: true, qualityScore: 88 });
    expect(robin.metadata).toEqual({ contentHash: 'h-amerob', expectedRubricVersion: '0.2.1' });

    // Image resolved by extension glob, not hardcoded .jpg.
    expect(basename(rows.find((r) => r.input.speciesCode === 'norcar')!.input.imagePath)).toBe('norcar.png');
    expect(basename(rows.find((r) => r.input.speciesCode === 'houspa')!.input.imagePath)).toBe('houspa.webp');

    const pigeon = rows.find((r) => r.input.speciesCode === 'rocpig')!;
    expect(pigeon.expected).toEqual({ keep: false, qualityScore: 30 });
  });

  // Coalesce rules mirror getScoreByHash (store.ts).
  it('coalesces keep (null⇒true) and qualityScore (null⇒overall)', () => {
    seedCurrent('coales', { comName: 'C', sciName: 'C c', family: 'Fam', contentHash: 'h-coales', keep: null, qualityScore: null, overall: 62 });
    writeImage('coales');

    const rows = buildEvalRows(db, { thumbDir });
    expect(rows).toHaveLength(1);
    expect(rows[0].expected).toEqual({ keep: true, qualityScore: 62 });
  });

  // TDD #2: one image missing → 3 rows, that one skipped + note logged.
  it('skips a current whose image is missing and logs a note', () => {
    seedCurrent('amerob', { comName: 'American Robin', sciName: 'Turdus migratorius', family: 'Turdidae', contentHash: 'h-amerob', keep: 1, qualityScore: 88, overall: 80 });
    seedCurrent('norcar', { comName: 'Northern Cardinal', sciName: 'Cardinalis cardinalis', family: 'Cardinalidae', contentHash: 'h-norcar', keep: 1, qualityScore: 91, overall: 85 });
    seedCurrent('houspa', { comName: 'House Sparrow', sciName: 'Passer domesticus', family: 'Passeridae', contentHash: 'h-houspa', keep: 0, qualityScore: 40, overall: 45 });
    seedCurrent('rocpig', { comName: 'Rock Pigeon', sciName: 'Columba livia', family: 'Columbidae', contentHash: 'h-rocpig', keep: 0, qualityScore: 30, overall: 35 });
    writeImage('amerob');
    writeImage('norcar');
    // houspa image deliberately absent.
    writeImage('rocpig');

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const rows = buildEvalRows(db, { thumbDir });
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.input.speciesCode).sort()).toEqual(['amerob', 'norcar', 'rocpig']);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('houspa');
    warn.mockRestore();
  });

  // TDD #3: sample:2 over 2-keep/2-not → exactly 1 keep + 1 not, exact codes pinned.
  it('stratified sample:2 returns exactly 1 keep + 1 not with the pinned species_codes for the default seed', () => {
    // Insertion order fixes the pre-shuffle stratum order:
    //   keep = [amerob, norcar], not = [houspa, rocpig]
    seedCurrent('amerob', { comName: 'American Robin', sciName: 'Turdus migratorius', family: 'Turdidae', contentHash: 'h-amerob', keep: 1, qualityScore: 88, overall: 80 });
    seedCurrent('norcar', { comName: 'Northern Cardinal', sciName: 'Cardinalis cardinalis', family: 'Cardinalidae', contentHash: 'h-norcar', keep: 1, qualityScore: 91, overall: 85 });
    seedCurrent('houspa', { comName: 'House Sparrow', sciName: 'Passer domesticus', family: 'Passeridae', contentHash: 'h-houspa', keep: 0, qualityScore: 40, overall: 45 });
    seedCurrent('rocpig', { comName: 'Rock Pigeon', sciName: 'Columba livia', family: 'Columbidae', contentHash: 'h-rocpig', keep: 0, qualityScore: 30, overall: 35 });
    for (const c of ['amerob', 'norcar', 'houspa', 'rocpig']) writeImage(c);

    const rows = buildEvalRows(db, { thumbDir, sample: 2 });
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

  // TDD #4: sample:3 (odd) over 2-keep/2-not → rounding rule keepTake=2, notTake=1.
  it('stratified sample:3 applies the rounding rule (keepTake=round(3*2/4)=2, notTake=1)', () => {
    seedCurrent('amerob', { comName: 'American Robin', sciName: 'Turdus migratorius', family: 'Turdidae', contentHash: 'h-amerob', keep: 1, qualityScore: 88, overall: 80 });
    seedCurrent('norcar', { comName: 'Northern Cardinal', sciName: 'Cardinalis cardinalis', family: 'Cardinalidae', contentHash: 'h-norcar', keep: 1, qualityScore: 91, overall: 85 });
    seedCurrent('houspa', { comName: 'House Sparrow', sciName: 'Passer domesticus', family: 'Passeridae', contentHash: 'h-houspa', keep: 0, qualityScore: 40, overall: 45 });
    seedCurrent('rocpig', { comName: 'Rock Pigeon', sciName: 'Columba livia', family: 'Columbidae', contentHash: 'h-rocpig', keep: 0, qualityScore: 30, overall: 35 });
    for (const c of ['amerob', 'norcar', 'houspa', 'rocpig']) writeImage(c);

    const rows = buildEvalRows(db, { thumbDir, sample: 3 });
    expect(rows).toHaveLength(3);
    expect(rows.filter((r) => r.expected.keep)).toHaveLength(2);
    expect(rows.filter((r) => !r.expected.keep)).toHaveLength(1);
    // Pins the deterministic order for the default seed: norcar, amerob (keep), houspa (not).
    expect(rows.map((r) => r.input.speciesCode)).toEqual(['norcar', 'amerob', 'houspa']);
  });

  // C3 polish (#1015): when a species has two cached extensions, the chosen
  // file must be DETERMINISTIC (readdir order is filesystem-dependent). The
  // resolver sorts the listing, so `.jpg` (sorts before `.png`/`.webp`) wins.
  it('deterministically resolves a two-extension species to the sort-first file', () => {
    seedCurrent('amerob', { comName: 'American Robin', sciName: 'Turdus migratorius', family: 'Turdidae', contentHash: 'h-amerob', keep: 1, qualityScore: 88, overall: 80 });
    writeImage('amerob', 'png');
    writeImage('amerob', 'jpg');

    const rows = buildEvalRows(db, { thumbDir });
    expect(rows).toHaveLength(1);
    expect(basename(rows[0].input.imagePath)).toBe('amerob.jpg');
  });

  it('returns all rows unsampled when sample is omitted', () => {
    seedCurrent('amerob', { comName: 'American Robin', sciName: 'Turdus migratorius', family: 'Turdidae', contentHash: 'h-amerob', keep: 1, qualityScore: 88, overall: 80 });
    writeImage('amerob');
    expect(buildEvalRows(db, { thumbDir })).toHaveLength(1);
  });

  // #1037 decision 2: det-gate rows are heuristic verdicts, not Opus findings —
  // the judge must never be graded against them.
  it('excludes deterministic-gate rows from the fetched set', () => {
    seedCurrent('amerob', { comName: 'American Robin', sciName: 'Turdus migratorius', family: 'Turdidae', contentHash: 'h-amerob', keep: 1, qualityScore: 88, overall: 80 });
    seedCurrent('norcar', { comName: 'Northern Cardinal', sciName: 'Cardinalis cardinalis', family: 'Cardinalidae', contentHash: 'h-norcar', keep: 0, qualityScore: 40, overall: 45 });
    seedCurrent('detgat', {
      comName: 'Det Gate', sciName: 'D g', family: 'Fam', contentHash: 'h-detgat',
      keep: 0, qualityScore: 0, overall: 0,
      rationale: 'deterministic gate failed: sharpness 0.00001 below floor 0.00005',
    });
    for (const c of ['amerob', 'norcar', 'detgat']) writeImage(c);

    const rows = buildEvalRows(db, { thumbDir });
    expect(rows.map((r) => r.input.speciesCode).sort()).toEqual(['amerob', 'norcar']);
  });

  // The exclusion predicate must be NULL-safe: `rationale NOT LIKE …` alone is
  // NULL for a NULL rationale, which would silently drop Opus rows without one.
  it('keeps a row whose rationale is NULL (not a det-gate verdict)', () => {
    seedCurrent('norale', { comName: 'No Rationale', sciName: 'N r', family: 'Fam', contentHash: 'h-norale', keep: 1, qualityScore: 70, overall: 70, rationale: null });
    writeImage('norale');

    const rows = buildEvalRows(db, { thumbDir });
    expect(rows.map((r) => r.input.speciesCode)).toEqual(['norale']);
  });

  // #1037 decision 1/3: every row carries the version the baseline was judged
  // under, so the experiment can prove expected == judged criteria per row.
  it('populates metadata.expectedRubricVersion from the DB rubric_version', () => {
    seedCurrent('amerob', { comName: 'American Robin', sciName: 'Turdus migratorius', family: 'Turdidae', contentHash: 'h-amerob', keep: 1, qualityScore: 88, overall: 80 });
    seedCurrent('norcar', { comName: 'Northern Cardinal', sciName: 'Cardinalis cardinalis', family: 'Cardinalidae', contentHash: 'h-norcar', keep: 0, qualityScore: 40, overall: 45 });
    writeImage('amerob');
    writeImage('norcar');

    const rows = buildEvalRows(db, { thumbDir });
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(row.metadata.expectedRubricVersion).toBe('0.2.1');
  });

  // #1037 decision 1: the invariant is asserted over the FULL fetched set
  // BEFORE sampling — a mixed-version DB fails deterministically, regardless of
  // whether the odd row would have landed in the sample.
  it('throws on a mixed rubric_version baseline even when sampling', () => {
    seedCurrent('amerob', { comName: 'American Robin', sciName: 'Turdus migratorius', family: 'Turdidae', contentHash: 'h-amerob', keep: 1, qualityScore: 88, overall: 80 });
    seedCurrent('norcar', { comName: 'Northern Cardinal', sciName: 'Cardinalis cardinalis', family: 'Cardinalidae', contentHash: 'h-norcar', keep: 1, qualityScore: 91, overall: 85 });
    seedCurrent('houspa', { comName: 'House Sparrow', sciName: 'Passer domesticus', family: 'Passeridae', contentHash: 'h-houspa', keep: 0, qualityScore: 40, overall: 45 });
    seedCurrent('rocpig', { comName: 'Rock Pigeon', sciName: 'Columba livia', family: 'Columbidae', contentHash: 'h-rocpig', keep: 0, qualityScore: 30, overall: 35, rubricVersion: '0.2.2' });
    for (const c of ['amerob', 'norcar', 'houspa', 'rocpig']) writeImage(c);

    expect(() => buildEvalRows(db, { thumbDir, sample: 2 })).toThrow(/mixed rubric_version/i);
    // The message names both versions so the operator knows what to re-score.
    expect(() => buildEvalRows(db, { thumbDir, sample: 2 })).toThrow(/0\.2\.1.*0\.2\.2|0\.2\.2.*0\.2\.1/s);
  });

  it('throws when any fetched row has no rubric_version (unknown provenance)', () => {
    seedCurrent('amerob', { comName: 'American Robin', sciName: 'Turdus migratorius', family: 'Turdidae', contentHash: 'h-amerob', keep: 1, qualityScore: 88, overall: 80 });
    seedCurrent('unkver', { comName: 'Unknown Version', sciName: 'U v', family: 'Fam', contentHash: 'h-unkver', keep: 0, qualityScore: 40, overall: 45, rubricVersion: null });
    writeImage('amerob');
    writeImage('unkver');

    expect(() => buildEvalRows(db, { thumbDir })).toThrow(/rubric_version/);
  });

  it('throws on an empty baseline (no version to pin the judge prompt to)', () => {
    expect(() => buildEvalRows(db, { thumbDir })).toThrow(/no role='current' scores/i);
  });
});
