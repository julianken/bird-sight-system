import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { startTestDb, type TestDb } from './test-helpers.js';
import {
  upsertObservations, getObservations, runReconcileStamping,
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

  it('inserts new observations and stamps region_id + silhouette_id', async () => {
    const count = await upsertObservations(db.pool, sample);
    expect(count).toBe(2);

    const all = await getObservations(db.pool, {});
    expect(all).toHaveLength(2);
    const verm = all.find(o => o.subId === 'S100')!;
    expect(verm.regionId).toBe('sky-islands-santa-ritas');
    expect(verm.silhouetteId).toBe('tyrannidae');
    expect(verm.familyCode).toBe('tyrannidae');
    const anna = all.find(o => o.subId === 'S101')!;
    expect(anna.regionId).toBe('sonoran-tucson');
    expect(anna.silhouetteId).toBe('trochilidae');
    expect(anna.familyCode).toBe('trochilidae');
    expect(anna.isNotable).toBe(true);
  });

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
});

describe('runReconcileStamping', () => {
  it('fills NULL silhouette_id / region_id on existing rows after species_meta lands', async () => {
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
    // region_id comes from the geometry JOIN which is independent of species_meta,
    // so it is already populated. Null it out to prove reconcile fills it too.
    await db.pool.query("UPDATE observations SET region_id = NULL WHERE sub_id = 'S900'");

    // Populate species_meta (simulating a successful runTaxonomy) and reconcile.
    await db.pool.query(
      `INSERT INTO species_meta (species_code, com_name, sci_name, family_code, family_name)
       VALUES ('vermfly', 'Vermilion Flycatcher', 'Pyrocephalus rubinus', 'tyrannidae', 'Tyrant Flycatchers')`
    );
    const touched = await runReconcileStamping(db.pool);
    expect(touched).toBeGreaterThanOrEqual(1);

    const after = await getObservations(db.pool, {});
    expect(after[0]?.silhouetteId).toBe('tyrannidae');
    expect(after[0]?.regionId).toBe('sky-islands-santa-ritas');
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
