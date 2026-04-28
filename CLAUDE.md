# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repo state

The system shipped to **bird-maps.com** on 2026-04-19 and is live. The npm workspaces are `frontend/`, `services/read-api/`, `services/ingestor/`, `packages/db-client/`, `packages/shared-types/`; `infra/` holds Terraform (not an npm workspace). The full architecture is in `docs/specs/2026-04-16-bird-watch-design.md`; five executed plans live under `docs/plans/`.

The directory on disk is `bird-watch/`; the GitHub repo is `julianken/bird-sight-system`. They will not match.

## Entering execution

Each plan is independently executable via `superpowers:subagent-driven-development`. Plans are designed to be picked up by an agent that has zero prior context for this codebase — every task includes exact file paths, full code (no placeholders), expected commands, and commit boilerplate.

Plan dependency graph:

```
1 (db-foundation) ──┬── 2 (ingestor)   ──┐
                    └── 3 (read-api)  ──┴── 5 (infra)
                                           │
                            4 (frontend) ──┘
```

Plan 1 must run first because it scaffolds the monorepo. Plans 2–4 can run in any order or in parallel after Plan 1. Plan 5 expects all four to be complete and tested locally.

## Architecture (when code lands)

Three external dependencies (eBird API, Phylopic, EPA/BCR ecoregion data) feed four internal services: an Ingestor (scheduled), a Read API (HTTP, behind CDN), Postgres + PostGIS, and a static React frontend. The full architecture, data model, API contract, caching strategy, error-handling, and testing strategy are in the spec — read it before making structural changes.

Two design choices that are easy to violate accidentally:
- **Region assignment happens at ingest, not at request time.** PostGIS `ST_Contains` stamps `region_id` on each observation when it lands. Don't add point-in-polygon math to the read path.
- **The Read API is platform-agnostic.** It's a `Hono` app exported from `services/read-api/src/app.ts`. Cloud-specific wrappers (Cloud Run entry, AWS Lambda handler, etc.) live in separate files and only adapt the entry point.

## Conventions baked into the plans

These are non-obvious commitments the plans enforce:

- **No DB mocks in tests.** Integration tests run against a real Postgres + PostGIS via `@testcontainers/postgresql`. The ingest path is too geometry-dependent for mocks to be meaningful.
- **Plain SQL migrations** under `migrations/`, run by `node-pg-migrate`. Each file uses `-- Up Migration` and `-- Down Migration` markers.
- **TDD discipline per task.** Every code-producing task runs the cycle: write failing test → confirm failure → write minimal implementation → confirm pass → commit. Don't batch.
- **Docker is the portable artifact.** Plan 5 deploys to Cloud Run, but the same image runs unchanged on AWS Fargate, Azure Container Apps, or Fly Machines. Don't add cloud-specific code outside the platform-wrapper files.
- **The `is_notable` flag requires a separate eBird call.** The ingestor calls `/data/obs/US-AZ/recent` AND `/data/obs/US-AZ/recent/notable` and intersects them — without both, the notable filter doesn't work.

## Prototype gate

