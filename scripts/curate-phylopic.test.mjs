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
    expect(sql).toContain(NATIONAL_COLOR_BY_FAMILY.procellariidae);
    expect(sql).toContain(NATIONAL_COMMON_NAME_BY_FAMILY.procellariidae);
    expect(sql).toContain("'Test Creator'");
    expect(sql).toContain('CC0-1.0');
  });

  it('emits a NULL-row INSERT for the failed INSERT family', () => {
    // leiothrichidae fell into the INSERT bucket but Phylopic 404'd.
    // The row is still inserted with svg_data=NULL so the _FALLBACK shape
    // can render with the right color/common_name.
    expect(sql).toContain("'leiothrichidae', 'leiothrichidae', NULL");
    expect(sql).toContain(NATIONAL_COLOR_BY_FAMILY.leiothrichidae);
    expect(sql).toContain(NATIONAL_COMMON_NAME_BY_FAMILY.leiothrichidae);
  });

  it('emits an UPDATE statement for the picked UPDATE family', () => {
    expect(sql).toContain("UPDATE family_silhouettes SET");
    expect(sql).toContain("WHERE family_code = 'vireonidae';");
    expect(sql).toContain('CC-BY-4.0');
    expect(sql).toContain("'Another Creator'");
  });

  it('emits a NULL-reset UPDATE for the failed UPDATE family', () => {
    // calcariidae stays NULL; the script writes a defensive
    // UPDATE ... svg_data = NULL ... that names it.
    expect(sql).toContain("WHERE family_code IN ('calcariidae')");
  });

  it('orders sections: comments → INSERTs → UPDATEs → Down', () => {
    const insertIdx = sql.indexOf('INSERT INTO family_silhouettes');
    const updateIdx = sql.indexOf("WHERE family_code = 'vireonidae'");
    const downIdx = sql.indexOf('-- Down Migration');
    expect(insertIdx).toBeGreaterThan(0);
    expect(updateIdx).toBeGreaterThan(insertIdx);
    expect(downIdx).toBeGreaterThan(updateIdx);
  });

  it('Down section DELETEs INSERTed rows and UPDATEs UPDATEd rows back to NULL', () => {
    const downSection = sql.slice(sql.indexOf('-- Down Migration'));
    expect(downSection).toContain('DELETE FROM family_silhouettes WHERE family_code IN');
    expect(downSection).toContain("'leiothrichidae'");
    expect(downSection).toContain("'procellariidae'");
    expect(downSection).toContain('UPDATE family_silhouettes SET svg_data = NULL');
    expect(downSection).toContain("'vireonidae'");
    expect(downSection).toContain("'calcariidae'");
  });

  it('reports the resolution counts in the comment header', () => {
    expect(sql).toMatch(/Resolved: 2\/4 families/);
    expect(sql).toMatch(/INSERTed with svg_data: 1\/2/);
    expect(sql).toMatch(/UPDATEd from NULL → real: 1\/2/);
  });
});

describe('NATIONAL_* constants are well-formed', () => {
  it('NATIONAL_INSERT_FAMILIES has matching color + common_name for every entry', () => {
    for (const family of NATIONAL_INSERT_FAMILIES) {
      expect(NATIONAL_COLOR_BY_FAMILY[family], `missing color for ${family}`).toMatch(/^#[0-9a-fA-F]{6}$/);
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

  it('NATIONAL colors are unique within the table', () => {
    const colors = Object.values(NATIONAL_COLOR_BY_FAMILY).map(c => c.toLowerCase());
    const set = new Set(colors);
    expect(set.size).toBe(colors.length);
  });
});
