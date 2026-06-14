import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from './app.js';
import { openStore, type EleaticStore } from '../store.js';
import type { EleaticConfig } from '../config.js';

// A minimal, generic config: a default verdict vocabulary, one named metric
// formatter, and a declarative gate. No domain (bird/photo) assumptions.
const cfg: EleaticConfig = {
  verdictVocabulary: ['keep', 'replace', 'uncertain'],
  imageHostAllowlist: ['https://*'],
  themeKey: 'eleatic-theme',
  metricFormatters: { agreement: 'percent' },
  gate: { metric: 'agreement', op: 'gte', threshold: 0.9 },
  dbPath: '/secret/eval.sqlite', // server-only — must never reach /config.js
};

/**
 * Seed an in-memory store via E1's WRITE path only (no hand-written DDL — that
 * would couple the test to schema internals E1 owns). Two runs so diff/trends
 * have something to compare; rows carry scores + metadata so facet filtering and
 * key-discovery validation are exercised.
 */
function seedStore(): EleaticStore {
  const store = openStore(':memory:');
  store.recordRun({ id: 'run-a', label: 'baseline', startedAt: '2026-06-01T00:00:00Z' });
  store.recordRun({
    id: 'run-b',
    label: 'candidate',
    baseline: 'run-a',
    startedAt: '2026-06-02T00:00:00Z',
  });
  store.recordRows([
    {
      runId: 'run-a',
      rowKey: 'item-1',
      contentHash: 'h1-a',
      output: { keep: true },
      expected: { keep: true },
      scores: { quality: 80 },
      metadata: { disagreement: 'agree' },
    },
    {
      runId: 'run-a',
      rowKey: 'item-2',
      contentHash: 'h2-a',
      output: { keep: true },
      expected: { keep: false },
      scores: { quality: 55 },
      metadata: { disagreement: 'falseKeep' },
      trace: {
        spans: [
          { name: 'judge', input: { prompt: 'p' }, output: { keep: true }, usage: { promptTokens: 12 } },
        ],
      },
    },
  ]);
  store.recordRows([
    {
      runId: 'run-b',
      rowKey: 'item-1',
      contentHash: 'h1-b',
      output: { keep: false },
      expected: { keep: true },
      scores: { quality: 40 },
      metadata: { disagreement: 'falseReplace' },
    },
    {
      runId: 'run-b',
      rowKey: 'item-2',
      contentHash: 'h2-b',
      output: { keep: true },
      expected: { keep: false },
      scores: { quality: 60 },
      metadata: { disagreement: 'falseKeep' },
    },
  ]);
  store.finalizeRun('run-a', { rowCount: 2, metrics: { agreement: 0.5 } });
  store.finalizeRun('run-b', { rowCount: 2, metrics: { agreement: 0.75 } });
  return store;
}

