import { describe, it, expect } from 'vitest';
import {
  emitMigrationSql,
  NATIONAL_INSERT_FAMILIES,
  NATIONAL_UPDATE_FAMILIES,
  NATIONAL_COLOR_BY_FAMILY,
  NATIONAL_COMMON_NAME_BY_FAMILY,
} from './curate-phylopic.mjs';

/**
 * Snapshot test for the --national-coverage emit path.
 *
 * The test feeds a minimal-but-realistic `picks[]` (one INSERT success +
 * one INSERT failure + one UPDATE success + one UPDATE failure) into
 * emitMigrationSql with mode='national', and asserts on the shape of the
 * emitted SQL — both Up and Down sections, structure of INSERT then UPDATE,
 * NULL row handling, and the audit comments.
 *
 * No live Phylopic calls, no DB writes. The goal is to make a future
 * regression in the mode='national' emit path fail loudly.
 *
 * The full lookup heuristic, retry policy, and SVG path-d extraction are
 * tested via the existing curation runs (cached at scripts/.phylopic-cache/)
 * and the per-family audit comments in migrations/1700000034000 etc — those
 * are not duplicated here.
 */
describe('emitMigrationSql mode=national', () => {
  const today = '2026-05-18'; // matches todayUtc() at test write time
  const picks = [
    {
      kind: 'picked',
      family: 'procellariidae',
      picked: {
        licenseId: 'CC0-1.0',
        creatorName: 'Test Creator',
        imagePageUrl: 'https://www.phylopic.org/images/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        uuid: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        svgPathD: 'M0 0 L24 0 L24 24 L0 24 Z',
      },
      reason: 'picked-by-license-CC0-1.0',
      considered: [],
    },
    {
      kind: 'absent',
      family: 'leiothrichidae',
      picked: null,
      reason: 'http-404-on-nodes',
      considered: [],
    },
    {
      kind: 'picked',
      family: 'vireonidae',
      picked: {
        licenseId: 'CC-BY-4.0',
        creatorName: 'Another Creator',
        imagePageUrl: 'https://www.phylopic.org/images/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
        uuid: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
        svgPathD: 'M1 1 L23 1 L23 23 L1 23 Z',
      },
      reason: 'picked-by-license-CC-BY-4.0',
      considered: [],
    },
    {
      kind: 'absent',
      family: 'calcariidae',
      picked: null,
      reason: 'no-candidates',
      considered: [],
    },
  ];
  const insertSet = new Set(['procellariidae', 'leiothrichidae']); // 2 INSERTs
  // 2 UPDATEs: vireonidae + calcariidae

  const sql = emitMigrationSql(
    picks,
    [],
    'national',
    NATIONAL_COLOR_BY_FAMILY,
    NATIONAL_COMMON_NAME_BY_FAMILY,
    insertSet,
  );

  it('starts with Up Migration marker', () => {
    expect(sql.startsWith('-- Up Migration\n')).toBe(true);
  });

  it('contains Down Migration marker', () => {
    expect(sql).toContain('-- Down Migration');
  });

  it('references the Phase 3a context', () => {
    expect(sql).toContain('Phase 3a national flip');
  });

  it('emits a single INSERT statement for the picked INSERT family', () => {
    expect(sql).toContain('INSERT INTO family_silhouettes');
    // procellariidae color + common_name come from the NATIONAL_* tables.
    expect(sql).toContain("'procellariidae', 'procellariidae'");
    expect(sql).toContain(NATIONAL_COLOR_BY_FAMILY.procellariidae.color);
    expect(sql).toContain(NATIONAL_COLOR_BY_FAMILY.procellariidae.color_dark);
    expect(sql).toContain(NATIONAL_COMMON_NAME_BY_FAMILY.procellariidae);
    expect(sql).toContain("'Test Creator'");
    expect(sql).toContain('CC0-1.0');
  });

  it('emits a NULL-row INSERT for the failed INSERT family', () => {
    // leiothrichidae fell into the INSERT bucket but Phylopic 404'd.
    // The row is still inserted with svg_data=NULL so the _FALLBACK shape
    // can render with the right color/common_name.
    expect(sql).toContain("'leiothrichidae', 'leiothrichidae', NULL");
    expect(sql).toContain(NATIONAL_COLOR_BY_FAMILY.leiothrichidae.color);
    expect(sql).toContain(NATIONAL_COMMON_NAME_BY_FAMILY.leiothrichidae);
  });

  it('uses the dual-palette INSERT column shape (color + color_dark)', () => {
    expect(sql).toContain('INSERT INTO family_silhouettes (id, family_code, svg_data, color, color_dark, source, license, creator, common_name)');
  });

  it('emits an UPDATE statement for the picked UPDATE family', () => {
    expect(sql).toContain("UPDATE family_silhouettes SET");
    expect(sql).toContain("WHERE family_code = 'vireonidae';");
    expect(sql).toContain('CC-BY-4.0');
    expect(sql).toContain("'Another Creator'");
  });

  it('omits the no-op NULL-reset UPDATE for the failed UPDATE family', () => {
    // calcariidae stays NULL because the prior backfill migration already
    // left it NULL. A SQL UPDATE setting NULL to NULL would be a literal
    // no-op (the row's svg_data/source/license/creator are already all
    // NULL). The emit path documents the family in a SQL comment instead
    // and skips the redundant UPDATE write — the per-row attempts[]
    // cascade in scripts/phylopic-picks.json is the audit trail.
    expect(sql).not.toContain("WHERE family_code IN ('calcariidae')");
    // But the family is still mentioned in the audit comment block.
    expect(sql).toMatch(/-- UPDATE bucket: families that stayed NULL[\s\S]*calcariidae/);
  });

  it('orders sections: comments → INSERTs → UPDATEs → Down', () => {
    const insertIdx = sql.indexOf('INSERT INTO family_silhouettes');
    const updateIdx = sql.indexOf("WHERE family_code = 'vireonidae'");
    const downIdx = sql.indexOf('-- Down Migration');
    expect(insertIdx).toBeGreaterThan(0);
    expect(updateIdx).toBeGreaterThan(insertIdx);
    expect(downIdx).toBeGreaterThan(updateIdx);
  });

  it('Down section DELETEs INSERTed rows and UPDATEs only rescued UPDATEd rows back to NULL', () => {
    const downSection = sql.slice(sql.indexOf('-- Down Migration'));
    // INSERT bucket (success + fail) both get deleted on Down — the rows
    // exist in the DB after Up, regardless of whether svg_data is set.
    expect(downSection).toContain('DELETE FROM family_silhouettes WHERE family_code IN');
    expect(downSection).toContain("'leiothrichidae'");
    expect(downSection).toContain("'procellariidae'");
    // UPDATE bucket success (NULL → real) gets reverted back to NULL on
    // Down. Only vireonidae was rescued in this test fixture.
    expect(downSection).toContain('UPDATE family_silhouettes SET svg_data = NULL');
    expect(downSection).toContain("'vireonidae'");
    // UPDATE bucket fail (calcariidae) emitted no Up SQL (it would have
    // been a NULL → NULL no-op), so the Down mirrors that with no SQL.
    expect(downSection).not.toContain("'calcariidae'");
  });

  it('reports the resolution counts in the comment header', () => {
    expect(sql).toMatch(/Resolved: 2\/4 families/);
    expect(sql).toMatch(/INSERTed with svg_data: 1\/2/);
    expect(sql).toMatch(/UPDATEd from NULL → real: 1\/2/);
  });
});

