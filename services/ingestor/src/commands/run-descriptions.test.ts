import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { startTestDb, type TestDb } from '@bird-watch/db-client/dist/test-helpers.js';
import {
  upsertSpeciesMeta,
  upsertObservations,
} from '@bird-watch/db-client';
import { runDescriptions } from './run-descriptions.js';

// MSW v2 (`http.get` + `HttpResponse`) — pinned by the project drift table.
//
// Bypass unhandled requests rather than errror on them: testcontainers probes
// Docker via http://localhost/info during startTestDb(); MSW would otherwise
// intercept that and fail the whole suite at beforeAll. The handlers below
// are exhaustive for the iNat + Wikipedia round-trips this orchestrator makes,
// so 'bypass' is safe — anything truly unhandled (a typo'd MSW handler URL,
// say) would surface as a real network error from fetch, not a silent pass.
const server = setupServer();

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
  // Start the DB BEFORE listen() — testcontainers probes Docker via fetch and
  // MSW would otherwise intercept that probe.
  db = await startTestDb();
  server.listen({ onUnhandledRequest: 'bypass' });
}, 90_000);

beforeEach(async () => {
  await db.pool.query('TRUNCATE species_descriptions RESTART IDENTITY CASCADE');
  await db.pool.query('TRUNCATE observations CASCADE');
  await db.pool.query('TRUNCATE species_meta CASCADE');
  await upsertSpeciesMeta(db.pool, SPECIES_FIXTURE);
  await upsertObservations(db.pool, [
    {
      subId: 'S100000001',
      speciesCode: 'verfly',
      comName: 'Vermilion Flycatcher',
      lat: 32.2226, lng: -110.9747,
      obsDt: '2026-04-30T12:00:00Z',
      locId: 'L100', locName: 'Tucson',
      howMany: 1, isNotable: false,
    },
    {
      subId: 'S100000002',
      speciesCode: 'annhum',
      comName: "Anna's Hummingbird",
      lat: 33.4484, lng: -112.0740,
      obsDt: '2026-04-30T12:00:00Z',
      locId: 'L101', locName: 'Phoenix',
      howMany: 1, isNotable: false,
    },
    {
      subId: 'S100000003',
      speciesCode: 'norcar',
      comName: 'Northern Cardinal',
      lat: 32.7, lng: -111.0,
      obsDt: '2026-04-30T12:00:00Z',
      locId: 'L102', locName: 'Casa Grande',
      howMany: 1, isNotable: false,
    },
  ]);
});

afterAll(async () => {
  await db?.stop();
});

const INAT_TAXA = 'https://api.inaturalist.org/v1/taxa';
// Per-id endpoint used by the iNat-summary fallback path. The MSW route uses
// a path parameter so any taxon id maps to a single handler.
const INAT_TAXA_BY_ID = 'https://api.inaturalist.org/v1/taxa/:id';
const WIKI_SUMMARY = 'https://en.wikipedia.org/api/rest_v1/page/summary/:title';

const SAMPLE_BODY = '<p>The vermilion flycatcher is a small passerine bird, native to the Americas. It is brilliantly red in colour.</p>';
const SAMPLE_BODY_2 = '<p>The Northern Cardinal is a North American bird known for its brilliant red plumage and crested head.</p>';

