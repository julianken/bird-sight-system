import { describe, it, expect } from 'vitest';
import { formatMetric, FORMATTERS, evalGate, mapPoints } from './format.js';

// ── Metric formatter registry ────────────────────────────────────────────────
//
// The hub looks up a per-metric formatter name from /config.js (e.g.
// { agreement: 'percent', totalCost: 'usd' }) and renders the cell with it.
// The four named formatters mirror photo-curation's inline pct()/usd() plus the
// generic raw/integer fallbacks eleatic adds (it invents no domain — an
// unconfigured metric renders raw).

describe('formatMetric registry', () => {
  it('percent renders a 0–1 fraction as a one-decimal percent (matches photo-curation pct)', () => {
    expect(formatMetric(0.9067, 'percent')).toBe('90.7%');
    expect(formatMetric(0, 'percent')).toBe('0.0%');
    expect(formatMetric(1, 'percent')).toBe('100.0%');
  });

  it('usd renders a number as a two-decimal dollar amount (matches photo-curation usd)', () => {
    expect(formatMetric(0.12, 'usd')).toBe('$0.12');
    expect(formatMetric(270, 'usd')).toBe('$270.00');
  });

  it('integer renders a rounded count with no decimals', () => {
    expect(formatMetric(5, 'integer')).toBe('5');
    expect(formatMetric(4.6, 'integer')).toBe('5');
    expect(formatMetric(150, 'integer')).toBe('150');
  });

  it('raw renders the number stringified, untouched', () => {
    expect(formatMetric(0.904, 'raw')).toBe('0.904');
    expect(formatMetric(42, 'raw')).toBe('42');
  });

  it('an unknown formatter name falls back to raw (no domain assumption)', () => {
    expect(formatMetric(0.5, 'no-such-formatter')).toBe('0.5');
    expect(formatMetric(0.5, undefined)).toBe('0.5');
  });

  it('a missing / non-numeric value renders an em dash, not NaN', () => {
    expect(formatMetric(undefined, 'percent')).toBe('—');
    expect(formatMetric(null, 'usd')).toBe('—');
    expect(formatMetric(Number.NaN, 'integer')).toBe('—');
  });

  it('exposes the four named formatters', () => {
    expect(Object.keys(FORMATTERS).sort()).toEqual(['integer', 'percent', 'raw', 'usd']);
  });
});

// ── Gate evaluator ────────────────────────────────────────────────────────────
//
// A configurable {metric, op, threshold} predicate over a run's metrics object.
// Generalizes photo-curation's hard-coded `agreement >= 0.90` (PASS/fail). The
// fraction contract is preserved: gte 0.9 on a 0–1 fraction, NOT >= 90.

describe('evalGate', () => {
  const gate = { metric: 'agreement', op: 'gte', threshold: 0.9 };

  it('PASS when the run meets a gte threshold (the 0.90 fraction contract)', () => {
    expect(evalGate(gate, { agreement: 0.9067 })).toBe('PASS');
    expect(evalGate(gate, { agreement: 0.9 })).toBe('PASS');
  });

  it('fail when the run is below a gte threshold', () => {
    expect(evalGate(gate, { agreement: 0.7867 })).toBe('fail');
  });

  it('supports every comparison op', () => {
    expect(evalGate({ metric: 'm', op: 'gt', threshold: 1 }, { m: 2 })).toBe('PASS');
    expect(evalGate({ metric: 'm', op: 'gt', threshold: 1 }, { m: 1 })).toBe('fail');
    expect(evalGate({ metric: 'm', op: 'lt', threshold: 1 }, { m: 0.5 })).toBe('PASS');
    expect(evalGate({ metric: 'm', op: 'lte', threshold: 1 }, { m: 1 })).toBe('PASS');
    expect(evalGate({ metric: 'm', op: 'eq', threshold: 3 }, { m: 3 })).toBe('PASS');
    expect(evalGate({ metric: 'm', op: 'ne', threshold: 3 }, { m: 4 })).toBe('PASS');
    expect(evalGate({ metric: 'm', op: 'ne', threshold: 3 }, { m: 3 })).toBe('fail');
  });

  it('returns undefined (no badge) when no gate is configured', () => {
    expect(evalGate(undefined, { agreement: 0.9 })).toBeUndefined();
  });

  it('returns undefined when the gated metric is absent from the run', () => {
    expect(evalGate(gate, { somethingElse: 1 })).toBeUndefined();
    expect(evalGate(gate, {})).toBeUndefined();
    expect(evalGate(gate, undefined)).toBeUndefined();
  });
});

// ── Inline-SVG point mapper ─────────────────────────────────────────────────
//
// Maps a list of {x:index, y:value} data points into a viewBox coordinate
// space for a <polyline>. Pure: no DOM. y is inverted (SVG y grows downward,
// so the max value sits at the top = a small y). min/max scaling fits the data
// to the box height with a configurable padding inset.

describe('mapPoints', () => {
  const box = { width: 100, height: 40, pad: 4 };

  it('maps a normal series across the full plot width and inverts y', () => {
    const pts = mapPoints([0, 0.5, 1], box);
    // 3 points → x at pad, mid, width-pad.
    expect(pts.map((p) => p.x)).toEqual([4, 50, 96]);
    // y inverted: max value (1) → top (y = pad), min value (0) → bottom (height - pad).
    expect(pts[0].y).toBe(36); // value 0 → bottom
    expect(pts[2].y).toBe(4); // value 1 → top
    // mid value (0.5) → vertical center.
    expect(pts[1].y).toBeCloseTo(20, 5);
  });

  it('handles an empty series → no points (caller renders an empty-state)', () => {
    expect(mapPoints([], box)).toEqual([]);
  });

  it('handles a single point → centered horizontally, vertically centered (flat domain)', () => {
    const pts = mapPoints([0.42], box);
    expect(pts).toHaveLength(1);
    // Single x → horizontal center of the plot area.
    expect(pts[0].x).toBe(50);
    // A flat (min === max) domain can't scale; the point sits at the vertical center.
    expect(pts[0].y).toBeCloseTo(20, 5);
  });

  it('handles a flat multi-point series (all equal) → all at vertical center', () => {
    const pts = mapPoints([0.5, 0.5, 0.5], box);
    expect(pts.map((p) => p.y)).toEqual([20, 20, 20]);
    expect(pts.map((p) => p.x)).toEqual([4, 50, 96]);
  });

  it('skips gaps (null/undefined values are dropped, x index preserved for the rest)', () => {
    // Points with a missing value are omitted; the surviving points keep their
    // index-based x so the polyline does not lie about position.
    const pts = mapPoints([0, null, 1], box);
    expect(pts).toHaveLength(2);
    expect(pts[0].x).toBe(4); // index 0
    expect(pts[1].x).toBe(96); // index 2 (the gap at index 1 is preserved)
  });
});
