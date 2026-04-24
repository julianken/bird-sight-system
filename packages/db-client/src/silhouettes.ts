import type { Pool } from './pool.js';
import type { FamilySilhouette } from '@bird-watch/shared-types';

/**
 * Fetch every row from `family_silhouettes`. This table is the single source
 * of truth for family → color mapping in the system (issue #55 option (a)).
 * The legacy hardcoded `FAMILY_TO_COLOR` map that previously colocated
 * family-code → color in a separate helper workspace was deleted when
 * this endpoint landed — callers now read color from the DB via the
 * Read API's `/api/silhouettes` route.
 *
 * Rows are returned ordered by family_code so consumers (e.g. parity tests,
 * deterministic snapshots) don't depend on Postgres heap order.
 */
export async function getSilhouettes(pool: Pool): Promise<FamilySilhouette[]> {
  const { rows } = await pool.query<{
    family_code: string;
    color: string;
    svg_data: string | null;
    source: string | null;
    license: string | null;
  }>(
    `SELECT family_code, color, svg_data, source, license
     FROM family_silhouettes
     ORDER BY family_code`
  );
  return rows.map(r => ({
    familyCode: r.family_code,
    color: r.color,
    svgData: r.svg_data,
    source: r.source,
    license: r.license,
  }));
}
