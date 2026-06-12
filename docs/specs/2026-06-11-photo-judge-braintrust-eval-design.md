# Photo-judge Braintrust eval + Gemini backend — design

**Date:** 2026-06-11
**Status:** Draft (brainstorm output; pre-plan)
**Related:** photo-quality curation epic #974; calibration issue #969; ledger #996.
**Parked sibling:** placeholder / override-wiring / lock-in feature (separate spec, not this one).

## Problem

Photo scoring on bird-maps is done by an **Opus** field-mark judge (a Claude Code
Workflow). It is accurate but costs ~**$0.30–0.34/photo** (~$36 per 30-species
candidate tranche; ~$290 for a full ~900 re-score). Two unmet needs:

1. **Cost.** We want a cheaper backend for the bulk of scoring — Google **Gemini
   2.5 Flash** on the free tier ($0) is the candidate — *if* it judges
   "nature-guide quality" well enough.
2. **Measurement.** We currently have no harness to prove a cheaper judge is good
   enough. Model choice materially changes verdicts (Haiku capped at 82.5% on
   this rubric). We need **every judgment traced and every model comparison
   measured in Braintrust** before trusting a swap. This is the crucial part:
   *nothing scores un-traced.*

## Goals

- A second `VisionJudge` backend, **`GeminiVisionJudge`** (gemini-2.5-flash, free
  tier), behind the existing interface — same rubric, same structured output.
- **Mandatory Braintrust tracing**: a wrapper such that any scoring run (Gemini
  *or* Opus, eval *or* production) logs one span per judgment to the hosted
  `bird-maps` Braintrust project. No code path scores without it.
- A **Braintrust eval** (`bt eval`) that scores Gemini's agreement with the
  existing Opus 902-score baseline (proxy ground truth) and reports the headline
  **keep-agreement %** — the #969 calibration gate (≥90%).
- **Terraform** provisions the two API-key secrets in GCP Secret Manager now,
  staging the durable path; compute stays local for the first measurement.

## Non-goals (YAGNI)

- **No Cloud Run job / scheduler yet** — deferred until Gemini clears the gate.
- **No change to the pure `@bird-watch/photo-quality` core** (rubric, gate,
  `composeOverall`, `scoreImage`, `VisionJudge` interface stay as-is). The pure
  package must remain SDK-free (the epic deliberately removed `ClaudeVisionJudge`);
  the Gemini implementation therefore lives in the consumer, not the core.
- **No fresh human labeling** for the first run — Opus 902 scores are the proxy
  `expected`. (A real human-labeled set is a later, stronger calibration.)
- **No work on** the placeholder/override/lock-in feature (parked).

## Ground truth (this run)

Proxy = the existing **902 current-photo Opus scores** in the local
`review.sqlite` (role='current': `keep` boolean + `qualityScore` 0–100). The
corresponding images are already cached at `thumb-cache/<species_code>.jpg` in the
run-worktree — no re-download. A real human-labeled sample supersedes this proxy
in a future iteration; the eval harness is identical either way (only the dataset
`expected` source changes).

## Components

### 1. `GeminiVisionJudge` (new) — implements `VisionJudge`

- **Home:** `tools/photo-curation/src/judges/gemini.ts` (consumer side, NOT the
  pure package — keeps `@bird-watch/photo-quality` SDK-free).
- **Input:** an image (path → inline base64) + species meta + the rubric
  `judgePrompt` (`defaultRubricConfig.judgePrompt`, unchanged).
- **Call:** Gemini `generateContent`, model `gemini-2.5-flash`, with a
  `responseSchema` (structured output) matching the judge result shape:
  `{ fieldMarks[], criteria{framing,subjectClarity,liveness,naturalness,pose,background,lighting}, flags[], keep, qualityScore, rationale }`.
- **Output:** the SAME structured object the Opus judge returns, so it is a true
  drop-in for the `VisionJudge` seam.
- **Pacing/resilience:** Clock-injected pacing (~6 s/call ⇒ ≤10 RPM) + jittered
  429/backoff, mirroring the tool's existing external-call idiom; abort-one not
  the-batch. Free-tier RPD cap is handled by resuming or sampling, not by
  removing pacing.
- **Auth:** `GEMINI_API_KEY` from env. SDK: `@google/genai` — **pull fresh
  context7 docs before coding** (responseSchema + inline image API churn).

### 2. Braintrust tracing wrapper (new) — the load-bearing piece

- **Home:** `tools/photo-curation/src/judges/traced.ts`.
- **Shape:** `tracedJudge(inner: VisionJudge, opts): VisionJudge` — wraps any
  judge; each `score()` opens a Braintrust span via the `braintrust` SDK
  (`initLogger`/`traced`) logging:
  - **input:** image ref, species_code/com/sci/family, rubric version, judge model.
  - **output:** the full report (keep, qualityScore, criteria, flags, fieldMarks, rationale).
  - **metadata:** token usage, latency_ms, estimated cost (Gemini free = $0; Opus
    from the existing PRICE_TABLE).
