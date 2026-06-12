// ─────────────────────────────────────────────────────────────────────────────
// One-time, operator-run backfill of the review.sqlite photo-quality baseline
// into prod `species_photo_scores` (epic #1074, C3 #1072).
//
// Loads the 902 `role='current'` rows from the operator-local review.sqlite and
// inserts them into prod Postgres via C2's `insertPhotoScores`, which is
// idempotent (`ON CONFLICT (species_code, content_hash, model, rubric_version)
// DO NOTHING`). A second run therefore inserts 0 — the frozen
// `(model, rubric_version)` pin stays an immutable ground-truth baseline.
//
// PROVENANCE MAPPING (locked, #1072):
//   - The 889 Opus-judged rows (rationale NOT 'deterministic gate%') →
//       model = 'claude-opus-4-8', rubric_version = '0.2.1'.
//   - The 13 deterministic-gate rows (rationale 'deterministic gate%',
//       keep = 0, quality_score = 0) → model = 'deterministic-gate',
//       rubric_version = '0.2.1'. They were NEVER LLM-judged — mislabeling them
//       as the Opus pin would poison the eval's baseline (#1037 already excludes
//       them at dataset-build time, but the row must carry the honest model).
// content_hash / keep / quality_score / rationale are carried verbatim;
// criteria_json → criteria and field_marks → fieldMarks are JSON-parsed.
//
// Operator-run, NOT CI: it reads a local SQLite that does not exist in CI and
// writes to PROD with a read-write connection string (same posture as the
// silhouette admin scripts). The pure mapping (`mapRow`) and the orchestration
// (`runBackfill`, with the prod write injected) are unit-tested without a
// network or a real DB — only the thin CLI glue (`main`) opens the real SQLite
// and prod pool.
//
// Lives OUTSIDE src/ (the tsconfig rootDir), like the eval + analyze entries, so
// it is not a tsc build target; `tsx` runs it directly via
//   npm run backfill-scores -w @bird-watch/photo-curation.
// ─────────────────────────────────────────────────────────────────────────────

import type { PhotoScoreRow } from '@bird-watch/shared-types';

/** The frozen baseline pin: every backfilled row records rubric v0.2.1 (#1072). */
export const RUBRIC_VERSION = '0.2.1';
/** Model pin for the 889 Opus-judged rows. */
export const OPUS_MODEL = 'claude-opus-4-8';
/** Model pin for the 13 deterministic-gate (sharpness-heuristic) rows. */
export const DET_GATE_MODEL = 'deterministic-gate';

/** Marker that classifies a row as a deterministic-gate verdict, not an Opus finding. */
const DET_GATE_PREFIX = 'deterministic gate';

/**
 * One `photo_score` row with `role='current'` as `better-sqlite3` returns it.
 * SQLite types: `keep` is an INTEGER 0/1; `quality_score` is a REAL;
 * `criteria_json` / `field_marks` are JSON strings; the rest are TEXT. Any
 * column may be SQL NULL (the real baseline has none, but the mapping handles it
 * defensively).
 */
export interface ReviewScoreRow {
  species_code: string;
  content_hash: string;
  keep: number | null;
  quality_score: number | null;
  criteria_json: string | null;
  field_marks: string | null;
  rationale: string | null;
}

/** A deterministic-gate row is one whose rationale starts with the gate marker. */
function isDeterministicGate(rationale: string | null): boolean {
  return rationale != null && rationale.startsWith(DET_GATE_PREFIX);
}

/** Parse a JSON column, returning `null` for a NULL/blank cell. Throws on malformed JSON (fail loud). */
function parseJsonColumn<T>(raw: string | null): T | null {
  if (raw == null) return null;
  return JSON.parse(raw) as T;
}

/**
 * PURE: project a review.sqlite `role='current'` row onto a `PhotoScoreRow`,
 * applying the locked provenance mapping. Unit-tested — no SQLite, no network.
 */
