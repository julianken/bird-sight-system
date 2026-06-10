import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll, vi } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import type Database from 'better-sqlite3';
import { openDb } from './db.js';
import { getScoreByHash, selectUnreviewed } from './store.js';
import { sync, syncAll, scoreBatch } from './sources.js';
import { FakeJudge } from './judge.js';
import { makeFakeClock } from './test-clock.js';
import type { RubricConfig } from '@bird-watch/photo-quality';

// Instant clock: scoreBatch paces edge downloads ≥1.1 s in prod, but the unit
// tests must never incur a real wait — the fake clock advances virtual time
// only (no setTimeout). Pacing spacing is asserted separately in pacing tests.
const instant = () => makeFakeClock();

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const config = { version: '1.0.0' } as unknown as RubricConfig;
let db: Database.Database;
beforeEach(() => { db = openDb(':memory:'); });
afterEach(() => { db.close(); vi.restoreAllMocks(); });

const API = 'https://api.bird-maps.com';

describe('sync (cheap, NO tokens)', () => {
  it('snapshots a live species into photo_current with reviewed=0 and does NOT score', async () => {
    server.use(
      http.get(`${API}/api/species/amerob`, () =>
        HttpResponse.json({
          speciesCode: 'amerob', comName: 'American Robin', sciName: 'Turdus migratorius',
          familyCode: 'turdid', familyName: 'Turdidae',
          photoUrl: 'https://photos.bird-maps.com/species/amerob.aaaaaaaa.jpg',
          photoAttribution: '(c) X (CC BY)', photoLicense: 'cc-by',
        }),
      ),
    );
    const summary = await sync(db, ['amerob'], { apiBase: API });
    expect(summary.upserted).toBe(1);
    const cur = db.prepare(`SELECT * FROM photo_current WHERE species_code=?`).get('amerob') as any;
    expect(cur.com_name).toBe('American Robin');
    expect(cur.license).toBe('cc-by');
    expect(cur.reviewed).toBe(0);
    // sync writes NO score row — scoring is a separate, token-spending pass
    expect(getScoreByHash(db, 'amerob', 'current', 'aaaaaaaa')).toBeNull();
    // it is now visible to the batched scorer
    expect(selectUnreviewed(db, 10).map((r: any) => r.species_code)).toEqual(['amerob']);
  });

  it('skips a species with no photoUrl and records it', async () => {
    server.use(
      http.get(`${API}/api/species/nopho`, () =>
        HttpResponse.json({ speciesCode: 'nopho', comName: 'No Photo', sciName: 'Nullus avis', familyCode: 'x', familyName: 'X' }),
      ),
    );
    const summary = await sync(db, ['nopho'], { apiBase: API });
    expect(summary.skipped).toBe(1);
    expect(selectUnreviewed(db, 10)).toEqual([]);
  });
});

describe('syncAll (#992 — one call to /api/species/with-photos, no per-species walk)', () => {
  it('upserts every with-photos row into photo_current (reviewed=0) from ONE endpoint call', async () => {
    let detailHits = 0;
    server.use(
      // The new bulk endpoint: returns the observed-with-photos set in one body.
      http.get(`${API}/api/species/with-photos`, () =>
        HttpResponse.json([
          { code: 'amerob', comName: 'American Robin', sciName: 'Turdus migratorius',
            family: 'Turdidae', photoUrl: 'https://photos.bird-maps.com/species/amerob.jpg',
            photoAttribution: '(c) X (CC BY)', photoLicense: 'cc-by' },
          { code: 'annhum', comName: "Anna's Hummingbird", sciName: 'Calypte anna',
            family: 'Hummingbirds', photoUrl: 'https://photos.bird-maps.com/species/annhum.jpg',
            photoAttribution: '(c) Y (CC BY-NC)', photoLicense: 'cc-by-nc' },
        ]),
      ),
      // If the rewire regressed to a per-species walk, this would fire — the
      // test fails loudly because onUnhandledRequest is 'error', but we also
      // count to assert ZERO detail calls explicitly.
      http.get(`${API}/api/species/:code`, ({ params }) => {
        detailHits++;
        return HttpResponse.json({ speciesCode: params.code });
      }),
    );

    const summary = await syncAll(db, { apiBase: API });
    expect(summary.upserted).toBe(2);
    expect(summary.total).toBe(2);
    expect(detailHits).toBe(0); // NO per-species detail call

    const rob = db.prepare(`SELECT * FROM photo_current WHERE species_code=?`).get('amerob') as any;
    expect(rob.com_name).toBe('American Robin');
    expect(rob.sci_name).toBe('Turdus migratorius');
    expect(rob.family).toBe('Turdidae');
    expect(rob.attribution).toBe('(c) X (CC BY)');
    expect(rob.license).toBe('cc-by');
    expect(rob.reviewed).toBe(0);
    // Both are visible to the batched scorer, oldest-first by code.
    expect(selectUnreviewed(db, 10).map((r: any) => r.species_code)).toEqual(['amerob', 'annhum']);
  });

  it('throws when the bulk endpoint is unavailable', async () => {
    server.use(
      http.get(`${API}/api/species/with-photos`, () => new HttpResponse(null, { status: 503 })),
    );
    await expect(syncAll(db, { apiBase: API })).rejects.toThrow(/503/);
  });
});

