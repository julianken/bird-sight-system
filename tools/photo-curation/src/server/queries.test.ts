import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';

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

describe('seedDb helper', () => {
  let db: Database.Database;
  beforeEach(() => { db = seedDb(); });
  afterEach(() => db.close());

  it('seeds the canonical schema with the two current photos', () => {
    const n = db.prepare(`SELECT COUNT(*) AS c FROM photo_current`).get() as { c: number };
    expect(n.c).toBe(2);
  });
});
