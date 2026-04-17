import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startTestDb, type TestDb } from './test-helpers.js';
import { getRegions } from './regions.js';

let db: TestDb;
beforeAll(async () => { db = await startTestDb(); }, 90_000);
afterAll(async () => { await db?.stop(); });

describe('getRegions', () => {
  it('returns all 9 seeded ecoregions with the expected shape', async () => {
    const rows = await getRegions(db.pool);
    expect(rows).toHaveLength(9);
    const first = rows[0]!;
    expect(first).toHaveProperty('id');
    expect(first).toHaveProperty('name');
    expect(first).toHaveProperty('displayColor');
    expect(first).toHaveProperty('svgPath');
  });

  it('includes the Sky Islands sub-regions', async () => {
    const rows = await getRegions(db.pool);
    const ids = rows.map(r => r.id);
    expect(ids).toContain('sky-islands-santa-ritas');
    expect(ids).toContain('sky-islands-huachucas');
    expect(ids).toContain('sky-islands-chiricahuas');
  });
});
