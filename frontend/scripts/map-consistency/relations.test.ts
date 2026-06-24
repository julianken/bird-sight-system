// frontend/scripts/map-consistency/relations.test.ts
import { describe, it, expect } from 'vitest';
import { evaluateSample, sumPointsInBbox, bboxInside, renderedFamilyCounts, renderedTotal } from './relations.js';
import type { Sample, ViewSnapshot, NetworkView, MarkerRead, Bbox, FilterBundle, Recapture } from './types.js';

const BB: Bbox = [-111, 31, -109, 33];

function net(p: Partial<NetworkView> & { bbox: Bbox; total: number; points: NetworkView['points'] }): NetworkView {
  return { mode: 'observations', zoom: 9, truncated: false, freshestObservationAt: 't0', familyCounts: [], speciesCount: null, ...p };
}
function marker(cells: { family: string; count: number }[], overflow = false): MarkerRead {
  const total = cells.reduce((s, c) => s + c.count, 0);
  return { kind: 'grid', total, markerTotal: total, familyCount: cells.length, cells, overflow };
}
/** A collapsed cluster-pill marker (kind:'pill', §5.2): a total count, no family cells. */
function pill(total: number, color = 'ember'): MarkerRead {
  return { kind: 'pill', total, color, markerTotal: total, familyCount: null, cells: [], overflow: false };
}
function view(o: Partial<ViewSnapshot> & { viewport: ViewSnapshot['viewport']; requestedZoom: number; network: NetworkView; markers: MarkerRead[] }): ViewSnapshot {
  return { url: `u${o.requestedZoom}-${o.viewport}`, scope: 'us', requestedCenter: { lng: -110, lat: 32 }, lede: { text: '', firstInt: null, unit: null }, legend: [], consoleErrors: [], consoleWarnings: [], ...o };
}
/** A minimal one-view sample for per-view relation tests. */
function sampleOf(v: ViewSnapshot, extra: Partial<Sample> = {}): Sample {
  return { id: 's', seedPoint: { lng: -110, lat: 32 }, scope: 'us', views: [v], ...extra };
}

describe('helpers', () => {
  it('sumPointsInBbox sums only points inside the box', () => {
    const pts = [{ lng: -110, lat: 32, count: 3 }, { lng: -120, lat: 40, count: 5 }];
    expect(sumPointsInBbox(pts, [-111, 31, -109, 33])).toBe(3);
  });
  it('bboxInside detects containment', () => {
    expect(bboxInside([-111, 31, -109, 33], [-120, 20, -100, 40])).toBe(true);
    expect(bboxInside([-130, 31, -109, 33], [-120, 20, -100, 40])).toBe(false);
  });
  it('renderedFamilyCounts sums cells across markers', () => {
    const v = view({ viewport: 'desktop', requestedZoom: 9, network: net({ bbox: [-111, 31, -109, 33], total: 0, points: [] }), markers: [marker([{ family: 'Hawks', count: 1 }]), marker([{ family: 'Hawks', count: 2 }, { family: 'Falcons', count: 1 }])] });
    expect(renderedFamilyCounts(v)).toEqual(expect.arrayContaining([{ family: 'Hawks', count: 3 }, { family: 'Falcons', count: 1 }]));
  });
  it('renderedTotal counts pill totals + grid cell counts (§5.2 — pills now count)', () => {
    // A pill (1164) + a grid (3 + 1) → 1168. Pills were previously invisible.
    const v = view({ viewport: 'desktop', requestedZoom: 4, network: net({ bbox: [-111, 31, -109, 33], total: 1168, points: [] }), markers: [pill(1164), marker([{ family: 'Hawks', count: 3 }, { family: 'Falcons', count: 1 }])] });
    expect(renderedTotal(v)).toBe(1168);
  });
});

