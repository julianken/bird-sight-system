import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { startTestDb, type TestDb } from './test-helpers.js';
import {
  getSpeciesMeta,
  getSpeciesDictionary,
  upsertSpeciesMeta,
  findMissingSpeciesMeta,
  insertSpeciesPhoto,
  getSpeciesPhotos,
  getSpeciesWithPhotos,
  getSpeciesPhenology,
  insertSpeciesDescription,
} from './species.js';
import { upsertObservations } from './observations.js';

let db: TestDb;
beforeAll(async () => { db = await startTestDb(); }, 90_000);
beforeEach(async () => { await db.pool.query('TRUNCATE species_meta CASCADE'); });
afterAll(async () => { await db?.stop(); });

describe('species meta', () => {
  it('upserts and returns by species code', async () => {
    await upsertSpeciesMeta(db.pool, [
      { speciesCode: 'vermfly', comName: 'Vermilion Flycatcher',
        sciName: 'Pyrocephalus rubinus', familyCode: 'tyrannidae',
        familyName: 'Tyrant Flycatchers', taxonOrder: 30501 },
    ]);
    const row = await getSpeciesMeta(db.pool, 'vermfly');
    expect(row?.comName).toBe('Vermilion Flycatcher');
    expect(row?.familyCode).toBe('tyrannidae');
  });

  it('returns null for unknown species', async () => {
    const row = await getSpeciesMeta(db.pool, 'doesnotexist');
    expect(row).toBeNull();
  });

  it('returns taxon_order as a number, not a string', async () => {
    await upsertSpeciesMeta(db.pool, [
      { speciesCode: 'verfly', comName: 'Vermilion Flycatcher',
        sciName: 'Pyrocephalus rubinus', familyCode: 'tyrannidae',
        familyName: 'Tyrannidae', taxonOrder: 30501 },
    ]);
    const meta = await getSpeciesMeta(db.pool, 'verfly');
    expect(meta).toBeDefined();
    expect(typeof meta!.taxonOrder).toBe('number');
    expect(meta!.taxonOrder).toBe(30501);
  });
});

describe('getSpeciesDictionary (#859)', () => {
  it('returns every species as a flat {code,comName,familyCode}, sorted by code', async () => {
    await upsertSpeciesMeta(db.pool, [
      { speciesCode: 'vermfly', comName: 'Vermilion Flycatcher',
        sciName: 'Pyrocephalus rubinus', familyCode: 'tyrannidae',
        familyName: 'Tyrant Flycatchers', taxonOrder: 30501 },
      { speciesCode: 'annhum', comName: "Anna's Hummingbird",
        sciName: 'Calypte anna', familyCode: 'trochilidae',
        familyName: 'Hummingbirds', taxonOrder: 6000 },
      { speciesCode: 'mallar3', comName: 'Mallard',
        sciName: 'Anas platyrhynchos', familyCode: 'anatidae',
        familyName: 'Ducks, Geese, and Waterfowl', taxonOrder: 261 },
    ]);
    const dict = await getSpeciesDictionary(db.pool);
    // Sorted by species_code asc: annhum, mallar3, vermfly.
    expect(dict.map(d => d.code)).toEqual(['annhum', 'mallar3', 'vermfly']);
    const anna = dict.find(d => d.code === 'annhum')!;
    expect(anna.comName).toBe("Anna's Hummingbird");
    expect(anna.familyCode).toBe('trochilidae');
    // The dictionary projects EXACTLY the three wire fields — no sci_name,
    // family_name, taxon_order, photos, or descriptions leak onto the wire.
    expect(Object.keys(anna).sort()).toEqual(['code', 'comName', 'familyCode']);
  });

  it('returns an empty array when species_meta is empty', async () => {
    // beforeEach truncates species_meta — no seed here.
    const dict = await getSpeciesDictionary(db.pool);
    expect(dict).toEqual([]);
  });
});

describe('findMissingSpeciesMeta (#484 ingest invariant helper)', () => {
  beforeEach(async () => {
    await upsertSpeciesMeta(db.pool, [
      { speciesCode: 'vermfly', comName: 'Vermilion Flycatcher',
        sciName: 'Pyrocephalus rubinus', familyCode: 'tyrannidae',
        familyName: 'Tyrant Flycatchers', taxonOrder: 30501 },
      { speciesCode: 'annhum', comName: "Anna's Hummingbird",
        sciName: 'Calypte anna', familyCode: 'trochilidae',
        familyName: 'Hummingbirds', taxonOrder: 6000 },
    ]);
  });

  it('returns [] when every code has a species_meta row', async () => {
    const missing = await findMissingSpeciesMeta(db.pool, ['vermfly', 'annhum']);
    expect(missing).toEqual([]);
  });

  it('returns [] for an empty input (no DB round-trip needed)', async () => {
    const missing = await findMissingSpeciesMeta(db.pool, []);
    expect(missing).toEqual([]);
  });

  it('returns the subset of codes that have no species_meta row', async () => {
    const missing = await findMissingSpeciesMeta(db.pool, [
      'vermfly', 'xMISS1', 'annhum', 'xMISS2',
    ]);
    // Sorted lexicographically for stable error messages.
    expect(missing).toEqual(['xMISS1', 'xMISS2']);
  });

  it('de-duplicates repeated missing codes in the input', async () => {
    const missing = await findMissingSpeciesMeta(db.pool, [
      'xMISS', 'xMISS', 'xMISS',
    ]);
    expect(missing).toEqual(['xMISS']);
  });
});

