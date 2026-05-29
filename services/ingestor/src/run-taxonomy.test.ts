import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { startTestDb, type TestDb } from '@bird-watch/db-client/dist/test-helpers.js';
import {
  getSpeciesMeta, getObservations, getRecentIngestRuns,
  upsertObservations,
} from '@bird-watch/db-client';
import { runTaxonomy } from './run-taxonomy.js';

const server = setupServer();
let db: TestDb;

// A realistic mix: 5 species rows + 2 non-species (issf + spuh). After #527
// PR-2 the filter keeps all 7 known eBird categories — issf/spuh/hybrid/
// slash/domestic/form upsert alongside species. The "unknown future eBird
// category" case has its own test below.
const TAXONOMY_FIXTURE = [
  {
    sciName: 'Pyrocephalus rubinus', comName: 'Vermilion Flycatcher',
    speciesCode: 'verfly', category: 'species', taxonOrder: 30501,
    familyCode: 'tyrann1', familyComName: 'Tyrant Flycatchers',
    familySciName: 'Tyrannidae',
  },
  {
    sciName: 'Calypte anna', comName: "Anna's Hummingbird",
    speciesCode: 'annhum', category: 'species', taxonOrder: 6000,
    familyCode: 'trochi1', familyComName: 'Hummingbirds',
    familySciName: 'Trochilidae',
  },
  {
    sciName: 'Cardinalis cardinalis', comName: 'Northern Cardinal',
    speciesCode: 'norcar', category: 'species', taxonOrder: 32000,
    familyCode: 'cardin1', familyComName: 'Cardinals and Allies',
    familySciName: 'Cardinalidae',
  },
  {
    sciName: 'Megascops trichopsis', comName: 'Whiskered Screech-Owl',
    speciesCode: 'whsowl1', category: 'species', taxonOrder: 4300,
    familyCode: 'strigi1', familyComName: 'Owls',
    familySciName: 'Strigidae',
  },
  {
    sciName: 'Contopus pertinax', comName: 'Greater Pewee',
    speciesCode: 'grepew1', category: 'species', taxonOrder: 30000,
    familyCode: 'tyrann1', familyComName: 'Tyrant Flycatchers',
    familySciName: 'Tyrannidae',
  },
  // issf — subspecies form, kept post-#527
  {
    sciName: 'Junco hyemalis hyemalis/carolinensis',
    comName: 'Dark-eyed Junco (Slate-colored)',
    speciesCode: 'daejun1', category: 'issf', taxonOrder: 31000,
    familyCode: 'passer1', familyComName: 'Old World Sparrows',
    familySciName: 'Passeridae',
  },
  // spuh — genus-level, kept post-#527
  {
    sciName: 'Empidonax sp.', comName: 'Empidonax flycatcher sp.',
    speciesCode: 'y00005', category: 'spuh', taxonOrder: 30400,
    familyCode: 'tyrann1', familyComName: 'Tyrant Flycatchers',
    familySciName: 'Tyrannidae',
  },
];

