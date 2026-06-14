import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { startTestDb, type TestDb } from '@bird-watch/db-client/dist/test-helpers.js';
import {
  upsertSpeciesMeta,
  getSpeciesPhotos,
  insertSpeciesPhoto,
  upsertObservations,
} from '@bird-watch/db-client';

// Mock the iNat client, the iNat taxon client, the Wikipedia lead-image
// client, and the R2 uploader at the module boundary BEFORE importing
// run-photos. The orchestrator's job is to compose those side-effects with
// the DB writes — the components themselves are exhaustively covered by
// their own test suites (./inat/client.test.ts, ./inat/taxon-client.test.ts,
// ./wikipedia/lead-image.test.ts, ./r2/uploader.test.ts), so we stub them
// here to keep this test focused on orchestration semantics
// (skip-if-already-photographed, force-refresh, per-species error isolation,
// rate-limit pacing, iNat-null -> Wikipedia-fallback cascade).
const fetchInatPhotoMock = vi.fn();
const fetchInatTaxonMock = vi.fn();
const fetchWikipediaLeadImageMock = vi.fn();
const uploadToR2Mock = vi.fn();

vi.mock('../inat/client.js', () => ({
  fetchInatPhoto: (...args: unknown[]) => fetchInatPhotoMock(...args),
}));

vi.mock('../inat/taxon-client.js', () => ({
  fetchInatTaxon: (...args: unknown[]) => fetchInatTaxonMock(...args),
}));

vi.mock('../wikipedia/lead-image.js', () => ({
  fetchWikipediaLeadImage: (...args: unknown[]) =>
    fetchWikipediaLeadImageMock(...args),
}));

