import { describe, it, expect, vi } from 'vitest';
import {
  PRICE_TABLE,
  blendedRate,
  computeRow,
  formatRow,
  spliceRowAboveMarker,
  hasRunId,
  runLogRun,
  APPEND_MARKER,
  type LedgerInput,
} from './token-ledger.js';

// ---------------------------------------------------------------------------
// blended-rate convention (85% input / 15% output) — anchored to #996's worked
// example "Fable 5 blended = $16/MTok".
// ---------------------------------------------------------------------------
describe('blendedRate', () => {
  it('prices Fable 5 at $16/MTok (0.85·$10 + 0.15·$50)', () => {
    expect(blendedRate('claude-fable-5')).toBeCloseTo(16, 10);
  });
  it('prices each model in the table from its input/output rates', () => {
    expect(blendedRate('claude-opus-4-8')).toBeCloseTo(0.85 * 5 + 0.15 * 25, 10); // $8
    expect(blendedRate('claude-sonnet-4-6')).toBeCloseTo(0.85 * 3 + 0.15 * 15, 10); // $4.80
    expect(blendedRate('claude-haiku-4-5')).toBeCloseTo(0.85 * 1 + 0.15 * 5, 10); // $1.60
  });
  it('throws on an unknown model so a typo never silently mis-prices a row', () => {
    expect(() => blendedRate('claude-unknown-9')).toThrow(/unknown model/i);
  });
});

const baseInput: LedgerInput = {
  runId: 'wonv0vigo',
  date: '2026-06-10',
  op: 'score_batch',
  judgeModel: 'claude-fable-5',
  agentDesign: 'generic',
  prefilter: 'no',
  itemsIn: 3,
  gateRejected: 0,
  agents: 3,
  totalTokens: 175_790,
  toolUses: 16,
  durationMs: 41_000,
  notes: 'first batches; Fable baseline (pre-#994)',
};

// ---------------------------------------------------------------------------
// computeRow — derived columns, blended path (reproduces the two seed rows
// already in #996).
// ---------------------------------------------------------------------------
describe('computeRow — blended path', () => {
  it('reproduces seed row 1 (3 items, 175,790 tok → $2.81 / $0.94)', () => {
    const r = computeRow(baseInput);
    expect(r.scored).toBe(3);
    expect(r.tokensPerItem).toBe(58_597); // 175790/3 = 58596.67 → round
    expect(r.estUsd).toBeCloseTo(2.8126, 4); // 175790 · 16/1e6
    expect(r.estUsdLabel).toBe('$2.81');
    expect(r.usdPerItemLabel).toBe('$0.94'); // 2.8126/3 = 0.9375 → $0.94
    expect(r.durS).toBe(41);
  });

  it('reproduces seed row 2 (10 items, 403,588 tok → $6.46 / $0.65)', () => {
    const r = computeRow({
      ...baseInput,
      runId: 'wtjxkbo07',
      itemsIn: 10,
      agents: 10,
      totalTokens: 403_588,
      toolUses: 30,
      durationMs: 28_000,
    });
    expect(r.scored).toBe(10);
    expect(r.tokensPerItem).toBe(40_359); // 403588/10 = 40358.8 → round
    expect(r.estUsdLabel).toBe('$6.46');
    expect(r.usdPerItemLabel).toBe('$0.65');
    expect(r.durS).toBe(28);
  });

  it('subtracts gate-rejected items from items_in to get scored', () => {
    const r = computeRow({ ...baseInput, itemsIn: 12, gateRejected: 4, prefilter: 'yes' });
    expect(r.scored).toBe(8);
    expect(r.tokensPerItem).toBe(Math.round(175_790 / 8));
  });

  it('applies the 0.5× batch discount to est_$ and $/item only', () => {
    const r = computeRow({ ...baseInput, batch: true });
    expect(r.estUsd).toBeCloseTo(2.8126 / 2, 4); // half price
    expect(r.estUsdLabel).toBe('$1.41');
    expect(r.usdPerItemLabel).toBe('$0.47');
    expect(r.tokensPerItem).toBe(58_597); // token count is unaffected by batch
  });

  it('prices a Haiku run at the Haiku blended rate ($1.60/MTok)', () => {
    const r = computeRow({ ...baseInput, judgeModel: 'claude-haiku-4-5' });
    expect(r.estUsd).toBeCloseTo(175_790 * 1.6 / 1e6, 6);
  });
});

