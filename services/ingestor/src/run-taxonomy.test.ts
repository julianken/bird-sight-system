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

// A realistic mix: 5 species rows + 2 non-species (issf + spuh) that must be
// dropped. familyComName → familyName is the only rename.
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
  // issf — subspecies form, must be dropped
  {
    sciName: 'Junco hyemalis hyemalis/carolinensis',
    comName: 'Dark-eyed Junco (Slate-colored)',
    speciesCode: 'daejun1', category: 'issf', taxonOrder: 31000,
    familyCode: 'passer1', familyComName: 'Old World Sparrows',
    familySciName: 'Passeridae',
  },
  // spuh — genus-level, must be dropped
  {
    sciName: 'Empidonax sp.', comName: 'Empidonax flycatcher sp.',
    speciesCode: 'y00005', category: 'spuh', taxonOrder: 30400,
    familyCode: 'tyrann1', familyComName: 'Tyrant Flycatchers',
    familySciName: 'Tyrannidae',
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
  it('fetches taxonomy, filters to species, upserts species_meta, records success run', async () => {
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
    expect(summary.nonSpeciesFiltered).toBe(2);
    expect(summary.speciesInserted).toBe(5);

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

    // Non-species rows are not written.
    expect(await getSpeciesMeta(db.pool, 'daejun1')).toBeNull();
    expect(await getSpeciesMeta(db.pool, 'y00005')).toBeNull();

    // Ingest run is recorded with kind='taxonomy' and status='success'.
    const runs = await getRecentIngestRuns(db.pool, 5);
    expect(runs[0]?.kind).toBe('taxonomy');
    expect(runs[0]?.status).toBe('success');
    expect(runs[0]?.obsFetched).toBe(7);
    expect(runs[0]?.obsUpserted).toBe(5);
  });

  it('reconcile-stamps existing observations — post-run they carry silhouette_id and region_id', async () => {
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
    const before = await getObservations(db.pool, {});
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

    const after = await getObservations(db.pool, {});
    // verfly → tyrann1 → silhouette 'tyrannidae' (seeded in migration 9)
    expect(after[0]?.silhouetteId).toBe('tyrannidae');
    expect(after[0]?.regionId).toBe('sky-islands-santa-ritas');
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
