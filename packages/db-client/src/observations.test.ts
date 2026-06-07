import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import pg from 'pg';
import { startTestDb, type TestDb } from './test-helpers.js';
import {
  upsertObservations, getObservations, getObservationsAggregated,
  runReconcileStamping,
  type ObservationInput,
} from './observations.js';

let db: TestDb;
beforeAll(async () => {
  db = await startTestDb();
  // Seed a species so silhouette mapping has something to JOIN against.
  await db.pool.query(
    `INSERT INTO species_meta (species_code, com_name, sci_name, family_code, family_name)
     VALUES
       ('vermfly', 'Vermilion Flycatcher', 'Pyrocephalus rubinus', 'tyrannidae', 'Tyrant Flycatchers'),
       ('annhum', 'Anna''s Hummingbird', 'Calypte anna', 'trochilidae', 'Hummingbirds')`
  );
}, 90_000);

beforeEach(async () => {
  await db.pool.query('TRUNCATE observations');
});

afterAll(async () => { await db?.stop(); });

describe('upsertObservations', () => {
  const sample: ObservationInput[] = [
    {
      subId: 'S100', speciesCode: 'vermfly', comName: 'Vermilion Flycatcher',
      lat: 31.72, lng: -110.88, obsDt: '2026-04-15T08:00:00Z',
      locId: 'L101234', locName: 'Madera Canyon', howMany: 2, isNotable: false,
    },
    {
      subId: 'S101', speciesCode: 'annhum', comName: 'Anna\'s Hummingbird',
      lat: 32.30, lng: -110.99, obsDt: '2026-04-15T09:00:00Z',
      locId: 'L207118', locName: 'Sweetwater Wetlands', howMany: 1, isNotable: true,
    },
  ];

  it('inserts new observations and stamps silhouette_id (regionId removed from wire shape; #532)', async () => {
    const count = await upsertObservations(db.pool, sample);
    expect(count).toBe(2);

    const { data: all } = await getObservations(db.pool, {});
    expect(all).toHaveLength(2);
    const verm = all.find(o => o.subId === 'S100')!;
    expect(verm).not.toHaveProperty('regionId');
    expect(verm.silhouetteId).toBe('tyrannidae');
    expect(verm.familyCode).toBe('tyrannidae');
    const anna = all.find(o => o.subId === 'S101')!;
    expect(anna).not.toHaveProperty('regionId');
    expect(anna.silhouetteId).toBe('trochilidae');
    expect(anna.familyCode).toBe('trochilidae');
    expect(anna.isNotable).toBe(true);
  });

  // PR-1 of #532 introduced a regression test asserting `region_id IS NULL`
  // on new rows. PR-3 dropped the column entirely, so the raw-SQL form of
  // that assertion now references a non-existent column. The wire-shape
  // assertions above (`expect(verm).not.toHaveProperty('regionId')`) cover
  // the contract that survives.

  it('returns familyCode = null when the species is absent from species_meta (#57)', async () => {
    // LEFT JOIN on species_meta means an observation for a species not
    // present in species_meta yields NULL family_code. The DB-client
    // parser must preserve the NULL — no `?? ''` coercion — because the
    // frontend treats NULL as a "skip in derive / silhouette-fallback"
    // signal.
    await upsertObservations(db.pool, [
      {
        subId: 'S-orphan', speciesCode: 'unknownspec', comName: 'Unknown Bird',
        lat: 31.72, lng: -110.88, obsDt: '2026-04-15T08:00:00Z',
        locId: 'L-orphan', locName: 'Nowhere', howMany: 1, isNotable: false,
      },
    ]);
    const { data: all } = await getObservations(db.pool, {});
    const orphan = all.find(o => o.subId === 'S-orphan')!;
    expect(orphan.familyCode).toBeNull();
  });

  it('is idempotent — re-running with the same input does not duplicate', async () => {
    await upsertObservations(db.pool, sample);
    await upsertObservations(db.pool, sample);
    const { data: all } = await getObservations(db.pool, {});
    expect(all).toHaveLength(2);
  });

  it('updates is_notable on conflict when value changes', async () => {
    await upsertObservations(db.pool, sample);
    const updated: ObservationInput[] = [{ ...sample[0]!, isNotable: true }];
    await upsertObservations(db.pool, updated);
    const { data: all } = await getObservations(db.pool, {});
    const verm = all.find(o => o.subId === 'S100')!;
    expect(verm.isNotable).toBe(true);
  });

  it('scopes the stamp UPDATE to the current batch — pre-existing NULL-stamp residue is not touched (#505)', async () => {
    // Insert N₁ pre-existing rows directly (bypassing upsertObservations) with
    // silhouette_id NULL — these simulate the NULL-stamp residue that turned the
    // per-iteration stamp UPDATE into an O(table) scan on every backfill day.
    const residueRows: string[] = [];
    const residueValues: unknown[] = [];
    for (let i = 0; i < 100; i++) {
      const off = i * 9;
      residueRows.push(
        `($${off + 1}, $${off + 2}, $${off + 3}, $${off + 4}, $${off + 5}, ` +
        `$${off + 6}, $${off + 7}, $${off + 8}, $${off + 9})`
      );
      residueValues.push(
        `R-${i}`, 'vermfly', 31.72, -110.88, '2026-04-01T08:00:00Z',
        `L-residue-${i}`, 'Madera', 1, false,
      );
    }
    await db.pool.query(
      `INSERT INTO observations
        (sub_id, species_code, lat, lng, obs_dt, loc_id, loc_name, how_many, is_notable)
       VALUES ${residueRows.join(',')}`,
      residueValues
    );
    // Force NULL silhouette stamps on the residue rows.
    await db.pool.query("UPDATE observations SET silhouette_id = NULL");

    // Now call upsertObservations with a small batch of M new rows.
    const count = await upsertObservations(db.pool, sample);
    expect(count).toBe(2);

    // Assert: the M new rows have their silhouette_id stamped...
    const { data: all } = await getObservations(db.pool, {});
    const newVerm = all.find(o => o.subId === 'S100')!;
    expect(newVerm.silhouetteId).toBe('tyrannidae');
    const newAnna = all.find(o => o.subId === 'S101')!;
    expect(newAnna.silhouetteId).toBe('trochilidae');

    // ...AND the N₁ pre-existing NULL residue rows are STILL NULL — proving
    // the stamp UPDATE was scoped to the batch, not the table.
    const residueAfter = await db.pool.query<{ silhouette_id: string | null }>(
      "SELECT silhouette_id FROM observations WHERE sub_id LIKE 'R-%'"
    );
    expect(residueAfter.rows).toHaveLength(100);
    for (const r of residueAfter.rows) {
      expect(r.silhouette_id).toBeNull();
    }
  });

  // #843 — Postgres bind-message param overflow regression guard.
  //
  // The old single-`INSERT … VALUES ($1..$N)` build emitted one $N placeholder
  // per field (9 cols/row). The Postgres wire protocol encodes the Bind
  // parameter count as a uint16 (max 65,535); node-postgres does NOT guard it,
  // so once total params cross 65,535 the count silently overflows mod 65536
  // and the bind desyncs ("bind message has N parameter formats but 0
  // parameters"). 65,535 ÷ 9 = 7,281 rows is a CORRUPTION THRESHOLD, not a safe
  // ceiling. The #840 per-state fan-out aggregates tens of thousands of rows
  // into ONE upsert call (the failing prod run had ~13.3k), which is exactly
  // what this exercises. These tests MUST drive the REAL upsertObservations
  // path (the per-row JS build + correlated stamp UPDATE), NOT the
  // generate_series bypass the LIMIT-cap test above uses — that bypass skips the
  // build site that overflows and would never catch this bug. The path is slow
  // for 14k rows; that is inherent to exercising the real code.
  function makeSynthetic(n: number, opts?: { startAt?: number }): ObservationInput[] {
    const startAt = opts?.startAt ?? 0;
    const out: ObservationInput[] = [];
    for (let i = startAt; i < startAt + n; i++) {
      out.push({
        subId: `S-bulk-${i}`,
        speciesCode: 'vermfly',
        comName: 'Vermilion Flycatcher',
        lat: 31.72 + (i % 1000) * 0.0001,
        lng: -110.88 - (i % 1000) * 0.0001,
        obsDt: '2026-04-15T08:00:00Z',
        locId: `L-bulk-${i}`,
        locName: i % 7 === 0 ? null : `Loc ${i}`,
        howMany: i % 5 === 0 ? null : (i % 4) + 1,
        isNotable: false,
      });
    }
    return out;
  }

  it('upserts 14,000 rows in one call without overflowing the uint16 bind-param limit (#843)', async () => {
    const inputs = makeSynthetic(14_000);
    const count = await upsertObservations(db.pool, inputs);
    expect(count).toBe(14_000);

    const { rows } = await db.pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM observations WHERE sub_id LIKE 'S-bulk-%'"
    );
    expect(Number(rows[0]!.n)).toBe(14_000);

    // The stamp UPDATE (also previously unbounded, 2 params/row) must have run
    // across the whole batch — every row gets its silhouette_id.
    const { rows: stamped } = await db.pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM observations WHERE sub_id LIKE 'S-bulk-%' AND silhouette_id = 'tyrannidae'"
    );
    expect(Number(stamped[0]!.n)).toBe(14_000);
  }, 120_000);

  it('upserts 14,001 distinct rows with no drop or double-count across boundaries (#843)', async () => {
    const inputs = makeSynthetic(14_001);
    const count = await upsertObservations(db.pool, inputs);
    expect(count).toBe(14_001);

    const { rows } = await db.pool.query<{ total: string; distinct: string }>(
      `SELECT count(*)::text AS total,
              count(DISTINCT (sub_id, species_code))::text AS distinct
       FROM observations WHERE sub_id LIKE 'S-bulk-%'`
    );
    expect(Number(rows[0]!.total)).toBe(14_001);
    expect(Number(rows[0]!.distinct)).toBe(14_001);
  }, 120_000);

  it('OR-coalesces is_notable across large upsert calls at fan-out scale (#843)', async () => {
    // The `is_notable = observations.is_notable OR EXCLUDED.is_notable`
    // ON-CONFLICT clause must survive the UNNEST rewrite at >7,281-row scale.
    // Callers (the #840 fan-out) pass a per-call deduplicated batch — Postgres
    // rejects two rows sharing the conflict key inside ONE statement ("ON
    // CONFLICT DO UPDATE command cannot affect row a second time"), exactly as
    // the old single-INSERT form did, so the in-batch dedup is the caller's job
    // (run-ingest.ts byKey map). What this guards is the CROSS-CALL coalesce: a
    // key that arrives non-notable in one big upsert and notable in the next
    // must end notable, with both calls clearing the uint16 ceiling.
    const conflictKey = { subId: 'S-notable-x', speciesCode: 'annhum' as const };
    const notNotable: ObservationInput = {
      ...conflictKey, comName: "Anna's Hummingbird",
      lat: 32.3, lng: -110.99, obsDt: '2026-04-15T08:00:00Z',
      locId: 'L-x', locName: 'X', howMany: 1, isNotable: false,
    };
    const notable: ObservationInput = { ...notNotable, isNotable: true, obsDt: '2026-04-16T08:00:00Z' };

    // Call 1: 8,000 filler + the non-notable copy (clears 7,281).
    await upsertObservations(db.pool, [...makeSynthetic(8_000), notNotable]);
    // Call 2: a fresh 8,000 filler + the notable copy of the same key.
    await upsertObservations(db.pool, [...makeSynthetic(8_000, { startAt: 20_000 }), notable]);

    const { rows } = await db.pool.query<{ is_notable: boolean }>(
      "SELECT is_notable FROM observations WHERE sub_id = 'S-notable-x' AND species_code = 'annhum'"
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.is_notable).toBe(true);

    // And the reverse direction does NOT clobber: a later non-notable upsert of
    // an already-notable key keeps is_notable = true (OR, not assignment).
    await upsertObservations(db.pool, [{ ...notable, isNotable: false }]);
    const { rows: after } = await db.pool.query<{ is_notable: boolean }>(
      "SELECT is_notable FROM observations WHERE sub_id = 'S-notable-x' AND species_code = 'annhum'"
    );
    expect(after[0]!.is_notable).toBe(true);
  }, 120_000);
});

