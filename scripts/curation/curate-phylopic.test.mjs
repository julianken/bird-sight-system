import { describe, it, expect } from 'vitest';
import {
  emitMigrationSql,
  NATIONAL_INSERT_FAMILIES,
  NATIONAL_UPDATE_FAMILIES,
  NATIONAL_COLOR_BY_FAMILY,
  NATIONAL_COMMON_NAME_BY_FAMILY,
  NATIONAL_RESIDUAL_FAMILIES,
  PHYLOPIC_BUILD,
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

/**
 * Snapshot test for the --rescue-national-residual emit path (PR #678).
 *
 * Mirrors the mode='national' fixture above: feeds a representative
 * picks[] (4 rescued + 19 still-NULL — the production shape from
 * migration 1700000049000) into emitMigrationSql with mode='national-residual'
 * and asserts on the UPDATE-only shape, attribution threading, and Down
 * reversal.
 *
 * The 4 rescued families match the live migration:
 *   acrocephalidae (genus, CC-BY-4.0), fregatidae (species, CC0-1.0),
 *   phaethontidae (genus, CC-BY-3.0),  viduidae (species, CC-BY-3.0).
 *
 * 3 of the 4 are CC-BY-* and require creator citation; 1 (fregatidae) is
 * CC0 and does not require citation (but the emitter still emits the
 * creator column when known — the test only enforces that CC0 picks with
 * no creator emit `creator = NULL`, matching the emitter's `p.creatorName`
 * ternary at scripts/curate-phylopic.mjs:1466).
 */
describe('emitMigrationSql mode=national-residual', () => {
  const today = '2026-05-20';
  // 4 rescued — three CC-BY-* with real creators, one CC0 with NO creator
  // so we can assert the `creator = NULL` branch.
  const rescued = [
    {
      kind: 'picked',
      family: 'acrocephalidae',
      resolutionPath: 'genus',
      picked: {
        licenseId: 'CC-BY-4.0',
        creatorName: 'Yves Hoebeke',
        imagePageUrl: 'https://www.phylopic.org/images/e1d2cf2f-76cd-4c19-ba5b-c1f5abd841b8',
        uuid: 'e1d2cf2f-76cd-4c19-ba5b-c1f5abd841b8',
        svgPathD: 'M0 0 L24 0 L24 24 L0 24 Z',
        resolvedSlug: 'Acrocephalus',
      },
      reason: 'picked-by-license-CC-BY-4.0',
      considered: [],
    },
    {
      kind: 'picked',
      family: 'fregatidae',
      resolutionPath: 'species',
      picked: {
        licenseId: 'CC0-1.0',
        creatorName: null, // CC0 — no attribution required
        imagePageUrl: 'https://www.phylopic.org/images/44dcfdfc-6879-42ef-ae02-8df23a174efd',
        uuid: '44dcfdfc-6879-42ef-ae02-8df23a174efd',
        svgPathD: 'M1 1 L23 1 L23 23 L1 23 Z',
        resolvedSlug: 'Fregata magnificens',
      },
      reason: 'picked-by-license-CC0-1.0',
      considered: [],
    },
    {
      kind: 'picked',
      family: 'phaethontidae',
      resolutionPath: 'genus',
      picked: {
        licenseId: 'CC-BY-3.0',
        creatorName: 'Paul Baker (photo), T. Michael Keesey',
        imagePageUrl: 'https://www.phylopic.org/images/9171cd2b-3afc-46f4-9ee1-c6515de0378c',
        uuid: '9171cd2b-3afc-46f4-9ee1-c6515de0378c',
        svgPathD: 'M2 2 L22 2 L22 22 L2 22 Z',
        resolvedSlug: 'Phaethon',
      },
      reason: 'picked-by-license-CC-BY-3.0',
      considered: [],
    },
    {
      kind: 'picked',
      family: 'viduidae',
      resolutionPath: 'species',
      picked: {
        licenseId: 'CC-BY-3.0',
        creatorName: 'Alan Manson (photo), T. Michael Keesey',
        imagePageUrl: 'https://www.phylopic.org/images/5ced2df2-b9fd-4e15-8685-759c0c69e331',
        uuid: '5ced2df2-b9fd-4e15-8685-759c0c69e331',
        svgPathD: 'M3 3 L21 3 L21 21 L3 21 Z',
        resolvedSlug: 'Vidua macroura',
      },
      reason: 'picked-by-license-CC-BY-3.0',
      considered: [],
    },
  ];
  // 19 still-NULL — production shape from migration 49000.
  const stillNullFamilies = [
    'alcidae', 'aramidae', 'calcariidae', 'cettiidae', 'cracidae',
    'diomedeidae', 'hydrobatidae', 'icteriidae', 'leiothrichidae',
    'monarchidae', 'paradoxornithidae', 'peucedramidae', 'ploceidae',
    'polioptilidae', 'ptiliogonatidae', 'pycnonotidae', 'remizidae',
    'tityridae', 'vireonidae',
  ];
  const stillNull = stillNullFamilies.map(family => ({
    kind: 'absent',
    family,
    picked: null,
    reason: 'cascade-exhausted: family=http-404-on-nodes, species=http-404-on-nodes, genus=http-404-on-nodes',
    considered: [],
  }));
  const picks = [...rescued, ...stillNull];

  const sql = emitMigrationSql(
    picks,
    [],
    'national-residual',
    {},
    {},
    null,
  );

  it('starts with Up Migration marker and contains Down Migration marker', () => {
    expect(sql.startsWith('-- Up Migration\n')).toBe(true);
    expect(sql).toContain('-- Down Migration');
  });

  it('emits UPDATE-only SQL (no INSERT, no DELETE in Up section)', () => {
    const upSection = sql.slice(0, sql.indexOf('-- Down Migration'));
    expect(upSection).not.toMatch(/^\s*INSERT\b/m);
    expect(upSection).not.toMatch(/^\s*DELETE\b/m);
    // And at least one UPDATE statement exists.
    expect(upSection).toMatch(/^UPDATE family_silhouettes SET$/m);
  });

  it('emits exactly 4 UPDATE statements in the Up section (one per rescued family)', () => {
    const upSection = sql.slice(0, sql.indexOf('-- Down Migration'));
    const updateMatches = upSection.match(/^UPDATE family_silhouettes SET$/gm) ?? [];
    expect(updateMatches).toHaveLength(4);
  });

  it('emits a WHERE family_code clause for each of the 4 rescued families', () => {
    for (const r of rescued) {
      expect(sql).toContain(`WHERE family_code = '${r.family}';`);
    }
  });

  it('threads license + creator + source columns through correctly', () => {
    // CC-BY-* picks carry creator citation (3 of 4).
    expect(sql).toContain("license = 'CC-BY-4.0'");
    expect(sql).toContain("creator = 'Yves Hoebeke'");
    expect(sql).toContain("license = 'CC-BY-3.0'");
    expect(sql).toContain("creator = 'Paul Baker (photo), T. Michael Keesey'");
    expect(sql).toContain("creator = 'Alan Manson (photo), T. Michael Keesey'");
    // CC0 pick with null creatorName → emits creator = NULL (no quotes).
    expect(sql).toContain("license = 'CC0-1.0'");
    expect(sql).toMatch(/creator = NULL\n\s*WHERE family_code = 'fregatidae'/);
    // Source URLs thread through.
    expect(sql).toContain("source = 'https://www.phylopic.org/images/44dcfdfc-6879-42ef-ae02-8df23a174efd'");
  });

  it('does NOT emit UPDATEs for any of the 19 still-NULL families (no spurious writes)', () => {
    const upSection = sql.slice(0, sql.indexOf('-- Down Migration'));
    for (const family of stillNullFamilies) {
      expect(upSection, `${family} should not appear in an UPDATE … WHERE clause`)
        .not.toMatch(new RegExp(`WHERE family_code = '${family}';`));
    }
  });

  it('lists the still-NULL families in the audit comment block (not in SQL)', () => {
    // They appear in the "Still NULL after cascade" comment section.
    for (const family of stillNullFamilies) {
      expect(sql).toContain(`--   ${family} (`);
    }
  });

  it('Down section reverts ONLY the 4 rescued rows back to NULL (reverse-UPDATE shape)', () => {
    const downSection = sql.slice(sql.indexOf('-- Down Migration'));
    // No DELETEs (mode is UPDATE-only).
    expect(downSection).not.toMatch(/\bDELETE\b/);
    // Single UPDATE … IN (…) statement re-NULLing the 4 rescued families.
    expect(downSection).toContain('UPDATE family_silhouettes SET svg_data = NULL, source = NULL, license = NULL, creator = NULL');
    for (const r of rescued) {
      expect(downSection).toContain(`'${r.family}'`);
    }
    // None of the still-NULL families touched on Down.
    for (const family of stillNullFamilies) {
      expect(downSection, `${family} should not appear in Down section`).not.toContain(`'${family}'`);
    }
  });

  it('uses the PHYLOPIC_BUILD constant (not a hardcoded build number) in the header comment', () => {
    expect(sql).toContain(`Phylopic build ${PHYLOPIC_BUILD}`);
  });

  it('references migration 48000 + the rescue-national-residual context', () => {
    expect(sql).toContain('Phase 3a national residual rescue');
    expect(sql).toContain('migration 48000');
    expect(sql).toContain('--rescue-national-residual');
  });

  it('NATIONAL_RESIDUAL_FAMILIES covers the 23 families targeted by migration 49000', () => {
    expect(NATIONAL_RESIDUAL_FAMILIES).toHaveLength(23);
    // The 4 rescued + 19 still-NULL must all appear in the residual set.
    for (const r of rescued) {
      expect(NATIONAL_RESIDUAL_FAMILIES).toContain(r.family);
    }
    for (const family of stillNullFamilies) {
      expect(NATIONAL_RESIDUAL_FAMILIES).toContain(family);
    }
  });
});
