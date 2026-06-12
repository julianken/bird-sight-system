import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { type CriteriaScores, CRITERIA_KEYS } from '@bird-watch/photo-quality';

/**
 * One Braintrust eval row built from the Opus current-scores in review.sqlite.
 * `expected` is the Opus keep/score, used as proxy ground truth (#1010/#1013):
 * a later run compares a cheaper judge's output against it.
 *
 * Provenance is split into two distinct identifiers (#1067):
 *   - `input.readPath` — the LOCAL cached thumbnail the bytes are read from
 *     (`<thumbDir>/<code>.{jpg,png,webp}`). A read target only; it is NOT a
 *     portable URL and is never logged as the span's `sourceUrl`.
 *   - `input.imageUrl` — the production R2 URL (`photo_current.url`, stored
 *     VERBATIM, mixed `.jpg`/`.jpeg`/`.png` extensions). This is what the eval
 *     logs as the span's `sourceUrl` so Braintrust renders the real thumbnail
 *     and the experiment is portable across machines.
 *
 * `metadata.contentHash` ties the row back to the exact image bytes the Opus
 * pass scored. `expected.criteria` carries the Opus per-axis sub-scores
 * (`photo_score.criteria_json`) when present, so the per-axis scorers can
 * compare them against the candidate judge's; `undefined` when the baseline
 * row has no `criteria_json` (an axis-skip, never a fabricated zero).
 */
export interface EvalRow {
  input: {
    /** LOCAL cached-thumbnail path the judge reads bytes from (not a URL). */
    readPath: string;
    /** Production R2 URL (`photo_current.url`), logged as the span `sourceUrl`. */
    imageUrl: string;
    speciesCode: string;
    comName: string;
    sciName: string;
    family: string;
  };
  expected: {
    keep: boolean;
    qualityScore: number;
    /** Opus per-axis sub-scores (0–10) when the baseline row carried them. */
    criteria?: CriteriaScores;
  };
  metadata: {
    contentHash: string;
    /**
     * The `rubric_version` the baseline row was judged under (#1037): the
     * version whose criteria `expected` encodes. The eval pins the judge
     * prompt to this version, and the judgment span logs the version it
     * judged WITH (`judgedRubricVersion`) — equal by construction, logged on
     * both sides so any future mismatch is visible in Braintrust, not silent.
     */
    expectedRubricVersion: string;
  };
}

/** Options for {@link buildEvalRows}. */
export interface BuildEvalRowsOpts {
  /** Directory holding the cached current thumbnails (`<code>.jpg|.png|.webp`). */
  thumbDir: string;
  /** When set, stratified-sample down to this many rows (keep=true / keep=false). */
  sample?: number;
  /** PRNG seed for the deterministic stratified sample. Defaults to {@link DEFAULT_SEED}. */
  seed?: number;
}

/**
 * Default PRNG seed. The issue (#1013) labels this `0xB1RD` — a stylized
 * "BIRD" that is NOT a valid hex literal (`R` is not a hex digit), so it is
 * rendered here to the valid leetspeak hex `0xB12D` (B-I-R-D). The numeric
 * value is what makes the sample deterministic; nothing downstream pins the
 * spelling, so any fixed constant satisfies the contract.
 */
export const DEFAULT_SEED = 0xb12d;

/** A row of the role='current' score join, before coalescing. */
interface ScoreJoinRow {
  species_code: string;
  keep: number | null;
  quality_score: number | null;
  overall: number;
  content_hash: string;
  rubric_version: string | null;
  criteria_json: string | null;
  url: string | null;
  com_name: string;
  sci_name: string;
  family: string;
}

/**
 * Parse a baseline `criteria_json` blob into `CriteriaScores`, or `undefined`
 * when the column is NULL/empty (an axis-skip on the expected side — the
 * per-axis scorers never fabricate agreement from a missing baseline). Parse
 * failures and shape mismatches also yield `undefined` rather than throwing:
 * a malformed legacy blob must skip its axes, not abort the whole dataset.
 */
export function parseCriteria(criteriaJson: string | null): CriteriaScores | undefined {
  if (criteriaJson === null || criteriaJson === '') return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(criteriaJson);
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined;
  const obj = parsed as Record<string, unknown>;
  const out = {} as CriteriaScores;
  for (const key of CRITERIA_KEYS) {
    const v = obj[key];
    if (typeof v !== 'number') return undefined;
    out[key] = v;
  }
  return out;
}