// #845 — the upsert transaction must exempt itself from the session
// `statement_timeout`. `pool.ts:35` defaults every ingestor pool connection to
// 15_000ms (added by #822 to protect the read-api); the ~13.3k-row national
// fan-out upsert exceeds that on db-g1-small and gets cancelled with SQLSTATE
// 57014, rolling back so zero rows commit. `SET LOCAL statement_timeout = 0`
// immediately after BEGIN exempts ONLY the INSERT + stamp UPDATE in this txn
// and reverts on COMMIT/ROLLBACK — every other query keeps the session cap.
describe('upsertObservations statement_timeout (#845)', () => {
  // A dedicated pool on the SAME test DB whose connections carry a deliberately
  // tiny session `statement_timeout`. `pg.Pool`'s `statement_timeout` option
  // issues `SET statement_timeout` on every connection, so this stands in for
  // the prod ingestor pool's 15s cap — just small enough that the real upsert's
  // INSERT exceeds it without the SET LOCAL override.
  let tinyPool: pg.Pool;

  // 1ms is well below the wall-clock cost of a real ~14k-row UNNEST INSERT +
  // correlated stamp UPDATE, so without the SET LOCAL fix the upsert is
  // cancelled with 57014. Large enough a value that an *empty* pool round-trip
  // (the no-leak SHOW) still resolves; SHOW is sub-millisecond but tolerant
  // because statement_timeout's granularity means a 1ms cap rarely trips a
  // trivial read. We use 50ms to keep the no-leak SHOW robust while still being
  // far under the multi-second real INSERT.
  const TINY_TIMEOUT_MS = 50;

  beforeAll(() => {
    tinyPool = new pg.Pool({
      connectionString: db.url,
      max: 4,
      statement_timeout: TINY_TIMEOUT_MS,
    });
  });

  afterAll(async () => {
    await tinyPool?.end();
  });

  beforeEach(async () => {
    await db.pool.query('TRUNCATE observations');
  });

  function makeBulk(n: number): ObservationInput[] {
    const out: ObservationInput[] = [];
    for (let i = 0; i < n; i++) {
      out.push({
        subId: `S-timeout-${i}`,
        speciesCode: 'vermfly',
        comName: 'Vermilion Flycatcher',
        lat: 31.72 + (i % 1000) * 0.0001,
        lng: -110.88 - (i % 1000) * 0.0001,
        obsDt: '2026-04-15T08:00:00Z',
        locId: `L-timeout-${i}`,
        locName: i % 7 === 0 ? null : `Loc ${i}`,
        howMany: i % 5 === 0 ? null : (i % 4) + 1,
        isNotable: false,
      });
    }
    return out;
  }

  it('completes a large upsert despite a tiny session statement_timeout (SET LOCAL 0 overrides the cap)', async () => {
    // Without `SET LOCAL statement_timeout = 0` after BEGIN, this multi-second
    // INSERT is cancelled by the 50ms session cap with SQLSTATE 57014 and the
    // txn rolls back. With the fix the upsert runs to completion and every row
    // commits.
    const inputs = makeBulk(14_000);
    const count = await upsertObservations(tinyPool, inputs);
    expect(count).toBe(14_000);

    const { rows } = await db.pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM observations WHERE sub_id LIKE 'S-timeout-%'"
    );
    expect(Number(rows[0]!.n)).toBe(14_000);
  }, 120_000);

  it('does NOT leak statement_timeout = 0 — a fresh connection after the txn keeps the session default', async () => {
    // Run the upsert (which sets statement_timeout = 0 inside its txn), then
    // acquire a NEW connection from the pool and read its statement_timeout.
    // `SET LOCAL` is transaction-scoped, so the override must be gone: the fresh
    // connection sees the session default (50ms), NOT 0. Checking a connection
    // acquired AFTER the txn closed is the load-bearing part — a same-txn check
    // would pass even on a leaky implementation.
    await upsertObservations(tinyPool, makeBulk(14_000));

    const client = await tinyPool.connect();
    try {
      const { rows } = await client.query<{ statement_timeout: string }>(
        'SHOW statement_timeout'
      );
      // pg renders the 50ms session cap as '50ms'; the disabled value would be
      // '0'. Assert it is NOT disabled — the SET LOCAL did not escape the txn.
      expect(rows[0]!.statement_timeout).not.toBe('0');
      expect(rows[0]!.statement_timeout).toBe('50ms');
    } finally {
      client.release();
    }
  }, 120_000);
});

