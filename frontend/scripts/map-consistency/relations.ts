// frontend/scripts/map-consistency/relations.ts
// Pure metamorphic-relation engine (epic #1266). NO browser imports.
import type { Bbox, FamilyCount, FilterBundle, GeoPoint, Recapture, Sample, ViewSnapshot, Verdict } from './types.js';

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
/** Σ legend counts — the viewport-scoped "stated" total (NOT the lede, which is scope-wide). */
function legendSum(view: ViewSnapshot): number {
  return view.legend.reduce((s, f) => s + f.count, 0);
}
/** A mobile "+N" overflow pill on any marker → some families are legitimately hidden. */
function hasOverflow(view: ViewSnapshot): boolean {
  return view.markers.some((m) => m.overflow);
}
/** Families hidden behind an overflow pill can't be asserted on; build the set of
 *  rendered family names so MR-3 can tell "absent" from "overflow-hidden". */
function renderedFamilySet(view: ViewSnapshot): Set<string> {
  return new Set(renderedFamilyCounts(view).filter((f) => f.count > 0).map((f) => f.family));
}

// ── MR-8: desktop ↔ mobile parity (viewport-coverage normalized) ──────────────
export function checkParity(desktop: ViewSnapshot, mobile: ViewSnapshot): Verdict[] {
  // Viewport-coverage normalization (#1269): desktop (1440×900) and mobile (390×844)
  // cover DIFFERENT bboxes at the same zoom, so comparing raw rendered family SETS
  // yields one-directional false positives (desktop's wider frame sees coastal/edge
  // families mobile's bbox excludes — empirically verified at z4: Albatrosses,
  // Southern Storm-Petrels, Tropicbirds appear in desktop's legend but not mobile's).
  // Restrict to families in BOTH viewports' (viewport-scoped, common-name) legends —
  // the coverage-controlled common ground. A genuine pill-collapse bug = a family in
  // BOTH legends rendered on only one side.
  const dLegend = familyMap(desktop.legend);
  const mLegend = familyMap(mobile.legend);
  const dRender = familyMap(renderedFamilyCounts(desktop));
  const mRender = familyMap(renderedFamilyCounts(mobile));
  const common = [...dLegend.keys()].filter((f) => mLegend.has(f) && (dLegend.get(f) ?? 0) > 0 && (mLegend.get(f) ?? 0) > 0);
  const verdicts: Verdict[] = [];
  for (const fam of common) {
    const dShown = (dRender.get(fam) ?? 0) > 0;
    const mShown = (mRender.get(fam) ?? 0) > 0;
    if (dShown !== mShown) {
      verdicts.push({
        relation: 'MR-8', status: 'fail', sampleId: '', severity: 'high',
        symptom: `Family "${fam}" is in both viewports' data (legend desktop ${dLegend.get(fam)}, mobile ${mLegend.get(fam)}) but renders only on ${dShown ? 'desktop' : 'mobile'} — absent on ${dShown ? 'mobile' : 'desktop'}`,
        numbers: { desktopLegend: dLegend.get(fam) ?? 0, mobileLegend: mLegend.get(fam) ?? 0, desktopRendered: dRender.get(fam) ?? 0, mobileRendered: mRender.get(fam) ?? 0 },
        evidence: { family: fam, desktopUrl: desktop.url, mobileUrl: mobile.url, zoom: desktop.requestedZoom },
      });
    }
  }
  if (verdicts.length === 0) verdicts.push({ relation: 'MR-8', status: 'pass', sampleId: '', evidence: { zoom: desktop.requestedZoom, comparedFamilies: common.length } });
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
  // Aggregated/cross-mode band widened 15% → 20% (#1270): the first prod smoke lost
  // 118 vs a 116 tol on a z4→z9 cross-mode jump — centroid binning across a 5-zoom
  // cross-mode jump warrants the wider band (tol 155 at expected ~775 → passes).
  // Same-mode obs↔obs stays exact (tol 0).
  const tol = exact ? 0 : Math.max(3, Math.round(expected * (aggregated ? 0.2 : 0.05)));
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

// ── MR-1: zoom non-vanishing (per view) ───────────────────────────────────────
/** The literal "zoom in → empty map though data exists" bug: network served birds
 *  but nothing rendered. `inconclusive` views are already filtered out upstream. */
export function checkZoomNonVanishing(view: ViewSnapshot): Verdict[] {
  const rendered = renderedTotal(view);
  const vanished = view.network.total > 0 && rendered === 0 && view.markers.length === 0;
  return [{
    relation: 'MR-1', status: vanished ? 'fail' : 'pass', sampleId: '',
    severity: vanished ? 'high' : undefined,
    symptom: vanished ? `network has ${view.network.total} birds but the map rendered none at zoom ${view.requestedZoom}` : undefined,
    numbers: { networkTotal: view.network.total, rendered, markers: view.markers.length },
    evidence: { url: view.url, viewport: view.viewport, zoom: view.requestedZoom },
  }];
}

// ── MR-2: stated (Σ legend) vs rendered (per view) ────────────────────────────
/** The "says 7, shows 3" bug: viewport-scoped legend states more than the markers
 *  render. A collapsed desktop pill gives rendered=0, stated>0 → fires. Overflow
 *  relaxes the bound (a "+N" pill legitimately hides families). */
export function checkStatedVsRendered(view: ViewSnapshot): Verdict[] {
  const stated = legendSum(view);
  const rendered = renderedTotal(view);
  const overflow = hasOverflow(view);
  const carveOuts = overflow ? ['mobile-overflow'] : undefined;
  // Default: rendered materially under stated. With overflow, only fail if rendered
  // EXCEEDS stated (overflow can hide families so under-counting is expected).
  const tol = Math.max(2, stated * 0.1);
  const fail = overflow ? rendered > stated + tol : stated - rendered > tol;
  return [{
    relation: 'MR-2', status: fail ? 'fail' : 'pass', sampleId: '',
    severity: fail ? 'high' : undefined,
    symptom: fail ? `legend states ${stated} but markers rendered ${rendered} at zoom ${view.requestedZoom}${overflow ? ' (overflow present)' : ''}` : undefined,
    numbers: { stated, rendered, tolerance: Math.round(tol) },
    carveOuts,
    evidence: { url: view.url, viewport: view.viewport, zoom: view.requestedZoom },
  }];
}

// ── MR-3: per-family conservation (per view) ──────────────────────────────────
/** Reconcile legend[fam] vs rendered[fam] ONLY — both common-name keyed, so they
 *  match directly. Do NOT use network.familyCounts (code↔name mismatch in
 *  observations mode would false-fire). A family in the legend (count>0) that
 *  renders nothing (and isn't overflow-hidden) is a per-family drop. */
export function checkFamilyConservation(view: ViewSnapshot): Verdict[] {
  const overflow = hasOverflow(view);
  const renderedSet = renderedFamilySet(view);
  const verdicts: Verdict[] = [];
  for (const { family, count } of view.legend) {
    if (count <= 0) continue;
    if (!renderedSet.has(family)) {
      // Overflow-hidden families are a legitimate non-render → carve out.
      verdicts.push({
        relation: 'MR-3', status: overflow ? 'pass' : 'fail', sampleId: '',
        severity: overflow ? undefined : 'high',
        symptom: overflow ? undefined : `family "${family}" is in the legend (${count}) but renders no cell at zoom ${view.requestedZoom}`,
        numbers: { legend: count, rendered: 0 },
        carveOuts: overflow ? ['mobile-overflow'] : undefined,
        evidence: { family, url: view.url, viewport: view.viewport, zoom: view.requestedZoom },
      });
    }
  }
  if (verdicts.length === 0) verdicts.push({ relation: 'MR-3', status: 'pass', sampleId: '', evidence: { url: view.url, viewport: view.viewport, families: view.legend.length } });
  return verdicts;
}

// ── MR-4: filter consistency (filter bundle) ──────────────────────────────────
/** Reconcile filtered variants against the unfiltered baseline at one camera:
 *  (a) each `?family=F` view's legendSum ≈ unfiltered.legend[F];
 *  (b) Σ filtered totals ≈ unfiltered.total over probed families (partial coverage
 *      is noted, not failed); (c) `since` monotonicity 1d ≤ 7d ≤ 14d. */
export function checkFilterConsistency(bundle: FilterBundle): Verdict[] {
  const verdicts: Verdict[] = [];
  const within = (x: number, y: number) => Math.abs(x - y) <= Math.max(2, Math.max(x, y) * 0.05);
  const baseLegend = familyMap(bundle.unfiltered.legend);

  // (a) per-family: filtered legendSum ≈ unfiltered legend[F]
  for (const { family, view } of bundle.byFamily) {
    const filteredSum = legendSum(view);
    const expected = baseLegend.get(family) ?? 0;
    const ok = within(filteredSum, expected);
    verdicts.push({
      relation: 'MR-4', status: ok ? 'pass' : 'fail', sampleId: '',
      severity: ok ? undefined : 'medium',
      symptom: ok ? undefined : `filter family="${family}" legend sum ${filteredSum} ≠ unfiltered legend[${family}] ${expected}`,
      numbers: { filteredLegendSum: filteredSum, unfilteredFamily: expected },
      evidence: { kind: 'family-consistency', family, url: view.url },
    });
  }

  // (b) Σ filtered totals ≈ unfiltered.total over probed families (partial → note)
  if (bundle.byFamily.length > 0) {
    const probedSum = bundle.byFamily.reduce((s, b) => s + legendSum(b.view), 0);
    const probedFamilies = bundle.byFamily.map((b) => b.family);
    const baselineProbed = probedFamilies.reduce((s, f) => s + (baseLegend.get(f) ?? 0), 0);
    const fullCoverage = probedFamilies.length >= bundle.unfiltered.legend.length;
    const ok = within(probedSum, baselineProbed);
    verdicts.push({
      relation: 'MR-4', status: ok ? 'pass' : 'fail', sampleId: '',
      severity: ok ? undefined : 'medium',
      symptom: ok ? undefined : `Σ filtered totals ${probedSum} ≠ unfiltered probed total ${baselineProbed}${fullCoverage ? '' : ` (partial coverage: ${probedFamilies.length}/${bundle.unfiltered.legend.length} families probed)`}`,
      numbers: { probedSum, baselineProbed, probedFamilies: probedFamilies.length, totalFamilies: bundle.unfiltered.legend.length },
      carveOuts: fullCoverage ? undefined : ['partial-family-coverage'],
      evidence: { kind: 'sum-consistency', url: bundle.unfiltered.url },
    });
  }

  // (c) since monotonicity: 14d ≥ 7d ≥ 1d at the same camera
  const sinceTotal = (w: '1d' | '7d' | '14d') => {
    const hit = bundle.bySince.find((s) => s.since === w);
    return hit ? hit.view.network.total : null;
  };
  const t1 = sinceTotal('1d'); const t7 = sinceTotal('7d'); const t14 = sinceTotal('14d');
  if (t1 != null && t7 != null && t14 != null) {
    const slack = (a: number, b: number) => a - b > Math.max(2, b * 0.05); // a should be ≤ b
    const v1 = slack(t1, t7); // 1d > 7d → violation
    const v7 = slack(t7, t14); // 7d > 14d → violation
    const ok = !v1 && !v7;
    verdicts.push({
      relation: 'MR-4', status: ok ? 'pass' : 'fail', sampleId: '',
      severity: ok ? undefined : 'medium',
      symptom: ok ? undefined : `since-window monotonicity violated: 1d=${t1}, 7d=${t7}, 14d=${t14} (expected 1d ≤ 7d ≤ 14d)`,
      numbers: { since1d: t1, since7d: t7, since14d: t14 },
      evidence: { kind: 'since-monotonicity', url: bundle.unfiltered.url },
    });
  }

  if (verdicts.length === 0) verdicts.push({ relation: 'MR-4', status: 'pass', sampleId: '', evidence: { kind: 'empty-bundle' } });
  return verdicts;
}

// ── MR-5: lede vs scope-total (conditional) ───────────────────────────────────
/** The lede states a SCOPE-WIDE total (per MR-5 / spec), NOT the viewport. Compare
 *  lede.firstInt to the seed-fetch scope total. Only evaluate a real, parsed lede;
 *  skip the loading placeholder and unit-mismatched comparisons. */
export function checkLedeVsScope(view: ViewSnapshot, scopeTotal: number | undefined): Verdict[] {
  if (scopeTotal == null) return [];
  const { firstInt, unit } = view.lede;
  if (firstInt == null || unit == null) return []; // loading placeholder / unparsed
  // Carve-out: a species-count lede is not comparable to a sightings scope total.
  if (unit === 'species') {
    return [{ relation: 'MR-5', status: 'pass', sampleId: '', carveOuts: ['lede-unit-species'], evidence: { url: view.url, ledeUnit: unit } }];
  }
  const tol = Math.max(2, scopeTotal * 0.02);
  const ok = Math.abs(firstInt - scopeTotal) <= tol;
  return [{
    relation: 'MR-5', status: ok ? 'pass' : 'fail', sampleId: '',
    severity: ok ? undefined : 'medium',
    symptom: ok ? undefined : `lede states ${firstInt} ${unit} but scope total is ${scopeTotal} (Δ ${firstInt - scopeTotal})`,
    numbers: { ledeFirstInt: firstInt, scopeTotal, tolerance: Math.round(tol) },
    evidence: { url: view.url, viewport: view.viewport, ledeUnit: unit },
  }];
}

// ── MR-6: clean console (per view) ────────────────────────────────────────────
/** Any console error or warning (tile-CDN failures already routed to inconclusive
 *  upstream). A dirty console at render time is a real defect. */
export function checkCleanConsole(view: ViewSnapshot): Verdict[] {
  const first = view.consoleErrors[0] ?? view.consoleWarnings[0];
  const dirty = view.consoleErrors.length > 0 || view.consoleWarnings.length > 0;
  return [{
    relation: 'MR-6', status: dirty ? 'fail' : 'pass', sampleId: '',
    severity: dirty ? (view.consoleErrors.length > 0 ? 'high' : 'medium') : undefined,
    symptom: dirty ? `console not clean (${view.consoleErrors.length} errors, ${view.consoleWarnings.length} warnings): ${first}` : undefined,
    numbers: { errors: view.consoleErrors.length, warnings: view.consoleWarnings.length },
    evidence: { url: view.url, viewport: view.viewport, zoom: view.requestedZoom },
  }];
}

// ── MR-7: idempotence / intermittency (re-capture pair) ───────────────────────
/** Two captures of the same camera should agree. A network or rendered-total drift
 *  is intermittency. A freshness change (new ingest landed between captures) is a
 *  legitimate skew → downgrade to a note. */
export function checkIdempotence(rc: Recapture): Verdict[] {
  const { a, b } = rc;
  const freshSkew = a.network.freshestObservationAt !== b.network.freshestObservationAt;
  const netDelta = Math.abs(a.network.total - b.network.total);
  const ra = renderedTotal(a); const rb = renderedTotal(b);
  const renderDelta = Math.abs(ra - rb);
  const renderTol = Math.max(2, Math.max(ra, rb) * 0.05);
  const drifted = netDelta > 0 || renderDelta > renderTol;
  if (drifted && freshSkew) {
    return [{
      relation: 'MR-7', status: 'pass', sampleId: '', carveOuts: ['freshness-skew'],
      symptom: `re-capture drift attributed to freshness skew (network ${a.network.total}→${b.network.total}, rendered ${ra}→${rb}; freshest ${a.network.freshestObservationAt} → ${b.network.freshestObservationAt})`,
      numbers: { netDelta, renderDelta },
      evidence: { url: a.url, kind: 'freshness-skew-note' },
    }];
  }
  return [{
    relation: 'MR-7', status: drifted ? 'fail' : 'pass', sampleId: '',
    severity: drifted ? 'medium' : undefined,
    symptom: drifted ? `non-idempotent: re-capture at the same camera differs (network ${a.network.total}→${b.network.total}, rendered ${ra}→${rb})` : undefined,
    numbers: { netA: a.network.total, netB: b.network.total, netDelta, renderedA: ra, renderedB: rb, renderDelta },
    evidence: { url: a.url, viewport: a.viewport, zoom: a.requestedZoom },
  }];
}

// ── Sample dispatch (MR-0 + MR-1..8) ─────────────────────────────────────────
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

  // Per-view relations: MR-1/2/3/6 always; MR-5 against the scope-wide total.
  for (const v of views) {
    out.push(...checkZoomNonVanishing(v));
    out.push(...checkStatedVsRendered(v));
    out.push(...checkFamilyConservation(v));
    out.push(...checkCleanConsole(v));
    out.push(...checkLedeVsScope(v, sample.scopeTotal));
  }

  // MR-4 over the filter bundle (one per sample when captured).
  if (sample.filterBundle) out.push(...checkFilterConsistency(sample.filterBundle));

  // MR-7 over re-capture pairs.
  for (const rc of sample.recaptures ?? []) out.push(...checkIdempotence(rc));

  // Stamp every non-MR-7 fail with whether its camera's re-capture reproduced it.
  // A re-capture exists when both members of a pair sit at the verdict's camera.
  const stamped = out.map((v) => stampDeterminism(v, sample.recaptures ?? []));

  return stamped.map((v) => ({ ...v, sampleId: v.sampleId || sample.id }));
}

