/**
 * The eleatic READ-query API: a pure, read-only SQLite layer over the generic
 * three-table schema E1 created (`eval_run` / `eval_row` / `eval_adjudication`).
 * It powers the comparison hub (`listRuns`/`getRun`), per-row diff (`diffRuns`),
 * the faceted gallery (`facetRows`), trends (`metricTrend`), and adjudication
 * drill-down (`listAdjudications`/`isStale`).
 *
 * This is the generic GENERALIZATION of the photo-judge's hard-coded
 * `tools/photo-curation/src/server/eval-queries.ts` (`evalFalseKeeps` →
 * `facetRows` with a `FacetQuery`).
 *
 * Load-bearing constraints (see the issue + E1 conventions):
 *   • EVERY query is parameterized — `?` placeholders, never string-interpolated
 *     values. The one apparent exception is the `json_extract` JSON-pointer
 *     constant, which is a VETTED path (prefix ∈ {scores,metadata}, key ∈ the
 *     run's discovered keys) and never raw caller input. The filter value is
 *     always a `?` bind parameter.
 *   • ZERO `@bird-watch/*` imports — only `better-sqlite3` (type-only) and `./`
 *     siblings, so the package can `git mv` to its own repo (E9 guard).
 *   • Read-only: no DB opening (takes an opened handle, mirroring E1's
 *     `EleaticStore`), no writes, no network.
 *   • Strict tsconfig: `exactOptionalPropertyTypes` — an absent column reads back
 *     as an OMITTED key, never `undefined` assigned to a required field;
 *     `noUncheckedIndexedAccess` — array indexing is guarded.
 */

import type Database from 'better-sqlite3';
import { nullableNumber, parseJson } from './serde.js';
import type { EvalRunRecord, EvalRowRecord, EvalAdjudicationRecord } from './types.js';

// ── Net-new public types this issue OWNS (E4/E6 reference verbatim) ───────────

/** A SQLite-storable JSON leaf used as a facet filter value. */
export type JsonScalar = string | number | boolean | null;

export interface FacetFilter {
  /**
   * `"scores.<name>"` → `json_extract(scores_json,'$.<name>')`;
   * `"metadata.<key>"` → `json_extract(metadata_json,'$.<key>')`.
   */
  path: string;
  op: 'eq' | 'ne' | 'lt' | 'lte' | 'gt' | 'gte' | 'in' | 'contains' | 'exists';
  value?: JsonScalar | JsonScalar[];
}

export interface FacetQuery {
  /** ANDed together. */
  filters?: FacetFilter[];
  sort?: { path: string; dir: 'asc' | 'desc' };
  /** Gallery cap (epic targets 150–1000-row scale). */
  limit?: number;
  offset?: number;
}

/** One per-`row_key` A/B comparison; `a`/`b` are present only on that side. */
export interface RunDiff {
  rowKey: string;
  a?: EvalRowRecord;
  b?: EvalRowRecord;
}

/** One trend point: a run's value for a named metric (omitted when absent). */
export interface MetricPoint {
  runId: string;
  startedAt: string;
  value?: number;
}

/** The read-only query surface returned by `makeReader`. */
export interface EleaticReader {
  listRuns(): EvalRunRecord[];
  getRun(id: string): EvalRunRecord | undefined;
  /** Lean list payload — never includes the per-row `trace` blob. */
  getRows(runId: string): EvalRowRecord[];
  /** The drill-down read — the ONLY surface that returns the optional `trace`. */
  getRow(runId: string, rowKey: string): EvalRowRecord | undefined;
  diffRuns(aRunId: string, bRunId: string): RunDiff[];
  facetRows(runId: string, q: FacetQuery): EvalRowRecord[];
  metricTrend(metricName: string): MetricPoint[];
  listAdjudications(rowKeys?: string[]): EvalAdjudicationRecord[];
  isStale(rowKey: string, currentHash: string): boolean;
}

// ── Raw column shapes (snake_case, NULLs intact) ──────────────────────────────

