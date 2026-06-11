# Photo-curation scoring runbook

## Purpose

Score the live detail-panel photos on bird-maps.com against the
`@bird-watch/photo-quality` rubric so an operator can spot weak photos and
queue better alternates. The vision judge is a **Claude Code agent** that
`Read`s each downloaded image — there is **no `@anthropic-ai/sdk` and no
`ANTHROPIC_API_KEY`**. Scoring is therefore orchestrator-driven: the runnable
Node halves do all filesystem + SQLite work, and a Claude Code **Workflow-tool
script** dispatches the agents between them (issue #992, epic #974).

## The judge and the gate (#969 calibration)

The judge is **Opus**, applies a **field-mark-aware** prompt, and its **DIRECT
keep/replace decision is the gate**. A five-experiment, 80-photo calibration
against an Opus "premium field-guide editor" oracle settled this (record:
`docs/analyses/2026-06-10-photo-scorer-calibration/report.md`): the cheap Haiku
gate was too weak (it rated an insect 86/100 as a "Bank Swallow") and
decomposition didn't rescue it; Sonnet's holistic verdict was mis-calibrated; the
field-mark framing — name the species' diagnostic marks FIRST, then decide —
recovered the species-aware reasoning, and Opus is the chosen ceiling.

Three things shape each per-photo score; all are already wired into the Workflow
scripts and `score-prepare` — nothing extra to run:

- **`keep` is the gate, not a threshold.** The judge returns a boolean `keep`
  (keep this as the species' guide photo, or replace it). Downstream
  "needs replacement" = **`keep === false`**, NOT `overall < threshold`. The
  rubric's seven criteria, the composite `overall`/`verdict`, the disqualifier
  caps, and the `thresholds` are now **advisory** — kept only for review-UI
  ranking/badges. The judge also returns `fieldMarks` (the diagnostic marks it
  named) and its own `qualityScore` (0–100), both surfaced in the review UI.
- **Sourcing keys on the gate, not the composite (PR #1004).**
  `source-candidates` sources iNat alternates for exactly the species the gate
  flagged — current **`keep = 0`** — the SAME predicate the review server's
  `needs-swap` filter (`tools/photo-curation/src/server/queries.ts`) surfaces.
  This was previously `overall < review`, which was incoherent: a sharp photo
  with hidden field marks (HIGH composite, `keep = 0`) showed up in the
  reviewer's needs-swap queue but never got candidates sourced, leaving an empty
  pool. A `keep = 1` photo is never re-sourced; a legacy/unscored NULL `keep` is
  treated as kept and skipped — matching `needs-swap` exactly.
- **Lean `photo-judge` subagent on the `opus` tier.** The per-photo judge
  dispatches as the `.claude/agents/photo-judge.md` project subagent
  (`tools: Read` only, a short judge-role system prompt) instead of the generic
  Workflow agent (full default system prompt + entire tool registry). The model
  defaults to the **`opus`** alias (not a hardcoded id — see the `claude-api`
  model-alias rule) and is overridable via `PHOTO_JUDGE_MODEL`. The rubric is
  **not** baked into the agent — it arrives in the per-call prompt as
  `defaultRubricConfig.judgePrompt`, single-sourced in
  `packages/photo-quality/src/rubric.config.ts`, so there is no rubric copy to
  drift.

  ```bash
  PHOTO_JUDGE_MODEL=sonnet   # override the Opus default (e.g. a cheap re-score pass)
  ```

- **Deterministic pre-filter (free rejects) — STAYS.** `score-prepare` already
  has the downloaded bytes, so it runs `assessDeterministic(img,
  config.deterministic)` there, **before any vision call**. A gate failure (too
  small / too blurry / wrong aspect) is **auto-rejected with zero agent calls** —
  a `keep: false` reject report is persisted the same way `score-commit` writes
  (`upsertScore` role='current' + `markReviewed`), and the species is **excluded
  from the manifest** the judge agents read, so a junk image never reaches the
  (paid) Opus judge. The prepare log reports
  `judged N / gate-rejected M / already-scored skipped K`.

This split exists because the judge can only run inside Claude Code (not plain
Node), while the SQLite store + photo download can only run in plain Node (not
the Workflow sandbox). A single hybrid `.mjs` that imports `better-sqlite3`
**and** calls `agent()` runs in neither environment — that was the original
bug.

## Prerequisites

```bash
npm install && npm run build            # builds @bird-watch/photo-curation → dist/
cd tools/photo-curation
# Optional overrides:
export READ_API_BASE="https://api.bird-maps.com"   # default; the prod read-api
export THUMB_DIR="./thumb-cache"                    # default; downloaded images
```

The review store is `./review.sqlite` (gitignored, WAL). All commands below run
from `tools/photo-curation/`.

## Step 1 — sync (cheap, NO tokens)

Snapshot the live detail-panel photos into `photo_current` with `reviewed=0`.
The no-`--species` path calls `GET /api/species/with-photos` **once** — the
read-api endpoint that returns the ~715 observed-with-photos species in a
single response — and upserts them all. It does **not** walk the full 17.8k-code
taxonomy with a per-species detail call (the #992 fix).

```bash
npx photo-curate sync                 # all observed-with-photos species (~715)
npx photo-curate sync --species amerob  # one species via /api/species/:code
```

Re-running `sync` after new photos land re-surfaces the changed rows as
`reviewed=0` — this is the "scan for new photos" mechanism. It writes no score
rows; scoring is the separate token-spending pass below.

## Step 2 — score the backlog

Scoring runs in **batches of 10** (`--limit`, clamped to `[1,100]`) and is
**resumable**: each committed species is marked `reviewed=1` and drops out of
the next batch, so you re-run until the backlog clears.

**Canonical flow (orchestrator-driven).** The validated run path is three
orchestrator steps: **(1)** run the CLI `score-prepare` to select + download the
batch and emit the manifest; **(2)** dispatch the score Workflow with the rubric
prompt + that manifest, so its agents `Read` each manifest image and apply the
rubric via the `photo-judge` agent; **(3)** run the CLI `score-commit` to persist
the results. This is the flow Option A drives end-to-end and Option B spells out
by hand.

> **The `.mjs` files are an embedded-logic reference, not a standalone program.**
> `workflows/score-current.mjs` (and `source-candidates.mjs`) show the exact
> three-phase shape — including the `agent(promptString, { agentType, model,
> schema })` dispatch shape — but the Workflow sandbox has no module `import` and
> no filesystem access, so their `import { defaultRubricConfig }` and fs use are
> conceptual. The runbook steps below are the canonical procedure; the `.mjs` are
> the reference for what each dispatched agent must do.

### Option A — the score-current Workflow (recommended)

Drive the three-phase flow with `tools/photo-curation/workflows/score-current.mjs`
as the **reference template** for the Workflow dispatch (run via the **Workflow
tool**, never `node` — see the reference-vs-runnable note above):

1. a **prepare agent** shells out to `score-prepare` (Bash);
2. **parallel score agents** each `Read` one image and apply the rubric via the
   lean `photo-judge` agent;
3. a **commit agent** writes `results.json` and shells out to `score-commit`.

```bash
LIMIT=10   # batch size; re-run the Workflow until the backlog is empty
```

### Option B — the 3 steps by hand (prepare → dispatch agents → commit)

1. **Prepare** — select the next N `reviewed=0` photos, download each to
   `./thumb-cache/<code>.<ext>`, run the **deterministic gate** (#994), and emit a
   manifest of the gate-PASSING photos. Gate failures are auto-rejected here
   (persisted + `reviewed=1`) and never appear in the manifest. The last stdout
   line is the manifest path; the summary line reports
   `judged N / gate-rejected M / already-scored skipped K`.

   ```bash
   npx photo-curate score-prepare --limit 10
   # → ./thumb-cache/manifest.json
   #   [{ speciesCode, comName, sciName, family, imagePath, contentHash }, …]
   ```

2. **Dispatch agents** — for each manifest entry, dispatch the lean
   `photo-judge` subagent (`agentType: 'photo-judge'`, Read-only, `opus` tier) to
   `Read` the `imagePath`, apply `defaultRubricConfig.judgePrompt`, and return
   `{ speciesCode, fieldMarks, criteria, flags, keep, qualityScore, rationale }`
   — where `keep` is the judge's direct keep/replace **gate**. Collect all
   results into a `results.json` array.

3. **Commit** — `composeReport` each result (the composite is advisory ranking;
   the gate is the result's `keep`) and persist it as `role='current'` (keyed by
   the content hash `score-prepare` stamped), then mark each species reviewed.

   ```bash
   npx photo-curate score-commit results.json
   # exits non-zero if any result failed → safe to re-run (idempotent)
   ```

Repeat steps 1–3 (or re-run the Workflow) in batches of 10 until
`score-prepare` returns an empty manifest.

4. **Log the spend (REQUIRED).** Append one row to the token-spend ledger
   ([#996](https://github.com/julianken/bird-sight-system/issues/996)) — see
   [Step 5](#step-5--log-token-spend-required-after-every-run). This is **not
   optional**: every `score_batch` run must be recorded before you start the
   next one, or the ledger stops being comparable.

## Step 3 — source alternates for flagged species (optional)

`source-candidates` pre-scores a deep iNat pool for every **flagged** species (a
current score below the rubric review threshold) so the review server's deny
route can advance to an already-scored alternate instantly. Same prepare →
agents → commit shape:

- **Workflow:** run `workflows/source-candidates.mjs` via the Workflow tool
  (`POOL=15`).
- **By hand:**
  ```bash
  npx photo-curate source-prepare --pool 15     # → ./thumb-cache/candidates-manifest.json
  # dispatch one Read-agent per candidate → candidate-results.json
  #   [{ speciesCode, inatId, contentHash, fieldMarks, criteria, flags, keep, qualityScore, rationale }, …]
  npx photo-curate source-commit candidate-results.json
  ```

After a `source-candidates` run, **log the spend (REQUIRED)** with
`op=source_candidates` — see
[Step 5](#step-5--log-token-spend-required-after-every-run).

## Step 4 — review + apply

Start the local review server and apply approved swaps to prod:

```bash
npx photo-curate serve                  # http://localhost:5180
npx photo-curate apply-swaps            # confirm-gated push to the admin-api
```

## Step 5 — log token spend (REQUIRED after every run)

**This step is mandatory and runs after EVERY `score`, `source-candidates`, and
`calibration` operation — no exceptions.** Recording each run's token spend in
the ledger ([#996](https://github.com/julianken/bird-sight-system/issues/996))
is what makes `$/item` comparable as we change the judge model, the agent
design, and the deterministic pre-filter. Skipping it silently breaks the
comparison the ledger exists to enable.

When the Workflow (or your manual dispatch) completes, it reports
`subagent_tokens`, `agent_count`, `tool_uses`, and `duration_ms`. Feed those —
plus the op metadata — straight into `log-run`, which computes the derived
columns (`scored`, `tokens/item`, `est_$`, `$/item`) per the ledger's cost
model and appends one formatted row directly above the
`<!-- APPEND-ROWS-ABOVE-THIS-LINE -->` marker in #996:

```bash
npx photo-curate log-run \
  --run-id "$RUN_ID" \
  --op score_batch \                  # or source_candidates | calibration
  --judge-model claude-fable-5 \      # the EXACT model the judge agents ran on
  --agent-design generic \            # or lean_photo_judge (#994)
  --prefilter no \                    # yes if the #994 deterministic gate ran
  --items-in 10 \
  --gate-rejected 0 \                 # photos the pre-filter auto-rejected (#994)
  --agents "$AGENT_COUNT" \           # Workflow agent_count
  --total-tokens "$SUBAGENT_TOKENS" \ # Workflow subagent_tokens
  --tool-uses "$TOOL_USES" \          # Workflow tool_uses
  --duration-ms "$DURATION_MS" \      # Workflow duration_ms
  --notes "what changed this run"
# Add --batch if the run used the Batch API (applies the 0.5x discount).
# For an EXACT cost (when you parsed per-agent transcripts) pass all four:
#   --input <n> --output <n> --cache-read <n> --cache-create <n>
```

`est_$` defaults to the blended 85%-input / 15%-output rate from the embedded
price table (Fable 5 ≈ $16/MTok). `log-run` warns and does **not** append a
duplicate if a row with the same `--run-id` already exists, so a re-run after a
transient `gh` failure is safe.

### `log-run` exit codes

The exit code distinguishes a benign re-run from a real failure, so a wrapping
script can act on it. `--date`, if supplied, must be an ISO-8601 date
(`YYYY-MM-DD`, optionally with a time); a malformed value is rejected before any
write. Omit `--date` to default to today's UTC date.

| Code | Meaning | Wrapper action |
|---|---|---|
| `0` | **Appended** — a new row was written. | Done. |
| `3` | **Already logged** — this `--run-id` was already in the ledger; the append was a safe no-op (nothing was lost). | Safe to ignore — proceed. |
| `1` | **Failed** — a genuine error (`gh` read/write failure, missing append marker, …). **Nothing was recorded.** | Must retry. |
| `2` | **Bad argument** — a missing/malformed flag (bad `--date`, non-numeric count, unknown enum). Rejected before any write. | Fix the invocation. |

The load-bearing distinction is `3` vs `1`: a script must NOT treat the benign
duplicate (`3`) and a real write failure (`1`) the same way — exit `1` means the
row is **not** in the ledger and the run must be re-logged, while exit `3` means
it already is.

## Notes

- **Resumability** is the load-bearing property: `reviewed=1` is set only after
  a successful commit, so an interrupted run loses no progress — just re-run the
  next batch.
- The Node halves (`score-prepare` / `score-commit` /
  `source-prepare` / `source-commit`) are unit-tested in
  `src/score-orchestration.test.ts` with a temp sqlite + a stubbed download.
  The `.mjs` Workflow scripts are intentionally **not** vitest targets — they
  are the embedded-logic **reference template** for the orchestrator-driven
  dispatch (the canonical run path is the CLI prepare → score Workflow → CLI
  commit flow in Step 2, not executing the `.mjs` standalone). They are validated
  structurally (`node --check`: valid JS; no `fs` / `better-sqlite3` imports).
- The read-api `GET /api/species/with-photos` endpoint deploys on merge via the
  `deploy-read-api` workflow.
- **Calibration runs log too.** A calibration pass (re-scoring a fixed set to
  check judge drift) is a token-spending operation like the others — run
  [Step 5](#step-5--log-token-spend-required-after-every-run) with
  `--op calibration` when it finishes. The post-run `log-run` is required after
  **score**, **source-candidates**, AND **calibration**, with no exceptions.
- The cost math (blended + exact-split + batch discount) and the marker-splice
  live in `tools/photo-curation/src/token-ledger.ts`, unit-tested in
  `src/token-ledger.test.ts`; the price table is one dated constant
  (`PRICE_TABLE`) updatable as Anthropic pricing moves.
