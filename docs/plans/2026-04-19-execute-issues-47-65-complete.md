# Execute Issues #47–#65 — Execution Log

**Date:** 2026-04-19
**Status:** Complete. 15 PRs merged; 2 issues intentionally deferred; 1 follow-up filed.

## What shipped

17 pull requests merged to `main` in the following order (oldest first):

| PR | Title | Commit |
|---|---|---|
| #61 | chore: ignore MCP snapshots, onboarding screenshots, tfstate | `86ca45d` |
| #66 | feat(frontend): wire VITE_API_BASE_URL for prod cross-origin API | `cc6641c` |
| #67 | feat(read-api): CORS middleware for cross-origin frontend | `ce309b0` |
| #68 | fix(infra): Neon free-tier compatibility — org_id + single RW endpoint + 6h retention | `6b92790` |
| #69 | fix(infra): apex DNS + Cloud Run domain mapping for api subdomain | `c01924e` |
| #70 | docs(plan-5): sync with actually-shipped code from PRs #47-#51 | `9110375` |
| #71 | feat(ci): deploy-frontend.yml — auto-deploy to Cloudflare Pages | `8a76b76` |
| #72 | feat(ci): deploy-read-api.yml — Cloud Run service auto-deploy via WIF | `667d552` |
| #73 | fix(ci): build workspace deps before frontend build in deploy-frontend.yml | `c7ae300` |
| #74 | feat(ci): deploy-ingestor.yml — Cloud Run job auto-deploy via WIF | `49962bf` |
| #75 | feat(ci): deploy-migrations.yml — auto-run Neon migrations; closes #52+#65 | `7ad40cf` |
| #76 | fix(db): topology-correct AZ ecoregion polygons + sky-island parent_id | `0b9b70b` |
| #77 | fix(frontend): polygon-aware badge layout (inscribed rect + pole fallback) | `61e09bc` |
| #78 | feat(frontend): visible species name labels on expanded badges | `2a24d66` |
| #81 | fix(frontend): render child regions after parents for correct SVG z-order | `91b1404` |
| #79 | feat(frontend): species detail panel wiring /api/species/:code | `ef1e2c0` |

## Issues closed

**By PR (13 issues):** #47, #48, #49, #50, #51, #52, #53, #54, #56, #58, #59, #65, #80.

**Open (3 issues):**
- #55 — per-family Phylopic silhouettes: `needs-scoping` (requires human curation of 15 silhouettes + CC license strings)
- #57 — first-class `familyCode` on `Observation`: `needs-scoping` (design decision: JOIN vs lookup table)
- #60 — Terraform remote state backend (GCS): `area:infra` follow-up filed during PR #47 execution

## Method

Every PR followed the same pipeline:

1. **Pre-execution spec review gate (Wave 0.5):** `julianken-bot` reviewed each issue body for quality before implementation dispatch. Three BLOCKERs caught pre-coding:
   - #53 "Source of truth" referenced wrong sibling numbers (#2–#6 instead of #47–#52)
   - #56 spec used snake_case (`com_name`) but actual `SpeciesMeta` is camelCase
   - #58 spec referenced nonexistent `services/ingestor/src/upsert.ts`; real home is `packages/db-client/src/{observations,hotspots}.ts`
2. **Per-PR workflow:** cut feature branch → opus implementer subagent (TDD) → `gh pr create` with template → `julianken-bot` PR review → `@Mergifyio queue` → merge.
3. **Internal spec + code-quality reviewers skipped** — the pre-execution bot review already blessed the spec, and the `julianken-bot` PR review is the authoritative code-quality gate.

## Notable in-flight fixes

- **CD first-run failed (PR #73):** `deploy-frontend.yml` didn't build workspace dependencies before `npm run build -w @bird-watch/frontend`. Fixed by adding `@bird-watch/{shared-types,family-mapping}` build steps (mirroring `e2e.yml`).
- **#52 bundled into #65:** PR #75 closed both. Decided during Wave 0.5 round 2 after the bot flagged the ordering risk.
- **#80 z-order follow-up:** PR #79's e2e failed because `sonoran-tucson` painted over sky-island badges (alphabetical region-render order). PR #81 fixed the render order; PR #79 rebased and dropped its `force: true` kludge.

## Wave 1.5 prereqs (one-time, human-completed during execution)

- GCP Workload Identity Federation bootstrap on `bird-maps-prod`:
  - Pool: `github-pool`
  - Provider: `github-provider` (attribute condition `assertion.repository_owner=="julianken"`)
  - SA: `gh-deploy@bird-maps-prod.iam.gserviceaccount.com` with `roles/run.admin`, `roles/artifactregistry.writer`, `roles/iam.serviceAccountUser`
  - `workloadIdentityUser` binding scoped to `principalSet://.../attribute.repository_owner/julianken`
- 5 GitHub Actions secrets set: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `GCP_WIF_PROVIDER`, `GCP_DEPLOY_SA_EMAIL`, `DATABASE_URL` (pooled).

## Outcome

- `bird-maps.com` → 200 ✅
- `api.bird-maps.com/health` → 200 ✅
- All 4 required CI checks (test, lint, build, e2e) green on `main`.
- CD live: any push to `main` touching `frontend/**`, `services/read-api/**`, `services/ingestor/**`, or `migrations/**` now auto-deploys.

## Deferred

- Issue #55 (Phylopic silhouettes) — waiting on human curation of ~15 family silhouettes.
- Issue #57 (`familyCode` refactor) — waiting on design decision between SQL JOIN and client-side lookup.
- Issue #60 (Terraform remote state backend) — new follow-up, not part of original plan.