// All 7 known eBird categories — used by the post-#527 test that exercises
// the full allowlist plus a forward-compat unknown-category row that must
// still be filtered out.
const ALL_CATEGORIES_FIXTURE = [
  {
    sciName: 'Pyrocephalus rubinus', comName: 'Vermilion Flycatcher',
    speciesCode: 'verfly', category: 'species', taxonOrder: 30501,
    familyCode: 'tyrann1', familyComName: 'Tyrant Flycatchers',
    familySciName: 'Tyrannidae',
  },
  {
    sciName: 'Junco hyemalis hyemalis', comName: 'Dark-eyed Junco (Slate-colored)',
    speciesCode: 'daejun1', category: 'issf', taxonOrder: 31000,
    familyCode: 'passer1', familyComName: 'Old World Sparrows',
    familySciName: 'Passeridae',
  },
  {
    sciName: 'Icterus bullockii x galbula', comName: "Bullock's x Baltimore Oriole (hybrid)",
    speciesCode: 'x00013', category: 'hybrid', taxonOrder: 32500,
    familyCode: 'icteri1', familyComName: 'Troupials and Allies',
    familySciName: 'Icteridae',
  },
  {
    sciName: 'Empidonax sp.', comName: 'Empidonax flycatcher sp.',
    speciesCode: 'y00005', category: 'spuh', taxonOrder: 30400,
    familyCode: 'tyrann1', familyComName: 'Tyrant Flycatchers',
    familySciName: 'Tyrannidae',
  },
  {
    sciName: 'Buteo jamaicensis/swainsoni',
    comName: 'Red-tailed/Swainson’s Hawk',
    speciesCode: 'y00050', category: 'slash', taxonOrder: 5100,
    familyCode: 'accipi1', familyComName: 'Hawks, Eagles, and Kites',
    familySciName: 'Accipitridae',
  },
  {
    sciName: 'Anas platyrhynchos (Domestic type)',
    comName: 'Mallard (Domestic type)',
    speciesCode: 'maldom', category: 'domestic', taxonOrder: 250,
    familyCode: 'anatid1', familyComName: 'Ducks, Geese, and Waterfowl',
    familySciName: 'Anatidae',
  },
  {
    sciName: 'Columba livia (Feral Pigeon)', comName: 'Rock Pigeon (Feral Pigeon)',
    speciesCode: 'rocpig1', category: 'form', taxonOrder: 14000,
    familyCode: 'columb1', familyComName: 'Pigeons and Doves',
    familySciName: 'Columbidae',
  },
  // Forward-compat: an eBird-invented 8th category. Must be filtered out so
  // a future schema change can't silently land rows with unknown semantics.
  // The Set<EbirdTaxon['category']> typing in run-taxonomy.ts ensures we
  // can't accidentally widen the allowlist without a type-system signal.
  {
    sciName: 'Future Sp.', comName: 'Future Category Bird',
    speciesCode: 'z99999', category: 'newcategory', taxonOrder: 99999,
    familyCode: 'futur1', familyComName: 'Future Family',
    familySciName: 'Futuridae',
  },
];

beforeAll(async () => {
  db = await startTestDb();
  server.listen({ onUnhandledRequest: 'error' });
}, 90_000);

afterEach(() => server.resetHandlers());
beforeEach(async () => {
  await db.pool.query('TRUNCATE species_meta CASCADE');
  await db.pool.query('TRUNCATE observations');
  await db.pool.query('TRUNCATE ingest_runs RESTART IDENTITY');
});

afterAll(async () => {
  server.close();
  await db?.stop();
});