interface RunDbRow {
  id: string;
  label: string | null;
  baseline: string | null;
  config_json: string | null;
  started_at: string | null;
  row_count: number | null;
  metrics_json: string | null;
}
interface EvalRowDbRow {
  run_id: string;
  row_key: string;
  label: string | null;
  image_url: string | null;
  content_hash: string | null;
  output_json: string | null;
  expected_json: string | null;
  scores_json: string | null;
  metadata_json: string | null;
  trace_json: string | null;
}
interface AdjDbRow {
  row_key: string;
  verdict: string | null;
  against_hash: string | null;
  note: string | null;
  decided_at: string | null;
}

// ── Read mappers: snake_case DbRow → camelCase record ─────────────────────────
//
// Under `exactOptionalPropertyTypes` an omittable field must be an ABSENT key,
// not `undefined`. So each mapper builds the required core, then conditionally
// assigns each optional only when its column was non-NULL. `??` defaults guard
// the rare NULL in a not-truly-nullable column (e.g. a label written NULL).

function readRun(row: RunDbRow): EvalRunRecord {
  const rec: EvalRunRecord = {
    id: row.id,
    label: row.label ?? '',
    startedAt: row.started_at ?? '',
  };
  if (row.baseline !== null) rec.baseline = row.baseline;
  const config = parseJson<Record<string, unknown>>(row.config_json);
  if (config !== undefined) rec.config = config;
  const rowCount = nullableNumber(row.row_count);
  if (rowCount !== undefined) rec.rowCount = rowCount;
  const metrics = parseJson<Record<string, number>>(row.metrics_json);
  if (metrics !== undefined) rec.metrics = metrics;
  return rec;
}

// The SHARED row mapper behind every list/diff path (`getRows`/`facetRows`/
// `diffRuns`). It deliberately OMITS `trace`: a trace blob can be large, and the
// gallery/diff payloads carry one record per row at 150–1000-row scale — keeping
// the heavy blob out of the list responses is the leanness invariant. The single
// `trace` consumer (`getRow`, the drawer drill-down) layers it back on via
// `readRowWithTrace` below.
function readRow(row: EvalRowDbRow): EvalRowRecord {
  const rec: EvalRowRecord = {
    runId: row.run_id,
    rowKey: row.row_key,
    output: parseJson<unknown>(row.output_json),
    expected: parseJson<unknown>(row.expected_json),
  };
  if (row.label !== null) rec.label = row.label;
  if (row.image_url !== null) rec.imageUrl = row.image_url;
  if (row.content_hash !== null) rec.contentHash = row.content_hash;
  const scores = parseJson<Record<string, number>>(row.scores_json);
  if (scores !== undefined) rec.scores = scores;
  const metadata = parseJson<Record<string, string | number | boolean>>(row.metadata_json);
  if (metadata !== undefined) rec.metadata = metadata;
  return rec;
}

// The single-row mapper: `readRow` plus the optional `trace` blob. Only `getRow`
// uses this, so the trace never bloats the list/diff payloads above. NULL → an
// ABSENT `trace` key (exactOptionalPropertyTypes), never `undefined` assigned.
function readRowWithTrace(row: EvalRowDbRow): EvalRowRecord {
  const rec = readRow(row);
  const trace = parseJson<unknown>(row.trace_json);
  if (trace !== undefined) rec.trace = trace;
  return rec;
}

function readAdj(row: AdjDbRow): EvalAdjudicationRecord {
  const rec: EvalAdjudicationRecord = {
    rowKey: row.row_key,
    verdict: row.verdict ?? '',
    decidedAt: row.decided_at ?? '',
  };
  if (row.against_hash !== null) rec.againstHash = row.against_hash;
  if (row.note !== null) rec.note = row.note;
  return rec;
}

// ── Facet path validation + SQL fragment building ─────────────────────────────

const FACET_COLUMN: Record<string, string> = {
  scores: 'scores_json',
  metadata: 'metadata_json',
};

