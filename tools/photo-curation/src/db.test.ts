import { describe, it, expect, afterEach } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { openDb } from './db.js';
import type Database from 'better-sqlite3';

let db: Database.Database | undefined;
afterEach(() => { db?.close(); db = undefined; });

function columns(d: Database.Database, table: string): string[] {
  return (d.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[])
    .map(r => r.name);
}

describe('openDb', () => {
  it('creates the four contract tables', () => {
    db = openDb(':memory:');
    const tables = (db.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`
    ).all() as { name: string }[]).map(r => r.name);
    expect(tables).toEqual(
      expect.arrayContaining([
        'photo_candidate', 'photo_current', 'photo_decision', 'photo_score',
      ]),
    );
  });

  it('photo_current has the exact contract columns', () => {
    db = openDb(':memory:');
    expect(columns(db, 'photo_current')).toEqual([
      'species_code', 'com_name', 'sci_name', 'family',
      'url', 'attribution', 'license', 'content_hash', 'reviewed',
    ]);
  });

  it('photo_decision has the exact contract columns (incl. resource_requested)', () => {
    db = openDb(':memory:');
    expect(columns(db, 'photo_decision')).toEqual([
      'species_code', 'action', 'chosen_candidate_id', 'deny_reason',
      'deny_tags_json', 'decided_at', 'applied', 'applied_at', 'resource_requested',
    ]);
  });

  it('photo_current.reviewed defaults to 0 (not-yet-AI-scored)', () => {
    db = openDb(':memory:');
    db.prepare(
      `INSERT INTO photo_current (species_code) VALUES (?)`
    ).run('amerob');
    const row = db.prepare(
      `SELECT reviewed FROM photo_current WHERE species_code = ?`
    ).get('amerob') as { reviewed: number };
    expect(row.reviewed).toBe(0);
  });

  it('photo_decision defaults applied=0 and exposes the four-action shape', () => {
    db = openDb(':memory:');
    db.prepare(
      `INSERT INTO photo_decision (species_code, action) VALUES (?, ?)`
    ).run('amerob', 'pending');
    const row = db.prepare(
      `SELECT action, applied FROM photo_decision WHERE species_code = ?`
    ).get('amerob') as { action: string; applied: number };
    expect(row.action).toBe('pending');
    expect(row.applied).toBe(0);
  });

  it('is idempotent — re-opening the SAME store re-runs the schema without throwing', () => {
    const p = path.join(os.tmpdir(), `idem-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`);
    try {
      db = openDb(p);
      const count = (d: Database.Database) => (d.prepare(
        `SELECT COUNT(*) c FROM sqlite_master WHERE type='table'`,
      ).get() as { c: number }).c;
      const before = count(db);
      db.close();
      // Second open hits CREATE TABLE IF NOT EXISTS against the EXISTING schema.
      db = undefined;
      let db2: Database.Database | undefined;
      expect(() => { db2 = openDb(p); }).not.toThrow();
      expect(count(db2!)).toBe(before);
      db2!.close();
    } finally {
      for (const ext of ['', '-journal', '-wal', '-shm']) {
        try { fs.rmSync(p + ext); } catch { /* ignore */ }
      }
    }
  });
});
