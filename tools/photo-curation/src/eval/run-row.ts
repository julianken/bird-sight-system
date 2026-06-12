// ─────────────────────────────────────────────────────────────────────────────
// Row → judge wiring for the Braintrust eval (C5, #1015; part of #1010).
//
// `photo-judge.eval.ts` is run by `bt eval`, whose `task(input, hooks)` gets
// each dataset row's `input` as the FIRST positional argument. This module is
// the pure, dependency-injected mapping from that row to a `JudgeOutput`:
//
//   EvalRow.input ──(readImage)──▶ ImageInput ─┐
//                                              ├─▶ judge.judge(img, ctx, prompt)
//   EvalRow.input ───────────────▶ SpeciesContext ─┘
//
// Everything is injected (`judge`, `readImage`, `prompt`) so the only CI-visible
// safety net for the eval wiring — the tool's `tsc` is excluded from CI — is the
// vitest in run-row.test.ts (a FakeJudge + a fake readImage; no network, no fs).
// ─────────────────────────────────────────────────────────────────────────────

import type { ImageInput, JudgeOutput, SpeciesContext, VisionJudge } from '@bird-watch/photo-quality';

/**
 * One dataset row's `input` (mirrors `EvalRow.input` from build-dataset.ts).
 * Re-declared here rather than imported so this module stays decoupled from the
 * dataset builder's internals — only the field names are the contract.
 *
 * The image identity is split (#1067): `readPath` is the LOCAL cache path the
 * bytes come from, `imageUrl` is the portable production R2 URL logged as the
 * span's `sourceUrl`. They differ (cache ext vs. stored ext), so they must
 * stay distinct.
 */
export interface RunRowInput {
  /** LOCAL cached-thumbnail path the judge reads bytes from (not logged as a URL). */
  readPath: string;
  /** Production R2 URL — logged as the span's portable `sourceUrl`. */
  imageUrl: string;
  speciesCode: string;
  comName: string;
  sciName: string;
  family: string;
}

/** The injected collaborators a `runRow` call needs. */
export interface RunRowDeps {
  /** The (instrumented) judge to score the image with. */
  judge: VisionJudge;
  /** Reads a LOCAL image path into an `ImageInput` (buffer + mime). */
  readImage: (readPath: string) => ImageInput;
  /** The rubric prompt handed to the judge (e.g. `defaultRubricConfig.judgePrompt`). */
  prompt: string;
}

/**
 * Map one eval row to a judge call. Reads the row's image bytes from the LOCAL
 * `readPath` via `deps.readImage`, builds the `SpeciesContext` from the row's
 * species fields, and asks `deps.judge` to score it with `deps.prompt`.
 *
 * The `ImageInput.sourceUrl` handed to the judge is the row's portable R2
 * `imageUrl` — NOT the local read path (#1067) — so the Braintrust span renders
 * the real bird-maps.com thumbnail and the experiment is portable. We override
 * whatever `sourceUrl` `readImage` may have set (it sees only the local path).
 * Returns the judge's `JudgeOutput` unchanged — the Braintrust scorers compare
 * it against the row's `expected` (the Opus proxy ground truth).
 */
export async function runRow(deps: RunRowDeps, input: RunRowInput): Promise<JudgeOutput> {
  const read: ImageInput = deps.readImage(input.readPath);
  const img: ImageInput = { ...read, sourceUrl: input.imageUrl };
  const ctx: SpeciesContext = {
    speciesCode: input.speciesCode,
    comName: input.comName,
    sciName: input.sciName,
    family: input.family,
  };
  return deps.judge.judge(img, ctx, deps.prompt);
}
