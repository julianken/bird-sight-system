import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb } from '../db.js';
import { insertEvalRun, insertEvalResult, type EvalResultRecord } from '../eval/store.js';
import { evalRuns, evalFalseKeeps } from './eval-queries.js';

// Seed an in-memory store (the PR1 #1094 schema + helpers) — no network, no
// fixtures on disk. The unit contract that load-bears here: `agreement` and
// `score_mae` are 0–1 FRACTIONS, so the derived gate is `agreement >= 0.90`.

function baseResult(over: Partial<EvalResultRecord> = {}): EvalResultRecord {
  return {
    runId: 'r1',
    speciesCode: 'houspa',
    comName: 'House Sparrow',
    contentHash: 'h1',
    sourceUrl: 'https://photos.bird-maps.com/houspa.webp',
    geminiKeep: true,
    geminiQuality: 80,
    geminiCriteriaJson: null,
    opusKeep: true,
    opusQuality: 78,
    cost: 0.01,
    promptTokens: 100,
    completionTokens: 20,
    ...over,
  };
}

describe('evalRuns', () => {
  let db: Database.Database;
  beforeEach(() => { db = openDb(':memory:'); });
  afterEach(() => db.close());

  it('returns one row per run, newest started_at first, with a derived gate', () => {
    insertEvalRun(db, {
      id: 'old', model: 'gemini-2.0', baselineModel: 'opus-4', baselineRubric: 'v0.2.2',
      sampleSize: 150, startedAt: '2026-06-10T00:00:00Z',
      agreement: 0.9, falseKeep: 5, falseReplace: 27, scoreMae: 0.12, totalCost: 4.2,
    });
    insertEvalRun(db, {
      id: 'new', model: 'gemini-2.5', baselineModel: 'opus-4', baselineRubric: 'v0.2.2',
      sampleSize: 150, startedAt: '2026-06-12T00:00:00Z',
      agreement: 0.7867, falseKeep: 5, falseReplace: 27, scoreMae: 0.2, totalCost: 4.0,
    });

    const runs = evalRuns(db);
    expect(runs.map((r) => r.id)).toEqual(['new', 'old']); // newest first

    const newest = runs[0];
    expect(newest.model).toBe('gemini-2.5');
    expect(newest.baselineModel).toBe('opus-4');
    expect(newest.baselineRubric).toBe('v0.2.2');
    expect(newest.sampleSize).toBe(150);
    expect(newest.agreement).toBe(0.7867);
    expect(newest.falseKeep).toBe(5);
    expect(newest.falseReplace).toBe(27);
    expect(newest.scoreMae).toBe(0.2);
    expect(newest.totalCost).toBe(4.0);
    expect(newest.startedAt).toBe('2026-06-12T00:00:00Z');
  });

  // Gate boundary — both sides of 0.90, with the value in FRACTION units so a
  // percent-vs-fraction slip cannot pass silently.
  it('gates PASS at exactly agreement = 0.90 (fraction)', () => {
    insertEvalRun(db, {
      id: 'boundary', model: 'm', baselineModel: 'b', baselineRubric: 'rb',
      sampleSize: 10, startedAt: '2026-06-12T00:00:00Z',
      agreement: 0.9, falseKeep: 0, falseReplace: 0, scoreMae: 0.1, totalCost: 0,
    });
    expect(evalRuns(db)[0].gate).toBe('PASS');
  });

  it('gates fail at agreement = 0.89 (fraction)', () => {
    insertEvalRun(db, {
      id: 'boundary', model: 'm', baselineModel: 'b', baselineRubric: 'rb',
      sampleSize: 10, startedAt: '2026-06-12T00:00:00Z',
      agreement: 0.89, falseKeep: 0, falseReplace: 0, scoreMae: 0.1, totalCost: 0,
    });
    expect(evalRuns(db)[0].gate).toBe('fail');
  });

  it('returns an empty array when no runs exist', () => {
    expect(evalRuns(db)).toEqual([]);
  });
});

describe('evalFalseKeeps', () => {
  let db: Database.Database;
  beforeEach(() => { db = openDb(':memory:'); });
  afterEach(() => db.close());

  it('returns only the gemini_keep=1 ∧ opus_keep=0 rows for the run', () => {
    insertEvalRun(db, {
      id: 'r1', model: 'm', baselineModel: 'b', baselineRubric: 'rb',
      sampleSize: 4, startedAt: '2026-06-12T00:00:00Z',
      agreement: 0.5, falseKeep: 1, falseReplace: 1, scoreMae: 0.2, totalCost: 0,
    });
    // The one true falseKeep: Gemini keeps (1), Opus replaces (0).
    insertEvalResult(db, baseResult({
      speciesCode: 'falsekeep', comName: 'False Keeper',
      geminiKeep: true, geminiQuality: 72, opusKeep: false, opusQuality: 30,
    }));
    // Agreement (both keep) — excluded.
    insertEvalResult(db, baseResult({ speciesCode: 'agree', geminiKeep: true, opusKeep: true }));
    // False replace (Gemini replaces, Opus keeps) — excluded.
    insertEvalResult(db, baseResult({ speciesCode: 'falsereplace', geminiKeep: false, opusKeep: true }));
    // Both replace — excluded.
    insertEvalResult(db, baseResult({ speciesCode: 'bothreplace', geminiKeep: false, opusKeep: false }));

    const fks = evalFalseKeeps(db, 'r1');
    expect(fks).toHaveLength(1);
    const fk = fks[0];
    expect(fk.speciesCode).toBe('falsekeep');
    expect(fk.comName).toBe('False Keeper');
    expect(fk.sourceUrl).toBe('https://photos.bird-maps.com/houspa.webp');
    expect(fk.geminiQuality).toBe(72);
    expect(fk.opusQuality).toBe(30);
  });

  it('scopes to the given run only', () => {
    insertEvalRun(db, {
      id: 'r1', model: 'm', baselineModel: 'b', baselineRubric: 'rb',
      sampleSize: 1, startedAt: '2026-06-12T00:00:00Z',
      agreement: 0.5, falseKeep: 1, falseReplace: 0, scoreMae: 0.2, totalCost: 0,
    });
    insertEvalRun(db, {
      id: 'r2', model: 'm', baselineModel: 'b', baselineRubric: 'rb',
      sampleSize: 1, startedAt: '2026-06-11T00:00:00Z',
      agreement: 0.5, falseKeep: 1, falseReplace: 0, scoreMae: 0.2, totalCost: 0,
    });
    insertEvalResult(db, baseResult({ runId: 'r1', speciesCode: 'a', geminiKeep: true, opusKeep: false }));
    insertEvalResult(db, baseResult({ runId: 'r2', speciesCode: 'b', geminiKeep: true, opusKeep: false }));

    expect(evalFalseKeeps(db, 'r1').map((f) => f.speciesCode)).toEqual(['a']);
    expect(evalFalseKeeps(db, 'r2').map((f) => f.speciesCode)).toEqual(['b']);
  });

  it('returns an empty array for a run with no false keeps', () => {
    insertEvalRun(db, {
      id: 'clean', model: 'm', baselineModel: 'b', baselineRubric: 'rb',
      sampleSize: 1, startedAt: '2026-06-12T00:00:00Z',
      agreement: 1, falseKeep: 0, falseReplace: 0, scoreMae: 0, totalCost: 0,
    });
    insertEvalResult(db, baseResult({ runId: 'clean', geminiKeep: true, opusKeep: true }));
    expect(evalFalseKeeps(db, 'clean')).toEqual([]);
  });
});
