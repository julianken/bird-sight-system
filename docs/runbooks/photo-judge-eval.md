# Photo-judge eval — Gemini vs. the Opus baseline (`bt eval`)

## What this measures

The eval (`tools/photo-curation/eval/photo-judge.eval.ts`) runs the **traced
Gemini 2.5 Flash judge** over the cached current-photo thumbnails and scores its
agreement with the existing **Opus 902-score baseline** (the proxy ground truth
in `review.sqlite`). It reports three metrics as a Braintrust **experiment** in
the `bird-maps` project:

| Scorer | What it measures | Read it as |
|---|---|---|
| `keep_agreement` | exact boolean match of `keep` (the #969 gate) | **the headline** — must be **≥ 90%** to adopt Gemini for bulk scoring |
| `score_mae` | `1 − \|Δ qualityScore\| / 100`, clamped to `[0,1]` | how close Gemini's 0–100 estimate tracks Opus's (advisory) |
| `keep_confusion` | splits disagreements into `falseKeep` / `falseReplace` | watch **`falseKeep`** — Gemini keeping a photo Opus would replace ships a bad photo (the dangerous direction); `falseReplace` is cheap (re-source) |
| `criteria_mae_<axis>` (×7) | per-axis sub-score agreement: `1 − \|Δ axis\| / 10`, clamped `[0,1]`, one column for each of `framing`, `subjectClarity`, `liveness`, `naturalness`, `pose`, `background`, `lighting` (#1067) | **diagnostic, not a gate** — a low column (e.g. `criteria_mae_naturalness`) means Gemini is *systematically* off on that axis, which is exactly what would route a hybrid design. A row missing a baseline axis null-skips that column only (dropped from the mean, never scored as 0) |

The 7 `criteria_mae_<axis>` columns come from `expected.criteria` (the Opus
`photo_score.criteria_json` carried onto each dataset row). A baseline row with
no `criteria_json` simply skips those columns for that row — it never fabricates
agreement. Deterministic-gate rows (zeroed criteria) are already excluded from
the dataset, so their synthetic 0s can't reach these columns.

Every per-judgment span nests **under the experiment trace** (not the project
Logs stream), so the dataset rows and their spans are linked in the Braintrust
UI. (See the run-row wiring in `src/eval/run-row.ts` and the tracing seam in
`src/judges/traced.ts`.) **The span's `sourceUrl` is the production R2 URL**
(`photo_current.url`, stored verbatim — `.jpg`/`.jpeg`/`.png` extensions vary,
so it is logged as-is, never reconstructed from a `<code>.jpeg` template that
would 404), so Braintrust renders the **live bird-maps.com thumbnail** and the
experiment is portable across machines. The local cache path is used only to
read the bytes; it is never logged as a URL. The exact image bytes are pinned
by `content_hash` in span metadata. Each span's `metrics` carry the judgment
`latency` (seconds) **and the Gemini token counts** (`prompt_tokens`,
`completion_tokens` — thinking tokens included — and `total_tokens`, from the
response's `usageMetadata`), so per-row and aggregate cost are readable
directly in the experiment dashboard.

## Comparability: the rubric pin and the det-gate exclusion (#1037)

**The rubric version is part of the dataset, not the live code.** Every
baseline row in `review.sqlite` records the `rubric_version` it was scored
under (`0.2.1` for the 902-score Opus pass). The eval **pins the judge prompt
to that recorded version**: the dataset builder asserts that every fetched row
carries one single, known version (a mixed or missing version is a **hard
fail at dataset-build time** — re-score the baseline rather than judging under
different criteria), and the eval selects the matching prompt from the
version-keyed snapshots in `eval/rubric-prompts.ts`. Judging a v0.2.1 baseline
with the live v0.2.2 prompt would turn the v0.2.2 criteria changes
(same-species multiples OK, mild adult preference — commit 974d8c5) into
phantom "disagreement". When the baseline is someday re-scored under v0.2.2+,
the pin follows automatically (the live config's version maps to the live
prompt).

Provenance is logged on both sides so a future mismatch is visible instead of
silent: every dataset row carries `metadata.expectedRubricVersion` (from the
DB) and every judgment span's input carries `judgedRubricVersion` (what the
judge actually ran) — equal by construction under the pin. The experiment
metadata records the pinned `rubricVersion` and the judge `model`.

**Deterministic-gate rows are excluded from the dataset.** 13 of the 902
baseline rows are sharpness-heuristic verdicts
(`rationale LIKE 'deterministic gate%'`, `keep = 0`, `quality_score = 0`) —
gate output, not Opus findings — so the judge is never graded against them
(they also dragged `score_mae` via the synthetic 0).

> **Comparing to pre-pin experiments** (e.g. `HEAD-1781238943`): excluding the
> 13 all-`keep=0` det-gate rows shifts the stratum balance (536 → 523
> replace-side) and therefore the deterministic stratified sample. A pinned
> re-run is **criteria-comparable but not row-identical** to those earlier
> experiments — compare scorer means, not row-by-row.

## Prerequisites

This eval reads local data and calls the live Gemini API — it is **operator-run
from the photo-curation run-worktree**, not from CI:

- **`review.sqlite`** with `role='current'` Opus scores (the 902-score baseline).
- **`thumb-cache/<species_code>.{jpg,png,webp}`** — the cached current
  thumbnails the Opus pass scored. No re-download.
- A Gemini API key and a Braintrust API key. Free tier covers only a smoke run
  (20 requests/day — see the daily-cap section); a full 150-row run needs the
  paid-tier path.
- `npm install` at the repo root, and the full workspace dep chain built once.
  `@bird-watch/photo-curation` depends on `@bird-watch/ingestor` (and
  `@bird-watch/photo-quality` / `@bird-watch/shared-types`), and `ingestor`
  pulls in `@bird-watch/db-client` — so building only
  `@bird-watch/photo-quality` leaves the eval's `import`s unresolved. Run the
  root `npm run build` (it builds the chain in order:
  shared-types → db-client → photo-quality → ingestor → …), or build that
  prefix explicitly. (`@bird-watch/geo`, also a transitive dep, is source-only
  with no build step.) `bt eval` then runs the TypeScript entry directly via the
  auto-detected `tsx` runner — no separate build of the eval file is needed.

## Environment variables

| Var | Required | Purpose |
|---|---|---|
| `GEMINI_API_KEY` | yes | authenticates the Gemini `generateContent` calls |
| `BRAINTRUST_API_KEY` | yes | authenticates span/experiment writes; **absence fails loud** — we never score un-traced |
| `REVIEW_DB` | yes | path to `review.sqlite` (e.g. `./review.sqlite`) |
| `THUMB_DIR` | yes | path to the thumbnail cache (e.g. `./thumb-cache`) |
| `EVAL_SAMPLE` | no (default `150`) | stratified keep/replace sample size for a full run |
| `EVAL_MODEL` | no (default `gemini-2.5-flash`) | the judge model to construct; recorded in the experiment metadata and on every span. Same dataset + same pinned rubric + a different `EVAL_MODEL` = directly comparable experiments — "grade the models against the original findings" is a one-env-var operation |
| `GEMINI_PACE_MS` | no (default `12000`) | min ms between Gemini calls (12 s ⇒ ≤ 5 RPM, the measured free-tier cap); adjust only when a paid tier raises the per-minute quota. An explicit `0` disables pacing; an unparseable value fails loud at startup |

Put the non-secret values plus `GEMINI_API_KEY` in a local `.env.local`
(gitignored). `bt eval --env-file .env.local` loads them into the eval process:

```sh
# tools/photo-curation/.env.local  (NOT committed)
GEMINI_API_KEY=AIza…
REVIEW_DB=./review.sqlite
THUMB_DIR=./thumb-cache
EVAL_SAMPLE=150
```

**Braintrust auth resolves from the active `bt` profile** (`bt auth login` /
`bt auth status`) — you do not have to pass `BRAINTRUST_API_KEY` if a profile is
logged in. If you prefer the env var, add it to `.env.local` too; either path
satisfies the fail-loud check.

## Run it

From `tools/photo-curation/`:

```sh
# 1. Smoke — first 5 rows, summary clearly labeled NON-FINAL.
bt eval --first 5 --env-file .env.local eval/photo-judge.eval.ts

# 2. Full first run — the stratified EVAL_SAMPLE rows (default 150), FINAL.
bt eval --env-file .env.local eval/photo-judge.eval.ts
```

The package also exposes `npm run eval -w @bird-watch/photo-curation`
(`bt eval eval/photo-judge.eval.ts`); pass flags after `--`, e.g.
`npm run eval -w @bird-watch/photo-curation -- --first 5 --env-file .env.local`.

> **Pacing.** The eval runs **serially** (`maxConcurrency: 1`) over **one
> shared** traced judge, so that judge's single `Pacer` gates the whole run to
> ≈ 12 s/call (`GEMINI_PACE_MS`, default `12000` ⇒ ≤ 5 RPM — the free-tier
> per-minute cap measured 2026-06-11, #1036) — a 150-row run is on the order of
> 30 minutes of wall clock *if the daily quota allows it* (it does not on free
> tier; see below). That serial single-judge wiring is what keeps the run inside
> the per-minute cap (per-row judges would each reset the pacer; unbounded
> concurrency would race it). That is expected — do not parallelize around the
> pacer or construct a judge per row. On a minute-cap `429` the retry honors the
> server's `RetryInfo.retryDelay` hint (13–38 s observed) rather than only the
> jittered backoff.

### Reading the result

- `bt eval` prints a summary table with each scorer's mean; the `--first 5`
  run is labeled a non-final smoke, the full run is labeled final.
- The experiment appears in Braintrust under the **`bird-maps`** project →
  **Experiments**. Open it to compare `keep_agreement` against the Opus baseline
  and to drill into individual judgments (each row's span, input image ref,
  Gemini output, and the three scores).
- **Decision gate:** Gemini is adopted for bulk scoring iff
  `keep_agreement ≥ 90%` **and** `falseKeep` is low. Below the gate → hybrid
  (Gemini first pass, Opus re-judges the close calls) — see the design spec.

## Dataset-level diagnostics: `analyze-experiment` (#1067)

The boolean gate hides the *shape* of the disagreement. Braintrust scorers are
strictly per-row, so the threshold-free and calibrated reads — which need every
row at once — live in a committed, **read-only** analysis script instead of in
the scorers. It reads a completed experiment back (no eval run, no Gemini calls,
no judging):

```sh
# Braintrust auth resolves from the active `bt` profile (bt auth login).
npm run analyze -w @bird-watch/photo-curation <experiment-name-or-id>

# optional: tune the ambiguity / hybrid-routing band (default 40:70, Opus score)
npm run analyze -w @bird-watch/photo-curation <experiment> -- --band 45:65
```

It prints:

| Line | What it means | How to read it |
|---|---|---|
| `keep agreement` | the same boolean match rate as the `keep_agreement` scorer | sanity-check it equals the experiment's headline |
| `falseKeep` / `falseReplace` | the confusion split, as raw counts | `falseKeep` is the dangerous direction |
| `score MAE` | mean `\|Δ qualityScore\|` in points | lower = Gemini's 0–100 tracks Opus's |
| **`AUC`** | Gemini `qualityScore` as a ranker of the Opus `keep` label (Mann–Whitney, ties = 0.5) | **threshold-free** separability. High AUC + low keep-agreement (the pinned run: AUC 0.904 vs. 78.67%) means the boolean *threshold* is miscalibrated, not that the model can't tell good from bad |
| **`calibrated ceiling`** | the best boolean agreement any single recalibrated `qualityScore` threshold could reach, plus the winning `score >= t` | the ceiling for a Gemini-*only* gate. On the pinned run this was **84% at t=59** — still under the 90% gate, so even a perfectly-tuned threshold doesn't adopt solo Gemini |
| `ambiguity band [lo, hi]` | how many disagreements sit inside that Opus-score band | a disagreement near Opus's own midpoint is a genuine close call |
| **`hybrid routing preview`** | route Gemini scores in the mid-band to Opus → **% routed** (the Opus-call budget), **auto-set agreement** (keep-agreement after routing), **residual falseKeep** (dangerous keeps that fell outside the band and were never re-judged) | quantifies whether a Gemini-first / Opus-on-close-calls hybrid clears the gate, and at what Opus cost. This is the input to the hybrid-design decision — not the hybrid itself |

The AUC / calibrated-ceiling / band / routing math are pure helpers, unit-tested
on a hand-built fixture (`scripts/analyze-experiment.test.ts`); the Braintrust
read is `bt sql` under the hood and is injected, so the tests need no network.

## Daily cap (20 RPD free tier) — abort + resume

Gemini's free tier caps `gemini-2.5-flash` at **20 requests per day** (measured
2026-06-11, #1036: `GenerateRequestsPerDayPerProjectPerModel-FreeTier`,
`quotaValue: "20"`). The per-minute pacing keeps you under the 5 RPM limit, but
**a 150-row run does NOT fit in a free-tier day** — at 20 RPD even a re-ask-free
run covers at most 20 rows before the cap trips.

- On a minute-cap `429` the judge retries, sleeping at least the server's
  `RetryInfo.retryDelay`. On a **daily-cap** `429` the run **aborts fast**: the
  judge throws `GeminiDailyQuotaError` (the message names the tripped
  `quotaId`) on the first trip and latches — every subsequent row fails with
  the same error and **zero further network**, so the run no longer burns the
  next day's quota on pointless retries. Stop the run when you see it.
- **Paid tier (the realistic path for a full 150-row run):** enable billing on
  the Gemini API project
  ([ai.google.dev/gemini-api/docs/billing](https://ai.google.dev/gemini-api/docs/billing)),
  then in the GCP console **lower the per-model per-day quota** to a
  self-imposed ceiling as a hard spend cap, and set `GEMINI_PACE_MS` to match
  whatever per-minute quota the paid tier grants (e.g. a 60 RPM tier tolerates
  `GEMINI_PACE_MS=1100`). The judge's quota handling is tier-agnostic — the
  same parse/latch logic protects against whatever caps are configured.
- **Resume strategy:** there is no checkpoint file. Re-run with a **smaller
  `EVAL_SAMPLE`** (or `--first N`) the same day, or wait for the quota to reset
  (~midnight Pacific) and re-run the full sample. The dataset builder's sample
  is **deterministic for a fixed seed**, so a re-run scores the same rows — use
  a smaller `--first` to make incremental progress, or accept that the full run
  is a fresh experiment once the quota resets.
- Partial spans already written to Braintrust are preserved; a resumed run
  creates a new experiment rather than appending to the interrupted one.

## Smoke-verify checklist (first live run)

After the `--first 5` smoke, confirm in the Braintrust `bird-maps` project:

1. A new **experiment** (not just Logs) was created.
2. `keep_agreement` is **non-null** (a real number, not blank) — proves the
   scorers received both `output` and `expected`. The 7 `criteria_mae_<axis>`
   columns are present and non-null on rows whose baseline carried
   `criteria_json` (#1067).
3. Opening a row shows the per-judgment span **nested under the experiment**
   (not floating in the project Logs stream) with the species input, the Gemini
   output, and `metrics.latency` populated. The span's `sourceUrl` is the
   **bird-maps.com R2 URL** and the thumbnail **renders** in Braintrust — not a
   local filesystem path (#1067).
4. The row's `metadata.expectedRubricVersion` equals the span input's
   `judgedRubricVersion` (the #1037 pin holding), `metadata.contentHash` is
   present (#1067), and the span's `prompt_tokens` / `completion_tokens` /
   `total_tokens` metrics are populated.

After a completed run, also exercise the dataset-level read:
`npm run analyze -w @bird-watch/photo-curation <experiment>` prints the AUC,
calibrated ceiling, and hybrid-routing preview (see the diagnostics section
above).

Note the experiment URL in the PR as the manual smoke evidence.
