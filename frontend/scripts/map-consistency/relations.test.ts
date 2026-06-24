// frontend/scripts/map-consistency/relations.test.ts
import { describe, it, expect } from 'vitest';
import { evaluateSample, sumPointsInBbox, bboxInside, renderedFamilyCounts } from './relations.js';
import type { Sample, ViewSnapshot, NetworkView, MarkerRead, Bbox, FilterBundle, Recapture } from './types.js';

const BB: Bbox = [-111, 31, -109, 33];

function net(p: Partial<NetworkView> & { bbox: Bbox; total: number; points: NetworkView['points'] }): NetworkView {
  return { mode: 'observations', zoom: 9, truncated: false, freshestObservationAt: 't0', familyCounts: [], speciesCount: null, ...p };
}
function marker(cells: { family: string; count: number }[], overflow = false): MarkerRead {
  return { markerTotal: cells.reduce((s, c) => s + c.count, 0), familyCount: cells.length, cells, overflow };
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
});

describe('MR-8 parity (viewport-coverage normalized)', () => {
  it('flags a family in BOTH legends that renders on only one side (genuine pill-collapse)', () => {
    // Falcons is in both viewports' legends (so it's in `common`) but renders only
    // on mobile → desktop dropped it → real bug, still fails.
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
  });

  it('suppresses a desktop-only-legend coastal family (viewport-coverage artifact #1269)', () => {
    // Albatrosses is in desktop's legend+render but NOT in mobile's legend (mobile's
    // narrower bbox never contained it). The pre-fix engine flagged this; now it's
    // excluded from `common` → no MR-8 fail.
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
});

describe('MR-2 stated vs rendered', () => {
  it('flags legend states more than markers render (says 7, shows 3)', () => {
    const v = view({ viewport: 'desktop', requestedZoom: 9, network: net({ bbox: BB, total: 7, points: [] }), legend: [{ family: 'Hawks', count: 7 }], markers: [marker([{ family: 'Hawks', count: 3 }])] });
    const f = fails(sampleOf(v), 'MR-2');
    expect(f).toHaveLength(1);
    expect(f[0].numbers).toMatchObject({ stated: 7, rendered: 3 });
  });
  it('passes with an overflow pill present (overflow legitimately hides families)', () => {
    const v = view({ viewport: 'mobile', requestedZoom: 9, network: net({ bbox: BB, total: 7, points: [] }), legend: [{ family: 'Hawks', count: 7 }], markers: [marker([{ family: 'Hawks', count: 3 }], true)] });
    expect(fails(sampleOf(v), 'MR-2')).toHaveLength(0);
  });
});

describe('MR-3 per-family conservation', () => {
  it('flags a legend family that renders no cell', () => {
    const v = view({ viewport: 'desktop', requestedZoom: 9, network: net({ bbox: BB, total: 5, points: [] }), legend: [{ family: 'Hawks', count: 3 }, { family: 'Falcons', count: 2 }], markers: [marker([{ family: 'Hawks', count: 3 }])] });
    const f = fails(sampleOf(v), 'MR-3');
    expect(f).toHaveLength(1);
    expect(f[0].symptom).toContain('Falcons');
  });
  it('passes when every legend family renders', () => {
    const v = view({ viewport: 'desktop', requestedZoom: 9, network: net({ bbox: BB, total: 5, points: [] }), legend: [{ family: 'Hawks', count: 3 }, { family: 'Falcons', count: 2 }], markers: [marker([{ family: 'Hawks', count: 3 }, { family: 'Falcons', count: 2 }])] });
    expect(fails(sampleOf(v), 'MR-3')).toHaveLength(0);
  });
  it('carves out overflow-hidden families', () => {
    const v = view({ viewport: 'mobile', requestedZoom: 9, network: net({ bbox: BB, total: 5, points: [] }), legend: [{ family: 'Hawks', count: 3 }, { family: 'Falcons', count: 2 }], markers: [marker([{ family: 'Hawks', count: 3 }], true)] });
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

describe('MR-5 lede vs scope total', () => {
  it('flags lede materially off the scope total', () => {
    const v = view({ viewport: 'desktop', requestedZoom: 9, network: net({ bbox: BB, total: 5, points: [] }), lede: { text: '500 sightings', firstInt: 500, unit: 'sightings' }, markers: [] });
    const f = fails(sampleOf(v, { scopeTotal: 1000 }), 'MR-5');
    expect(f).toHaveLength(1);
    expect(f[0].numbers).toMatchObject({ ledeFirstInt: 500, scopeTotal: 1000 });
  });
  it('passes when lede matches the scope total within tolerance', () => {
    const v = view({ viewport: 'desktop', requestedZoom: 9, network: net({ bbox: BB, total: 5, points: [] }), lede: { text: '1000 sightings', firstInt: 1000, unit: 'sightings' }, markers: [] });
    expect(fails(sampleOf(v, { scopeTotal: 1000 }), 'MR-5')).toHaveLength(0);
  });
  it('carves out a species-unit lede (not comparable to a sightings scope total)', () => {
    const v = view({ viewport: 'desktop', requestedZoom: 9, network: net({ bbox: BB, total: 5, points: [] }), lede: { text: '300 species', firstInt: 300, unit: 'species' }, markers: [] });
    expect(fails(sampleOf(v, { scopeTotal: 1000 }), 'MR-5')).toHaveLength(0);
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
