import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { startTestDb, type TestDb } from '@bird-watch/db-client/dist/test-helpers.js';
import { upsertSpeciesMeta, getSpeciesPhotos, insertSpeciesPhoto } from '@bird-watch/db-client';

// Mock the iNat client and R2 uploader at the module boundary BEFORE importing
// run-photos. The orchestrator's job is to compose those two side-effects with
// the DB writes — the components themselves are exhaustively covered by their
// own test suites (./inat/client.test.ts, ./r2/uploader.test.ts), so we stub
// them here to keep this test focused on orchestration semantics
// (skip-if-already-photographed, force-refresh, per-species error isolation,
// rate-limit pacing).
const fetchInatPhotoMock = vi.fn();
const uploadToR2Mock = vi.fn();

vi.mock('./inat/client.js', () => ({
  fetchInatPhoto: (...args: unknown[]) => fetchInatPhotoMock(...args),
}));

vi.mock('./r2/uploader.js', () => ({
  uploadToR2: (...args: unknown[]) => uploadToR2Mock(...args),
  R2UploadError: class R2UploadError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'R2UploadError';
    }
  },
}));

import { runPhotos } from './run-photos.js';

let db: TestDb;

const SPECIES_FIXTURE = [
  {
    speciesCode: 'verfly',
    comName: 'Vermilion Flycatcher',
    sciName: 'Pyrocephalus rubinus',
    familyCode: 'tyrannidae',
    familyName: 'Tyrant Flycatchers',
    taxonOrder: 30501,
  },
  {
    speciesCode: 'annhum',
    comName: "Anna's Hummingbird",
    sciName: 'Calypte anna',
    familyCode: 'trochilidae',
    familyName: 'Hummingbirds',
    taxonOrder: 6000,
  },
  {
    speciesCode: 'norcar',
    comName: 'Northern Cardinal',
    sciName: 'Cardinalis cardinalis',
    familyCode: 'cardinalidae',
    familyName: 'Cardinals and Allies',
    taxonOrder: 32000,
  },
];

beforeAll(async () => {
  db = await startTestDb();
}, 90_000);

beforeEach(async () => {
  await db.pool.query('TRUNCATE species_photos RESTART IDENTITY CASCADE');
  await db.pool.query('TRUNCATE species_meta CASCADE');
  fetchInatPhotoMock.mockReset();
  uploadToR2Mock.mockReset();
  await upsertSpeciesMeta(db.pool, SPECIES_FIXTURE);
});

afterAll(async () => {
  await db?.stop();
});

