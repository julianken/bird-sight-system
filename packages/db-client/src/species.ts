import type { Pool } from './pool.js';
import type { SpeciesMeta } from '@bird-watch/shared-types';

export async function getSpeciesMeta(
  pool: Pool,
  speciesCode: string
): Promise<SpeciesMeta | null> {
  const { rows } = await pool.query<{
    species_code: string;
    com_name: string;
    sci_name: string;
    family_code: string;
    family_name: string;
    taxon_order: number | null;
  }>(
    `SELECT species_code, com_name, sci_name, family_code, family_name, taxon_order
     FROM species_meta WHERE species_code = $1`,
    [speciesCode]
  );
  const r = rows[0];
  if (!r) return null;
  return {
    speciesCode: r.species_code,
    comName: r.com_name,
    sciName: r.sci_name,
    familyCode: r.family_code,
    familyName: r.family_name,
    taxonOrder: r.taxon_order,
  };
}

export async function upsertSpeciesMeta(
  pool: Pool,
  inputs: SpeciesMeta[]
): Promise<number> {
  if (inputs.length === 0) return 0;

  const values: unknown[] = [];
  const placeholders: string[] = [];

  inputs.forEach((s, i) => {
    const o = i * 6;
    placeholders.push(
      `($${o + 1}, $${o + 2}, $${o + 3}, $${o + 4}, $${o + 5}, $${o + 6})`
    );
    values.push(s.speciesCode, s.comName, s.sciName, s.familyCode, s.familyName, s.taxonOrder);
  });

  await pool.query(
    `INSERT INTO species_meta (species_code, com_name, sci_name, family_code, family_name, taxon_order)
     VALUES ${placeholders.join(',')}
     ON CONFLICT (species_code) DO UPDATE SET
       com_name = EXCLUDED.com_name,
       sci_name = EXCLUDED.sci_name,
       family_code = EXCLUDED.family_code,
       family_name = EXCLUDED.family_name,
       taxon_order = EXCLUDED.taxon_order`,
    values
  );
  return inputs.length;
}
