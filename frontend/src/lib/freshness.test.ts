/**
 * Tests for deriveFreshness — all 4 state transitions.
 *
 * The spec (docs/design/01-spec/voice-and-content.md §Freshness label state machine)
 * mandates specific label copy per state. Tests use a fixed `now` to ensure
 * deterministic assertions regardless of wall-clock time.
 *
 * Issue: #456 W3-A
 */
import { describe, it, expect } from 'vitest';
import { deriveFreshness } from './freshness.js';

const NOW = new Date('2026-05-11T15:00:00.000Z');
const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

describe('deriveFreshness — 5-state machine', () => {
  describe('empty state (null freshestObservationAt)', () => {
    it('returns empty (not error) when freshestObservationAt is null', () => {
      // null covers both empty-table and ingestor-failed; we map to 'empty' so
      // a legitimately empty post-migration table does not show alarming copy.
      const result = deriveFreshness(null, NOW);
      expect(result.state).toBe('empty');
    });

    it('returns an empty label string for empty state (suppressed display)', () => {
      const result = deriveFreshness(null, NOW);
      expect(result.label).toBe('');
    });

    it('does NOT return error state or alarming copy for null', () => {
      const result = deriveFreshness(null, NOW);
      expect(result.state).not.toBe('error');
      expect(result.label).not.toContain('Source unavailable');
    });
  });

  describe('fresh state (age ≤ 30 min)', () => {
    it('returns fresh for data exactly 15 minutes old', () => {
      const ts = new Date(NOW.getTime() - 15 * MINUTE_MS).toISOString();
      const result = deriveFreshness(ts, NOW);
      expect(result.state).toBe('fresh');
      expect(result.label).toBe('Updated 15 min ago · Source: eBird');
    });

    it('returns fresh for data 1 minute old', () => {
      const ts = new Date(NOW.getTime() - 1 * MINUTE_MS).toISOString();
      const result = deriveFreshness(ts, NOW);
      expect(result.state).toBe('fresh');
      expect(result.label).toBe('Updated 1 min ago · Source: eBird');
    });

    it('returns fresh for data exactly at the 30-min boundary', () => {
      const ts = new Date(NOW.getTime() - 30 * MINUTE_MS).toISOString();
      const result = deriveFreshness(ts, NOW);
      expect(result.state).toBe('fresh');
    });
  });

  describe('recent state (30 min < age ≤ 6 h)', () => {
    it('returns recent for data 2 hours old', () => {
      const ts = new Date(NOW.getTime() - 2 * HOUR_MS).toISOString();
      const result = deriveFreshness(ts, NOW);
      expect(result.state).toBe('recent');
      expect(result.label).toBe('Updated 2h ago · Source: eBird');
    });

    it('returns recent for data just past the 30-min threshold', () => {
      // 31 minutes = just over the fresh boundary
      const ts = new Date(NOW.getTime() - 31 * MINUTE_MS).toISOString();
      const result = deriveFreshness(ts, NOW);
      expect(result.state).toBe('recent');
    });

    it('returns recent for data exactly at the 6-h boundary', () => {
      const ts = new Date(NOW.getTime() - 6 * HOUR_MS).toISOString();
      const result = deriveFreshness(ts, NOW);
      expect(result.state).toBe('recent');
    });
  });

  describe('stale state (age > 6 h)', () => {
    it('returns stale for data 9 hours old', () => {
      const ts = new Date(NOW.getTime() - 9 * HOUR_MS).toISOString();
      const result = deriveFreshness(ts, NOW);
      expect(result.state).toBe('stale');
      expect(result.label).toBe('Last updated 9h ago · Source: eBird');
    });

    it('returns stale for data just past the 6-h threshold', () => {
      // 6h + 1ms
      const ts = new Date(NOW.getTime() - (6 * HOUR_MS + 1)).toISOString();
      const result = deriveFreshness(ts, NOW);
      expect(result.state).toBe('stale');
      expect(result.label).toMatch(/^Last updated/);
    });

    it('uses "Last updated" prefix (not "Updated") in stale label', () => {
      const ts = new Date(NOW.getTime() - 25 * HOUR_MS).toISOString();
      const result = deriveFreshness(ts, NOW);
      expect(result.state).toBe('stale');
      expect(result.label).toMatch(/^Last updated/);
      expect(result.label).not.toMatch(/^Updated/);
    });
  });

  describe('MapLede stale-period-drop reachability', () => {
    it('freshness=stale enables the period-clause-drop path in MapLede', () => {
      // The MapLede component drops the "in the last {period}" clause when
      // freshness === 'stale'. This test verifies that deriveFreshness returns
      // state === 'stale' for old data, making that branch reachable (#456 W3-A AC).
      const ts = new Date(NOW.getTime() - 9 * HOUR_MS).toISOString();
      const { state } = deriveFreshness(ts, NOW);
      expect(state).toBe('stale');
      // Simulate the MapLede branch:
      const periodClause = state === 'stale' ? '' : ' in the last 14 days';
      expect(periodClause).toBe('');
    });
  });
});