Before the body of any plan is written, a working prototype must validate the rendering approach at representative data volume and real viewports. This prevents a "looks fine in a demo, breaks at production dimensions" failure mode (the root cause of Plan 4's rendering dragons).

**Minimum prototype requirements:**

- Render **≥344 rows** of representative data from canned JSON matching the production API shape.
- Test at **390×844** (mobile) and **1440×900** (desktop) — the two viewports the release-1 exit criteria name.
- Exercise every interactive surface the plan introduces: filter state changes, panel open/close, scroll-restore, keyboard navigation.
- Confirm zero console errors and zero console warnings at both viewports.

The prototype does not need a real API connection, real auth, or production deployment. A local Vite dev server with canned JSON is sufficient. Scope is 2–4 hours; output is a local dev URL or screen recording plus a 5-line "things I learned" note.

**Gate rule:** No plan body (tasks, acceptance criteria, issue list) may be authored until the prototype has been built and the learnings note written. The note must be committed alongside or before the plan file. Rationale: `docs/plans/2026-04-21-path-a-assessment/risk-viability.md` Part 7.

## PR workflow

Full protocol: `.claude/skills/pr-workflow/SKILL.md` (triggers on "create PR", "merge PR", "review PR"). Subagents dispatched with `isolation: "worktree"` rely on the skill, not this file.

Four load-bearing rules: (1) PR body follows `.github/PULL_REQUEST_TEMPLATE.md` verbatim — all 5 sections, Screenshots REQUIRED on `frontend/**`; (2) bot review dispatches through the `julianken-bot` Agent subagent, never `gh pr review` from the main session; (3) Mergify queue comment body is exactly `@Mergifyio queue` (no prose — literal-string match); (4) `.mergify.yml` keeps `max_parallel_checks: 1`, `batch_size: 1`, no separate `merge_conditions:` block. Never `gh pr merge`. CI gate: `test`, `lint`, `build`, `e2e`.

## Commits

Conventional commits style with scope where useful: `feat(scope):`, `chore:`, `ci:`, `infra:`, `docs:`, `test(scope):`, `plan(N):`. Multi-line messages should explain *why*, not *what* — diffs show what.

## Testing

### UI verification (agents + reviewers)

Any PR that adds or modifies visible UI under `frontend/**` gets driven live
through Playwright MCP before it is opened (by the implementer) and before it
is approved (by the reviewer). Test-only, type-only, and comment-only PRs
under `frontend/**` are exempt — use the Screenshots section's `N/A — not UI`
marker and skip this step. Passing e2e specs and `npm run build` are necessary
but not sufficient for real UI change — they don't catch console warnings,
viewport-specific layout breaks, or interactions that only surface when you
actually use the feature.

Protocol:

1. `npm run dev --workspace @bird-watch/frontend` locally. Reviewers run the
   same command after `gh pr checkout <N>` against the PR head SHA — no
   per-PR preview URLs are configured on this repo yet (Pages deploys only on
   merge to `main`).
2. `mcp__plugin_playwright_playwright__browser_navigate` to each touched
   surface; `browser_resize` to at least one mobile (390×844) and one desktop
   (1440×900) viewport — the two viewports the release-1 exit criteria name.
3. Interact with the feature the way a user would (clicks, form fills, URL
   round-trips). `browser_console_messages` must return zero errors and zero
   warnings. A dirty console is a Tier-1 finding at review time.
4. `browser_take_screenshot` per viewport per touched surface; those feed the
   PR's Screenshots section (implementer only — reviewers don't re-capture).
   Screenshots: use the `pr-screenshots-via-user-attachments` skill
   (paste-flow → `user-attachments/assets/<uuid>` URLs); never commit PNGs to
   the repo.

`.playwright-mcp/` is already gitignored so per-call snapshot YAMLs never land
in git. Do not remove it from `.gitignore`.

### Spec authoring conventions

E2E specs live in `frontend/e2e/*.spec.ts` and run under `@playwright/test`.
Shared selectors live in `frontend/e2e/pages/*.ts` (Page Object Model); shared
API route stubs live in `frontend/e2e/fixtures.ts`.

**Concurrency.** `playwright.config.ts` sets `workers: 2` in CI and
`workers: undefined` locally (defaults to half the available CPUs, typically
4–8 on dev machines — this is intentional; local dev benefits from max
throughput, and flakes surface quickly at a human-visible rate).
`fullyParallel: true` is enabled everywhere — 2 parallel workers in CI matches
typical GitHub Actions runner sizes, is strictly faster than serial, and
catches ordering bugs that a single-worker config would mask. Do not raise CI
workers to 4+ without re-auditing isolation; do not drop to 1 (hides real
bugs).

**No retries.** `retries: 0` is deliberate. If a test flakes, fix the root
cause — don't paper over it. Retries are only appropriate for out-of-our-
control dependencies, and this suite has none.

**Navigation contract.** Every test begins by issuing `page.goto(...)`
(optionally with query params or a preceding `page.route` stub) — tests never
rely on state left over from a prior test. Tests that expect a healthy map
wait for the 9-region render before asserting (`app.waitForMapLoad()` via the
Page Object Model); tests that deliberately fail the API skip that wait and
assert directly on `.error-screen`.

**No DB writes.** E2E specs must not mutate the seeded database. Verify via a
recursive scan (portable across stock macOS `/bin/bash` 3.2, which lacks
`globstar`):

`grep -rE "request\.(post|patch|delete|put)|fetch\(.*method:|fetch\(.*[\"']POST[\"']" frontend/e2e/`

