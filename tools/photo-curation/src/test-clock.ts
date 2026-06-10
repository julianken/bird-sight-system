import type { Clock } from './pacing.js';

/**
 * A deterministic fake clock for unit tests. `sleep(ms)` advances a virtual
 * `now` WITHOUT a real timer and records each requested wait, so a suite that
 * asserts ≥1.1 s pacing runs in microseconds. `starts` records the virtual
 * timestamp at which each `Pacer.gate()`-driven call begins (read the value of
 * `now()` right after `gate()` to capture it; or use `sleeps` to assert the
 * exact waits requested).
 *
 * Test-only — imported by *.test.ts. (Knip ignore rule documents this so the
 * file isn't flagged as an orphan; see knip.ts.)
 */
export interface FakeClock extends Clock {
  /** Every sleep duration requested, in order. */
  sleeps: number[];
  /** The virtual current time (ms). */
  current: number;
}

/** Build a fake clock starting at `start` ms (default 0). */
export function makeFakeClock(start = 0): FakeClock {
  const clock: FakeClock = {
    current: start,
    sleeps: [],
    now() {
      return clock.current;
    },
    async sleep(ms: number) {
      clock.sleeps.push(ms);
      clock.current += ms;
    },
  };
  return clock;
}