describe('getObservations filters', () => {
  beforeEach(async () => {
    await db.pool.query('TRUNCATE observations');
    await upsertObservations(db.pool, [
      { subId: 'S200', speciesCode: 'vermfly', comName: 'Vermilion Flycatcher',
        lat: 31.72, lng: -110.88, obsDt: '2026-04-15T08:00:00Z',
        locId: 'L1', locName: 'X', howMany: 1, isNotable: false },
      { subId: 'S201', speciesCode: 'annhum', comName: 'Anna\'s Hummingbird',
        lat: 32.30, lng: -110.99, obsDt: '2026-04-10T08:00:00Z',
        locId: 'L2', locName: 'Y', howMany: 1, isNotable: true },
      { subId: 'S202', speciesCode: 'vermfly', comName: 'Vermilion Flycatcher',
        lat: 32.30, lng: -110.99, obsDt: '2026-03-01T08:00:00Z',
        locId: 'L3', locName: 'Z', howMany: 3, isNotable: false },
    ]);
  });

  it('filters by since=14d', async () => {
    // Note: tests assume the DB clock is "now" — these dates are illustrative.
    // We reset obs_dt to relative to now() to make the test stable:
    await db.pool.query(`UPDATE observations SET obs_dt = now() - interval '5 days' WHERE sub_id='S200'`);
    await db.pool.query(`UPDATE observations SET obs_dt = now() - interval '20 days' WHERE sub_id='S201'`);
    await db.pool.query(`UPDATE observations SET obs_dt = now() - interval '40 days' WHERE sub_id='S202'`);
    const { data: rows } = await getObservations(db.pool, { since: '14d' });
    expect(rows.map(r => r.subId)).toEqual(['S200']);
  });

  it('filters by notable=true', async () => {
    const { data: rows } = await getObservations(db.pool, { notable: true });
    expect(rows.map(r => r.subId).sort()).toEqual(['S201']);
  });

  it('filters by species code', async () => {
    const { data: rows } = await getObservations(db.pool, { speciesCode: 'vermfly' });
    expect(rows.map(r => r.subId).sort()).toEqual(['S200', 'S202']);
  });

  it('filters by family code', async () => {
    const { data: rows } = await getObservations(db.pool, { familyCode: 'trochilidae' });
    expect(rows.map(r => r.subId)).toEqual(['S201']);
  });

  // #619 — server-side bbox filtering (Phase 2 going-national pre-condition).
  // Fixture lat/lng:
  //   S200 = (31.72, -110.88)
  //   S201 = (32.30, -110.99)
  //   S202 = (32.30, -110.99)
  it('filters by bbox: narrow envelope around S200 returns only S200', async () => {
    const { data: rows } = await getObservations(db.pool, {
      bbox: [-111.0, 31.5, -110.8, 31.9],
    });
    expect(rows.map(r => r.subId)).toEqual(['S200']);
  });

  it('filters by bbox: wide envelope returns all in-bounds', async () => {
    const { data: rows } = await getObservations(db.pool, {
      bbox: [-112.0, 31.0, -110.0, 33.0],
    });
    expect(rows.map(r => r.subId).sort()).toEqual(['S200', 'S201', 'S202']);
  });

  it('filters by bbox: envelope outside fixture returns empty', async () => {
    const { data: rows } = await getObservations(db.pool, {
      bbox: [-80.0, 25.0, -79.0, 26.0],
    });
    expect(rows).toEqual([]);
  });

  it('filters by bbox: boundary point is inclusive', async () => {
    // S200 at exactly (31.72, -110.88) — envelope edge passes through it.
    const { data: rows } = await getObservations(db.pool, {
      bbox: [-110.88, 31.72, -110.0, 32.0],
    });
    expect(rows.map(r => r.subId)).toContain('S200');
  });

  // #667 Scope C.1 — defense-in-depth LIMIT 5000 on species-filtered queries.
  // The frontend's species-deep-link (?species=<code>) fetches before
  // MapCanvas mounts → no bbox in flight. A handful of species nationally
  // approach ~5K observations in 14d (House Sparrow); cap there is a balance
  // between "real users see the full slice" and "scraper can't drain the DB
  // via species iteration".
  it('applies LIMIT 5000 + truncated=true when speciesCode is set (#667 C.1 / #733 B6)', async () => {
    // Seed 6K observations for a single species to cross the cap. Skip the
    // upsertObservations helper's per-row stamping path (slow for 6K rows)
    // and INSERT directly; the query under test only reads obs_dt/species_code/
    // bbox columns, none of which depend on silhouette_id.
    await db.pool.query('TRUNCATE observations');
    await db.pool.query(`
      INSERT INTO species_meta (species_code, com_name, sci_name, family_code, family_name, taxon_order)
      VALUES ('hossp1', 'House Sparrow', 'Passer domesticus', 'passeridae', 'Old World Sparrows', 999999)
      ON CONFLICT (species_code) DO NOTHING
    `);
    // Bulk insert via generate_series — fast vs row-by-row JS.
    await db.pool.query(`
      INSERT INTO observations
        (sub_id, species_code, lat, lng, obs_dt, loc_id, loc_name, how_many, is_notable)
      SELECT
        'S-cap-' || g::text,
        'hossp1',
        31.72 + (g * 0.0001),
        -110.88 - (g * 0.0001),
        now() - (g * interval '1 second'),
        'L-cap',
        'Cap Test Loc',
        1,
        false
      FROM generate_series(1, 6000) g
    `);
    const { data, truncated } = await getObservations(db.pool, { speciesCode: 'hossp1' });
    expect(data).toHaveLength(5000);
    expect(truncated).toBe(true);
  });

  it('returns truncated=false when a species query is under the 5000 cap (#733 B6)', async () => {
    // 5500 rows of one species, but query WITHOUT speciesCode → no species cap
    // applies; the general 10000 cap is not crossed, so the full set returns
    // and truncated stays false. This is the prior "does NOT apply LIMIT 5000"
    // sanity counterpart, now asserting the explicit truncated flag.
    await db.pool.query('TRUNCATE observations');
    await db.pool.query(`
      INSERT INTO species_meta (species_code, com_name, sci_name, family_code, family_name, taxon_order)
      VALUES ('hossp1', 'House Sparrow', 'Passer domesticus', 'passeridae', 'Old World Sparrows', 999999)
      ON CONFLICT (species_code) DO NOTHING
    `);
    await db.pool.query(`
      INSERT INTO observations
        (sub_id, species_code, lat, lng, obs_dt, loc_id, loc_name, how_many, is_notable)
      SELECT
        'S-uncap-' || g::text, 'hossp1',
        31.72 + (g * 0.0001), -110.88 - (g * 0.0001),
        now() - (g * interval '1 second'),
        'L-uncap', 'Uncap Test Loc', 1, false
      FROM generate_series(1, 5500) g
    `);
    const { data, truncated } = await getObservations(db.pool, {});
    expect(data).toHaveLength(5500);
    expect(truncated).toBe(false);
  });

  it('applies the general LIMIT 10000 + truncated=true on the non-species path (#733 B6)', async () => {
    // 10001 rows, no species filter → the general 10000 brake fires: the
    // body is sliced back to exactly 10000 and truncated is true. This is the
    // emergency brake for an unbounded per-observation query (a dense state at
    // high zoom). The LIMIT cap+1 probe is what lets us detect the overflow
    // without a separate COUNT.
    await db.pool.query('TRUNCATE observations');
    await db.pool.query(`
      INSERT INTO species_meta (species_code, com_name, sci_name, family_code, family_name, taxon_order)
      VALUES ('hossp1', 'House Sparrow', 'Passer domesticus', 'passeridae', 'Old World Sparrows', 999999)
      ON CONFLICT (species_code) DO NOTHING
    `);
    await db.pool.query(`
      INSERT INTO observations
        (sub_id, species_code, lat, lng, obs_dt, loc_id, loc_name, how_many, is_notable)
      SELECT
        'S-brake-' || g::text, 'hossp1',
        31.72 + (g * 0.00001), -110.88 - (g * 0.00001),
        now() - (g * interval '1 second'),
        'L-brake', 'Brake Test Loc', 1, false
      FROM generate_series(1, 10001) g
    `);
    const { data, truncated } = await getObservations(db.pool, {});
    expect(data).toHaveLength(10000);
    expect(truncated).toBe(true);
  });
});