vi.mock('../r2/uploader.js', () => ({
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
  await db.pool.query('TRUNCATE observations CASCADE');
  await db.pool.query('TRUNCATE species_meta CASCADE');
  fetchInatPhotoMock.mockReset();
  fetchInatTaxonMock.mockReset();
  fetchWikipediaLeadImageMock.mockReset();
  uploadToR2Mock.mockReset();
  await upsertSpeciesMeta(db.pool, SPECIES_FIXTURE);
  // Seed one AZ observation per species so all three are visible to the
  // photos job. The dedicated "skips species_meta rows with no observations"
  // test below seeds observations for only one species.
  await upsertObservations(db.pool, [
    {
      subId: 'S100000001',
      speciesCode: 'verfly',
      comName: 'Vermilion Flycatcher',
      lat: 32.2226,
      lng: -110.9747,
      obsDt: '2026-04-30T12:00:00Z',
      locId: 'L100',
      locName: 'Tucson',
      howMany: 1,
      isNotable: false,
    },
    {
      subId: 'S100000002',
      speciesCode: 'annhum',
      comName: "Anna's Hummingbird",
      lat: 33.4484,
      lng: -112.0740,
      obsDt: '2026-04-30T12:00:00Z',
      locId: 'L101',
      locName: 'Phoenix',
      howMany: 1,
      isNotable: false,
    },
    {
      subId: 'S100000003',
      speciesCode: 'norcar',
      comName: 'Northern Cardinal',
      lat: 32.7,
      lng: -111.0,
      obsDt: '2026-04-30T12:00:00Z',
      locId: 'L102',
      locName: 'Casa Grande',
      howMany: 1,
      isNotable: false,
    },
  ]);
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

  it('runPhotos skips species where iNat AND Wikipedia both return null (no R2 upload, no DB write for that code)', async () => {
    fetchInatPhotoMock.mockImplementation(async (sciName: string) => {
      if (sciName === 'Calypte anna') return null;
      return {
        url: `https://inat.example.test/${encodeURIComponent(sciName)}/medium.jpg`,
        attribution: `(c) somebody for ${sciName}, CC BY`,
        license: 'cc-by',
      };
    });
    // Wikipedia fallback path: iNat /v1/taxa says no record either, so the
    // cascade exhausts and the species ends up in `photosSkipped`. Mirrors
    // the pre-#483 behavior — the cascade only adds, never removes.
    fetchInatTaxonMock.mockResolvedValue(null);
    fetchWikipediaLeadImageMock.mockResolvedValue(null);
    uploadToR2Mock.mockImplementation(async (_imageUrl: string, destKey: string) => {
      return `https://photos.bird-maps.com/${destKey}`;
    });

    const summary = await runPhotos({ pool: db.pool, paceMs: 0 });

    expect(summary.speciesCount).toBe(3);
    expect(summary.photosFetched).toBe(2);
    expect(summary.photosFromWikipedia).toBe(0);
    expect(summary.photosSkipped).toBe(1);
    expect(summary.photosFailed).toBe(0);

    // R2 should be called only for the two species that returned photos.
    expect(uploadToR2Mock).toHaveBeenCalledTimes(2);
    const destKeys = uploadToR2Mock.mock.calls.map(c => c[1] as string);
    expect(destKeys.some(k => k.includes('annhum'))).toBe(false);

    // The Wikipedia fallback fired exactly once — for the species iNat
    // couldn't satisfy. It must NOT fire for the two iNat-happy species
    // (would be wasted upstream calls + a deviation from the cascade
    // contract).
    expect(fetchInatTaxonMock).toHaveBeenCalledTimes(1);
    expect(fetchInatTaxonMock).toHaveBeenCalledWith('Calypte anna');

    // DB: no row for the skipped species; rows for the other two.
    expect(await getSpeciesPhotos(db.pool, 'annhum')).toEqual([]);
    expect(await getSpeciesPhotos(db.pool, 'verfly')).toHaveLength(1);
    expect(await getSpeciesPhotos(db.pool, 'norcar')).toHaveLength(1);
  });

  it('runPhotos falls back to Wikipedia lead image when iNat cascade returns null (closes #483)', async () => {
    // Vermilion is a Tier-1 iNat hit (no fallback fires). Anna's is a #483
    // shape — iNat returns null at every tier, the Wikipedia lead image
    // rescues it. Cardinal is also Tier-1 iNat.
    fetchInatPhotoMock.mockImplementation(async (sciName: string) => {
      if (sciName === 'Calypte anna') return null;
      return {
        url: `https://inat.example.test/${encodeURIComponent(sciName)}/medium.jpg`,
        attribution: `(c) iNat photographer for ${sciName}, CC BY`,
        license: 'cc-by',
      };
    });
    fetchInatTaxonMock.mockImplementation(async (sciName: string) => {
      // The taxon-client returns the resolved Wikipedia article URL. The
      // orchestrator parses the title from this URL before hitting the
      // lead-image endpoint.
      if (sciName === 'Calypte anna') {
        return {
          inatTaxonId: 4242,
          wikipediaUrl: 'https://en.wikipedia.org/wiki/Anna%27s_hummingbird',
        };
      }
      throw new Error(`fetchInatTaxon called for unexpected species: ${sciName}`);
    });
    fetchWikipediaLeadImageMock.mockImplementation(async (title: string) => {
      expect(title).toBe("Anna's_hummingbird");
      return {
        url: 'https://upload.wikimedia.org/wikipedia/commons/a/aa/Anna_hummingbird.jpg',
        attribution:
          '(c) Wiki Photographer, CC BY-SA 4.0 (https://commons.wikimedia.org/wiki/File:Anna_hummingbird.jpg)',
        license: 'cc-by-sa-4.0',
      };
    });
    uploadToR2Mock.mockImplementation(async (_imageUrl: string, destKey: string) => {
      return `https://photos.bird-maps.com/${destKey}`;
    });

    const summary = await runPhotos({ pool: db.pool, paceMs: 0 });

    expect(summary.speciesCount).toBe(3);
    // All 3 species end up with photos — Anna's via Wikipedia, the other
    // two via the iNat happy path.
    expect(summary.photosFetched).toBe(3);
    expect(summary.photosFromWikipedia).toBe(1);
    expect(summary.photosSkipped).toBe(0);
    expect(summary.photosFailed).toBe(0);

    // Wikipedia fallback fired exactly once — for the iNat-null species.
    expect(fetchInatTaxonMock).toHaveBeenCalledTimes(1);
    expect(fetchWikipediaLeadImageMock).toHaveBeenCalledTimes(1);

    // The annhum row has the Wikipedia-source attribution + license, and
    // the destKey was derived from the Wikipedia upload URL's extension.
    const annhumRows = await getSpeciesPhotos(db.pool, 'annhum');
    expect(annhumRows).toHaveLength(1);
    expect(annhumRows[0]?.license).toBe('cc-by-sa-4.0');
    expect(annhumRows[0]?.attribution).toContain(
      'https://commons.wikimedia.org/wiki/File:Anna_hummingbird.jpg'
    );

    // The orchestrator must have written the resolved inat_taxon_id back
    // to species_meta so the descriptions job / next photos run can
    // short-circuit the search-endpoint round-trip.
    const cacheCheck = await db.pool.query<{ inat_taxon_id: string | null }>(
      `SELECT inat_taxon_id FROM species_meta WHERE species_code = 'annhum'`
    );
    expect(cacheCheck.rows[0]?.inat_taxon_id).toBe('4242');
  });

  it('runPhotos counts iNat-happy species as photosFetched only (photosFromWikipedia==0)', async () => {
    // Defensive: photosFromWikipedia is incremented only on the Wikipedia
    // path, never on the iNat path. Without this guard a future refactor
    // could conflate the two and break the coverage telemetry that the
    // PR-merge readout (#483 acceptance) depends on.
    fetchInatPhotoMock.mockImplementation(async (sciName: string) => ({
      url: `https://inat.example.test/${encodeURIComponent(sciName)}/medium.jpg`,
      attribution: `(c) iNat for ${sciName}, CC BY`,
      license: 'cc-by',
    }));
    uploadToR2Mock.mockImplementation(async (_imageUrl: string, destKey: string) =>
      `https://photos.bird-maps.com/${destKey}`
    );

    const summary = await runPhotos({ pool: db.pool, paceMs: 0 });

    expect(summary.photosFetched).toBe(3);
    expect(summary.photosFromWikipedia).toBe(0);
    expect(fetchInatTaxonMock).not.toHaveBeenCalled();
    expect(fetchWikipediaLeadImageMock).not.toHaveBeenCalled();
  });

  it('runPhotos skips species when iNat returns null AND Wikipedia returns null (full cascade exhausts)', async () => {
    // The Wikipedia tier exists to lift coverage from ~94% to >98%, not to
    // guarantee 100%. ~2% residual species (stub articles, all-fair-use
    // coverage, vagrants without Wikipedia presence) still fall through
    // to family silhouette. Pin that behavior so a later refactor can't
    // silently add a third tier without acknowledging the gap.
    fetchInatPhotoMock.mockResolvedValue(null);
    fetchInatTaxonMock.mockResolvedValue({
      inatTaxonId: 1,
      wikipediaUrl: 'https://en.wikipedia.org/wiki/Stub',
    });
    fetchWikipediaLeadImageMock.mockResolvedValue(null);

    const summary = await runPhotos({ pool: db.pool, paceMs: 0 });

    expect(summary.speciesCount).toBe(3);
    expect(summary.photosFetched).toBe(0);
    expect(summary.photosFromWikipedia).toBe(0);
    expect(summary.photosSkipped).toBe(3);
    expect(summary.photosFailed).toBe(0);
    expect(uploadToR2Mock).not.toHaveBeenCalled();
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

  it('runPhotos skips species_meta rows that have no observations in AZ (the iNat client filters by place_id=40, so species never observed in AZ are guaranteed no-op iNat round-trips)', async () => {
    // Override the beforeEach seed: clear all observations and re-insert
    // only one for verfly. annhum and norcar are left with species_meta
    // rows but no observations — they represent the ~24k non-AZ species
    // the taxonomy ingest writes to species_meta.
    await db.pool.query('TRUNCATE observations CASCADE');
    await upsertObservations(db.pool, [
      {
        subId: 'S100000001',
        speciesCode: 'verfly',
        comName: 'Vermilion Flycatcher',
        lat: 32.2226,
        lng: -110.9747,
        obsDt: '2026-04-30T12:00:00Z',
        locId: 'L100',
        locName: 'Tucson',
        howMany: 1,
        isNotable: false,
      },
    ]);

    fetchInatPhotoMock.mockImplementation(async (sciName: string) => ({
      url: `https://inat.example.test/${encodeURIComponent(sciName)}/medium.jpg`,
      attribution: `(c) somebody for ${sciName}, CC BY`,
      license: 'cc-by',
    }));
    uploadToR2Mock.mockImplementation(async (_imageUrl: string, destKey: string) => {
      return `https://photos.bird-maps.com/${destKey}`;
    });

    const summary = await runPhotos({ pool: db.pool, paceMs: 0 });

    // Only the species with an observation is iterated.
    expect(summary.speciesCount).toBe(1);
    expect(summary.photosFetched).toBe(1);
    expect(summary.photosSkipped).toBe(0);
    expect(summary.photosFailed).toBe(0);

    // iNat called exactly once, only for the AZ-observed species.
    expect(fetchInatPhotoMock).toHaveBeenCalledTimes(1);
    const sciNamesQueried = fetchInatPhotoMock.mock.calls.map(c => c[0]);
    expect(sciNamesQueried).toEqual(['Pyrocephalus rubinus']);
    expect(sciNamesQueried).not.toContain('Calypte anna');
    expect(sciNamesQueried).not.toContain('Cardinalis cardinalis');

    // R2 called exactly once.
    expect(uploadToR2Mock).toHaveBeenCalledTimes(1);

    // DB: photo row only for the AZ-observed species.
    expect(await getSpeciesPhotos(db.pool, 'verfly')).toHaveLength(1);
    expect(await getSpeciesPhotos(db.pool, 'annhum')).toEqual([]);
    expect(await getSpeciesPhotos(db.pool, 'norcar')).toEqual([]);
  });
});