describe('MR-8 parity (directional pill-collapse, #1270)', () => {
  it('flags mobile-renders / desktop-absent (the reported desktop pill-collapse bug)', () => {
    // Falcons is in both viewports' legends (so it's in `common`), renders on mobile
    // but NOT on desktop → desktop under-rendered the family → real bug, fails.
    const desktop = view({
      viewport: 'desktop', requestedZoom: 9, network: net({ bbox: BB, total: 5, points: [] }),
      legend: [{ family: 'Hawks', count: 2 }, { family: 'Falcons', count: 3 }],
      markers: [marker([{ family: 'Hawks', count: 2 }])],
    });
    const mobile = view({
      viewport: 'mobile', requestedZoom: 9, network: net({ bbox: BB, total: 5, points: [] }),
      legend: [{ family: 'Hawks', count: 2 }, { family: 'Falcons', count: 3 }],
      markers: [marker([{ family: 'Hawks', count: 2 }, { family: 'Falcons', count: 3 }])],
    });
    const fails = evaluateSample(sampleOf(desktop, { views: [desktop, mobile] })).filter((v) => v.relation === 'MR-8' && v.status === 'fail');
    expect(fails).toHaveLength(1);
    expect(fails[0].symptom).toContain('Falcons');
    expect(fails[0].symptom).toContain('NOT on desktop');
  });

  it('SUPPRESSES desktop-renders / mobile-absent (desktop’s larger 4×4 capacity, not a bug)', () => {
    // Falcons in both legends, renders on desktop but NOT mobile → desktop's bigger
    // grid legitimately surfaced the tail mobile's smaller grid drops. Directional
    // rule (#1270) suppresses this reverse direction → no MR-8 fail.
    const desktop = view({
      viewport: 'desktop', requestedZoom: 9, network: net({ bbox: BB, total: 5, points: [] }),
      legend: [{ family: 'Hawks', count: 2 }, { family: 'Falcons', count: 3 }],
      markers: [marker([{ family: 'Hawks', count: 2 }, { family: 'Falcons', count: 3 }])],
    });
    const mobile = view({
      viewport: 'mobile', requestedZoom: 9, network: net({ bbox: BB, total: 5, points: [] }),
      legend: [{ family: 'Hawks', count: 2 }, { family: 'Falcons', count: 3 }],
      markers: [marker([{ family: 'Hawks', count: 2 }])],
    });
    const fails = evaluateSample(sampleOf(desktop, { views: [desktop, mobile] })).filter((v) => v.relation === 'MR-8' && v.status === 'fail');
    expect(fails).toHaveLength(0);
  });

  it('suppresses a desktop-only-legend coastal family (viewport-coverage artifact #1269)', () => {
    // Albatrosses is in desktop's legend+render but NOT in mobile's legend (mobile's
    // narrower bbox never contained it). Excluded from `common` → no MR-8 fail.
    const desktop = view({
      viewport: 'desktop', requestedZoom: 4, network: net({ bbox: BB, total: 5, points: [] }),
      legend: [{ family: 'Hawks', count: 2 }, { family: 'Albatrosses', count: 1 }],
      markers: [marker([{ family: 'Hawks', count: 2 }, { family: 'Albatrosses', count: 1 }])],
    });
    const mobile = view({
      viewport: 'mobile', requestedZoom: 4, network: net({ bbox: BB, total: 2, points: [] }),
      legend: [{ family: 'Hawks', count: 2 }],
      markers: [marker([{ family: 'Hawks', count: 2 }])],
    });
    const fails = evaluateSample(sampleOf(desktop, { views: [desktop, mobile] })).filter((v) => v.relation === 'MR-8' && v.status === 'fail');
    expect(fails).toHaveLength(0);
  });
});