// #733 (plan task B3) — the `?state=US-XX` hard server-side data boundary.
// A PostGIS `ST_Intersects` clip against the `state_boundaries` polygon table
// (seeded by migration 1700000050000, applied by startTestDb). The clip ANDs
// with every existing filter; absence of `stateCode` leaves the query
// unclipped (whole-US). The fixtures S200/S201/S202 are all in Arizona; a new
// FL-coords row exercises cross-state exclusion, and an AZ-eastern-border
// vertex exercises border-point inclusivity (the `ST_Intersects`-not-
// `ST_Contains` guard — a `ST_Contains` clip would DROP a point sitting on a
// simplified shared edge from both states).
describe('getObservations state clip (#733)', () => {
  beforeEach(async () => {
    await db.pool.query('TRUNCATE observations');
    await upsertObservations(db.pool, [
      // Three AZ rows (mirror the bbox-filter fixtures).
      { subId: 'S200', speciesCode: 'vermfly', comName: 'Vermilion Flycatcher',
        lat: 31.72, lng: -110.88, obsDt: '2026-04-15T08:00:00Z',
        locId: 'L1', locName: 'X', howMany: 1, isNotable: false },
      { subId: 'S201', speciesCode: 'annhum', comName: 'Anna\'s Hummingbird',
        lat: 32.30, lng: -110.99, obsDt: '2026-04-10T08:00:00Z',
        locId: 'L2', locName: 'Y', howMany: 1, isNotable: true },
      { subId: 'S202', speciesCode: 'vermfly', comName: 'Vermilion Flycatcher',
        lat: 32.30, lng: -110.99, obsDt: '2026-03-01T08:00:00Z',
        locId: 'L3', locName: 'Z', howMany: 3, isNotable: false },
      // One Florida row (central FL — well inside FL, well outside AZ).
      { subId: 'S-FL', speciesCode: 'vermfly', comName: 'Vermilion Flycatcher',
        lat: 27.8, lng: -81.7, obsDt: '2026-04-12T08:00:00Z',
        locId: 'L-FL', locName: 'FL', howMany: 1, isNotable: false },
    ]);
  });

  it('clips to the AZ polygon and returns a non-empty set (inverted-predicate guard)', async () => {
    const { data: rows } = await getObservations(db.pool, { stateCode: 'US-AZ' });
    // All three AZ fixtures, and ASSERT non-empty — an inverted predicate
    // (e.g. NOT ST_Intersects) would return zero and silently "pass" a
    // sloppier assertion.
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.map(r => r.subId).sort()).toEqual(['S200', 'S201', 'S202']);
  });

  it('excludes a Florida row from US-AZ and includes it under US-FL', async () => {
    const { data: az } = await getObservations(db.pool, { stateCode: 'US-AZ' });
    expect(az.map(r => r.subId)).not.toContain('S-FL');

    const { data: fl } = await getObservations(db.pool, { stateCode: 'US-FL' });
    expect(fl.map(r => r.subId)).toEqual(['S-FL']);
  });

  it('a point on the AZ/NM border resolves into exactly one state, and the clip surfaces it (ST_Intersects, not ST_Contains)', async () => {
    // -109.04522 is a literal vertex of the seeded AZ MultiPolygon — its
    // eastern meridian, the AZ/NM Four-Corners line. A `ST_Contains` clip would
    // treat a boundary point as "not contained" and could drop it from BOTH
    // states — the vanishing-border-point regression this guard exists to
    // catch. `ST_Intersects` is inclusive, so the point lands in EXACTLY ONE
    // state (which side of a simplified seam it falls on is geometry-dependent;
    // the load-bearing assertion is "exactly one, never zero").
    const borderLng = -109.04522;
    const borderLat = 34.16694;
    const { rows: hit } = await db.pool.query<{ state_code: string }>(
      `SELECT state_code FROM state_boundaries
        WHERE ST_Intersects(geom, ST_SetSRID(ST_MakePoint($1, $2), 4326))
        ORDER BY state_code`,
      [borderLng, borderLat],
    );
    // EXACTLY ONE state — never zero (the ST_Contains-regression assertion).
    expect(hit).toHaveLength(1);
    const borderState = hit[0]!.state_code;
    expect(['US-AZ', 'US-NM']).toContain(borderState);

    await db.pool.query('TRUNCATE observations');
    await upsertObservations(db.pool, [
      { subId: 'S-BORDER', speciesCode: 'vermfly', comName: 'Vermilion Flycatcher',
        lat: borderLat, lng: borderLng, obsDt: '2026-04-15T08:00:00Z',
        locId: 'L-B', locName: 'Border', howMany: 1, isNotable: false },
    ]);
    // The clip with the resolved border state surfaces the border row — proof
    // ST_Intersects includes a point sitting on the polygon edge.
    const { data: rows } = await getObservations(db.pool, { stateCode: borderState });
    expect(rows.map(r => r.subId)).toEqual(['S-BORDER']);
  });

  it('AND-narrows when state and bbox are both present', async () => {
    // A narrow bbox around S200 only — the state clip AND-s with the bbox so
    // S201/S202 (in AZ but outside the bbox) are dropped.
    const { data: rows } = await getObservations(db.pool, {
      stateCode: 'US-AZ',
      bbox: [-111, 31.5, -110.85, 31.9],
    });
    expect(rows.map(r => r.subId)).toEqual(['S200']);
  });

  it('composes with a species filter', async () => {
    const { data: rows } = await getObservations(db.pool, {
      stateCode: 'US-AZ',
      speciesCode: 'vermfly',
    });
    expect(rows.map(r => r.subId).sort()).toEqual(['S200', 'S202']);
  });
});

