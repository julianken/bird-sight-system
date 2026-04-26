import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startTestDb, type TestDb } from './test-helpers.js';
import { getSilhouettes } from './silhouettes.js';

let db: TestDb;
beforeAll(async () => { db = await startTestDb(); }, 90_000);
afterAll(async () => { await db?.stop(); });

describe('getSilhouettes', () => {
  it('returns all 25 seeded families', async () => {
    const rows = await getSilhouettes(db.pool);
    expect(rows).toHaveLength(25);
  });

  it('projects each row with familyCode, color, svgData, source, license, commonName, creator', async () => {
    const rows = await getSilhouettes(db.pool);
    const accipitridae = rows.find(r => r.familyCode === 'accipitridae');
    expect(accipitridae).toBeDefined();
    expect(accipitridae!.color).toMatch(/^#[0-9A-F]{6}$/i);
    // svgData is nullable on the type. After migration 17000 seeds Phylopic
    // SVGs for families with usable candidates, this row holds a real
    // path-d string; for families flagged "no usable Phylopic SVG" the
    // value is NULL. Accipitridae has many CC0 candidates so it's a string.
    expect(typeof accipitridae!.svgData).toBe('string');
    // source and license are TEXT NULL in the schema. The post-curation
    // seed (migration 17000, issue #245) writes the Phylopic image-page
    // URL into source and a short license identifier into license.
    expect(accipitridae).toHaveProperty('source');
    expect(accipitridae).toHaveProperty('license');
    // commonName added in migration 1700000019000 + seeded in
    // 1700000019500 (issue #249). The seeded row is non-null.
    expect(accipitridae).toHaveProperty('commonName');
    expect(typeof accipitridae!.commonName).toBe('string');
    // creator added in migration 1700000016000 + populated by 1700000017000
    // (issue #245). The Phylopic seed writes a creator name where one is
    // available; rows for families without a usable Phylopic SVG land NULL.
    expect(accipitridae).toHaveProperty('creator');
  });

  it('returns rows in stable familyCode order', async () => {
    const rows = await getSilhouettes(db.pool);
    const codes = rows.map(r => r.familyCode);
    const sorted = [...codes].sort();
    expect(codes).toEqual(sorted);
  });

  it('colors match the legacy FAMILY_TO_COLOR snapshot (parity with deleted hardcoded map)', async () => {
    // This snapshot covers two cohorts of seeded family colors:
    //   (i) the 15 #55 option-(a) rows from migration 9000 (the original
    //       FAMILY_TO_COLOR parity snapshot — required so that the DB
    //       continues to report the same 15 colors that shipped on
    //       2026-04-19 after the hardcoded map was deleted), and
    //   (ii) the 10 expansion rows added by migration 15000 (issue #244)
    //        so ingest stamping no longer NULLs silhouette_id for the most
    //        common AZ families. The `_FALLBACK` row lands under #246's
    //        scope (migration 1700000018000) — not asserted here.
    // If a future seed migration edits a color, update BOTH this snapshot
    // and the migration in the same PR.
    const rows = await getSilhouettes(db.pool);
    const byFamily = Object.fromEntries(rows.map(r => [r.familyCode, r.color]));
    expect(byFamily).toEqual({
      // --- migration 9000 (#55 option-(a)) ---
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
      // --- migration 15000 (issue #244 expansion) ---
      caprimulgidae: '#3D2E5C',
      cardinalidae: '#B0231A',
      columbidae: '#A89880',
      fringillidae: '#E0A82E',
      mimidae: '#8E7B5A',
      paridae: '#4A6FA5',
      parulidae: '#D4C84A',
      ptilogonatidae: '#1F1F35',
      remizidae: '#9AAE8C',
      threskiornithidae: '#C56B9D',
    });
  });

  it('every seeded family has a non-null commonName (issue #249 seed migration)', async () => {
    // The 1700000019500 data migration populates English common names for
    // every family code that exists in the seed. Production callers
    // (FamilyLegend) fall back to `prettyFamily(familyCode)` when this
    // field is NULL — that fallback is purely defensive for unseeded
    // families landing post-deploy. For the seeded baseline, the
    // expectation is zero NULL rows.
    const rows = await getSilhouettes(db.pool);
    const nullCommon = rows.filter(r => r.commonName === null);
    expect(nullCommon).toEqual([]);
  });

  it('common-name snapshot for all 25 seeded families', async () => {
    // Curated English common names per migration 1700000019500. Update both
    // sides together if the seed text changes.
    const rows = await getSilhouettes(db.pool);
    const byFamily = Object.fromEntries(rows.map(r => [r.familyCode, r.commonName]));
    expect(byFamily).toEqual({
      // baseline (migration 9000)
      accipitridae: 'Hawks, Eagles & Kites',
      anatidae: 'Ducks, Geese & Swans',
      ardeidae: 'Herons & Egrets',
      cathartidae: 'New World Vultures',
      corvidae: 'Crows, Jays & Magpies',
      cuculidae: 'Cuckoos & Roadrunners',
      odontophoridae: 'New World Quail',
      passerellidae: 'New World Sparrows',
      picidae: 'Woodpeckers',
      scolopacidae: 'Sandpipers',
      strigidae: 'Owls',
      trochilidae: 'Hummingbirds',
      troglodytidae: 'Wrens',
      trogonidae: 'Trogons',
      tyrannidae: 'Tyrant Flycatchers',
      // AZ expansion (migration 15000, issue #244)
      cardinalidae: 'Cardinals & Allies',
      mimidae: 'Mockingbirds & Thrashers',
      columbidae: 'Pigeons & Doves',
      parulidae: 'New World Warblers',
      ptilogonatidae: 'Silky-Flycatchers',
      paridae: 'Tits, Chickadees & Titmice',
      fringillidae: 'Finches',
      caprimulgidae: 'Nightjars',
      remizidae: 'Verdins',
      threskiornithidae: 'Ibises & Spoonbills',
    });
  });
});
