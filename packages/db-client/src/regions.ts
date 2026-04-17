import type { Pool } from './pool.js';
import type { Region } from '@bird-watch/shared-types';

export async function getRegions(pool: Pool): Promise<Region[]> {
  const { rows } = await pool.query<{
    id: string;
    name: string;
    parent_id: string | null;
    display_color: string;
    svg_path: string;
  }>(
    `SELECT id, name, parent_id, display_color, svg_path
     FROM regions
     ORDER BY id`
  );
  return rows.map(r => ({
    id: r.id,
    name: r.name,
    parentId: r.parent_id,
    displayColor: r.display_color,
    svgPath: r.svg_path,
  }));
}