describe('getObservationsAggregated state clip (#733)', () => {
  beforeEach(async () => {
    await db.pool.query('TRUNCATE observations');
    await upsertObservations(db.pool, [
      // Two AZ rows in the same 0.25° bucket.
      { subId: 'AGG-AZ1', speciesCode: 'vermfly', comName: 'Vermilion Flycatcher',
        lat: 31.72, lng: -110.88, obsDt: '2026-04-15T08:00:00Z',
        locId: 'L1', locName: 'X', howMany: 1, isNotable: false },
      { subId: 'AGG-AZ2', speciesCode: 'annhum', comName: 'Anna\'s Hummingbird',
        lat: 31.73, lng: -110.88, obsDt: '2026-04-15T09:00:00Z',
        locId: 'L2', locName: 'Y', howMany: 1, isNotable: true },
      // One FL row that must be clipped out by US-AZ.
      { subId: 'AGG-FL', speciesCode: 'vermfly', comName: 'Vermilion Flycatcher',
        lat: 27.8, lng: -81.7, obsDt: '2026-04-15T10:00:00Z',
        locId: 'L3', locName: 'Z', howMany: 1, isNotable: false },
    ]);
  });

  it('applies the same clip on the aggregated path', async () => {
    const buckets = await getObservationsAggregated(db.pool, { stateCode: 'US-AZ' }, 4);
    // Only the single AZ bucket survives; the FL bucket is clipped out.
    expect(buckets).toHaveLength(1);
    expect(buckets[0]!.count).toBe(2);
  });
});