/**
 * Assert the single-rubric-version invariant (#1037 decision 1) over the FULL
 * fetched row set and return that version. Runs BEFORE image resolution and
 * BEFORE sampling, so a mixed-version or unknown-provenance baseline fails
 * deterministically — never depending on which rows a seed happens to sample.
 * The rubric version is part of the DATASET, not the live code: an
 * interchangeability eval must hold criteria constant at the version the
 * baseline was judged under, so anything else is a hard fail, never a silent
 * judge-under-different-criteria run.
 */
function assertSingleRubricVersion(joinRows: ScoreJoinRow[]): string {
  if (joinRows.length === 0) {
    throw new Error(
      "[build-dataset] no role='current' scores found — there is no baseline rubric version to pin the judge prompt to (is REVIEW_DB the scored baseline?)",
    );
  }
  const missing = joinRows.filter((r) => r.rubric_version === null || r.rubric_version === '');
  if (missing.length > 0) {
    throw new Error(
      `[build-dataset] ${missing.length} of ${joinRows.length} fetched rows have no rubric_version — unknown provenance cannot be judged under pinned criteria (e.g. ${missing[0]!.species_code})`,
    );
  }
  const counts = new Map<string, number>();
  for (const r of joinRows) {
    const v = r.rubric_version as string;
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  if (counts.size > 1) {
    const breakdown = [...counts.entries()].map(([v, n]) => `${v} × ${n}`).join(', ');
    throw new Error(
      `[build-dataset] mixed rubric_versions in the fetched baseline (${breakdown}) — an interchangeability eval must hold criteria constant; re-score the baseline to one version`,
    );
  }
  return counts.keys().next().value as string;
}

/**
 * A 32-bit mulberry32 PRNG. Pure and deterministic: same `seed` → same stream.
 * Returns a function yielding floats in [0, 1).
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * In-place Fisher–Yates shuffle of `arr` driven by `rng`. Mutates and returns
 * the array. Standard high-to-low-index walk so the shuffle is fully determined
 * by the `rng` stream.
 */
export function shuffleInPlace<T>(arr: T[], rng: () => number): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j] as T, arr[i] as T];
  }
  return arr;
}

/**
 * Resolve the cached thumbnail for `speciesCode` under `thumbDir` by extension
 * glob (`<code>.*`) — currents are written `.jpg`/`.png`/`.webp` by `extFromMime`
 * (sources.ts), so a hardcoded `.jpg` would silently miss non-jpeg currents.
 * Returns the first matching filename (in sorted order), or `null` when nothing
 * matches. The directory listing is SORTED before the lookup so that when a
 * species somehow has two cached extensions (e.g. a stale `amerob.png` beside a
 * fresh `amerob.jpg`), the chosen file is deterministic across machines/runs —
 * `readdirSync` order is filesystem-dependent.
 */
function resolveImage(thumbDir: string, speciesCode: string): string | null {
  let entries: string[];
  try {
    entries = readdirSync(thumbDir);
  } catch {
    return null;
  }
  entries.sort();
  const prefix = `${speciesCode}.`;
  const match = entries.find((name) => name.startsWith(prefix));
  return match ?? null;
}

/**
 * Build stratified eval rows from the role='current' Opus scores in `db`.
 *
 * Deterministic-gate rows are excluded at the query (#1037 decision 2), and
 * the single-rubric-version invariant is asserted over the full fetched set
 * before anything else (#1037 decision 1) — see
 * {@link assertSingleRubricVersion}. Every surviving row carries
 * `metadata.expectedRubricVersion` (the asserted version).
 *
 * Reads every current score joined to its `photo_current` metadata, coalesces
 * `keep`/`qualityScore` exactly as the review store does (`store.ts`
 * getScoreByHash: missing `keep` ⇒ kept, missing `quality_score` ⇒ `overall`),
 * resolves each image by extension glob, and skips (with a logged note) any
 * row whose image is absent from `thumbDir`.
 *
 * When `opts.sample` is set, the surviving rows are split into keep=true /
 * keep=false strata, each shuffled by a seeded mulberry32 Fisher–Yates, and a
 * proportional allocation is taken from the front of each shuffled stratum
 * (clamp remainder pushed to the other stratum). Output is deterministic for a
 * fixed `seed`.
 */