describe('NATIONAL_* constants are well-formed', () => {
  it('NATIONAL_INSERT_FAMILIES has matching color tuple + common_name for every entry', () => {
    for (const family of NATIONAL_INSERT_FAMILIES) {
      const c = NATIONAL_COLOR_BY_FAMILY[family];
      expect(c, `missing color tuple for ${family}`).toBeTruthy();
      expect(c.color, `missing color for ${family}`).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(c.color_dark, `missing color_dark for ${family}`).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(NATIONAL_COMMON_NAME_BY_FAMILY[family], `missing common_name for ${family}`).toBeTruthy();
    }
  });

  it('NATIONAL_INSERT_FAMILIES and NATIONAL_UPDATE_FAMILIES are disjoint', () => {
    const insertSet = new Set(NATIONAL_INSERT_FAMILIES);
    for (const update of NATIONAL_UPDATE_FAMILIES) {
      expect(insertSet.has(update), `${update} appears in both INSERT and UPDATE`).toBe(false);
    }
  });

  it('NATIONAL_INSERT_FAMILIES has no internal duplicates', () => {
    const set = new Set(NATIONAL_INSERT_FAMILIES);
    expect(set.size).toBe(NATIONAL_INSERT_FAMILIES.length);
  });

  it('NATIONAL_UPDATE_FAMILIES has no internal duplicates', () => {
    const set = new Set(NATIONAL_UPDATE_FAMILIES);
    expect(set.size).toBe(NATIONAL_UPDATE_FAMILIES.length);
  });

  it('every NATIONAL color (color + color_dark) passes WCAG 1.4.11 ≥3:1 against the appropriate basemap', () => {
    // Mirror of packages/db-client/src/family-silhouettes-contrast.test.ts
    // formulas. We enforce the same contract at the constant-table level so
    // a regression here surfaces before the migration lands rather than at CI
    // integration-test time.
    const LIGHT_BASE = '#f4f1ea';
    const DARK_BASE  = '#0E1116';
    const hexToSRGB = (hex) => {
      const h = hex.replace('#', '');
      return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
    };
    const lum = (hex) => {
      const [r, g, b] = hexToSRGB(hex).map(c => {
        const v = c / 255;
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const ratio = (a, b) => {
      const la = lum(a), lb = lum(b);
      return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
    };
    for (const [family, { color, color_dark }] of Object.entries(NATIONAL_COLOR_BY_FAMILY)) {
      expect(ratio(color, LIGHT_BASE), `${family} color ${color} vs LIGHT_BASE fails 3:1`).toBeGreaterThanOrEqual(3);
      expect(ratio(color_dark, DARK_BASE), `${family} color_dark ${color_dark} vs DARK_BASE fails 3:1`).toBeGreaterThanOrEqual(3);
    }
  });
});
