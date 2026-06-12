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

Every per-judgment span nests **under the experiment trace** (not the project
Logs stream), so the dataset rows and their spans are linked in the Braintrust
UI. (See the run-row wiring in `src/eval/run-row.ts` and the tracing seam in
`src/judges/traced.ts`.)

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
| `GEMINI_PACE_MS` | no (default `12000`) | min ms between Gemini calls (12 s ⇒ ≤ 5 RPM, the measured free-tier cap); adjust only when a paid tier raises the per-minute quota |

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
   scorers received both `output` and `expected`.
3. Opening a row shows the per-judgment span **nested under the experiment**
   (not floating in the project Logs stream) with the species input, the Gemini
   output, and `metrics.latency` populated.

Note the experiment URL in the PR as the manual smoke evidence.
