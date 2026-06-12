import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { type CriteriaScores, CRITERIA_KEYS, contentHash } from '@bird-watch/photo-quality';
import type { PhotoScoreRow } from '@bird-watch/shared-types';

/**
 * One Braintrust eval row built from the frozen Opus baseline that now lives in
 * prod `species_photo_scores` (#1073/C4 — read via C2's `getPhotoScores`). The
 * SCORE (`expected`, `metadata.contentHash`, …) comes from prod; the species
 * METADATA (`com_name`/`sci_name`/`family`/`url`) and the image BYTES still come
 * from the operator-local review store + thumb-cache, so the eval is portable
 * across machines for the score yet reads the exact bytes the baseline scored.
 *
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
 * pass scored — and (#1073) is the value the local image is HASH-VERIFIED
 * against before judging, so Gemini never scores different bytes than the
 * baseline even though score and image now come from different stores.
 * `expected.criteria` carries the Opus per-axis sub-scores when present, so the
 * per-axis scorers can compare them against the candidate judge's; `undefined`
 * when the baseline row has no criteria (an axis-skip, never a fabricated zero).
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

/**
 * The injected prod-baseline reader (#1073): `getPhotoScores(pool, pin)` curried
 * over the pool + pin, so `buildEvalRows` stays decoupled from `pg` and the unit
 * test injects a fake returning fixture rows — no live DB in CI.
 */
export type ScoreReader = () => Promise<PhotoScoreRow[]>;