describe('MR-9 pill-split parity (the reported bug, §5.2)', () => {
  it('flags desktop-all-pill vs mobile-all-grid at the same camera (desktop under-splits)', () => {
    // Same camera (z6). Mobile splits every cluster into a grid (gridFraction 1.0);
    // desktop leaves every cluster as a pill (gridFraction 0.0). Δ 1.0 > MR9_THRESHOLD (0.12) → fail.
    const desktop = view({
      viewport: 'desktop', requestedZoom: 6, network: net({ mode: 'aggregated', bbox: BB, total: 3000, points: [] }),
      markers: [pill(1164), pill(820), pill(1016)],
    });
    const mobile = view({
      viewport: 'mobile', requestedZoom: 6, network: net({ mode: 'aggregated', bbox: BB, total: 3000, points: [] }),
      markers: [marker([{ family: 'Hawks', count: 12 }]), marker([{ family: 'Falcons', count: 8 }]), marker([{ family: 'Gulls', count: 5 }])],
    });
    const f = evaluateSample(sampleOf(desktop, { views: [desktop, mobile] })).filter((v) => v.relation === 'MR-9' && v.status === 'fail');
    expect(f).toHaveLength(1);
    expect(f[0].severity).toBe('high');
    expect(f[0].numbers).toMatchObject({ desktopGridFraction: 0, mobileGridFraction: 1 });
    expect(f[0].symptom).toContain('under-splits');
  });

  it('passes when both viewports split all clusters into grids (equal fractions)', () => {
    const desktop = view({
      viewport: 'desktop', requestedZoom: 6, network: net({ mode: 'aggregated', bbox: BB, total: 30, points: [] }),
      markers: [marker([{ family: 'Hawks', count: 12 }]), marker([{ family: 'Falcons', count: 8 }])],
    });
    const mobile = view({
      viewport: 'mobile', requestedZoom: 6, network: net({ mode: 'aggregated', bbox: BB, total: 30, points: [] }),
      markers: [marker([{ family: 'Hawks', count: 12 }]), marker([{ family: 'Falcons', count: 8 }])],
    });
    expect(evaluateSample(sampleOf(desktop, { views: [desktop, mobile] })).filter((v) => v.relation === 'MR-9' && v.status === 'fail')).toHaveLength(0);
  });

  it('suppresses the reverse direction (desktop splits MORE than mobile → not the bug)', () => {
    // Desktop all-grid, mobile all-pill. gap = mobileFraction(0) − desktopFraction(1) = −1 < threshold → pass.
    const desktop = view({
      viewport: 'desktop', requestedZoom: 6, network: net({ mode: 'aggregated', bbox: BB, total: 30, points: [] }),
      markers: [marker([{ family: 'Hawks', count: 12 }]), marker([{ family: 'Falcons', count: 8 }])],
    });
    const mobile = view({
      viewport: 'mobile', requestedZoom: 6, network: net({ mode: 'aggregated', bbox: BB, total: 3000, points: [] }),
      markers: [pill(1500), pill(1500)],
    });
    expect(evaluateSample(sampleOf(desktop, { views: [desktop, mobile] })).filter((v) => v.relation === 'MR-9' && v.status === 'fail')).toHaveLength(0);
  });

  it('passes with a carve-out when a viewport has no clusters (divide-by-zero guard)', () => {
    const desktop = view({ viewport: 'desktop', requestedZoom: 6, network: net({ bbox: BB, total: 0, points: [] }), markers: [] });
    const mobile = view({ viewport: 'mobile', requestedZoom: 6, network: net({ bbox: BB, total: 30, points: [] }), markers: [marker([{ family: 'Hawks', count: 30 }])] });
    const mr9 = evaluateSample(sampleOf(desktop, { views: [desktop, mobile] })).filter((v) => v.relation === 'MR-9');
    expect(mr9.every((v) => v.status === 'pass')).toBe(true);
    expect(mr9.some((v) => v.carveOuts?.includes('no-clusters'))).toBe(true);
  });
});