// ---------------------------------------------------------------------------
// computeRow — exact split path (the four Anthropic buckets).
// ---------------------------------------------------------------------------
describe('computeRow — exact split path', () => {
  it('prices each bucket at its own Fable rate (input/output/cache-read/cache-create)', () => {
    // 100k input + 10k output + 50k cache-read + 20k cache-create, Fable 5.
    const r = computeRow({
      ...baseInput,
      split: { input: 100_000, output: 10_000, cacheRead: 50_000, cacheCreate: 20_000 },
    });
    // input 100k·$10 + output 10k·$50 + cacheRead 50k·$1 + cacheCreate(5m write) 20k·$12.50, all /1e6
    const expected =
      (100_000 * 10 + 10_000 * 50 + 50_000 * 1 + 20_000 * 12.5) / 1e6;
    expect(r.estUsd).toBeCloseTo(expected, 6);
    expect(r.exact).toBe(true);
  });

  it('halves the exact cost under --batch', () => {
    const split = { input: 100_000, output: 10_000, cacheRead: 0, cacheCreate: 0 };
    const full = computeRow({ ...baseInput, split });
    const batched = computeRow({ ...baseInput, split, batch: true });
    expect(batched.estUsd).toBeCloseTo(full.estUsd / 2, 8);
  });

  it('marks blended rows exact=false', () => {
    expect(computeRow(baseInput).exact).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// formatRow — the markdown cell layout (17 columns, matching #996's header).
// ---------------------------------------------------------------------------
describe('formatRow', () => {
  it('emits a 17-column pipe row matching the seed-row layout', () => {
    const row = formatRow(computeRow(baseInput));
    expect(row).toBe(
      '| wonv0vigo | 2026-06-10 | score_batch | claude-fable-5 | generic | no | 3 | 0 | 3 | 3 | 175,790 | 16 | 41 | 58,597 | $2.81 | $0.94 | first batches; Fable baseline (pre-#994) |',
    );
  });

  it('annotates exact-split rows in notes so a reader knows est_$ is not blended', () => {
    const row = formatRow(
      computeRow({ ...baseInput, split: { input: 1000, output: 100, cacheRead: 0, cacheCreate: 0 }, notes: 'exact run' }),
    );
    expect(row).toContain('exact run');
    expect(row).toMatch(/exact \$/i);
  });

  it('thousands-separates big token counts and leaves notes empty-safe', () => {
    const row = formatRow(computeRow({ ...baseInput, notes: undefined }));
    expect(row).toContain('| 175,790 |');
    expect(row.endsWith('|  |')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// spliceRowAboveMarker / hasRunId — marker-splice against a fixture body.
// ---------------------------------------------------------------------------
const FIXTURE_BODY = [
  '## Ledger',
  '',
  '| run_id | date | op |',
  '|---|---|---|',
  '| existingrun | 2026-06-09 | score_batch |',
  '<!-- APPEND-ROWS-ABOVE-THIS-LINE -->',
  '',
  '## Column legend',
].join('\n');

describe('spliceRowAboveMarker', () => {
  it('inserts the new row on the line directly above the marker', () => {
    const out = spliceRowAboveMarker(FIXTURE_BODY, '| newrun | 2026-06-10 | score_batch |');
    const lines = out.split('\n');
    const markerIdx = lines.indexOf(APPEND_MARKER);
    expect(lines[markerIdx - 1]).toBe('| newrun | 2026-06-10 | score_batch |');
    // the prior last row is preserved immediately above the new one
    expect(lines[markerIdx - 2]).toBe('| existingrun | 2026-06-09 | score_batch |');
  });

  it('throws when the marker is absent (refuses to guess an insert point)', () => {
    expect(() => spliceRowAboveMarker('no marker here', '| x |')).toThrow(/marker/i);
  });
});

describe('hasRunId', () => {
  it('detects an existing run_id as the first cell of a row', () => {
    expect(hasRunId(FIXTURE_BODY, 'existingrun')).toBe(true);
  });
  it('returns false for a run_id not present', () => {
    expect(hasRunId(FIXTURE_BODY, 'newrun')).toBe(false);
  });
  it('does not match a run_id that only appears inside notes', () => {
    const body = FIXTURE_BODY.replace('| existingrun |', '| realrun | 2026-06-09 | note about existingrun |');
    expect(hasRunId(body, 'existingrun')).toBe(false);
    expect(hasRunId(body, 'realrun')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// runLogRun — orchestration with injected read/write (no GitHub).
// ---------------------------------------------------------------------------
describe('runLogRun', () => {
  it('reads the body, splices one computed row, and writes it back', async () => {
    const readIssueBody = vi.fn().mockResolvedValue(FIXTURE_BODY);
    const writeIssueBody = vi.fn().mockResolvedValue(undefined);
    const log = vi.fn();

    const result = await runLogRun(baseInput, { readIssueBody, writeIssueBody, log });

    expect(result.appended).toBe(true);
    expect(writeIssueBody).toHaveBeenCalledOnce();
    const written = writeIssueBody.mock.calls[0][0] as string;
    const lines = written.split('\n');
    const markerIdx = lines.indexOf(APPEND_MARKER);
    expect(lines[markerIdx - 1]).toContain('| wonv0vigo |');
    expect(lines[markerIdx - 1]).toContain('$2.81');
  });

  it('warns and does NOT write when the run_id already exists (idempotent-ish)', async () => {
    const dupBody = spliceRowAboveMarker(FIXTURE_BODY, formatRow(computeRow(baseInput)));
    const readIssueBody = vi.fn().mockResolvedValue(dupBody);
    const writeIssueBody = vi.fn().mockResolvedValue(undefined);
    const log = vi.fn();

    const result = await runLogRun(baseInput, { readIssueBody, writeIssueBody, log });

    expect(result.appended).toBe(false);
    expect(writeIssueBody).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/already exists/i));
  });

  it('PRICE_TABLE carries all four priced models', () => {
    expect(Object.keys(PRICE_TABLE).sort()).toEqual(
      ['claude-fable-5', 'claude-haiku-4-5', 'claude-opus-4-8', 'claude-sonnet-4-6'].sort(),
    );
  });
});
