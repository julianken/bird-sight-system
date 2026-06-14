import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { openStore, type EleaticStore } from './store.js';
import type { EvalRunRecord, EvalRowRecord, EvalAdjudicationRecord } from './types.js';

// Raw-column row shapes — asserting against the actual stored TEXT/NULL values,
// not the re-inflated record API, is what proves the serde boundary works.
interface RawRunRow {
  id: string;
  label: string;
  baseline: string | null;
  config_json: string | null;
  started_at: string;
  row_count: number | null;
  metrics_json: string | null;
}
interface RawEvalRow {
  run_id: string;
  row_key: string;
  label: string | null;
  image_url: string | null;
  content_hash: string | null;
  output_json: string | null;
  expected_json: string | null;
  scores_json: string | null;
  metadata_json: string | null;
  trace_json: string | null;
}
interface RawAdjRow {
  row_key: string;
  verdict: string;
  against_hash: string | null;
  note: string | null;
  decided_at: string;
}

function makeRun(over: Partial<EvalRunRecord> = {}): EvalRunRecord {
  return { id: 'run-1', label: 'baseline', startedAt: '2026-06-13T00:00:00Z', ...over };
}
function makeRow(over: Partial<EvalRowRecord> = {}): EvalRowRecord {
  return {
    runId: 'run-1',
    rowKey: 'item-1',
    output: { verdict: 'keep' },
    expected: { verdict: 'keep' },
    ...over,
  };
}

