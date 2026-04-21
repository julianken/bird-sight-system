# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repo state

This repository currently contains **planning artifacts only** — no application code, no `package.json`, no tests, no CI workflows. The full system is described in `docs/specs/2026-04-16-bird-watch-design.md` and broken into five executable plans under `docs/plans/`.

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

## PR workflow

Direct push to `main` is blocked by branch protection. Workflow:

1. Make changes on a feature branch.
2. Open a PR (`gh pr create`). **The PR description MUST follow `.github/PULL_REQUEST_TEMPLATE.md`** — all five sections (Diagrams, Summary, Screenshots, Test plan, Plan reference) are mandatory. GitHub applies the template to UI-created PRs automatically; when using `gh pr create --body`, paste the template body verbatim and fill every section. Skipping sections wastes the bot's review cycles because the diagram-first section is load-bearing for fast architectural review. The Screenshots section is REQUIRED on any PR that touches `frontend/**` (otherwise `N/A — not UI`); the Plan reference links the PR back to `docs/plans/<plan-file>.md` or says `Out of plan — <reason>`.
3. Dispatch the bot for review via the `julianken-bot` Agent subagent (it loads its credentials from macOS Keychain and posts as the `@julianken-bot` collaborator). Do NOT use `gh pr review` from the main session — that would post under Julian's identity.
4. Once `reviewDecision == APPROVED`, post a comment on the PR: `@Mergifyio queue`. Mergify enters the queue and waits asynchronously for checks to pass, then squash-merges and deletes the branch. **Do NOT use `gh pr merge`.**

**Mergify queue comment rules (critical):**
- The comment body must be exactly `@Mergifyio queue` — no prose before or after. Mergify's command parser matches the comment body against a literal string; a comment like "Looks good, @Mergifyio queue" does not match and is silently skipped. Validated in the ear-training-station workflow (17+ review cycles).
- If you need to leave explanatory context (e.g. "addressed the SUGGESTION in commit X"), post it as a separate comment first, then post `@Mergifyio queue` as its own standalone comment.

**CI is now live.** `.mergify.yml` requires `check-success` on `test`, `lint`, `build`, and `e2e`, and branch protection enforces the same four as `required_status_checks` (applied 2026-04-17 after PR #9 merged). Every PR blocks on all four being green.

**Mergify config compatibility:** `.mergify.yml` sets `merge_queue.max_parallel_checks: 1` and `queue_rules[].batch_size: 1` (and does NOT define a separate `merge_conditions` block) so in-place checks work alongside branch protection's `required_status_checks.strict: true` (require branches up-to-date). If branch protection's strictness is ever flipped off, those two settings can be relaxed — but until then, Mergify's queue will error out on any config that defines `merge_conditions` separately from `queue_conditions` or that allows >1 parallel check.

The bot is a `push` collaborator on the repo; its APPROVE counts toward the 1-review requirement. `enforce_admins=true` means even repo owners can't bypass.

## Commits

Conventional commits style with scope where useful: `feat(scope):`, `chore:`, `ci:`, `infra:`, `docs:`, `test(scope):`, `plan(N):`. Multi-line messages should explain *why*, not *what* — diffs show what.

## Testing

### UI verification (agents + reviewers)

Any PR that touches `frontend/**` gets driven live through Playwright MCP before
it is opened (by the implementer) and before it is approved (by the reviewer).
Passing e2e specs and `npm run build` are necessary but not sufficient — they
don't catch console warnings, viewport-specific layout breaks, or interactions
that only surface when you actually use the feature.

Protocol:

1. `npm run dev --workspace @bird-watch/frontend` locally, or hit the latest
   Cloudflare Pages preview URL for the PR (review pass).
2. `mcp__plugin_playwright_playwright__browser_navigate` to each touched
   surface; `browser_resize` to at least one mobile (390×844) and one desktop
   (1440×900) viewport — the two viewports the release-1 exit criteria name.
3. Interact with the feature the way a user would (clicks, form fills, URL
   round-trips). `browser_console_messages` must return zero errors and zero
   warnings. A dirty console is a Tier-1 finding at review time.
4. `browser_take_screenshot` per viewport per touched surface; those feed the
   PR's Screenshots section (implementer only — reviewers don't re-capture).

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

For everything else (TypeScript, React 18, Vite, `pg`, PostGIS SQL, React Testing Library, Docker, npm workspaces) training data is reliable enough — skip context7 and only fetch if a real failure surfaces.
