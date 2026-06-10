import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb } from './db.js';
import { insertCandidate, listCandidates } from './store.js';
import {
  getDecision, stageApprove, stageKeep, stageDeny,
  listPendingApplies, markApplied,
} from './decision.js';

let db: Database.Database;
beforeEach(() => {
  db = openDb(':memory:');
  insertCandidate(db, { speciesCode: 'amerob', inatId: 111, photoUrl: 'u1', thumbPath: 't1', attribution: 'a1', license: 'cc-by', sourceRound: 0 });
  insertCandidate(db, { speciesCode: 'amerob', inatId: 222, photoUrl: 'u2', thumbPath: 't2', attribution: 'a2', license: 'cc0', sourceRound: 0 });
});
afterEach(() => { db.close(); });

describe('decision state machine', () => {
  it('defaults to pending for an untouched species', () => {
    expect(getDecision(db, 'amerob').action).toBe('pending');
  });

  it('approve records the chosen candidate and stays unapplied', () => {
    stageApprove(db, 'amerob', 222);
    const d = getDecision(db, 'amerob');
    expect(d.action).toBe('approve');
    expect(d.chosenCandidateId).toBe(222);
    expect(d.applied).toBe(false);
  });

  it('keep-original records keep with no candidate', () => {
    stageKeep(db, 'amerob');
    const d = getDecision(db, 'amerob');
    expect(d.action).toBe('keep');
    expect(d.chosenCandidateId).toBeNull();
  });

  it('deny stores reason+tags, excludes the shown candidates, and returns the DenyContext', () => {
    const shown = listCandidates(db, 'amerob').map(c => c.inatId); // [111, 222]
    const ctx = stageDeny(db, 'amerob', {
      reason: 'all captive feeder shots, still too distant',
      tags: ['captive-feeder', 'still-distant'],
      shownInatIds: shown,
    });
    const d = getDecision(db, 'amerob');
    expect(d.action).toBe('deny');
    expect(d.denyReason).toContain('captive feeder');
    expect(d.denyTags).toEqual(['captive-feeder', 'still-distant']);
    // shown candidates are now excluded → off the next swap screen
    expect(listCandidates(db, 'amerob')).toEqual([]);
    // the returned DenyContext biases the re-source and excludes shown ids
    expect(ctx.reason).toContain('captive feeder');
    expect(ctx.tags).toEqual(['captive-feeder', 'still-distant']);
  });

  it('re-deciding overwrites the staged decision (PK species_code)', () => {
    stageApprove(db, 'amerob', 222);
    stageKeep(db, 'amerob');
    expect(getDecision(db, 'amerob').action).toBe('keep');
  });

  it('listPendingApplies returns only approved+unapplied; markApplied flips it', () => {
    stageApprove(db, 'amerob', 222);
    stageKeep(db, 'btbwar'); // keep is not an apply
    expect(listPendingApplies(db).map(d => d.speciesCode)).toEqual(['amerob']);
    markApplied(db, 'amerob');
    expect(listPendingApplies(db)).toEqual([]);
    expect(getDecision(db, 'amerob').applied).toBe(true);
  });
});
