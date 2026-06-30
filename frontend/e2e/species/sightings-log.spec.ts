import { test, expect } from '../fixtures.js';
import { AppPage } from '../pages/app-page.js';
import type { Observation, SpeciesMeta } from '@bird-watch/shared-types';

/**
 * #1301 (epic #1299) — the Sightings Log inside the desktop species-detail Rail.
 *
 * DETERMINISTIC happy path: drive the single-observation `ObservationPopover`
 * seam (`handlePopoverSelectSpecies`), where the threaded Sightings-Log context
 * is a KNOWN single `Observation`. This avoids relying on real MapLibre
 * clustering to materialize `getClusterLeaves` at a specific coordinate/zoom
 * (fragile under `retries:0` / `fullyParallel`). Multi-leaf species filtering,
 * the visible-row cap, and newest-first ordering are covered at the unit/RTL
 * level (sightings-context / use-sightings-rows / SightingsLog specs).
 *
 * Mirrors `map-symbol-layer.spec.ts`'s hit-layer→popover→detail-link walk; the
 * WebGL-less headless run is tolerated the same way (probe + skip), since the
 * hit-layer only mounts after maplibre fires `load`.
 */

const SILHOUETTES = [
  {
    familyCode: 'tyrannidae',
    color: '#C77A2E',
    svgData: 'M5 13 C5 9 9 8 13 9 L17 7 L17 10 L15 11 L15 14 L13 15 L8 15 L5 13 Z',
    source: null,
    license: null,
    commonName: 'Tyrant Flycatchers',
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

function observationFixture(): Observation[] {
  return [
    {
      subId: 'S-LOG-1',
      speciesCode: 'vermfly',
      comName: 'Vermilion Flycatcher',
      lat: 32.27,
      lng: -110.85,
      obsDt: '2026-04-15T10:00:00Z',
      locId: 'L99',
      locName: 'Sweetwater Wetlands',
      howMany: 4,
      isNotable: false,
      silhouetteId: 'tyrannidae',
      familyCode: 'tyrannidae',
    },
  ];
}

const speciesMetaFixture: SpeciesMeta = {
  speciesCode: 'vermfly',
  comName: 'Vermilion Flycatcher',
  sciName: 'Pyrocephalus rubinus',
  familyCode: 'tyrannidae',
  familyName: 'Tyrannidae',
  taxonOrder: 12345,
};

test.describe('Sightings Log (desktop Rail) — popover seam', () => {
  test.beforeEach(async ({ page, apiStub }) => {
    await page.route('**/api/silhouettes', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(SILHOUETTES),
      });
    });
    await apiStub.stubObservations(observationFixture());
    await apiStub.stubSpecies('vermfly', speciesMetaFixture);
  });

  test('marker → popover → "See species details" renders the single sightings row (1440×900)', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const app = new AppPage(page);
    await app.goto('view=map');
    await app.waitForAppReady();

    // The hit-layer overlay mounts only after maplibre fires `load`; in
    // WebGL-less headless runs it never fires — tolerate that (probe + skip),
    // matching map-symbol-layer.spec.ts. The unit/RTL specs carry the
    // hard coverage; the orchestrator's live Playwright pass covers the rest.
    const hitLayer = page.locator('.map-marker-hit-layer');
    try {
      await hitLayer.waitFor({ state: 'attached', timeout: 5_000 });
    } catch {
      test.skip(true, 'map onLoad did not fire — likely WebGL unavailable in headless run');
      return;
    }
    const hitButton = hitLayer.locator('button').first();
    if ((await hitButton.count()) === 0) {
      test.skip(true, 'hit-layer mounted but no markers projected');
      return;
    }

    await hitButton.click();

    // ObservationPopover → "See species details" drills into the Rail.
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5_000 });
    await dialog.getByRole('button', { name: /see species details/i }).click();

    // The Rail mounts in place over the still-rendered map (?detail=vermfly).
    await expect.poll(() => app.getUrlParams().get('detail'), { timeout: 5_000 }).toBe('vermfly');

    // The Sightings Log renders the clicked observation as exactly one static
    // row carrying its exact location.
    const log = page.getByRole('region', { name: /sightings under this marker/i });
    await expect(log).toBeVisible({ timeout: 5_000 });
    await expect(log.locator('.detail-fg-sighting-row')).toHaveCount(1);
    await expect(log.getByText('Sweetwater Wetlands')).toBeVisible();
    // howMany 4 > 1 → the ×4 count column renders.
    await expect(log.locator('.detail-fg-sighting-count')).toHaveText('×4');
  });
});