/** Options for {@link buildEvalRows}. */
export interface BuildEvalRowsOpts {
  /** Injected prod-baseline reader (the pinned `getPhotoScores(pool, pin)`). */
  getScores: ScoreReader;
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

/** Default frozen-baseline model pin (#1073). The 902-score Opus pass. */
export const DEFAULT_BASELINE_MODEL = 'claude-opus-4-8';
/** Default frozen-baseline rubric-version pin (#1073). */
export const DEFAULT_BASELINE_RUBRIC = '0.2.1';

/** The frozen-baseline pin `getPhotoScores` is queried with (#1073). */
export interface BaselinePin {
  model: string;
  rubricVersion: string;
}

/**
 * Resolve the frozen-baseline pin from the environment (#1073). `BASELINE_MODEL`
 * defaults to {@link DEFAULT_BASELINE_MODEL} and `BASELINE_RUBRIC` to
 * {@link DEFAULT_BASELINE_RUBRIC} — both overridable so a re-scored baseline
 * under a new `(model, rubric)` can be evaluated without a code change. Pure +
 * unit-tested; the eval entry passes the result straight to `getPhotoScores`.
 */
export function resolveBaselinePin(env: NodeJS.ProcessEnv): BaselinePin {
  return {
    model: env.BASELINE_MODEL || DEFAULT_BASELINE_MODEL,
    rubricVersion: env.BASELINE_RUBRIC || DEFAULT_BASELINE_RUBRIC,
  };
}

/** A `photo_current` metadata row keyed by species_code (LOCAL review store). */
interface CurrentRow {
  url: string | null;
  com_name: string;
  sci_name: string;
  family: string;
}

/**
 * Coerce a prod `criteria` JSONB value (already deserialized by pg into a
 * `Record<string, number> | null`) into `CriteriaScores`, or `undefined` when
 * it is NULL or does not carry all seven axes. Mirrors {@link parseCriteria}'s
 * skip-don't-fabricate posture: a missing/partial blob yields `undefined` (the
 * per-axis scorers skip that axis), never a phantom `{}` that would read as a
 * real all-zero score.
 */
export function criteriaFromRecord(criteria: Record<string, number> | null): CriteriaScores | undefined {
  if (criteria === null) return undefined;
  const out = {} as CriteriaScores;
  for (const key of CRITERIA_KEYS) {
    const v = criteria[key];
    if (typeof v !== 'number') return undefined;
    out[key] = v;
  }
  return out;
}

/**
 * Parse a baseline `criteria_json` STRING blob into `CriteriaScores`, or
 * `undefined` when the column is NULL/empty (an axis-skip on the expected side
 * — the per-axis scorers never fabricate agreement from a missing baseline).
 * Parse failures and shape mismatches also yield `undefined` rather than
 * throwing: a malformed legacy blob must skip its axes, not abort the whole
 * dataset. Retained as a pure helper (and re-used by {@link criteriaFromRecord}
 * via the same per-axis contract) for callers that still hold a JSON string.
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
  return criteriaFromRecord(parsed as Record<string, number>);
}

/**
 * Assert the single-rubric-version invariant (#1037 decision 1) over the FULL
 * fetched score set and return that version. With the prod read (#1073) the pin
 * `getPhotoScores(pool, {model, rubricVersion})` already filters to ONE
 * rubric_version, so this is trivially satisfied for a real run — it stays as a
 * cheap defensive guard (a mixed-version reader fixture, or an empty baseline,
 * fails loud here BEFORE image resolution and sampling, never depending on
 * which rows a seed happens to sample).
 */
function assertSingleRubricVersion(scoreRows: PhotoScoreRow[]): string {
  if (scoreRows.length === 0) {
    throw new Error(
      '[build-dataset] no scores returned for the baseline pin — there is no baseline rubric version to pin the judge prompt to (is BASELINE_MODEL/BASELINE_RUBRIC correct and has the C3 backfill run?)',
    );
  }
  const missing = scoreRows.filter((r) => r.rubricVersion === null || r.rubricVersion === '');
  if (missing.length > 0) {
    throw new Error(
      `[build-dataset] ${missing.length} of ${scoreRows.length} fetched rows have no rubric_version — unknown provenance cannot be judged under pinned criteria (e.g. ${missing[0]!.speciesCode})`,
    );
  }
  const counts = new Map<string, number>();
  for (const r of scoreRows) {
    counts.set(r.rubricVersion, (counts.get(r.rubricVersion) ?? 0) + 1);
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
 * Build stratified eval rows from the frozen Opus baseline in prod
 * `species_photo_scores` (#1073), hash-verified against the local cache.
 *
 * The SCORE comes from `opts.getScores` (the injected, pinned
 * `getPhotoScores(pool, {model, rubricVersion})`); the species METADATA
 * (`url`/`com_name`/`sci_name`/`family`) and the image BYTES come from the
 * LOCAL review store (`db.photo_current`) + `thumbDir`. The pin makes the
 * single-rubric-version invariant (#1037 decision 1) trivially hold, and the
 * det-gate rows (`model='deterministic-gate'`) simply do not match the Opus
 * model pin — so they never reach the dataset (#1037 decision 2).
 *
 * For each score row, in order, a row is SKIPPED (with a logged note) when:
 *   1. the species has no `photo_current` row locally (no metadata to build it);
 *   2. its image is absent from `thumbDir` (the existing absent-image skip); or
 *   3. **the local image's content hash ≠ the score row's `contentHash`** — the
 *      same-bytes guarantee (#1073): the judge must score the EXACT bytes the
 *      baseline scored, even though score and image now come from different
 *      stores, so a divergent local cache is dropped rather than mis-scored.
 *
 * `keep`/`qualityScore`/`criteria` come straight off the prod row. When
 * `opts.sample` is set, the surviving rows are split into keep=true / keep=false
 * strata, each shuffled by a seeded mulberry32 Fisher–Yates, and a proportional
 * allocation is taken from the front of each shuffled stratum (clamp remainder
 * pushed to the other stratum). Output is deterministic for a fixed `seed`.
 */
export async function buildEvalRows(
  db: Database.Database,
  opts: BuildEvalRowsOpts,
): Promise<EvalRow[]> {
  const { getScores, thumbDir, sample, seed = DEFAULT_SEED } = opts;

  const scoreRows = await getScores();
  const rubricVersion = assertSingleRubricVersion(scoreRows);

  const currentStmt = db.prepare(
    `SELECT url, com_name, sci_name, family FROM photo_current WHERE species_code = ?`,
  );

  const rows: EvalRow[] = [];
  for (const score of scoreRows) {
    const current = currentStmt.get(score.speciesCode) as CurrentRow | undefined;
    if (current === undefined) {
      console.warn(
        `[build-dataset] skipping ${score.speciesCode}: no photo_current row in the local review store`,
      );
      continue;
    }

    const file = resolveImage(thumbDir, score.speciesCode);
    if (file === null) {
      console.warn(
        `[build-dataset] skipping ${score.speciesCode}: no cached image in ${thumbDir}`,
      );
      continue;
    }

    // Same-bytes integrity (#1073): the score now comes from prod but the image
    // from the local cache. Hash the local bytes and require they match the
    // score row's content_hash — a mismatch means the cache diverged from what
    // the baseline scored, so skip it (logged) rather than let Gemini score
    // DIFFERENT bytes than Opus did. Mirrors the absent-image skip above.
    const readPath = join(thumbDir, file);
    const localHash = contentHash(readFileSync(readPath));
    if (localHash !== score.contentHash) {
      console.warn(
        `[build-dataset] skipping ${score.speciesCode}: local image hash ${localHash} ≠ baseline content_hash ${score.contentHash} (cache diverged from the scored bytes)`,
      );
      continue;
    }

    const criteria = criteriaFromRecord(score.criteria);
    rows.push({
      input: {
        readPath,
        // The stored R2 URL VERBATIM (#1067): extensions vary in the DB
        // (.jpg/.jpeg/.png) and a reconstructed `<code>.jpeg` template 404s for
        // hundreds of species, so we never template — we log the column as-is.
        imageUrl: current.url ?? '',
        speciesCode: score.speciesCode,
        comName: current.com_name,
        sciName: current.sci_name,
        family: current.family,
      },
      expected: {
        keep: score.keep,
        // The Opus baseline always carries a numeric quality_score; the only
        // null-score rows are the det-gate verdicts, which don't match the Opus
        // model pin and never reach here. Coalesce defensively to 0 so the type
        // stays `number` — a real run never exercises this branch.
        qualityScore: score.qualityScore ?? 0,
        // `undefined` (NOT `{}`) when the baseline has no criteria — the
        // per-axis scorers skip a missing axis rather than scoring a phantom 0.
        ...(criteria !== undefined ? { criteria } : {}),
      },
      metadata: { contentHash: score.contentHash, expectedRubricVersion: rubricVersion },
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
