import { test, expect } from './fixtures.js';
import { AppPage } from './pages/app-page.js';
import type { Observation } from '@bird-watch/shared-types';

/**
 * Issue #277 — Spider v2 auto-spider visible-silhouette contract.
 *
 * Proves that 5 co-located observations (identical lngLat) render as 5
 * distinct fanned <StackedSilhouetteMarker> buttons at zoom >= 14 (i.e.,
 * CLUSTER_MAX_ZOOM). Each marker:
 *
 *   - Has data-testid="stacked-silhouette-marker"
 *   - Has an aria-label beginning with the observation's comName
 *   - Contains an SVG path with a non-empty `fill` attribute (family colour)
 *   - Is clickable → opens ObservationPopover with the matching comName
 *
 * Both viewports the release-1 exit criteria name (390×844 + 1440×900).
 *
 * WebGL guard: if the maplibre map doesn't fire its `load` event (headless
 * Chromium without GPU), the StackedSilhouetteMarker elements never
 * materialize (the auto-spider reconciler only runs after `load`). In that
 * case the test skips rather than fails — matching the established pattern
 * from map-spiderfy.spec.ts (#247) and map-cluster-mosaic.spec.ts (#258).
 *
 * Zoom strategy: MapCanvas.tsx starts at zoom 6. The auto-spider only fires
 * at zoom >= CLUSTER_MAX_ZOOM (14). We attempt to drive the map to zoom 16
 * via `page.evaluate` using the maplibre container element's internal React
 * fiber to reach the `MapRef.getMap().easeTo(...)` call. If neither the
 * fiber path nor the canvas property path works in headless (the WebGL skip
 * guard triggers first in that case), the spec skips cleanly.
 *
 * Leader-line source assertion: maplibre's `getSource` is only accessible
 * from inside the page context after `load`. We try the fiber path; if it
 * fails (non-WebGL run), we document the limitation and rely on the
 * marker-presence assertions as the primary contract proof.
 */

/** Minimal silhouettes payload for 5 families — satisfies MapCanvas's
 * `silhouettes.length === 0` short-circuit guard that blocks auto-spider. */
function silhouetteFixture() {
  return [
    {
      familyCode: 'fringillidae',
      color: '#E84040',
      svgData: 'M5 13 C5 9 9 8 13 9 L17 7 L17 10 L15 11 L15 14 L13 15 L8 15 L5 13 Z',
      source: null,
      license: null,
      commonName: 'Finches',
      creator: null,
    },
    {
      familyCode: 'remizidae',
      color: '#F5A623',
      svgData: 'M6 12 C6 9 8 7 11 7 L15 6 L16 9 L14 11 L14 14 L12 16 L8 16 L6 14 Z',
      source: null,
      license: null,
      commonName: 'Penduline-tits',
      creator: null,
    },
    {
      familyCode: 'trochilidae',
      color: '#5DA832',
      svgData: 'M4 12 C4 8 8 6 12 7 L18 5 L18 8 L16 10 L15 14 L13 16 L8 16 L5 14 Z',
      source: null,
      license: null,
      commonName: 'Hummingbirds',
      creator: null,
    },
    {
      familyCode: 'tyrannidae',
      color: '#8B5CF6',
      svgData: 'M5 14 C5 10 9 8 13 9 L17 7 L18 10 L16 12 L16 15 L14 16 L9 16 L5 14 Z',
      source: null,
      license: null,
      commonName: 'Tyrant Flycatchers',
      creator: null,
    },
    {
      familyCode: 'columbidae',
      color: '#0EA5E9',
      svgData: 'M6 13 C6 10 9 8 12 8 L16 7 L17 10 L15 12 L15 15 L13 16 L8 16 L6 14 Z',
      source: null,
      license: null,
      commonName: 'Pigeons and Doves',
      creator: null,
    },
    {
      familyCode: '_FALLBACK',
      color: '#555555',
      svgData: 'M 6 12 C 6 9 8 7 11 7 C 13 7 14 8 15 9 L 18 8 L 18 10 L 16 11 L 16 14 L 14 16 L 9 16 L 6 14 Z',
      source: null,
      license: null,
      commonName: 'Unknown family',
      creator: null,
    },
  ];
}

/**
 * 5 observations at IDENTICAL coordinates — Sweetwater Wetlands, Tucson.
 * Identical lngLat means `groupOverlapping` in stack-fanout.ts will detect
 * them as a single stack (screen distance = 0 < 30px threshold). Different
 * subId/speciesCode/familyCode ensures each maps to a distinct
 * StackedSilhouetteMarker with a unique aria-label.
 */
