import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startTestDb, type TestDb } from './test-helpers.js';
import { resolveStateForPoint, listStatesWithBbox } from './state-boundaries.js';

// Real testcontainers (no DB mocks): the `state_boundaries` table + its 49-row
// CONUS seed are applied by startTestDb() running migration
// 1700000050000_state_boundaries.sql (#728). These accessors are pure reads.

let db: TestDb;
beforeAll(async () => { db = await startTestDb(); }, 120_000);
afterAll(async () => { await db?.stop(); });

describe('resolveStateForPoint', () => {
  it('resolves Tucson, AZ to US-AZ', async () => {
    expect(await resolveStateForPoint(db.pool, -110.97, 32.22)).toBe('US-AZ');
  });

  it('resolves a New Mexico point to US-NM (not US-AZ)', async () => {
    const code = await resolveStateForPoint(db.pool, -106.0, 34.5);
    expect(code).toBe('US-NM');
    expect(code).not.toBe('US-AZ');
  });

  it('returns null for a point in the Pacific Ocean (no CONUS state)', async () => {
    expect(await resolveStateForPoint(db.pool, -160, 40)).toBeNull();
  });

  it('resolves a near-border control point a few km inside AZ near the NM line to US-AZ', async () => {
    // Over-simplification guard: a point safely inside AZ but close to the
    // shared NM border must still land in AZ, not vanish or flip to NM. The
    // AZ/NM border sits at lng ~= -109.045; this point is ~15 km west of it.
    expect(await resolveStateForPoint(db.pool, -109.2, 34.0)).toBe('US-AZ');
  });
});

describe('listStatesWithBbox', () => {
  it('returns 49 name-sorted StateSummary rows with a 4-tuple bbox and no geom', async () => {
    const rows = await listStatesWithBbox(db.pool);

    expect(rows).toHaveLength(49);

    // Name-sorted ascending.
    const names = rows.map(r => r.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));

    // Every row is a well-formed StateSummary with a [west, south, east, north]
    // bbox where west < east and south < north.
    for (const r of rows) {
      expect(r.stateCode).toMatch(/^US-[A-Z]{2}$/);
      expect(typeof r.name).toBe('string');
      expect(r.bbox).toHaveLength(4);
      const [w, s, e, n] = r.bbox;
      expect(w).toBeLessThan(e);
      expect(s).toBeLessThan(n);
      // geom must never leave the server — locked decision #7.
      expect(r).not.toHaveProperty('geom');
    }

    // Spot-check Arizona's known summary.
    const az = rows.find(r => r.stateCode === 'US-AZ');
    expect(az?.name).toBe('Arizona');
  });
});