describe('getObservationsAggregated (#627)', () => {
  beforeEach(async () => {
    await db.pool.query('TRUNCATE observations');
    // Three rows: two co-located (round to same 0.25° bucket at multiplier=4),
    // one far away in a different bucket.
    await upsertObservations(db.pool, [
      { subId: 'A1', speciesCode: 'vermfly', comName: 'Vermilion Flycatcher',
        lat: 31.72, lng: -110.88, obsDt: '2026-04-15T08:00:00Z',
        locId: 'L1', locName: 'X', howMany: 1, isNotable: false },
      { subId: 'A2', speciesCode: 'annhum', comName: "Anna's Hummingbird",
        // Same 0.25° grid cell as A1: round(31.73*4)/4=31.75, round(-110.88*4)/4=-111
        lat: 31.73, lng: -110.88, obsDt: '2026-04-15T09:00:00Z',
        locId: 'L2', locName: 'Y', howMany: 1, isNotable: true },
      { subId: 'A3', speciesCode: 'vermfly', comName: 'Vermilion Flycatcher',
        lat: 40.00, lng: -100.00, obsDt: '2026-04-15T10:00:00Z',
        locId: 'L3', locName: 'Z', howMany: 1, isNotable: false },
    ]);
  });

  it('groups co-located observations into one bucket and nests species under families (#859)', async () => {
    const buckets = await getObservationsAggregated(db.pool, {}, 4);
    expect(buckets).toHaveLength(2);

    // Sort for stable assertion order.
    const sorted = [...buckets].sort((a, b) => a.lat - b.lat);
    const az = sorted[0]!;
    const ne = sorted[1]!;

    // AZ bucket: round(31.72 * 4)/4 = 127/4 = 31.75 (round-half-to-even per
    // Postgres `round`; 31.72*4 = 126.88 → 127). lng: -110.88*4 = -443.52 → -444/4 = -111.
    expect(az.lat).toBeCloseTo(31.75, 6);
    expect(az.lng).toBeCloseTo(-111, 6);
    expect(az.count).toBe(2);
    expect(az.speciesCount).toBe(2);
    // #859 — families is now a nested array of {code,count,speciesCount,species}.
    const azFamCodes = az.families.map(f => f.code).sort();
    expect(azFamCodes).toEqual(['trochilidae', 'tyrannidae']);
    // Each family has exactly one species in this cell, count 1.
    for (const fam of az.families) {
      expect(fam.count).toBe(1);
      expect(fam.speciesCount).toBe(1);
      expect(fam.species).toHaveLength(1);
      expect(fam.species[0]!.count).toBe(1);
    }
    const tyr = az.families.find(f => f.code === 'tyrannidae')!;
    expect(tyr.species[0]!.code).toBe('vermfly');
    const tro = az.families.find(f => f.code === 'trochilidae')!;
    expect(tro.species[0]!.code).toBe('annhum');
    // #924 PR4 — family.name is projected from
    // COALESCE(family_silhouettes.common_name, species_meta.family_name). No
    // family_silhouettes rows are seeded in this test, so both resolve via the
    // SECOND arm (sm.family_name, seeded at lines 17-18).
    expect(tyr.name).toBe('Tyrant Flycatchers');
    expect(tro.name).toBe('Hummingbirds');

    expect(ne.count).toBe(1);
    expect(ne.speciesCount).toBe(1);
    expect(ne.families).toHaveLength(1);
    expect(ne.families[0]!.code).toBe('tyrannidae');
    expect(ne.families[0]!.count).toBe(1);
    expect(ne.families[0]!.name).toBe('Tyrant Flycatchers');
    expect(ne.families[0]!.species).toEqual([{ code: 'vermfly', count: 1 }]);
  });

  it('respects the bbox filter', async () => {
    const buckets = await getObservationsAggregated(
      db.pool,
      { bbox: [-112, 31, -110, 32] },
      4,
    );
    expect(buckets).toHaveLength(1);
    expect(buckets[0]!.count).toBe(2);
  });

  it('respects since/family filters', async () => {
    await db.pool.query(`UPDATE observations SET obs_dt = now() - interval '5 days' WHERE sub_id='A1'`);
    await db.pool.query(`UPDATE observations SET obs_dt = now() - interval '40 days' WHERE sub_id IN ('A2','A3')`);
    const buckets = await getObservationsAggregated(db.pool, { since: '14d' }, 4);
    const total = buckets.reduce((s, b) => s + b.count, 0);
    expect(total).toBe(1);
  });

  it('grid resolution responds to the multiplier — at 1 (1° grid), all 3 cluster into 2 cells', async () => {
    // multiplier=2 → 0.5° buckets. At lat 31.72 and lat 31.73 both round
    // to the same 0.5° bucket (31.5); same for lng. So 2 rows merge, third
    // is separate → 2 buckets total.
    const buckets = await getObservationsAggregated(db.pool, {}, 2);
    expect(buckets.length).toBe(2);
  });
});

