import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { startTestDb, type TestDb } from './test-helpers.js';
import {
  startIngestRun, finishIngestRun, getRecentIngestRuns,
} from './ingest-runs.js';

let db: TestDb;
beforeAll(async () => { db = await startTestDb(); }, 90_000);
beforeEach(async () => { await db.pool.query('TRUNCATE ingest_runs RESTART IDENTITY'); });
afterAll(async () => { await db?.stop(); });

describe('ingest runs', () => {
  it('records a successful run from start to finish', async () => {
    const id = await startIngestRun(db.pool, 'recent');
    expect(id).toBeGreaterThan(0);
    await finishIngestRun(db.pool, id, {
      status: 'success', obsFetched: 100, obsUpserted: 100,
    });
    const rows = await getRecentIngestRuns(db.pool, 5);
    expect(rows[0]).toMatchObject({
      kind: 'recent', status: 'success', obsFetched: 100, obsUpserted: 100,
    });
    expect(rows[0]?.finishedAt).not.toBeNull();
  });

  it('records a failed run with error message', async () => {
    const id = await startIngestRun(db.pool, 'recent');
    await finishIngestRun(db.pool, id, {
      status: 'failure', errorMessage: 'eBird timeout',
    });
    const rows = await getRecentIngestRuns(db.pool, 5);
    expect(rows[0]?.status).toBe('failure');
    expect(rows[0]?.errorMessage).toBe('eBird timeout');
  });

  it('type-rejects finishing to running status', () => {
    // This test is compile-time only. The @ts-expect-error below confirms that
    // passing 'running' to finishIngestRun is rejected by TypeScript.
    // The function is never actually called at runtime.
    const _typeCheck = (pool: typeof db.pool, id: number) => {
      // @ts-expect-error — 'running' is not a terminal status
      void finishIngestRun(pool, id, { status: 'running' });
    };
    void _typeCheck; // suppress unused-variable warning
  });

  it('records a started run with status=running until finished', async () => {
    const id = await startIngestRun(db.pool, 'recent');
    const runs = await getRecentIngestRuns(db.pool, 10);
    const run = runs.find(r => r.id === id);
    expect(run).toBeDefined();
    expect(run!.status).toBe('running');
    await finishIngestRun(db.pool, id, { status: 'success', obsFetched: 5, obsUpserted: 5 });
    const after = (await getRecentIngestRuns(db.pool, 10)).find(r => r.id === id);
    expect(after!.status).toBe('success');
  });
});
