import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import Database from 'better-sqlite3';
import { createServer } from './index.js';

function seedDb(): Database.Database {
  const db = new Database(':memory:');
  // Canonical schema (matches src/db.ts openDb): photo_current carries `reviewed`
  // and photo_decision carries `resource_requested` — denyAndAdvance writes the
  // latter when the pre-scored pool is exhausted, so the column must exist here.
  db.exec(`
    CREATE TABLE photo_current(species_code TEXT PRIMARY KEY, com_name TEXT, sci_name TEXT, family TEXT, url TEXT, attribution TEXT, license TEXT, content_hash TEXT, reviewed INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE photo_score(id INTEGER PRIMARY KEY, species_code TEXT, role TEXT, candidate_inat_id INTEGER, content_hash TEXT, overall REAL, verdict TEXT, criteria_json TEXT, flags_json TEXT, keep INTEGER, quality_score REAL, field_marks TEXT, rationale TEXT, rubric_version TEXT, scored_at TEXT);
    CREATE TABLE photo_candidate(id INTEGER PRIMARY KEY, species_code TEXT, inat_id INTEGER, photo_url TEXT, thumb_path TEXT, attribution TEXT, license TEXT, excluded INTEGER DEFAULT 0, source_round INTEGER);
    CREATE TABLE photo_decision(species_code TEXT PRIMARY KEY, action TEXT, chosen_candidate_id INTEGER, deny_reason TEXT, deny_tags_json TEXT, resource_requested INTEGER NOT NULL DEFAULT 0, decided_at TEXT, applied INTEGER DEFAULT 0, applied_at TEXT);
    CREATE TABLE swap_selection(species_code TEXT PRIMARY KEY, chosen_inat_id INTEGER, decided_at TEXT);
  `);
  const crit = JSON.stringify({ framing: 8, subjectClarity: 9, liveness: 10, naturalness: 9, pose: 7, background: 6, lighting: 8 });
  db.prepare(`INSERT INTO photo_current (species_code,com_name,sci_name,family,url,attribution,license,content_hash,reviewed) VALUES ('houspa','House Sparrow','Passer domesticus','passeridae','https://photos/houspa.jpg','(c) B','cc0','hashB',1)`).run();
  db.prepare(`INSERT INTO photo_score (species_code,role,candidate_inat_id,content_hash,overall,verdict,criteria_json,flags_json,rationale,rubric_version,scored_at) VALUES ('houspa','current',NULL,'hashB',18,'reject',?, '["dead","distant"]','dead','v1','2026-06-11T00:00:00Z')`).run(crit);
  // Pre-scored candidate pool (source-candidates already scored these). 5001 is the
  // top-ranked (shown as `proposed`); 5002 is the next-best already-scored alternate.
  db.prepare(`INSERT INTO photo_candidate (species_code,inat_id,photo_url,thumb_path,attribution,license,excluded,source_round) VALUES ('houspa',5001,'https://inat/5001.jpg','thumb-cache/5001.jpg','(c) C','cc-by',0,1)`).run();
  db.prepare(`INSERT INTO photo_score (species_code,role,candidate_inat_id,content_hash,overall,verdict,criteria_json,flags_json,rationale,rubric_version,scored_at) VALUES ('houspa','candidate',5001,'hashC',79,'good',?, '[]','clean','v1','2026-06-11T00:00:00Z')`).run(crit);
  db.prepare(`INSERT INTO photo_candidate (species_code,inat_id,photo_url,thumb_path,attribution,license,excluded,source_round) VALUES ('houspa',5002,'https://inat/5002.jpg','thumb-cache/5002.jpg','(c) D','cc0',0,1)`).run();
  db.prepare(`INSERT INTO photo_score (species_code,role,candidate_inat_id,content_hash,overall,verdict,criteria_json,flags_json,rationale,rubric_version,scored_at) VALUES ('houspa','candidate',5002,'hashD',64,'good',?, '[]','clean','v1','2026-06-11T00:00:00Z')`).run(crit);
  return db;
}

