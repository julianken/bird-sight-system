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
      // V3/V7: the long name must NOT be single-line-ellipsis-truncated (which drops
      // the head noun). Prove it font-independently — works whether the CI font fits
      // it on one line or wraps it to two:
      const metrics = await labelEl.evaluate((el) => {
        const cs = getComputedStyle(el);
        return {
          lineClamp: cs.webkitLineClamp,            // '2' = multi-line clamp, not single-line ellipsis
          whiteSpace: cs.whiteSpace,                 // must NOT be 'nowrap'
          scrollWidth: el.scrollWidth,
          clientWidth: el.clientWidth,
          clientHeight: el.clientHeight,
          lineHeight: parseFloat(cs.lineHeight),
        };
      });
      // (a) multi-line clamp, not a single-line nowrap+ellipsis:
      expect(metrics.lineClamp, 'label uses 2-line clamp (not single-line ellipsis)').toBe('2');
      expect(metrics.whiteSpace, 'label is allowed to wrap').not.toBe('nowrap');
      // (b) the full label is not horizontally clipped — scrollWidth never exceeds the
      //     box width whether it sits on one line (fits) or wraps to two (each line fits):
      expect(
        metrics.scrollWidth,
        `label not horizontally ellipsis-clipped (scrollWidth ${metrics.scrollWidth} ≤ clientWidth ${metrics.clientWidth})`,
      ).toBeLessThanOrEqual(metrics.clientWidth + 1);
      // (c) clamped at MOST two lines tall (never a 3+ line overflow):
      expect(
        metrics.clientHeight,
        `label clamped to ≤2 lines (${metrics.clientHeight}px ≤ ${metrics.lineHeight * 2 + 2}px)`,
      ).toBeLessThanOrEqual(metrics.lineHeight * 2 + 2);
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
    // The component measured an overflow and stamped the flag on the <ul>…
    await expect(list).toHaveAttribute('data-overflow', 'true');
    // …and the fade is now painted on the CARD (.family-legend::after), lifted
    // off the <ul> via :has() so it spans the full inner width and hugs the
    // bottom rounded corners regardless of the scrollbar gutter.
    const card = page.locator('.family-legend');
    const fadeHeight = await card.evaluate((el) =>
      parseFloat(getComputedStyle(el, '::after').height),
    );
    expect(
      fadeHeight,
      'the overflow ::after fade must have a non-zero height at rest',
    ).toBeGreaterThan(0);
    // Geometry pin: the fade must seat FLUSH against the card's inner border
    // edge — NOT the old narrow inset width (list padding + classic scrollbar
    // gutter made the <ul>-::after lopsided: 9px left / ~20px right), and NOT
    // inset 1px from the padding box (which double-counts the border and leaves
    // a ~1px hairline gap at the rounded bottom corner). Absolute insets are
    // measured from the card's padding box (already inside the 1px border), so
    // inset:0 lands flush on the inner edge: fadeWidth === cardWidth − 2×border.
    // The ≤1px tolerance is tight enough to FAIL the old inset-inline:1px (which
    // rendered ~2.3px short of the inner width); ≤3px let that bug pass.
    const geo = await card.evaluate((el) => {
      const after = getComputedStyle(el, '::after');
      const cs = getComputedStyle(el);
      return {
        fadeWidth: parseFloat(after.width),
        left: parseFloat(after.left),
        right: parseFloat(after.right),
        cardWidth: el.getBoundingClientRect().width,
        borderLeft: parseFloat(cs.borderLeftWidth),
        borderRight: parseFloat(cs.borderRightWidth),
      };
    });
    const innerWidth = geo.cardWidth - geo.borderLeft - geo.borderRight;
    // (a) the fade spans the FULL inner width — flush, not 1px short:
    expect(
      Math.abs(geo.fadeWidth - innerWidth),
      `the fade must seat flush to the inner border edge (fade ${geo.fadeWidth}px vs inner ${innerWidth}px)`,
    ).toBeLessThanOrEqual(1);
    // (b) symmetric — equal left/right insets (no lopsided gutter, no 1px skew):
    expect(
      Math.abs(geo.left - geo.right),
      `the fade insets must be symmetric (left ${geo.left}px vs right ${geo.right}px)`,
    ).toBeLessThanOrEqual(1);
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