describe('MR-0 drill-down', () => {
  it('passes when same-mode drill-down conserves the count exactly', () => {
    const parent = view({ viewport: 'desktop', requestedZoom: 7, network: net({ bbox: [-112, 30, -108, 34], zoom: 7, total: 4, points: [{ lng: -110, lat: 32, count: 2 }, { lng: -110.5, lat: 32.1, count: 1 }, { lng: -120, lat: 40, count: 1 }] }), markers: [] });
    const child = view({ viewport: 'desktop', requestedZoom: 9, network: net({ bbox: [-111, 31, -109, 33], zoom: 9, total: 3, points: [] }), markers: [marker([{ family: 'Hawks', count: 3 }])] });
    const sample: Sample = { id: 's2', seedPoint: { lng: -110, lat: 32 }, scope: 'us', views: [parent, child] };
    expect(evaluateSample(sample).filter((v) => v.relation.startsWith('MR-0') && v.status === 'fail')).toHaveLength(0);
  });
  it('flags lost birds when child returns fewer than the parent counted in the child bbox', () => {
    const parent = view({ viewport: 'desktop', requestedZoom: 7, network: net({ bbox: [-112, 30, -108, 34], zoom: 7, total: 7, points: [{ lng: -110, lat: 32, count: 7 }] }), markers: [] });
    const child = view({ viewport: 'desktop', requestedZoom: 9, network: net({ bbox: [-111, 31, -109, 33], zoom: 9, total: 3, points: [] }), markers: [marker([{ family: 'Hawks', count: 3 }])] });
    const sample: Sample = { id: 's3', seedPoint: { lng: -110, lat: 32 }, scope: 'us', views: [parent, child] };
    const fail = evaluateSample(sample).find((v) => v.relation === 'MR-0a' && v.status === 'fail');
    expect(fail).toBeDefined();
    expect(fail!.numbers).toMatchObject({ expected: 7, actual: 3, delta: -4 });
  });
  it('tolerates aggregated-centroid jitter: a small loss within the band does not fire', () => {
    const parent = view({ viewport: 'desktop', requestedZoom: 4, network: net({ mode: 'aggregated', bbox: [-112, 30, -108, 34], zoom: 4, total: 20, points: [{ lng: -110, lat: 32, count: 20 }] }), markers: [] });
    const child = view({ viewport: 'desktop', requestedZoom: 5, network: net({ mode: 'aggregated', bbox: [-111, 31, -109, 33], zoom: 5, total: 18, points: [] }), markers: [marker([{ family: 'Hawks', count: 18 }])] });
    const sample: Sample = { id: 's4', seedPoint: { lng: -110, lat: 32 }, scope: 'us', views: [parent, child] };
    expect(evaluateSample(sample).filter((v) => v.relation.startsWith('MR-0') && v.status === 'fail')).toHaveLength(0);
  });
  it('MR-0b does NOT fire when a dense, grid-overflowing child renders fewer than conservation (rendered-capacity-limited)', () => {
    // Exact obs↔obs drill-down (same mode, untruncated, fresh-aligned → tol=0): the
    // parent counts ~600 inside the child bbox and the child returns 600, but the
    // adaptive grid only renders a 50-bird subset behind a "+N" overflow pill. MR-0a
    // (server-truth) conserves; MR-0b's rendered count is a lossy capacity subset, so
    // it must PASS with the carve-out — NOT false-fire a high-severity "lost 550".
    const parent = view({ viewport: 'desktop', requestedZoom: 7, network: net({ bbox: [-112, 30, -108, 34], zoom: 7, total: 600, points: [{ lng: -110, lat: 32, count: 600 }] }), markers: [] });
    const child = view({ viewport: 'desktop', requestedZoom: 10, network: net({ bbox: [-111, 31, -109, 33], zoom: 10, total: 600, points: [] }), markers: [marker([{ family: 'Hawks', count: 50 }], true)] });
    const sample: Sample = { id: 's5', seedPoint: { lng: -110, lat: 32 }, scope: 'us', views: [parent, child] };
    const verdicts = evaluateSample(sample);
    expect(verdicts.filter((v) => v.relation === 'MR-0b' && v.status === 'fail')).toHaveLength(0);
    const mr0b = verdicts.find((v) => v.relation === 'MR-0b');
    expect(mr0b?.status).toBe('pass');
    expect(mr0b?.carveOuts).toContain('rendered-capacity-limited');
    // MR-0a (server-truth) still conserves and passes too.
    expect(verdicts.filter((v) => v.relation === 'MR-0a' && v.status === 'fail')).toHaveLength(0);
  });
});

const fails = (s: Sample, rel: string) => evaluateSample(s).filter((v) => v.relation === rel && v.status === 'fail');

describe('MR-1 zoom non-vanishing', () => {
  it('flags network birds with nothing rendered', () => {
    const v = view({ viewport: 'desktop', requestedZoom: 12, network: net({ bbox: BB, total: 5, points: [] }), markers: [] });
    const f = fails(sampleOf(v), 'MR-1');
    expect(f).toHaveLength(1);
    expect(f[0].symptom).toContain('5 birds');
  });
  it('passes when birds render', () => {
    const v = view({ viewport: 'desktop', requestedZoom: 12, network: net({ bbox: BB, total: 5, points: [] }), legend: [{ family: 'Hawks', count: 5 }], markers: [marker([{ family: 'Hawks', count: 5 }])] });
    expect(fails(sampleOf(v), 'MR-1')).toHaveLength(0);
  });
  it('passes at low zoom when only cluster-pills render (§5.2 — pills are rendered, no false MR-1)', () => {
    // The literal false-fire: network served 1164 birds, the map shows a single
    // cluster-pill (no grid). Pre-§5.2 the capture read 0 markers → false MR-1.
    // Now the pill counts as rendered, so MR-1 must pass.
    const v = view({ viewport: 'mobile', requestedZoom: 4, network: net({ mode: 'aggregated', bbox: BB, total: 1164, points: [] }), markers: [pill(1164)] });
    expect(fails(sampleOf(v), 'MR-1')).toHaveLength(0);
  });
});