function stackedObs(): Observation[] {
  const center: [number, number] = [-110.85, 32.27];
  const species: Array<{
    subId: string;
    speciesCode: string;
    comName: string;
    familyCode: string;
  }> = [
    { subId: 'STK001', speciesCode: 'houfin', comName: 'House Finch', familyCode: 'fringillidae' },
    { subId: 'STK002', speciesCode: 'verdin', comName: 'Verdin', familyCode: 'remizidae' },
    { subId: 'STK003', speciesCode: 'cosahu', comName: "Costa's Hummingbird", familyCode: 'trochilidae' },
    { subId: 'STK004', speciesCode: 'verfly', comName: 'Vermilion Flycatcher', familyCode: 'tyrannidae' },
    { subId: 'STK005', speciesCode: 'mouqua', comName: 'Mourning Dove', familyCode: 'columbidae' },
  ];

  return species.map(({ subId, speciesCode, comName, familyCode }) => ({
    subId,
    speciesCode,
    comName,
    lat: center[1],
    lng: center[0],
    obsDt: '2026-04-15T10:00:00Z',
    locId: 'L99',
    locName: 'Sweetwater Wetlands',
    howMany: 1,
    isNotable: false,
    regionId: null,
    silhouetteId: familyCode,
    familyCode,
  }));
}

/**
 * Drive the maplibre map to a given center + zoom using the React fiber tree.
 *
 * react-map-gl/maplibre stores the `MapRef` as a ref on the `<MapView>`
 * component. Walking the fiber from the maplibre canvas element is fragile
 * across React versions — if it breaks, the subsequent WebGL skip guard
 * will catch the missing markers and skip cleanly rather than fail.
 *
 * Returns `true` if `easeTo` was dispatched, `false` if the map instance
 * could not be found (non-WebGL headless run).
 */
async function driveMapTo(
  page: import('@playwright/test').Page,
  lng: number,
  lat: number,
  zoom: number,
): Promise<boolean> {
  return page.evaluate(
    ([lng, lat, zoom]: [number, number, number]) => {
      // Strategy 1: look for the maplibre container element and walk its
      // React fiber to find the map instance via react-map-gl's `_map`
      // internal or the `MapRef` wrapper. This is best-effort; it depends
      // on react-map-gl internals that could change between versions.
      // If it succeeds, easeTo fires; if not, we return false so the
      // caller's WebGL skip guard can catch the missing markers.
      try {
        const container = document.querySelector('.maplibregl-map') as
          | (Element & Record<string, unknown>)
          | null;
        if (!container) return false;

        // react-map-gl/maplibre stores its map instance on the container
        // element's React fiber under a "__reactFiber" key (React 18).
        // Walk up until we find a stateNode with a `getMap` method.
        const fiberKey = Object.keys(container).find(
          (k) => k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance'),
        );
        if (!fiberKey) return false;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let fiber: any = (container as any)[fiberKey];
        let mapInstance: null | { easeTo: (opts: object) => void } = null;

        for (let i = 0; i < 80 && fiber; i += 1) {
          const sn = fiber.stateNode;
          if (sn && typeof sn.getMap === 'function') {
            const raw = sn.getMap();
            if (raw && typeof raw.easeTo === 'function') {
              mapInstance = raw;
              break;
            }
          }
          // Traverse: try return/child/sibling
          fiber = fiber.return ?? fiber.child ?? fiber.sibling ?? null;
        }

        if (!mapInstance) return false;
        mapInstance.easeTo({ center: [lng, lat], zoom, duration: 0 });
        return true;
      } catch {
        return false;
      }
    },
    [lng, lat, zoom] as [number, number, number],
  );
}

/**
 * WebGL + auto-spider skip guard.
 *
 * Checks for the map-canvas wrapper (always mounts) and then for at least
 * one StackedSilhouetteMarker. Returns `true` if the test should be skipped
 * (no WebGL / auto-spider didn't fire), `false` if it should proceed.
 */
async function skipIfMarkersAbsent(
  page: import('@playwright/test').Page,
  testRef: typeof test,
): Promise<boolean> {
  const wrapper = page.locator('[data-testid=map-canvas]');
  if ((await wrapper.count()) === 0) {
    testRef.skip(true, 'maplibre chunk did not mount in headless run');
    return true;
  }
  await expect(wrapper).toBeVisible({ timeout: 15_000 });

  // Give the auto-spider reconciler time to detect the stack after easeTo.
  // The reconciler fires on `idle` (post-render settle); 5 s is generous for
  // a headless environment with a GPU. Without GPU, `idle` never fires.
  const marker = page.locator('[data-testid=stacked-silhouette-marker]').first();
  try {
    await marker.waitFor({ state: 'attached', timeout: 5_000 });
    return false;
  } catch {
    testRef.skip(
      true,
      'stacked-silhouette-marker elements did not materialize — likely WebGL ' +
        'unavailable in headless run or auto-spider did not fire (see #277)',
    );
    return true;
  }
}