describe('scoreBatch (token-spending, resumable)', () => {
  it('scores the next N reviewed=0 rows, marks them reviewed, and is resumable', async () => {
    server.use(
      http.get(`${API}/api/species/:code`, ({ params }) =>
        HttpResponse.json({
          speciesCode: params.code, comName: String(params.code), sciName: 'Sp ' + params.code,
          familyCode: 'f', familyName: 'F',
          photoUrl: `https://photos.bird-maps.com/species/${params.code}.${params.code}.jpg`,
          photoAttribution: '(c) X (CC BY)', photoLicense: 'cc-by',
        }),
      ),
    );
    await sync(db, ['aaa', 'bbb', 'ccc'], { apiBase: API });

    const download = vi.fn(async (url: string) => Buffer.from(url));
    const judge = new FakeJudge({});
    // batch of 2 → first two scored + marked, one left
    const first = await scoreBatch(db, 2, { judge, download, config, clock: instant() });
    expect(first.scored).toBe(2);
    expect(selectUnreviewed(db, 10)).toHaveLength(1);
    // resume → the remaining one
    const second = await scoreBatch(db, 2, { judge, download, config, clock: instant() });
    expect(second.scored).toBe(1);
    expect(selectUnreviewed(db, 10)).toEqual([]);
  });

  it('preserves the attribution + license that sync stored (a scoring pass must not clobber CC-BY metadata)', async () => {
    server.use(
      http.get(`${API}/api/species/amerob`, () =>
        HttpResponse.json({
          speciesCode: 'amerob', comName: 'American Robin', sciName: 'Turdus migratorius',
          familyCode: 'turdid', familyName: 'Turdidae',
          photoUrl: 'https://photos.bird-maps.com/species/amerob.aaaaaaaa.jpg',
          photoAttribution: '(c) Jane Doe (CC BY 4.0)', photoLicense: 'cc-by-4.0',
        }),
      ),
    );
    await sync(db, ['amerob'], { apiBase: API });
    const before = db.prepare(`SELECT attribution, license FROM photo_current WHERE species_code=?`).get('amerob') as any;
    expect(before.attribution).toBe('(c) Jane Doe (CC BY 4.0)');
    expect(before.license).toBe('cc-by-4.0');

    const download = vi.fn(async (url: string) => Buffer.from(url));
    const judge = new FakeJudge({});
    const summary = await scoreBatch(db, 10, { judge, download, config, clock: instant() });
    expect(summary.scored).toBe(1);

    // scoreBatch re-stamps content_hash but MUST leave attribution/license intact
    const after = db.prepare(`SELECT attribution, license, content_hash FROM photo_current WHERE species_code=?`).get('amerob') as any;
    expect(after.attribution).toBe('(c) Jane Doe (CC BY 4.0)');
    expect(after.license).toBe('cc-by-4.0');
    expect(after.content_hash).not.toBe(''); // the real hash was recorded
  });

  it('clamps --limit into [1,100]', async () => {
    expect(() => scoreBatch.clampLimit?.(0)).not.toThrow();
    expect(scoreBatch.clampLimit?.(0)).toBe(1);
    expect(scoreBatch.clampLimit?.(9999)).toBe(100);
    expect(scoreBatch.clampLimit?.(10)).toBe(10);
  });
});
