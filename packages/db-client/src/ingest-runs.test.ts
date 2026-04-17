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
});
