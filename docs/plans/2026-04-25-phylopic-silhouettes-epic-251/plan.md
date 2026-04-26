# Epic #251 — Per-family Phylopic silhouettes on bird-maps.com

## Context

`bird-maps.com` shipped 2026-04-19 and is live. Epic #251 decomposes GitHub issue #55
(per-family Phylopic silhouettes) into 9 sub-issues after a 5-round bot scoping review
converged 24 → 1 findings; all sub-issues are labeled `agent-ready`.

The epic also captures a P0 compliance fix (#243): the live app violates eBird API
ToU §3 by not surfacing visible attribution. That ships as part of the epic, not as a
hotfix to `main`, per user direction.

**User-locked decisions** (do not relitigate):

- All sub-issue PRs target the `version-one` feature branch, not `main`.
- `.mergify.yml` is updated as Task 0 to accept both `main` and `version-one` as
  queue bases.
- Tasks 0, #243, #252 ship sequentially in the main worktree (Phase A).
  Phase B and onward dispatch in parallel via worktrees automatically — no
  user check-in between phases.
- The 5-round bot scoping review substitutes for the CLAUDE.md prototype gate —
  these issues are extensions to a shipped, working renderer, not greenfield
  rendering decisions.

## Issue inventory

| #   | Type     | Title (truncated)                                              | Depends on              |
| --- | -------- | -------------------------------------------------------------- | ----------------------- |
| 243 | fix      | eBird API attribution (ToU §3 compliance)                      | —                       |
| 252 | chore    | Drop `immutable` from `/api/silhouettes` Cache-Control         | —                       |
| 244 | chore    | Expand `family_silhouettes` seed 15 → 25 + `_FALLBACK`         | —                       |
| 245 | feat(db) | Phylopic curation script + UPDATE migration with real SVGs     | 244                     |
| 246 | feat(fe) | MapCanvas SDF symbol layer per-family rendering                | 244, 245                |
| 247 | feat(fe) | MapCanvas click-spiderfy + skip-link a11y                      | —                       |
| 248 | feat(fe) | MapCanvas 2×2 cluster mosaic for small clusters                | 244                     |
| 249 | feat(fe) | FamilyLegend floating overlay + filter affordance              | 244 (for full coverage) |
| 250 | feat(fe) | AttributionModal in SurfaceNav, retires per-surface footers    | 243, 245                |

Verbatim acceptance criteria for each issue live on the GitHub issue body
(`gh issue view <N> --repo julianken/bird-sight-system`). Each AC bullet is a
concrete deliverable validated at bot review time. Do **not** paraphrase them
when handing the issue to an implementer subagent — paste verbatim.

## Critical files

Created or modified by Task 0 (this PR):

- `.mergify.yml` — queue accepts `base = main OR base = version-one`.
- `docs/plans/2026-04-25-phylopic-silhouettes-epic-251/plan.md` — this file,
  referenced by every subsequent PR's "Plan reference" section.

Created during execution (per-issue):

- `docs/screenshots/epic251/issue-<NNN>-<slug>/` — per-issue screenshot
  directories committed before each frontend PR opens.

Already existing, will be touched per issue: file lists were captured during the
5-round scoping review and live in each issue body's "Files to modify / create"
section. Implementers must not expand the diff beyond those files without
surfacing the question first.

## Task 0 — Foundation (this PR)

Single PR to `main`:

1. Edit `.mergify.yml` `queue_rules[0].queue_conditions` to replace
   `- base = main` with an `or:` block accepting both `main` and `version-one`.
   Keep `max_parallel_checks: 1`, `batch_size: 1`, no separate
   `merge_conditions:` block (load-bearing per CLAUDE.md).
2. Commit this plan file at `docs/plans/2026-04-25-phylopic-silhouettes-epic-251/plan.md`.
3. PR body follows `.github/PULL_REQUEST_TEMPLATE.md`. Bot review via
   `julianken-bot` Agent dispatch. Queue with `@Mergifyio queue` literal.
4. After merge, fast-forward `version-one` to include the new config:
   `git fetch origin main && git push origin origin/main:version-one`.
   `version-one` is currently identical to `main` at `e683aad`, so this is a
   clean fast-forward (no `--force-with-lease` needed).
5. Verify: `gh api repos/julianken/bird-sight-system/branches/version-one`
   shows the new HEAD SHA matches `main`.
6. Cleanup is tracked in **#253** — once Task 10 ships and `version-one` is
   deleted, that issue's PR reverts `.mergify.yml` to a single `base = main`
   line.

Pause for user check-in after Task 0 merges.

## Per-issue execution template (Task 1+)

Repeatable 6-step block. Instantiate once per sub-issue. `<NNN>` = issue number.
`<slug>` = 2–4-word kebab-case from the issue title.

### Step 1 — Branch off latest version-one

```bash
git fetch origin version-one
git switch -c feat/issue-<NNN>-<slug> origin/version-one
```

(Use `chore/`, `fix/`, `infra/` prefix instead of `feat/` to match the issue's
conventional-commit type.)

### Step 2 — Dispatch implementation subagent

Single `Agent` call. `subagent_type: "general-purpose"`. While serial, omit
`isolation`. Once parallel (Phase B+), use `isolation: "worktree"`.

Prompt skeleton (orchestrator constructs a fresh HEREDOC per issue):

```
You are implementing GitHub issue #<NNN> in /Users/jul/repos/bird-sight-system
on branch feat/issue-<NNN>-<slug>. Base: version-one.

Issue link: https://github.com/julianken/bird-sight-system/issues/<NNN>

Acceptance criteria (verbatim — do not paraphrase, every bullet is a deliverable):
<paste full AC bullet list from issue body>

Files to modify / create (verbatim from issue body):
<paste file list>

Plan reference: docs/plans/2026-04-25-phylopic-silhouettes-epic-251/plan.md, Task <task-N>.

Hard rules:
- TDD per CLAUDE.md: failing test → confirm failure → minimal impl → confirm
  pass → commit. One AC bullet per commit cycle when possible.
- Conventional commits with scope, e.g. `feat(frontend):`, `chore(db):`.
- Plain SQL migrations in /migrations with -- Up Migration / -- Down Migration markers.
- No DB mocks. Integration tests use @testcontainers/postgresql against real PG+PostGIS.
- Frontend changes: drive Playwright MCP at 390x844 + 1440x900, zero console
  warnings/errors. Capture screenshots to docs/screenshots/epic251/issue-<NNN>-<slug>/
  named <viewport>-<state>.png. Commit them in a dedicated commit with message
  `docs(screenshots): epic #251 issue #<NNN> capture`.
- Use context7 MCP for library docs on: maplibre-gl, msw, @testcontainers/postgresql,
  vitest, @playwright/test, node-pg-migrate (per CLAUDE.md "Use context7" table).
- DO NOT claim success without test evidence — paste command output for each gate.
- DO NOT open the PR. Stop after the screenshot commit (or the final impl commit
  for non-UI issues), report the head SHA and a one-line summary of each commit.

Verification gate before stopping (paste output):
  npm run typecheck
  npm run test
  npm run lint
  npm run build
  (UI only) npm run test:e2e --workspace @bird-watch/frontend
```

### Step 3 — Orchestrator-side verification gate

After subagent returns, re-run from the orchestrator (don't trust the subagent's
self-report; verify):

```bash
cd /Users/jul/repos/bird-sight-system
npm run typecheck && npm run test && npm run lint && npm run build
# UI only:
npm run test:e2e --workspace @bird-watch/frontend
```

If any fails: re-dispatch Step 2 with the failure log appended to the prompt.
Do **not** proceed to PR creation with a red gate.

### Step 4 — Open PR via `creating-prs` skill

```bash
git push -u origin feat/issue-<NNN>-<slug>
```

Then invoke the skill, which enforces the 5-section PR body. Orchestrator
supplies the section content:

- **Diagrams**: mermaid sequence/component/data-flow per CLAUDE.md prose. For
  one-line / docs-only PRs, write `N/A — <reason>`.
- **Summary**: 1–3 bullets, lead with *why*. Reference the issue (`Closes #<NNN>`).
- **Screenshots**: per CLAUDE.md user-level note, `bird-sight-system` uses
  pattern 1 — committed PNGs referenced as
  `https://raw.githubusercontent.com/julianken/bird-sight-system/<HEAD-SHA>/docs/screenshots/epic251/issue-<NNN>-<slug>/<viewport>-<state>.png`.
  Capture `<HEAD-SHA>` *after* the screenshot commit, *before* `gh pr create`.
  For non-UI issues: `N/A — not UI`.
- **Test plan**: every checkbox ticked, with command output paraphrased
  (`npm run typecheck` — green; `npm run test` — 87 passed; etc.).
- **Plan reference**: literally
  `Part of epic #251, Issue #<NNN>. See \`docs/plans/2026-04-25-phylopic-silhouettes-epic-251/plan.md\`, Task <task-N>.`

`gh pr create --base version-one --head feat/issue-<NNN>-<slug>`.

### Step 5 — Bot review dispatch

Single `Agent` call. `subagent_type: "general-purpose"`. Prompt:

```
Skill: superpowers:reviewing-as-julianken-bot
Repo: julianken/bird-sight-system
PR: https://github.com/julianken/bird-sight-system/pull/<PR_N>
Plan reference: docs/plans/2026-04-25-phylopic-silhouettes-epic-251/plan.md, Task <task-N>.

Review the PR against the issue's acceptance criteria using the skill's 12-rule
anti-slop rubric. Cap at 3 findings. Post the review under the bot identity
(load Keychain credentials per the skill). Return the structured result
{decision, findings[]}.
```

**Triage on return:**

- `APPROVED` with 0 BLOCKER, 0 IMPORTANT → Step 6.
- `CHANGES_REQUESTED` with BLOCKER → re-dispatch Step 2 with bot findings
  appended to the prompt. New commit, push, **re-dispatch Step 5** (the bot
  picks up the new SHA — do not skip the re-review).
- `APPROVED` with IMPORTANT → reply to the bot's thread acknowledging the
  trade-off, file follow-up `gh issue create` if needed, proceed to Step 6.
- `SUGGESTION` only → file follow-up issue if it survives a "is this worth a
  ticket" sanity check, proceed to Step 6.

### Step 6 — Merge via Mergify queue

When `gh pr view <PR_N> --json reviewDecision,statusCheckRollup` shows
`APPROVED` and all four checks (`test`, `lint`, `build`, `e2e`) green:

```bash
gh pr comment <PR_N> --body '@Mergifyio queue'
```

Body is **literally** `@Mergifyio queue`. No prose. No surrounding text.
(Load-bearing per CLAUDE.md and the `mergify-merge-workflow` skill.)

Wait for squash merge:

```bash
until gh pr view <PR_N> --json state -q '.state' | grep -q MERGED; do sleep 30; done
```

Confirm the merge landed:

```bash
git fetch origin version-one
git log origin/version-one --oneline -1
```

Move to next issue's Step 1.

## Issue queue and order

### Phase A — Foundation + first 3 PRs (sequential, main worktree)

- **Task 0** — Foundation (Mergify + plan commit). This PR.
- **Task 1 — Issue #243** (`fix(frontend)`: eBird attribution).
  P0 compliance fix. Independent. Frontend (Playwright MCP gate applies).
- **Task 2 — Issue #252** (`chore(read-api)`: drop immutable from Cache-Control).
  Independent. Backend + script + runbook (no UI). Must reach prod before
  #244/#245/#246/#249 deploy — but since version-one ships as one merge, this
  just needs to land on version-one before those four.

After Task 2 merges to version-one, dispatch Phase B automatically — no user
check-in. The version-one + Mergify + bot-review loop is validated by Tasks 0-2;
Phase B runs in parallel worktrees.

### Phase B — Independent dependency-roots (dispatched in parallel via worktrees)

- **Task 3 — Issue #244** (`chore(db)`: seed expansion 15 → 25 + `_FALLBACK`).
  Gates #246. Backend only.
- **Task 4 — Issue #247** (`feat(frontend)`: spiderfy + skip-link a11y).
  Independent. Frontend.
- **Task 5 — Issue #249** (`feat(frontend)`: FamilyLegend + filter affordance).
  Independent of #244 architecturally; benefits from full family coverage but
  the schema migrations (`1700000019000`, `1700000019500`) are independent of
  #244's seed migration. Frontend + DB.

Dispatch all three concurrently in a single message with three Agent tool uses,
each with `isolation: "worktree"`. PR creation runs sequentially after subagents
return, to avoid push race conditions.

### Phase C — Phylopic + dependent renderers (Task 3 must merge first)

- **Task 6 — Issue #245** (`feat(db)`: Phylopic curation + UPDATE migration).
  Uses #244 (Task 3). Backend only. Implementer runs the curation script
  interactively (human picker step) — this task may need orchestrator-side
  pairing, not pure subagent dispatch.
- **Task 7 — Issue #248** (`feat(frontend)`: 2×2 cluster mosaic).
  Uses #244 (Task 3). Independent of #245. Frontend.

Tasks 6 and 7 can run in parallel after Task 3 merges.

### Phase D — Final dependent renderer + AttributionModal

- **Task 8 — Issue #246** (`feat(frontend)`: SDF symbol layer).
  Uses #244 + #245 (Tasks 3, 6). Largest frontend change. Frontend.
- **Task 9 — Issue #250** (`feat(frontend)`: AttributionModal, retires SurfaceFooter).
  Uses #243 (Task 1) + #245 (Task 6). Frontend + DB-data consumption.

Task 8 must merge before Task 9 (Task 9's modal references the silhouettes
rendered in Task 8's pipeline). Sequential within Phase D.

### Phase E — Release: version-one → main

- **Task 10** — Open release PR `version-one → main`. Title:
  `feat(epic-251): per-family Phylopic silhouettes`. PR body summarizes the
  9 issues, links to each merged sub-PR, includes pre-deploy checklist:
  - [ ] All 9 sub-PRs merged to version-one
  - [ ] CI green on version-one HEAD
  - [ ] `npm run dev` smoke test on version-one HEAD shows silhouettes rendering
  - [ ] `scripts/purge-silhouettes-cache.sh --dry-run` exits 0
  - [ ] Post-merge: human runs `scripts/purge-silhouettes-cache.sh` against prod
        Cloudflare to invalidate the 1-week-cached silhouette payload
  - [ ] Post-merge: verify `curl -I https://bird-maps.com/api/silhouettes` shows
        no `immutable` directive
- Bot review via `julianken-bot` Agent dispatch on the release PR.
- Mergify queue via `@Mergifyio queue` comment.
- Post-merge: human-verified cache purge + curl verification.

## Cross-cutting concerns

### version-one rebase strategy

- **Always branch off the latest `origin/version-one`** at Step 1 of every
  issue. As earlier PRs merge into version-one, later branches start fresher.
- **Do not mid-stream rebase** unless Mergify reports `conflict` in the queue.
  In that case, from the feature branch:
  ```bash
  git fetch origin version-one
  git rebase origin/version-one
  git push --force-with-lease origin feat/issue-<NNN>-<slug>
  ```
  Then re-dispatch Step 5 (bot reviews the rebased SHA).
- **Never rebase while CI is mid-run** — wait for the current run to settle
  before force-pushing.

### Failure modes and pause triggers

Pause the loop and surface to user when:

- A bot finding requires scope outside the current issue's AC (signals a
  scoping miss; do not work around — re-order the queue or update the issue).
- Any CI gate stays red after 2 implementer re-dispatch attempts.
- A `version-one` rebase conflict touches files outside the current issue's
  expected diff (signals contamination from a half-broken prior merge —
  investigate before proceeding).
- Task 6's curation script needs interactive human picking (expected; not a
  failure, but requires orchestrator+user pairing).