describe('eleatic server', () => {
  let store: EleaticStore;
  beforeEach(() => { store = seedStore(); });
  afterEach(() => store.close());

  it('GET /api/runs lists runs newest-first', async () => {
    const res = await request(createApp(store, cfg)).get('/api/runs');
    expect(res.status).toBe(200);
    expect(res.body.runs.map((r: { id: string }) => r.id)).toEqual(['run-b', 'run-a']);
  });

  it('GET /api/runs/:id returns a run; 404 for unknown', async () => {
    const app = createApp(store, cfg);
    const ok = await request(app).get('/api/runs/run-a');
    expect(ok.status).toBe(200);
    expect(ok.body.run.id).toBe('run-a');
    expect((await request(app).get('/api/runs/bogus')).status).toBe(404);
  });

  it('GET /api/diff compares two runs; 400 on missing param, 404 on unknown', async () => {
    const app = createApp(store, cfg);
    const ok = await request(app).get('/api/diff?a=run-a&b=run-b');
    expect(ok.status).toBe(200);
    expect(ok.body.diff.length).toBe(2); // item-1 + item-2, each present on both sides
    const byKey = Object.fromEntries(ok.body.diff.map((d: { rowKey: string }) => [d.rowKey, d]));
    expect(byKey['item-1'].a.rowKey).toBe('item-1');
    expect(byKey['item-1'].b.rowKey).toBe('item-1');

    expect((await request(app).get('/api/diff?a=run-a')).status).toBe(400);
    expect((await request(app).get('/api/diff?b=run-b')).status).toBe(400);
    expect((await request(app).get('/api/diff?a=run-a&b=nope')).status).toBe(404);
    expect((await request(app).get('/api/diff?a=nope&b=run-b')).status).toBe(404);
  });

  it('GET /api/rows returns all rows for a run', async () => {
    const res = await request(createApp(store, cfg)).get('/api/rows?run=run-a');
    expect(res.status).toBe(200);
    expect(res.body.rows.map((r: { rowKey: string }) => r.rowKey)).toEqual(['item-1', 'item-2']);
    // The list payload stays lean: trace is never carried, even for a traced row.
    const traced = res.body.rows.find((r: { rowKey: string }) => r.rowKey === 'item-2');
    expect(traced.trace).toBeUndefined();
  });

  it('GET /api/rows with f= filters (generalized falseKeep gallery)', async () => {
    const res = await request(createApp(store, cfg))
      .get('/api/rows?run=run-b&f=metadata.disagreement:eq:falseKeep');
    expect(res.status).toBe(200);
    expect(res.body.rows.map((r: { rowKey: string }) => r.rowKey)).toEqual(['item-2']);
  });

  it('GET /api/rows validation: 400 missing run, 400 malformed/unknown facet path, 404 unknown run', async () => {
    const app = createApp(store, cfg);
    expect((await request(app).get('/api/rows')).status).toBe(400); // missing run
    expect((await request(app).get('/api/rows?run=nope')).status).toBe(404); // unknown run
    // malformed f= (no colons)
    expect((await request(app).get('/api/rows?run=run-a&f=garbage')).status).toBe(400);
    // path not among discovered keys for this run
    expect(
      (await request(app).get('/api/rows?run=run-a&f=metadata.nonexistent:eq:x')).status,
    ).toBe(400);
    // bad prefix (neither scores nor metadata)
    expect(
      (await request(app).get('/api/rows?run=run-a&f=other.x:eq:y')).status,
    ).toBe(400);
  });

  it('GET /api/row returns one row; 400 on missing param, 404 on unknown row', async () => {
    const app = createApp(store, cfg);
    const ok = await request(app).get('/api/row?run=run-a&row=item-1');
    expect(ok.status).toBe(200);
    expect(ok.body.row.rowKey).toBe('item-1');
    expect((await request(app).get('/api/row?run=run-a')).status).toBe(400);
    expect((await request(app).get('/api/row?row=item-1')).status).toBe(400);
    expect((await request(app).get('/api/row?run=run-a&row=ghost')).status).toBe(404);
    expect((await request(app).get('/api/row?run=nope&row=item-1')).status).toBe(404);
  });

  it('GET /api/row returns the per-row trace verbatim (drill-down only)', async () => {
    const app = createApp(store, cfg);
    const traced = await request(app).get('/api/row?run=run-a&row=item-2');
    expect(traced.status).toBe(200);
    expect(traced.body.row.trace).toEqual({
      spans: [
        { name: 'judge', input: { prompt: 'p' }, output: { keep: true }, usage: { promptTokens: 12 } },
      ],
    });
    // A row with no trace omits the key entirely.
    const untraced = await request(app).get('/api/row?run=run-a&row=item-1');
    expect(untraced.body.row.trace).toBeUndefined();
  });

  it('GET /api/trends returns trend points; 400 when metric omitted', async () => {
    const app = createApp(store, cfg);
    const ok = await request(app).get('/api/trends?metric=agreement');
    expect(ok.status).toBe(200);
    // newest-first is for listRuns; metricTrend is chronological (asc) by E2.
    expect(ok.body.trend.map((p: { runId: string; value: number }) => [p.runId, p.value]))
      .toEqual([['run-a', 0.5], ['run-b', 0.75]]);
    expect((await request(app).get('/api/trends')).status).toBe(400);
  });

  it('GET /api/adjudications flags isStale when against_hash diverges from current content_hash', async () => {
    // Record one verdict against the CURRENT hash (fresh) and one against a stale hash.
    store.recordAdjudication({ rowKey: 'item-1', verdict: 'keep', againstHash: 'h1-a', decidedAt: '2026-06-03T00:00:00Z' });
    store.recordAdjudication({ rowKey: 'item-2', verdict: 'replace', againstHash: 'OLD-HASH', decidedAt: '2026-06-03T00:00:00Z' });
    const res = await request(createApp(store, cfg)).get('/api/adjudications?run=run-a');
    expect(res.status).toBe(200);
    const byKey = Object.fromEntries(
      res.body.adjudications.map((a: { rowKey: string }) => [a.rowKey, a]),
    );
    expect(byKey['item-1'].isStale).toBe(false); // matches current content_hash
    expect(byKey['item-2'].isStale).toBe(true); // OLD-HASH !== h2-a
  });

  it('POST /api/adjudications round-trips (upsert on row_key) + captures against_hash', async () => {
    const app = createApp(store, cfg);
    const post = await request(app)
      .post('/api/adjudications')
      .send({ rowKey: 'item-1', verdict: 'keep', run: 'run-a', note: 'looks good' });
    expect(post.status).toBe(200);

    const list = await request(app).get('/api/adjudications?run=run-a');
    const item1 = list.body.adjudications.find((a: { rowKey: string }) => a.rowKey === 'item-1');
    expect(item1.verdict).toBe('keep');
    expect(item1.note).toBe('looks good');
    // against_hash captured from the row's current content_hash at decision time.
    expect(item1.againstHash).toBe('h1-a');
    expect(item1.isStale).toBe(false);

    // Upsert: a second POST for the same row_key replaces, not duplicates.
    await request(app).post('/api/adjudications').send({ rowKey: 'item-1', verdict: 'replace', run: 'run-a' });
    const list2 = await request(app).get('/api/adjudications?run=run-a');
    const dupes = list2.body.adjudications.filter((a: { rowKey: string }) => a.rowKey === 'item-1');
    expect(dupes).toHaveLength(1);
    expect(dupes[0].verdict).toBe('replace');
  });

  it('POST /api/adjudications rejects out-of-vocabulary verdict (400) and missing rowKey (400)', async () => {
    const app = createApp(store, cfg);
    expect(
      (await request(app).post('/api/adjudications').send({ rowKey: 'item-1', verdict: 'frobnicate' })).status,
    ).toBe(400);
    expect(
      (await request(app).post('/api/adjudications').send({ verdict: 'keep' })).status,
    ).toBe(400);
  });

  it('GET / serves the comparison hub page (200 HTML, wires hub.js)', async () => {
    // E5 replaced E4's placeholder ui/index.html with the real hub. The route
    // is unchanged (express.static + the explicit GET / fallback); this asserts
    // the served page is the hub (title + the hub.js module tag), not the stub.
    const res = await request(createApp(store, cfg)).get('/');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.text).toContain('<title>eleatic · eval explorer</title>');
    expect(res.text).toContain('src="/hub.js"');
  });

  it('GET /trace serves the two-pane trace explorer shell (200 HTML, wires trace-view-page.js)', async () => {
    // T4: a bare sendFile route mirroring /diff & /facets (no new /api endpoint —
    // the page fetches the EXISTING GET /api/row). Assert the served page is the
    // two-pane trace shell (title + the trace-view-page.js module tag).
    const res = await request(createApp(store, cfg)).get('/trace');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.text).toContain('src="/trace-view-page.js"');
  });

  it('GET /config.js emits a parseable ESM client slice and OMITS server-only fields', async () => {
    const res = await request(createApp(store, cfg)).get('/config.js');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/javascript/);
    // body is `export const config = {...};` — extract + parse the object literal.
    const match = /export const config = (\{[\s\S]*\});\s*$/.exec(res.text);
    expect(match).not.toBeNull();
    const parsed = JSON.parse(match![1]) as Record<string, unknown>;
    expect(parsed.verdictVocabulary).toEqual(['keep', 'replace', 'uncertain']);
    expect(parsed.gate).toEqual({ metric: 'agreement', op: 'gte', threshold: 0.9 });
    expect(parsed.metricFormatters).toEqual({ agreement: 'percent' });
    expect(parsed.imageHostAllowlist).toEqual(['https://*']);
    expect('dbPath' in parsed).toBe(false); // server-only field must not leak
  });
});
