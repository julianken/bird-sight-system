import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startTestDb, type TestDb } from './test-helpers.js';
import { getSilhouettes } from './silhouettes.js';

let db: TestDb;
beforeAll(async () => { db = await startTestDb(); }, 90_000);
afterAll(async () => { await db?.stop(); });

describe('getSilhouettes', () => {
  it('returns all 15 seeded families', async () => {
    const rows = await getSilhouettes(db.pool);
    expect(rows).toHaveLength(15);
  });

  it('projects each row with familyCode, color, svgData, source, license', async () => {
    const rows = await getSilhouettes(db.pool);
    const accipitridae = rows.find(r => r.familyCode === 'accipitridae');
    expect(accipitridae).toBeDefined();
    expect(accipitridae!.color).toMatch(/^#[0-9A-F]{6}$/i);
    // svgData is nullable on the type but the pre-curation seed uses real
    // strings for every row, so it's a string here.
    expect(typeof accipitridae!.svgData).toBe('string');
    // source and license are TEXT NULL in the schema. The current seed writes
    // non-null values; the test just asserts the SELECT includes them.
    expect(accipitridae).toHaveProperty('source');
    expect(accipitridae).toHaveProperty('license');
  });

  it('returns rows in stable familyCode order', async () => {
    const rows = await getSilhouettes(db.pool);
    const codes = rows.map(r => r.familyCode);
    const sorted = [...codes].sort();
    expect(codes).toEqual(sorted);
  });

  it('colors match the legacy FAMILY_TO_COLOR snapshot (parity with deleted hardcoded map)', async () => {
    // This snapshot IS the parity test required by issue #55 option (a):
    // after deleting FAMILY_TO_COLOR the DB must still report the same 15
    // colors that shipped on 2026-04-19. If a future seed migration edits a
    // color, update BOTH this snapshot and the migration in the same PR.
    const rows = await getSilhouettes(db.pool);
    const byFamily = Object.fromEntries(rows.map(r => [r.familyCode, r.color]));
    expect(byFamily).toEqual({
      accipitridae: '#222222',
      anatidae: '#3A6B8E',
      ardeidae: '#5A6B2A',
      cathartidae: '#444444',
      corvidae: '#222244',
      cuculidae: '#5E4A20',
      odontophoridae: '#7A5028',
      passerellidae: '#D4923A',
      picidae: '#FF0808',
      scolopacidae: '#9B7B3A',
      strigidae: '#5A4A2A',
      trochilidae: '#7B2D8E',
      troglodytidae: '#7A5028',
      trogonidae: '#FF0808',
      tyrannidae: '#C77A2E',
    });
  });
});
