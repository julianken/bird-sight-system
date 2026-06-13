/**
 * The public record interfaces for the eleatic write store.
 *
 * These are JSON-shaped and satisfy `exactOptionalPropertyTypes`: an omittable
 * field is declared `field?: T` (NOT `field: T | undefined` on a required key),
 * so a caller may legitimately leave it absent. The store coerces every absent
 * optional to a column NULL at the boundary via the `serde` helpers.
 *
 * The `*_json` columns are represented here as structured objects / opaque
 * values; serialization to TEXT happens only at the store boundary.
 *
 * Names are canonical and depended on by sibling children (E2 read API, E4
 * server): EvalRunRecord, EvalRowRecord, EvalAdjudicationRecord.
 */

/** A single eval run. Maps to the `eval_run` table. */
export interface EvalRunRecord {
  id: string;
  label: string;
  baseline?: string;
  /** Arbitrary run configuration -> config_json. */
  config?: Record<string, unknown>;
  startedAt: string;
  /** Often set later by finalizeRun once all rows have landed -> row_count. */
  rowCount?: number;
  /** Arbitrary {name:number} aggregates -> metrics_json. */
  metrics?: Record<string, number>;
}

/** A single evaluated item within a run. Maps to the `eval_row` table. */
export interface EvalRowRecord {
  runId: string;
  /** Stable cross-run identity; powers diff + adjudication. */
  rowKey: string;
  label?: string;
  imageUrl?: string;
  contentHash?: string;
  /** Opaque blob -> output_json; never destructured by the store. */
  output: unknown;
  /** Opaque blob -> expected_json; never destructured by the store. */
  expected: unknown;
  /** Numeric facet axis -> scores_json. */
  scores?: Record<string, number>;
  /** Categorical facet axis -> metadata_json. */
  metadata?: Record<string, string | number | boolean>;
}

/** A human verdict on an item, run-independent. Maps to the `eval_adjudication` table. */
export interface EvalAdjudicationRecord {
  rowKey: string;
  verdict: string;
  /** The content_hash this verdict was decided against; stale flag when eval_row.content_hash differs. */
  againstHash?: string;
  note?: string;
  decidedAt: string;
}
