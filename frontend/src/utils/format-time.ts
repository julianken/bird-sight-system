/**
 * Hand-rolled relative-time formatter for observation `obsDt` values.
 *
 * Buckets (measured by `now - iso`):
 *   - <60s            → "just now"
 *   - <60m            → "N min ago"
 *   - <24h            → "Nh ago"
 *   - 24–48h          → "yesterday"
 *   - <7d             → "Mon 3pm"  (short weekday + lowercase 12-hour clock)
 *   - <1 year         → "Apr 14"   (short month + day)
 *   - ≥1 year         → "2023-11-03" (ISO date)
 *
 * Implementation deliberately avoids `Intl.RelativeTimeFormat` — it is not
 * reliably polyfilled in jsdom (our test environment) and produces locale-
 * dependent strings that we cannot assert against without freezing the
 * locale. `Intl.DateTimeFormat` is also avoided for the same jsdom reason;
 * weekday and month names are spelled out inline instead.
 *
 * All absolute labels (Mon 3pm, Apr 14, 2023-11-03) use the caller's LOCAL
 * timezone via `getHours`/`getDate`/etc. The feed surface shows observation
 * times as "when the user is reading them", not "when the API serialised
 * them", so local is the right frame of reference.
 */

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const;

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function formatClockHour(date: Date): string {
  // 12-hour clock with lowercase am/pm and no leading zero. Minutes are
  // intentionally dropped — the <7d bucket only needs a rough time-of-day
  // marker ("Mon 3pm"), not wall-clock precision.
  const h24 = date.getHours();
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  const suffix = h24 < 12 ? 'am' : 'pm';
  return `${h12}${suffix}`;
}

export function formatRelativeTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  const deltaMs = now.getTime() - then.getTime();

  if (deltaMs < 60_000) {
    return 'just now';
  }
  if (deltaMs < HOUR_MS) {
    const mins = Math.floor(deltaMs / MINUTE_MS);
    return `${mins} min ago`;
  }
  if (deltaMs < DAY_MS) {
    const hours = Math.floor(deltaMs / HOUR_MS);
    return `${hours}h ago`;
  }
  if (deltaMs < 2 * DAY_MS) {
    return 'yesterday';
  }
  if (deltaMs < 7 * DAY_MS) {
    return `${WEEKDAYS[then.getDay()]} ${formatClockHour(then)}`;
  }
  // Year boundary — measured by elapsed days, not calendar year. A mid-
  // December observation read in mid-January stays in the "Dec 20" bucket
  // (~30 days) rather than flipping to an ISO date just because the year
  // rolled over. 365 is close enough; leap-year drift is irrelevant at this
  // grain. DO NOT swap this back to `getFullYear()`-based logic.
  if (deltaMs < 365 * DAY_MS) {
    return `${MONTHS[then.getMonth()]} ${then.getDate()}`;
  }
  return `${then.getFullYear()}-${pad2(then.getMonth() + 1)}-${pad2(then.getDate())}`;
}
