import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { startTestDb, type TestDb } from './test-helpers.js';
import {
  upsertObservations,
  getCellObservations,
  CELL_OBSERVATIONS_LIMIT,
  NATIONAL_SCOPE_KEY,
  type ObservationInput,
} from './observations.js';

// B1 (#1300) — getCellObservations: the bounded, single-grid-cell, single-
// species per-observation query that backs the zoom<6 sightings log (epic
// #1299). The cell bbox for a bucket centered (lngBucket, latBucket) at
// gridMultiplier m is [lngBucket ± 0.5/m, latBucket ± 0.5/m]; bucketing is
// round(coord*m)/m, so a clicked CellPopover marker's coords are a true bucket
// center. NO DB mocks — real Postgres+PostGIS via testcontainers (repo rule).

let db: TestDb;
beforeAll(async () => {
  db = await startTestDb();
  await db.pool.query(
    `INSERT INTO species_meta (species_code, com_name, sci_name, family_code, family_name)
     VALUES
       ('vermfly', 'Vermilion Flycatcher', 'Pyrocephalus rubinus', 'tyrannidae', 'Tyrant Flycatchers'),
       ('annhum', 'Anna''s Hummingbird', 'Calypte anna', 'trochilidae', 'Hummingbirds')`,
  );
}, 90_000);

afterAll(async () => { await db?.stop(); });

