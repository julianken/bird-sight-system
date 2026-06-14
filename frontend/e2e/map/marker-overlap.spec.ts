import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { AppPage } from '../pages/app-page.js';

/**
 * Marker overlap deconflict acceptance (issue #554).
 *
 * Drives the map to 6 deterministic zoom levels across 5 canonical
 * viewports (30 measurements total) and asserts zero pairwise rendered-
 * marker overlap area at each. The deconflict layer is the system under
 * test: it groups overlapping clusters via Union-Find on AABB
 * intersection and surfaces one anchor marker per group, NEVER two
 * overlapping markers on screen.
 *
 * Issue #554 scope expansion (2026-05-15): silhouettes from the
 * unclustered-point symbol layer are now first-class deconflict inputs.
 * When a silhouette would overlap a cluster anchor, deconflict shifts
 * it ≤20px aside via `displaceSilhouettes`; the canvas-painted twin is
 * hidden via the `hidden` feature-state (promoteId="subId"). This spec
 * combines DOM marker rects + symbol-layer feature rects (skipping
 * hidden ones) in the pairwise overlap measurement.
 *
 * ── Exclusion-zone contract (V1 / issue #788) ────────────────────────────────
 *
 * No marker rendered into a region covered by a persistent overlay
 * (`.family-legend`, `.scope-control`, `.map-context-strip` once O3 makes it
 * floating, `.observation-popover`) may have non-zero AABB intersection area
 * with that overlay. Two assertions enforce this:
 *
 *   • **390×844 (iphone-14-pro) — full overlay set:**
 *     `expect(result.marker_overlay_overlap_area).toBe(0)` over the complete
 *     persistent-overlay set. At 390px the legend is the binding occluder:
 *     before O5 it widened to ~94% of the viewport via the old uncapped
 *     `@media (max-width:760px)` rule and sat over the entire bottom-band of
 *     markers. O5 (#783) capped it to ≤280px at ≤480px; V1 verifies that cap.
 *     RED-by-construction on pre-O5 `main`; GREEN once O5 is merged.
 *
 *   • **1440×900 (desktop-standard) — legend-only set:**
 *     `expect(result.marker_legend_overlap_area).toBe(0)` over the single
 *     `.family-legend` rect only. The 1440px control scope is deliberately
 *     narrower because: (a) `.map-context-strip` is a flow sibling ABOVE
 *     `.map-surface` on current `main` (no `position` rule, cannot intersect
 *     a canvas marker rect); (b) `.scope-control` is `fit-content`/top-center,
 *     narrow on desktop, and any occlusion it causes is governed by O3/O6's
 *     relocation, NOT by O5. Folding scope-control/strip into the O5-gated
 *     desktop assertion would falsely couple V1 to O3. The legend's
 *     width-widening is `@media max-width:760px`-gated (`styles.css:976-979`),
 *     so the desktop legend is content-sized and never reaches the marker band
 *     regardless of O5. This control is GREEN on current `main` independently
 *     of O5 and is pure desktop regression coverage.
 *
 * The contract is satisfied physically by O5 (legend mobile-width cap) + O2
 * (legend hoist to persistent App-root `position:fixed`). Silhouettes always
 * remain visible — `deconflict.ts:319-326` "silhouettes MUST REMAIN VISIBLE
 * — no suppression, no hiding" invariant is preserved; the contract is met by
 * overlay geometry, not by hiding markers.
 *
 * Do NOT relax either assertion to `<= residual` — a non-zero value IS the
 * signal that an overlay geometry change has broken the contract. Treat it as
 * a Tier-1 finding. Precedent: the strict-zero rationale already in this file
 * at the `total_overlap_area` assertion below.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const ZOOM_LEVELS = [5, 6, 8, 10, 12, 14];

const VIEWPORTS = [
  { name: 'iphone-14-pro', w: 390, h: 844 },
  { name: 'ipad-portrait', w: 768, h: 1024 },
  { name: 'ipad-landscape', w: 1024, h: 768 },
  { name: 'desktop-standard', w: 1440, h: 900 },
  { name: 'desktop-wide', w: 1920, h: 1080 },
] as const;

interface OverlapResult {
  marker_count: number;
  total_overlap_area: number;
  worst_overlap_area: number;
  /** V1 (#788): pairwise AABB intersection, each marker rect × each persistent-overlay rect (full set). */
  marker_overlay_overlap_area: number;
  /** V1 (#788): pairwise AABB intersection, each marker rect × the `.family-legend` rect only.
   *  Kept separate from the full-set measurement so the 1440px desktop control asserts only
   *  what O5 governs (legend width-widening is @media max-width:760px-gated; at 1440px the
   *  legend is content-sized regardless of O5 status, giving a clean O5-independent control). */
  marker_legend_overlap_area: number;
  /** E6 (#1058): worst pairwise overlap RATIO among displaced-silhouette twins,
   *  as intersectionArea / min(bboxA, bboxB) area (denominator pinned to the
   *  smaller bbox per #1058 reviewer addendum #2). The collision/spiral pass
   *  (`resolveDisplacedCollisions`) must keep this ≤ 0.25 — twins from adjacent
   *  groups may no longer pile into the "Yuma clump". 0 when <2 twins. */
  worst_twin_overlap_ratio: number;
}

