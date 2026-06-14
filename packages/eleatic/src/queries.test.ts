import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { openStore, type EleaticStore } from './store.js';
import { makeReader, type EleaticReader } from './queries.js';
import type { EvalRunRecord, EvalRowRecord } from './types.js';

// Pure-unit suite against `:memory:` better-sqlite3 — no network, no disk
// fixtures, no DB mocks. Seed via E1's writers so the read path is exercised
// against real persisted rows. `makeRun`/`makeRow` mirror the grounding
// `baseResult(over)` factory: a default record merged with a `Partial` override.

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

describe('makeReader', () => {
  let store: EleaticStore;
  let reader: EleaticReader;

  beforeEach(() => {
    store = openStore(':memory:');
    reader = makeReader(store.db);
  });
  afterEach(() => {
    store.close();
  });

  describe('listRuns', () => {
    it('returns one entry per run, newest started_at first', () => {
      store.recordRun(makeRun({ id: 'old', startedAt: '2026-06-10T00:00:00Z' }));
      store.recordRun(makeRun({ id: 'new', startedAt: '2026-06-12T00:00:00Z' }));
      expect(reader.listRuns().map((r) => r.id)).toEqual(['new', 'old']);
    });

    it('returns an empty array when no runs exist', () => {
      expect(reader.listRuns()).toEqual([]);
    });

    it('round-trips run metrics exactly and omits absent optionals', () => {
      store.recordRun(makeRun({ id: 'r', metrics: { agreement: 0.7867 }, baseline: 'prev' }));
      const [run] = reader.listRuns();
      expect(run?.metrics).toEqual({ agreement: 0.7867 });
      expect(run?.metrics?.agreement).toBe(0.7867);
      expect(run?.baseline).toBe('prev');
      // Absent optionals must read back as omitted keys, not null.
      expect('config' in (run ?? {})).toBe(false);
      expect('rowCount' in (run ?? {})).toBe(false);
    });
  });

  describe('getRun', () => {
    it('returns the mapped record for a present id', () => {
      store.recordRun(makeRun({ id: 'present', config: { mode: 'fast' } }));
      const run = reader.getRun('present');
      expect(run?.id).toBe('present');
      expect(run?.config).toEqual({ mode: 'fast' });
    });

    it('returns undefined for an absent id', () => {
      expect(reader.getRun('nope')).toBeUndefined();
    });
  });

  describe('getRows / getRow', () => {
    beforeEach(() => {
      store.recordRun(makeRun());
      store.recordRun(makeRun({ id: 'run-2' }));
      store.recordRows([
        makeRow({ rowKey: 'b' }),
        makeRow({ rowKey: 'a' }),
        makeRow({ runId: 'run-2', rowKey: 'z' }),
      ]);
    });

    it('returns rows scoped to run_id, ordered by row_key', () => {
      expect(reader.getRows('run-1').map((r) => r.rowKey)).toEqual(['a', 'b']);
      expect(reader.getRows('run-2').map((r) => r.rowKey)).toEqual(['z']);
    });

    it('getRow returns the row for a present (runId,rowKey)', () => {
      expect(reader.getRow('run-1', 'a')?.rowKey).toBe('a');
    });

    it('getRow returns undefined for an absent (runId,rowKey)', () => {
      expect(reader.getRow('run-1', 'nope')).toBeUndefined();
    });
  });

  describe('NULL mapping', () => {
    it('reads omitted image_url/content_hash back as undefined/absent keys', () => {
      store.recordRun(makeRun());
      // No imageUrl, contentHash, label, scores, metadata.
      store.recordRow(makeRow({ rowKey: 'bare' }));
      const row = reader.getRow('run-1', 'bare');
      expect(row).toBeDefined();
      expect(row?.imageUrl).toBeUndefined();
      expect(row?.contentHash).toBeUndefined();
      expect('imageUrl' in (row ?? {})).toBe(false);
      expect('contentHash' in (row ?? {})).toBe(false);
      expect('label' in (row ?? {})).toBe(false);
      expect('scores' in (row ?? {})).toBe(false);
      expect('metadata' in (row ?? {})).toBe(false);
    });

    it('round-trips scores numbers exactly', () => {
      store.recordRun(makeRun());
      store.recordRow(makeRow({ rowKey: 'scored', scores: { candidateQuality: 0.7867 } }));
      const row = reader.getRow('run-1', 'scored');
      expect(row?.scores).toEqual({ candidateQuality: 0.7867 });
      expect(row?.scores?.candidateQuality).toBe(0.7867);
    });

    it('round-trips opaque output/expected blobs losslessly', () => {
      store.recordRun(makeRun());
      const output = { nested: { a: [1, 2, 3] }, n: 0.5, b: true };
      const expected = ['anything', { goes: 'here' }];
      store.recordRow(makeRow({ rowKey: 'opaque', output, expected }));
      const row = reader.getRow('run-1', 'opaque');
      expect(row?.output).toEqual(output);
      expect(row?.expected).toEqual(expected);
    });
  });

  describe('trace (single-row read path only)', () => {
    const trace = {
      spans: [
        { name: 'judge', input: { prompt: 'x' }, output: { keep: true }, usage: { promptTokens: 10 } },
      ],
    };

    beforeEach(() => {
      store.recordRun(makeRun());
      store.recordRow(makeRow({ rowKey: 'traced', trace }));
      store.recordRow(makeRow({ rowKey: 'untraced' })); // no trace
    });

    it('getRow round-trips the opaque trace blob losslessly', () => {
      expect(reader.getRow('run-1', 'traced')?.trace).toEqual(trace);
    });

    it('getRow reads an omitted trace back as an absent key (NULL → undefined)', () => {
      const row = reader.getRow('run-1', 'untraced');
      expect(row?.trace).toBeUndefined();
      expect('trace' in (row ?? {})).toBe(false);
    });

    it('getRows NEVER carries trace — list payloads stay lean', () => {
      const rows = reader.getRows('run-1');
      const traced = rows.find((r) => r.rowKey === 'traced');
      expect(traced).toBeDefined();
      expect(traced?.trace).toBeUndefined();
      expect('trace' in (traced ?? {})).toBe(false);
    });

    it('facetRows NEVER carries trace — list payloads stay lean', () => {
      const rows = reader.facetRows('run-1', {});
      const traced = rows.find((r) => r.rowKey === 'traced');
      expect(traced).toBeDefined();
      expect('trace' in (traced ?? {})).toBe(false);
    });
  });

  describe('facetRows — the generalization of evalFalseKeeps', () => {
    // Port the four-row arrangement from the grounding evalFalseKeeps test:
    // metadata.disagreement ∈ {falseKeep, agree, falseReplace, bothReplace}.
    beforeEach(() => {
      store.recordRun(makeRun());
      store.recordRun(makeRun({ id: 'run-2' }));
      store.recordRows([
        // The one true falseKeep.
        makeRow({
          rowKey: 'falsekeep',
          metadata: { disagreement: 'falseKeep' },
          scores: { candidateQuality: 72 },
        }),
        makeRow({
          rowKey: 'agree',
          metadata: { disagreement: 'agree' },
          scores: { candidateQuality: 80 },
        }),
        makeRow({
          rowKey: 'falsereplace',
          metadata: { disagreement: 'falseReplace' },
          scores: { candidateQuality: 30 },
        }),
        makeRow({
          rowKey: 'bothreplace',
          metadata: { disagreement: 'bothReplace' },
          scores: { candidateQuality: 10 },
        }),
        // A row in a different run with the same disagreement value.
        makeRow({
          runId: 'run-2',
          rowKey: 'other-run-falsekeep',
          metadata: { disagreement: 'falseKeep' },
          scores: { candidateQuality: 99 },
        }),
      ]);
    });

    it('returns exactly the falseKeep row(s) — the old evalFalseKeeps result', () => {
      const rows = reader.facetRows('run-1', {
        filters: [{ path: 'metadata.disagreement', op: 'eq', value: 'falseKeep' }],
      });
      expect(rows.map((r) => r.rowKey)).toEqual(['falsekeep']);
    });

    it('filters a numeric scores range correctly (gte)', () => {
      const rows = reader.facetRows('run-1', {
        filters: [{ path: 'scores.candidateQuality', op: 'gte', value: 70 }],
      });
      expect(rows.map((r) => r.rowKey).sort()).toEqual(['agree', 'falsekeep']);
    });

    it('supports lt / ne / in / exists operators', () => {
      expect(
        reader
          .facetRows('run-1', { filters: [{ path: 'scores.candidateQuality', op: 'lt', value: 30 }] })
          .map((r) => r.rowKey),
      ).toEqual(['bothreplace']);
      expect(
        reader
          .facetRows('run-1', {
            filters: [{ path: 'metadata.disagreement', op: 'ne', value: 'agree' }],
          })
          .map((r) => r.rowKey)
          .sort(),
      ).toEqual(['bothreplace', 'falsekeep', 'falsereplace']);
      expect(
        reader
          .facetRows('run-1', {
            filters: [
              { path: 'metadata.disagreement', op: 'in', value: ['falseKeep', 'falseReplace'] },
            ],
          })
          .map((r) => r.rowKey)
          .sort(),
      ).toEqual(['falsekeep', 'falsereplace']);
      // exists: every seeded row has metadata.disagreement → all 4 in run-1.
      expect(
        reader.facetRows('run-1', {
          filters: [{ path: 'metadata.disagreement', op: 'exists' }],
        }),
      ).toHaveLength(4);
    });

    it('sorts by a scores path ascending and descending', () => {
      const asc = reader.facetRows('run-1', {
        sort: { path: 'scores.candidateQuality', dir: 'asc' },
      });
      expect(asc.map((r) => r.rowKey)).toEqual(['bothreplace', 'falsereplace', 'falsekeep', 'agree']);
      const desc = reader.facetRows('run-1', {
        sort: { path: 'scores.candidateQuality', dir: 'desc' },
      });
      expect(desc.map((r) => r.rowKey)).toEqual(['agree', 'falsekeep', 'falsereplace', 'bothreplace']);
    });

    it('caps the returned count with limit (and offset paginates)', () => {
      const page = reader.facetRows('run-1', {
        sort: { path: 'scores.candidateQuality', dir: 'desc' },
        limit: 2,
      });
      expect(page.map((r) => r.rowKey)).toEqual(['agree', 'falsekeep']);
      const next = reader.facetRows('run-1', {
        sort: { path: 'scores.candidateQuality', dir: 'desc' },
        limit: 2,
        offset: 2,
      });
      expect(next.map((r) => r.rowKey)).toEqual(['falsereplace', 'bothreplace']);
    });

    it('throws on an invalid path prefix', () => {
      expect(() =>
        reader.facetRows('run-1', { filters: [{ path: 'foo.bar', op: 'eq', value: 1 }] }),
      ).toThrow();
    });

    it('throws on an unknown key (validated against discovered keys)', () => {
      expect(() =>
        reader.facetRows('run-1', {
          filters: [{ path: 'metadata.notAKey', op: 'eq', value: 'x' }],
        }),
      ).toThrow();
      expect(() =>
        reader.facetRows('run-1', { sort: { path: 'scores.notAScore', dir: 'asc' } }),
      ).toThrow();
    });

    it('scopes to the given runId only', () => {
      const r1 = reader.facetRows('run-1', {
        filters: [{ path: 'metadata.disagreement', op: 'eq', value: 'falseKeep' }],
      });
      expect(r1.map((r) => r.rowKey)).toEqual(['falsekeep']);
      const r2 = reader.facetRows('run-2', {
        filters: [{ path: 'metadata.disagreement', op: 'eq', value: 'falseKeep' }],
      });
      expect(r2.map((r) => r.rowKey)).toEqual(['other-run-falsekeep']);
    });

    it('returns all rows for an empty query', () => {
      expect(reader.facetRows('run-1', {})).toHaveLength(4);
    });
  });

  describe('diffRuns', () => {
    beforeEach(() => {
      store.recordRun(makeRun({ id: 'a' }));
      store.recordRun(makeRun({ id: 'b' }));
      store.recordRows([
        makeRow({ runId: 'a', rowKey: 'both', scores: { q: 1 } }),
        makeRow({ runId: 'a', rowKey: 'only-a', scores: { q: 2 } }),
        makeRow({ runId: 'b', rowKey: 'both', scores: { q: 3 } }),
        makeRow({ runId: 'b', rowKey: 'only-b', scores: { q: 4 } }),
      ]);
    });

    it('surfaces per-row_key divergence: present-in-both, only-in-a, only-in-b', () => {
      const diff = reader.diffRuns('a', 'b');
      const byKey = new Map(diff.map((d) => [d.rowKey, d]));
      expect([...byKey.keys()].sort()).toEqual(['both', 'only-a', 'only-b']);

      const both = byKey.get('both');
      expect(both?.a?.scores).toEqual({ q: 1 });
      expect(both?.b?.scores).toEqual({ q: 3 });

      const onlyA = byKey.get('only-a');
      expect(onlyA?.a?.scores).toEqual({ q: 2 });
      expect(onlyA?.b).toBeUndefined();

      const onlyB = byKey.get('only-b');
      expect(onlyB?.a).toBeUndefined();
      expect(onlyB?.b?.scores).toEqual({ q: 4 });
    });
  });

  describe('metricTrend', () => {
    it('returns points ordered oldest→newest (started_at ASC)', () => {
      store.recordRun(makeRun({ id: 'mid', startedAt: '2026-06-11T00:00:00Z', metrics: { agreement: 0.8 } }));
      store.recordRun(makeRun({ id: 'old', startedAt: '2026-06-10T00:00:00Z', metrics: { agreement: 0.78 } }));
      store.recordRun(makeRun({ id: 'new', startedAt: '2026-06-12T00:00:00Z', metrics: { agreement: 0.9 } }));
      const trend = reader.metricTrend('agreement');
      expect(trend.map((p) => p.runId)).toEqual(['old', 'mid', 'new']);
      expect(trend.map((p) => p.value)).toEqual([0.78, 0.8, 0.9]);
      expect(trend.map((p) => p.startedAt)).toEqual([
        '2026-06-10T00:00:00Z',
        '2026-06-11T00:00:00Z',
        '2026-06-12T00:00:00Z',
      ]);
    });

    it('handles a run missing the named metric (value undefined)', () => {
      store.recordRun(makeRun({ id: 'has', startedAt: '2026-06-10T00:00:00Z', metrics: { agreement: 0.8 } }));
      store.recordRun(makeRun({ id: 'lacks', startedAt: '2026-06-11T00:00:00Z', metrics: { other: 1 } }));
      store.recordRun(makeRun({ id: 'none', startedAt: '2026-06-12T00:00:00Z' }));
      const trend = reader.metricTrend('agreement');
      expect(trend.map((p) => p.runId)).toEqual(['has', 'lacks', 'none']);
      expect(trend[0]?.value).toBe(0.8);
      expect(trend[1]?.value).toBeUndefined();
      expect(trend[2]?.value).toBeUndefined();
    });

    it('returns an empty array when no runs exist', () => {
      expect(reader.metricTrend('agreement')).toEqual([]);
    });
  });

  describe('listAdjudications / isStale', () => {
    it('returns recorded adjudications, optionally filtered by rowKeys', () => {
      store.recordAdjudication({
        rowKey: 'item-1',
        verdict: 'keep',
        decidedAt: '2026-06-13T00:00:00Z',
        againstHash: 'h1',
      });
      store.recordAdjudication({
        rowKey: 'item-2',
        verdict: 'replace',
        decidedAt: '2026-06-13T01:00:00Z',
      });
      expect(reader.listAdjudications().map((a) => a.rowKey).sort()).toEqual(['item-1', 'item-2']);
      const one = reader.listAdjudications(['item-1']);
      expect(one.map((a) => a.rowKey)).toEqual(['item-1']);
      expect(one[0]?.verdict).toBe('keep');
      expect(one[0]?.againstHash).toBe('h1');
      // Omitted optionals read back absent.
      const two = reader.listAdjudications(['item-2']);
      expect(two[0]?.againstHash).toBeUndefined();
      expect('note' in (two[0] ?? {})).toBe(false);
    });

    it('listAdjudications([]) returns no rows', () => {
      store.recordAdjudication({ rowKey: 'item-1', verdict: 'keep', decidedAt: '2026-06-13T00:00:00Z' });
      expect(reader.listAdjudications([])).toEqual([]);
    });

    it('isStale: true when recorded against_hash differs, false when equal', () => {
      store.recordAdjudication({
        rowKey: 'item-1',
        verdict: 'keep',
        decidedAt: '2026-06-13T00:00:00Z',
        againstHash: 'h1',
      });
      expect(reader.isStale('item-1', 'h2')).toBe(true);
      expect(reader.isStale('item-1', 'h1')).toBe(false);
    });

    it('isStale: false when the recorded hash is absent or no adjudication exists', () => {
      store.recordAdjudication({ rowKey: 'no-hash', verdict: 'keep', decidedAt: '2026-06-13T00:00:00Z' });
      expect(reader.isStale('no-hash', 'anything')).toBe(false);
      expect(reader.isStale('never-adjudicated', 'anything')).toBe(false);
    });
  });
});
