import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startTestDb, type TestDb } from '../test-helpers.js';

// Topology checks introduced by issue #91 — the boundary-fix migration
// 1700000011000 moved Sonoran-Tucson's west edge east from lng=-111.5 onto
// the lng=-111.0 vertical, but did not touch the three sky-island rows.
// Santa Ritas' western lobe at lng=-111.20 / x=226.552 therefore protruded
// ~12 SVG units west of the new parent clamp at x=238.966.  Migration
// 1700000012000 clamps every child vertex at lng<-111.0 to lng=-111.0,
// snaps the lat=31.58 vertex up to lat=31.60 so it lands on the parent's
// SW-corner vertex (parent's SW diagonal at lat=31.58 runs through
// lng≈-110.973, so the old (-111.0, 31.58) was strictly outside the parent
// polygon), and shifts the lat=32.12 vertex down 0.02° to 32.10 so it
// coincides bit-identically with the parent's mid-west-wall vertex.
//
// These assertions lock in the geometry contract:
//   - ST_Contains(sonoran-tucson, sky-islands-santa-ritas) = TRUE,
//     including the DE-9IM check that the child's interior intersects the
//     parent's interior (boundary-only sharing is permitted for touching
//     edges, but the child must still lie inside).
//   - No cross-intersection with sonoran-phoenix (the sibling the old
//     western lobe painted over).
//   - At least 2 bit-identical shared vertices along the west seam, at
//     (-111.0, 31.6) and (-111.0, 32.1) — parent's SW-corner vertex and
//     parent's mid-west-wall vertex per migration 11000 line 138.

let db: TestDb;
beforeAll(async () => { db = await startTestDb(); }, 90_000);
afterAll(async () => { await db?.stop(); });

describe('region topology: sky-islands-santa-ritas ⊆ sonoran-tucson (#91)', () => {
  it('sonoran-tucson strictly contains sky-islands-santa-ritas', async () => {
    const { rows } = await db.pool.query<{ contained: boolean; leak_area: number }>(
      `SELECT ST_Contains(p.geom, c.geom)                        AS contained,
              ST_Area(ST_Difference(c.geom, p.geom))              AS leak_area
         FROM regions p, regions c
        WHERE p.id='sonoran-tucson'
          AND c.id='sky-islands-santa-ritas'`
    );
    expect(rows[0]?.contained).toBe(true);
    // leak_area is the area of the child NOT inside the parent — must be
    // effectively zero (1e-9 covers floating-point rounding noise only).
    expect(rows[0]?.leak_area ?? 1).toBeLessThan(1e-9);
  });

  it('santa-ritas does not intersect sonoran-phoenix (the west-side sibling)', async () => {
    // Before the fix, Santa Ritas' west lobe extended into sonoran-phoenix
    // (lat ∈ [31.58, 32.12], lng ∈ [-111.20, -111.0]).  After the clamp,
    // Santa Ritas shares only a boundary point (0-D touch) with sonoran-
    // phoenix at (-111.0, 31.6) — the sp/st/st-child 3-way corner — so the
    // area of intersection is zero.
    const { rows } = await db.pool.query<{ overlap: number }>(
      `SELECT ST_Area(ST_Intersection(a.geom, b.geom)) AS overlap
         FROM regions a, regions b
        WHERE a.id='sonoran-phoenix'
          AND b.id='sky-islands-santa-ritas'`
    );
    expect(rows[0]?.overlap ?? 1).toBeLessThan(1e-9);
  });

  it('child shares >= 2 bit-identical seam vertices with parent at lats 31.6 and 32.1', async () => {
    // Parent sonoran-tucson's west-edge vertices at lng=-111.0 are at lats
    // {31.6, 32.1, 32.6} (migration 11000 line 138).  Post-fix the child
    // includes (-111.0, 31.6) and (-111.0, 32.1) bit-identically — the
    // third parent vertex at lat=32.6 is ~0.5° north of Santa Ritas'
    // natural top at lat=32.05 and is intentionally NOT forced into the
    // child (pulling it in would distort the shape well beyond the west
    // seam).
    const { rows } = await db.pool.query<{ lng: string; lat: string; shared: string }>(
      `WITH c AS (
         SELECT (ST_DumpPoints(geom)).geom AS pt
           FROM regions WHERE id='sky-islands-santa-ritas'
       ),
            p AS (
         SELECT (ST_DumpPoints(geom)).geom AS pt
           FROM regions WHERE id='sonoran-tucson'
       )
       SELECT ST_X(c.pt)::text   AS lng,
              ST_Y(c.pt)::text   AS lat,
              COUNT(*)::text     AS shared
         FROM c, p
        WHERE ST_Equals(c.pt, p.pt)
        GROUP BY c.pt
        ORDER BY ST_Y(c.pt)`
    );
    // At minimum the two required seam vertices must appear; duplicates from
    // ring-close are fine (ST_Equals groups dedupe by coordinate).
    expect(rows.length).toBeGreaterThanOrEqual(2);
    const coords = rows.map(r => `${Number(r.lng).toFixed(4)},${Number(r.lat).toFixed(4)}`);
    expect(coords).toContain('-111.0000,31.6000');
    expect(coords).toContain('-111.0000,32.1000');
  });

  it('smallest-area-wins ingest still routes Madera Canyon to santa-ritas post-clamp', async () => {
    // Madera Canyon (-110.88, 31.72) is inside the east half of Santa
    // Ritas' polygon, untouched by this migration.  Guards against an
    // accidental over-shrink of the west lobe that would miss the canyon.
    const { rows } = await db.pool.query<{ id: string }>(
      `SELECT r.id FROM regions r
         WHERE ST_Contains(r.geom, ST_SetSRID(ST_MakePoint($1, $2), 4326))
         ORDER BY ST_Area(r.geom) ASC
         LIMIT 1`,
      [-110.88, 31.72]
    );
    expect(rows[0]?.id).toBe('sky-islands-santa-ritas');
  });

  it('a point in the formerly-protruding sliver routes to sonoran-phoenix', async () => {
    // (-111.10, 31.80) is inside the excised westward lobe (lng ∈ [-111.20,
    // -111.0], lat ∈ [31.58, 32.12]).  Pre-fix, ST_Contains matched
    // Santa Ritas AND sonoran-phoenix, and smallest-area-wins picked
    // Santa Ritas.  Post-fix, Santa Ritas no longer contains this point,
    // so smallest-area-wins falls through to sonoran-phoenix.
    const { rows } = await db.pool.query<{ id: string }>(
      `SELECT r.id FROM regions r
         WHERE ST_Contains(r.geom, ST_SetSRID(ST_MakePoint($1, $2), 4326))
         ORDER BY ST_Area(r.geom) ASC
         LIMIT 1`,
      [-111.10, 31.80]
    );
    expect(rows[0]?.id).toBe('sonoran-phoenix');
  });
});
