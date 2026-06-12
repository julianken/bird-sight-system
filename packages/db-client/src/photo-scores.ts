import type { Pool } from './pool.js';
import type { PhotoScoreRow } from '@bird-watch/shared-types';

/**
 * Append-only insert of photo-quality judge scores into `species_photo_scores`
 * (epic #1074). Idempotent: the UNIQUE `(species_code, content_hash, model,
 * rubric_version)` constraint is the conflict target, and `ON CONFLICT DO
 * NOTHING` makes a re-insert of the same tuple a no-op — the FIRST write wins,
 * so a frozen `(model, rubric_version)` pin stays an immutable baseline. A
 * different image, model, or rubric each APPENDs its own row. Returns the
 * number of rows actually inserted (`rowCount`), which is < `rows.length` when
 * some tuples already existed.
 *
 * criteria/field_marks are JSONB columns: the params are `JSON.stringify`d and
 * cast `::jsonb` so a JS object/array round-trips faithfully (and `null` stays
 * SQL NULL, not the JSON string "null").
 */
export async function insertPhotoScores(pool: Pool, rows: PhotoScoreRow[]): Promise<number> {
  if (rows.length === 0) return 0;

  const values: unknown[] = [];
  const placeholders: string[] = [];

  rows.forEach((r, i) => {
    const o = i * 9;
    placeholders.push(
      `($${o + 1}, $${o + 2}, $${o + 3}, $${o + 4}, $${o + 5}, $${o + 6}, $${o + 7}::jsonb, $${o + 8}::jsonb, $${o + 9})`
    );
    values.push(
      r.speciesCode,
      r.contentHash,
      r.model,
      r.rubricVersion,
      r.keep,
      r.qualityScore,
      r.criteria === null ? null : JSON.stringify(r.criteria),
      r.fieldMarks === null ? null : JSON.stringify(r.fieldMarks),
      r.rationale,
    );
  });

  const { rowCount } = await pool.query(
    `INSERT INTO species_photo_scores
       (species_code, content_hash, model, rubric_version, keep, quality_score, criteria, field_marks, rationale)
     VALUES ${placeholders.join(',')}
     ON CONFLICT (species_code, content_hash, model, rubric_version) DO NOTHING`,
    values
  );
  return rowCount ?? 0;
}

/**
 * Read every score for one frozen baseline pin `(model, rubric_version)` — the
 * eval's (#1010, C4 #1073) primary read pattern, served by the
 * `idx_species_photo_scores_pin (model, rubric_version)` index. JSONB columns
 * deserialize to JS values automatically; `quality_score` is REAL (float4),
 * which pg parses as a JS number natively.
 */
export async function getPhotoScores(
  pool: Pool,
  pin: { model: string; rubricVersion: string },
): Promise<PhotoScoreRow[]> {
  const { rows } = await pool.query<{
    species_code: string;
    content_hash: string;
    model: string;
    rubric_version: string;
    keep: boolean;
    quality_score: number | null;
    criteria: Record<string, number> | null;
    field_marks: string[] | null;
    rationale: string | null;
  }>(
    `SELECT species_code, content_hash, model, rubric_version, keep,
            quality_score, criteria, field_marks, rationale
     FROM species_photo_scores
     WHERE model = $1 AND rubric_version = $2`,
    [pin.model, pin.rubricVersion]
  );
  return rows.map(r => ({
    speciesCode: r.species_code,
    contentHash: r.content_hash,
    model: r.model,
    rubricVersion: r.rubric_version,
    keep: r.keep,
    qualityScore: r.quality_score,
    criteria: r.criteria,
    fieldMarks: r.field_marks,
    rationale: r.rationale,
  }));
}
