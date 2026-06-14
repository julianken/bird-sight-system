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
  /**
   * Optional, OPAQUE generic LLM trace -> trace_json; never destructured by the
   * store. Conventionally `{ spans: [{ name, input, output, usage }] }`, but any
   * JSON value round-trips (a non-conforming blob is pretty-printed whole in the
   * drawer). Surfaced ONLY by the single-row read path (`getRow`) — list
   * payloads stay lean and omit it.
   */
  trace?: unknown;
}

/**
 * The conventional TREE layout layered over the opaque `trace_json` blob.
 *
 * DOCUMENTATION types only: they describe the shape `buildTraceTree`
 * (ui/trace-tree.js) reconstructs a tree from, and the shape the photo-curation
 * producer emits. They DO NOT retype `EvalRowRecord.trace`, which STAYS
 * `trace?: unknown` so legacy + non-conforming blobs still round-trip unchanged.
 * A producer MAY locally type its trace value as `EvalTrace`; the store and the
 * read path remain blob-opaque.
 *
 * A span is keyed by `id` and points at its parent by `parentId` (null = a
 * root). `kind` is free-form and producer-owned — eleatic STYLES by it but never
 * branches on its semantics. `metrics` is the canonical camelCase metrics object
 * new producers emit; a legacy span instead carries `usage` (latencyMs, …),
 * which `buildTraceTree` normalizes to a node's `metrics` at its single mapping
 * point (latencyMs→durationMs the only rename) — renderers read the node's
 * normalized metrics, never `span.usage`.
 */
export interface EvalSpan {
  /** Stable within the trace; the tree key. */
  id: string;
  /** null = a root; else the id of a sibling span. */
  parentId: string | null;
  /** Node label (icon · name in the tree pane). */
  name: string;
  /** Free-form, producer-owned: "eval" | "task" | "llm" | "scorer" | … */
  kind?: string;
  /** Pretty-printed in the right pane (opaque). */
  input?: unknown;
  /** Pretty-printed in the right pane (opaque). */
  output?: unknown;
  /** Canonical metrics object (camelCase). New producers emit this. */
  metrics?: {
    startMs?: number;
    durationMs?: number;
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    costUsd?: number;
  };
  /** A scorer leaf carries its score here. */
  scores?: Record<string, number>;
  /** Free-form, producer-owned. */
  status?: string;
}

/** The `{ spans }` envelope — the SAME `spans` key as today's flat trace. */
export interface EvalTrace {
  spans: EvalSpan[];
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