// ── Cell-bbox + species + ordering + since-window ────────────────────────────
//
// Target cell: gridMultiplier 2 (the coarsest grid), bucket center
// (-111.0, 32.0) — an Arizona interior cell. half = 0.5/2 = 0.25, so the cell
// envelope is [-111.25, 31.75, -110.75, 32.25]. Rows are placed at the cell
// CENTER (-111.0, 32.0) so the since/species assertions don't depend on the
// boundary, plus deliberate decoys: a different species in the same cell, a
// same-species row in the ADJACENT cell, and a same-species row JUST OUTSIDE
// the east edge (boundary correctness).
describe('getCellObservations — cell bbox, species filter, ordering, since', () => {
  const M = 2;
  const LNG_BUCKET = -111.0;
  const LAT_BUCKET = 32.0;

  beforeEach(async () => {
    await db.pool.query('TRUNCATE observations');
    const rows: ObservationInput[] = [
      // Four vermfly rows AT the cell center, with distinct ages so DESC
      // ordering + the since-window are both observable.
      { subId: 'IN-6h', speciesCode: 'vermfly', comName: 'Vermilion Flycatcher',
        lat: LAT_BUCKET, lng: LNG_BUCKET, obsDt: new Date(Date.now() - 6 * 3_600_000).toISOString(),
        locId: 'L1', locName: 'Center', howMany: 2, isNotable: false },
      { subId: 'IN-2d', speciesCode: 'vermfly', comName: 'Vermilion Flycatcher',
        lat: LAT_BUCKET, lng: LNG_BUCKET, obsDt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
        locId: 'L1', locName: 'Center', howMany: 1, isNotable: false },
      { subId: 'IN-3d', speciesCode: 'vermfly', comName: 'Vermilion Flycatcher',
        lat: LAT_BUCKET, lng: LNG_BUCKET, obsDt: new Date(Date.now() - 3 * 86_400_000).toISOString(),
        locId: 'L1', locName: 'Center', howMany: 1, isNotable: true },
      { subId: 'IN-10d', speciesCode: 'vermfly', comName: 'Vermilion Flycatcher',
        lat: LAT_BUCKET, lng: LNG_BUCKET, obsDt: new Date(Date.now() - 10 * 86_400_000).toISOString(),
        locId: 'L1', locName: 'Center', howMany: 1, isNotable: false },
      // Different species, same cell → excluded by the species filter.
      { subId: 'OTHER-SP', speciesCode: 'annhum', comName: "Anna's Hummingbird",
        lat: LAT_BUCKET, lng: LNG_BUCKET, obsDt: new Date(Date.now() - 1 * 86_400_000).toISOString(),
        locId: 'L1', locName: 'Center', howMany: 1, isNotable: false },
      // Same species, ADJACENT cell (bucket center -110.5) → outside the
      // target envelope (-110.5 > -110.75 east edge).
      { subId: 'ADJ-CELL', speciesCode: 'vermfly', comName: 'Vermilion Flycatcher',
        lat: LAT_BUCKET, lng: -110.5, obsDt: new Date(Date.now() - 1 * 86_400_000).toISOString(),
        locId: 'L2', locName: 'Adjacent', howMany: 1, isNotable: false },
      // Same species, JUST OUTSIDE the east edge (-110.70 > -110.75) → excluded.
      { subId: 'JUST-OUT', speciesCode: 'vermfly', comName: 'Vermilion Flycatcher',
        lat: LAT_BUCKET, lng: -110.70, obsDt: new Date(Date.now() - 1 * 86_400_000).toISOString(),
        locId: 'L3', locName: 'JustOutside', howMany: 1, isNotable: false },
    ];
    await upsertObservations(db.pool, rows);
  });

  it('returns ONLY the target species inside the derived cell bbox, ordered obs_dt DESC', async () => {
    const { data, truncated, cellObservationCount } = await getCellObservations(db.pool, {
      scopeKey: NATIONAL_SCOPE_KEY,
      gridMultiplier: M,
      lngBucket: LNG_BUCKET,
      latBucket: LAT_BUCKET,
      speciesCode: 'vermfly',
    });
    // The four center vermfly rows only — annhum (species), the adjacent-cell
    // row and the just-outside row are all excluded. Ordered newest-first.
    expect(data.map(r => r.subId)).toEqual(['IN-6h', 'IN-2d', 'IN-3d', 'IN-10d']);
    expect(cellObservationCount).toBe(4);
    expect(truncated).toBe(false);
    // Row projection mirrors getObservations (comName/familyCode joined).
    expect(data[0]!.comName).toBe('Vermilion Flycatcher');
    expect(data[0]!.familyCode).toBe('tyrannidae');
    expect(data[0]!.howMany).toBe(2);
    expect(data[0]!.obsDt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('excludes the row just outside 0.5/m and the adjacent-cell row (bbox boundary)', async () => {
    const { data } = await getCellObservations(db.pool, {
      scopeKey: NATIONAL_SCOPE_KEY,
      gridMultiplier: M,
      lngBucket: LNG_BUCKET,
      latBucket: LAT_BUCKET,
      speciesCode: 'vermfly',
    });
    const ids = data.map(r => r.subId);
    expect(ids).not.toContain('ADJ-CELL');
    expect(ids).not.toContain('JUST-OUT');
  });

  it('since="7d" AND-s obs_dt into BOTH data AND the cellObservationCount denominator', async () => {
    const { data, cellObservationCount, truncated } = await getCellObservations(db.pool, {
      scopeKey: NATIONAL_SCOPE_KEY,
      gridMultiplier: M,
      lngBucket: LNG_BUCKET,
      latBucket: LAT_BUCKET,
      speciesCode: 'vermfly',
      since: '7d',
    });
    // The 10-day row drops from BOTH the returned rows AND the count (the
    // windowed set, not all-time).
    expect(data.map(r => r.subId)).toEqual(['IN-6h', 'IN-2d', 'IN-3d']);
    expect(cellObservationCount).toBe(3);
    expect(truncated).toBe(false);
  });

  it('since="1d" narrows the window to the freshest row only', async () => {
    const { data, cellObservationCount } = await getCellObservations(db.pool, {
      scopeKey: NATIONAL_SCOPE_KEY,
      gridMultiplier: M,
      lngBucket: LNG_BUCKET,
      latBucket: LAT_BUCKET,
      speciesCode: 'vermfly',
      since: '1d',
    });
    expect(data.map(r => r.subId)).toEqual(['IN-6h']);
    expect(cellObservationCount).toBe(1);
  });
});

// ── LIMIT brake + truncated/cellObservationCount above and below the cap ─────
describe('getCellObservations — LIMIT brake and truncation denominator', () => {
  const M = 2;
  const LNG_BUCKET = -111.0;
  const LAT_BUCKET = 32.0;

  async function seedCellRows(n: number): Promise<void> {
    await db.pool.query('TRUNCATE observations');
    // Bulk insert via generate_series — fast vs row-by-row JS. All rows are the
    // same species at the cell center, fresh (now()).
    await db.pool.query(
      `INSERT INTO observations
         (sub_id, species_code, lat, lng, obs_dt, loc_id, loc_name, how_many, is_notable)
       SELECT
         'S-cell-' || g::text, 'vermfly',
         $1::float8, $2::float8,
         now() - (g * interval '1 second'),
         'L-cell', 'Cell', 1, false
       FROM generate_series(1, $3) g`,
      [LAT_BUCKET, LNG_BUCKET, n],
    );
  }

  it('caps data at CELL_OBSERVATIONS_LIMIT and flags truncated when the cell exceeds it', async () => {
    await seedCellRows(CELL_OBSERVATIONS_LIMIT + 50);
    const { data, truncated, cellObservationCount } = await getCellObservations(db.pool, {
      scopeKey: NATIONAL_SCOPE_KEY,
      gridMultiplier: M,
      lngBucket: LNG_BUCKET,
      latBucket: LAT_BUCKET,
      speciesCode: 'vermfly',
    });
    expect(data).toHaveLength(CELL_OBSERVATIONS_LIMIT);
    expect(truncated).toBe(true);
    // The denominator is the EXACT pre-LIMIT count, not the capped page length.
    expect(cellObservationCount).toBe(CELL_OBSERVATIONS_LIMIT + 50);
  });

  it('returns truncated=false when the cell is exactly at the cap', async () => {
    await seedCellRows(CELL_OBSERVATIONS_LIMIT);
    const { data, truncated, cellObservationCount } = await getCellObservations(db.pool, {
      scopeKey: NATIONAL_SCOPE_KEY,
      gridMultiplier: M,
      lngBucket: LNG_BUCKET,
      latBucket: LAT_BUCKET,
      speciesCode: 'vermfly',
    });
    expect(data).toHaveLength(CELL_OBSERVATIONS_LIMIT);
    expect(truncated).toBe(false);
    expect(cellObservationCount).toBe(CELL_OBSERVATIONS_LIMIT);
  });

  it('honors an explicit limit override while keeping the full denominator', async () => {
    await seedCellRows(20);
    const { data, truncated, cellObservationCount } = await getCellObservations(db.pool, {
      scopeKey: NATIONAL_SCOPE_KEY,
      gridMultiplier: M,
      lngBucket: LNG_BUCKET,
      latBucket: LAT_BUCKET,
      speciesCode: 'vermfly',
      limit: 5,
    });
    expect(data).toHaveLength(5);
    expect(truncated).toBe(true);
    expect(cellObservationCount).toBe(20);
  });
});

// ── State clip (scopeKey) vs national no-clip ────────────────────────────────
//
// A cell straddling the AZ/NM border (the meridian -109.04522 is a literal
// vertex of the seeded AZ MultiPolygon). Bucket center (-109.0, 32.0) at m=2 →
// envelope [-109.25, 31.75, -108.75, 32.25], which spans both sides of the
// border. A row at lng -109.1 is on the AZ side; a row at -109.0 is on the NM
// side. Both sit inside the same cell bbox — the state clip is what separates
// them, so an out-of-state row in the same bbox is excluded under US-AZ.
describe('getCellObservations — state clip vs NATIONAL_SCOPE_KEY no-clip', () => {
  const M = 2;
  const LNG_BUCKET = -109.0;
  const LAT_BUCKET = 32.0;

  beforeEach(async () => {
    await db.pool.query('TRUNCATE observations');
    await upsertObservations(db.pool, [
      { subId: 'AZ-SIDE', speciesCode: 'vermfly', comName: 'Vermilion Flycatcher',
        lat: LAT_BUCKET, lng: -109.1, obsDt: new Date(Date.now() - 1 * 86_400_000).toISOString(),
        locId: 'L-AZ', locName: 'AZ', howMany: 1, isNotable: false },
      { subId: 'NM-SIDE', speciesCode: 'vermfly', comName: 'Vermilion Flycatcher',
        lat: LAT_BUCKET, lng: -109.0, obsDt: new Date(Date.now() - 1 * 86_400_000).toISOString(),
        locId: 'L-NM', locName: 'NM', howMany: 1, isNotable: false },
    ]);
  });

  it('scopeKey="US-AZ" applies the ST_Intersects clip, excluding the out-of-state row in the same bbox', async () => {
    const { data, cellObservationCount } = await getCellObservations(db.pool, {
      scopeKey: 'US-AZ',
      gridMultiplier: M,
      lngBucket: LNG_BUCKET,
      latBucket: LAT_BUCKET,
      speciesCode: 'vermfly',
    });
    expect(data.map(r => r.subId)).toEqual(['AZ-SIDE']);
    expect(cellObservationCount).toBe(1);
  });

  it('scopeKey=NATIONAL_SCOPE_KEY applies NO clip — both border-straddling rows return', async () => {
    const { data, cellObservationCount } = await getCellObservations(db.pool, {
      scopeKey: NATIONAL_SCOPE_KEY,
      gridMultiplier: M,
      lngBucket: LNG_BUCKET,
      latBucket: LAT_BUCKET,
      speciesCode: 'vermfly',
    });
    expect(data.map(r => r.subId).sort()).toEqual(['AZ-SIDE', 'NM-SIDE']);
    expect(cellObservationCount).toBe(2);
  });
});
