import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import Database from 'better-sqlite3';
import { runApplySwaps, type ApplyDeps } from './apply-swaps.js';

const ADMIN_BASE = 'https://admin.example';
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

/**
 * An in-memory SQLite matching the Slice-4 schema for the three tables
 * apply-swaps touches. Real better-sqlite3 (no DB mock — repo rule), just
 * `:memory:` so the test is hermetic and fast.
 */
function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE photo_current (
      species_code TEXT PRIMARY KEY, com_name TEXT, sci_name TEXT, family TEXT,
      url TEXT, attribution TEXT, license TEXT, content_hash TEXT
    );
    CREATE TABLE photo_candidate (
      id INTEGER PRIMARY KEY, species_code TEXT, inat_id INTEGER, photo_url TEXT,
      thumb_path TEXT, attribution TEXT, license TEXT,
      excluded INTEGER DEFAULT 0, source_round INTEGER
    );
    CREATE TABLE photo_decision (
      species_code TEXT PRIMARY KEY, action TEXT, chosen_candidate_id INTEGER,
      deny_reason TEXT, deny_tags_json TEXT, decided_at TEXT,
      applied INTEGER DEFAULT 0, applied_at TEXT
    );
  `);
  return db;
}

/** Seed one species with a current photo, one candidate, and an approve decision. */
function seedApproved(
  db: Database.Database,
  opts: { code: string; candidateId: number; newUrl: string; license?: string; applied?: 0 | 1 },
): void {
  db.prepare(
    `INSERT INTO photo_current (species_code, com_name, sci_name, family, url, attribution, license, content_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(opts.code, 'Common Name', 'Genus species', 'familyidae',
        `https://photos.bird-maps.com/species/${opts.code}.oldhash1.jpg`,
        '(c) Old Photographer, CC BY', 'cc-by', 'oldhash1');
  db.prepare(
    `INSERT INTO photo_candidate (id, species_code, inat_id, photo_url, thumb_path, attribution, license, excluded, source_round)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, 1)`,
  ).run(opts.candidateId, opts.code, 9000 + opts.candidateId, opts.newUrl,
        `./thumb-cache/${opts.candidateId}.jpg`, '(c) New Photographer, CC BY-SA', opts.license ?? 'cc-by-sa');
  db.prepare(
    `INSERT INTO photo_decision (species_code, action, chosen_candidate_id, decided_at, applied, applied_at)
     VALUES (?, 'approve', ?, ?, ?, NULL)`,
  ).run(opts.code, opts.candidateId, '2026-06-10T00:00:00.000Z', opts.applied ?? 0);
}

function makeDeps(db: Database.Database, overrides: Partial<ApplyDeps> = {}): ApplyDeps {
  return {
    db,
    adminBase: ADMIN_BASE,
    adminToken: 'tok',
    fetch: globalThis.fetch,
    log: () => {},          // silence summary output in tests
    confirm: async () => true,
    now: () => '2026-06-10T12:00:00.000Z',
    ...overrides,
  };
}