describe('MR-2 conservation law (Σlegend ≈ network.total ≈ lede)', () => {
  it('flags Σlegend diverging from network.total', () => {
    // legend sums to 100 but network served 7 → conservation broken.
    const v = view({ viewport: 'desktop', requestedZoom: 9, network: net({ bbox: BB, total: 7, points: [] }), legend: [{ family: 'Hawks', count: 100 }], markers: [marker([{ family: 'Hawks', count: 7 }])] });
    const f = fails(sampleOf(v), 'MR-2');
    expect(f).toHaveLength(1);
    expect(f[0].numbers).toMatchObject({ legendSum: 100, networkTotal: 7 });
  });
  it('flags the lede diverging from network.total', () => {
    const v = view({ viewport: 'desktop', requestedZoom: 9, network: net({ bbox: BB, total: 872, points: [] }), legend: [{ family: 'Hawks', count: 869 }], lede: { text: '500 sightings', firstInt: 500, unit: 'sightings' }, markers: [marker([{ family: 'Hawks', count: 255 }])] });
    const f = fails(sampleOf(v), 'MR-2');
    expect(f).toHaveLength(1);
    expect(f[0].symptom).toContain('lede 500');
  });
  it('PASSES the z9 conservation triple even though rendered is a lossy subset', () => {
    // Real prod shape (#1270): lede 872 = network 872, Σlegend 869 (within ε),
    // markers render only 255 (capacity). Old engine fired MR-2 here; now PASSES.
    const v = view({ viewport: 'desktop', requestedZoom: 9, network: net({ bbox: BB, total: 872, points: [] }), legend: [{ family: 'Hawks', count: 869 }], lede: { text: '872 sightings', firstInt: 872, unit: 'sightings' }, markers: [marker([{ family: 'Hawks', count: 255 }])] });
    expect(fails(sampleOf(v), 'MR-2')).toHaveLength(0);
  });
});

describe('MR-2b render-completeness (low-total render-loss catcher)', () => {
  it('flags render loss at a low total (total 7, rendered 3 — "says 7, shows 3")', () => {
    const v = view({ viewport: 'desktop', requestedZoom: 9, network: net({ bbox: BB, total: 7, points: [] }), legend: [{ family: 'Hawks', count: 7 }], markers: [marker([{ family: 'Hawks', count: 3 }])] });
    const f = fails(sampleOf(v), 'MR-2b');
    expect(f).toHaveLength(1);
    expect(f[0].numbers).toMatchObject({ networkTotal: 7, rendered: 3 });
  });
  it('passes a conserved low total (everything fits the grid)', () => {
    const v = view({ viewport: 'desktop', requestedZoom: 9, network: net({ bbox: BB, total: 7, points: [] }), legend: [{ family: 'Hawks', count: 7 }], markers: [marker([{ family: 'Hawks', count: 7 }])] });
    expect(fails(sampleOf(v), 'MR-2b')).toHaveLength(0);
  });
  it('SKIPS the capacity case at a high total (legend 601 / rendered 0 → PASS, not a fail)', () => {
    const v = view({ viewport: 'desktop', requestedZoom: 9, network: net({ bbox: BB, total: 601, points: [] }), legend: [{ family: 'Hawks', count: 601 }], markers: [] });
    expect(fails(sampleOf(v), 'MR-2b')).toHaveLength(0);
  });
  it('skips when an overflow pill is present (capacity-limited)', () => {
    const v = view({ viewport: 'mobile', requestedZoom: 9, network: net({ bbox: BB, total: 30, points: [] }), legend: [{ family: 'Hawks', count: 30 }], markers: [marker([{ family: 'Hawks', count: 3 }], true)] });
    expect(fails(sampleOf(v), 'MR-2b')).toHaveLength(0);
  });
});