export function buildEvalRows(
  db: Database.Database,
  opts: BuildEvalRowsOpts,
): EvalRow[] {
  const { thumbDir, sample, seed = DEFAULT_SEED } = opts;

  // Det-gate rows (`rationale LIKE 'deterministic gate%'`) are sharpness-
  // heuristic verdicts with keep=0 / quality_score=0 — not Opus findings, so
  // the judge must never be graded against them (#1037 decision 2). The
  // predicate is NULL-safe: a bare `NOT LIKE` evaluates to NULL (row dropped)
  // for a NULL rationale, which would silently exclude Opus rows without one.
  const joinRows = db
    .prepare(
      `SELECT s.species_code, s.keep, s.quality_score, s.overall, s.content_hash,
              s.rubric_version, s.criteria_json, c.url, c.com_name, c.sci_name, c.family
         FROM photo_score s JOIN photo_current c USING(species_code)
        WHERE s.role = 'current'
          AND (s.rationale IS NULL OR s.rationale NOT LIKE 'deterministic gate%')`,
    )
    .all() as ScoreJoinRow[];

  const rubricVersion = assertSingleRubricVersion(joinRows);

  const rows: EvalRow[] = [];
  for (const row of joinRows) {
    const file = resolveImage(thumbDir, row.species_code);
    if (file === null) {
      console.warn(
        `[build-dataset] skipping ${row.species_code}: no cached image in ${thumbDir}`,
      );
      continue;
    }
    const criteria = parseCriteria(row.criteria_json);
    rows.push({
      input: {
        readPath: join(thumbDir, file),
        // The stored R2 URL VERBATIM (#1067): extensions vary in the DB
        // (.jpg/.jpeg/.png) and a reconstructed `<code>.jpeg` template 404s for
        // hundreds of species, so we never template — we log the column as-is.
        imageUrl: row.url ?? '',
        speciesCode: row.species_code,
        comName: row.com_name,
        sciName: row.sci_name,
        family: row.family,
      },
      expected: {
        keep: row.keep === null ? true : row.keep === 1,
        qualityScore: row.quality_score ?? row.overall,
        // `undefined` (NOT `{}`) when the baseline has no criteria_json — the
        // per-axis scorers skip a missing axis rather than scoring a phantom 0.
        ...(criteria !== undefined ? { criteria } : {}),
      },
      metadata: { contentHash: row.content_hash, expectedRubricVersion: rubricVersion },
    });
  }

  if (sample === undefined) return rows;

  return stratifiedSample(rows, sample, seed);
}

/**
 * Deterministic stratified sample of `rows` down to `sample` rows.
 *
 * Splits into keep=true / keep=false strata, shuffles each with a seeded
 * mulberry32 Fisher–Yates, then takes a proportional allocation
 * (`keepTake = round(sample * keepRows / total)`, `notTake = sample - keepTake`),
 * each clamped to its stratum size with the clamp remainder pushed to the other
 * stratum. Takes the first `keepTake`/`notTake` of each shuffled stratum and
 * concatenates (keep stratum first).
 */
function stratifiedSample(rows: EvalRow[], sample: number, seed: number): EvalRow[] {
  const total = rows.length;
  if (sample >= total) return rows;

  const keepRows = rows.filter((r) => r.expected.keep);
  const notRows = rows.filter((r) => !r.expected.keep);

  const rng = mulberry32(seed);
  shuffleInPlace(keepRows, rng);
  shuffleInPlace(notRows, rng);

  let keepTake = Math.round((sample * keepRows.length) / total);
  let notTake = sample - keepTake;

  // Clamp each take to its stratum size, pushing any remainder to the other
  // stratum (so the total stays `sample` whenever the strata can satisfy it).
  if (keepTake > keepRows.length) {
    notTake += keepTake - keepRows.length;
    keepTake = keepRows.length;
  }
  if (notTake > notRows.length) {
    keepTake += notTake - notRows.length;
    notTake = notRows.length;
  }
  // The first clamp can over-fill keep if not was short; clamp once more.
  if (keepTake > keepRows.length) keepTake = keepRows.length;

  return [...keepRows.slice(0, keepTake), ...notRows.slice(0, notTake)];
}
