/**
 * Integration test: WCAG 1.4.11 (3:1 non-text contrast) for the family_silhouettes
 * dual-palette against the basemap each value is actually rendered on.
 *
 * Phase 1 Task 1 of the adaptive-grid tile contrast epic (#575, sub-issue #570).
 * This test intentionally starts RED — the current DB palette has 19+ colors
 * that fail the 3:1 threshold against the light basemap. Task 3 fixes the
 * palette via a SQL migration; at that point both assertions turn GREEN.
 *
 * Dual-palette contract (enforced by these tests):
 *   `color`      → rendered in light theme on LIGHT_BASE (#f4f1ea). MUST be ≥ 3:1 vs #f4f1ea.
 *   `color_dark` → rendered in dark theme on DARK_BASE (#0E1116, Phase 3 destination). MUST be ≥ 3:1 vs #0E1116.
 *
 * Each value is only tested against the basemap it is paired with — users never
 * see `color` on the dark basemap, nor `color_dark` on the light basemap.
 *
 * No DB mocks — uses @testcontainers/postgresql + all repo SQL migrations via
 * the shared startTestDb() helper (CLAUDE.md: "No DB mocks in tests").
 * The migration runner in startTestDb() applies files in numeric order without
 * regex-extracting color values; the contrast check is performed against the
 * live query results only.
 *
 * WCAG 2.2 formulas are inlined here (identical to frontend/src/utils/wcag-contrast.ts)
 * to avoid a cross-workspace import boundary between packages/db-client and
 * frontend/. The shared utility is the canonical export for all non-integration
 * consumers (AdaptiveGridMarker, the CI contrast script, etc.).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startTestDb, type TestDb } from './test-helpers.js';

// ---------------------------------------------------------------------------
// WCAG 2.2 contrast utilities (mirror of frontend/src/utils/wcag-contrast.ts)
// ---------------------------------------------------------------------------

function hexToSRGB(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToSRGB(hex).map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(hexA: string, hexB: string): number {
  const lumA = relativeLuminance(hexA);
  const lumB = relativeLuminance(hexB);
  const lighter = Math.max(lumA, lumB);
  const darker = Math.min(lumA, lumB);
  return (lighter + 0.05) / (darker + 0.05);
}

// ---------------------------------------------------------------------------
// Basemap reference colors
// ---------------------------------------------------------------------------

const LIGHT_BASE = '#f4f1ea'; // OpenFreeMap positron — cream land surface
const DARK_BASE = '#0E1116';  // OpenFreeMap dark — near-black land surface

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

let db: TestDb;

beforeAll(async () => {
  db = await startTestDb();
}, 120_000);

afterAll(async () => {
  await db?.stop();
});

// ---------------------------------------------------------------------------
// Contrast assertions (RED until Task 3 migration lands)
// ---------------------------------------------------------------------------

describe('family palette WCAG 1.4.11 (3:1 non-text contrast) — dual-palette contract', () => {
  it('every family_silhouettes.color is ≥ 3:1 against the light basemap (#f4f1ea) — the only basemap it is rendered on', async () => {
    const { rows } = await db.pool.query<{ family_code: string; color: string }>(
      'SELECT family_code, color FROM family_silhouettes WHERE color IS NOT NULL ORDER BY family_code'
    );

    const failures = rows
      .map((row) => ({
        familyCode: row.family_code,
        color: row.color,
        ratio: Number(contrastRatio(row.color, LIGHT_BASE).toFixed(2)),
      }))
      .filter((r) => r.ratio < 3);

    // Emit the failing entries so Task 3 knows exactly which colors to fix.
    if (failures.length > 0) {
      console.error(
        'LIGHT BASEMAP failures (ratio < 3:1 against #f4f1ea):\n' +
          failures.map((f) => `  ${f.familyCode}: ${f.color} → ${f.ratio}:1`).join('\n')
      );
    }

    expect(failures, `${failures.length} color(s) fail against light basemap`).toEqual([]);
  });

  it('every family_silhouettes.color_dark is ≥ 3:1 against the dark basemap (#0E1116)', async () => {
    const { rows } = await db.pool.query<{ family_code: string; color_dark: string }>(
      'SELECT family_code, color_dark FROM family_silhouettes WHERE color_dark IS NOT NULL ORDER BY family_code'
    );

    const failures = rows
      .map((row) => ({
        familyCode: row.family_code,
        colorDark: row.color_dark,
        ratio: Number(contrastRatio(row.color_dark, DARK_BASE).toFixed(2)),
      }))
      .filter((r) => r.ratio < 3);

    if (failures.length > 0) {
      console.error(
        'DARK BASEMAP failures (ratio < 3:1 against #0E1116):\n' +
          failures.map((f) => `  ${f.familyCode}: ${f.colorDark} → ${f.ratio}:1`).join('\n')
      );
    }

    expect(failures, `${failures.length} color_dark value(s) fail against dark basemap`).toEqual([]);
  });

  // TODO(#583): 25 families fail color_dark ≥ 3:1 vs #131C30 (legend card surface).
  //
  // Phase 1 migration (1700000046000) calibrated color_dark against #0E1116 (basemap,
  // luminance ~0.004). The FamilyLegend card dark surface is #131C30 (luminance ~0.016)
  // — lighter, requiring brighter swatches. The F3 wire fix (#578) is fully correct;
  // only the palette data needs a follow-up migration (1700000047000).
  //
  // Failing families (25): accipitridae (#626262, 2.78), anatidae (#3A6B8E, 2.97),
  // apodidae (#686058, 2.75), ardeidae (#5A6B2A, 2.89), caprimulgidae (#6c52a3, 2.73),
  // cardinalidae (#b9251b, 2.70), cathartidae (#606060, 2.70), certhiidae (#805939, 2.75),
  // corvidae (#5858ac, 2.76), cuculidae (#795f29, 2.82), falconidae (#546272, 2.72),
  // _FALLBACK (#626262, 2.78), gaviidae (#4c637a, 2.73), numididae (#5A6878, 2.98),
  // odontophoridae (#86582c, 2.79), pandionidae (#7c5936, 2.70), phalacrocoracidae
  // (#51665e, 2.76), podicipedidae (#406a65, 2.80), ptiliogonatidae (#73596a, 2.72),
  // ptilogonatidae (#5b5b9c, 2.77), rallidae (#63605a, 2.71), strigidae (#725e35, 2.72),
  // sturnidae (#6b5885, 2.72), trochilidae (#9637ad, 2.79), troglodytidae (#86582c, 2.79).
  // (Historical snapshot from #570; migration 52000 (#922, inverted-spelling
  // fix) since removed the no-`i` orphan `ptilogonatidae`, so only the
  // eBird-canonical `ptiliogonatidae` remains of that pair — carrying the
  // transferred #5b5b9c palette.)
  //
  // Re-enable to `it(...)` once migration 1700000047000 lands. See #583.
  it.todo('every family_silhouettes.color_dark is ≥ 3:1 against the dark legend card surface (#131C30) — pending migration 1700000047000 (tracked in #583)');
});