describe('runTaxonomy', () => {
  it('fetches taxonomy, keeps all 7 known categories, upserts species_meta, records success run', async () => {
    server.use(
      http.get('https://api.ebird.org/v2/ref/taxonomy/ebird', () =>
        HttpResponse.json(TAXONOMY_FIXTURE)
      )
    );

    const summary = await runTaxonomy({
      pool: db.pool, apiKey: 'test-key',
    });

    expect(summary.status).toBe('success');
    expect(summary.totalFetched).toBe(7);
    // Post-#527 PR-2: issf + spuh are kept alongside species. Nothing is
    // filtered because all 7 fixture rows match a known category.
    expect(summary.nonSpeciesFiltered).toBe(0);
    expect(summary.speciesInserted).toBe(7);

    // Verify a real row landed. `family_code` is derived from `familySciName`
    // (lowercased) — not eBird's `familyCode` — because family_silhouettes is
    // seeded with lowercased-sci-name keys (migration 1700000009000) and the
    // stamping JOIN in observations.ts relies on this alignment.
    const verfly = await getSpeciesMeta(db.pool, 'verfly');
    expect(verfly).toEqual({
      speciesCode: 'verfly',
      comName: 'Vermilion Flycatcher',
      sciName: 'Pyrocephalus rubinus',
      familyCode: 'tyrannidae',
      familyName: 'Tyrant Flycatchers',
      taxonOrder: 30501,
    });

    // The hybrid/spuh/issf rows that #484 used to drop now land. This is the
    // structural fix for the x00013 incident (#527).
    expect(await getSpeciesMeta(db.pool, 'daejun1')).not.toBeNull();
    expect(await getSpeciesMeta(db.pool, 'y00005')).not.toBeNull();

    // Ingest run is recorded with kind='taxonomy' and status='success'.
    const runs = await getRecentIngestRuns(db.pool, 5);
    expect(runs[0]?.kind).toBe('taxonomy');
    expect(runs[0]?.status).toBe('success');
    expect(runs[0]?.obsFetched).toBe(7);
    expect(runs[0]?.obsUpserted).toBe(7);
  });

  it('keeps all 7 eBird categories and filters out unknown future categories (#527 forward-compat)', async () => {
    server.use(
      http.get('https://api.ebird.org/v2/ref/taxonomy/ebird', () =>
        HttpResponse.json(ALL_CATEGORIES_FIXTURE)
      )
    );

    const summary = await runTaxonomy({
      pool: db.pool, apiKey: 'test-key',
    });

    expect(summary.status).toBe('success');
    expect(summary.totalFetched).toBe(8);
    // 7 known categories kept + 1 unknown ('newcategory') filtered.
    expect(summary.nonSpeciesFiltered).toBe(1);
    expect(summary.speciesInserted).toBe(7);

    // Each of the 7 known categories produced a species_meta row.
    expect(await getSpeciesMeta(db.pool, 'verfly')).not.toBeNull();  // species
    expect(await getSpeciesMeta(db.pool, 'daejun1')).not.toBeNull(); // issf
    expect(await getSpeciesMeta(db.pool, 'x00013')).not.toBeNull();  // hybrid
    expect(await getSpeciesMeta(db.pool, 'y00005')).not.toBeNull();  // spuh
    expect(await getSpeciesMeta(db.pool, 'y00050')).not.toBeNull();  // slash
    expect(await getSpeciesMeta(db.pool, 'maldom')).not.toBeNull();  // domestic
    expect(await getSpeciesMeta(db.pool, 'rocpig1')).not.toBeNull(); // form

    // The forward-compat row with an unknown category is NOT upserted. If
    // eBird ever invents an 8th category, the relaxed missing-code invariant
    // in run-ingest.ts (PR-3, gated on #528) is what surfaces it — not a
    // silent insert here with unknown semantics.
    expect(await getSpeciesMeta(db.pool, 'z99999')).toBeNull();
  });

  it('reconcile-stamps existing observations — post-run they carry silhouette_id (region_id no longer stamped; #532 PR-1)', async () => {
    // Seed an observation BEFORE species_meta is populated. With an empty
    // species_meta, upsertObservations' stamping JOIN finds nothing, so
    // silhouette_id stays NULL (the exact prod bug in #83).
    await upsertObservations(db.pool, [
      {
        subId: 'S200', speciesCode: 'verfly', comName: 'verfly',
        lat: 31.72, lng: -110.88,
        obsDt: '2026-04-15T08:00:00.000Z',
        locId: 'L1', locName: 'Madera', howMany: 1, isNotable: false,
      },
    ]);
    const { data: before } = await getObservations(db.pool, {});
    expect(before[0]?.silhouetteId).toBeNull();

    server.use(
      http.get('https://api.ebird.org/v2/ref/taxonomy/ebird', () =>
        HttpResponse.json(TAXONOMY_FIXTURE)
      )
    );

    const summary = await runTaxonomy({
      pool: db.pool, apiKey: 'test-key',
    });
    expect(summary.status).toBe('success');

    const { data: after } = await getObservations(db.pool, {});
    // verfly → tyrann1 → silhouette 'tyrannidae' (seeded in migration 9)
    expect(after[0]?.silhouetteId).toBe('tyrannidae');
    // regionId removed from wire shape by PR-2 of #532; column dropped in PR-3.
    expect(after[0]).not.toHaveProperty('regionId');
    // comName now resolves through species_meta instead of falling back to code
    expect(after[0]?.comName).toBe('Vermilion Flycatcher');
  });

  it('records failure run when eBird is unreachable', async () => {
    server.use(
      http.get('https://api.ebird.org/v2/ref/taxonomy/ebird', () =>
        new HttpResponse('boom', { status: 502 })
      )
    );

    const summary = await runTaxonomy({
      pool: db.pool, apiKey: 'test-key',
      maxRetries: 0, retryBaseMs: 1,
    });

    expect(summary.status).toBe('failure');
    expect(summary.error).toMatch(/502|server/i);

    const runs = await getRecentIngestRuns(db.pool, 5);
    expect(runs[0]?.kind).toBe('taxonomy');
    expect(runs[0]?.status).toBe('failure');
  });
});