describe('runDescriptions', () => {
  it('writes one description row per AZ-observed species; persists ETag, license, attribution_url', async () => {
    server.use(
      http.get(INAT_TAXA, ({ request }) => {
        const url = new URL(request.url);
        const sciName = url.searchParams.get('q');
        const map: Record<string, { id: number; wiki: string }> = {
          'Pyrocephalus rubinus': { id: 1001, wiki: 'https://en.wikipedia.org/wiki/Vermilion_flycatcher' },
          'Calypte anna': { id: 1002, wiki: 'https://en.wikipedia.org/wiki/Anna%27s_hummingbird' },
          'Cardinalis cardinalis': { id: 1003, wiki: 'https://en.wikipedia.org/wiki/Northern_cardinal' },
        };
        const hit = map[sciName ?? ''];
        if (!hit) return HttpResponse.json({ total_results: 0, page: 1, per_page: 1, results: [] });
        return HttpResponse.json({
          total_results: 1, page: 1, per_page: 1,
          results: [{
            id: hit.id, name: sciName, rank: 'species',
            matched_term: sciName, wikipedia_url: hit.wiki,
          }],
        });
      }),
      http.get(WIKI_SUMMARY, () => {
        return HttpResponse.json(
          { extract_html: SAMPLE_BODY, revision: '1234567890' },
          { status: 200, headers: { etag: '"wiki-etag"' } }
        );
      })
    );

    const summary = await runDescriptions({ pool: db.pool, paceMs: 0 });

    expect(summary.status).toBe('success');
    expect(summary.speciesCount).toBe(3);
    expect(summary.descriptionsWritten).toBe(3);
    expect(summary.descriptionsSkipped).toBe(0);
    expect(summary.descriptionsFailed).toBe(0);
    // descriptionsFromInat is the iNat-fallback counter; on the cold-cache
    // happy path with all 200s, it must be zero. descriptionsWritten is the
    // total — Wikipedia + iNat sources combined.
    expect(summary.descriptionsFromInat).toBe(0);
    expect(summary.errors).toEqual([]);

    // DB state: each species has a row with the sanitized body, etag, license,
    // and the Wikipedia attribution_url. inat_taxon_id is now populated on
    // species_meta.
    const { rows } = await db.pool.query<{
      species_code: string;
      body: string;
      license: string;
      etag: string | null;
      attribution_url: string;
      revision_id: string | null;
    }>(
      `SELECT species_code, body, license, etag, attribution_url, revision_id
         FROM species_descriptions ORDER BY species_code`
    );
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.body).toContain('vermilion') // sample body content; one species shares it
        // The actual body is whatever the Wikipedia stub returned.
        ;
      expect(row.license).toBe('CC-BY-SA-4.0');
      expect(row.etag).toBe('"wiki-etag"');
      expect(row.attribution_url).toMatch(/^https:\/\/en\.wikipedia\.org\/wiki\//);
      expect(row.revision_id).toBe('1234567890');
    }

    // species_meta.inat_taxon_id was written back during the iNat lookup.
    const meta = await db.pool.query<{ species_code: string; inat_taxon_id: string | null }>(
      `SELECT species_code, inat_taxon_id FROM species_meta ORDER BY species_code`
    );
    const ids = Object.fromEntries(meta.rows.map(r => [r.species_code, r.inat_taxon_id]));
    expect(ids).toEqual({ verfly: '1001', annhum: '1002', norcar: '1003' });
  });

  it('second run with matching ETag is a no-op (notModified branch)', async () => {
    // Pre-seed: a description row already exists with etag "old-etag".
    await db.pool.query(
      `INSERT INTO species_descriptions
         (species_code, source, body, license, revision_id, etag, attribution_url)
       VALUES
         ('verfly', 'wikipedia', '${'p'.repeat(60)}', 'CC-BY-SA-4.0', 1234567890, '"old-etag"', 'https://en.wikipedia.org/wiki/Vermilion_flycatcher'),
         ('annhum', 'wikipedia', '${'q'.repeat(60)}', 'CC-BY-SA-4.0', 7777777777, '"old-etag"', 'https://en.wikipedia.org/wiki/Anna%27s_hummingbird'),
         ('norcar', 'wikipedia', '${'r'.repeat(60)}', 'CC-BY-SA-4.0', 8888888888, '"old-etag"', 'https://en.wikipedia.org/wiki/Northern_cardinal')`
    );
    // Pre-seed inat_taxon_id so the iNat lookup is short-circuited.
    await db.pool.query(
      `UPDATE species_meta SET inat_taxon_id = 1001 WHERE species_code = 'verfly';
       UPDATE species_meta SET inat_taxon_id = 1002 WHERE species_code = 'annhum';
       UPDATE species_meta SET inat_taxon_id = 1003 WHERE species_code = 'norcar';`
    );

    let inatHits = 0;
    server.use(
      http.get(INAT_TAXA, () => {
        inatHits++;
        return HttpResponse.json({ total_results: 0, results: [] });
      }),
      http.get(WIKI_SUMMARY, ({ request }) => {
        // Wikipedia receives If-None-Match → returns 304.
        expect(request.headers.get('If-None-Match')).toBe('"old-etag"');
        return new HttpResponse(null, {
          status: 304, headers: { etag: '"old-etag"' }
        });
      })
    );

    const summary = await runDescriptions({ pool: db.pool, paceMs: 0 });

    expect(summary.status).toBe('success');
    expect(summary.descriptionsWritten).toBe(0);
    expect(summary.descriptionsSkipped).toBe(3);
    expect(summary.descriptionsFailed).toBe(0);

    // iNat is short-circuited because inat_taxon_id is already populated.
    expect(inatHits).toBe(0);

    // The bodies are unchanged — no upsert ran.
    const { rows } = await db.pool.query<{ body: string }>(
      `SELECT body FROM species_descriptions ORDER BY species_code`
    );
    expect(rows[0]?.body).toBe('q'.repeat(60)); // annhum
    expect(rows[1]?.body).toBe('r'.repeat(60)); // norcar
    expect(rows[2]?.body).toBe('p'.repeat(60)); // verfly
  });

  it('200 with new body sanitizes and upserts; subsequent etag mismatch reissues fetch + write', async () => {
    // Seed an existing row with old-etag; Wikipedia returns 200 with new etag
    // and new body — the orchestrator must overwrite.
    await db.pool.query(
      `INSERT INTO species_descriptions
         (species_code, source, body, license, etag, attribution_url)
       VALUES ('verfly', 'wikipedia', '${'old'.repeat(20)}', 'CC-BY-SA-4.0', '"old-etag"', 'https://en.wikipedia.org/wiki/Vermilion_flycatcher')`
    );
    await db.pool.query(
      `UPDATE species_meta SET inat_taxon_id = 1001 WHERE species_code = 'verfly'`
    );
    // Drop annhum and norcar from species_meta to focus the run on verfly.
    await db.pool.query(`DELETE FROM observations WHERE species_code != 'verfly'`);

    server.use(
      http.get(WIKI_SUMMARY, ({ request }) => {
        expect(request.headers.get('If-None-Match')).toBe('"old-etag"');
        return HttpResponse.json(
          { extract_html: SAMPLE_BODY, revision: '7777777777' },
          { status: 200, headers: { etag: '"new-etag"' } }
        );
      })
    );

    const summary = await runDescriptions({ pool: db.pool, paceMs: 0 });

    expect(summary.descriptionsWritten).toBe(1);
    expect(summary.descriptionsSkipped).toBe(0);

    const { rows } = await db.pool.query<{
      etag: string; revision_id: string;
    }>(
      `SELECT etag, revision_id FROM species_descriptions WHERE species_code = 'verfly'`
    );
    expect(rows[0]?.etag).toBe('"new-etag"');
    expect(rows[0]?.revision_id).toBe('7777777777');
  });

  it('skips species_meta rows with no observations (mirrors run-photos EXISTS filter)', async () => {
    // Override the beforeEach observation seed: only verfly has an observation.
    await db.pool.query('TRUNCATE observations CASCADE');
    await upsertObservations(db.pool, [
      {
        subId: 'S2', speciesCode: 'verfly', comName: 'Vermilion Flycatcher',
        lat: 32.2226, lng: -110.9747, obsDt: '2026-04-30T12:00:00Z',
        locId: 'L100', locName: 'Tucson', howMany: 1, isNotable: false,
      },
    ]);

    let inatCalls = 0;
    server.use(
      http.get(INAT_TAXA, () => {
        inatCalls++;
        return HttpResponse.json({
          total_results: 1, page: 1, per_page: 1,
          results: [{
            id: 1001, name: 'Pyrocephalus rubinus', rank: 'species',
            matched_term: 'Pyrocephalus rubinus',
            wikipedia_url: 'https://en.wikipedia.org/wiki/Vermilion_flycatcher',
          }],
        });
      }),
      http.get(WIKI_SUMMARY, () => HttpResponse.json(
        { extract_html: SAMPLE_BODY, revision: '1' },
        { status: 200, headers: { etag: '"e1"' } }
      ))
    );

    const summary = await runDescriptions({ pool: db.pool, paceMs: 0 });

    expect(summary.speciesCount).toBe(1);
    expect(summary.descriptionsWritten).toBe(1);
    expect(inatCalls).toBe(1);

    // Only verfly has a row.
    const { rows } = await db.pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM species_descriptions`
    );
    expect(Number(rows[0]?.count)).toBe(1);
  });

  it('per-species failure is captured in the summary and does not abort the run', async () => {
    // verfly's iNat call throws 500 (after retry) → recorded as failure.
    // annhum's Wikipedia call throws → recorded as failure.
    // norcar succeeds.
    let verflyInatCalls = 0;
    server.use(
      http.get(INAT_TAXA, ({ request }) => {
        const sciName = new URL(request.url).searchParams.get('q');
        if (sciName === 'Pyrocephalus rubinus') {
          verflyInatCalls++;
          return new HttpResponse('boom', { status: 500 });
        }
        const map: Record<string, number> = {
          'Calypte anna': 1002,
          'Cardinalis cardinalis': 1003,
        };
        const id = map[sciName ?? ''];
        if (!id) return HttpResponse.json({ total_results: 0, results: [] });
        return HttpResponse.json({
          total_results: 1, page: 1, per_page: 1,
          results: [{
            id, name: sciName, rank: 'species', matched_term: sciName,
            wikipedia_url: `https://en.wikipedia.org/wiki/${sciName?.replace(' ', '_')}`,
          }],
        });
      }),
      http.get(WIKI_SUMMARY, ({ params }) => {
        // annhum's wiki path throws.
        const title = params.title as string;
        if (title.includes('Calypte') || title.includes("Anna")) {
          return new HttpResponse('boom', { status: 500 });
        }
        return HttpResponse.json(
          { extract_html: SAMPLE_BODY_2, revision: '999' },
          { status: 200, headers: { etag: '"good"' } }
        );
      })
    );

    const summary = await runDescriptions({
      pool: db.pool, paceMs: 0, maxRetries: 1, retryBaseMs: 1,
    });

    expect(summary.descriptionsFailed).toBe(2);
    expect(summary.descriptionsWritten).toBe(1); // norcar
    expect(summary.errors).toHaveLength(2);
    const failedCodes = summary.errors.map(e => e.speciesCode).sort();
    expect(failedCodes).toEqual(['annhum', 'verfly']);

    // norcar succeeded.
    const norcarRow = await db.pool.query(
      `SELECT 1 FROM species_descriptions WHERE species_code = 'norcar'`
    );
    expect(norcarRow.rowCount).toBe(1);
  });

  it('writes the iNat-resolved id back to species_meta.inat_taxon_id on first lookup', async () => {
    // Confirm species_meta.inat_taxon_id begins NULL, then becomes populated
    // after the run.
    await db.pool.query(`DELETE FROM observations WHERE species_code != 'verfly'`);
    const before = await db.pool.query<{ inat_taxon_id: string | null }>(
      `SELECT inat_taxon_id FROM species_meta WHERE species_code = 'verfly'`
    );
    expect(before.rows[0]?.inat_taxon_id).toBeNull();

    server.use(
      http.get(INAT_TAXA, () => HttpResponse.json({
        total_results: 1, page: 1, per_page: 1,
        results: [{
          id: 12345, name: 'Pyrocephalus rubinus', rank: 'species',
          matched_term: 'Pyrocephalus rubinus',
          wikipedia_url: 'https://en.wikipedia.org/wiki/Vermilion_flycatcher',
        }],
      })),
      http.get(WIKI_SUMMARY, () => HttpResponse.json(
        { extract_html: SAMPLE_BODY, revision: '1' },
        { status: 200, headers: { etag: '"e"' } }
      ))
    );

    await runDescriptions({ pool: db.pool, paceMs: 0 });

    const after = await db.pool.query<{ inat_taxon_id: string | null }>(
      `SELECT inat_taxon_id FROM species_meta WHERE species_code = 'verfly'`
    );
    expect(after.rows[0]?.inat_taxon_id).toBe('12345');
  });

  it('iNat returns null (zero hits) → species is skipped without writing a description', async () => {
    await db.pool.query(`DELETE FROM observations WHERE species_code != 'verfly'`);
    server.use(
      http.get(INAT_TAXA, () => HttpResponse.json({
        total_results: 0, page: 1, per_page: 1, results: [],
      }))
      // No Wikipedia handler — if the orchestrator tries to call Wikipedia,
      // MSW's onUnhandledRequest: 'error' fails the test.
    );

    const summary = await runDescriptions({ pool: db.pool, paceMs: 0 });

    expect(summary.speciesCount).toBe(1);
    expect(summary.descriptionsWritten).toBe(0);
    expect(summary.descriptionsSkipped).toBe(1);
    expect(summary.descriptionsFailed).toBe(0);

    const { rows } = await db.pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM species_descriptions`
    );
    expect(Number(rows[0]?.count)).toBe(0);
  });

  it('Wikipedia 404 + iNat summary present → falls back to iNat, writes row with source=inat', async () => {
    // The fallback path is the whole point of #374. When Wikipedia REST 404s
    // (deleted page / never existed) AND iNat's per-id endpoint returns a
    // non-null `wikipedia_summary`, the orchestrator must:
    //   (a) sanitize the iNat plaintext via sanitizeText (not DOMPurify),
    //   (b) persist the row with source='inat' and license='CC-BY-SA-4.0'
    //       (the underlying source is the same Wikipedia article),
    //   (c) increment BOTH descriptionsWritten AND the new descriptionsFromInat
    //       counter (descriptionsWritten total covers Wikipedia + iNat sources).
    await db.pool.query(`DELETE FROM observations WHERE species_code != 'verfly'`);
    const INAT_FALLBACK_BODY = 'The vermilion flycatcher (Pyrocephalus rubinus) is a small passerine bird native to the Americas. The male is brilliantly red.';
    let inatByIdHits = 0;
    server.use(
      http.get(INAT_TAXA, () => HttpResponse.json({
        total_results: 1, page: 1, per_page: 1,
        results: [{
          id: 1001, name: 'Pyrocephalus rubinus', rank: 'species',
          matched_term: 'Pyrocephalus rubinus',
          wikipedia_url: 'https://en.wikipedia.org/wiki/Vermilion_flycatcher',
        }],
      })),
      http.get(WIKI_SUMMARY, () => new HttpResponse('not found', { status: 404 })),
      http.get(INAT_TAXA_BY_ID, ({ params }) => {
        inatByIdHits++;
        // The per-id endpoint must be called with the cached taxon id (1001
        // from the search-endpoint pass) — the orchestrator should NEVER
        // re-hit the search endpoint here.
        expect(params.id).toBe('1001');
        return HttpResponse.json({
          total_results: 1, page: 1, per_page: 1,
          results: [{
            id: 1001, name: 'Pyrocephalus rubinus', rank: 'species',
            wikipedia_summary: INAT_FALLBACK_BODY,
            wikipedia_url: 'https://en.wikipedia.org/wiki/Vermilion_flycatcher',
          }],
        });
      })
    );

    const summary = await runDescriptions({ pool: db.pool, paceMs: 0 });

    expect(summary.descriptionsWritten).toBe(1);
    expect(summary.descriptionsFromInat).toBe(1);
    expect(summary.descriptionsSkipped).toBe(0);
    expect(summary.descriptionsFailed).toBe(0);
    expect(inatByIdHits).toBe(1);

    const { rows } = await db.pool.query<{
      species_code: string;
      source: string;
      body: string;
      license: string;
      attribution_url: string;
      etag: string | null;
      revision_id: string | null;
    }>(
      `SELECT species_code, source, body, license, attribution_url, etag, revision_id
         FROM species_descriptions WHERE species_code = 'verfly'`
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.source).toBe('inat');
    expect(rows[0]?.body).toBe(INAT_FALLBACK_BODY);
    expect(rows[0]?.license).toBe('CC-BY-SA-4.0');
    // Fallback path uses the cached Wikipedia URL when present (so the
    // frontend's "Read more on Wikipedia" link still goes to the same article).
    expect(rows[0]?.attribution_url).toBe('https://en.wikipedia.org/wiki/Vermilion_flycatcher');
    // No upstream Wikipedia revision/etag on the iNat fallback path.
    expect(rows[0]?.etag).toBeNull();
    expect(rows[0]?.revision_id).toBeNull();
  });

  it('Wikipedia 404 + iNat returns null summary → species is skipped (descriptionsSkipped++)', async () => {
    // Both upstreams come up empty: iNat has the taxon record but no
    // Wikipedia cross-reference. The fallback bails out, no row is written,
    // descriptionsSkipped increments.
    await db.pool.query(`DELETE FROM observations WHERE species_code != 'verfly'`);
    server.use(
      http.get(INAT_TAXA, () => HttpResponse.json({
        total_results: 1, page: 1, per_page: 1,
        results: [{
          id: 1001, name: 'Pyrocephalus rubinus', rank: 'species',
          matched_term: 'Pyrocephalus rubinus',
          wikipedia_url: 'https://en.wikipedia.org/wiki/Vermilion_flycatcher',
        }],
      })),
      http.get(WIKI_SUMMARY, () => new HttpResponse('not found', { status: 404 })),
      http.get(INAT_TAXA_BY_ID, () => HttpResponse.json({
        total_results: 1, page: 1, per_page: 1,
        results: [{
          id: 1001, name: 'Pyrocephalus rubinus', rank: 'species',
          wikipedia_summary: null,
          wikipedia_url: null,
        }],
      }))
    );

    const summary = await runDescriptions({ pool: db.pool, paceMs: 0 });

    expect(summary.descriptionsWritten).toBe(0);
    expect(summary.descriptionsFromInat).toBe(0);
    expect(summary.descriptionsSkipped).toBe(1);
    expect(summary.descriptionsFailed).toBe(0);

    const { rows } = await db.pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM species_descriptions`
    );
    expect(Number(rows[0]?.count)).toBe(0);
  });

  it('Wikipedia 200 happy path does NOT call iNat /v1/taxa/{id} (avoid wasted bandwidth)', async () => {
    // Critical perf invariant: the per-id call only fires on the Wikipedia-404
    // fallback branch. On the cold-cache happy path, it stays unused — calling
    // it on every species would double the iNat round-trips.
    await db.pool.query(`DELETE FROM observations WHERE species_code != 'verfly'`);
    let inatByIdHits = 0;
    server.use(
      http.get(INAT_TAXA, () => HttpResponse.json({
        total_results: 1, page: 1, per_page: 1,
        results: [{
          id: 1001, name: 'Pyrocephalus rubinus', rank: 'species',
          matched_term: 'Pyrocephalus rubinus',
          wikipedia_url: 'https://en.wikipedia.org/wiki/Vermilion_flycatcher',
        }],
      })),
      http.get(WIKI_SUMMARY, () => HttpResponse.json(
        { extract_html: SAMPLE_BODY, revision: '1' },
        { status: 200, headers: { etag: '"e"' } }
      )),
      http.get(INAT_TAXA_BY_ID, () => {
        inatByIdHits++;
        return HttpResponse.json({ total_results: 0, results: [] });
      })
    );

    const summary = await runDescriptions({ pool: db.pool, paceMs: 0 });

    expect(summary.descriptionsWritten).toBe(1);
    expect(summary.descriptionsFromInat).toBe(0);
    // The per-id endpoint must NOT be hit on the Wikipedia-200 happy path.
    expect(inatByIdHits).toBe(0);
  });

  it('Wikipedia 304 (warm cache) does NOT call iNat /v1/taxa/{id} (already has a row)', async () => {
    // The 304 path means the existing row is fresh; calling the iNat per-id
    // endpoint would be wasted bandwidth. Same invariant as the 200 path —
    // the fallback only fires on Wikipedia 404.
    await db.pool.query(
      `INSERT INTO species_descriptions
         (species_code, source, body, license, revision_id, etag, attribution_url)
       VALUES
         ('verfly', 'wikipedia', '${'p'.repeat(60)}', 'CC-BY-SA-4.0', 1234567890, '"old-etag"', 'https://en.wikipedia.org/wiki/Vermilion_flycatcher')`
    );
    await db.pool.query(
      `UPDATE species_meta SET inat_taxon_id = 1001 WHERE species_code = 'verfly'`
    );
    await db.pool.query(`DELETE FROM observations WHERE species_code != 'verfly'`);

    let inatByIdHits = 0;
    server.use(
      http.get(WIKI_SUMMARY, () => new HttpResponse(null, {
        status: 304, headers: { etag: '"old-etag"' }
      })),
      http.get(INAT_TAXA_BY_ID, () => {
        inatByIdHits++;
        return HttpResponse.json({ total_results: 0, results: [] });
      })
    );

    const summary = await runDescriptions({ pool: db.pool, paceMs: 0 });

    expect(summary.descriptionsSkipped).toBe(1);
    expect(summary.descriptionsWritten).toBe(0);
    expect(summary.descriptionsFromInat).toBe(0);
    expect(inatByIdHits).toBe(0);
  });

  it('rejects garbage license values via DB CHECK (defense-in-depth on top of upstream license guarantee)', async () => {
    // The Wikipedia client hard-codes license = 'CC-BY-SA-4.0' so this is a
    // belt-and-suspenders test — confirms the DB CHECK fires if a future
    // refactor accidentally surfaces a different code.
    await expect(
      db.pool.query(
        `INSERT INTO species_descriptions (species_code, source, body, license, attribution_url)
         VALUES ('verfly', 'wikipedia', '${'x'.repeat(60)}', 'CC-BY-NC-3.0', 'https://x.test/y')`
      )
    ).rejects.toThrow(/check constraint/i);
  });

  it('sanitization rejects (body length out of range) become per-species failures, not run aborts', async () => {
    await db.pool.query(`DELETE FROM observations WHERE species_code != 'verfly'`);
    server.use(
      http.get(INAT_TAXA, () => HttpResponse.json({
        total_results: 1, page: 1, per_page: 1,
        results: [{
          id: 1001, name: 'Pyrocephalus rubinus', rank: 'species',
          matched_term: 'Pyrocephalus rubinus',
          wikipedia_url: 'https://en.wikipedia.org/wiki/Vermilion_flycatcher',
        }],
      })),
      // Body too short — the sanitizer throws SanitizationError; the
      // orchestrator catches it and increments descriptionsFailed.
      http.get(WIKI_SUMMARY, () => HttpResponse.json(
        { extract_html: '<p>x</p>', revision: '1' },
        { status: 200, headers: { etag: '"e"' } }
      ))
    );

    const summary = await runDescriptions({ pool: db.pool, paceMs: 0 });

    expect(summary.descriptionsFailed).toBe(1);
    expect(summary.descriptionsWritten).toBe(0);
    expect(summary.errors[0]?.speciesCode).toBe('verfly');
    expect(summary.errors[0]?.reason).toMatch(/length/i);
  });

  it('warm cache + Wikipedia 404 (renamed article) → deletes stale row and increments staleUrls', async () => {
    // Hazard: the cached short-circuit at the top of the loop trusts both
    // species_meta.inat_taxon_id and species_descriptions.attribution_url.
    // When Wikipedia silently renames the underlying article, the cached URL
    // produces an indefinite stream of 404s — and #374's iNat-summary fallback
    // sits in the cold-cache `else` branch, so it never fires for a row whose
    // attribution_url is already populated. Without this fix the species
    // permanently loses coverage.
    //
    // Fix: on the warm-cache path, when fetchWikipediaSummary returns null
    // (404), DELETE the row so the next cron run takes the cold path —
    // re-resolving via /v1/taxa, picking up the renamed wikipedia_url, and
    // either writing a fresh description or falling through to the
    // iNat-summary fallback per #374.
    await db.pool.query(
      `INSERT INTO species_descriptions
         (species_code, source, body, license, revision_id, etag, attribution_url)
       VALUES
         ('verfly', 'wikipedia', '${'p'.repeat(60)}', 'CC-BY-SA-4.0', 1234567890, '"old-etag"', 'https://en.wikipedia.org/wiki/Stale_old_title')`
    );
    await db.pool.query(
      `UPDATE species_meta SET inat_taxon_id = 1001 WHERE species_code = 'verfly'`
    );
    await db.pool.query(`DELETE FROM observations WHERE species_code != 'verfly'`);

    let inatHits = 0;
    let inatByIdHits = 0;
    server.use(
      // The warm-cache path skips iNat /v1/taxa — confirm it stays unhit.
      http.get(INAT_TAXA, () => {
        inatHits++;
        return HttpResponse.json({ total_results: 0, results: [] });
      }),
      // Cached Wikipedia title resolves to 404 — the article was renamed.
      http.get(WIKI_SUMMARY, () => new HttpResponse('not found', { status: 404 })),
      // The fallback /v1/taxa/{id} must NOT be called on the warm-cache path:
      // the orchestrator's job here is to clear the stale cache so the NEXT
      // run takes the cold path; firing the fallback now would persist a row
      // against a stale URL.
      http.get(INAT_TAXA_BY_ID, () => {
        inatByIdHits++;
        return HttpResponse.json({ total_results: 0, results: [] });
      })
    );

    const summary = await runDescriptions({ pool: db.pool, paceMs: 0 });

    expect(summary.descriptionsWritten).toBe(0);
    expect(summary.descriptionsFromInat).toBe(0);
    expect(summary.descriptionsFailed).toBe(0);
    expect(summary.staleUrls).toBe(1);
    expect(inatHits).toBe(0);
    expect(inatByIdHits).toBe(0);

    // Row was deleted — the next cron run will take the cold-cache path.
    const { rows } = await db.pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM species_descriptions WHERE species_code = 'verfly'`
    );
    expect(Number(rows[0]?.count)).toBe(0);
    // species_meta.inat_taxon_id is preserved — only the description-side
    // cache is invalidated, not the iNat taxon mapping.
    const { rows: metaRows } = await db.pool.query<{ inat_taxon_id: string | null }>(
      `SELECT inat_taxon_id FROM species_meta WHERE species_code = 'verfly'`
    );
    expect(metaRows[0]?.inat_taxon_id).toBe('1001');
  });

  it('after stale-URL clear, next run takes cold path and repopulates with renamed Wikipedia URL', async () => {
    // Two-run integration: first run clears the stale row (Wikipedia 404 on
    // cached URL); second run re-resolves via iNat (returning the renamed
    // wikipedia_url) and persists a fresh description with the new URL.
    await db.pool.query(
      `INSERT INTO species_descriptions
         (species_code, source, body, license, revision_id, etag, attribution_url)
       VALUES
         ('verfly', 'wikipedia', '${'p'.repeat(60)}', 'CC-BY-SA-4.0', 1234567890, '"old-etag"', 'https://en.wikipedia.org/wiki/Stale_old_title')`
    );
    await db.pool.query(
      `UPDATE species_meta SET inat_taxon_id = 1001 WHERE species_code = 'verfly'`
    );
    await db.pool.query(`DELETE FROM observations WHERE species_code != 'verfly'`);

    // Run 1: cached URL 404s on Wikipedia, stale row deleted.
    server.use(
      http.get(WIKI_SUMMARY, () => new HttpResponse('not found', { status: 404 }))
    );
    const summary1 = await runDescriptions({ pool: db.pool, paceMs: 0 });
    expect(summary1.staleUrls).toBe(1);
    expect(summary1.descriptionsWritten).toBe(0);

    // Confirm the row is gone (cold-cache state).
    const { rows: between } = await db.pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM species_descriptions WHERE species_code = 'verfly'`
    );
    expect(Number(between[0]?.count)).toBe(0);

    // Run 2: cold cache → iNat returns the RENAMED wikipedia_url, Wikipedia
    // returns 200 for the new title, row repopulates.
    server.resetHandlers();
    server.use(
      http.get(INAT_TAXA, ({ request }) => {
        const sciName = new URL(request.url).searchParams.get('q');
        if (sciName !== 'Pyrocephalus rubinus') {
          return HttpResponse.json({ total_results: 0, results: [] });
        }
        return HttpResponse.json({
          total_results: 1, page: 1, per_page: 1,
          results: [{
            id: 1001, name: sciName, rank: 'species', matched_term: sciName,
            // The new (renamed) Wikipedia URL.
            wikipedia_url: 'https://en.wikipedia.org/wiki/Vermilion_flycatcher_(renamed)',
          }],
        });
      }),
      http.get(WIKI_SUMMARY, () => HttpResponse.json(
        { extract_html: SAMPLE_BODY, revision: '9999' },
        { status: 200, headers: { etag: '"new-etag"' } }
      ))
    );

    const summary2 = await runDescriptions({ pool: db.pool, paceMs: 0 });
    expect(summary2.descriptionsWritten).toBe(1);
    expect(summary2.staleUrls).toBe(0);
    expect(summary2.descriptionsFailed).toBe(0);

    const { rows: after } = await db.pool.query<{
      species_code: string;
      source: string;
      attribution_url: string;
      etag: string | null;
    }>(
      `SELECT species_code, source, attribution_url, etag
         FROM species_descriptions WHERE species_code = 'verfly'`
    );
    expect(after).toHaveLength(1);
    expect(after[0]?.attribution_url).toBe(
      'https://en.wikipedia.org/wiki/Vermilion_flycatcher_(renamed)'
    );
    expect(after[0]?.source).toBe('wikipedia');
    expect(after[0]?.etag).toBe('"new-etag"');
  });
});