If this grep returns anything, the write must be replaced with a `page.route`
stub or pushed down into a per-worker schema (e.g. via
`@testcontainers/postgresql` if that becomes necessary).

## Use context7 for these libraries

The following libraries change quickly enough that training-data knowledge is often wrong. **Pull fresh docs from `context7` before writing code that touches them**, not after debugging a failure:

| Library | Used in plan | Why drift-prone |
|---|---|---|
| `hono` | 3 | Route handler types and adapters churn between minor versions |
| `hashicorp/google` Terraform provider (`google_cloud_run_v2_service`, `google_cloud_run_v2_job`, `google_cloud_scheduler_job`, `google_secret_manager_*`, `google_artifact_registry_repository`) | 5 | Cloud Run v2 resources are newer; attribute names have shifted |
| `cloudflare/cloudflare` Terraform provider (`cloudflare_pages_project`, `cloudflare_record`) | 5 | Major version bumps reshape resources |
| `kislerdm/neon` Terraform provider | 5 | Community provider; resource attribute names move |
| `msw` (v2) | 2 | Major API rewrite from v1 — `http.get` + `HttpResponse` replaced `rest.get` + `res(ctx.json())` |
| `@testcontainers/postgresql` + `testcontainers` | 1, 2, 3 | Constructor shape and lifecycle methods have shifted |
| `vitest` | all | Config + workspace API evolves |
| `@playwright/test` | 4 | Config shape and `webServer` option detail change |
| `node-pg-migrate` | 1 | CLI flags and `-- Up/Down Migration` marker semantics |
| `maplibre-gl` | 4 | Major version bumps change clustering API + `GeoJSONSource` Promise behavior (see PR #171 for the 4.x precedent) |

For everything else (TypeScript, React 18, Vite, `pg`, PostGIS SQL, React Testing Library, Docker, npm workspaces) training data is reliable enough — skip context7 and only fetch if a real failure surfaces.

## Drift detection

We track drift between artifacts and reality with the `drift:*` label taxonomy below. The mechanism is intentionally lightweight: deterministic checks (knip, syncpack, terraform-plan-drift-check) catch structural drift; the PR-review bot (`julianken-bot`) catches narrative drift on PRs touching drift-prone surfaces; a nightly workflow (planned, see #307) catches time-emergent drift.

**Label taxonomy** (8 labels):

| Label | Meaning | Who applies |
|---|---|---|
| `drift:automated` | Opened by nightly workflow | Workflow |
| `drift:shadow` | Detected but suppressed during rollout | Workflow |
| `drift:acknowledged` | Maintainer saw it; suppress re-fires until metric changes | Maintainer |
| `drift:wont-fix` | Known drift, will not be addressed; nightly skips | Maintainer |
| `drift:aging` | Open >14 days | Workflow |
| `drift:escalated` | Open >30 days; surfaces at higher priority in SessionStart hook | Workflow |
| `drift:spec-update` | Implementer used escape hatch to defer spec-update | Bot |
| `drift:decision-required` | Needs product/architectural decision | Bot or maintainer |

**Where findings live**: GitHub Issues filed under the repo's tracker, labeled `drift:automated` when opened by the nightly workflow. Aging through `drift:aging` (>14 days open) → `drift:escalated` (>30 days open) is automated; the SessionStart hook surfaces `drift:escalated` at higher priority for next-session triage.

**Kill-threshold metric**: evaluate at the 60-day mark after first ship of any drift mechanism (knip, R13 PR-bot rubric, or nightly workflow). Compute `closed-as-fixed / closed-total` over the calendar month. If it drops below 40% — i.e., 6 of 10 drift issues close as FP / won't-fix / stale-signal — alert fatigue is realized. Response: comment out the nightly's `on:` block, downgrade LLM-driven rules to silent-log mode, keep deterministic checks (knip, syncpack, terraform-plan-drift-check) intact, and file a retrospective at `docs/analyses/<date>-drift-system-retrospective.md`. The audit at `docs/analyses/2026-04-27-codebase-drift-audit/report.md` records the system's current falsifiability claim.

The 2026-04-27 codebase drift audit at `docs/analyses/2026-04-27-codebase-drift-audit/report.md` lists current findings.
