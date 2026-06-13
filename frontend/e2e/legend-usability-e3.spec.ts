import { test, expect } from './fixtures.js';
import { AppPage } from './pages/app-page.js';
import type { Observation } from '@bird-watch/shared-types';

/**
 * E3 (#1055) — family-legend usability pass.
 *
 * Locks the new affordances at the integration level:
 *   - the chevron is a ≥16px SVG (not the near-invisible --type-xs ▸ glyph),
 *   - long colloquial family names keep their final (distinguishing) noun
 *     instead of single-line-ellipsis dropping it,
 *   - the entries list shows a bottom fade cue at rest when it overflows,
 *   - an expanded-but-empty viewport shows a muted row (aria-expanded stays
 *     true), and a collapsed empty viewport shows a non-interactive pill.
 *
 * Repo e2e conventions: page.goto() via the POM; LIFO route stubs; no DB
 * writes; no per-spec retries. All silhouettes/observations are stubbed so the
 * assertions are deterministic and don't depend on the seeded DB.
 */

// A long colloquial name whose FINAL noun ("Parrots") is exactly what the old
// single-line ellipsis cut. Named explicitly so the wrap assertion can't pass
// vacuously on a short-name payload (reviewer addendum, #1055 finding 5).
const LONG_LABEL = 'African & New World Parrots';
const LONG_LABEL_FINAL_NOUN = 'Parrots';

function silhouette(familyCode: string, commonName: string, color = '#3B7A57') {
  return {
    familyCode,
    color,
    colorDark: color,
    // A trivially valid path; the swatch render is not under test here.
    svgData: 'M5 13 C5 9 9 8 13 9 L17 7 L17 10 L15 11 L15 14 L13 15 L8 15 L5 13 Z',
    svgUrl: null,
    source: null,
    license: null,
    commonName,
    creator: null,
  };
}

function obs(subId: string, familyCode: string): Observation {
  return {
    subId,
    speciesCode: 'vermfly',
    comName: 'X',
    familyCode,
    lat: 32.2217,
    lng: -110.9265,
    locId: `L-${subId}`,
    locName: 'Tucson, AZ',
    obsDt: '2026-05-30T12:00:00Z',
    howMany: 1,
    isNotable: false,
    silhouetteId: null,
  };
}

/** Register LIFO-safe stubs with a caller-supplied silhouette + observation set. */
async function setupRoutes(
  page: import('@playwright/test').Page,
  apiStub: import('./fixtures.js').ApiStub,
  silhouettes: ReturnType<typeof silhouette>[],
  observations: Observation[],
): Promise<void> {
  await apiStub.stubEmpty();
  await apiStub.stubObservations(observations);
  await page.route('**/api/silhouettes', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(silhouettes),
    });
  });
}

/** Seed the active tier's expanded key so the legend mounts expanded. */
async function seedExpanded(
  page: import('@playwright/test').Page,
  tier: 'compact' | 'roomy' | 'wide',
): Promise<void> {
  await page.addInitScript((key) => {
    try {
      window.localStorage.setItem(key, 'true');
    } catch {
      /* noop */
    }
  }, `family-legend-expanded.v3.${tier}`);
}

// ─── chevron affordance ───────────────────────────────────────────────────────
for (const { width, height, tier, label } of [
  { width: 390, height: 844, tier: 'compact' as const, label: 'mobile' },
  { width: 1440, height: 900, tier: 'wide' as const, label: 'desktop' },
]) {
  test.describe(`E3 (#1055): chevron is a ≥16px SVG (${label} ${width}×${height})`, () => {
    test.use({ viewport: { width, height } });

    test('the toggle chevron renders as a 16×16 SVG', async ({ page, apiStub }) => {
      await setupRoutes(
        page,
        apiStub,
        [silhouette('tyrannidae', 'Tyrant Flycatchers')],
        [obs('S1', 'tyrannidae')],
      );
      await seedExpanded(page, tier);
      const app = new AppPage(page);
      await app.goto('view=map');
      await app.waitForAppReady();

      const chevron = page.locator('svg.family-legend-chevron');
      await expect(chevron).toBeVisible();
      const box = await chevron.boundingBox();
      expect(box, 'chevron SVG not found').not.toBeNull();
      // The rendered glyph is at least 16px in both dimensions (the contract
      // floor; the old --type-xs ▸ was well under that).
      expect(box!.width).toBeGreaterThanOrEqual(16);
      expect(box!.height).toBeGreaterThanOrEqual(16);
    });
  });
}