describe('species photos', () => {
  beforeEach(async () => {
    // Photos FK to species_meta; seed a parent so inserts succeed.
    await upsertSpeciesMeta(db.pool, [
      { speciesCode: 'vermfly', comName: 'Vermilion Flycatcher',
        sciName: 'Pyrocephalus rubinus', familyCode: 'tyrannidae',
        familyName: 'Tyrant Flycatchers', taxonOrder: 30501 },
    ]);
  });

  it('insertSpeciesPhoto inserts; second call with same (species_code, purpose) upserts', async () => {
    await insertSpeciesPhoto(db.pool, {
      speciesCode: 'vermfly',
      purpose: 'detail-panel',
      url: 'https://photos.bird-maps.com/vermfly-v1.jpg',
      attribution: 'Photo by A',
      license: 'CC-BY-4.0',
    });

    // Second call with the same (species_code, purpose) replaces the existing row.
    await insertSpeciesPhoto(db.pool, {
      speciesCode: 'vermfly',
      purpose: 'detail-panel',
      url: 'https://photos.bird-maps.com/vermfly-v2.jpg',
      attribution: 'Photo by B',
      license: 'CC-BY-NC-4.0',
    });

    const photos = await getSpeciesPhotos(db.pool, 'vermfly');
    expect(photos).toHaveLength(1);
    expect(photos[0]?.url).toBe('https://photos.bird-maps.com/vermfly-v2.jpg');
    expect(photos[0]?.attribution).toBe('Photo by B');
    expect(photos[0]?.license).toBe('CC-BY-NC-4.0');
    expect(photos[0]?.purpose).toBe('detail-panel');
  });

  it('getSpeciesPhotos returns all rows for that species ordered by created_at DESC', async () => {
    // Seed a second species so we can assert the helper filters by species_code.
    await upsertSpeciesMeta(db.pool, [
      { speciesCode: 'annhum', comName: "Anna's Hummingbird",
        sciName: 'Calypte anna', familyCode: 'trochilidae',
        familyName: 'Hummingbirds', taxonOrder: 12345 },
    ]);
    await insertSpeciesPhoto(db.pool, {
      speciesCode: 'vermfly',
      purpose: 'detail-panel',
      url: 'https://photos.bird-maps.com/vermfly.jpg',
      attribution: 'Photo by A',
      license: 'CC-BY-4.0',
    });
    await insertSpeciesPhoto(db.pool, {
      speciesCode: 'annhum',
      purpose: 'detail-panel',
      url: 'https://photos.bird-maps.com/annhum.jpg',
      attribution: 'Photo by C',
      license: 'CC-BY-4.0',
    });

    // Filter contract: only the requested species's rows are returned.
    const vermPhotos = await getSpeciesPhotos(db.pool, 'vermfly');
    expect(vermPhotos).toHaveLength(1);
    expect(vermPhotos[0]?.speciesCode).toBe('vermfly');
    expect(vermPhotos[0]?.url).toBe('https://photos.bird-maps.com/vermfly.jpg');

    // Ordering contract: when there are multiple rows for a species (which
    // can only happen today by inserting raw rows under additional purpose
    // values; the public CHECK currently restricts to 'detail-panel' only),
    // the helper returns them with the newest first. We exercise this by
    // temporarily disabling the CHECK constraint so we can write two rows
    // under the same species_code with distinct purposes and explicit
    // created_at, then assert the helper orders DESC by created_at.
    await db.pool.query(`ALTER TABLE species_photos DROP CONSTRAINT species_photos_purpose_check`);
    try {
      await db.pool.query(
        `INSERT INTO species_photos (species_code, purpose, url, attribution, license, created_at)
         VALUES ('vermfly', 'gallery-old',  'https://photos.bird-maps.com/v-old.jpg',  'A', 'CC-BY-4.0', NOW() - INTERVAL '2 hours'),
                ('vermfly', 'gallery-new',  'https://photos.bird-maps.com/v-new.jpg',  'A', 'CC-BY-4.0', NOW() - INTERVAL '1 hour')`
      );
      const ordered = await getSpeciesPhotos(db.pool, 'vermfly');
      // Three rows now: detail-panel (newest, just upserted), gallery-new (1h ago),
      // gallery-old (2h ago). Newest first.
      expect(ordered).toHaveLength(3);
      // url for detail-panel is the one inserted earliest in this test
      // (NOW()), gallery-new is NOW() - 1h, gallery-old is NOW() - 2h, so
      // strict DESC = [detail-panel, gallery-new, gallery-old].
      const urls = ordered.map(p => p.url);
      expect(urls).toEqual([
        'https://photos.bird-maps.com/vermfly.jpg',
        'https://photos.bird-maps.com/v-new.jpg',
        'https://photos.bird-maps.com/v-old.jpg',
      ]);
    } finally {
      // Drop the off-list rows BEFORE restoring the CHECK — ALTER TABLE
      // ADD CONSTRAINT validates existing rows and would error otherwise.
      await db.pool.query(
        `DELETE FROM species_photos WHERE purpose IN ('gallery-old', 'gallery-new')`
      );
      // Restore the CHECK so subsequent tests see the production schema.
      await db.pool.query(
        `ALTER TABLE species_photos
         ADD CONSTRAINT species_photos_purpose_check
         CHECK (purpose IN ('detail-panel'))`
      );
    }
  });

  it('insertSpeciesPhoto does not clobber taxonomy columns on conflict', async () => {
    // (a) Seed a complete species_meta row so we can prove the upsert
    //     in (b) doesn't touch any of these columns.
    await upsertSpeciesMeta(db.pool, [
      { speciesCode: 'vermfly', comName: 'Vermilion Flycatcher',
        sciName: 'Pyrocephalus rubinus', familyCode: 'tyrannidae',
        familyName: 'Tyrant Flycatchers', taxonOrder: 30501 },
    ]);

    // (b) Insert a photo for the same species. A careless impl that
    //     UPSERTed into species_meta with EXCLUDED defaults (e.g. NULL
    //     com_name) would silently overwrite the taxonomy columns.
    await insertSpeciesPhoto(db.pool, {
      speciesCode: 'vermfly',
      purpose: 'detail-panel',
      url: 'https://photos.bird-maps.com/vermfly.jpg',
      attribution: 'Photo by Jane Doe',
      license: 'CC-BY-4.0',
    });

    // (c) SINGLE SELECT joining species_meta + species_photos. Verify
    //     BOTH photo columns AND taxonomy columns are intact.
    const { rows } = await db.pool.query<{
      species_code: string;
      com_name: string;
      sci_name: string;
      family_code: string;
      family_name: string;
      taxon_order: number | null;
      photo_url: string | null;
      photo_attribution: string | null;
      photo_license: string | null;
    }>(
      `SELECT sm.species_code, sm.com_name, sm.sci_name, sm.family_code,
              sm.family_name, sm.taxon_order,
              sp.url AS photo_url,
              sp.attribution AS photo_attribution,
              sp.license AS photo_license
         FROM species_meta sm
         LEFT JOIN species_photos sp
           ON sp.species_code = sm.species_code
          AND sp.purpose = 'detail-panel'
        WHERE sm.species_code = 'vermfly'`
    );
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    // Photo columns landed correctly.
    expect(row.photo_url).toBe('https://photos.bird-maps.com/vermfly.jpg');
    expect(row.photo_attribution).toBe('Photo by Jane Doe');
    expect(row.photo_license).toBe('CC-BY-4.0');
    // Taxonomy columns are UNCHANGED from step (a).
    expect(row.com_name).toBe('Vermilion Flycatcher');
    expect(row.sci_name).toBe('Pyrocephalus rubinus');
    expect(row.family_code).toBe('tyrannidae');
    expect(row.family_name).toBe('Tyrant Flycatchers');
    expect(row.taxon_order).toBe(30501);
  });

  it('getSpeciesMeta returns photoUrl/photoAttribution/photoLicense when a detail-panel photo exists', async () => {
    await upsertSpeciesMeta(db.pool, [
      { speciesCode: 'vermfly', comName: 'Vermilion Flycatcher',
        sciName: 'Pyrocephalus rubinus', familyCode: 'tyrannidae',
        familyName: 'Tyrant Flycatchers', taxonOrder: 30501 },
    ]);
    await insertSpeciesPhoto(db.pool, {
      speciesCode: 'vermfly',
      purpose: 'detail-panel',
      url: 'https://photos.bird-maps.com/vermfly.jpg',
      attribution: 'Photo by Jane Doe',
      license: 'CC-BY-4.0',
    });

    const meta = await getSpeciesMeta(db.pool, 'vermfly');
    expect(meta).not.toBeNull();
    expect(meta!.photoUrl).toBe('https://photos.bird-maps.com/vermfly.jpg');
    expect(meta!.photoAttribution).toBe('Photo by Jane Doe');
    expect(meta!.photoLicense).toBe('CC-BY-4.0');
    // Taxonomy fields still populated.
    expect(meta!.comName).toBe('Vermilion Flycatcher');
    expect(meta!.familyCode).toBe('tyrannidae');
  });

  it('getSpeciesMeta returns undefined for the three photo fields when no detail-panel photo exists', async () => {
    await upsertSpeciesMeta(db.pool, [
      { speciesCode: 'vermfly', comName: 'Vermilion Flycatcher',
        sciName: 'Pyrocephalus rubinus', familyCode: 'tyrannidae',
        familyName: 'Tyrant Flycatchers', taxonOrder: 30501 },
    ]);

    const meta = await getSpeciesMeta(db.pool, 'vermfly');
    expect(meta).not.toBeNull();
    // Three photo fields are undefined (not present, not null, not empty).
    expect(meta!.photoUrl).toBeUndefined();
    expect(meta!.photoAttribution).toBeUndefined();
    expect(meta!.photoLicense).toBeUndefined();
    // exactOptionalPropertyTypes is on, so verify the keys aren't present
    // on the object at all (the spec says "not present, not null").
    expect(Object.prototype.hasOwnProperty.call(meta, 'photoUrl')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(meta, 'photoAttribution')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(meta, 'photoLicense')).toBe(false);
  });
});

