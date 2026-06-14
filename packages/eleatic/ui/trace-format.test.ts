import { describe, it, expect } from 'vitest';
import { scoreBars, metricRow, traceHref } from './trace-format.js';

// trace-format.js holds the two render helpers SHARED by the side-drawer
// (drawer.js) and the trace explorer's right pane (trace-view.js#renderSpanDetail):
//   • scoreBars — lifted VERBATIM from drawer.js (0..1-clamped horizontal bars,
//     esc'd keys/values, a "No scores" empty note). Lifting it here is a pure
//     refactor: the drawer imports it instead of keeping a private copy, so its
//     behaviour is unchanged.
//   • metricRow — one <dl> row (label + value), or '' when the value is
//     absent ('' / undefined) so the caller can omit empty metric rows.
// Both are PURE strings and route every dynamic value through safe.js#esc — the
// trace blob is attacker-influenceable (the server exposes a write path), so an
// injected payload renders as inert text (the trace.test.ts / pretty.test.ts
// threat model). This sibling test is what makes knip auto-trace trace-format.js
// (so it needs NO knip ignore entry, unlike the browser-only page glue).

describe('scoreBars — 0..1-clamped horizontal bars (lifted from drawer.js)', () => {
  it('renders one score-row per entry with the key, a fill bar, and the raw value', () => {
    const out = scoreBars({ keep_agreement: 1, score_mae: 0.25 });
    expect((out.match(/class="score-row"/g) ?? []).length).toBe(2);
    expect(out).toContain('keep_agreement');
    expect(out).toContain('score_mae');
    // The fill width is the value as a 0..1 → percent.
    expect(out).toContain('width:100.0%');
    expect(out).toContain('width:25.0%');
    // The raw value is shown verbatim in the score-val cell.
    expect(out).toContain('>1<');
    expect(out).toContain('>0.25<');
  });

  it('clamps the fill width into 0..1 (a >1 or <0 value never overflows the track)', () => {
    const out = scoreBars({ over: 4, under: -2 });
    expect(out).toContain('width:100.0%'); // 4 clamped to 1
    expect(out).toContain('width:0.0%'); // -2 clamped to 0
    // …but the raw value text is preserved (only the BAR is clamped).
    expect(out).toContain('>4<');
    expect(out).toContain('>-2<');
  });

  it('treats a non-finite value as a 0-width bar', () => {
    const out = scoreBars({ nan: Number.NaN, inf: Number.POSITIVE_INFINITY });
    expect((out.match(/width:0\.0%/g) ?? []).length).toBe(2);
  });

  it('shows a "No scores" empty note for an empty object or undefined', () => {
    expect(scoreBars({})).toContain('No scores');
    expect(scoreBars(undefined)).toContain('No scores');
    expect(scoreBars({})).toContain('drawer-empty');
  });

  it('escapes a malicious key so an injected payload renders inert', () => {
    const out = scoreBars({ '"><img src=x onerror=alert(1)>': 0.5 });
    expect(out).toContain('&lt;'); // payload escaped
    expect(out).not.toContain('<img'); // no live element
    expect(out).not.toContain('onerror=alert(1)>');
  });
});

describe('metricRow — one <dl> row, omitted when the value is empty', () => {
  it('renders a <dt>/<dd> row for a present value', () => {
    const out = metricRow('Duration', '1.50s');
    expect(out).toContain('Duration');
    expect(out).toContain('1.50s');
    expect(out).toContain('<dt');
    expect(out).toContain('<dd');
  });

  it('renders a numeric value via esc', () => {
    const out = metricRow('Total tokens', 1884);
    expect(out).toContain('Total tokens');
    expect(out).toContain('1884');
  });

  it('returns "" for an absent value ("" or undefined) so the row is omitted', () => {
    expect(metricRow('Start', '')).toBe('');
    expect(metricRow('Start', undefined)).toBe('');
  });

  it('escapes both the label and the value', () => {
    const out = metricRow('<b>lbl</b>', '"><img onerror>');
    expect(out).toContain('&lt;b&gt;');
    expect(out).not.toContain('<img');
  });
});

describe('traceHref — the shareable /trace deep-link (run + row, no span)', () => {
  it('builds /trace?run=&row= with both components URL-encoded', () => {
    expect(traceHref('run-a', 'item-1')).toBe('/trace?run=run-a&row=item-1');
  });

  it('encodes special characters in both run and rowKey', () => {
    expect(traceHref('a b', 'x:y&z')).toBe('/trace?run=a%20b&row=x%3Ay%26z');
  });
});