// #859 — per-family species nesting with the top-8 cap. The compute-on-write
// re-architecture: each bucket carries the REAL species per family so the
// frontend renders them directly (no synthetic rows, no lazy per-click fetch).
// These tests exercise the cap, the per-family + per-bucket ordering, the
// exact-totals-vs-capped-list distinction, and the NULL-family carve-out.
describe('getObservationsAggregated species nesting (#859)', () => {
  // A mega-family with >8 species (exercises the top-8 cap) plus a small
  // family, all in ONE 0.25° cell. Per-species observation counts are
  // deliberately skewed so "top-8 by count" has a single correct answer.
  beforeAll(async () => {
    // Seed species_meta for a 12-species mega-family + a 2-species family.
    // mega-001..mega-012 in family 'megafam'; small-A/small-B in 'smallfam'.
    const megaValues: string[] = [];
    for (let i = 1; i <= 12; i++) {
      const code = `mega-${String(i).padStart(3, '0')}`;
      megaValues.push(`('${code}', 'Mega ${i}', 'Megus ${i}', 'megafam', 'Mega Family', ${40000 + i})`);
    }
    await db.pool.query(
      `INSERT INTO species_meta (species_code, com_name, sci_name, family_code, family_name, taxon_order)
       VALUES ${megaValues.join(',')},
         ('small-A', 'Small A', 'Smallus a', 'smallfam', 'Small Family', 50001),
         ('small-B', 'Small B', 'Smallus b', 'smallfam', 'Small Family', 50002)
       ON CONFLICT (species_code) DO NOTHING`
    );
  });

  beforeEach(async () => {
    await db.pool.query('TRUNCATE observations');
    // All rows in the SAME cell (lat ~31.72, lng ~-110.88). Per-species obs
    // counts: mega-001 → 12 obs, mega-002 → 11, ... mega-012 → 1 (i.e. count =
    // 13 - i). smallfam: small-A → 3 obs, small-B → 2 obs.
    const rows: string[] = [];
    for (let i = 1; i <= 12; i++) {
      const code = `mega-${String(i).padStart(3, '0')}`;
      const n = 13 - i; // mega-001 most common (12) … mega-012 least (1)
      for (let k = 0; k < n; k++) {
        rows.push(
          `('S-${code}-${k}', '${code}', 31.72, -110.88, now(), 'L1', 'X', 1, false)`
        );
      }
    }
    for (let k = 0; k < 3; k++) rows.push(`('S-smA-${k}', 'small-A', 31.72, -110.88, now(), 'L1', 'X', 1, false)`);
    for (let k = 0; k < 2; k++) rows.push(`('S-smB-${k}', 'small-B', 31.72, -110.88, now(), 'L1', 'X', 1, false)`);
    await db.pool.query(
      `INSERT INTO observations
         (sub_id, species_code, lat, lng, obs_dt, loc_id, loc_name, how_many, is_notable)
       VALUES ${rows.join(',')}`
    );
  });

  it('caps species per family at top-8 by count, keeping speciesCount exact (>8)', async () => {
    const buckets = await getObservationsAggregated(db.pool, {}, 4);
    expect(buckets).toHaveLength(1);
    const mega = buckets[0]!.families.find(f => f.code === 'megafam')!;

    // EXACT family totals: 12 species, sum(1..12) = 78 observations.
    expect(mega.speciesCount).toBe(12);
    expect(mega.count).toBe(78);

    // The species LIST is capped to 8 even though speciesCount is 12 — this is
    // the load-bearing distinction that powers an honest "+4 more".
    expect(mega.species).toHaveLength(8);
    expect(mega.speciesCount).toBeGreaterThan(mega.species.length);
  });

  it('orders the per-family species by count desc, ties broken by code asc', async () => {
    const buckets = await getObservationsAggregated(db.pool, {}, 4);
    const mega = buckets[0]!.families.find(f => f.code === 'megafam')!;
    // mega-001 (12 obs) … mega-008 (5 obs) are the top 8.
    expect(mega.species).toEqual([
      { code: 'mega-001', count: 12 },
      { code: 'mega-002', count: 11 },
      { code: 'mega-003', count: 10 },
      { code: 'mega-004', count: 9 },
      { code: 'mega-005', count: 8 },
      { code: 'mega-006', count: 7 },
      { code: 'mega-007', count: 6 },
      { code: 'mega-008', count: 5 },
    ]);
  });

  it('tie-breaks equal-count species by code asc deterministically', async () => {
    // Two species with the SAME count in one cell: code asc decides order.
    await db.pool.query('TRUNCATE observations');
    await db.pool.query(
      `INSERT INTO observations
         (sub_id, species_code, lat, lng, obs_dt, loc_id, loc_name, how_many, is_notable)
       VALUES
         ('T-1', 'small-B', 31.72, -110.88, now(), 'L', 'X', 1, false),
         ('T-2', 'small-A', 31.72, -110.88, now(), 'L', 'X', 1, false)`
    );
    const buckets = await getObservationsAggregated(db.pool, {}, 4);
    const small = buckets[0]!.families.find(f => f.code === 'smallfam')!;
    // Both count 1 → code asc → small-A before small-B.
    expect(small.species).toEqual([
      { code: 'small-A', count: 1 },
      { code: 'small-B', count: 1 },
    ]);
  });

  it('orders families by family count desc (ties by code asc)', async () => {
    const buckets = await getObservationsAggregated(db.pool, {}, 4);
    const fams = buckets[0]!.families;
    // megafam (78 obs) before smallfam (5 obs).
    expect(fams.map(f => f.code)).toEqual(['megafam', 'smallfam']);
  });

  it('excludes NULL-family species from families[] but still counts them in bucket totals', async () => {
    // Add observations for a species with NO species_meta row (family unknown)
    // in the same cell. Per the array_remove(...,NULL) precedent: the unknown-
    // family species must NOT appear in families[], but its observations MUST
    // still land in the bucket count/speciesCount totals.
    await db.pool.query('TRUNCATE observations');
    await db.pool.query(
      `INSERT INTO observations
         (sub_id, species_code, lat, lng, obs_dt, loc_id, loc_name, how_many, is_notable)
       VALUES
         ('K-1', 'small-A', 31.72, -110.88, now(), 'L', 'X', 1, false),
         ('U-1', 'orphan-x', 31.72, -110.88, now(), 'L', 'X', 1, false),
         ('U-2', 'orphan-x', 31.72, -110.88, now(), 'L', 'X', 1, false)`
    );
    const buckets = await getObservationsAggregated(db.pool, {}, 4);
    expect(buckets).toHaveLength(1);
    const b = buckets[0]!;

    // Bucket totals count ALL rows (3 obs, 2 distinct species).
    expect(b.count).toBe(3);
    expect(b.speciesCount).toBe(2);

    // families[] excludes the unknown-family species entirely — only smallfam.
    expect(b.families.map(f => f.code)).toEqual(['smallfam']);
    const small = b.families[0]!;
    expect(small.count).toBe(1);
    expect(small.speciesCount).toBe(1);
    expect(small.species).toEqual([{ code: 'small-A', count: 1 }]);
  });

  it('still applies the bbox filter under the nested shape', async () => {
    // A bbox that excludes the seeded cell returns nothing.
    const out = await getObservationsAggregated(db.pool, { bbox: [-80, 25, -79, 26] }, 4);
    expect(out).toEqual([]);
    // A bbox that includes it returns the single cell with the nested families.
    const inb = await getObservationsAggregated(db.pool, { bbox: [-112, 31, -110, 32] }, 4);
    expect(inb).toHaveLength(1);
    expect(inb[0]!.families.find(f => f.code === 'megafam')).toBeDefined();
  });
});

