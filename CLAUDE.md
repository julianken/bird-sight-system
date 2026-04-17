# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repo state

This repository currently contains **planning artifacts only** — no application code, no `package.json`, no tests, no CI workflows. The full system is described in `docs/superpowers/specs/2026-04-16-bird-watch-design.md` and broken into five executable plans under `docs/superpowers/plans/`.

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
2. Open a PR (`gh pr create`).
3. Dispatch the bot for review via the `julianken-bot` Agent subagent (it loads its credentials from macOS Keychain and posts as the `@julianken-bot` collaborator). Do NOT use `gh pr review` from the main session — that would post under Julian's identity.
4. Once `reviewDecision == APPROVED`, squash-merge with `gh pr merge <N> --squash --delete-branch`.

The bot is a `push` collaborator on the repo; its APPROVE counts toward the 1-review requirement. `enforce_admins=true` means even repo owners can't bypass.

## Commits

Conventional commits style with scope where useful: `feat(scope):`, `chore:`, `ci:`, `infra:`, `docs:`, `test(scope):`, `plan(N):`. Multi-line messages should explain *why*, not *what* — diffs show what.

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

## CI status

No CI workflows exist yet. `.mergify.yml` references `test`, `lint`, `build`, and `e2e` checks — when the first CI workflow lands (likely as part of Plan 1's followups), those job names must match, and `required_status_checks` on branch protection should be re-applied via `gh api -X PUT repos/julianken/bird-sight-system/branches/main/protection` to actually enforce them.