describe('runApplySwaps', () => {
  it('PUTs each approved swap and marks it applied on 2xx', async () => {
    const db = makeDb();
    seedApproved(db, { code: 'norcar', candidateId: 1, newUrl: 'https://inat.example/photos/1/original.jpg' });

    const seen: { url: string; auth: string | null; body: unknown }[] = [];
    server.use(
      http.put(`${ADMIN_BASE}/admin/species-photos/:code`, async ({ request, params }) => {
        seen.push({
          url: `/admin/species-photos/${params.code}`,
          auth: request.headers.get('Authorization'),
          body: await request.json(),
        });
        return HttpResponse.json({ url: 'https://photos.bird-maps.com/species/norcar.newhash.jpg', key: 'species/norcar.newhash.jpg' });
      }),
    );

    const result = await runApplySwaps(makeDeps(db));

    expect(result.applied).toEqual(['norcar']);
    expect(result.failed).toEqual([]);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.url).toBe('/admin/species-photos/norcar');
    expect(seen[0]!.auth).toBe('Bearer tok');
    expect(seen[0]!.body).toEqual({
      sourceUrl: 'https://inat.example/photos/1/original.jpg',
      attribution: '(c) New Photographer, CC BY-SA',
      license: 'cc-by-sa',
    });

    const row = db.prepare(`SELECT applied, applied_at FROM photo_decision WHERE species_code = 'norcar'`).get() as { applied: number; applied_at: string };
    expect(row.applied).toBe(1);
    expect(row.applied_at).toBe('2026-06-10T12:00:00.000Z');
  });

  it('leaves a row un-applied and reports it when the admin endpoint returns non-2xx', async () => {
    const db = makeDb();
    seedApproved(db, { code: 'baleag', candidateId: 2, newUrl: 'https://inat.example/photos/2/original.jpg' });

    server.use(
      http.put(`${ADMIN_BASE}/admin/species-photos/:code`, () =>
        HttpResponse.json({ error: 'license rejected by server-side allowlist' }, { status: 422 }),
      ),
    );

    const result = await runApplySwaps(makeDeps(db));

    expect(result.applied).toEqual([]);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]!.speciesCode).toBe('baleag');
    expect(result.failed[0]!.reason).toContain('422');

    const row = db.prepare(`SELECT applied FROM photo_decision WHERE species_code = 'baleag'`).get() as { applied: number };
    expect(row.applied).toBe(0);
  });

  it('isolates failures per species — one failure does not abort the rest', async () => {
    const db = makeDb();
    seedApproved(db, { code: 'aaa', candidateId: 1, newUrl: 'https://inat.example/photos/a/original.jpg' });
    seedApproved(db, { code: 'bbb', candidateId: 2, newUrl: 'https://inat.example/photos/b/original.jpg' });
    seedApproved(db, { code: 'ccc', candidateId: 3, newUrl: 'https://inat.example/photos/c/original.jpg' });

    server.use(
      http.put(`${ADMIN_BASE}/admin/species-photos/:code`, ({ params }) => {
        if (params.code === 'bbb') return HttpResponse.json({ error: 'boom' }, { status: 500 });
        return HttpResponse.json({ url: `https://photos.bird-maps.com/species/${params.code}.h.jpg`, key: 'k' });
      }),
    );

    const result = await runApplySwaps(makeDeps(db));

    expect(result.applied.sort()).toEqual(['aaa', 'ccc']);
    expect(result.failed.map(f => f.speciesCode)).toEqual(['bbb']);
    expect((db.prepare(`SELECT applied FROM photo_decision WHERE species_code='bbb'`).get() as { applied: number }).applied).toBe(0);
    expect((db.prepare(`SELECT applied FROM photo_decision WHERE species_code='aaa'`).get() as { applied: number }).applied).toBe(1);
    expect((db.prepare(`SELECT applied FROM photo_decision WHERE species_code='ccc'`).get() as { applied: number }).applied).toBe(1);
  });

  it('is idempotent — already-applied rows are skipped (no admin call)', async () => {
    const db = makeDb();
    seedApproved(db, { code: 'done', candidateId: 1, newUrl: 'https://inat.example/photos/d/original.jpg', applied: 1 });
    seedApproved(db, { code: 'todo', candidateId: 2, newUrl: 'https://inat.example/photos/t/original.jpg', applied: 0 });

    const calls: string[] = [];
    server.use(
      http.put(`${ADMIN_BASE}/admin/species-photos/:code`, ({ params }) => {
        calls.push(params.code as string);
        return HttpResponse.json({ url: 'https://photos.bird-maps.com/species/todo.h.jpg', key: 'k' });
      }),
    );

    const result = await runApplySwaps(makeDeps(db));

    expect(calls).toEqual(['todo']);            // 'done' is never called
    expect(result.applied).toEqual(['todo']);
    expect(result.alreadyAppliedTotal).toBe(1);
  });

  it('ignores non-approve decisions (keep / deny / pending)', async () => {
    const db = makeDb();
    seedApproved(db, { code: 'approveme', candidateId: 1, newUrl: 'https://inat.example/photos/1/original.jpg' });
    // A kept decision must never be pushed.
    db.prepare(
      `INSERT INTO photo_decision (species_code, action, chosen_candidate_id, decided_at, applied)
       VALUES ('keepme', 'keep', NULL, '2026-06-10T00:00:00.000Z', 0)`,
    ).run();

    const calls: string[] = [];
    server.use(
      http.put(`${ADMIN_BASE}/admin/species-photos/:code`, ({ params }) => {
        calls.push(params.code as string);
        return HttpResponse.json({ url: 'x', key: 'k' });
      }),
    );

    const result = await runApplySwaps(makeDeps(db));
    expect(calls).toEqual(['approveme']);
    expect(result.applied).toEqual(['approveme']);
  });

  it('aborts with zero admin calls when the operator declines confirmation', async () => {
    const db = makeDb();
    seedApproved(db, { code: 'norcar', candidateId: 1, newUrl: 'https://inat.example/photos/1/original.jpg' });

    let calls = 0;
    server.use(
      http.put(`${ADMIN_BASE}/admin/species-photos/:code`, () => {
        calls++;
        return HttpResponse.json({ url: 'x', key: 'k' });
      }),
    );

    const result = await runApplySwaps(makeDeps(db, { confirm: async () => false }));

    expect(calls).toBe(0);
    expect(result.aborted).toBe(true);
    expect(result.applied).toEqual([]);
    expect((db.prepare(`SELECT applied FROM photo_decision WHERE species_code='norcar'`).get() as { applied: number }).applied).toBe(0);
  });

  it('marks a species failed (un-applied) when fetch throws a network error', async () => {
    const db = makeDb();
    seedApproved(db, { code: 'neterr', candidateId: 1, newUrl: 'https://inat.example/photos/1/original.jpg' });

    const result = await runApplySwaps(
      makeDeps(db, { fetch: async () => { throw new Error('ECONNRESET'); } }),
    );

    expect(result.applied).toEqual([]);
    expect(result.failed[0]!.speciesCode).toBe('neterr');
    expect(result.failed[0]!.reason).toContain('ECONNRESET');
    expect((db.prepare(`SELECT applied FROM photo_decision WHERE species_code='neterr'`).get() as { applied: number }).applied).toBe(0);
  });
});

