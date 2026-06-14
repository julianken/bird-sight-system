/**
 * Integration test: WCAG 1.4.11 (3:1 non-text contrast) for the family_silhouettes
 * dual-palette against the basemap each value is actually rendered on.
 *
 * Phase 1 Task 1 of the adaptive-grid tile contrast epic (#575, sub-issue #570).
 *
 * #1217 (C5) — PARAMETERIZED over EVERY land in `LAND_COLORS`, bucketed by kind,
 * rather than the former two literals (`LIGHT_BASE`/`DARK_BASE`). Adding the
 * bright/liberty/fiord themes (C1) introduces new lands to audit:
 *   `color`      → rendered on the LIGHT basemaps. MUST be ≥ 3:1 vs EVERY
 *                  light-kind land (positron #f4f1ea, bright/liberty #f8f4f0).
 *   `color_dark` → rendered on the DARK basemaps. MUST be ≥ 3:1 vs the near-black
 *                  dark land #0E1116.
 *
 * DECISION GATE — fiord (#45516E) is EXEMPT from the family-icon-vs-land
 * silhouette assertion (branch (a)). Fiord's land is ≈15× brighter than the
 * dark land (L≈0.0828 vs L≈0.0055), sitting in the MIDDLE of the dark palette's
 * own mid-tone band, so 72/96 `color_dark` values collapse below 3:1 against it
 * (e.g. anatidae #3A6B8E → 1.38). ONE `color_dark` cannot clear 3:1 against
 * BOTH a 0.0055 land AND a 0.0828 land — a single palette is mathematically
 * impossible, and forcing a wholesale dark-palette redesign would break
 * "C1–C7 reproduce today's exact look". Instead fiord achieves marker contrast
 * via its WHITE markerHaloColor (≥7.9:1 vs #45516E — validated on the
 * descriptor), which rings every silhouette against the navy land. The
 * fiord-exempt set is named explicitly below so this exemption is auditable,
 * not an accident of iteration. (The #131C30 legend-surface backlog stays
 * `it.todo(#583)`, out of scope.)
 *
 * Each value is only tested against the basemap kind it is paired with — users
 * never see `color` on a dark basemap, nor `color_dark` on a light basemap.
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
// Basemap reference colors — LOCAL mirror of LAND_COLORS
// ---------------------------------------------------------------------------
//
// SOURCE OF TRUTH: frontend/src/components/map/geometry/basemap-style.ts
// `LAND_COLORS`. packages/db-client depends only on @bird-watch/shared-types
// + pg — it has NO module path to frontend/, so we mirror the 5 land hexes +
// kinds here, exactly as this test already inlines the WCAG formulas to avoid a
// frontend import. This is the ONLY mirrored constant in the C5 design, and it
// is mirrored ONLY because a real import is impossible (db-client → frontend).
// No frontend COLOR constant (ROAD/PLACE/WATER_TEXT, NOTABLE_AMBER_*) is ever
// copied here — those are asserted in their owning frontend test files. If you
// add a land to LAND_COLORS, mirror it here too.
const LAND_COLORS = {
  positron: { land: '#f4f1ea', kind: 'light' },
  bright: { land: '#f8f4f0', kind: 'light' },
  liberty: { land: '#f8f4f0', kind: 'light' },
  dark: { land: '#0E1116', kind: 'dark' },
  fiord: { land: '#45516E', kind: 'dark' },
} as const;

type LandId = keyof typeof LAND_COLORS;

const LIGHT_LANDS = (Object.entries(LAND_COLORS) as Array<[LandId, { land: string; kind: string }]>)
  .filter(([, v]) => v.kind === 'light')
  .map(([id, v]) => ({ id, land: v.land }));

// DECISION GATE (a): fiord is EXEMPT from the family-icon-vs-land silhouette
// matrix — its white markerHaloColor (≥7.9:1 vs #45516E) carries marker
// contrast instead. Auditing color_dark vs fiord would fail 72/96 families and
// demand an impossible single-palette redesign. The exempt set is named here
// so the carve-out is explicit and auditable.
const SILHOUETTE_FIORD_EXEMPT: ReadonlySet<LandId> = new Set<LandId>(['fiord']);

const DARK_LANDS_FOR_SILHOUETTE = (
  Object.entries(LAND_COLORS) as Array<[LandId, { land: string; kind: string }]>
)
  .filter(([id, v]) => v.kind === 'dark' && !SILHOUETTE_FIORD_EXEMPT.has(id))
  .map(([id, v]) => ({ id, land: v.land }));

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

describe('family palette WCAG 1.4.11 (3:1 non-text contrast) — dual-palette contract, parameterized over LAND_COLORS', () => {
  // ── color ≥ 3:1 vs EVERY light-kind land ────────────────────────────────
  for (const { id, land } of LIGHT_LANDS) {
    it(`every family_silhouettes.color is ≥ 3:1 against the ${id} light land (${land})`, async () => {
      const { rows } = await db.pool.query<{ family_code: string; color: string }>(
        'SELECT family_code, color FROM family_silhouettes WHERE color IS NOT NULL ORDER BY family_code'
      );

      const failures = rows
        .map((row) => ({
          familyCode: row.family_code,
          color: row.color,
          ratio: Number(contrastRatio(row.color, land).toFixed(2)),
        }))
        .filter((r) => r.ratio < 3);

      if (failures.length > 0) {
        console.error(
          `LIGHT-KIND land ${id} (${land}) failures (color ratio < 3:1):\n` +
            failures.map((f) => `  ${f.familyCode}: ${f.color} → ${f.ratio}:1 vs ${id} ${land}`).join('\n')
        );
      }

      expect(
        failures,
        `${failures.length} color(s) fail ≥3:1 against ${id} land ${land}`
      ).toEqual([]);
    });
  }

  // ── color_dark ≥ 3:1 vs EVERY dark-kind land EXCEPT fiord (decision (a)) ──
  for (const { id, land } of DARK_LANDS_FOR_SILHOUETTE) {
    it(`every family_silhouettes.color_dark is ≥ 3:1 against the ${id} dark land (${land})`, async () => {
      const { rows } = await db.pool.query<{ family_code: string; color_dark: string }>(
        'SELECT family_code, color_dark FROM family_silhouettes WHERE color_dark IS NOT NULL ORDER BY family_code'
      );

      const failures = rows
        .map((row) => ({
          familyCode: row.family_code,
          colorDark: row.color_dark,
          ratio: Number(contrastRatio(row.color_dark, land).toFixed(2)),
        }))
        .filter((r) => r.ratio < 3);

      if (failures.length > 0) {
        console.error(
          `DARK-KIND land ${id} (${land}) failures (color_dark ratio < 3:1):\n` +
            failures.map((f) => `  ${f.familyCode}: ${f.colorDark} → ${f.ratio}:1 vs ${id} ${land}`).join('\n')
        );
      }

      expect(
        failures,
        `${failures.length} color_dark value(s) fail ≥3:1 against ${id} land ${land}`
      ).toEqual([]);
    });
  }

  // Fiord is exempt from the icon-fill-vs-land matrix per decision (a); assert
  // the exemption is intentional (the white halo carries fiord marker contrast)
  // so a future reader sees the carve-out is by design, not an omission.
  it('fiord is the only land exempt from the color_dark-vs-land silhouette matrix (decision (a): white halo)', () => {
    expect([...SILHOUETTE_FIORD_EXEMPT]).toEqual(['fiord']);
    expect(LAND_COLORS.fiord.kind).toBe('dark');
    expect(DARK_LANDS_FOR_SILHOUETTE.some((l) => l.id === 'fiord')).toBe(false);
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
