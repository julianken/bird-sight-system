import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { startTestDb, type TestDb } from './test-helpers.js';
import {
  getSpeciesMeta,
  upsertSpeciesMeta,
  insertSpeciesPhoto,
  getSpeciesPhotos,
} from './species.js';

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
