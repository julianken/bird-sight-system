import { describe, it, expect, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb } from '../db.js';
import {
  insertEvalRun,
  insertEvalResult,
  readEvalRun,
  readEvalResults,
  type EvalRunRecord,
  type EvalResultRecord,
} from './store.js';

let db: Database.Database | undefined;
afterEach(() => {
  db?.close();
  db = undefined;
});

const RUN: EvalRunRecord = {
  id: 'gemini-2.5-flash-1700000000',
  model: 'gemini-2.5-flash',
  baselineModel: 'claude-opus-4-8',
  baselineRubric: '0.2.1',
  sampleSize: 150,
  startedAt: '2026-06-12T00:00:00.000Z',
  agreement: 0.8, // 0–1 fraction, NOT a percent (#1094 unit contract)
  falseKeep: 2,
  falseReplace: 5,
  scoreMae: 0.12,
  totalCost: 1.23,
};

const RESULT: EvalResultRecord = {
  runId: RUN.id,
  speciesCode: 'amerob',
  comName: 'American Robin',
  contentHash: 'abc123',
  sourceUrl: 'https://photos.bird-maps.com/amerob.jpeg',
  geminiKeep: true,
  geminiQuality: 82,
  geminiCriteriaJson: JSON.stringify({ framing: 8, subjectClarity: 9 }),
  opusKeep: true,
  opusQuality: 85,
  cost: 0.0042,
  promptTokens: 1200,
  completionTokens: 64,
};

describe('insertEvalRun / readEvalRun', () => {
  it('round-trips an eval run, preserving the fraction-form aggregates', () => {
    db = openDb(':memory:');
    insertEvalRun(db, RUN);

    const back = readEvalRun(db, RUN.id);
    expect(back).toEqual(RUN);
    // The agreement aggregate stays a 0–1 fraction across the write/read.
    expect(back!.agreement).toBe(0.8);
  });

  it('returns undefined for an unknown run id', () => {
    db = openDb(':memory:');
    expect(readEvalRun(db, 'nope')).toBeUndefined();
  });
});

describe('insertEvalResult / readEvalResults', () => {
  it('round-trips a result row, mapping booleans ↔ 0/1', () => {
    db = openDb(':memory:');
    insertEvalRun(db, RUN);
    insertEvalResult(db, RESULT);

    const rows = readEvalResults(db, RUN.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(RESULT);
    // booleans survive the INTEGER round-trip.
    expect(rows[0]!.geminiKeep).toBe(true);
    expect(rows[0]!.opusKeep).toBe(true);
  });

  it('preserves an unpriced (undefined cost) judgment as undefined, not 0', () => {
    db = openDb(':memory:');
    insertEvalRun(db, RUN);
    const unpriced: EvalResultRecord = {
      ...RESULT,
      speciesCode: 'btbwar',
      cost: undefined,
      promptTokens: undefined,
      completionTokens: undefined,
      geminiCriteriaJson: null,
    };
    insertEvalResult(db, unpriced);

    const rows = readEvalResults(db, RUN.id);
    const got = rows.find((r) => r.speciesCode === 'btbwar')!;
    expect(got.cost).toBeUndefined();
    expect(got.promptTokens).toBeUndefined();
    expect(got.completionTokens).toBeUndefined();
    expect(got.geminiCriteriaJson).toBeNull();
  });

  it('reads back only the rows for the requested run, ordered by species_code', () => {
    db = openDb(':memory:');
    insertEvalRun(db, RUN);
    const other: EvalRunRecord = { ...RUN, id: 'other-run' };
    insertEvalRun(db, other);

    insertEvalResult(db, { ...RESULT, speciesCode: 'zebra', runId: RUN.id });
    insertEvalResult(db, { ...RESULT, speciesCode: 'alpha', runId: RUN.id });
    insertEvalResult(db, { ...RESULT, speciesCode: 'xeno', runId: other.id });

    const rows = readEvalResults(db, RUN.id);
    expect(rows.map((r) => r.speciesCode)).toEqual(['alpha', 'zebra']);
  });
});
