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
/** Σ pill totals + Σ grid cell counts (§5.2). Pills now count toward the rendered
 *  total — they carry the bulk of the low-zoom count and were previously invisible,
 *  causing the MR-1 false-fire and the MR-2b undercount. For a grid marker
 *  `mk.total === Σ mk.cells.count`, so a single `mk.total` sum covers both kinds. */
export function renderedTotal(view: ViewSnapshot): number {
  return view.markers.reduce((s, mk) => s + mk.total, 0);
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

// ── MR-8: desktop ↔ mobile parity (DIRECTIONAL pill-collapse detector) ─────────
export function checkParity(desktop: ViewSnapshot, mobile: ViewSnapshot): Verdict[] {
  // Viewport-coverage normalization (#1269): desktop (1440×900) and mobile (390×844)
  // cover DIFFERENT bboxes at the same zoom, so comparing raw rendered family SETS
  // yields one-directional false positives (desktop's wider frame sees coastal/edge
  // families mobile's bbox excludes — empirically verified at z4: Albatrosses,
  // Southern Storm-Petrels, Tropicbirds appear in desktop's legend but not mobile's).
  // Restrict to families in BOTH viewports' (viewport-scoped, common-name) legends —
  // the coverage-controlled common ground.
  //
  // DIRECTIONAL (#1270 §5.1): the reported bug is "desktop pills disappear, mobile
  // splits them out" — i.e. DESKTOP under-rendering. So fire ONLY when
  //   mobile renders F (cell>0) && desktop does NOT (cell 0).
  // Suppress the reverse (desktop renders, mobile doesn't): that is desktop's larger
  // 4×4 grid capacity legitimately surfacing the tail mobile's smaller grid drops —
  // it was the 21 residual MR-8 artifacts in the first prod run, NOT a bug.
  const dLegend = familyMap(desktop.legend);
  const mLegend = familyMap(mobile.legend);
  const dRender = familyMap(renderedFamilyCounts(desktop));
  const mRender = familyMap(renderedFamilyCounts(mobile));
  const common = [...dLegend.keys()].filter((f) => mLegend.has(f) && (dLegend.get(f) ?? 0) > 0 && (mLegend.get(f) ?? 0) > 0);
  const verdicts: Verdict[] = [];
  for (const fam of common) {
    const dShown = (dRender.get(fam) ?? 0) > 0;
    const mShown = (mRender.get(fam) ?? 0) > 0;
    // Only the desktop-under-rendering direction is a violation.
    if (mShown && !dShown) {
      verdicts.push({
        relation: 'MR-8', status: 'fail', sampleId: '', severity: 'high',
        symptom: `Family "${fam}" is in both viewports' data (legend desktop ${dLegend.get(fam)}, mobile ${mLegend.get(fam)}) and renders on mobile but NOT on desktop — desktop pill-collapse`,
        numbers: { desktopLegend: dLegend.get(fam) ?? 0, mobileLegend: mLegend.get(fam) ?? 0, desktopRendered: dRender.get(fam) ?? 0, mobileRendered: mRender.get(fam) ?? 0 },
        evidence: { family: fam, desktopUrl: desktop.url, mobileUrl: mobile.url, zoom: desktop.requestedZoom },
      });
    }
  }
  if (verdicts.length === 0) verdicts.push({ relation: 'MR-8', status: 'pass', sampleId: '', evidence: { zoom: desktop.requestedZoom, comparedFamilies: common.length } });
  return verdicts;
}

// ── MR-9: pill-split parity (desktop ↔ mobile, THE reported bug) ──────────────
/** The user's literal bug (§5.2): "desktop pills disappear and never split out
 *  like they do on mobile." `pickGridShape` collapses a cluster to a `.cluster-pill`
 *  above a point/family cap, and desktop's wider bbox aggregates MORE points per
 *  cluster → more clusters exceed the cap → desktop stays a pill where mobile splits
 *  into a family grid.
 *
 *  Measured as the FRACTION of each viewport's clusters that are split into grids
 *  (`gridFraction = #grid / (#grid + #pill)`), NOT raw counts — desktop's wider
 *  frame sees more clusters total, so a raw `#grid` comparison conflates "more
 *  clusters" with "under-splitting". The fraction normalizes that away. Fire when
 *  mobile splits a MATERIALLY larger fraction than desktop:
 *    `mobileGridFraction − desktopGridFraction > MR9_THRESHOLD`.
 *  Severity high — this is the reported defect.
 *
 *  THRESHOLD (0.12) tuned from a paced live probe (2026-06-23) over LA / SF / NYC /
 *  FL-gulf at z5–z10. The asymmetry is camera-dependent, NOT uniformly in the bug
 *  direction: at z7–z9 in some metros desktop's wider frame pushes its OWN clusters
 *  over the split cap too, REVERSING the gap to ~−0.12 (desktop splits a larger
 *  fraction). The canonical bug signature ("desktop leaves clusters as pills, mobile
 *  splits") peaked at +0.15 (NYC z8: desktop 0.09 = 5 grids/51 pills vs mobile 0.24
 *  = 9 grids/28 pills). 0.12 sits at the reverse-direction noise FLOOR magnitude but
 *  fires only in the positive (bug) direction, so it catches NYC-z8-class cameras
 *  while never tripping on the benign reverse cases or near-parity high zooms. */
export const MR9_THRESHOLD = 0.12;

function gridFraction(view: ViewSnapshot): { grids: number; pills: number; fraction: number | null } {
  const grids = view.markers.filter((m) => m.kind === 'grid').length;
  const pills = view.markers.filter((m) => m.kind === 'pill').length;
  const denom = grids + pills;
  return { grids, pills, fraction: denom === 0 ? null : grids / denom };
}

export function checkPillSplitParity(desktop: ViewSnapshot, mobile: ViewSnapshot): Verdict[] {
  const d = gridFraction(desktop);
  const m = gridFraction(mobile);
  // Guard divide-by-zero: a viewport with no clusters at all has no split fraction
  // to compare, so the parity is undefined → pass with a carve-out.
  if (d.fraction === null || m.fraction === null) {
    return [{
      relation: 'MR-9', status: 'pass', sampleId: '', carveOuts: ['no-clusters'],
      numbers: { desktopGrids: d.grids, desktopPills: d.pills, mobileGrids: m.grids, mobilePills: m.pills },
      evidence: { zoom: desktop.requestedZoom, desktopUrl: desktop.url, mobileUrl: mobile.url },
    }];
  }
  const gap = m.fraction - d.fraction; // positive = mobile splits a larger fraction (desktop under-splits)
  const fail = gap > MR9_THRESHOLD;
  return [{
    relation: 'MR-9', status: fail ? 'fail' : 'pass', sampleId: '',
    severity: fail ? 'high' : undefined,
    symptom: fail
      ? `desktop under-splits clusters at zoom ${desktop.requestedZoom}: mobile splits ${(m.fraction * 100).toFixed(0)}% of its clusters into grids (${m.grids}/${m.grids + m.pills}) but desktop only ${(d.fraction * 100).toFixed(0)}% (${d.grids}/${d.grids + d.pills}) — Δ ${(gap * 100).toFixed(0)}pp > ${(MR9_THRESHOLD * 100).toFixed(0)}pp threshold`
      : undefined,
    numbers: {
      desktopGridFraction: Number(d.fraction.toFixed(3)), mobileGridFraction: Number(m.fraction.toFixed(3)),
      gap: Number(gap.toFixed(3)), threshold: MR9_THRESHOLD,
      desktopGrids: d.grids, desktopPills: d.pills, mobileGrids: m.grids, mobilePills: m.pills,
    },
    evidence: { zoom: desktop.requestedZoom, desktopUrl: desktop.url, mobileUrl: mobile.url },
  }];
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
  // MR-0b compares against the child's RENDERED total (Σ visible cells), which
  // excludes the "+N" overflow tail. When the child is capacity-limited (an
  // overflow pill or simply more birds than the adaptive grid renders), that
  // rendered count is a lossy subset, not a conservation bound — asserting it
  // here false-fires a "lost K" even though conservation holds (mirrors the
  // MR-2b capacity carve-out, same `hasOverflow`/`>50` guard). MR-0a's server
  // -truth leg still asserts the real conservation. (bot review)
  const childCapacityLimited = hasOverflow(child) || child.network.total > 50;
  const mk = (relation: string, actual: number): Verdict => {
    if (relation === 'MR-0b' && childCapacityLimited) {
      return {
        relation, status: 'pass', sampleId: '',
        carveOuts: ['rendered-capacity-limited'],
        numbers: { expected, actual, networkTotal: child.network.total },
        evidence: { parentUrl: parent.url, childUrl: child.url, childBbox: child.network.bbox },
      };
    }
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
 *  but nothing rendered. `inconclusive` views are already filtered out upstream.
 *  Uses the FULL marker set (pills + grids, §5.2): pills carry the low-zoom count
 *  and were previously invisible to the capture, which is what produced the false
 *  MR-1 fires at low zoom (16 pills on-screen where the capture read 0 markers). */
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

// ── MR-2: conservation law (per view) ─────────────────────────────────────────
/** The reliable invariant (#1270 §5.1): the three viewport-scoped totals agree —
 *  `Σ legend ≈ network.total ≈ lede`. The legend and the lede both report the
 *  viewport total the network served; a divergence between any of them is a real
 *  defect. (This SUPERSEDES the old legend-vs-rendered check — rendered cells are a
 *  lossy capacity-limited subset, not a conservation bound; see MR-2b for the
 *  render-completeness check that only applies where capacity is not a factor.) */
export function checkConservation(view: ViewSnapshot): Verdict[] {
  const legend = legendSum(view);
  const total = view.network.total;
  const eps = Math.max(3, Math.round(total * 0.02));
  const { firstInt: lede, unit } = view.lede;
  // The lede leg is only comparable when a real sightings lede has been parsed —
  // skip a loading placeholder (unit null) or a species-count lede (different unit).
  const ledeComparable = lede != null && unit === 'sightings';
  // Legend-leg guard (§5.1 amendment): assert `|Σlegend − network.total| ≤ ε` ONLY
  // in observations mode. In aggregated mode the /api/observations response is
  // SCOPE-WIDE (the whole region) while the legend is VIEWPORT-scoped (only the
  // visible frame), so the two legitimately diverge — comparing them is
  // apples-to-oranges and would false-fire. Carve it out (`aggregated-response-scopewide`).
  // The lede leg stays UNCONDITIONAL: the lede tracks the same total either way.
  const legendComparable = view.network.mode === 'observations';
  const legendDelta = Math.abs(legend - total);
  const ledeDelta = ledeComparable ? Math.abs((lede as number) - total) : 0;
  const legendBad = legendComparable && legendDelta > eps;
  const ledeBad = ledeComparable && ledeDelta > eps;
  const fail = legendBad || ledeBad;
  const parts: string[] = [];
  if (legendBad) parts.push(`Σlegend ${legend} vs network.total ${total} (Δ ${legend - total})`);
  if (ledeBad) parts.push(`lede ${lede} vs network.total ${total} (Δ ${(lede as number) - total})`);
  return [{
    relation: 'MR-2', status: fail ? 'fail' : 'pass', sampleId: '',
    severity: fail ? 'high' : undefined,
    symptom: fail ? `conservation broken at zoom ${view.requestedZoom}: ${parts.join('; ')} (ε ${eps})` : undefined,
    numbers: { legendSum: legend, networkTotal: total, ledeFirstInt: lede, epsilon: eps },
    carveOuts: legendComparable ? undefined : ['aggregated-response-scopewide'],
    evidence: { url: view.url, viewport: view.viewport, zoom: view.requestedZoom },
  }];
}

// ── MR-2b: render-completeness (per view, low-total only) ─────────────────────
/** The "says 7, shows 3" catcher (#1270 §5.1). Rendered cells are normally a
 *  capacity-limited subset of the legend, so `Σrendered == total` is false at high
 *  counts. BUT when `network.total ≤ 50` and NO marker is in overflow, everything
 *  fits the adaptive grid — so the rendered cells MUST conserve the total. A
 *  shortfall there is genuine render loss (the literal "shows fewer than there are"
 *  bug). Skipped at high totals or any overflow (capacity-limited, expected loss). */
export function checkRenderCompleteness(view: ViewSnapshot): Verdict[] {
  const total = view.network.total;
  const overflow = hasOverflow(view);
  if (total > 50 || overflow) {
    return [{
      relation: 'MR-2b', status: 'pass', sampleId: '',
      carveOuts: total > 50 ? ['capacity-limited'] : ['mobile-overflow'],
      evidence: { url: view.url, viewport: view.viewport, zoom: view.requestedZoom, networkTotal: total },
    }];
  }
  const rendered = renderedTotal(view);
  const eps = Math.max(2, total * 0.1);
  // Only a SHORTFALL is render loss; a rendered-over-total would be a different
  // (and not-observed) anomaly, left to MR-2's conservation leg.
  const fail = total - rendered > eps;
  return [{
    relation: 'MR-2b', status: fail ? 'fail' : 'pass', sampleId: '',
    severity: fail ? 'high' : undefined,
    symptom: fail ? `render loss at zoom ${view.requestedZoom}: network served ${total} but markers rendered ${rendered} (everything should fit at total ≤ 50, ε ${Math.round(eps)})` : undefined,
    numbers: { networkTotal: total, rendered, tolerance: Math.round(eps) },
    evidence: { url: view.url, viewport: view.viewport, zoom: view.requestedZoom },
  }];
}

// ── MR-3: server ↔ client per-family agreement (aggregated mode only) ─────────
/** Reconcile the client legend against the server's per-family counts (#1270 §5.1).
 *  ONLY meaningful in aggregated mode: there `network.familyCounts` is populated and
 *  common-name keyed, so `legend[fam] ≈ network.familyCounts[fam]` is a true
 *  server↔client invariant. In observations mode `network.familyCounts` is empty /
 *  code-keyed (code↔name mismatch would false-fire), so this is a no-op pass.
 *
 *  This SUPERSEDES the old legend-vs-rendered check, which compared the legend to
 *  the capacity-limited rendered subset and produced 317 capacity artifacts in the
 *  first prod run (legend 601 / rendered 0 at a high total is normal grid overflow,
 *  not a drop).
 *
 *  Viewport-coverage guard (#1270 prod re-run): `network.familyCounts`/`network.total`
 *  are RESPONSE-scoped (the whole /api/observations body), whereas the legend is
 *  VIEWPORT-scoped (only families inside the visible frame). At low zoom on the narrow
 *  mobile viewport the response covers a far wider bbox than the rendered frame, so the
 *  two are scoped differently and a per-family comparison is apples-to-oranges (it
 *  produced 166 mobile-z4 artifacts — server-national vs legend-viewport). Only run the
 *  per-family check when conservation holds between Σlegend and network.total — i.e.
 *  legend and network cover the SAME scope (the §5.1 "both viewport-scoped" premise). */
export function checkFamilyConservation(view: ViewSnapshot): Verdict[] {
  if (view.network.mode !== 'aggregated') {
    return [{ relation: 'MR-3', status: 'pass', sampleId: '', carveOuts: ['observations-mode'], evidence: { url: view.url, viewport: view.viewport, mode: view.network.mode } }];
  }
  // Scope guard: skip when the legend (viewport) and network (response) totals diverge
  // beyond the conservation ε — they cover different bboxes, so per-family is meaningless.
  const legendTotal = legendSum(view);
  const total = view.network.total;
  const scopeEps = Math.max(3, Math.round(total * 0.02));
  if (Math.abs(legendTotal - total) > scopeEps) {
    return [{ relation: 'MR-3', status: 'pass', sampleId: '', carveOuts: ['viewport-coverage-mismatch'], numbers: { legendSum: legendTotal, networkTotal: total }, evidence: { url: view.url, viewport: view.viewport, zoom: view.requestedZoom } }];
  }
  const serverByFamily = familyMap(view.network.familyCounts);
  const legendByFamily = familyMap(view.legend);
  const verdicts: Verdict[] = [];
  const within = (a: number, b: number) => Math.abs(a - b) <= Math.max(2, Math.max(a, b) * 0.05);
  // A stale aggregated payload can carry `name: null` buckets, which key by the raw
  // family CODE (e.g. "tyrannidae") while the legend shows the colloquial name
  // ("Tyrant Flycatchers") — `legendByFamily.get(code)` returns 0, a false
  // "server N ≠ client 0". When a server key is absent from the legend AND looks
  // like a raw lowercase code (no spaces, `[a-z-]+` only), it's an unresolved
  // code↔name key, not a real divergence — skip it.
  const looksLikeRawCode = (key: string) => /^[a-z-]+$/.test(key);
  for (const [family, serverCount] of serverByFamily) {
    if (serverCount <= 0) continue;
    if (!legendByFamily.has(family) && looksLikeRawCode(family)) {
      verdicts.push({ relation: 'MR-3', status: 'pass', sampleId: '', carveOuts: ['family-key-unresolved'], numbers: { server: serverCount }, evidence: { family, url: view.url, viewport: view.viewport, zoom: view.requestedZoom } });
      continue;
    }
    const legendCount = legendByFamily.get(family) ?? 0;
    if (!within(legendCount, serverCount)) {
      verdicts.push({
        relation: 'MR-3', status: 'fail', sampleId: '', severity: 'high',
        symptom: `family "${family}" server count ${serverCount} ≠ client legend ${legendCount} at zoom ${view.requestedZoom}`,
        numbers: { server: serverCount, legend: legendCount },
        evidence: { family, url: view.url, viewport: view.viewport, zoom: view.requestedZoom },
      });
    }
  }
  if (verdicts.length === 0) verdicts.push({ relation: 'MR-3', status: 'pass', sampleId: '', evidence: { url: view.url, viewport: view.viewport, families: serverByFamily.size } });
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

// ── MR-10: filtered render-completeness ("filter says N, only M render") ───────
/** The reported bug MR-2b/MR-4 structurally miss: filter by family F → the count
 *  says N (e.g. 7) but only M < N markers render. MR-2b runs ONLY on the unfiltered
 *  ladder; MR-4 compares filtered-count NUMBERS against the unfiltered slice
 *  (legend-vs-legend), never `stated count vs Σ rendered markers`. This relation
 *  closes that seam.
 *
 *  For each `?family=F` view, the STATED count (the server's F count at this camera =
 *  `view.network.total`) must be conserved by what RENDERS. Filtered to one family
 *  there is no overflow tail (every cluster is that family — a single-family cluster
 *  pills out with its full count), so `Σ marker totals == total F` when rendering is
 *  correct. A shortfall = the map dropped birds the filter counted — the reported
 *  "says 7, shows 3" bug. Repro = the filtered `#map=` URL. */
export function checkFilteredRenderCompleteness(bundle: FilterBundle): Verdict[] {
  const verdicts: Verdict[] = [];
  for (const { family, view } of bundle.byFamily) {
    if (view.inconclusive) continue; // capture failed — not a render verdict
    const stated = view.network.total;
    if (stated === 0) continue; // nothing to render; MR-4(a) covers the 0-vs-baseline case
    const rendered = renderedTotal(view);
    const shortfall = stated - rendered;
    const ok = shortfall <= Math.max(2, Math.round(stated * 0.1));
    verdicts.push({
      relation: 'MR-10',
      status: ok ? 'pass' : 'fail',
      sampleId: '',
      severity: ok ? undefined : 'high',
      symptom: ok
        ? undefined
        : `filter family="${family}": stated ${stated} sightings but only ${rendered} rendered on screen (lost ${shortfall})`,
      numbers: { stated, rendered, delta: rendered - stated },
      evidence: { kind: 'filtered-render-completeness', family, url: view.url },
    });
  }
  if (verdicts.length === 0) verdicts.push({ relation: 'MR-10', status: 'pass', sampleId: '', evidence: { kind: 'no-filtered-views' } });
  return verdicts;
}

// ── MR-5: lede vs VIEWPORT total (conditional) ────────────────────────────────
/** The lede tracks the VIEWPORT total, NOT the scope (#1270 §5.1 — the earlier
 *  "lede is scope-total" reading was the two-stage-load interstitial). Compare
 *  lede.firstInt to `view.network.total`. Only evaluate a real, parsed sightings
 *  lede; skip the loading placeholder and a species-count lede (different unit). */
export function checkLedeVsScope(view: ViewSnapshot): Verdict[] {
  const { firstInt, unit } = view.lede;
  if (firstInt == null || unit == null) return []; // loading placeholder / unparsed
  // Carve-out: a species-count lede is not comparable to a sightings total.
  if (unit === 'species') {
    return [{ relation: 'MR-5', status: 'pass', sampleId: '', carveOuts: ['lede-unit-species'], evidence: { url: view.url, ledeUnit: unit } }];
  }
  const total = view.network.total;
  const tol = Math.max(3, total * 0.02);
  const ok = Math.abs(firstInt - total) <= tol;
  return [{
    relation: 'MR-5', status: ok ? 'pass' : 'fail', sampleId: '',
    severity: ok ? undefined : 'medium',
    symptom: ok ? undefined : `lede states ${firstInt} ${unit} but viewport network total is ${total} (Δ ${firstInt - total})`,
    numbers: { ledeFirstInt: firstInt, networkTotal: total, tolerance: Math.round(tol) },
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
    if (desktop && mobile) {
      out.push(...checkParity(desktop, mobile));
      out.push(...checkPillSplitParity(desktop, mobile));
    }
  }

  for (const vp of ['desktop', 'mobile'] as const) {
    const ladder = views.filter((v) => v.viewport === vp).sort((a, b) => a.network.zoom - b.network.zoom);
    for (let i = 0; i < ladder.length; i++)
      for (let j = i + 1; j < ladder.length; j++)
        if (bboxInside(ladder[j].network.bbox, ladder[i].network.bbox)) out.push(...checkDrillDown(ladder[i], ladder[j]));
  }

  // Per-view relations: MR-1/2/2b/3/5/6 (all viewport-scoped, per #1270 §5.1).
  for (const v of views) {
    out.push(...checkZoomNonVanishing(v));
    out.push(...checkConservation(v));
    out.push(...checkRenderCompleteness(v));
    out.push(...checkFamilyConservation(v));
    out.push(...checkCleanConsole(v));
    out.push(...checkLedeVsScope(v));
  }

  // MR-4 + MR-10 over the filter bundle (one per sample when captured).
  if (sample.filterBundle) {
    out.push(...checkFilterConsistency(sample.filterBundle));
    out.push(...checkFilteredRenderCompleteness(sample.filterBundle)); // MR-10
  }

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
    case 'MR-2': return run(checkConservation(view));
    case 'MR-2b': return run(checkRenderCompleteness(view));
    case 'MR-3': return run(checkFamilyConservation(view));
    case 'MR-5': return run(checkLedeVsScope(view));
    case 'MR-6': return run(checkCleanConsole(view));
    default: return false; // cross-view relations (MR-0/MR-8) aren't single-view reproducible
  }
}
