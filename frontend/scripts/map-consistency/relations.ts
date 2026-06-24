// frontend/scripts/map-consistency/relations.ts
// Pure metamorphic-relation engine (epic #1266). NO browser imports.
import type { Bbox, FamilyCount, GeoPoint, Sample, ViewSnapshot, Verdict } from './types.js';

// MR-0 drill-down tolerance is computed inline (checkDrillDown): exact (0) only
// for observations↔observations; banded when aggregated/cross-mode/truncated.

export function bboxContainsPoint(b: Bbox, lng: number, lat: number): boolean {
  return lng >= b[0] && lng <= b[2] && lat >= b[1] && lat <= b[3];
}
export function bboxInside(inner: Bbox, outer: Bbox, eps = 1e-6): boolean {
  return inner[0] >= outer[0] - eps && inner[1] >= outer[1] - eps && inner[2] <= outer[2] + eps && inner[3] <= outer[3] + eps;
}
export function sumPointsInBbox(points: GeoPoint[], b: Bbox): number {
  let s = 0;
  for (const p of points) if (bboxContainsPoint(b, p.lng, p.lat)) s += p.count;
  return s;
}
export function renderedFamilyCounts(view: ViewSnapshot): FamilyCount[] {
  const m = new Map<string, number>();
  for (const mk of view.markers) for (const c of mk.cells) m.set(c.family, (m.get(c.family) ?? 0) + c.count);
  return [...m].map(([family, count]) => ({ family, count }));
}
export function renderedTotal(view: ViewSnapshot): number {
  return view.markers.reduce((s, mk) => s + mk.cells.reduce((c, cell) => c + cell.count, 0), 0);
}
function familyMap(fcs: FamilyCount[]): Map<string, number> {
  return new Map(fcs.map((f) => [f.family, f.count]));
}

// ── MR-8: desktop ↔ mobile parity ────────────────────────────────────────────
export function checkParity(desktop: ViewSnapshot, mobile: ViewSnapshot): Verdict[] {
  const d = familyMap(renderedFamilyCounts(desktop));
  const m = familyMap(renderedFamilyCounts(mobile));
  const verdicts: Verdict[] = [];
  for (const fam of new Set<string>([...d.keys(), ...m.keys()])) {
    const dc = d.get(fam) ?? 0;
    const mc = m.get(fam) ?? 0;
    if ((dc === 0) !== (mc === 0)) {
      verdicts.push({
        relation: 'MR-8', status: 'fail', sampleId: '', severity: 'high',
        symptom: `Family "${fam}" renders on ${mc > 0 ? 'mobile' : 'desktop'} (${Math.max(dc, mc)}) but is absent on ${mc > 0 ? 'desktop' : 'mobile'}`,
        numbers: { desktop: dc, mobile: mc },
        evidence: { family: fam, desktopUrl: desktop.url, mobileUrl: mobile.url, zoom: desktop.requestedZoom },
      });
    }
  }
  if (verdicts.length === 0) verdicts.push({ relation: 'MR-8', status: 'pass', sampleId: '', evidence: { zoom: desktop.requestedZoom } });
  return verdicts;
}

// ── MR-0: drill-down bbox conservation ───────────────────────────────────────
export function checkDrillDown(parent: ViewSnapshot, child: ViewSnapshot): Verdict[] {
  const expected = sumPointsInBbox(parent.network.points, child.network.bbox);
  const aggregated = parent.network.mode === 'aggregated' || child.network.mode === 'aggregated';
  const carveOuts: string[] = [];
  if (parent.network.mode !== child.network.mode) carveOuts.push('cross-mode (zoom-6 switch)');
  if (parent.network.truncated || child.network.truncated) carveOuts.push('row-cap truncated');
  if (parent.network.freshestObservationAt !== child.network.freshestObservationAt) carveOuts.push('freshness skew');
  // Aggregated buckets are CENTROIDS — a boundary bucket's centroid can fall just
  // outside the child bbox while representing obs inside it (and vice-versa). So
  // exact (tol=0) conservation only holds observations↔observations; any
  // aggregated view forces a band. (bot review #1267)
  if (aggregated) carveOuts.push('aggregated-centroid binning');
  const exact = carveOuts.length === 0; // obs↔obs, untruncated, fresh-aligned
  const tol = exact ? 0 : Math.max(3, Math.round(expected * (aggregated ? 0.15 : 0.05)));
  const mk = (relation: string, actual: number): Verdict => {
    const delta = actual - expected; // negative = child shows fewer (lost birds)
    // Exact drill-down: ANY mismatch is a violation. Tolerant drill-down
    // (aggregated / cross-mode / truncation / freshness): flag LOSS beyond the
    // band only — a GAIN is parent-grid coarseness or a row-capped parent, not
    // a conservation bug. (bot review #1267)
    const ok = exact ? delta === 0 : -delta <= tol;
    return {
      relation, status: ok ? 'pass' : 'fail', sampleId: '',
      severity: ok ? undefined : !exact ? 'medium' : delta < 0 ? 'high' : 'medium',
      symptom: ok ? undefined : `Drill-down ${delta < 0 ? `lost ${-delta}` : `gained ${delta}`} (parent counted ${expected} inside child bbox; child ${relation === 'MR-0b' ? 'rendered' : 'returned'} ${actual})`,
      numbers: { expected, actual, delta, tolerance: tol },
      carveOuts: carveOuts.length ? carveOuts : undefined,
      evidence: { parentUrl: parent.url, childUrl: child.url, childBbox: child.network.bbox },
    };
  };
  return [mk('MR-0a', child.network.total), mk('MR-0b', renderedTotal(child))];
}

// ── Sample dispatch (C1: parity + drill-down only; C4 adds MR-1..7) ──────────
export function evaluateSample(sample: Sample): Verdict[] {
  const views = sample.views.filter((v) => !v.inconclusive);
  const out: Verdict[] = [];

  const byCamera = new Map<string, ViewSnapshot[]>();
  for (const v of views) {
    const key = `${v.requestedZoom}@${v.requestedCenter.lng},${v.requestedCenter.lat}`;
    const arr = byCamera.get(key) ?? [];
    arr.push(v);
    byCamera.set(key, arr);
  }
  for (const group of byCamera.values()) {
    const desktop = group.find((v) => v.viewport === 'desktop');
    const mobile = group.find((v) => v.viewport === 'mobile');
    if (desktop && mobile) out.push(...checkParity(desktop, mobile));
  }

  for (const vp of ['desktop', 'mobile'] as const) {
    const ladder = views.filter((v) => v.viewport === vp).sort((a, b) => a.network.zoom - b.network.zoom);
    for (let i = 0; i < ladder.length; i++)
      for (let j = i + 1; j < ladder.length; j++)
        if (bboxInside(ladder[j].network.bbox, ladder[i].network.bbox)) out.push(...checkDrillDown(ladder[i], ladder[j]));
  }

  return out.map((v) => ({ ...v, sampleId: v.sampleId || sample.id }));
}
