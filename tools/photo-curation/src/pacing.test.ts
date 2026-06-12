import { describe, it, expect } from 'vitest';
import {
  Pacer, withBackoff, isTransient, clampPool, CANDIDATE_POOL_CAP,
  INAT_PACE_MS, EDGE_PACE_MS,
} from './pacing.js';
import { makeFakeClock } from './test-clock.js';

describe('Pacer', () => {
  it('does NOT wait before the first call', async () => {
    const clock = makeFakeClock();
    const pacer = new Pacer(1100, clock);
    await pacer.gate();
    expect(clock.sleeps).toEqual([]); // no sleep before the first call
  });

  it('spaces successive calls by ≥ the min interval (asserted via the fake clock)', async () => {
    const clock = makeFakeClock();
    const pacer = new Pacer(1100, clock);

    const starts: number[] = [];
    // Three back-to-back gates with NO simulated work between them: the pacer
    // must sleep 1100 ms before calls 2 and 3.
    await pacer.gate(); starts.push(clock.now());
    await pacer.gate(); starts.push(clock.now());
    await pacer.gate(); starts.push(clock.now());

    expect(clock.sleeps).toEqual([1100, 1100]); // exactly two pacing waits
    // Each consecutive call begins ≥1100 ms after the previous.
    expect(starts[1]! - starts[0]!).toBeGreaterThanOrEqual(1100);
    expect(starts[2]! - starts[1]!).toBeGreaterThanOrEqual(1100);
  });

  it('only waits the REMAINDER when the call did real work in between', async () => {
    const clock = makeFakeClock();
    const pacer = new Pacer(1100, clock);
    await pacer.gate();
    // Simulate 400 ms of work (e.g. a slow download) before the next gate.
    clock.current += 400;
    await pacer.gate();
    // Only the remaining 700 ms is slept — not a full 1100.
    expect(clock.sleeps).toEqual([700]);
  });
});

describe('withBackoff', () => {
  it('retries transient (429/5xx) failures with jittered exponential backoff, then succeeds', async () => {
    const clock = makeFakeClock();
    let calls = 0;
    const fn = async () => {
      calls++;
      if (calls < 3) throw Object.assign(new Error('429'), { status: 429 });
      return 'ok';
    };
    // random()=1 → full ceiling each attempt: base*2^0=500, base*2^1=1000.
    const out = await withBackoff(fn, { clock, baseMs: 500, random: () => 1 });
    expect(out).toBe('ok');
    expect(calls).toBe(3);
    expect(clock.sleeps).toEqual([500, 1000]); // two backoff waits before success
  });

  it('does NOT retry a non-transient (4xx) error — surfaces immediately', async () => {
    const clock = makeFakeClock();
    let calls = 0;
    const fn = async () => {
      calls++;
      throw Object.assign(new Error('404'), { status: 404 });
    };
    await expect(withBackoff(fn, { clock })).rejects.toThrow(/404/);
    expect(calls).toBe(1); // no retry
    expect(clock.sleeps).toEqual([]);
  });

  it('gives up after maxRetries transient failures (so the caller can abort the species)', async () => {
    const clock = makeFakeClock();
    let calls = 0;
    const fn = async () => {
      calls++;
      throw Object.assign(new Error('503'), { status: 503 });
    };
    await expect(withBackoff(fn, { clock, maxRetries: 2, random: () => 0 })).rejects.toThrow(/503/);
    expect(calls).toBe(3); // initial + 2 retries
  });

  it('sleeps at least the server-provided retryDelayMs when the error carries one', async () => {
    const clock = makeFakeClock();
    let calls = 0;
    const fn = async () => {
      calls++;
      if (calls < 3) throw Object.assign(new Error('429'), { status: 429, retryDelayMs: 13_000 });
      return 'ok';
    };
    // random()=1 → jittered would be 500 then 1000 — both below the 13 s server hint.
    const out = await withBackoff(fn, { clock, baseMs: 500, random: () => 1 });
    expect(out).toBe('ok');
    expect(clock.sleeps).toEqual([13_000, 13_000]); // max(hint, jittered) = the hint
  });

  it('keeps the jittered backoff when it exceeds the server hint (max of the two)', async () => {
    const clock = makeFakeClock();
    let calls = 0;
    const fn = async () => {
      calls++;
      if (calls < 2) throw Object.assign(new Error('429'), { status: 429, retryDelayMs: 1_000 });
      return 'ok';
    };
    // random()=1, baseMs 2000 → jittered 2000 > the 1 s hint.
    const out = await withBackoff(fn, { clock, baseMs: 2_000, random: () => 1 });
    expect(out).toBe('ok');
    expect(clock.sleeps).toEqual([2_000]);
  });

  it('does not retry at all when the error is marked nonTransient (e.g. a daily-quota trip)', async () => {
    const clock = makeFakeClock();
    let calls = 0;
    const fn = async () => {
      calls++;
      throw Object.assign(new Error('Gemini 429 (…PerDay…)'), {
        status: 429,
        nonTransient: true,
        retryDelayMs: 38_000,
      });
    };
    await expect(withBackoff(fn, { clock })).rejects.toThrow(/429/);
    expect(calls).toBe(1); // a drained daily quota makes every retry pointless
    expect(clock.sleeps).toEqual([]);
  });
});

describe('isTransient', () => {
  it('classifies 429 and 5xx as transient, 4xx and others as not', () => {
    expect(isTransient({ status: 429 })).toBe(true);
    expect(isTransient({ status: 503 })).toBe(true);
    expect(isTransient({ status: 404 })).toBe(false);
    expect(isTransient(new Error('download 429 for https://x'))).toBe(true);
    expect(isTransient(new Error('read-api 502 for amerob'))).toBe(true);
    expect(isTransient(new Error('boom'))).toBe(false);
  });

  it('honors an explicit nonTransient marker — even over a 429 status or message', () => {
    expect(isTransient({ status: 429, nonTransient: true })).toBe(false);
    // The marker is checked FIRST: a 429-bearing message does not resurrect the retry.
    expect(isTransient(Object.assign(new Error('Gemini 429 (PerDay)'), { nonTransient: true }))).toBe(false);
  });
});

describe('clampPool', () => {
  it('caps the candidate pool to ~12 (and floors at 1)', () => {
    expect(clampPool(100)).toBe(CANDIDATE_POOL_CAP);
    expect(clampPool(12)).toBe(12);
    expect(clampPool(5)).toBe(5);
    expect(clampPool(0)).toBe(1);
    expect(clampPool(-3)).toBe(1);
  });
});

describe('pacing constants', () => {
  it('pace iNat + edge at ≥1000 ms (≤1 req/sec), with margin', () => {
    expect(INAT_PACE_MS).toBeGreaterThanOrEqual(1000);
    expect(EDGE_PACE_MS).toBeGreaterThanOrEqual(1100); // Cloudflare 60/min/IP
  });
});
