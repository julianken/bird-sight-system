import type { Pool } from './pool.js';
import type { SpeciesMeta } from '@bird-watch/shared-types';

/**
 * One row of `species_photos`. Mirrors the column shape verbatim — used by
 * `getSpeciesPhotos` to return a typed array of photo rows. The photo
 * projection on `SpeciesMeta` (issue #327, set by the LEFT JOIN in
 * `getSpeciesMeta`) is the wire-facing shape; this type is the row-facing
 * one and stays inside db-client.
 */
export interface SpeciesPhoto {
  id: number;
  speciesCode: string;
  purpose: string;
  url: string;
  attribution: string;
  license: string;
  createdAt: Date;
}

export interface SpeciesPhotoInput {
  speciesCode: string;
  purpose: string;
  url: string;
  attribution: string;
  license: string;
}

/**
 * Insert a row into `species_photos`. Idempotent on `(species_code, purpose)`:
 * a second call with the same pair upserts (replaces) the existing row's
 * url/attribution/license and bumps `created_at`. Returns the row id.
 *
 * The taxonomy on `species_meta` is NOT touched here — issue #327's plan
 * critic flagged that a careless impl could clobber `com_name`/`sci_name`/
 * `family_code`/`family_name`/`taxon_order` if it tried to upsert into
 * `species_meta` instead. The locking test in species.test.ts
 * ('insertSpeciesPhoto does not clobber taxonomy columns on conflict') is
 * the contractual guarantee against that regression.
 */
export async function insertSpeciesPhoto(
  pool: Pool,
  input: SpeciesPhotoInput
): Promise<number> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO species_photos (species_code, purpose, url, attribution, license)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (species_code, purpose) DO UPDATE SET
       url = EXCLUDED.url,
       attribution = EXCLUDED.attribution,
       license = EXCLUDED.license,
       created_at = NOW()
     RETURNING id`,
    [input.speciesCode, input.purpose, input.url, input.attribution, input.license]
  );
  // BIGSERIAL comes back as string from pg by default; cast to number for the
  // public return type. The id range here is well under Number.MAX_SAFE_INTEGER.
  return Number(rows[0]!.id);
}

export interface SpeciesDescriptionInput {
  speciesCode: string;
  /** Currently always `'wikipedia'` (CHECK-restricted at the DB tier; future iNat-summary fallback expands the union). */
  source: 'wikipedia';
  /** Sanitized HTML — DOMPurify must run BEFORE this helper. The CHECK enforces 50..8192 chars. */
  body: string;
  /** Wikipedia summary license — DB CHECK restricts to the two CC-BY-SA variants. */
  license: 'CC-BY-SA-3.0' | 'CC-BY-SA-4.0';
  /** Wikipedia revision id; null when the upstream omits it (Wikipedia 304 / sparse 200). */
  revisionId: number | null;
  /** ETag from the upstream conditional-GET; null when first fetch + upstream omits the header. */
  etag: string | null;
  /** Page URL (for "Read more on Wikipedia" link surface in the frontend). */
  attributionUrl: string;
}

/**
 * Insert a row into `species_descriptions`. Idempotent on `species_code`: a
 * second call with the same code upserts (replaces) the existing row's
 * body/license/revision_id/etag/attribution_url and bumps `fetched_at`. Mirrors
 * `insertSpeciesPhoto` shape; the conflict locking comment applies for the same
 * reason — the shared `species_meta` parent must NOT be touched here. The
 * "does not clobber taxonomy columns on conflict" contract test guards against
 * a regression where a careless impl would UPSERT into species_meta with
 * EXCLUDED defaults and silently overwrite com_name/sci_name/inat_taxon_id.
 */
export async function insertSpeciesDescription(
  pool: Pool,
  input: SpeciesDescriptionInput
): Promise<number> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO species_descriptions
       (species_code, source, body, license, revision_id, etag, attribution_url)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (species_code) DO UPDATE SET
       source = EXCLUDED.source,
       body = EXCLUDED.body,
       license = EXCLUDED.license,
       revision_id = EXCLUDED.revision_id,
       etag = EXCLUDED.etag,
       attribution_url = EXCLUDED.attribution_url,
       fetched_at = NOW()
     RETURNING id`,
    [
      input.speciesCode,
      input.source,
      input.body,
      input.license,
      input.revisionId,
      input.etag,
      input.attributionUrl,
    ]
  );
  return Number(rows[0]!.id);
}

/**
 * Return all `species_photos` rows for the given species, newest first.
 * Today the (species_code, purpose) UNIQUE means a species has at most one
 * row per purpose and only `'detail-panel'` is permitted, so this returns
 * 0 or 1 row in practice. The contract is forward-looking: when additional
 * purpose values land (`marker`, `gallery`, etc.), the ORDER BY clause keeps
 * consumers correct.
 */