describe('runReconcileStamping', () => {
  it('fills NULL silhouette_id on existing rows after species_meta lands', async () => {
    // Wipe species_meta so the initial upsert leaves silhouette_id NULL (the
    // exact prod shape in #83: observations ingested before species_meta was
    // populated).
    await db.pool.query('TRUNCATE species_meta CASCADE');

    await upsertObservations(db.pool, [
      {
        subId: 'S900', speciesCode: 'vermfly', comName: 'Vermilion Flycatcher',
        lat: 31.72, lng: -110.88, obsDt: '2026-04-15T08:00:00Z',
        locId: 'L1', locName: 'Madera', howMany: 1, isNotable: false,
      },
    ]);
    const { data: before } = await getObservations(db.pool, {});
    expect(before[0]?.silhouetteId).toBeNull();

    // Populate species_meta (simulating a successful runTaxonomy) and reconcile.
    await db.pool.query(
      `INSERT INTO species_meta (species_code, com_name, sci_name, family_code, family_name)
       VALUES ('vermfly', 'Vermilion Flycatcher', 'Pyrocephalus rubinus', 'tyrannidae', 'Tyrant Flycatchers')`
    );
    const touched = await runReconcileStamping(db.pool);
    expect(touched).toBeGreaterThanOrEqual(1);

    const { data: after } = await getObservations(db.pool, {});
    expect(after[0]?.silhouetteId).toBe('tyrannidae');
    // regionId removed from wire shape by PR-2 of #532; the DB column is
    // dropped in PR-3.
    expect(after[0]).not.toHaveProperty('regionId');
  });

  it('is idempotent — a second run touches no rows', async () => {
    await db.pool.query(
      `INSERT INTO species_meta (species_code, com_name, sci_name, family_code, family_name)
       VALUES ('vermfly', 'Vermilion Flycatcher', 'Pyrocephalus rubinus', 'tyrannidae', 'Tyrant Flycatchers')
       ON CONFLICT (species_code) DO UPDATE SET family_code = EXCLUDED.family_code`
    );
    await upsertObservations(db.pool, [
      {
        subId: 'S901', speciesCode: 'vermfly', comName: 'Vermilion Flycatcher',
        lat: 31.72, lng: -110.88, obsDt: '2026-04-15T08:00:00Z',
        locId: 'L1', locName: 'Madera', howMany: 1, isNotable: false,
      },
    ]);
    // Everything already stamped — reconcile should find nothing to update.
    const touched = await runReconcileStamping(db.pool);
    expect(touched).toBe(0);
  });
});