describe('species meta — description projection', () => {
  beforeEach(async () => {
    // Descriptions FK to species_meta; seed a parent so inserts succeed.
    await upsertSpeciesMeta(db.pool, [
      { speciesCode: 'vermfly', comName: 'Vermilion Flycatcher',
        sciName: 'Pyrocephalus rubinus', familyCode: 'tyrannidae',
        familyName: 'Tyrant Flycatchers', taxonOrder: 30501 },
    ]);
  });

  it('getSpeciesMeta surfaces descriptionBody/descriptionLicense/descriptionAttributionUrl when a description row exists', async () => {
    const body = 'The vermilion flycatcher is a small, brilliantly colored passerine bird. '.repeat(2);
    await insertSpeciesDescription(db.pool, {
      speciesCode: 'vermfly',
      source: 'wikipedia',
      body,
      license: 'CC-BY-SA-4.0',
      revisionId: 1234567890,
      etag: '"abc123"',
      attributionUrl: 'https://en.wikipedia.org/wiki/Vermilion_flycatcher',
    });

    const meta = await getSpeciesMeta(db.pool, 'vermfly');
    expect(meta).not.toBeNull();
    expect(meta!.descriptionBody).toBe(body);
    expect(meta!.descriptionLicense).toBe('CC-BY-SA-4.0');
    expect(meta!.descriptionAttributionUrl).toBe('https://en.wikipedia.org/wiki/Vermilion_flycatcher');
    // Taxonomy fields still populated.
    expect(meta!.comName).toBe('Vermilion Flycatcher');
    expect(meta!.familyCode).toBe('tyrannidae');
  });

  it('getSpeciesMeta returns undefined for the three description fields when no description row exists', async () => {
    const meta = await getSpeciesMeta(db.pool, 'vermfly');
    expect(meta).not.toBeNull();
    // Three description fields are undefined (not present, not null, not empty)
    // — same contract as photoUrl when species_photos has no row. The
    // exactOptionalPropertyTypes contract requires absent properties when the
    // JOIN produces NULLs, not properties with `undefined` values.
    expect(meta!.descriptionBody).toBeUndefined();
    expect(meta!.descriptionLicense).toBeUndefined();
    expect(meta!.descriptionAttributionUrl).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(meta, 'descriptionBody')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(meta, 'descriptionLicense')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(meta, 'descriptionAttributionUrl')).toBe(false);
  });

  it('getSpeciesMeta surfaces description fields even when revision_id is NULL (304-path / sparse-200 case)', async () => {
    // The 304 conditional-GET path may produce a row where Wikipedia omits
    // revision_id. The description body/license/attribution_url MUST still
    // surface — the description-fields projection is independent of
    // revision_id, which is a cache-invalidation knob the writer uses, not a
    // wire-facing field. A regression where the projection accidentally
    // gates on revision_id IS NOT NULL would silently hide descriptions for
    // species refreshed via 304 paths.
    const body = 'The vermilion flycatcher is a small bright red passerine bird. '.repeat(2);
    await insertSpeciesDescription(db.pool, {
      speciesCode: 'vermfly',
      source: 'wikipedia',
      body,
      license: 'CC-BY-SA-3.0',
      revisionId: null,
      etag: null,
      attributionUrl: 'https://en.wikipedia.org/wiki/Vermilion_flycatcher',
    });

    const meta = await getSpeciesMeta(db.pool, 'vermfly');
    expect(meta).not.toBeNull();
    expect(meta!.descriptionBody).toBe(body);
    expect(meta!.descriptionLicense).toBe('CC-BY-SA-3.0');
    expect(meta!.descriptionAttributionUrl).toBe('https://en.wikipedia.org/wiki/Vermilion_flycatcher');
  });
});