export async function getSpeciesPhotos(
  pool: Pool,
  speciesCode: string
): Promise<SpeciesPhoto[]> {
  const { rows } = await pool.query<{
    id: string;
    species_code: string;
    purpose: string;
    url: string;
    attribution: string;
    license: string;
    created_at: Date;
  }>(
    `SELECT id, species_code, purpose, url, attribution, license, created_at
       FROM species_photos
      WHERE species_code = $1
      ORDER BY created_at DESC`,
    [speciesCode]
  );
  return rows.map(r => ({
    id: Number(r.id),
    speciesCode: r.species_code,
    purpose: r.purpose,
    url: r.url,
    attribution: r.attribution,
    license: r.license,
    createdAt: r.created_at,
  }));
}

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
    photo_url: string | null;
    photo_attribution: string | null;
    photo_license: string | null;
    description_body: string | null;
    description_license: string | null;
    description_attribution_url: string | null;
  }>(
    // LEFT JOIN species_photos so the species row is returned regardless of
    // whether a detail-panel photo exists. The (species_code, purpose) UNIQUE
    // guarantees at most one matching row, so no LIMIT/aggregation needed.
    //
    // Second LEFT JOIN to species_descriptions (issue #372) projects the
    // description body/license/attribution_url onto the same payload the
    // photo fields ride. The (species_code) UNIQUE on species_descriptions
    // guarantees at most one matching row per species. revision_id and etag
    // are deliberately NOT projected — they are cache-invalidation knobs
    // the writer uses, not wire-facing fields.
    `SELECT sm.species_code, sm.com_name, sm.sci_name, sm.family_code,
            sm.family_name, sm.taxon_order,
            sp.url         AS photo_url,
            sp.attribution AS photo_attribution,
            sp.license     AS photo_license,
            sd.body            AS description_body,
            sd.license         AS description_license,
            sd.attribution_url AS description_attribution_url
       FROM species_meta sm
       LEFT JOIN species_photos sp
         ON sp.species_code = sm.species_code
        AND sp.purpose = 'detail-panel'
       LEFT JOIN species_descriptions sd
         ON sd.species_code = sm.species_code
      WHERE sm.species_code = $1`,
    [speciesCode]
  );
  const r = rows[0];
  if (!r) return null;
  // Build the result with the taxonomy fields always populated and the
  // optional photo + description fields ONLY set when present. Under
  // exactOptionalPropertyTypes, assigning `undefined` to an optional
  // string-typed property is a type error — so omit the keys outright when
  // the JOIN produced NULLs. Consumers see `meta.photoUrl === undefined`
  // (and `meta.descriptionBody === undefined`) because the property is
  // missing, which is the contract spec'd in species.test.ts ("not
  // present, not null, not empty").
  const meta: SpeciesMeta = {
    speciesCode: r.species_code,
    comName: r.com_name,
    sciName: r.sci_name,
    familyCode: r.family_code,
    familyName: r.family_name,
    taxonOrder: r.taxon_order,
  };
  if (r.photo_url !== null) meta.photoUrl = r.photo_url;
  if (r.photo_attribution !== null) meta.photoAttribution = r.photo_attribution;
  if (r.photo_license !== null) meta.photoLicense = r.photo_license;
  if (r.description_body !== null) meta.descriptionBody = r.description_body;
  if (r.description_license !== null) meta.descriptionLicense = r.description_license;
  if (r.description_attribution_url !== null) {
    meta.descriptionAttributionUrl = r.description_attribution_url;
  }
  return meta;
}

/**
 * Return monthly observation counts for a species. Sparse: months with zero
 * observations are absent from the result. The frontend zero-fills to 12
 * entries before rendering.
 *
 * Existence semantics: this helper does NOT distinguish "unknown species
 * code" from "known species with no observations" — both return `[]`. The
 * route layer (app.ts) calls `getSpeciesMeta` for the existence check and
 * returns 404 for unknown codes; this matches the species-meta route's
 * 404 precedent and keeps the SQL focused on aggregation.
 *
 * Timezone note: `EXTRACT(MONTH FROM obs_dt)` uses the database server's
 * timezone for the month boundary. Arizona observations are reported in
 * MST (UTC-7) which is non-DST, so a Dec 31 23:59 MST observation extracts
 * to month 12 regardless of server timezone (the obs_dt value carries its
 * own offset). When/if we expand beyond AZ-only data, revisit with
 * `obs_dt AT TIME ZONE 'America/Phoenix'`.
 */
export async function getSpeciesPhenology(
  pool: Pool,
  speciesCode: string
): Promise<Array<{ month: number; count: number }>> {
  const { rows } = await pool.query<{ month: number; count: number }>(
    `SELECT EXTRACT(MONTH FROM obs_dt)::int AS month,
            COUNT(*)::int AS count
       FROM observations
      WHERE species_code = $1
      GROUP BY month
      ORDER BY month`,
    [speciesCode]
  );
  return rows.map(r => ({ month: r.month, count: r.count }));
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
