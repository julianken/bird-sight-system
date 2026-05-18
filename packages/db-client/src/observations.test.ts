import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { startTestDb, type TestDb } from './test-helpers.js';
import {
  upsertObservations, getObservations, getObservationsAggregated,
  getObservationsFeed,
  runReconcileStamping,
  OBSERVATIONS_FEED_LIMIT,
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

    const all = await getObservations(db.pool, {});
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
    const all = await getObservations(db.pool, {});
    const orphan = all.find(o => o.subId === 'S-orphan')!;
    expect(orphan.familyCode).toBeNull();
  });

  it('is idempotent — re-running with the same input does not duplicate', async () => {
    await upsertObservations(db.pool, sample);
    await upsertObservations(db.pool, sample);
    const all = await getObservations(db.pool, {});
    expect(all).toHaveLength(2);
  });

  it('updates is_notable on conflict when value changes', async () => {
    await upsertObservations(db.pool, sample);
    const updated: ObservationInput[] = [{ ...sample[0]!, isNotable: true }];
    await upsertObservations(db.pool, updated);
    const all = await getObservations(db.pool, {});
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
    const all = await getObservations(db.pool, {});
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
    const rows = await getObservations(db.pool, { since: '14d' });
    expect(rows.map(r => r.subId)).toEqual(['S200']);
  });

  it('filters by notable=true', async () => {
    const rows = await getObservations(db.pool, { notable: true });
    expect(rows.map(r => r.subId).sort()).toEqual(['S201']);
  });

  it('filters by species code', async () => {
    const rows = await getObservations(db.pool, { speciesCode: 'vermfly' });
    expect(rows.map(r => r.subId).sort()).toEqual(['S200', 'S202']);
  });

  it('filters by family code', async () => {
    const rows = await getObservations(db.pool, { familyCode: 'trochilidae' });
    expect(rows.map(r => r.subId)).toEqual(['S201']);
  });

  // #619 — server-side bbox filtering (Phase 2 going-national pre-condition).
  // Fixture lat/lng:
  //   S200 = (31.72, -110.88)
  //   S201 = (32.30, -110.99)
  //   S202 = (32.30, -110.99)
  it('filters by bbox: narrow envelope around S200 returns only S200', async () => {
    const rows = await getObservations(db.pool, {
      bbox: [-111.0, 31.5, -110.8, 31.9],
    });
    expect(rows.map(r => r.subId)).toEqual(['S200']);
  });

  it('filters by bbox: wide envelope returns all in-bounds', async () => {
    const rows = await getObservations(db.pool, {
      bbox: [-112.0, 31.0, -110.0, 33.0],
    });
    expect(rows.map(r => r.subId).sort()).toEqual(['S200', 'S201', 'S202']);
  });

  it('filters by bbox: envelope outside fixture returns empty', async () => {
    const rows = await getObservations(db.pool, {
      bbox: [-80.0, 25.0, -79.0, 26.0],
    });
    expect(rows).toEqual([]);
  });

  it('filters by bbox: boundary point is inclusive', async () => {
    // S200 at exactly (31.72, -110.88) — envelope edge passes through it.
    const rows = await getObservations(db.pool, {
      bbox: [-110.88, 31.72, -110.0, 32.0],
    });
    expect(rows.map(r => r.subId)).toContain('S200');
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

  it('groups co-located observations into one bucket and counts species + families', async () => {
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
    expect(az.families.sort()).toEqual(['trochilidae', 'tyrannidae']);

    expect(ne.count).toBe(1);
    expect(ne.speciesCount).toBe(1);
    expect(ne.families).toEqual(['tyrannidae']);
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
    const before = await getObservations(db.pool, {});
    expect(before[0]?.silhouetteId).toBeNull();

    // Populate species_meta (simulating a successful runTaxonomy) and reconcile.
    await db.pool.query(
      `INSERT INTO species_meta (species_code, com_name, sci_name, family_code, family_name)
       VALUES ('vermfly', 'Vermilion Flycatcher', 'Pyrocephalus rubinus', 'tyrannidae', 'Tyrant Flycatchers')`
    );
    const touched = await runReconcileStamping(db.pool);
    expect(touched).toBeGreaterThanOrEqual(1);

    const after = await getObservations(db.pool, {});
    expect(after[0]?.silhouetteId).toBe('tyrannidae');
    // regionId removed from wire shape by PR-2 of #532; the DB column is
    // dropped in PR-3.
    expect(after[0]).not.toHaveProperty('regionId');
  });

  it.skip('placeholder anchor preserved', () => {});
});

// ── getObservationsFeed (#647 — capped feed with COUNT(*) OVER ()) ────────
describe('getObservationsFeed (#647)', () => {
  beforeEach(async () => {
    await db.pool.query('TRUNCATE observations');
  });

  /** Seed N observations spread across a small AZ-shaped bbox. */
  async function seedN(n: number): Promise<void> {
    const inputs: ObservationInput[] = [];
    for (let i = 0; i < n; i++) {
      inputs.push({
        subId: `SF-${i}`,
        speciesCode: i % 2 === 0 ? 'vermfly' : 'annhum',
        comName: 'x',
        lat: 32.0 + (i % 50) * 0.01,
        lng: -111.0 + (i % 50) * 0.01,
        // Spread obsDt so ORDER BY is meaningful; newest = highest i.
        obsDt: new Date(Date.now() - (n - i) * 1000).toISOString(),
        locId: `LF-${i}`,
        locName: null,
        howMany: 1,
        isNotable: false,
      });
    }
    // Insert in batches of 200 — single VALUES list of 600 rows trips the
    // parameter count comfortably below the 65k pg limit, but keep batched
    // for stability across pg-client versions.
    for (let off = 0; off < inputs.length; off += 200) {
      await upsertObservations(db.pool, inputs.slice(off, off + 200));
    }
  }

  it('caps the result at OBSERVATIONS_FEED_LIMIT when total > limit and reports truncated=true with totalCount', async () => {
    await seedN(600);
    const result = await getObservationsFeed(db.pool, {
      bbox: [-115, 31, -109, 37], // AZ-shaped envelope
    });
    expect(result.rows.length).toBe(OBSERVATIONS_FEED_LIMIT);
    expect(result.rows.length).toBe(500);
    expect(result.totalCount).toBe(600);
    expect(result.truncated).toBe(true);
  }, 60_000);

  it('returns all rows when total <= limit and reports truncated=false', async () => {
    await seedN(100);
    const result = await getObservationsFeed(db.pool, {
      bbox: [-115, 31, -109, 37],
    });
    expect(result.rows.length).toBe(100);
    expect(result.totalCount).toBe(100);
    expect(result.truncated).toBe(false);
  }, 60_000);

  it('returns empty result with totalCount=0 and truncated=false when no rows match', async () => {
    await seedN(10);
    // bbox outside the seeded AZ envelope → no matches
    const result = await getObservationsFeed(db.pool, {
      bbox: [-80, 25, -79, 26],
    });
    expect(result.rows).toEqual([]);
    expect(result.totalCount).toBe(0);
    expect(result.truncated).toBe(false);
  }, 60_000);
});

describe('runReconcileStamping (anchor)', () => {
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