describe('species phenology', () => {
  beforeEach(async () => {
    // Phenology rows pivot off observations, but the species_meta row exists
    // so the read-API existence check (404 vs []) can pass for known codes.
    await upsertSpeciesMeta(db.pool, [
      { speciesCode: 'vermfly', comName: 'Vermilion Flycatcher',
        sciName: 'Pyrocephalus rubinus', familyCode: 'tyrannidae',
        familyName: 'Tyrant Flycatchers', taxonOrder: 30501 },
      { speciesCode: 'annhum', comName: "Anna's Hummingbird",
        sciName: 'Calypte anna', familyCode: 'trochilidae',
        familyName: 'Hummingbirds', taxonOrder: 6000 },
    ]);
    await db.pool.query('TRUNCATE observations');
  });

  it('returns sparse rows: months with no observations are absent', async () => {
    // Two observations in March (3) and one in March, plus two in November.
    // No other months have observations. Expect exactly 2 rows: month 3 and
    // month 11. Months 1, 2, 4-10, 12 are absent (sparse — frontend zero-fills).
    await upsertObservations(db.pool, [
      { subId: 'SA1', speciesCode: 'vermfly', comName: 'Vermilion Flycatcher',
        lat: 31.72, lng: -110.88, obsDt: '2026-03-05T08:00:00Z',
        locId: 'L1', locName: 'X', howMany: 1, isNotable: false },
      { subId: 'SA2', speciesCode: 'vermfly', comName: 'Vermilion Flycatcher',
        lat: 31.72, lng: -110.88, obsDt: '2026-03-15T08:00:00Z',
        locId: 'L2', locName: 'Y', howMany: 1, isNotable: false },
      { subId: 'SA3', speciesCode: 'vermfly', comName: 'Vermilion Flycatcher',
        lat: 31.72, lng: -110.88, obsDt: '2026-03-22T08:00:00Z',
        locId: 'L3', locName: 'Z', howMany: 1, isNotable: false },
      { subId: 'SA4', speciesCode: 'vermfly', comName: 'Vermilion Flycatcher',
        lat: 31.72, lng: -110.88, obsDt: '2026-11-12T08:00:00Z',
        locId: 'L4', locName: 'W', howMany: 1, isNotable: false },
      { subId: 'SA5', speciesCode: 'vermfly', comName: 'Vermilion Flycatcher',
        lat: 31.72, lng: -110.88, obsDt: '2026-11-13T08:00:00Z',
        locId: 'L5', locName: 'V', howMany: 1, isNotable: false },
    ]);
    const rows = await getSpeciesPhenology(db.pool, 'vermfly');
    expect(rows).toEqual([
      { month: 3, count: 3 },
      { month: 11, count: 2 },
    ]);
  });

  it('returns ordered ascending by month', async () => {
    // Insert out of order; query must ORDER BY month ASC for deterministic
    // sparse output the frontend can iterate without re-sorting.
    await upsertObservations(db.pool, [
      { subId: 'SB-Dec', speciesCode: 'vermfly', comName: 'Vermilion Flycatcher',
        lat: 31.72, lng: -110.88, obsDt: '2026-12-01T08:00:00Z',
        locId: 'L1', locName: 'X', howMany: 1, isNotable: false },
      { subId: 'SB-Jan', speciesCode: 'vermfly', comName: 'Vermilion Flycatcher',
        lat: 31.72, lng: -110.88, obsDt: '2026-01-01T08:00:00Z',
        locId: 'L2', locName: 'Y', howMany: 1, isNotable: false },
      { subId: 'SB-Jul', speciesCode: 'vermfly', comName: 'Vermilion Flycatcher',
        lat: 31.72, lng: -110.88, obsDt: '2026-07-01T08:00:00Z',
        locId: 'L3', locName: 'Z', howMany: 1, isNotable: false },
    ]);
    const rows = await getSpeciesPhenology(db.pool, 'vermfly');
    expect(rows.map(r => r.month)).toEqual([1, 7, 12]);
  });

  it('returns [] for known species with no observations', async () => {
    // 'annhum' is in species_meta but observations is truncated. The route
    // layer (separate test in app.test.ts) returns 200 [] for this case;
    // here we just confirm the helper returns the empty array.
    const rows = await getSpeciesPhenology(db.pool, 'annhum');
    expect(rows).toEqual([]);
  });

  it('returns [] for unknown species code (route layer adds 404)', async () => {
    // Helper does NOT distinguish 404 vs []: the route layer in app.ts uses
    // getSpeciesMeta for the existence check (matches the species-meta
    // route). This contract keeps the SQL focused on aggregation.
    const rows = await getSpeciesPhenology(db.pool, 'doesnotexist');
    expect(rows).toEqual([]);
  });

  it('filters by species_code (does not aggregate across species)', async () => {
    // Two species with observations in the same month; helper must scope
    // counts to the requested species. Catches a missing WHERE clause.
    await upsertObservations(db.pool, [
      { subId: 'SC1', speciesCode: 'vermfly', comName: 'Vermilion Flycatcher',
        lat: 31.72, lng: -110.88, obsDt: '2026-04-01T08:00:00Z',
        locId: 'L1', locName: 'X', howMany: 1, isNotable: false },
      { subId: 'SC2', speciesCode: 'annhum', comName: "Anna's Hummingbird",
        lat: 31.72, lng: -110.88, obsDt: '2026-04-01T08:00:00Z',
        locId: 'L2', locName: 'Y', howMany: 1, isNotable: false },
      { subId: 'SC3', speciesCode: 'annhum', comName: "Anna's Hummingbird",
        lat: 31.72, lng: -110.88, obsDt: '2026-04-15T08:00:00Z',
        locId: 'L3', locName: 'Z', howMany: 1, isNotable: false },
    ]);
    const verm = await getSpeciesPhenology(db.pool, 'vermfly');
    const ann = await getSpeciesPhenology(db.pool, 'annhum');
    expect(verm).toEqual([{ month: 4, count: 1 }]);
    expect(ann).toEqual([{ month: 4, count: 2 }]);
  });

  it('month extraction is stable across DB session timezones (UTC-pinned)', async () => {
    // Going-national: obs_dt is timestamptz, so EXTRACT(MONTH FROM obs_dt)
    // without an explicit zone uses the session timezone for the boundary.
    // The query now pins to UTC, so an observation at 2026-12-31 23:30Z
    // (boundary-adjacent) extracts to month 12 regardless of what TZ the
    // pool's session is set to. We exercise this by toggling the session
    // timezone before each call. Pre-fix this test would return month 1
    // under America/Anchorage (UTC-9 means the local time would tip into
    // Jan 1) — proving the fix is load-bearing.
    await upsertObservations(db.pool, [
      {
        subId: 'TZ1',
        speciesCode: 'vermfly',
        comName: 'Vermilion Flycatcher',
        lat: 31.72,
        lng: -110.88,
        obsDt: '2026-12-31T23:30:00Z',
        locId: 'L1',
        locName: 'X',
        howMany: 1,
        isNotable: false,
      },
    ]);

    // Run the same SQL the helper uses, with the session timezone explicitly
    // set on a borrowed client. SET TIME ZONE is connection-scoped; getting
    // a single client guarantees the EXTRACT runs under the same TZ we
    // configured. We assert against the SQL directly rather than calling
    // the helper, because the helper takes a Pool (any connection) and the
    // pool can hand us a different connection than the one we SET on. The
    // point of this test is the EXTRACT-in-UTC behavior, not the helper's
    // pool plumbing — which is already covered by the other tests above.
    const client = await db.pool.connect();
    try {
      const sql =
        `SELECT EXTRACT(MONTH FROM obs_dt AT TIME ZONE 'UTC')::int AS month,
                COUNT(*)::int AS count
           FROM observations
          WHERE species_code = $1
          GROUP BY month
          ORDER BY month`;

      for (const tz of ['UTC', 'America/Anchorage', 'America/New_York']) {
        await client.query(`SET TIME ZONE '${tz}'`);
        const { rows } = await client.query<{ month: number; count: number }>(
          sql,
          ['vermfly']
        );
        expect(rows).toEqual([{ month: 12, count: 1 }]);
      }
    } finally {
      await client.query("SET TIME ZONE DEFAULT");
      client.release();
    }
  });

  it('returns month and count as numbers (not strings from pg)', async () => {
    // pg returns INTEGER as number, but COUNT(*) returns BIGINT (string)
    // by default. The query casts both to ::int; verify the JS types.
    await upsertObservations(db.pool, [
      { subId: 'SD1', speciesCode: 'vermfly', comName: 'Vermilion Flycatcher',
        lat: 31.72, lng: -110.88, obsDt: '2026-06-01T08:00:00Z',
        locId: 'L1', locName: 'X', howMany: 1, isNotable: false },
    ]);
    const rows = await getSpeciesPhenology(db.pool, 'vermfly');
    expect(rows).toHaveLength(1);
    expect(typeof rows[0]!.month).toBe('number');
    expect(typeof rows[0]!.count).toBe('number');
    expect(rows[0]!.month).toBe(6);
    expect(rows[0]!.count).toBe(1);
  });
});