import { selectAppliableSwaps } from './apply-swaps.js';
import { openDb } from './db.js';
import { upsertCurrentPhoto, upsertScore, insertCandidate, setSwapSelection } from './store.js';
import type { QualityReport } from '@bird-watch/photo-quality';

/**
 * swap-review v2 §3: the operator-override-aware apply source. selectAppliableSwaps
 * derives the appliable swaps from selectSwaps (whose `proposed` already reflects
 * the swap_selection override), so apply-swaps and the pending-swaps page never
 * diverge. This is the bridge until the photo_decision approve path is unified
 * with the override path (follow-up noted in apply-swaps.ts).
 */
describe('selectAppliableSwaps (operator override → apply target)', () => {
  function seedCur(db: ReturnType<typeof openDb>, code: string, hash: string, qs: number): void {
    upsertCurrentPhoto(db, {
      speciesCode: code, comName: `Com ${code}`, sciName: `Sci ${code}`, family: `Fam ${code}`,
      url: `https://photos.bird-maps.com/${code}.jpg`, attribution: `(c) live ${code}`,
      license: 'cc-by', contentHash: hash,
    });
    const report: QualityReport = {
      overall: qs, verdict: 'reject',
      deterministic: { width: 0, height: 0, megapixels: 0, sharpness: 0, exposure: 0, aspectRatio: 0, passedGate: true, failReasons: [] },
      criteria: { framing: 5, subjectClarity: 5, liveness: 5, naturalness: 5, pose: 5, background: 5, lighting: 5 },
      flags: [], fieldMarks: [], keep: false, qualityScore: qs, rationale: 'flagged', rubricVersion: '0.2.0',
    };
    upsertScore(db, { speciesCode: code, role: 'current', candidateInatId: null, contentHash: hash, report });
  }
  function seedCand(db: ReturnType<typeof openDb>, code: string, inatId: number, qs: number): void {
    insertCandidate(db, {
      speciesCode: code, inatId, photoUrl: `https://inat.example/${inatId}.jpg`,
      thumbPath: `t/${inatId}.jpg`, attribution: `(c) cand ${inatId}`, license: 'cc-by', sourceRound: 1,
    });
    const report: QualityReport = {
      overall: qs, verdict: 'good',
      deterministic: { width: 0, height: 0, megapixels: 0, sharpness: 0, exposure: 0, aspectRatio: 0, passedGate: true, failReasons: [] },
      criteria: { framing: 7, subjectClarity: 7, liveness: 7, naturalness: 7, pose: 7, background: 7, lighting: 7 },
      flags: [], fieldMarks: [], keep: true, qualityScore: qs, rationale: `cand ${inatId}`, rubricVersion: '0.2.0',
    };
    upsertScore(db, { speciesCode: code, role: 'candidate', candidateInatId: inatId, contentHash: `c-${code}-${inatId}`, report });
  }

  it('targets the OVERRIDDEN candidate, not the auto-best, when an operator override is set', () => {
    const db = openDb(':memory:');
    seedCur(db, 'norcar', 'live-hash', 30);
    seedCand(db, 'norcar', 8001, 90); // auto-best (Δ60)
    seedCand(db, 'norcar', 8002, 60); // operator's pick (Δ30, still ≥20)

    // No override → auto-best 8001 is the apply target.
    const auto = selectAppliableSwaps(db);
    expect(auto).toHaveLength(1);
    expect(auto[0]!.speciesCode).toBe('norcar');
    expect(auto[0]!.newUrl).toBe('https://inat.example/8001.jpg');

    // Operator overrides to 8002 → apply target follows the override.
    setSwapSelection(db, 'norcar', 8002);
    const overridden = selectAppliableSwaps(db);
    expect(overridden).toHaveLength(1);
    expect(overridden[0]!.newUrl).toBe('https://inat.example/8002.jpg');
    expect(overridden[0]!.attribution).toBe('(c) cand 8002');
    expect(overridden[0]!.oldUrl).toBe('https://photos.bird-maps.com/norcar.jpg');

    // Explicit "no swap" → species drops out of the apply set entirely.
    setSwapSelection(db, 'norcar', null);
    expect(selectAppliableSwaps(db)).toHaveLength(0);
    db.close();
  });
});

import { resolveAdminEnv } from './apply-swaps.js';

describe('resolveAdminEnv', () => {
  it('returns base+token when both env vars are present', () => {
    const r = resolveAdminEnv({ ADMIN_API_URL: 'https://admin.bird-maps.com', ADMIN_API_TOKEN: 'tok' });
    expect(r).toEqual({ ok: true, adminBase: 'https://admin.bird-maps.com', adminToken: 'tok' });
  });

  it('reports an error when ADMIN_API_URL is missing', () => {
    const r = resolveAdminEnv({ ADMIN_API_TOKEN: 'tok' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/ADMIN_API_URL/);
  });

  it('reports an error when ADMIN_API_TOKEN is missing', () => {
    const r = resolveAdminEnv({ ADMIN_API_URL: 'https://admin.bird-maps.com' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/ADMIN_API_TOKEN/);
  });
});