describe('EleaticStore', () => {
  let store: EleaticStore;

  beforeEach(() => {
    store = openStore(':memory:');
  });
  afterEach(() => {
    store.close();
  });

  it('recordRun round-trips JSON config/metrics and stores omitted optionals as SQL NULL', () => {
    store.recordRun(
      makeRun({ config: { mode: 'fast' }, metrics: { agreement: 0.91 }, baseline: 'prev' }),
    );
    const raw = store.db.prepare('SELECT * FROM eval_run WHERE id=?').get('run-1') as RawRunRow;
    expect(JSON.parse(raw.config_json!)).toEqual({ mode: 'fast' });
    expect(JSON.parse(raw.metrics_json!)).toEqual({ agreement: 0.91 });
    expect(raw.baseline).toBe('prev');

    store.recordRun(makeRun({ id: 'run-2' }));
    const bare = store.db.prepare('SELECT * FROM eval_run WHERE id=?').get('run-2') as RawRunRow;
    // Omitted optionals must be SQL NULL — not the string "undefined" and not "null".
    expect(bare.baseline).toBe(null);
    expect(bare.config_json).toBe(null);
    expect(bare.metrics_json).toBe(null);
    expect(bare.row_count).toBe(null);
  });

  it('recordRow round-trips opaque output/expected blobs losslessly without destructuring', () => {
    store.recordRun(makeRun());
    const opaqueOutput = { nested: { a: [1, 2, 3] }, n: 0.5, b: true };
    const opaqueExpected = ['anything', { goes: 'here' }];
    store.recordRow(makeRow({ output: opaqueOutput, expected: opaqueExpected }));
    const raw = store.db
      .prepare('SELECT * FROM eval_row WHERE run_id=? AND row_key=?')
      .get('run-1', 'item-1') as RawEvalRow;
    expect(JSON.parse(raw.output_json!)).toEqual(opaqueOutput);
    expect(JSON.parse(raw.expected_json!)).toEqual(opaqueExpected);
  });

  it('recordRow round-trips an opaque trace blob losslessly without destructuring', () => {
    store.recordRun(makeRun());
    const trace = {
      spans: [
        { name: 'judge', input: { prompt: 'x' }, output: { keep: true }, usage: { promptTokens: 10 } },
      ],
    };
    store.recordRow(makeRow({ rowKey: 'traced', trace }));
    const raw = store.db
      .prepare('SELECT * FROM eval_row WHERE run_id=? AND row_key=?')
      .get('run-1', 'traced') as RawEvalRow;
    expect(JSON.parse(raw.trace_json!)).toEqual(trace);
  });

  it('maps an omitted trace to SQL NULL on write', () => {
    store.recordRun(makeRun());
    store.recordRow(makeRow()); // no trace
    const raw = store.db
      .prepare('SELECT * FROM eval_row WHERE run_id=? AND row_key=?')
      .get('run-1', 'item-1') as RawEvalRow;
    expect(raw.trace_json).toBe(null);
  });

  it('recordRows bulk-inserts ~344 rows inside one transaction', () => {
    store.recordRun(makeRun());
    const rows = Array.from({ length: 344 }, (_, i) =>
      makeRow({ rowKey: `item-${i}`, scores: { quality: i / 344 } }),
    );
    store.recordRows(rows);
    const count = (
      store.db.prepare('SELECT COUNT(*) AS c FROM eval_row WHERE run_id=?').get('run-1') as {
        c: number;
      }
    ).c;
    expect(count).toBe(344);
  });

  it('recordRows rolls ALL rows back when one mid-array row violates the FK (orphan run_id)', () => {
    store.recordRun(makeRun());
    const rows = [
      makeRow({ rowKey: 'ok-1' }),
      makeRow({ rowKey: 'ok-2' }),
      // Orphan run_id -> FK violation mid-array (also a foreign_keys=ON guard).
      makeRow({ runId: 'no-such-run', rowKey: 'orphan' }),
      makeRow({ rowKey: 'ok-3' }),
    ];
    expect(() => store.recordRows(rows)).toThrow();
    // The transaction wrapper must roll the whole batch back — zero rows landed.
    const count = (store.db.prepare('SELECT COUNT(*) AS c FROM eval_row').get() as { c: number }).c;
    expect(count).toBe(0);
  });

  it('cascades deletes from eval_run to eval_row (foreign_keys=ON regression guard)', () => {
    store.recordRun(makeRun());
    store.recordRows([makeRow({ rowKey: 'a' }), makeRow({ rowKey: 'b' })]);
    store.db.prepare('DELETE FROM eval_run WHERE id=?').run('run-1');
    const count = (store.db.prepare('SELECT COUNT(*) AS c FROM eval_row').get() as { c: number }).c;
    expect(count).toBe(0);
  });

  it('maps omitted imageUrl/contentHash/metadata to SQL NULL on write', () => {
    store.recordRun(makeRun());
    store.recordRow(makeRow()); // no imageUrl, contentHash, scores, metadata, label
    const raw = store.db
      .prepare('SELECT * FROM eval_row WHERE run_id=? AND row_key=?')
      .get('run-1', 'item-1') as RawEvalRow;
    expect(raw.image_url).toBe(null);
    expect(raw.content_hash).toBe(null);
    expect(raw.metadata_json).toBe(null);
    expect(raw.scores_json).toBe(null);
    expect(raw.label).toBe(null);
  });

  it('recordAdjudication upserts on row_key (latest verdict/note/decided_at wins, one row)', () => {
    const first: EvalAdjudicationRecord = {
      rowKey: 'item-1',
      verdict: 'keep',
      note: 'looks fine',
      decidedAt: '2026-06-13T00:00:00Z',
    };
    const second: EvalAdjudicationRecord = {
      rowKey: 'item-1',
      verdict: 'replace',
      note: 'on review, swap it',
      decidedAt: '2026-06-13T01:00:00Z',
      againstHash: 'abc123',
    };
    store.recordAdjudication(first);
    store.recordAdjudication(second);
    const all = store.db.prepare('SELECT * FROM eval_adjudication').all() as RawAdjRow[];
    expect(all).toHaveLength(1);
    expect(all[0]!.verdict).toBe('replace');
    expect(all[0]!.note).toBe('on review, swap it');
    expect(all[0]!.decided_at).toBe('2026-06-13T01:00:00Z');
    expect(all[0]!.against_hash).toBe('abc123');
  });

  it('recordAdjudication stores an omitted againstHash/note as SQL NULL', () => {
    store.recordAdjudication({ rowKey: 'item-2', verdict: 'keep', decidedAt: '2026-06-13T00:00:00Z' });
    const raw = store.db
      .prepare('SELECT * FROM eval_adjudication WHERE row_key=?')
      .get('item-2') as RawAdjRow;
    expect(raw.against_hash).toBe(null);
    expect(raw.note).toBe(null);
  });

  it('finalizeRun updates row_count/metrics_json on the existing run without touching rows', () => {
    store.recordRun(makeRun());
    store.recordRows([makeRow({ rowKey: 'a' }), makeRow({ rowKey: 'b' })]);
    store.finalizeRun('run-1', { rowCount: 2, metrics: { agreement: 0.95 } });
    const raw = store.db.prepare('SELECT * FROM eval_run WHERE id=?').get('run-1') as RawRunRow;
    expect(raw.row_count).toBe(2);
    expect(JSON.parse(raw.metrics_json!)).toEqual({ agreement: 0.95 });
    // Rows untouched.
    const count = (store.db.prepare('SELECT COUNT(*) AS c FROM eval_row').get() as { c: number }).c;
    expect(count).toBe(2);
  });

  it('finalizeRun with only metrics leaves row_count NULL', () => {
    store.recordRun(makeRun());
    store.finalizeRun('run-1', { metrics: { agreement: 0.8 } });
    const raw = store.db.prepare('SELECT * FROM eval_run WHERE id=?').get('run-1') as RawRunRow;
    expect(raw.row_count).toBe(null);
    expect(JSON.parse(raw.metrics_json!)).toEqual({ agreement: 0.8 });
  });
});
