// frontend/scripts/map-consistency/relations.test.ts
import { describe, it, expect } from 'vitest';
import { evaluateSample, sumPointsInBbox, bboxInside, renderedFamilyCounts } from './relations.js';
import type { Sample, ViewSnapshot, NetworkView, MarkerRead, Bbox } from './types.js';

function net(p: Partial<NetworkView> & { bbox: Bbox; total: number; points: NetworkView['points'] }): NetworkView {
  return { mode: 'observations', zoom: 9, truncated: false, freshestObservationAt: 't0', familyCounts: [], speciesCount: null, ...p };
}
function marker(cells: { family: string; count: number }[]): MarkerRead {
  return { markerTotal: cells.reduce((s, c) => s + c.count, 0), familyCount: cells.length, cells };
}
function view(o: Partial<ViewSnapshot> & { viewport: ViewSnapshot['viewport']; requestedZoom: number; network: NetworkView; markers: MarkerRead[] }): ViewSnapshot {
  return { url: `u${o.requestedZoom}-${o.viewport}`, scope: 'us', requestedCenter: { lng: -110, lat: 32 }, lede: { text: '', firstInt: null, unit: null }, legend: [], consoleErrors: [], consoleWarnings: [], ...o };
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

describe('MR-8 parity', () => {
  it('flags a family present on mobile but absent on desktop', () => {
    const bbox: Bbox = [-111, 31, -109, 33];
    const desktop = view({ viewport: 'desktop', requestedZoom: 9, network: net({ bbox, total: 2, points: [] }), markers: [marker([{ family: 'Hawks', count: 2 }])] });
    const mobile = view({ viewport: 'mobile', requestedZoom: 9, network: net({ bbox, total: 5, points: [] }), markers: [marker([{ family: 'Hawks', count: 2 }, { family: 'Falcons', count: 3 }])] });
    const sample: Sample = { id: 's1', seedPoint: { lng: -110, lat: 32 }, scope: 'us', views: [desktop, mobile] };
    const fails = evaluateSample(sample).filter((v) => v.relation === 'MR-8' && v.status === 'fail');
    expect(fails).toHaveLength(1);
    expect(fails[0].symptom).toContain('Falcons');
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