/**
 * Validate a facet `path` and return the vetted `json_extract(...)` SQL fragment.
 *
 * `path` is `<prefix>.<key>`: the prefix MUST be exactly `scores` or `metadata`
 * (anything else throws — the E4 server maps the throw to a 400), and the key
 * MUST be in the run's DISCOVERED key set (derived from the run's stored
 * scores/metadata JSON). This keeps `json_extract`'s pointer a vetted constant
 * rather than raw caller input, so a caller cannot probe arbitrary paths.
 */
function vettedExtract(path: string, discovered: DiscoveredKeys): string {
  const dot = path.indexOf('.');
  const prefix = dot === -1 ? path : path.slice(0, dot);
  const key = dot === -1 ? '' : path.slice(dot + 1);
  const column = FACET_COLUMN[prefix];
  if (column === undefined) {
    throw new Error(`Invalid facet path prefix "${prefix}" in "${path}" (expected scores|metadata)`);
  }
  const allowed = prefix === 'scores' ? discovered.scores : discovered.metadata;
  if (key === '' || !allowed.has(key)) {
    throw new Error(`Unknown facet key "${key}" for ${prefix} in "${path}"`);
  }
  // The JSON pointer is built from a vetted key. Quote any embedded `"` so a
  // discovered key containing a quote can't break out of the pointer literal.
  const pointer = `$."${key.replace(/"/g, '""')}"`;
  return `json_extract(${column}, '${pointer}')`;
}

interface DiscoveredKeys {
  scores: Set<string>;
  metadata: Set<string>;
}

/** Union the `scores`/`metadata` object keys across every row of a run. */
function discoverKeys(rows: EvalRowDbRow[]): DiscoveredKeys {
  const scores = new Set<string>();
  const metadata = new Set<string>();
  for (const r of rows) {
    const s = parseJson<Record<string, unknown>>(r.scores_json);
    if (s !== undefined) for (const k of Object.keys(s)) scores.add(k);
    const m = parseJson<Record<string, unknown>>(r.metadata_json);
    if (m !== undefined) for (const k of Object.keys(m)) metadata.add(k);
  }
  return { scores, metadata };
}

