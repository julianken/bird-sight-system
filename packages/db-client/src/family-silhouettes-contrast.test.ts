/**
 * Integration test: WCAG 1.4.11 (3:1 non-text contrast) for every color in
 * the family_silhouettes table against both basemaps used by bird-maps.com.
 *
 * Phase 1 Task 1 of the adaptive-grid tile contrast epic (#575, sub-issue #570).
 * This test intentionally starts RED — the current DB palette has 19+ colors
 * that fail the 3:1 threshold against one or both basemaps. Task 3 fixes the
 * palette via a SQL migration; at that point both assertions turn GREEN.
 *
 * Basemap reference colors:
 *   LIGHT_BASE: OpenFreeMap "positron" land surface (#f4f1ea)
 *   DARK_BASE:  OpenFreeMap "dark" land surface (#0E1116) — used after Phase 4
 *               flips BASEMAP_DARK from the positron alias to the real dark URL.
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

describe('family palette WCAG 1.4.11 (3:1 non-text contrast)', () => {
  it('every family_silhouettes.color is ≥ 3:1 against the light basemap (#f4f1ea)', async () => {
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

  it('every family_silhouettes.color is ≥ 3:1 against the dark basemap (#0E1116)', async () => {
    const { rows } = await db.pool.query<{ family_code: string; color: string }>(
      'SELECT family_code, color FROM family_silhouettes WHERE color IS NOT NULL ORDER BY family_code'
    );

    const failures = rows
      .map((row) => ({
        familyCode: row.family_code,
        color: row.color,
        ratio: Number(contrastRatio(row.color, DARK_BASE).toFixed(2)),
      }))
      .filter((r) => r.ratio < 3);

    if (failures.length > 0) {
      console.error(
        'DARK BASEMAP failures (ratio < 3:1 against #0E1116):\n' +
          failures.map((f) => `  ${f.familyCode}: ${f.color} → ${f.ratio}:1`).join('\n')
      );
    }

    expect(failures, `${failures.length} color(s) fail against dark basemap`).toEqual([]);
  });
});
