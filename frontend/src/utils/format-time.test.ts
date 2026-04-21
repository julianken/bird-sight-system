import { describe, it, expect } from 'vitest';
import { formatRelativeTime } from './format-time.js';

// The reference instant is constructed from LOCAL components so the bucket
// boundaries (especially "Mon 3pm" for the <7d case) are deterministic in
// any runner timezone (macOS dev = America/Phoenix; GitHub Actions = UTC).
// Using `new Date(y, m, d, h, min)` builds a local-time Date; its underlying
// UTC ms shifts with the runner TZ but the local components we format against
// do not.
const NOW = new Date(2026, 3, 15, 15, 0, 0, 0); // 2026-04-15 15:00 local (Wed)

describe('formatRelativeTime', () => {
  it('returns "just now" when the delta is under 60 seconds', () => {
    const iso = new Date(NOW.getTime() - 45_000).toISOString();
    expect(formatRelativeTime(iso, NOW)).toBe('just now');
  });

  it('returns "N min ago" when the delta is under 60 minutes', () => {
    const iso = new Date(NOW.getTime() - 15 * 60_000).toISOString();
    expect(formatRelativeTime(iso, NOW)).toBe('15 min ago');
  });

  it('returns "Nh ago" when the delta is under 24 hours', () => {
    const iso = new Date(NOW.getTime() - 5 * 60 * 60_000).toISOString();
    expect(formatRelativeTime(iso, NOW)).toBe('5h ago');
  });

  it('returns "yesterday" for 24–48 hours ago', () => {
    const iso = new Date(NOW.getTime() - 30 * 60 * 60_000).toISOString();
    expect(formatRelativeTime(iso, NOW)).toBe('yesterday');
  });

  it('returns a weekday + hour label (e.g. "Mon 3pm") for under 7 days', () => {
    // 2 days before NOW at the same local clock time → Monday 3pm.
    const iso = new Date(2026, 3, 13, 15, 0, 0, 0).toISOString();
    expect(formatRelativeTime(iso, NOW)).toBe('Mon 3pm');
  });

  it('returns a "Mon DD" label for under 1 year', () => {
    // Same calendar year as NOW but >7 days old → "Apr 1".
    const iso = new Date(2026, 3, 1, 9, 0, 0, 0).toISOString();
    expect(formatRelativeTime(iso, NOW)).toBe('Apr 1');
  });

  it('returns an ISO date (YYYY-MM-DD) for >1 year old', () => {
    const iso = new Date(2023, 10, 3, 12, 0, 0, 0).toISOString();
    expect(formatRelativeTime(iso, NOW)).toBe('2023-11-03');
  });
});