describe('MR-3 server↔client per-family (aggregated mode only)', () => {
  it('flags a client legend family diverging from the server count (aggregated, same scope)', () => {
    // Σlegend (53) == network.total (53) → passes the scope guard; per-family then
    // fires: server Hawks 30 ≠ legend Hawks 23 (counts swapped between the two families).
    const v = view({ viewport: 'desktop', requestedZoom: 5, network: net({ mode: 'aggregated', bbox: BB, total: 53, points: [], familyCounts: [{ family: 'Hawks', count: 30 }, { family: 'Falcons', count: 23 }] }), legend: [{ family: 'Hawks', count: 23 }, { family: 'Falcons', count: 30 }], markers: [marker([{ family: 'Hawks', count: 23 }])] });
    const f = fails(sampleOf(v), 'MR-3');
    expect(f.length).toBeGreaterThanOrEqual(1);
    expect(f[0].symptom).toMatch(/Hawks|Falcons/);
  });
  it('passes when the legend matches the server per-family counts (aggregated)', () => {
    const v = view({ viewport: 'desktop', requestedZoom: 5, network: net({ mode: 'aggregated', bbox: BB, total: 53, points: [], familyCounts: [{ family: 'Hawks', count: 30 }, { family: 'Falcons', count: 23 }] }), legend: [{ family: 'Hawks', count: 30 }, { family: 'Falcons', count: 23 }], markers: [marker([{ family: 'Hawks', count: 30 }])] });
    expect(fails(sampleOf(v), 'MR-3')).toHaveLength(0);
  });
  it('SKIPS via the viewport-coverage guard when legend (viewport) ≠ network total (response)', () => {
    // The mobile-z4 artifact class (#1270 re-run): server familyCounts are national
    // (total 298) but the legend is the narrow viewport subset (30) → different scope,
    // skipped with a carve-out rather than fired as 100s of false per-family diffs.
    const v = view({ viewport: 'mobile', requestedZoom: 4, network: net({ mode: 'aggregated', bbox: BB, total: 298, points: [], familyCounts: [{ family: 'Hawks', count: 200 }, { family: 'Falcons', count: 98 }] }), legend: [{ family: 'Hawks', count: 30 }], markers: [marker([{ family: 'Hawks', count: 30 }])] });
    const v3 = evaluateSample(sampleOf(v)).filter((x) => x.relation === 'MR-3');
    expect(v3.every((x) => x.status === 'pass')).toBe(true);
    expect(v3.some((x) => x.carveOuts?.includes('viewport-coverage-mismatch'))).toBe(true);
  });
  it('SKIPS the capacity artifact: observations mode is a no-op pass (legend 601 / rendered 0)', () => {
    // Old engine compared legend vs rendered here and fired 317 capacity artifacts.
    const v = view({ viewport: 'desktop', requestedZoom: 9, network: net({ mode: 'observations', bbox: BB, total: 601, points: [] }), legend: [{ family: 'Hawks', count: 601 }], markers: [] });
    expect(fails(sampleOf(v), 'MR-3')).toHaveLength(0);
  });
});

describe('MR-4 filter consistency', () => {
  const baseUnfiltered = view({ viewport: 'desktop', requestedZoom: 7, network: net({ bbox: BB, total: 100, points: [] }), legend: [{ family: 'Hawks', count: 60 }, { family: 'Falcons', count: 40 }], markers: [] });
  const sinceView = (total: number) => view({ viewport: 'desktop', requestedZoom: 7, network: net({ bbox: BB, total, points: [] }), markers: [] });

  it('flags non-monotone since windows (1d > 7d)', () => {
    const bundle: FilterBundle = {
      unfiltered: baseUnfiltered,
      byFamily: [],
      bySince: [{ since: '1d', view: sinceView(80) }, { since: '7d', view: sinceView(30) }, { since: '14d', view: sinceView(50) }],
    };
    const s = sampleOf(baseUnfiltered, { filterBundle: bundle });
    const f = fails(s, 'MR-4');
    expect(f.some((x) => x.symptom?.includes('monotonicity'))).toBe(true);
  });

  it('flags a filtered family sum that diverges from the unfiltered legend', () => {
    const bundle: FilterBundle = {
      unfiltered: baseUnfiltered,
      byFamily: [{ family: 'Hawks', view: view({ viewport: 'desktop', requestedZoom: 7, network: net({ bbox: BB, total: 10, points: [] }), legend: [{ family: 'Hawks', count: 10 }], markers: [] }) }],
      bySince: [],
    };
    const s = sampleOf(baseUnfiltered, { filterBundle: bundle });
    expect(fails(s, 'MR-4').some((x) => x.symptom?.includes('family="Hawks"'))).toBe(true);
  });

  it('passes a consistent filtered family sum', () => {
    const bundle: FilterBundle = {
      unfiltered: baseUnfiltered,
      byFamily: [
        { family: 'Hawks', view: view({ viewport: 'desktop', requestedZoom: 7, network: net({ bbox: BB, total: 60, points: [] }), legend: [{ family: 'Hawks', count: 60 }], markers: [] }) },
        { family: 'Falcons', view: view({ viewport: 'desktop', requestedZoom: 7, network: net({ bbox: BB, total: 40, points: [] }), legend: [{ family: 'Falcons', count: 40 }], markers: [] }) },
      ],
      bySince: [{ since: '1d', view: sinceView(10) }, { since: '7d', view: sinceView(30) }, { since: '14d', view: sinceView(50) }],
    };
    const s = sampleOf(baseUnfiltered, { filterBundle: bundle });
    expect(fails(s, 'MR-4')).toHaveLength(0);
  });
});

