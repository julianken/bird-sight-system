import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startTestDb, type TestDb } from './test-helpers.js';

// Topology checks introduced by migrations/1700000011000_fix_region_boundaries.sql.
// These verify the post-migration state against the AC in issue #58:
//   - sky-island parent_id populated to 'sonoran-tucson'
//   - siblings (same parent_id, neither is the other's parent) do NOT overlap
//   - union of the 6 top-level polygons has no internal gaps (self-consistent:
//     the external boundary of the union equals the external boundary of the
//     sum of individual boundaries minus the shared edges)
//   - smallest-area-wins ingest contract still routes sky-island points to
//     sky-islands, confirming the parent/child relationship survives the
//     boundary rewrite.
//
// We avoid hard-coding an external AZ-outer-boundary geometry; instead we
// assert properties of the union directly (no holes, no degenerate area).

let db: TestDb;
beforeAll(async () => { db = await startTestDb(); }, 90_000);
afterAll(async () => { await db?.stop(); });

describe('region boundaries: topology', () => {
  it('populates sky-island parent_id to sonoran-tucson', async () => {
    const { rows } = await db.pool.query<{ id: string; parent_id: string | null }>(
      `SELECT id, parent_id FROM regions
         WHERE id LIKE 'sky-islands-%'
         ORDER BY id`
    );
    expect(rows).toHaveLength(3);
    for (const r of rows) {
      expect(r.parent_id).toBe('sonoran-tucson');
    }
  });

  it('sibling pairs do not overlap and have zero intersection area', async () => {
    // Precise sibling-pair filter per AC:
    //   (a.id < b.id) AND (a.parent_id IS NOT DISTINCT FROM b.parent_id)
    //   AND (a.id IS DISTINCT FROM b.parent_id)
    //   AND (b.id IS DISTINCT FROM a.parent_id)
    //
    // We must use IS DISTINCT FROM here rather than plain `<>`.  For top-level
    // rows, `a.parent_id` is NULL, so `b.id <> a.parent_id` evaluates to NULL
    // (unknown), which causes the WHERE clause to silently drop the pair —
    // hiding every top-level↔top-level sibling pair from the check.  IS
    // DISTINCT FROM treats NULL as a distinct value and returns TRUE.
    //
    // After the fix we expect 13 sibling pairs: the 10 pairs of top-level
    // regions (the 5 AZ ecoregions, plus grand-canyon is NOT top-level so we
    // have 5C2 = 10) and the 3 pairs among the 3 sky-island siblings.
    const { rows } = await db.pool.query<{
      a_id: string; b_id: string;
      overlaps: boolean;
      inter_area: number;
    }>(`
      SELECT a.id AS a_id, b.id AS b_id,
             ST_Overlaps(a.geom, b.geom) AS overlaps,
             ST_Area(ST_Intersection(a.geom, b.geom)) AS inter_area
        FROM regions a JOIN regions b ON a.id < b.id
       WHERE a.parent_id IS NOT DISTINCT FROM b.parent_id
         AND a.id IS DISTINCT FROM b.parent_id
         AND b.id IS DISTINCT FROM a.parent_id
    `);
    expect(rows.length).toBe(13);
    for (const r of rows) {
      expect({ pair: `${r.a_id}+${r.b_id}`, overlaps: r.overlaps })
        .toEqual({ pair: `${r.a_id}+${r.b_id}`, overlaps: false });
      expect({ pair: `${r.a_id}+${r.b_id}`, inter_area: r.inter_area })
        .toEqual({ pair: `${r.a_id}+${r.b_id}`, inter_area: 0 });
    }
  });

  it('expected-neighbour pairs share a positive-length boundary (ST_Touches)', async () => {
    // This is necessary but not sufficient (a point-touch also satisfies
    // ST_Touches).  The sibling-overlap assertion above plus the union-area
    // assertion below together guarantee full edge coverage.
    const expected: Array<[string, string]> = [
      ['colorado-plateau', 'mogollon-rim'],
      ['colorado-plateau', 'lower-colorado'],
      ['mogollon-rim',    'sonoran-phoenix'],
      ['mogollon-rim',    'sonoran-tucson'],
      ['mogollon-rim',    'lower-colorado'],
      ['sonoran-phoenix', 'sonoran-tucson'],
      ['sonoran-phoenix', 'lower-colorado'],
    ];
    for (const [a, b] of expected) {
      const { rows } = await db.pool.query<{ touches: boolean; shared_len: number }>(
        `SELECT ST_Touches(a.geom, b.geom) AS touches,
                ST_Length(ST_Intersection(ST_Boundary(a.geom), ST_Boundary(b.geom))) AS shared_len
           FROM regions a, regions b
          WHERE a.id = $1 AND b.id = $2`,
        [a, b]
      );
      expect({ pair: `${a}+${b}`, touches: rows[0]?.touches }).toEqual({
        pair: `${a}+${b}`, touches: true,
      });
      expect(rows[0]?.shared_len ?? 0).toBeGreaterThan(0);
    }
  });

  it('union of top-level regions forms a single polygon with no holes', async () => {
    // No hole = no internal gap = no linear gap between sibling polygons.
    // Combined with the zero-intersection sibling assertion, this gives full
    // edge coverage for every sibling pair: if any neighbour pair left a
    // linear gap, ST_Union would retain an interior ring.
    const { rows } = await db.pool.query<{
      geom_type: string; area: number; n_interior: number;
    }>(`
      WITH u AS (
        SELECT ST_Union(geom) AS g
          FROM regions
         WHERE parent_id IS NULL
      )
      SELECT ST_GeometryType(g) AS geom_type,
             ST_Area(g) AS area,
             ST_NumInteriorRings(
               CASE WHEN ST_GeometryType(g) = 'ST_MultiPolygon'
                    THEN ST_GeometryN(g, 1)
                    ELSE g END
             ) AS n_interior
        FROM u
    `);
    expect(rows[0]?.geom_type).toBe('ST_Polygon');
    expect(rows[0]?.n_interior).toBe(0);
    expect(rows[0]?.area ?? 0).toBeGreaterThan(30);  // AZ ~32 sq degrees
  });

  it('ingest contract: smallest-area-wins routes Madera Canyon to sky-islands-santa-ritas', async () => {
    // Replays the point-in-polygon query used at
    // packages/db-client/src/observations.ts:58-59 and
    // packages/db-client/src/hotspots.ts:64-71.
    const { rows } = await db.pool.query<{ id: string }>(
      `SELECT r.id FROM regions r
         WHERE ST_Contains(r.geom, ST_SetSRID(ST_MakePoint($1, $2), 4326))
         ORDER BY ST_Area(r.geom) ASC
         LIMIT 1`,
      [-110.88, 31.72]  // Madera Canyon
    );
    expect(rows[0]?.id).toBe('sky-islands-santa-ritas');
  });

  it('ingest contract: Sweetwater Wetlands routes to sonoran-tucson', async () => {
    const { rows } = await db.pool.query<{ id: string }>(
      `SELECT r.id FROM regions r
         WHERE ST_Contains(r.geom, ST_SetSRID(ST_MakePoint($1, $2), 4326))
         ORDER BY ST_Area(r.geom) ASC
         LIMIT 1`,
      [-110.99, 32.30]  // Sweetwater Wetlands
    );
    expect(rows[0]?.id).toBe('sonoran-tucson');
  });
});