describe('runPhotos', () => {
  it('runPhotos with 3 species, all 3 iNat returns photos, all 3 R2 uploads succeed → insertSpeciesPhoto called 3 times with correct URLs', async () => {
    fetchInatPhotoMock.mockImplementation(async (sciName: string) => ({
      url: `https://inat.example.test/${encodeURIComponent(sciName)}/medium.jpg`,
      attribution: `(c) somebody for ${sciName}, CC BY`,
      license: 'cc-by',
    }));
    uploadToR2Mock.mockImplementation(async (_imageUrl: string, destKey: string) => {
      return `https://photos.bird-maps.com/${destKey}`;
    });

    const summary = await runPhotos({ pool: db.pool, paceMs: 0 });

    expect(summary.speciesCount).toBe(3);
    expect(summary.photosFetched).toBe(3);
    expect(summary.photosSkipped).toBe(0);
    expect(summary.photosFailed).toBe(0);
    expect(summary.errors).toEqual([]);

    // iNat called once per species using the SCIENTIFIC name.
    expect(fetchInatPhotoMock).toHaveBeenCalledTimes(3);
    const sciNamesQueried = fetchInatPhotoMock.mock.calls.map(c => c[0]);
    expect(sciNamesQueried).toEqual(
      expect.arrayContaining([
        'Pyrocephalus rubinus',
        'Calypte anna',
        'Cardinalis cardinalis',
      ])
    );

    // R2 called once per species; each destKey is grounded in the speciesCode.
    expect(uploadToR2Mock).toHaveBeenCalledTimes(3);
    const destKeys = uploadToR2Mock.mock.calls.map(c => c[1] as string);
    for (const code of ['verfly', 'annhum', 'norcar']) {
      expect(destKeys.some(k => k.includes(code))).toBe(true);
    }

    // DB row landed for each species with the public CDN URL.
    for (const code of ['verfly', 'annhum', 'norcar']) {
      const rows = await getSpeciesPhotos(db.pool, code);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.purpose).toBe('detail-panel');
      expect(rows[0]?.url).toMatch(/^https:\/\/photos\.bird-maps\.com\//);
      expect(rows[0]?.url).toContain(code);
      expect(rows[0]?.license).toBe('cc-by');
      expect(rows[0]?.attribution).toContain(code === 'verfly'
        ? 'Pyrocephalus rubinus'
        : code === 'annhum' ? 'Calypte anna' : 'Cardinalis cardinalis');
    }
  });

  it('runPhotos skips species where iNat returns null (no R2 upload, no DB write for that code)', async () => {
    fetchInatPhotoMock.mockImplementation(async (sciName: string) => {
      if (sciName === 'Calypte anna') return null;
      return {
        url: `https://inat.example.test/${encodeURIComponent(sciName)}/medium.jpg`,
        attribution: `(c) somebody for ${sciName}, CC BY`,
        license: 'cc-by',
      };
    });
    uploadToR2Mock.mockImplementation(async (_imageUrl: string, destKey: string) => {
      return `https://photos.bird-maps.com/${destKey}`;
    });

    const summary = await runPhotos({ pool: db.pool, paceMs: 0 });

    expect(summary.speciesCount).toBe(3);
    expect(summary.photosFetched).toBe(2);
    expect(summary.photosSkipped).toBe(1);
    expect(summary.photosFailed).toBe(0);

    // R2 should be called only for the two species that returned photos.
    expect(uploadToR2Mock).toHaveBeenCalledTimes(2);
    const destKeys = uploadToR2Mock.mock.calls.map(c => c[1] as string);
    expect(destKeys.some(k => k.includes('annhum'))).toBe(false);

    // DB: no row for the skipped species; rows for the other two.
    expect(await getSpeciesPhotos(db.pool, 'annhum')).toEqual([]);
    expect(await getSpeciesPhotos(db.pool, 'verfly')).toHaveLength(1);
    expect(await getSpeciesPhotos(db.pool, 'norcar')).toHaveLength(1);
  });

  it('runPhotos skips species that already have a non-null photo unless forceRefresh=true', async () => {
    // Pre-seed a detail-panel photo for verfly.
    await insertSpeciesPhoto(db.pool, {
      speciesCode: 'verfly',
      purpose: 'detail-panel',
      url: 'https://photos.bird-maps.com/verfly-EXISTING.jpg',
      attribution: '(c) prior, CC BY',
      license: 'cc-by',
    });

    fetchInatPhotoMock.mockImplementation(async (sciName: string) => ({
      url: `https://inat.example.test/${encodeURIComponent(sciName)}/medium.jpg`,
      attribution: `(c) fresh for ${sciName}, CC BY`,
      license: 'cc-by',
    }));
    uploadToR2Mock.mockImplementation(async (_imageUrl: string, destKey: string) => {
      return `https://photos.bird-maps.com/${destKey}-FRESH`;
    });

    // First run: forceRefresh=false (default). Should leave the existing
    // verfly row alone and only photograph the other two.
    const summary1 = await runPhotos({ pool: db.pool, paceMs: 0 });
    expect(summary1.speciesCount).toBe(3);
    expect(summary1.photosFetched).toBe(2);
    expect(summary1.photosSkipped).toBe(1);

    // verfly was skipped — neither iNat nor R2 was called for its sciName.
    const sciNamesQueried1 = fetchInatPhotoMock.mock.calls.map(c => c[0]);
    expect(sciNamesQueried1).not.toContain('Pyrocephalus rubinus');

    // The pre-seeded URL is unchanged.
    const verflyRows = await getSpeciesPhotos(db.pool, 'verfly');
    expect(verflyRows[0]?.url).toBe('https://photos.bird-maps.com/verfly-EXISTING.jpg');

    // Second run: forceRefresh=true. All 3 species are photographed (verfly
    // included), and the existing verfly row is upserted to the new URL.
    fetchInatPhotoMock.mockClear();
    uploadToR2Mock.mockClear();
    const summary2 = await runPhotos({
      pool: db.pool,
      forceRefresh: true,
      paceMs: 0,
    });

    expect(summary2.photosFetched).toBe(3);
    expect(summary2.photosSkipped).toBe(0);
    const sciNamesQueried2 = fetchInatPhotoMock.mock.calls.map(c => c[0]);
    expect(sciNamesQueried2).toContain('Pyrocephalus rubinus');

    const verflyAfter = await getSpeciesPhotos(db.pool, 'verfly');
    expect(verflyAfter).toHaveLength(1);
    expect(verflyAfter[0]?.url).toContain('FRESH');
  });

  it('runPhotos logs failure for a single species but continues processing remaining species', async () => {
    // verfly's iNat call throws; annhum's R2 upload throws; norcar succeeds.
    fetchInatPhotoMock.mockImplementation(async (sciName: string) => {
      if (sciName === 'Pyrocephalus rubinus') {
        throw new Error('iNat blew up for verfly');
      }
      return {
        url: `https://inat.example.test/${encodeURIComponent(sciName)}/medium.jpg`,
        attribution: `(c) somebody for ${sciName}, CC BY`,
        license: 'cc-by',
      };
    });
    uploadToR2Mock.mockImplementation(async (_imageUrl: string, destKey: string) => {
      if (destKey.includes('annhum')) {
        throw new Error('R2 PutObject blew up for annhum');
      }
      return `https://photos.bird-maps.com/${destKey}`;
    });

    const summary = await runPhotos({ pool: db.pool, paceMs: 0 });

    expect(summary.speciesCount).toBe(3);
    expect(summary.photosFetched).toBe(1); // norcar
    expect(summary.photosFailed).toBe(2); // verfly + annhum
    expect(summary.errors).toHaveLength(2);

    const failedCodes = summary.errors.map(e => e.speciesCode).sort();
    expect(failedCodes).toEqual(['annhum', 'verfly']);
    // Each error captures a non-empty reason string for log triage.
    for (const e of summary.errors) {
      expect(e.reason).toBeTruthy();
      expect(typeof e.reason).toBe('string');
    }

    // The successful species still landed in the DB. The failed ones did not.
    expect(await getSpeciesPhotos(db.pool, 'norcar')).toHaveLength(1);
    expect(await getSpeciesPhotos(db.pool, 'verfly')).toEqual([]);
    expect(await getSpeciesPhotos(db.pool, 'annhum')).toEqual([]);
  });
});