describe('MR-5 lede vs viewport total (#1270)', () => {
  it('flags lede materially off the viewport network total', () => {
    const v = view({ viewport: 'desktop', requestedZoom: 9, network: net({ bbox: BB, total: 1000, points: [] }), lede: { text: '500 sightings', firstInt: 500, unit: 'sightings' }, markers: [] });
    const f = fails(sampleOf(v), 'MR-5');
    expect(f).toHaveLength(1);
    expect(f[0].numbers).toMatchObject({ ledeFirstInt: 500, networkTotal: 1000 });
  });
  it('passes when lede matches the viewport total within tolerance (prod z9: lede 872 = network 872)', () => {
    const v = view({ viewport: 'desktop', requestedZoom: 9, network: net({ bbox: BB, total: 872, points: [] }), lede: { text: '872 sightings', firstInt: 872, unit: 'sightings' }, markers: [] });
    expect(fails(sampleOf(v), 'MR-5')).toHaveLength(0);
  });
  it('carves out a species-unit lede (not comparable to a sightings total)', () => {
    const v = view({ viewport: 'desktop', requestedZoom: 9, network: net({ bbox: BB, total: 1000, points: [] }), lede: { text: '300 species', firstInt: 300, unit: 'species' }, markers: [] });
    expect(fails(sampleOf(v), 'MR-5')).toHaveLength(0);
  });
  it('skips a loading-placeholder lede (no parsed unit)', () => {
    const v = view({ viewport: 'desktop', requestedZoom: 9, network: net({ bbox: BB, total: 1000, points: [] }), markers: [] });
    expect(fails(sampleOf(v), 'MR-5')).toHaveLength(0);
  });
});

describe('MR-6 clean console', () => {
  it('flags a console error', () => {
    const v = view({ viewport: 'desktop', requestedZoom: 9, network: net({ bbox: BB, total: 0, points: [] }), markers: [], consoleErrors: ['TypeError: x is undefined'] });
    const f = fails(sampleOf(v), 'MR-6');
    expect(f).toHaveLength(1);
    expect(f[0].symptom).toContain('TypeError');
  });
  it('passes with a clean console', () => {
    const v = view({ viewport: 'desktop', requestedZoom: 9, network: net({ bbox: BB, total: 0, points: [] }), markers: [] });
    expect(fails(sampleOf(v), 'MR-6')).toHaveLength(0);
  });
});

describe('MR-7 idempotence', () => {
  const cap = (total: number, fresh = 't0') => view({ viewport: 'desktop', requestedZoom: 9, network: net({ bbox: BB, total, freshestObservationAt: fresh, points: [] }), markers: [marker([{ family: 'Hawks', count: total }])] });

  it('flags a re-capture whose network total drifts', () => {
    const rc: Recapture = { a: cap(50), b: cap(60) };
    const s = sampleOf(cap(50), { recaptures: [rc] });
    const f = fails(s, 'MR-7');
    expect(f).toHaveLength(1);
    expect(f[0].symptom).toContain('non-idempotent');
  });
  it('passes an identical re-capture', () => {
    const rc: Recapture = { a: cap(50), b: cap(50) };
    expect(fails(sampleOf(cap(50), { recaptures: [rc] }), 'MR-7')).toHaveLength(0);
  });
  it('downgrades drift to a freshness-skew note when freshest changed', () => {
    const rc: Recapture = { a: cap(50, 't0'), b: cap(60, 't1') };
    const verdicts = evaluateSample(sampleOf(cap(50), { recaptures: [rc] }));
    const mr7 = verdicts.filter((v) => v.relation === 'MR-7');
    expect(mr7.every((v) => v.status === 'pass')).toBe(true);
    expect(mr7.some((v) => v.carveOuts?.includes('freshness-skew'))).toBe(true);
  });
});