export function makeReader(db: Database.Database): EleaticReader {
  const listRunsStmt = db.prepare(
    `SELECT * FROM eval_run ORDER BY started_at DESC`,
  );
  const getRunStmt = db.prepare(`SELECT * FROM eval_run WHERE id = ?`);
  const getRowsStmt = db.prepare(
    `SELECT * FROM eval_row WHERE run_id = ? ORDER BY row_key`,
  );
  const getRowStmt = db.prepare(
    `SELECT * FROM eval_row WHERE run_id = ? AND row_key = ?`,
  );
  const trendStmt = db.prepare(`SELECT * FROM eval_run ORDER BY started_at ASC`);
  const getAdjStmt = db.prepare(`SELECT * FROM eval_adjudication WHERE row_key = ?`);
  const allAdjStmt = db.prepare(`SELECT * FROM eval_adjudication ORDER BY row_key`);

  function getRows(runId: string): EvalRowRecord[] {
    return (getRowsStmt.all(runId) as EvalRowDbRow[]).map(readRow);
  }

  function facetRows(runId: string, q: FacetQuery): EvalRowRecord[] {
    const rawRows = getRowsStmt.all(runId) as EvalRowDbRow[];
    const discovered = discoverKeys(rawRows);

    const where: string[] = ['run_id = ?'];
    const params: Array<JsonScalar | undefined> = [runId];

    for (const filter of q.filters ?? []) {
      const extract = vettedExtract(filter.path, discovered);
      switch (filter.op) {
        case 'exists':
          where.push(`${extract} IS NOT NULL`);
          break;
        case 'in': {
          const list = Array.isArray(filter.value) ? filter.value : [];
          if (list.length === 0) {
            where.push('0'); // empty IN () matches nothing
          } else {
            where.push(`${extract} IN (${list.map(() => '?').join(', ')})`);
            for (const v of list) params.push(v);
          }
          break;
        }
        case 'contains':
          where.push(`${extract} LIKE ?`);
          params.push(`%${String(scalar(filter.value))}%`);
          break;
        default: {
          const opSql = { eq: '=', ne: '!=', lt: '<', lte: '<=', gt: '>', gte: '>=' }[filter.op];
          where.push(`${extract} ${opSql} ?`);
          params.push(scalar(filter.value));
        }
      }
    }

    let sql = `SELECT * FROM eval_row WHERE ${where.join(' AND ')}`;
    if (q.sort) {
      const sortExtract = vettedExtract(q.sort.path, discovered);
      const dir = q.sort.dir === 'desc' ? 'DESC' : 'ASC';
      sql += ` ORDER BY ${sortExtract} ${dir}, row_key ${dir}`;
    } else {
      sql += ` ORDER BY row_key`;
    }
    // LIMIT/OFFSET are passed as bind params, not interpolated.
    const limitParams: number[] = [];
    if (q.limit !== undefined) {
      sql += ` LIMIT ?`;
      limitParams.push(q.limit);
      if (q.offset !== undefined) {
        sql += ` OFFSET ?`;
        limitParams.push(q.offset);
      }
    } else if (q.offset !== undefined) {
      // SQLite requires a LIMIT before OFFSET; -1 means "no limit".
      sql += ` LIMIT -1 OFFSET ?`;
      limitParams.push(q.offset);
    }

    const bind: Array<JsonScalar | number> = [];
    for (const p of params) bind.push(p ?? null);
    for (const p of limitParams) bind.push(p);
    return (db.prepare(sql).all(...bind) as EvalRowDbRow[]).map(readRow);
  }

  return {
    listRuns() {
      return (listRunsStmt.all() as RunDbRow[]).map(readRun);
    },
    getRun(id) {
      const row = getRunStmt.get(id) as RunDbRow | undefined;
      return row === undefined ? undefined : readRun(row);
    },
    getRows,
    getRow(runId, rowKey) {
      const row = getRowStmt.get(runId, rowKey) as EvalRowDbRow | undefined;
      // The ONLY path that surfaces `trace` — the drawer drill-down. List/diff
      // paths use the lean `readRow` so the heavy blob never rides the gallery.
      return row === undefined ? undefined : readRowWithTrace(row);
    },
    diffRuns(aRunId, bRunId) {
      const byKey = new Map<string, RunDiff>();
      for (const r of getRows(aRunId)) {
        byKey.set(r.rowKey, { rowKey: r.rowKey, a: r });
      }
      for (const r of getRows(bRunId)) {
        const existing = byKey.get(r.rowKey);
        if (existing === undefined) byKey.set(r.rowKey, { rowKey: r.rowKey, b: r });
        else existing.b = r;
      }
      return [...byKey.values()].sort((x, y) => (x.rowKey < y.rowKey ? -1 : x.rowKey > y.rowKey ? 1 : 0));
    },
    facetRows,
    metricTrend(metricName) {
      const runs = trendStmt.all() as RunDbRow[];
      return runs.map((row) => {
        const point: MetricPoint = { runId: row.id, startedAt: row.started_at ?? '' };
        const metrics = parseJson<Record<string, number>>(row.metrics_json);
        const value = metrics?.[metricName];
        if (value !== undefined) point.value = value;
        return point;
      });
    },
    listAdjudications(rowKeys) {
      if (rowKeys === undefined) {
        return (allAdjStmt.all() as AdjDbRow[]).map(readAdj);
      }
      if (rowKeys.length === 0) return [];
      const placeholders = rowKeys.map(() => '?').join(', ');
      const rows = db
        .prepare(`SELECT * FROM eval_adjudication WHERE row_key IN (${placeholders}) ORDER BY row_key`)
        .all(...rowKeys) as AdjDbRow[];
      return rows.map(readAdj);
    },
    isStale(rowKey, currentHash) {
      const row = getAdjStmt.get(rowKey) as AdjDbRow | undefined;
      const recorded = row?.against_hash;
      // No adjudication, or no recorded hash → cannot be stale.
      if (recorded === undefined || recorded === null) return false;
      return recorded !== currentHash;
    },
  };
}

/** Narrow a possibly-array facet value to a single scalar for binary ops. */
function scalar(value: JsonScalar | JsonScalar[] | undefined): JsonScalar {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}
