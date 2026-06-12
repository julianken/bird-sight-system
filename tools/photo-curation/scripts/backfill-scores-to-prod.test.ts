import { describe, it, expect, vi } from 'vitest';
import {
  mapRow,
  runBackfill,
  OPUS_MODEL,
  DET_GATE_MODEL,
  RUBRIC_VERSION,
  type ReviewScoreRow,
} from './backfill-scores-to-prod.js';

/**
 * A representative Opus-judged `role='current'` row as `better-sqlite3` returns
 * it (verbatim shapes pulled from the real review.sqlite baseline): keep is the
 * SQLite INTEGER 0/1, criteria_json / field_marks are JSON strings, quality_score
 * is a REAL.
 */
const opusRow: ReviewScoreRow = {
  species_code: 'abetow',
  content_hash: '8d556766',
  keep: 0,
  quality_score: 58,
  criteria_json:
    '{"framing":8,"subjectClarity":7,"liveness":10,"naturalness":4,"pose":8,"background":7,"lighting":7}',
  field_marks: '["Black mask","Pinkish conical bill"]',
  rationale: 'A live, sharp wild bird … should be replaced for a premium guide.',
};

/** A deterministic-gate row: rationale starts 'deterministic gate', keep=0, score=0, empty field_marks. */
const detGateRow: ReviewScoreRow = {
  species_code: 'baitea',
  content_hash: 'e6c1dc40',
  keep: 0,
  quality_score: 0,
  criteria_json:
    '{"framing":0,"subjectClarity":0,"liveness":0,"naturalness":0,"pose":0,"background":0,"lighting":0}',
  field_marks: '[]',
  rationale: 'deterministic gate failed: below-min-sharpness',
};

describe('mapRow — provenance + field mapping (locked)', () => {
  it('maps an Opus-judged row to the claude-opus-4-8 model pin', () => {
    const out = mapRow(opusRow);
    expect(out.model).toBe(OPUS_MODEL);
    expect(out.model).toBe('claude-opus-4-8');
    expect(out.rubricVersion).toBe(RUBRIC_VERSION);
    expect(out.rubricVersion).toBe('0.2.1');
  });

  it('maps a deterministic-gate row (rationale starts "deterministic gate") to the deterministic-gate model — NOT the Opus pin', () => {
    const out = mapRow(detGateRow);
    expect(out.model).toBe(DET_GATE_MODEL);
    expect(out.model).toBe('deterministic-gate');
    expect(out.model).not.toBe(OPUS_MODEL);
    expect(out.rubricVersion).toBe('0.2.1');
  });

  it('preserves content_hash verbatim', () => {
    expect(mapRow(opusRow).contentHash).toBe('8d556766');
    expect(mapRow(detGateRow).contentHash).toBe('e6c1dc40');
  });

  it('converts the SQLite INTEGER keep flag to a boolean', () => {
    expect(mapRow(opusRow).keep).toBe(false);
    expect(mapRow({ ...opusRow, keep: 1 }).keep).toBe(true);
  });

  it('carries quality_score verbatim (det-gate keeps its 0, not null)', () => {
    expect(mapRow(opusRow).qualityScore).toBe(58);
    expect(mapRow(detGateRow).qualityScore).toBe(0);
  });

  it('parses criteria_json into the criteria object', () => {
    expect(mapRow(opusRow).criteria).toEqual({
      framing: 8,
      subjectClarity: 7,
      liveness: 10,
      naturalness: 4,
      pose: 8,
      background: 7,
      lighting: 7,
    });
  });

  it('parses field_marks into a string array (empty array stays empty, never null)', () => {
    expect(mapRow(opusRow).fieldMarks).toEqual(['Black mask', 'Pinkish conical bill']);
    expect(mapRow(detGateRow).fieldMarks).toEqual([]);
  });

  it('carries rationale verbatim', () => {
    expect(mapRow(detGateRow).rationale).toBe('deterministic gate failed: below-min-sharpness');
  });

  it('handles NULL json + score columns as SQL NULL (defensive — real baseline has none)', () => {
    const nullish: ReviewScoreRow = {
      species_code: 'nullsp',
      content_hash: 'deadbeef',
      keep: 1,
      quality_score: null,
      criteria_json: null,
      field_marks: null,
      rationale: null,
    };
    const out = mapRow(nullish);
    expect(out.qualityScore).toBeNull();
    expect(out.criteria).toBeNull();
    expect(out.fieldMarks).toBeNull();
    expect(out.rationale).toBeNull();
    expect(out.keep).toBe(true);
    expect(out.contentHash).toBe('deadbeef');
    // Non-det-gate (null rationale) defaults to the Opus pin.
    expect(out.model).toBe(OPUS_MODEL);
  });
});

describe('runBackfill — summary + idempotency (injected insert, no network)', () => {
  it('maps every row and reports read / inserted / skipped from the inserted count', async () => {
    const rows: ReviewScoreRow[] = [opusRow, detGateRow, { ...opusRow, species_code: 'annhum', content_hash: 'cafe' }];
    // First run: the prod table is empty, so insertPhotoScores inserts all 3.
    const insert = vi.fn(async (toInsert) => toInsert.length);
    const log = vi.fn();

    const summary = await runBackfill({ rows, insert, log });

    expect(summary).toEqual({ read: 3, inserted: 3, skipped: 0 });
    expect(insert).toHaveBeenCalledTimes(1);
    const mapped = insert.mock.calls[0]![0];
    expect(mapped).toHaveLength(3);
    expect(mapped[0]!.model).toBe(OPUS_MODEL);
    expect(mapped[1]!.model).toBe(DET_GATE_MODEL);
    // The summary line is printed.
    expect(log.mock.calls.flat().join(' ')).toMatch(/read 3.*inserted 3.*skipped-existing 0/s);
  });

  it('reports inserted=0 / skipped=N on a second run (ON CONFLICT DO NOTHING)', async () => {
    const rows: ReviewScoreRow[] = [opusRow, detGateRow];
    // Second run: every tuple already exists, insertPhotoScores returns 0.
    const insert = vi.fn(async () => 0);

    const summary = await runBackfill({ rows, insert, log: () => {} });

    expect(summary).toEqual({ read: 2, inserted: 0, skipped: 2 });
  });

  it('handles an empty baseline (read 0, inserted 0)', async () => {
    const summary = await runBackfill({ rows: [], insert: async () => 0, log: () => {} });
    expect(summary).toEqual({ read: 0, inserted: 0, skipped: 0 });
  });
});