// NOTE: the top-level `pairwiseArea` helper that used to live here was removed
// (V1 #814 deferred nit). It was never called — the actual occlusion math runs
// as the in-page `pairArea` function inside `page.evaluate` in `measureOverlap`
// below. Keeping both would risk future drift between the two implementations.

async function measureOverlap(page: Page): Promise<OverlapResult> {
  return await page.evaluate<OverlapResult>(() => {
    // ── Marker collection ────────────────────────────────────────────────────
    // DOM-based markers: AdaptiveGridMarker, ClusterPill, displaced silhouettes.
    const grids = Array.from(
      document.querySelectorAll('[data-testid="adaptive-grid-marker"]'),
    );
    const pills = Array.from(document.querySelectorAll('.cluster-pill'));
    const displacedSils = Array.from(
      document.querySelectorAll('[data-testid="displaced-silhouette"]'),
    );
    const domItems = [...grids, ...pills, ...displacedSils].map((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.left, y: r.top, w: r.width, h: r.height };
    });

    // Canvas-rendered silhouettes (unclustered-point symbol layer) that
    // are NOT hidden by feature-state. The displacement path sets
    // `hidden: true` on a silhouette feature when its React twin is
    // shown by the displaced-silhouette overlay; both the spec and the
    // visual user agree those should not count toward overlap area.
    interface MapForTests {
      queryRenderedFeatures: (
        q: unknown,
        opts: { layers: string[] },
      ) => Array<{
        properties?: { subId?: string };
        geometry?: { type: 'Point'; coordinates: [number, number] };
      }>;
      getFeatureState: (s: object) => Record<string, unknown>;
      project: (ll: [number, number]) => { x: number; y: number };
    }
    const map = (window as unknown as { __mapForTests?: MapForTests })
      .__mapForTests;
    const symBoxes: Array<{ x: number; y: number; w: number; h: number }> = [];
    if (map) {
      const symFeats = map.queryRenderedFeatures(undefined, {
        layers: ['unclustered-point'],
      });
      for (const f of symFeats) {
        const subId = f.properties?.subId;
        if (!subId) continue;
        const state = map.getFeatureState({
          source: 'observations',
          id: subId,
        });
        if (state?.hidden) continue;
        const geom = f.geometry;
        if (!geom || geom.type !== 'Point') continue;
        const [lng, lat] = geom.coordinates;
        const p = map.project([lng, lat]);
        // 28×28 silhouette extent (SILHOUETTE_PX), centered at projection.
        symBoxes.push({ x: p.x - 14, y: p.y - 14, w: 28, h: 28 });
      }
    }

    const items = [...domItems, ...symBoxes];

    // ── Marker-vs-marker overlap (existing contract — byte-for-byte unchanged) ──
    let total = 0;
    let worst = 0;
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const a = items[i]!;
        const b = items[j]!;
        const ox = Math.max(
          0,
          Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x),
        );
        const oy = Math.max(
          0,
          Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y),
        );
        if (ox > 0 && oy > 0) {
          const area = ox * oy;
          total += area;
          if (area > worst) worst = area;
        }
      }
    }

    // ── Persistent-overlay collection (V1 / #788) ────────────────────────────
    // Rects are read live via getBoundingClientRect so they track the
    // responsive legend width (e.g. ≤280px at ≤480px after O5, content-sized
    // at 1440px). Overlays absent from the DOM contribute no rect (e.g.
    // .map-context-strip was removed in #800; .observation-popover only mounts
    // while a popover is open — both yield empty arrays and contribute zero).
    // Do NOT fold overlayBoxes into `items` — that would also count
    // overlay-vs-overlay pairs, which is out of scope.
    type Rect = { x: number; y: number; w: number; h: number };
    function elToRect(el: Element): Rect {
      const r = el.getBoundingClientRect();
      return { x: r.left, y: r.top, w: r.width, h: r.height };
    }
    function queryRects(sel: string): Rect[] {
      return Array.from(document.querySelectorAll(sel)).map(elToRect);
    }

    const legendBoxes  = queryRects('.family-legend');
    // #828: the scope form is collapsed behind the 🔍 disclosure by default, so
    // `.scope-control` is display:none at rest → an empty (zero-area) rect that
    // contributes no marker overlap. It re-enters the exclusion set only when a
    // user expands the disclosure (not exercised here). The marker-occlusion
    // contract still holds: a collapsed control genuinely occludes nothing.
    const scopeBoxes   = queryRects('.scope-control');
    const stripBoxes   = queryRects('.map-context-strip'); // absent on current main (#800)
    const popoverBoxes = queryRects('.observation-popover'); // only when a popover is open

    const overlayBoxes = [...legendBoxes, ...scopeBoxes, ...stripBoxes, ...popoverBoxes];

    // marker_overlay_overlap_area: full overlay set (binding assertion at 390px).
    function pairArea(as: Rect[], bs: Rect[]): number {
      let t = 0;
      for (const a of as) {
        for (const b of bs) {
          const ox = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
          const oy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
          if (ox > 0 && oy > 0) t += ox * oy;
        }
      }
      return t;
    }

    const markerOverlayOverlapArea = pairArea(items, overlayBoxes);
    // marker_legend_overlap_area: legend-only (O5-governed desktop control at 1440px).
    const markerLegendOverlapArea  = pairArea(items, legendBoxes);

    // ── Displaced-twin pairwise overlap RATIO (E6 / #1058) ───────────────────
    // Among the displaced-silhouette twins ONLY, find the worst pairwise overlap
    // ratio = intersectionArea / min(areaA, areaB). The collision/spiral pass
    // must keep this ≤ 0.25 (denominator pinned to the smaller bbox). Uses the
    // displaced-silhouette DOM rects collected above.
    const twinRects = displacedSils.map((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.left, y: r.top, w: r.width, h: r.height };
    });
    let worstTwinRatio = 0;
    for (let i = 0; i < twinRects.length; i++) {
      for (let j = i + 1; j < twinRects.length; j++) {
        const a = twinRects[i]!;
        const b = twinRects[j]!;
        const ox = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
        const oy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
        if (ox <= 0 || oy <= 0) continue;
        const inter = ox * oy;
        const minArea = Math.min(a.w * a.h, b.w * b.h);
        if (minArea <= 0) continue;
        worstTwinRatio = Math.max(worstTwinRatio, inter / minArea);
      }
    }

    return {
      marker_count: items.length,
      total_overlap_area: total,
      worst_overlap_area: worst,
      marker_overlay_overlap_area: markerOverlayOverlapArea,
      marker_legend_overlap_area:  markerLegendOverlapArea,
      worst_twin_overlap_ratio: worstTwinRatio,
    };
  });
}

