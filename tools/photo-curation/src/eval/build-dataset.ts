import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import type Database from 'better-sqlite3';

/**
 * One Braintrust eval row built from the Opus current-scores in review.sqlite.
 * `expected` is the Opus keep/score, used as proxy ground truth (#1010/#1013):
 * a later run compares a cheaper judge's output against it. `imagePath` points
 * at the cached current thumbnail; `metadata.contentHash` ties the row back to
 * the exact image bytes the Opus pass scored.
 */
export interface EvalRow {
  input: {
    imagePath: string;
    speciesCode: string;
    comName: string;
    sciName: string;
    family: string;
  };
  expected: {
    keep: boolean;
    qualityScore: number;
  };
  metadata: {
    contentHash: string;
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
  com_name: string;
  sci_name: string;
  family: string;
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
 * Returns the first matching filename, or `null` when nothing matches.
 */
function resolveImage(thumbDir: string, speciesCode: string): string | null {
  let entries: string[];
  try {
    entries = readdirSync(thumbDir);
  } catch {
    return null;
  }
  const prefix = `${speciesCode}.`;
  const match = entries.find((name) => name.startsWith(prefix));
  return match ?? null;
}

/**
 * Build stratified eval rows from the role='current' Opus scores in `db`.
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

  const joinRows = db
    .prepare(
      `SELECT s.species_code, s.keep, s.quality_score, s.overall, s.content_hash,
              c.com_name, c.sci_name, c.family
         FROM photo_score s JOIN photo_current c USING(species_code)
        WHERE s.role = 'current'`,
    )
    .all() as ScoreJoinRow[];

  const rows: EvalRow[] = [];
  for (const row of joinRows) {
    const file = resolveImage(thumbDir, row.species_code);
    if (file === null) {
      console.warn(
        `[build-dataset] skipping ${row.species_code}: no cached image in ${thumbDir}`,
      );
      continue;
    }
    rows.push({
      input: {
        imagePath: join(thumbDir, file),
        speciesCode: row.species_code,
        comName: row.com_name,
        sciName: row.sci_name,
        family: row.family,
      },
      expected: {
        keep: row.keep === null ? true : row.keep === 1,
        qualityScore: row.quality_score ?? row.overall,
      },
      metadata: { contentHash: row.content_hash },
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