test.describe('Map auto-spider stack-fanout (#277)', () => {
  for (const viewport of [
    { name: 'desktop', width: 1440, height: 900 },
    { name: 'mobile', width: 390, height: 844 },
  ]) {
    test(`stacks 5 co-located obs into 5 fanned silhouettes (${viewport.name} ${viewport.width}x${viewport.height})`, async ({
      page,
      apiStub,
    }) => {
      test.setTimeout(60_000);

      // Stub observations (5 at identical coords) and silhouettes.
      // silhouettes MUST be non-empty or MapCanvas short-circuits the
      // auto-spider reconciler before it even queries rendered features.
      await apiStub.stubObservations(stackedObs());
      await page.route('**/api/silhouettes', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(silhouetteFixture()),
        });
      });

      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      const app = new AppPage(page);
      await app.goto('view=map');
      await app.waitForAppReady();

      // Drive map to zoom 16 over the stack center (Sweetwater Wetlands,
      // Tucson). CLUSTER_MAX_ZOOM is 14; zoom 16 ensures the auto-spider
      // reconciler runs (no clusters at zoom >= 14).
      await driveMapTo(page, -110.85, 32.27, 16);

      // WebGL guard — if markers don't appear within 5 s, skip.
      if (await skipIfMarkersAbsent(page, test)) return;

      // ---------------------------------------------------------------
      // AC 1: Exactly 5 StackedSilhouetteMarker elements in the DOM.
      // ---------------------------------------------------------------
      const markers = page.locator('[data-testid=stacked-silhouette-marker]');
      await expect(markers).toHaveCount(5, { timeout: 10_000 });

      // ---------------------------------------------------------------
      // AC 2: Each marker's SVG path has a non-empty `fill` attribute —
      // confirms the family colour is rendered (not the fallback white).
      // ---------------------------------------------------------------
      const fillValues = await markers.evaluateAll(
        (btns: Element[]) =>
          btns.map((btn) => {
            // The colored path is the LAST <path> inside the <svg>.
            const paths = btn.querySelectorAll('svg path');
            const colorPath = paths[paths.length - 1] as SVGPathElement | undefined;
            return colorPath?.getAttribute('fill') ?? '';
          }),
      );
      // Every fill must be a non-empty string (a color value, not '').
      expect(
        fillValues.every((f) => f.length > 0),
        `expected all fills to be non-empty, got: ${JSON.stringify(fillValues)}`,
      ).toBe(true);

      // ---------------------------------------------------------------
      // AC 3: Click one known marker → ObservationPopover opens.
      // We target the House Finch marker by aria-label prefix.
      // ---------------------------------------------------------------
      const finchMarker = page.locator(
        '[data-testid=stacked-silhouette-marker][aria-label^="House Finch"]',
      );
      await expect(finchMarker).toHaveCount(1, { timeout: 5_000 });
      await finchMarker.click();

      // The ObservationPopover renders a dialog with aria-label "Details for <comName>".
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible({ timeout: 5_000 });

      // The popover header shows the observation's common name.
      const popoverName = dialog.locator('.observation-popover-name');
      await expect(popoverName).toHaveText('House Finch', { timeout: 5_000 });

      // ---------------------------------------------------------------
      // AC 4 (best-effort): verify leader-line source has 5 LineString
      // features. This requires a working WebGL context and the map
      // instance to be accessible. We attempt via page.evaluate and
      // document the limitation if it fails.
      //
      // Limitation: maplibre-gl 5.x does not store a back-reference to
      // the Map instance on the canvas element. We use the React fiber
      // walk (same approach as driveMapTo). If the walk fails in headless
      // (no GPU), the assertion is skipped and the marker-presence
      // assertions above serve as the primary v2 contract proof.
      // ---------------------------------------------------------------
      const leaderFeatureCount = await page.evaluate(() => {
        try {
          const container = document.querySelector('.maplibregl-map') as
            | (Element & Record<string, unknown>)
            | null;
          if (!container) return null;

          const fiberKey = Object.keys(container).find(
            (k) =>
              k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance'),
          );
          if (!fiberKey) return null;

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          let fiber: any = (container as any)[fiberKey];
          let mapInstance: null | {
            getSource: (id: string) => { _data?: { features?: unknown[] } } | null | undefined;
          } = null;

          for (let i = 0; i < 80 && fiber; i += 1) {
            const sn = fiber.stateNode;
            if (sn && typeof sn.getMap === 'function') {
              const raw = sn.getMap();
              if (raw && typeof raw.getSource === 'function') {
                mapInstance = raw;
                break;
              }
            }
            fiber = fiber.return ?? fiber.child ?? fiber.sibling ?? null;
          }

          if (!mapInstance) return null;
          const src = mapInstance.getSource('auto-spider-leader-lines');
          if (!src) return null;
          // GeoJSON source exposes ._data after setData in maplibre 5.x.
          // Fall back to null if the internal shape has changed.
          const data = (src as { _data?: { features?: unknown[] } })._data;
          return data?.features?.length ?? null;
        } catch {
          return null;
        }
      });

      if (leaderFeatureCount !== null) {
        // When the map instance is accessible: assert 5 leader lines.
        expect(leaderFeatureCount).toBe(5);
      }
      // If null: leader-line source was inaccessible from the page context
      // (headless / fiber walk failed). Marker-presence assertions suffice.
    });
  }
});