export function mapRow(row: ReviewScoreRow): PhotoScoreRow {
  const model = isDeterministicGate(row.rationale) ? DET_GATE_MODEL : OPUS_MODEL;
  return {
    speciesCode: row.species_code,
    contentHash: row.content_hash,
    model,
    rubricVersion: RUBRIC_VERSION,
    keep: Boolean(row.keep),
    qualityScore: row.quality_score,
    criteria: parseJsonColumn<Record<string, number>>(row.criteria_json),
    fieldMarks: parseJsonColumn<string[]>(row.field_marks),
    rationale: row.rationale,
  };
}

/** The injected prod write — `insertPhotoScores(pool, rows)` curried over the pool. Returns rows inserted. */
export type InsertScores = (rows: PhotoScoreRow[]) => Promise<number>;

/** Read N, inserted M, skipped-existing K. `skipped = read − inserted`. */
export interface BackfillSummary {
  read: number;
  inserted: number;
  skipped: number;
}

/**
 * Map every baseline row, push them through the injected idempotent insert, and
 * return the summary. PURE of I/O: `insert` is injected (defaults to nothing —
 * the caller supplies the prod-bound `insertPhotoScores`), so the unit test
 * needs no network. `inserted` is what the DB actually wrote (`< read` on a
 * re-run); `skipped` is the ON CONFLICT DO NOTHING remainder.
 */
export async function runBackfill(opts: {
  rows: ReviewScoreRow[];
  insert: InsertScores;
  log?: (...args: unknown[]) => void;
}): Promise<BackfillSummary> {
  const log = opts.log ?? (() => {});
  const mapped = opts.rows.map(mapRow);
  const inserted = await opts.insert(mapped);
  const summary: BackfillSummary = {
    read: mapped.length,
    inserted,
    skipped: mapped.length - inserted,
  };
  log(
    `backfill-scores: read ${summary.read}, inserted ${summary.inserted}, skipped-existing ${summary.skipped}`,
  );
  return summary;
}

// ── CLI glue (operator-run; opens real SQLite + prod pool; not unit-tested) ───

/** SQL for the 902 `role='current'` baseline rows, projected to `ReviewScoreRow`. */
const SELECT_CURRENT_SCORES = `
  SELECT species_code, content_hash, keep, quality_score, criteria_json, field_marks, rationale
  FROM photo_score
  WHERE role = 'current'
  ORDER BY species_code
`;

/**
 * CLI entry. Opens review.sqlite (`REVIEW_DB`, default ./review.sqlite), opens a
 * prod RW pool (`DATABASE_URL`), and runs the backfill. `process.env` and the
 * dynamic imports are read at call time so the unit test never reaches here.
 */
export async function main(env: NodeJS.ProcessEnv = process.env): Promise<number> {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) {
    console.error(
      'backfill-scores: DATABASE_URL is required (a PROD read-WRITE connection string). Aborting.',
    );
    return 2;
  }
  const dbPath = env.REVIEW_DB ?? './review.sqlite';

  // Imported dynamically so the pure unit test never loads better-sqlite3 / pg.
  const [{ default: Database }, { createPool, closePool, insertPhotoScores }] = await Promise.all([
    import('better-sqlite3'),
    import('@bird-watch/db-client'),
  ]);

  const sqlite = new Database(dbPath, { readonly: true, fileMustExist: true });
  let rows: ReviewScoreRow[];
  try {
    rows = sqlite.prepare(SELECT_CURRENT_SCORES).all() as ReviewScoreRow[];
  } finally {
    sqlite.close();
  }

  const pool = createPool({ databaseUrl });
  try {
    await runBackfill({
      rows,
      insert: (toInsert) => insertPhotoScores(pool, toInsert),
      log: (...args) => console.log(...args),
    });
  } finally {
    await closePool(pool);
  }
  return 0;
}

// Run only when invoked directly (tsx scripts/backfill-scores-to-prod.ts), never on import.
if (import.meta.url === `file://${process.argv[1]}`) {
  main()
    .then((code) => process.exit(code))
    .catch((err: unknown) => {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    });
}