for (const viewport of VIEWPORTS) {
  for (const zoom of ZOOM_LEVELS) {
    test(`pairwise marker overlap = 0 at zoom ${zoom} on ${viewport.name} (${viewport.w}×${viewport.h})`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: viewport.w, height: viewport.h });
      const app = new AppPage(page);
      await app.goto();
      await app.waitForAppReady();

      // Drive the map to the target zoom and let it settle.
      await page.evaluate((z) => {
        const map = (
          window as unknown as { __mapForTests?: { easeTo: (opts: object) => void } }
        ).__mapForTests;
        if (map) map.easeTo({ zoom: z, duration: 0 });
      }, zoom);
      // Brief settle window — the idle event fires after camera-change
      // + tile-load completes; a fixed delay is the project's existing
      // convention here.
      await page.waitForTimeout(500);

      const result = await measureOverlap(page);

      // ── Marker-vs-marker assertion (unchanged from V2 baseline) ─────────────
      // INTENTIONALLY strict: total_overlap_area must be exactly zero.
      //
      // The silhouette-displacement layer (deconflict.ts displaceSilhouettes)
      // caps displacement at 20px from the geographic position. A silhouette
      // deeply embedded inside a 4×4 grid anchor (100×100) would need ~50px
      // to clear and gets capped at 20, leaving ~30px residual overlap.
      //
      // We assert zero so that this failure mode fires LOUDLY in CI when the
      // seeded fixture ever produces such a geometry. The maintainer then
      // decides: raise the 20px cap, or add a per-marker exception path. Do
      // NOT relax this assertion to `<= someResidual` — that hides the signal.
      //
      // Observed at the time of writing (V2 re-baseline 2026-05-31, full-bleed
      // scope=us/CONUS framing, #map-layer position:fixed;inset:0): the seeded
      // fixture produces zero marker-vs-marker overlap across all 5 viewports ×
      // 6 zooms. The full-bleed canvas is larger than the old windowed shell but
      // the deconflict geometry is shell-agnostic — the 20px displacement cap
      // still resolves all observed cross-overlaps within the seeded fixture.
      expect(
        result.total_overlap_area,
        `marker_count=${result.marker_count}, worst_overlap=${result.worst_overlap_area}px²`,
      ).toBe(0);

      // ── Displaced-twin overlap-ratio assertion (E6 / #1058) ──────────────────
      // No pair of displaced-silhouette twins may overlap by more than 25% of
      // the smaller bbox area. `resolveDisplacedCollisions` (the collision/spiral
      // post-step) enforces this so twins from adjacent groups stop piling into
      // the "Yuma clump". A 0.01 epsilon absorbs subpixel projection rounding;
      // do NOT relax further — a higher value IS the signal the pass regressed.
      expect(
        result.worst_twin_overlap_ratio,
        `[${viewport.name} z${zoom}] worst displaced-twin overlap ratio must be ≤ 0.25 ` +
        `(intersection / smaller-bbox area) — got ${result.worst_twin_overlap_ratio.toFixed(3)}. ` +
        `The collision/spiral pass (resolveDisplacedCollisions) must split overlapping twins (E6 #1058).`,
      ).toBeLessThanOrEqual(0.25 + 0.01);

      // ── Exclusion-zone assertions (V1 / #788) ────────────────────────────────
      // See the header doc block above for the full contract rationale.
      // Do NOT relax to `<= residual` — see strict-zero precedent above.

      if (viewport.name === 'iphone-14-pro') {
        // 390×844 — full overlay set. O5 (#783) caps the legend ≤280px at ≤480px
        // so it no longer covers the bottom-band marker region. GREEN post-O5.
        expect(
          result.marker_overlay_overlap_area,
          `[${viewport.name} z${zoom}] marker_overlay_overlap_area must be 0 — ` +
          `a non-zero value means a persistent overlay (legend/scope-control/strip/popover) ` +
          `is occluding a marker at 390px (R6 / exclusion-zone contract, V1 #788)`,
        ).toBe(0);
      }

      if (viewport.name === 'desktop-standard') {
        // 1440×900 — legend-only set. The legend width-widening is @media
        // max-width:760px-gated (styles.css:976-979), so at 1440px the legend
        // is content-sized and never reaches the marker band regardless of O5.
        // This is a pure desktop regression / over-constraint guard.
        expect(
          result.marker_legend_overlap_area,
          `[${viewport.name} z${zoom}] marker_legend_overlap_area must be 0 — ` +
          `the desktop legend must stay content-sized and clear of the marker band ` +
          `(exclusion-zone contract desktop control, V1 #788)`,
        ).toBe(0);
      }
    });
  }
}