### Plan traceability

Every PR's "Plan reference" section uses the literal format:

```
Part of epic #251, Issue #<NNN>. See `docs/plans/2026-04-25-phylopic-silhouettes-epic-251/plan.md`, Task <task-N>.
```

Where `<task-N>` is the Task number in this plan (Task 0 = foundation, Task 1 =
issue #243, etc.).

### Skills used per step

| Step                       | Skill                                          |
| -------------------------- | ---------------------------------------------- |
| Step 2 (implementation)    | `superpowers:subagent-driven-development`      |
| Step 4 (PR creation)       | `creating-prs`                                 |
| Step 5 (bot review)        | `reviewing-as-julianken-bot` (via Agent dispatch) |
| Step 6 (merge)             | `mergify-merge-workflow`                       |
| Cross-cutting              | `superpowers:verification-before-completion`   |

## End-to-end verification

After Task 10 merges to `main` and the human-verified cache purge runs:

1. `curl -I https://bird-maps.com/api/silhouettes` — confirm
   `Cache-Control: public, max-age=604800` (no `immutable`).
2. Open `https://bird-maps.com` on mobile (390×844) and desktop (1440×900):
   - Map view shows family silhouettes at zoom ≥ 14 (Task 8 / #246).
   - Small clusters show 2×2 mosaic (Task 7 / #248).
   - FamilyLegend overlay present and filter-clickable (Task 5 / #249).
   - Spiderfy fans markers on small-cluster click (Task 4 / #247).
   - Skip-to-feed link reachable via Tab (Task 4 / #247).
   - Footer "Credits" button opens AttributionModal with Phylopic per-silhouette
     attribution (Task 9 / #250).
   - eBird credit visible in map AttributionControl (Task 1 / #243).
3. axe-core DevTools scan: zero violations on each surface.
4. `gh issue view 251` shows all 9 sub-issues closed via merged PRs; close epic.

## Out of scope (do not include in this plan's PRs)

- Deploy infrastructure changes (Plan 5's Cloud Run / Cloudflare Pages / Neon).
  This epic ships through the existing deploy pipeline.
- Re-rendering existing observations against the new silhouettes — handled by
  the existing taxonomy cron's `runReconcileStamping`.
- Phylopic license re-vetting beyond the curation script's emitted SQL.
- Any work on issues outside the #243-#250, #252 set.
