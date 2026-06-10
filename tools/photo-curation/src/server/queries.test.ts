import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { listOverview, type OverviewRow } from './queries.js';
import { getSwapView, writeDecision, denyAndAdvance, selectUnreviewed, markReviewed, type DenyInput } from './queries.js';

/** Open an in-memory db with the canonical schema and a tiny seed. */
function seedDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE photo_current(species_code TEXT PRIMARY KEY, com_name TEXT, sci_name TEXT, family TEXT, url TEXT, attribution TEXT, license TEXT, content_hash TEXT, reviewed INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE photo_score(id INTEGER PRIMARY KEY, species_code TEXT, role TEXT, candidate_inat_id INTEGER, content_hash TEXT, overall REAL, verdict TEXT, criteria_json TEXT, flags_json TEXT, rationale TEXT, rubric_version TEXT, scored_at TEXT);
    CREATE TABLE photo_candidate(id INTEGER PRIMARY KEY, species_code TEXT, inat_id INTEGER, photo_url TEXT, thumb_path TEXT, attribution TEXT, license TEXT, excluded INTEGER DEFAULT 0, source_round INTEGER);
    CREATE TABLE photo_decision(species_code TEXT PRIMARY KEY, action TEXT, chosen_candidate_id INTEGER, deny_reason TEXT, deny_tags_json TEXT, resource_requested INTEGER NOT NULL DEFAULT 0, decided_at TEXT, applied INTEGER DEFAULT 0, applied_at TEXT);
  `);
  const crit = JSON.stringify({ framing: 8, subjectClarity: 9, liveness: 10, naturalness: 9, pose: 7, background: 6, lighting: 8 });
  const critBad = JSON.stringify({ framing: 2, subjectClarity: 3, liveness: 1, naturalness: 2, pose: 2, background: 2, lighting: 3 });
  // good current photo (AI-scored → reviewed=1)
  db.prepare(`INSERT INTO photo_current (species_code,com_name,sci_name,family,url,attribution,license,content_hash,reviewed) VALUES ('amerob','American Robin','Turdus migratorius','turdidae','https://photos/amerob.jpg','(c) A','cc-by','hashA',1)`).run();
  db.prepare(`INSERT INTO photo_score (species_code,role,candidate_inat_id,content_hash,overall,verdict,criteria_json,flags_json,rationale,rubric_version,scored_at) VALUES ('amerob','current',NULL,'hashA',86,'great',?, '[]','sharp wild bird','v1','2026-06-10T00:00:00Z')`).run(crit);
  // bad current photo (dead + distant; AI-scored → reviewed=1)
  db.prepare(`INSERT INTO photo_current (species_code,com_name,sci_name,family,url,attribution,license,content_hash,reviewed) VALUES ('houspa','House Sparrow','Passer domesticus','passeridae','https://photos/houspa.jpg','(c) B','cc0','hashB',1)`).run();
  db.prepare(`INSERT INTO photo_score (species_code,role,candidate_inat_id,content_hash,overall,verdict,criteria_json,flags_json,rationale,rubric_version,scored_at) VALUES ('houspa','current',NULL,'hashB',18,'reject',?, '["dead","distant"]','dead specimen, distant','v1','2026-06-11T00:00:00Z')`).run(critBad);
  // candidate for houspa (round 1)
  db.prepare(`INSERT INTO photo_candidate (species_code,inat_id,photo_url,thumb_path,attribution,license,excluded,source_round) VALUES ('houspa',5001,'https://inat/5001.jpg','thumb-cache/5001.jpg','(c) C','cc-by',0,1)`).run();
  db.prepare(`INSERT INTO photo_score (species_code,role,candidate_inat_id,content_hash,overall,verdict,criteria_json,flags_json,rationale,rubric_version,scored_at) VALUES ('houspa','candidate',5001,'hashC',79,'good',?, '[]','clean wild perch','v1','2026-06-11T00:00:00Z')`).run(crit);
  return db;
}

describe('listOverview', () => {
  let db: Database.Database;
  beforeEach(() => { db = seedDb(); });
  afterEach(() => db.close());

  it('worst-first sorts ascending by overall', () => {
    const rows = listOverview(db, { sort: 'worst-first', filter: 'all' });
    expect(rows.map(r => r.speciesCode)).toEqual(['houspa', 'amerob']);
    expect(rows[0]!.overall).toBe(18);
  });

  it('best-first sorts descending by overall', () => {
    const rows = listOverview(db, { sort: 'best-first', filter: 'all' });
    expect(rows.map(r => r.speciesCode)).toEqual(['amerob', 'houspa']);
  });

  it('parses flags and criteria from json', () => {
    const houspa = listOverview(db, { sort: 'worst-first', filter: 'all' })[0]!;
    expect(houspa.flags).toEqual(['dead', 'distant']);
    expect(houspa.criteria.liveness).toBe(1);
  });

  it('filter=flagged returns only rows with >=1 flag', () => {
    const rows = listOverview(db, { sort: 'worst-first', filter: 'flagged' });
    expect(rows.map(r => r.speciesCode)).toEqual(['houspa']);
  });

  it('filter=dead-sick matches the dead flag', () => {
    const rows = listOverview(db, { sort: 'worst-first', filter: 'dead-sick' });
    expect(rows.map(r => r.speciesCode)).toEqual(['houspa']);
  });

  it('has-better-candidate sorts species with a higher-scoring candidate first', () => {
    const rows = listOverview(db, { sort: 'has-better-candidate', filter: 'all' });
    expect(rows[0]!.speciesCode).toBe('houspa'); // candidate 79 > current 18
    expect(rows[0]!.bestCandidateOverall).toBe(79);
    expect(rows.find(r => r.speciesCode === 'amerob')!.bestCandidateOverall).toBeNull();
  });

  it('recently-scored sorts by scored_at descending', () => {
    // houspa scored 2026-06-11, amerob scored 2026-06-10
    const rows = listOverview(db, { sort: 'recently-scored', filter: 'all' });
    expect(rows.map(r => r.speciesCode)).toEqual(['houspa', 'amerob']);
  });

  it('filter=distant matches the distant flag', () => {
    const rows = listOverview(db, { sort: 'worst-first', filter: 'distant' });
    expect(rows.map(r => r.speciesCode)).toEqual(['houspa']); // flags ['dead','distant']
  });

  it('filter=in-hand matches the in-hand flag', () => {
    // amerob has no in-hand flag; flip its flags_json to include it
    db.prepare(`UPDATE photo_score SET flags_json='["in-hand"]' WHERE species_code='amerob' AND role='current'`).run();
    const rows = listOverview(db, { sort: 'worst-first', filter: 'in-hand' });
    expect(rows.map(r => r.speciesCode)).toEqual(['amerob']);
  });

  it('filter=soft matches rows with subjectClarity in (0, SOFT_CLARITY_MAX]', () => {
    // houspa's critBad has subjectClarity=3 (soft); amerob's is 9 (sharp)
    const rows = listOverview(db, { sort: 'worst-first', filter: 'soft' });
    expect(rows.map(r => r.speciesCode)).toEqual(['houspa']);
  });

  it('filter=marked-for-swap returns only species with a pending/approve decision', () => {
    db.prepare(`INSERT INTO photo_decision (species_code, action, decided_at) VALUES ('amerob','pending','2026-06-11T00:00:00Z')`).run();
    const rows = listOverview(db, { sort: 'worst-first', filter: 'marked-for-swap' });
    expect(rows.map(r => r.speciesCode)).toEqual(['amerob']);
  });

  it('markedForSwap is true for a pending decision, false with no decision', () => {
    db.prepare(`INSERT INTO photo_decision (species_code, action, decided_at) VALUES ('amerob','pending','2026-06-11T00:00:00Z')`).run();
    const rows = listOverview(db, { sort: 'worst-first', filter: 'all' });
    expect(rows.find(r => r.speciesCode === 'amerob')!.markedForSwap).toBe(true);
    expect(rows.find(r => r.speciesCode === 'houspa')!.markedForSwap).toBe(false); // no decision row
  });

  it('markedForSwap is true for an approve decision (intended mapping; see note)', () => {
    db.prepare(`INSERT INTO photo_decision (species_code, action, decided_at) VALUES ('amerob','approve','2026-06-11T00:00:00Z')`).run();
    const rows = listOverview(db, { sort: 'worst-first', filter: 'all' });
    expect(rows.find(r => r.speciesCode === 'amerob')!.markedForSwap).toBe(true);
  });

  it('markedForSwap is false for a keep/deny decision', () => {
    db.prepare(`INSERT INTO photo_decision (species_code, action, decided_at) VALUES ('amerob','keep','2026-06-11T00:00:00Z')`).run();
    const rows = listOverview(db, { sort: 'worst-first', filter: 'all' });
    expect(rows.find(r => r.speciesCode === 'amerob')!.markedForSwap).toBe(false);
  });

  it('exposes reviewed status; seeded rows are reviewed=1', () => {
    const rows = listOverview(db, { sort: 'worst-first', filter: 'all' });
    expect(rows.every(r => r.reviewed === true)).toBe(true);
  });

  it('filter=unscored returns only rows with reviewed=0 (no current score yet)', () => {
    // newly-synced species: reviewed=0, no photo_score(role='current')
    db.prepare(`INSERT INTO photo_current (species_code,com_name,sci_name,family,url,attribution,license,content_hash,reviewed) VALUES ('bewwre','Bewick''s Wren','Thryomanes bewickii','troglodytidae','https://photos/bewwre.jpg','(c) E','cc0','hashE',0)`).run();
    const rows = listOverview(db, { sort: 'worst-first', filter: 'unscored' });
    expect(rows.map(r => r.speciesCode)).toEqual(['bewwre']);
    expect(rows[0]!.reviewed).toBe(false);
    expect(rows[0]!.overall).toBeNull();
  });
});

describe('getSwapView', () => {
  let db: Database.Database;
  beforeEach(() => { db = seedDb(); });
  afterEach(() => db.close());

  it('returns current + top candidate + ranked alternates', () => {
    // add a second, lower-scoring candidate
    db.prepare(`INSERT INTO photo_candidate (species_code,inat_id,photo_url,thumb_path,attribution,license,excluded,source_round) VALUES ('houspa',5002,'https://inat/5002.jpg','thumb-cache/5002.jpg','(c) D','cc0',0,1)`).run();
    db.prepare(`INSERT INTO photo_score (species_code,role,candidate_inat_id,content_hash,overall,verdict,criteria_json,flags_json,rationale,rubric_version,scored_at) VALUES ('houspa','candidate',5002,'hashD',61,'mediocre','{"framing":5,"subjectClarity":6,"liveness":7,"naturalness":6,"pose":5,"background":5,"lighting":6}','[]','ok','v1','2026-06-11T00:00:00Z')`).run();

    const view = getSwapView(db, 'houspa');
    expect(view).not.toBeNull();
    expect(view!.current.overall).toBe(18);
    expect(view!.proposed!.inatId).toBe(5001);       // 79 is top
    expect(view!.alternates.map(a => a.inatId)).toEqual([5001, 5002]); // votes desc
  });

  it('excludes excluded candidates from proposed + alternates', () => {
    db.prepare(`UPDATE photo_candidate SET excluded = 1 WHERE inat_id = 5001`).run();
    const view = getSwapView(db, 'houspa');
    expect(view!.proposed).toBeNull();
    expect(view!.alternates).toEqual([]);
  });

  it('returns null for unknown species', () => {
    expect(getSwapView(db, 'nope')).toBeNull();
  });
});

describe('writeDecision', () => {
  let db: Database.Database;
  beforeEach(() => { db = seedDb(); });
  afterEach(() => db.close());

  it('approve records the chosen candidate', () => {
    writeDecision(db, { speciesCode: 'houspa', action: 'approve', chosenCandidateId: 5001 });
    const row = db.prepare(`SELECT action, chosen_candidate_id, applied FROM photo_decision WHERE species_code='houspa'`).get() as { action: string; chosen_candidate_id: number; applied: number };
    expect(row.action).toBe('approve');
    expect(row.chosen_candidate_id).toBe(5001);
    expect(row.applied).toBe(0); // staged, not applied
  });

  it('keep records action=keep with no candidate', () => {
    writeDecision(db, { speciesCode: 'amerob', action: 'keep' });
    const row = db.prepare(`SELECT action, chosen_candidate_id FROM photo_decision WHERE species_code='amerob'`).get() as { action: string; chosen_candidate_id: number | null };
    expect(row.action).toBe('keep');
    expect(row.chosen_candidate_id).toBeNull();
  });

  it('re-deciding upserts on species_code (PK)', () => {
    writeDecision(db, { speciesCode: 'amerob', action: 'keep' });
    writeDecision(db, { speciesCode: 'amerob', action: 'approve', chosenCandidateId: 9 });
    const n = db.prepare(`SELECT COUNT(*) AS c FROM photo_decision WHERE species_code='amerob'`).get() as { c: number };
    expect(n.c).toBe(1);
  });
});

describe('denyAndAdvance', () => {
  let db: Database.Database;
  beforeEach(() => { db = seedDb(); });
  afterEach(() => db.close());

  it('advances to the next pre-scored alternate when one remains (no re-source)', () => {
    // second candidate, scored 61 — denying the top (5001) should advance to it
    db.prepare(`INSERT INTO photo_candidate (species_code,inat_id,photo_url,thumb_path,attribution,license,excluded,source_round) VALUES ('houspa',5002,'https://inat/5002.jpg','thumb-cache/5002.jpg','(c) D','cc0',0,1)`).run();
    db.prepare(`INSERT INTO photo_score (species_code,role,candidate_inat_id,content_hash,overall,verdict,criteria_json,flags_json,rationale,rubric_version,scored_at) VALUES ('houspa','candidate',5002,'hashD',61,'mediocre','{"framing":5,"subjectClarity":6,"liveness":7,"naturalness":6,"pose":5,"background":5,"lighting":6}','[]','ok','v1','2026-06-11T00:00:00Z')`).run();

    const input: DenyInput = {
      speciesCode: 'houspa',
      reason: 'top pick still too far',
      tags: ['still-distant'],
      excludeIds: [5001], // the shown candidate(s) the reviewer rejected
    };
    const out = denyAndAdvance(db, input);

    const dec = db.prepare(`SELECT action, deny_reason, deny_tags_json FROM photo_decision WHERE species_code='houspa'`).get() as { action: string; deny_reason: string; deny_tags_json: string };
    expect(dec.action).toBe('deny');
    expect(dec.deny_reason).toBe('top pick still too far');
    expect(JSON.parse(dec.deny_tags_json)).toEqual(['still-distant']);

    // 5001 is hidden; 5002 stays in the pool
    const excluded = db.prepare(`SELECT inat_id FROM photo_candidate WHERE species_code='houspa' AND excluded=1`).all() as { inat_id: number }[];
    expect(excluded.map(e => e.inat_id)).toEqual([5001]);

    // instant advance to the next already-scored alternate; no re-source queued
    expect(out.next!.inatId).toBe(5002);
    expect(out.next!.overall).toBe(61);
    expect(out.resourceRequested).toBe(false);
    const flag = db.prepare(`SELECT resource_requested FROM photo_decision WHERE species_code='houspa'`).get() as { resource_requested: number };
    expect(flag.resource_requested).toBe(0);

    // DenyContext is still surfaced for the route to log / future source-candidates run
    expect(out.denyContext).toEqual({ reason: 'top pick still too far', tags: ['still-distant'] });
  });

  it('sets resource_requested when the pre-scored pool is exhausted', () => {
    // seed has only candidate 5001 for houspa; denying it empties the pool
    const input: DenyInput = {
      speciesCode: 'houspa',
      reason: 'still too far and dim',
      tags: ['still-distant', 'too-dark'],
      excludeIds: [5001],
    };
    const out = denyAndAdvance(db, input);

    const excluded = db.prepare(`SELECT inat_id FROM photo_candidate WHERE species_code='houspa' AND excluded=1`).all() as { inat_id: number }[];
    expect(excluded.map(e => e.inat_id)).toEqual([5001]);

    // no scored alternate left → advance is null and the re-source flag is set
    expect(out.next).toBeNull();
    expect(out.resourceRequested).toBe(true);
    const flag = db.prepare(`SELECT resource_requested FROM photo_decision WHERE species_code='houspa'`).get() as { resource_requested: number };
    expect(flag.resource_requested).toBe(1);

    expect(out.denyContext).toEqual({ reason: 'still too far and dim', tags: ['still-distant', 'too-dark'] });
  });

  it('treats an unscored candidate as not a valid advance (pool effectively exhausted)', () => {
    // a non-excluded candidate exists but has NO photo_score row → not yet scored
    db.prepare(`INSERT INTO photo_candidate (species_code,inat_id,photo_url,thumb_path,attribution,license,excluded,source_round) VALUES ('houspa',5003,'https://inat/5003.jpg','thumb-cache/5003.jpg','(c) E','cc0',0,1)`).run();
    const out = denyAndAdvance(db, { speciesCode: 'houspa', reason: 'nope', tags: [], excludeIds: [5001] });
    expect(out.next).toBeNull();           // 5003 is unscored, so it can't be the instant advance
    expect(out.resourceRequested).toBe(true);
  });
});

describe('selectUnreviewed / markReviewed (scoring-pass cursor)', () => {
  let db: Database.Database;
  beforeEach(() => { db = seedDb(); });
  afterEach(() => db.close());

  it('selectUnreviewed returns up to `limit` reviewed=0 species', () => {
    db.prepare(`INSERT INTO photo_current (species_code,com_name,sci_name,family,url,attribution,license,content_hash,reviewed) VALUES ('bewwre','Bewick''s Wren','Thryomanes bewickii','troglodytidae','https://photos/bewwre.jpg','(c) E','cc0','hashE',0)`).run();
    db.prepare(`INSERT INTO photo_current (species_code,com_name,sci_name,family,url,attribution,license,content_hash,reviewed) VALUES ('bushti','Bushtit','Psaltriparus minimus','aegithalidae','https://photos/bushti.jpg','(c) F','cc0','hashF',0)`).run();
    // seeded amerob/houspa are reviewed=1, so only the two new rows qualify
    expect(selectUnreviewed(db, 10).map(r => r.speciesCode).sort()).toEqual(['bewwre', 'bushti']);
    expect(selectUnreviewed(db, 1).length).toBe(1); // limit is honored
  });

  it('markReviewed flips a row to reviewed=1 and drops it from the next select', () => {
    db.prepare(`INSERT INTO photo_current (species_code,com_name,sci_name,family,url,attribution,license,content_hash,reviewed) VALUES ('bewwre','Bewick''s Wren','Thryomanes bewickii','troglodytidae','https://photos/bewwre.jpg','(c) E','cc0','hashE',0)`).run();
    markReviewed(db, 'bewwre');
    const row = db.prepare(`SELECT reviewed FROM photo_current WHERE species_code='bewwre'`).get() as { reviewed: number };
    expect(row.reviewed).toBe(1);
    expect(selectUnreviewed(db, 10).map(r => r.speciesCode)).toEqual([]);
  });
});