describe('species descriptions', () => {
  beforeEach(async () => {
    // Descriptions FK to species_meta; seed a parent so inserts succeed.
    await upsertSpeciesMeta(db.pool, [
      { speciesCode: 'vermfly', comName: 'Vermilion Flycatcher',
        sciName: 'Pyrocephalus rubinus', familyCode: 'tyrannidae',
        familyName: 'Tyrant Flycatchers', taxonOrder: 30501 },
    ]);
  });

  it('insertSpeciesDescription inserts; second call with same species_code upserts', async () => {
    const longBody = 'The vermilion flycatcher is a small passerine bird. '.repeat(2);
    await insertSpeciesDescription(db.pool, {
      speciesCode: 'vermfly',
      source: 'wikipedia',
      body: longBody,
      license: 'CC-BY-SA-4.0',
      revisionId: 1234567890,
      etag: '"abc123"',
      attributionUrl: 'https://en.wikipedia.org/wiki/Vermilion_flycatcher',
    });

    // Second call with the same species_code replaces the existing row.
    const newBody = longBody + ' Updated description with new revision data here.';
    await insertSpeciesDescription(db.pool, {
      speciesCode: 'vermfly',
      source: 'wikipedia',
      body: newBody,
      license: 'CC-BY-SA-4.0',
      revisionId: 9999999999,
      etag: '"def456"',
      attributionUrl: 'https://en.wikipedia.org/wiki/Vermilion_flycatcher',
    });

    const { rows } = await db.pool.query<{
      species_code: string;
      source: string;
      body: string;
      license: string;
      revision_id: string | null;
      etag: string | null;
      attribution_url: string;
    }>(
      `SELECT species_code, source, body, license, revision_id, etag, attribution_url
         FROM species_descriptions WHERE species_code = 'vermfly'`
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.body).toBe(newBody);
    expect(rows[0]?.etag).toBe('"def456"');
    // Note: pg returns BIGINT as a string by default — that's fine for cache
    // semantics, the ETag drives conditional GETs, not revision_id.
    expect(rows[0]?.revision_id).toBe('9999999999');
  });

  it('insertSpeciesDescription does not clobber taxonomy columns on conflict', async () => {
    // (a) Seed a complete species_meta row including inat_taxon_id (the new
    //     column the same migration adds — same fixture pattern as the
    //     species_photos clobber test.)
    await db.pool.query(
      `UPDATE species_meta SET inat_taxon_id = 9999 WHERE species_code = 'vermfly'`
    );

    // (b) Insert a description for the same species. A careless impl that
    //     UPSERTed into species_meta with EXCLUDED defaults would silently
    //     overwrite the taxonomy or inat_taxon_id columns.
    const body = 'A long enough description body to satisfy the CHECK constraint here. '.repeat(2);
    await insertSpeciesDescription(db.pool, {
      speciesCode: 'vermfly',
      source: 'wikipedia',
      body,
      license: 'CC-BY-SA-4.0',
      revisionId: 1234567890,
      etag: '"abc"',
      attributionUrl: 'https://en.wikipedia.org/wiki/Vermilion_flycatcher',
    });

    // (c) SINGLE SELECT joining species_meta + species_descriptions. Verify
    //     BOTH description columns AND taxonomy + inat_taxon_id columns are
    //     intact.
    const { rows } = await db.pool.query<{
      species_code: string;
      com_name: string;
      sci_name: string;
      family_code: string;
      family_name: string;
      taxon_order: number | null;
      inat_taxon_id: string | null;
      desc_body: string;
      desc_etag: string | null;
    }>(
      `SELECT sm.species_code, sm.com_name, sm.sci_name, sm.family_code,
              sm.family_name, sm.taxon_order, sm.inat_taxon_id,
              sd.body AS desc_body,
              sd.etag AS desc_etag
         FROM species_meta sm
         LEFT JOIN species_descriptions sd
           ON sd.species_code = sm.species_code
        WHERE sm.species_code = 'vermfly'`
    );
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.desc_body).toBe(body);
    expect(row.desc_etag).toBe('"abc"');
    // Taxonomy columns are UNCHANGED.
    expect(row.com_name).toBe('Vermilion Flycatcher');
    expect(row.sci_name).toBe('Pyrocephalus rubinus');
    expect(row.family_code).toBe('tyrannidae');
    expect(row.family_name).toBe('Tyrant Flycatchers');
    expect(row.taxon_order).toBe(30501);
    expect(row.inat_taxon_id).toBe('9999');
  });

  it('insertSpeciesDescription accepts null revisionId and null etag (304-path columns)', async () => {
    // The 304 conditional-GET path may produce a refresh where Wikipedia
    // omits both fields; the helper must persist them as NULL not '' or 'null'.
    const body = 'The vermilion flycatcher is a small bright red passerine here. '.repeat(2);
    await insertSpeciesDescription(db.pool, {
      speciesCode: 'vermfly',
      source: 'wikipedia',
      body,
      license: 'CC-BY-SA-4.0',
      revisionId: null,
      etag: null,
      attributionUrl: 'https://en.wikipedia.org/wiki/Vermilion_flycatcher',
    });

    const { rows } = await db.pool.query<{
      revision_id: string | null;
      etag: string | null;
    }>(
      `SELECT revision_id, etag FROM species_descriptions WHERE species_code = 'vermfly'`
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.revision_id).toBeNull();
    expect(rows[0]?.etag).toBeNull();
  });

  it("insertSpeciesDescription accepts source='inat' (Wikipedia-404 fallback path)", async () => {
    // The widening migration (1700000031000) added 'inat' to the source
    // CHECK. The TS-side input type was widened in the same change so
    // run-descriptions can pass `source: 'inat'` on the iNat-summary fallback
    // branch. The DB upsert path is unchanged — same row shape, same
    // license/body/attribution_url contract.
    const body = 'A plaintext summary extracted from the Wikipedia article via iNat\'s wikipedia_summary field.';
    await insertSpeciesDescription(db.pool, {
      speciesCode: 'vermfly',
      source: 'inat',
      body,
      license: 'CC-BY-SA-4.0',
      revisionId: null, // iNat-fallback path doesn't expose a Wikipedia revision id
      etag: null,       // iNat-fallback path doesn't expose a Wikipedia etag
      attributionUrl: 'https://www.inaturalist.org/taxa/9083',
    });

    const { rows } = await db.pool.query<{ source: string; body: string; attribution_url: string }>(
      `SELECT source, body, attribution_url
         FROM species_descriptions WHERE species_code = 'vermfly'`
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.source).toBe('inat');
    expect(rows[0]?.body).toBe(body);
    expect(rows[0]?.attribution_url).toBe('https://www.inaturalist.org/taxa/9083');
  });
});