describe('review-server API', () => {
  let db: Database.Database;
  afterEach(() => db.close());
  beforeEach(() => { db = seedDb(); });

  it('GET /api/overview returns rows honoring sort/filter', async () => {
    const app = createServer(db);
    const res = await request(app).get('/api/overview?sort=worst-first&filter=flagged');
    expect(res.status).toBe(200);
    expect(res.body.rows).toHaveLength(1);
    expect(res.body.rows[0].speciesCode).toBe('houspa');
    expect(res.body.stagedApproved).toBe(0);
  });

  it('GET /api/overview accepts the #969 needs-swap filter + quality-score sort', async () => {
    // Mark houspa's current photo as the judge's keep=0 (needs replacement gate).
    db.prepare(`UPDATE photo_score SET keep=0, quality_score=15 WHERE species_code='houspa' AND role='current'`).run();
    const app = createServer(db);

    const needsSwap = await request(app).get('/api/overview?sort=quality-score&filter=needs-swap');
    expect(needsSwap.status).toBe(200);
    expect(needsSwap.body.rows.map((r: { speciesCode: string }) => r.speciesCode)).toEqual(['houspa']);
    expect(needsSwap.body.rows[0].keep).toBe(false);

    // A bad sort/filter is still rejected.
    expect((await request(app).get('/api/overview?sort=nope')).status).toBe(400);
    expect((await request(app).get('/api/overview?filter=nope')).status).toBe(400);
  });

  it('GET /api/swap/:code returns the swap view', async () => {
    const app = createServer(db);
    const res = await request(app).get('/api/swap/houspa');
    expect(res.status).toBe(200);
    expect(res.body.current.overall).toBe(18);
    expect(res.body.proposed.inatId).toBe(5001);
  });

  it('GET /api/swap/:code 404s unknown species', async () => {
    const app = createServer(db);
    const res = await request(app).get('/api/swap/nope');
    expect(res.status).toBe(404);
  });

  it('POST /api/decision approve persists a staged decision', async () => {
    const app = createServer(db);
    const res = await request(app).post('/api/decision')
      .send({ speciesCode: 'houspa', action: 'approve', chosenCandidateId: 5001 });
    expect(res.status).toBe(200);
    const row = db.prepare(`SELECT action, chosen_candidate_id FROM photo_decision WHERE species_code='houspa'`).get() as { action: string; chosen_candidate_id: number | null };
    expect(row.action).toBe('approve');
    expect(row.chosen_candidate_id).toBe(5001);
  });

  it('POST /api/decision approve without a chosenCandidateId is rejected 400', async () => {
    const app = createServer(db);
    const res = await request(app).post('/api/decision').send({ speciesCode: 'houspa', action: 'approve' });
    expect(res.status).toBe(400);
    // nothing persisted: a null approve would defeat the swap
    const row = db.prepare(`SELECT action FROM photo_decision WHERE species_code='houspa'`).get() as { action: string } | undefined;
    expect(row).toBeUndefined();
  });

  it('POST /api/deny records the deny, excludes the shown candidate, and advances to the next pre-scored alternate', async () => {
    // Common case: the pre-scored pool still has an alternate (5002). Deny the
    // shown candidate (5001) via excludeIds; denyAndAdvance excludes it and
    // returns the next already-scored alternate as `result.next` — instant, NO
    // scoring. The route surfaces it as `proposed`.
    const app = createServer(db);
    const res = await request(app).post('/api/deny')
      .send({ speciesCode: 'houspa', reason: 'still distant', tags: ['still-distant'], excludeIds: [5001] });
    expect(res.status).toBe(200);
    expect(res.body.resourceQueued).toBe(false);
    // denyAndAdvance returned the next pre-scored alternate as `result.next`,
    // which the route forwards as `proposed` (instant advance — no agent, no scoring)
    expect(res.body.proposed.inatId).toBe(5002);

    // deny recorded
    const dec = db.prepare(`SELECT action, deny_reason, deny_tags_json, resource_requested FROM photo_decision WHERE species_code='houspa'`).get() as { action: string; deny_reason: string; deny_tags_json: string; resource_requested: number };
    expect(dec.action).toBe('deny');
    expect(dec.deny_reason).toBe('still distant');
    expect(JSON.parse(dec.deny_tags_json)).toEqual(['still-distant']);
    // pool not exhausted → no re-source queued
    expect(dec.resource_requested).toBe(0);
    // shown candidate excluded
    const ex = db.prepare(`SELECT excluded FROM photo_candidate WHERE inat_id=5001`).get() as { excluded: number };
    expect(ex.excluded).toBe(1);
    // and a follow-up swap fetch agrees: the next pre-scored alternate is now proposed
    const view = await request(app).get('/api/swap/houspa');
    expect(view.body.proposed.inatId).toBe(5002);
  });

  it('POST /api/deny queues a re-source when the pre-scored pool is exhausted', async () => {
    // Deny everything in the pool. Exclude 5002 up front and pass 5001 via
    // excludeIds so denyAndAdvance has no scored alternate left to advance to.
    db.prepare(`UPDATE photo_candidate SET excluded=1 WHERE inat_id=5002`).run();
    const app = createServer(db);
    const res = await request(app).post('/api/deny')
      .send({ speciesCode: 'houspa', reason: 'all wrong sex/morph', tags: ['wrong-sex-morph'], excludeIds: [5001] });
    expect(res.status).toBe(200);
    // pool exhausted → result.next is null, resourceRequested true; route forwards
    // as proposed:null, resourceQueued:true (UI shows "run source-candidates")
    expect(res.body.proposed).toBeNull();
    expect(res.body.resourceQueued).toBe(true);
    // the re-source-requested flag is persisted for the next source-candidates run
    const dec = db.prepare(`SELECT action, resource_requested, deny_tags_json FROM photo_decision WHERE species_code='houspa'`).get() as { action: string; resource_requested: number; deny_tags_json: string };
    expect(dec.action).toBe('deny');
    expect(dec.resource_requested).toBe(1);
    expect(JSON.parse(dec.deny_tags_json)).toEqual(['wrong-sex-morph']);
    // shown candidate still excluded
    const ex = db.prepare(`SELECT excluded FROM photo_candidate WHERE inat_id=5001`).get() as { excluded: number };
    expect(ex.excluded).toBe(1);
  });

  it('POST /api/decision rejects an unknown action with 400', async () => {
    const app = createServer(db);
    const res = await request(app).post('/api/decision').send({ speciesCode: 'houspa', action: 'bogus' });
    expect(res.status).toBe(400);
  });

  it('GET /api/pending-swaps returns the swap selection (outscores gate)', async () => {
    // Flag houspa's current as needs-replacement (keep=0, low quality) and give
    // its two candidates quality scores so the gate has something to compare.
    db.prepare(`UPDATE photo_score SET keep=0, quality_score=20 WHERE species_code='houspa' AND role='current'`).run();
    db.prepare(`UPDATE photo_score SET quality_score=82, field_marks='["wing bars"]' WHERE candidate_inat_id=5001`).run();
    db.prepare(`UPDATE photo_score SET quality_score=64 WHERE candidate_inat_id=5002`).run();

    const app = createServer(db);
    const res = await request(app).get('/api/pending-swaps');
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.proposedCount).toBe(1);
    const s = res.body.swaps[0];
    expect(s.speciesCode).toBe('houspa');
    expect(s.current.qualityScore).toBe(20);
    // best candidate (82) outscores current (20) → proposed.
    expect(s.proposed.inatId).toBe(5001);
    expect(s.outscores).toBe(true);
    expect(s.delta).toBe(62);
    expect(s.candidates.find((c: { inatId: number }) => c.inatId === 5001).selected).toBe(true);
  });

  it('GET /api/pending-swaps reports proposed:null when no candidate outscores the current', async () => {
    // current quality 90; candidates 82/64 — neither outscores → proposed:null.
    db.prepare(`UPDATE photo_score SET keep=0, quality_score=90 WHERE species_code='houspa' AND role='current'`).run();
    db.prepare(`UPDATE photo_score SET quality_score=82 WHERE candidate_inat_id=5001`).run();
    db.prepare(`UPDATE photo_score SET quality_score=64 WHERE candidate_inat_id=5002`).run();

    const app = createServer(db);
    const res = await request(app).get('/api/pending-swaps');
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);          // still listed (has candidates)
    expect(res.body.proposedCount).toBe(0);  // but nothing proposed
    expect(res.body.swaps[0].proposed).toBeNull();
    expect(res.body.swaps[0].outscores).toBe(false);
  });

  it('GET /api/pending-swaps honors ?limit and rejects a bad limit with 400', async () => {
    db.prepare(`UPDATE photo_score SET keep=0, quality_score=20 WHERE species_code='houspa' AND role='current'`).run();
    db.prepare(`UPDATE photo_score SET quality_score=82 WHERE candidate_inat_id=5001`).run();
    const app = createServer(db);

    const ok = await request(app).get('/api/pending-swaps?limit=0');
    expect(ok.status).toBe(200);
    expect(ok.body.total).toBe(0); // capped to zero species

    const bad = await request(app).get('/api/pending-swaps?limit=-1');
    expect(bad.status).toBe(400);
  });

  // ── swap-review v2: operator override (click-to-pick) ──

  /** Flag houspa needs-replacement and give the two candidates scores. */
  function flagWithCandidates(db: Database.Database): void {
    db.prepare(`UPDATE photo_score SET keep=0, quality_score=20 WHERE species_code='houspa' AND role='current'`).run();
    db.prepare(`UPDATE photo_score SET quality_score=82 WHERE candidate_inat_id=5001`).run(); // auto best (Δ62)
    db.prepare(`UPDATE photo_score SET quality_score=64 WHERE candidate_inat_id=5002`).run(); // operator pick
  }

  it('POST /api/select-swap records an override; GET reflects it; selectSwaps honors it (chosen != auto-best)', async () => {
    flagWithCandidates(db);
    const app = createServer(db);

    // Auto-best is 5001; operator overrides to 5002.
    const res = await request(app).post('/api/select-swap').send({ speciesCode: 'houspa', inatId: 5002 });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    // GET /api/select-swap/:code reflects the persisted override.
    const got = await request(app).get('/api/select-swap/houspa');
    expect(got.status).toBe(200);
    expect(got.body.chosenInatId).toBe(5002);

    // pending-swaps now proposes the OVERRIDDEN candidate, flagged operatorChosen.
    const swaps = await request(app).get('/api/pending-swaps');
    const s = swaps.body.swaps[0];
    expect(s.proposed.inatId).toBe(5002);
    expect(s.operatorChosen).toBe(true);
    expect(s.candidates.find((c: { inatId: number }) => c.inatId === 5002).selected).toBe(true);
  });

  it('POST /api/select-swap with inatId:null records an explicit "no swap"; selectSwaps proposes null', async () => {
    flagWithCandidates(db);
    const app = createServer(db);

    const res = await request(app).post('/api/select-swap').send({ speciesCode: 'houspa', inatId: null });
    expect(res.status).toBe(200);

    const got = await request(app).get('/api/select-swap/houspa');
    expect(got.body.chosenInatId).toBeNull();

    const swaps = await request(app).get('/api/pending-swaps');
    const s = swaps.body.swaps[0];
    expect(s.proposed).toBeNull();
    expect(s.operatorChosen).toBe(true);
  });

  it('GET /api/select-swap/:code returns chosenInatId:undefined-equivalent (null body) when no override', async () => {
    flagWithCandidates(db);
    const app = createServer(db);
    const got = await request(app).get('/api/select-swap/houspa');
    expect(got.status).toBe(200);
    expect(got.body.override).toBeNull();
  });

  it('DELETE /api/select-swap/:code reverts to the auto gate (override row removed)', async () => {
    flagWithCandidates(db);
    const app = createServer(db);

    // Override to 5002, then revert.
    await request(app).post('/api/select-swap').send({ speciesCode: 'houspa', inatId: 5002 });
    expect((await request(app).get('/api/select-swap/houspa')).body.override).not.toBeNull();

    const del = await request(app).delete('/api/select-swap/houspa');
    expect(del.status).toBe(200);
    expect(del.body.ok).toBe(true);
    // Override gone → auto gate resumes; auto-best 5001 is proposed, not operator.
    expect((await request(app).get('/api/select-swap/houspa')).body.override).toBeNull();
    const swaps = await request(app).get('/api/pending-swaps');
    expect(swaps.body.swaps[0].proposed.inatId).toBe(5001);
    expect(swaps.body.swaps[0].operatorChosen).toBe(false);
  });

  it('POST /api/select-swap validates speciesCode and inatId', async () => {
    const app = createServer(db);
    // missing speciesCode
    expect((await request(app).post('/api/select-swap').send({ inatId: 5001 })).status).toBe(400);
    // non-integer inatId (and not null)
    expect((await request(app).post('/api/select-swap').send({ speciesCode: 'houspa', inatId: 'nope' })).status).toBe(400);
    // missing inatId key entirely is rejected (must be a number or explicit null)
    expect((await request(app).post('/api/select-swap').send({ speciesCode: 'houspa' })).status).toBe(400);
  });
});
