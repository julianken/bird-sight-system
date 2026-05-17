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
 *
 * svgUrl (issue #502) is the admin-api-uploaded CDN-served SVG URL; NULL for
 * rows that haven't been overridden via the admin-api. svgData remains the
 * load-bearing path-d for the map's synchronous SDF sprite pipeline; the
 * admin-api writes both atomically on upload.
 */
export async function getSilhouettes(pool: Pool): Promise<FamilySilhouette[]> {
  const { rows } = await pool.query<{
    family_code: string;
    color: string;
    color_dark: string;
    svg_data: string | null;
    svg_url: string | null;
    source: string | null;
    license: string | null;
    common_name: string | null;
    creator: string | null;
  }>(
    `SELECT family_code, color, color_dark, svg_data, svg_url, source, license, common_name, creator
     FROM family_silhouettes
     ORDER BY family_code`
  );
  return rows.map(r => ({
    familyCode: r.family_code,
    color: r.color,
    colorDark: r.color_dark,
    svgData: r.svg_data,
    svgUrl: r.svg_url,
    source: r.source,
    license: r.license,
    commonName: r.common_name,
    creator: r.creator,
  }));
}