// ─── long-label wrap: the final noun survives ─────────────────────────────────
for (const { width, height, tier, label } of [
  { width: 390, height: 844, tier: 'compact' as const, label: 'mobile' },
  { width: 1440, height: 900, tier: 'wide' as const, label: 'desktop' },
]) {
  test.describe(`E3 (#1055): long family label keeps its final noun (${label} ${width}×${height})`, () => {
    test.use({ viewport: { width, height } });

    test(`"${LONG_LABEL}" renders its final noun "${LONG_LABEL_FINAL_NOUN}" (no head-noun ellipsis loss)`, async ({
      page,
      apiStub,
    }) => {
      await setupRoutes(
        page,
        apiStub,
        [silhouette('psittacidae', LONG_LABEL)],
        [obs('S1', 'psittacidae')],
      );
      await seedExpanded(page, tier);
      const app = new AppPage(page);
      await app.goto('view=map');
      await app.waitForAppReady();

      const labelEl = page.locator('.family-legend-entry-label');
      await expect(labelEl).toBeVisible();
      // The full text (incl. the final noun) is present in the DOM…
      await expect(labelEl).toHaveText(LONG_LABEL);
      // …and is NOT clipped by single-line ellipsis: a two-line wrap means the
      // rendered box is taller than one line. Assert ≥ ~2 lines tall.
      const box = await labelEl.boundingBox();
      const lineHeightPx = await labelEl.evaluate(
        (el) => parseFloat(getComputedStyle(el).lineHeight),
      );
      expect(box, 'label box missing').not.toBeNull();
      expect(
        box!.height,
        `label height ${box!.height.toFixed(1)}px should span ~2 lines (lineHeight ${lineHeightPx}px) — the long name must wrap, not single-line-ellipsis`,
      ).toBeGreaterThan(lineHeightPx * 1.5);
    });
  });
}

// ─── overflow cue at rest ─────────────────────────────────────────────────────
test.describe('E3 (#1055): overflow cue is visible at rest when the list overflows', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('data-overflow=true paints a bottom fade when scrollHeight > clientHeight', async ({
    page,
    apiStub,
  }) => {
    // Many families → the entries list exceeds the ≤480px 240px cap → overflow.
    const many = Array.from({ length: 30 }, (_, i) => {
      const code = `fam${i.toString().padStart(2, '0')}`;
      return { sil: silhouette(code, `Family Number ${i}`), ob: obs(`S${i}`, code) };
    });
    await setupRoutes(
      page,
      apiStub,
      many.map((m) => m.sil),
      many.map((m) => m.ob),
    );
    await seedExpanded(page, 'compact');
    const app = new AppPage(page);
    await app.goto('view=map');
    await app.waitForAppReady();

    const list = page.locator('.family-legend-entries');
    await expect(list).toBeVisible();
    // The component measured an overflow and stamped the flag…
    await expect(list).toHaveAttribute('data-overflow', 'true');
    // …and the ::after fade pseudo-element is painted (non-zero height) at rest.
    const fadeHeight = await list.evaluate((el) =>
      parseFloat(getComputedStyle(el, '::after').height),
    );
    expect(
      fadeHeight,
      'the overflow ::after fade must have a non-zero height at rest',
    ).toBeGreaterThan(0);
  });

  test('no overflow flag when the list fits', async ({ page, apiStub }) => {
    await setupRoutes(
      page,
      apiStub,
      [silhouette('tyrannidae', 'Tyrant Flycatchers')],
      [obs('S1', 'tyrannidae')],
    );
    await seedExpanded(page, 'compact');
    const app = new AppPage(page);
    await app.goto('view=map');
    await app.waitForAppReady();

    const list = page.locator('.family-legend-entries');
    await expect(list).toBeVisible();
    await expect(list).toHaveAttribute('data-overflow', 'false');
  });
});

// ─── empty / zero-in-view honesty ─────────────────────────────────────────────
test.describe('E3 (#1055): empty-viewport honesty', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('expanded with zero in-view families shows the muted row and keeps aria-expanded=true', async ({
    page,
    apiStub,
  }) => {
    // Silhouettes exist (so the legend mounts), but NO observations → zero
    // entries to count. Expanded preference seeded for the wide tier.
    await setupRoutes(
      page,
      apiStub,
      [silhouette('tyrannidae', 'Tyrant Flycatchers')],
      [],
    );
    await seedExpanded(page, 'wide');
    const app = new AppPage(page);
    await app.goto('view=map');
    await app.waitForAppReady();

    const toggle = page.getByRole('button', { name: /bird families in view/i });
    await expect(toggle).toBeVisible({ timeout: 10_000 });
    // aria-expanded stays truthful (the legend IS expanded).
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    // The muted empty row is shown rather than a bare header.
    await expect(page.locator('.family-legend-empty')).toBeVisible();
    await expect(page.locator('.family-legend-empty')).toContainText(/no birds in this view/i);
    // No entry rows.
    await expect(page.getByTestId('family-legend-entry')).toHaveCount(0);
  });

  test('collapsed with zero in-view families shows a non-interactive "No families in view" pill', async ({
    page,
    apiStub,
  }) => {
    await setupRoutes(
      page,
      apiStub,
      [silhouette('tyrannidae', 'Tyrant Flycatchers')],
      [],
    );
    // Seed COLLAPSED so the zero-state pill (not the muted row) is exercised.
    await page.addInitScript((key) => {
      try {
        window.localStorage.setItem(key, 'false');
      } catch {
        /* noop */
      }
    }, 'family-legend-expanded.v3.wide');
    const app = new AppPage(page);
    await app.goto('view=map');
    await app.waitForAppReady();

    const pill = page.getByRole('button', { name: /no families in view/i });
    await expect(pill).toBeVisible({ timeout: 10_000 });
    await expect(pill).toBeDisabled();
    await expect(page.locator('.family-legend')).toHaveAttribute('data-empty', 'true');
  });
});
