# Photo-curation scoring runbook

## Purpose

Score the live detail-panel photos on bird-maps.com against the
`@bird-watch/photo-quality` rubric so an operator can spot weak photos and
queue better alternates. The vision judge is a **Claude Code agent** that
`Read`s each downloaded image — there is **no `@anthropic-ai/sdk` and no
`ANTHROPIC_API_KEY`**. Scoring is therefore orchestrator-driven: the runnable
Node halves do all filesystem + SQLite work, and a Claude Code **Workflow-tool
script** dispatches the agents between them (issue #992, epic #974).

## Cheaper scoring (#994)

Three measures cut the per-photo cost without losing judging quality. They are
already wired into the Workflow scripts and `score-prepare` — nothing extra to
run:

- **Lean `photo-judge` subagent.** The per-photo judge dispatches as the
  `.claude/agents/photo-judge.md` project subagent (`tools: Read` only, a short
  judge-role system prompt) instead of the generic Workflow agent (which carries
  the full default system prompt + the entire tool registry + the session
  model). The rubric is **not** baked into the agent — it still arrives in the
  per-call prompt as `defaultRubricConfig.judgePrompt`, single-sourced in
  `packages/photo-quality/src/rubric.config.ts`, so there is no rubric copy to
  drift.
- **Haiku model tier, calibration-locked.** The `photo-judge` model defaults to
  the **`haiku`** alias (bulk structured vision-rating fits a small model). It is
  overridable via the `PHOTO_JUDGE_MODEL` env var so **#969 calibration locks the
  tier**: score the labeled sample with Haiku and keep it iff agreement with the
  operator labels is **≥90%**; otherwise step the override up to Sonnet. The
  alias (not a hardcoded model id) is deliberate — see the `claude-api`
  model-alias rule.

  ```bash
  PHOTO_JUDGE_MODEL=sonnet   # override the Haiku default, e.g. if calibration < 90%
  ```

- **Deterministic pre-filter (free rejects).** `score-prepare` already has the
  downloaded bytes, so it runs `assessDeterministic(img, config.deterministic)`
  there. A gate failure (too small / too blurry / wrong aspect) is **auto-rejected
  with zero agent calls** — a reject report is persisted the same way
  `score-commit` writes (`upsertScore` role='current' + `markReviewed`), and the
  species is **excluded from the manifest** the judge agents read, so a junk image
  never reaches a (paid) judge. The prepare log reports
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
   `photo-judge` subagent (`agentType: 'photo-judge'`, Read-only, `haiku` tier)
   to `Read` the `imagePath`, apply `defaultRubricConfig.judgePrompt`, and return
   `{ speciesCode, criteria, flags, rationale }`. Collect all results into a
   `results.json` array.

3. **Commit** — `composeReport` each result and persist it as `role='current'`
   (keyed by the content hash `score-prepare` stamped), then mark each species
   reviewed.

   ```bash
   npx photo-curate score-commit results.json
   # exits non-zero if any result failed → safe to re-run (idempotent)
   ```

Repeat steps 1–3 (or re-run the Workflow) in batches of 10 until
`score-prepare` returns an empty manifest.

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
  #   [{ speciesCode, inatId, contentHash, criteria, flags, rationale }, …]
  npx photo-curate source-commit candidate-results.json
  ```

## Step 4 — review + apply

Start the local review server and apply approved swaps to prod:

```bash
npx photo-curate serve                  # http://localhost:5180
npx photo-curate apply-swaps            # confirm-gated push to the admin-api
```

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