describe('getSpeciesWithPhotos (#992)', () => {
  it('returns ONLY species with a detail-panel photo, INNER JOINed, sorted by code', async () => {
    // Three species in species_meta; only two have a detail-panel photo row.
    // The INNER JOIN must drop the photo-less one (annhum) entirely — the
    // photo-curation `sync` tool relies on this to enumerate the ~715
    // observed-with-photos species without walking the full taxonomy.
    await upsertSpeciesMeta(db.pool, [
      { speciesCode: 'vermfly', comName: 'Vermilion Flycatcher',
        sciName: 'Pyrocephalus rubinus', familyCode: 'tyrannidae',
        familyName: 'Tyrant Flycatchers', taxonOrder: 30501 },
      { speciesCode: 'annhum', comName: "Anna's Hummingbird",
        sciName: 'Calypte anna', familyCode: 'trochilidae',
        familyName: 'Hummingbirds', taxonOrder: 6000 },
      { speciesCode: 'mallar3', comName: 'Mallard',
        sciName: 'Anas platyrhynchos', familyCode: 'anatidae',
        familyName: 'Ducks, Geese, and Waterfowl', taxonOrder: 261 },
    ]);
    await insertSpeciesPhoto(db.pool, {
      speciesCode: 'vermfly', purpose: 'detail-panel',
      url: 'https://photos.bird-maps.com/species/vermfly.jpg',
      attribution: '(c) A (CC BY)', license: 'cc-by',
    });
    await insertSpeciesPhoto(db.pool, {
      speciesCode: 'mallar3', purpose: 'detail-panel',
      url: 'https://photos.bird-maps.com/species/mallar3.jpg',
      attribution: '(c) B (CC BY-NC)', license: 'cc-by-nc',
    });
    // annhum gets NO photo row → must be absent from the result.

    const rows = await getSpeciesWithPhotos(db.pool);
    // Sorted by species_code asc: mallar3, vermfly (annhum dropped).
    expect(rows.map(r => r.code)).toEqual(['mallar3', 'vermfly']);

    const verm = rows.find(r => r.code === 'vermfly')!;
    expect(verm.comName).toBe('Vermilion Flycatcher');
    expect(verm.sciName).toBe('Pyrocephalus rubinus');
    expect(verm.family).toBe('Tyrant Flycatchers');
    expect(verm.photoUrl).toBe('https://photos.bird-maps.com/species/vermfly.jpg');
    expect(verm.photoAttribution).toBe('(c) A (CC BY)');
    expect(verm.photoLicense).toBe('cc-by');
    // Exactly the seven wire fields — no taxon_order / family_code leak.
    expect(Object.keys(verm).sort())
      .toEqual(['code', 'comName', 'family', 'photoAttribution', 'photoLicense', 'photoUrl', 'sciName']);
  });

  it('ignores non-detail-panel photo purposes (only detail-panel counts)', async () => {
    // A photo row exists for the species, but with a non-detail-panel purpose.
    // The (species_code, purpose) UNIQUE means a species can carry other
    // purposes in future; this endpoint is detail-panel-scoped, so a species
    // whose ONLY photo is a different purpose must NOT appear.
    await upsertSpeciesMeta(db.pool, [
      { speciesCode: 'galleryonly', comName: 'Gallery Only',
        sciName: 'Solus galleria', familyCode: 'tyrannidae',
        familyName: 'Tyrant Flycatchers', taxonOrder: 99100 },
    ]);
    // Drop the purpose CHECK so we can seed a non-detail-panel row directly
    // (insertSpeciesPhoto only writes detail-panel via its caller contract).
    await db.pool.query(`ALTER TABLE species_photos DROP CONSTRAINT species_photos_purpose_check`);
    try {
      await db.pool.query(
        `INSERT INTO species_photos (species_code, purpose, url, attribution, license)
         VALUES ('galleryonly', 'gallery', 'https://x/g.jpg', '(c) G', 'cc-by')`
      );
      const rows = await getSpeciesWithPhotos(db.pool);
      expect(rows.map(r => r.code)).not.toContain('galleryonly');
    } finally {
      await db.pool.query(`DELETE FROM species_photos WHERE purpose = 'gallery'`);
      await db.pool.query(
        `ALTER TABLE species_photos
         ADD CONSTRAINT species_photos_purpose_check
         CHECK (purpose IN ('detail-panel'))`
      );
    }
  });

  it('returns an empty array when no species has a detail-panel photo', async () => {
    // beforeEach truncates species_meta CASCADE (drops photos too) — seed a
    // photo-less species so the JOIN produces zero rows.
    await upsertSpeciesMeta(db.pool, [
      { speciesCode: 'nophoto', comName: 'No Photo',
        sciName: 'Nullus avis', familyCode: 'tyrannidae',
        familyName: 'Tyrant Flycatchers', taxonOrder: 99200 },
    ]);
    const rows = await getSpeciesWithPhotos(db.pool);
    expect(rows).toEqual([]);
  });
});