- **Hard rule:** the eval and every future scoring run obtain their judge through
  `tracedJudge`. There is no un-traced scoring path. (A `BRAINTRUST_API_KEY`
  absence fails loud, not silent — we never score blind.)
- **Project:** logs to the existing hosted `bird-maps` project.

### 3. Eval dataset builder (new)

- **Home:** `tools/photo-curation/src/eval/build-dataset.ts` (+ CLI subcommand or
  script).
- **Reads:** `review.sqlite` role='current' scores + `thumb-cache/<code>.jpg`.
- **Emits:** a Braintrust dataset — `input = {imagePath, speciesCode, comName,
  sciName, family}`, `expected = {keep, qualityScore}` (Opus). **Stratified**
  across keep=1 / keep=0 (and lightly across families) so agreement isn't skewed
  by the ~60/40 needs-swap split.
- **Default sample:** start with a **smoke (`--first 5`)**, then a **~150-row
  stratified** first real run; full 902 is opt-in (spans ~1–4 free-tier days).

### 4. `photo-judge.eval.ts` (new) — the Braintrust eval

- **Home:** `tools/photo-curation/eval/photo-judge.eval.ts`, run via `bt eval`.
- **Task:** for each dataset row, run `tracedJudge(GeminiVisionJudge)` over the
  image; return the report.
- **Scorers (pure, unit-tested):**
  - `keepAgreement` — exact boolean match of `keep` (headline %; the #969 gate).
  - `scoreMAE` — `|gemini.qualityScore − opus.qualityScore|` (normalized).
  - `keepConfusion` — splits disagreements into **false-keep** (Gemini keeps what
    Opus would replace — the dangerous direction) vs **false-replace**.
- **Output:** a Braintrust **experiment** in `bird-maps`, comparable against the
  Opus baseline on agreement + $/photo.

### 5. Terraform — secrets only (now)

- **Home:** `infra/terraform/photo-judge-secrets.tf`.
- `google_secret_manager_secret` (+ initial version placeholder; real values set
  out-of-band, never committed) for `GEMINI_API_KEY` and `BRAINTRUST_API_KEY`,
  with IAM read-bindings staged for the future scoring service account.
- **Explicitly no compute** this iteration. The local eval reads the keys from
  `.env.local` / CI secrets; the Secret Manager entries stage the Cloud-Run-later
  path so the IaC is ready when Gemini clears the gate.

## Data flow

```
thumb-cache/<code>.jpg  ─┐
review.sqlite (Opus)    ─┴─▶ build-dataset ─▶ Braintrust dataset (bird-maps)
                                                     │
                              bt eval: tracedJudge(GeminiVisionJudge) per row
                                                     │
                            spans + experiment in bird-maps  ─▶ scorers
                                                     │
                       keep-agreement % vs Opus baseline + $/photo (dashboard)
```

## Decision criterion

- **Gemini 2.5 Flash adopted for bulk scoring** iff keep-agreement ≥ **90%** AND
  false-keep rate is low (we tolerate false-replace — re-sourcing is cheap — far
  less than false-keep, which ships a bad photo).
- **Below the gate → hybrid:** Gemini does a cheap first pass; Opus re-judges only
  the close calls / final keepers. (Hybrid thresholds are a follow-up once we see
  the confusion split — not specified here.)

## Error handling

- Missing `GEMINI_API_KEY` / `BRAINTRUST_API_KEY` → fail loud at startup.
- Gemini 429 (RPM) → paced retry with jittered backoff; (RPD cap) → surface a
  clear "free-tier daily cap hit, resume tomorrow or reduce --sample" message,
  partial results preserved.
- Malformed Gemini structured output → one re-ask, then mark the row errored
  (drops to null in the eval, logged), never a silent wrong score.
- Braintrust unreachable → fail the run (do NOT fall back to un-traced scoring —
  that violates the core requirement).

## Testing

- `GeminiVisionJudge`: unit test with injected fetch returning a canned Gemini
  response → asserts mapping to the report shape; fake Clock for pacing; 429 retry
  path; malformed-output re-ask path. No real network.
- `tracedJudge`: unit test that it calls the inner judge and emits a span
  (Braintrust SDK in test/no-network mode or injected logger); asserts the
  un-traced path is unreachable (no judge constructed without the wrapper).
- `build-dataset`: fixture sqlite + temp images → asserts row shape +
  stratification + that missing images are skipped with a logged note.
- Scorers: pure unit tests (`keepAgreement`, `scoreMAE`, `keepConfusion`).
- The eval file itself: `bt eval --first 5` smoke in CI (marked non-final).

## Open items to resolve in the plan

- `@google/genai` exact `responseSchema` + inline-image call shape (context7).
- `bt eval` runner choice (tsx vs vite-node) for the Braintrust + TS eval file.
- Whether the dataset builder writes via the Braintrust SDK directly or `bt`
  dataset import — pick one in the plan.