/** Thread a `deterministic` flag onto a fail's evidence: did the camera's
 *  re-capture reproduce the same symptom? Only meaningful for fails at a camera
 *  that was re-captured; left undefined otherwise. MR-7 itself is the source of
 *  the determinism signal, so it is not re-stamped. */
function stampDeterminism(v: Verdict, recaptures: Recapture[]): Verdict {
  if (v.status !== 'fail' || v.relation === 'MR-7' || recaptures.length === 0) return v;
  const url = (v.evidence?.url ?? v.evidence?.childUrl ?? v.evidence?.desktopUrl) as string | undefined;
  if (!url) return v;
  const rc = recaptures.find((r) => r.a.url === url || r.b.url === url);
  if (!rc) return v;
  // Re-run the same per-view relation against the OTHER capture to see if it repeats.
  const other = rc.a.url === url ? rc.b : rc.a;
  const repeats = relationFiresOnView(v.relation, other);
  return { ...v, evidence: { ...v.evidence, deterministic: repeats } };
}

/** Re-evaluate a single per-view relation against one view (for determinism stamping). */
function relationFiresOnView(relation: string, view: ViewSnapshot): boolean {
  const run = (vs: Verdict[]) => vs.some((x) => x.status === 'fail');
  switch (relation) {
    case 'MR-1': return run(checkZoomNonVanishing(view));
    case 'MR-2': return run(checkStatedVsRendered(view));
    case 'MR-3': return run(checkFamilyConservation(view));
    case 'MR-6': return run(checkCleanConsole(view));
    default: return false; // cross-view relations (MR-0/MR-5/MR-8) aren't single-view reproducible
  }
}
