# Silhouette Override Admin-API + CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This plan assumes zero prior context for this codebase — every task lists exact file paths, full code, expected commands, and a commit-message template.

**Goal:** Ship a serverless `PUT/DELETE /admin/silhouettes/family/:code` admin-api (Hono on Cloud Run) + an `npm run silhouette set|unset <family> <file>` CLI so an operator can drop in a hand-sourced SVG for any of the 10 families still rendering `_FALLBACK` (per issue #501) — and any future override — without a code change, migration, or production deploy.

**Architecture:** A new `services/admin-api/` Hono service that (a) validates an uploaded SVG, (b) uploads it to a content-hashed key in a new Cloudflare R2 bucket `bird-maps-silhouettes` served by an existing-style public Worker at `silhouettes.bird-maps.com`, (c) updates `family_silhouettes` with BOTH a new `svg_url` column (the CDN-served SVG) AND the extracted path-d in the existing `svg_data` column (load-bearing for the map's SDF sprite registration, which must stay synchronous), and (d) purges only the `/api/silhouettes` JSON envelope from Cloudflare's edge. Bearer-token auth via env, constant-time compare. The CLI is a thin Node fetch wrapper. Read-api stays read-only.

**Tech Stack:** Hono 4 + `@hono/node-server` (mirrors `services/read-api/`), `@aws-sdk/client-s3` against R2 (mirrors `services/ingestor/src/r2/uploader.ts`), `@bird-watch/db-client` (Postgres via `pg`), plain SQL migration via `node-pg-migrate`, Cloudflare Workers (R2 binding, public read) for `silhouettes.bird-maps.com`, Cloud Run v2 + Secret Manager (mirrors `services/read-api/` infra), Cloudflare Terraform provider v5 (matches the rest of `infra/terraform/`), Vitest 4 + `@testcontainers/postgresql` for the new service's integration tests. Node 24 baseline (matches the Dockerfiles).

---

## Background and motivation

After PRs #485, #486, #494, #497, #499, #501 shipped, 10 of 65 `family_silhouettes` rows still render `_FALLBACK` because Phylopic has no usable CC-licensed silhouette for them at family, species, or genus level:

`calcariidae, cuculidae, icteriidae, peucedramidae, polioptilidae, ptiliogonatidae, ptilogonatidae, remizidae, tityridae, vireonidae`

The most user-visible miss is `cuculidae` (Cuckoos & Roadrunners — Greater Roadrunner is iconic for AZ).

Hand-sourcing each as a code-change PR (`migrations/<ts>_seed_family_silhouette_<code>.sql` + a `scripts/curate-phylopic.mjs` edit, mirroring PR #494 for `icteridae`) is unsustainable. Issue #502 asks for an out-of-band path: an operator drops in a hand-drawn or hand-sourced SVG and within ~30 seconds it renders on bird-maps.com across all three silhouette surfaces (FamilyLegend, MapCanvas cluster mosaic + SDF symbol layer, SpeciesDetailSurface). No deploy, no migration, no code change.

### Resolved design decisions (plan invariants — not re-litigated)

These are fixed before this plan is written. Tasks below assume them as given.

1. **New service `services/admin-api/`.** Mirrors `services/read-api/` shape (factory `createApp(deps)`, `src/local.ts` entry, two-stage Dockerfile, npm-workspace build chain). Read-api stays read-only.
2. **Storage: Cloudflare R2** (not GCS). The repo already provisions R2 (`birdwatch-photos`) and an S3-client uploader pattern at `services/ingestor/src/r2/uploader.ts`. Reuse, don't introduce a second object store.
3. **Dual-column schema.** Add nullable `svg_url TEXT` to `family_silhouettes`. Keep the existing nullable `svg_data` (path-d) — it's load-bearing for the map's SDF sprite registration in `frontend/src/components/map/MapCanvas.tsx#registerSilhouetteSprite`, which builds sprites synchronously at map init from the path-d (no `fetch` on the render path). The new `svg_url` powers `<img>`-rendered surfaces (FamilyLegend, SpeciesDetailSurface). DB is the single source of truth for both. Admin-api writes both columns atomically on UPLOAD; DELETE nulls both.
4. **Content-hashed URLs.** Object key is `family/<code>.<sha8>.svg`. The Worker serves `Cache-Control: public, max-age=31536000, immutable` (mirrors `infra/workers/photo-server.js`). No purge needed on the SVG object itself — a re-upload mints a new key. The `/api/silhouettes` JSON envelope still needs a purge after the DB UPDATE; reuse the existing `scripts/purge-silhouettes-cache.sh` semantics inline in the handler.
5. **Two endpoints.**
   - `PUT /admin/silhouettes/family/:code` — multipart `file=<svg>`. Validates → uploads to R2 at content-hashed key → UPDATEs DB (`svg_url` + refreshed `svg_data` extracted from the new SVG) → purges `/api/silhouettes` JSON.
   - `DELETE /admin/silhouettes/family/:code` — removes R2 object → nulls both `svg_url` and `svg_data` (full revert to `_FALLBACK` state — see Q2 in "Open decisions" for the alternative considered).
6. **Auth.** Bearer token via env (`ADMIN_API_TOKEN`), constant-time compare in Hono middleware. New Secret Manager secret `bird-watch-admin-api-token`. Operator runbook: `openssl rand -hex 32` → `gcloud secrets versions add`.
7. **Cloud Run IAM.** `allUsers` invoker + bearer-token gate in middleware. Simpler than `gcloud run services proxy` for a CLI-driven workflow.
8. **npm-aliased CLI.** Root `package.json` script `"silhouette": "node scripts/silhouette.mjs"`. Subcommands `set <family> <file>` and `unset <family>`. Reads `ADMIN_API_URL` + `ADMIN_API_TOKEN` from env; thin fetch wrapper.
9. **Scope.** Family-level overrides only. Species-level overrides are future iteration.
10. **GCS lifecycle.** N/A (R2). R2 versioning: skip — content-hashed keys make versioning redundant.
11. **Frontend change.** `<FamilyLegend>` `SilhouetteGlyph` and `<SpeciesDetailSurface>` `SpeciesDetailSilhouette` prefer `svgUrl` when present (render as `<img src=...>` with the family color applied via CSS filter), fall back to inline path-d. `MapCanvas.tsx#registerSilhouetteSprite` ALWAYS uses path-d (must stay synchronous). Three surfaces, three rules.

### Why R2 (and which R2 bucket)

Two reasonable options for storage location:

**Option A: New bucket `bird-maps-silhouettes`.** Cleaner separation of concerns — silhouettes are SVG vectors with different MIME, different cache semantics in spirit, different lifecycle (operator-curated, not pipeline-generated), and a separate `silhouettes.bird-maps.com` Worker route gives clearer ops visibility. New Terraform: `cloudflare_r2_bucket`, `cloudflare_workers_script`, `cloudflare_workers_route`, `cloudflare_record` (CNAME). One new R2 binding `SILHOUETTES`. Operator runbook: bucket lifecycle is identical to `birdwatch-photos` — `prevent_destroy = true`, public-read via Worker only.

**Option B: Reuse `birdwatch-photos` under a `family/` prefix.** No new infra, no new DNS, no new Worker. Same `photos.bird-maps.com/family/<code>.<sha8>.svg` URL. Photo-server Worker needs a tiny edit to handle the `.svg` extension (`contentTypeFor` returns `image/svg+xml` for `.svg`). One fewer Cloudflare resource to keep alive; one fewer secret-binding lifecycle to track in Terraform.

**Recommendation: Option A (new bucket).** Reasons, in order of weight:

1. **Lifecycle separation.** `birdwatch-photos` is "treat as durable archive" with `prevent_destroy = true` (lines 17-19 of `infra/terraform/photos.tf`) because the photos pipeline is rate-limited iNaturalist re-fetch with months of curation effort. Silhouettes are operator-uploaded and arbitrarily re-runnable from a local SVG file — a `terraform destroy` typo on the silhouettes bucket costs the operator 10 minutes of re-uploading 10 files. Different durability class deserves a different bucket.
2. **Observability.** A separate bucket gives separate R2 metrics (PUT count, GET count, storage cost) without slicing by prefix. For a low-volume bucket (10s of objects, <10 PUTs/year expected), that's a small benefit, but the cost of separation is also small.
3. **CORS / Worker contract divergence risk.** If a future change adds CORS, signed URLs, or a different cache strategy to one of the two object classes, mixing them under one Worker forces a conditional on `pathname.startsWith('family/')`. Two Workers stay simple.

Option A's cost is ~20 lines of new Terraform (one bucket + one Worker script + one route + one DNS record) — cheap. Plan executes Option A. If Julian prefers Option B at review time, the implementer reverts to it by deleting `infra/terraform/silhouettes.tf` + `infra/workers/silhouette-server.js` and editing `infra/workers/photo-server.js` to handle `.svg`. The DB and admin-api code don't change; only the URL prefix the handler writes to `svg_url`.

### Why content-hashed URLs (not mutable URLs + active purge)

`infra/workers/photo-server.js` (lines 13-16) documents the photos pipeline's contract: "If a species photo is replaced (e.g. iNaturalist license change → re-fetch), the new photo is uploaded under a NEW key and the species_photos row is updated to point at it; the old key is never overwritten. That makes hit responses safe to mark `immutable` with a one-year max-age."

The silhouette pipeline adopts the same contract verbatim. The atomic swap is the DB UPDATE pointing at the new URL; old URLs stay cached for as long as they stay cached (no inconsistent window). One fewer Cloudflare API token in the runtime, one fewer failure mode (Cloudflare API outage cannot block an upload). The `/api/silhouettes` JSON envelope still needs a purge after the DB UPDATE because the envelope body contains the new URL — reuse the existing `scripts/purge-silhouettes-cache.sh` semantics inline.

### Why dual-column schema (not URL-only)

The map renderer at `frontend/src/components/map/MapCanvas.tsx#registerSilhouetteSprite` (lines 208–238) builds sprites synchronously at map init via `map.addImage(id, img, { sdf: true })`. The SDF sprite requires the raw `<path d>` to wrap into a 64×64 `<svg viewBox="0 0 24 24">` document (see `silhouettePathToSvg`, lines 185–197). If the column is URL-only, the renderer must `fetch` the SVG, parse the path-d out at sprite-registration time, and only then call `addImage` — adds N async fetches to map init (one per overridden family) and reorders the load chain.

Keeping `svg_data` populated with the extracted path-d preserves the synchronous SDF pipeline. The admin-api extracts the path-d server-side on upload (via the validation step that already parses the SVG) and writes both columns atomically. The map renderer stays unchanged. The legend and detail surfaces, which can comfortably `<img src=...>` an external URL, prefer `svg_url`.

---

## Prototype-gate decision

**The CLAUDE.md prototype gate is satisfied transitively. No new prototype required.**

The gate exists to validate rendering approach at production data volume and viewports before authoring a plan body. The rendering approach for family silhouettes is validated three times over:

1. **SDF sprite pipeline (path-d).** Migration 17000 (epic #251) shipped 22 real Phylopic-curated path-d strings through `registerSilhouetteSprite` → `map.addImage` → the SDF symbol layer at production scale. PR #494 added one more; PRs #497, #499, #501 expanded the corpus to 65 families. The codepath has been live on bird-maps.com since 2026-04-19. This plan adds zero new rendering surfaces on the map side — the admin-api refreshes `svg_data` with an extracted path-d from the new SVG, and `registerSilhouetteSprite` reads it the same way it does today.
2. **Legend glyph (existing).** `FamilyLegend.tsx#SilhouetteGlyph` already renders inline `<path d={...}>` from `svgData` (line 187 of `FamilyLegend.tsx`). The new render path is `<img src={svgUrl}>` with the family color applied via CSS filter — that's a smaller surface than the existing inline SVG renderer (no XML namespacing, no `viewBox`-flipping, no charset validation). Risk surface ≈ "does an `<img>` element render an R2-hosted SVG behind Cloudflare's CDN" — answered yes by `photos.bird-maps.com` serving JPEGs/PNGs/WebPs through `infra/workers/photo-server.js` since #327 landed.
3. **Detail surface.** `SpeciesDetailSurface.tsx#SpeciesDetailSilhouette` is a thin wrapper over the same `FamilySilhouette` ds primitive the legend uses. Same risk surface as #2.

The two new rendering questions are (a) "does CSS filter recolor work on an SVG served as `<img src>`" and (b) "does the SDF sprite extraction round-trip an arbitrary uploaded path-d through `silhouettePathToSvg`'s charset validator without false positives". Both are unit-testable in seconds, and Task 11 below covers them with concrete tests. Neither needs the 2–4-hour Vite-canned-JSON prototype the gate normally requires.

The Playwright MCP UI verification at Task 13 is still mandatory — that's a per-PR UI smoke gate (`CLAUDE.md > Testing > UI verification`), not the plan-body prototype gate. It catches console drift and layout breakage at the canonical viewport set, both of which a unit test can't.

---

## Conventions baked in

- **TDD per task.** Every code-producing task follows: write failing test → confirm failure → write minimal implementation → confirm pass → commit. No batching.
- **No DB mocks.** Tests against `family_silhouettes` run against real Postgres via `@testcontainers/postgresql`, per CLAUDE.md's "no DB mocks" rule. The admin-api's R2 client is mocked via the AWS SDK's middleware stack (see Task 7); R2 itself is not in the test loop.
- **Plain SQL migrations** under `migrations/` with `-- Up Migration` / `-- Down Migration` markers. `node-pg-migrate` sorts by filename.
- **Conventional commits.** Each task lists `feat(admin-api):` / `chore(scripts):` / `infra(terraform):` / `test(admin-api):` / `docs(plans):` / `fix(migrations):` / `feat(frontend):` etc.
- **Frontend changes follow the canonical-viewport-set protocol** (5 viewports × 2 themes = ≥10 screenshots, dispatched to `ui-design:ui-designer` subagent per CLAUDE.md's design-review contract).
- **Use context7 for `hono` and the `hashicorp/google` + `cloudflare/cloudflare` Terraform providers** before writing the relevant tasks (CLAUDE.md `Use context7` table). Skip context7 for `@aws-sdk/client-s3` (the existing `services/ingestor/src/r2/uploader.ts` is the authoritative example), `pg`, `vitest`, and `@playwright/test`.

---

## File structure

| Path | Disposition | Responsibility |
|---|---|---|
| `migrations/1700000037000_add_svg_url_to_family_silhouettes.sql` | Create | `ALTER TABLE family_silhouettes ADD COLUMN svg_url TEXT NULL;` Down: `DROP COLUMN svg_url`. Number slot reserved against the 36000 floor (last landed: `1700000036000_rescue_null_silhouettes_via_species.sql`). |
| `packages/db-client/src/silhouettes.ts` | Modify | Add `svg_url` to SELECT + projection; map to `svgUrl` in the return type. |
| `packages/db-client/src/silhouettes.test.ts` | Modify | Snapshot row count stays 65; new `svgUrl: null` field added to every row's projection assertion. |
| `packages/shared-types/src/index.ts` | Modify | Add `svgUrl: string \| null` to `FamilySilhouette` (mirrors the `svgData` field comment style). |
| `services/admin-api/package.json` | Create | New npm workspace `@bird-watch/admin-api`. |
| `services/admin-api/tsconfig.json` | Create | Mirrors `services/read-api/tsconfig.json`. |
| `services/admin-api/tsconfig.test.json` | Create | Mirrors `services/read-api/tsconfig.test.json`. |
| `services/admin-api/vitest.config.ts` | Create | Mirrors `services/read-api/vitest.config.ts`. |
| `services/admin-api/src/app.ts` | Create | `createApp(deps)` factory. Bearer-token middleware on `/admin/*`. Two routes plus `/health`. Wires `pool`, `storage` (R2 uploader), `purger` (CF cache purge), `now` (Date), `randomBytes` (for content-hash salt — actually pure SHA-256 of file body). |
| `services/admin-api/src/app.test.ts` | Create | Integration tests against testcontainers Postgres + mocked R2 client. Covers: missing token → 401, wrong token → 401, valid token + good SVG → 200 + DB updated, valid token + malicious SVG → 400, DELETE happy path → 200 + DB nulled, DELETE on already-null row → 200 idempotent. |
| `services/admin-api/src/local.ts` | Create | Node server entry, mirrors `services/read-api/src/local.ts`. |
| `services/admin-api/src/auth.ts` | Create | Constant-time bearer-token middleware (`timingSafeEqual`). |
| `services/admin-api/src/auth.test.ts` | Create | Unit tests for the middleware: missing header → 401, wrong scheme → 401, wrong token → 401 (verifies constant-time path runs), right token → next() called. |
| `services/admin-api/src/validate.ts` | Create | SVG validation: parse, require single `<svg>` root with single `<path>` child, extract `d` attribute, reject `<script>` / `<style>` / `xlink:href` / `onload=*` / embedded fonts / size > 64 KB / viewBox outside 0..24 (allow with warning if absent — Phylopic norm) / charset failures via the existing `isValidSvgPathData` (moved to a shared util). |
| `services/admin-api/src/validate.test.ts` | Create | Unit tests: happy path (Phylopic-style minimal SVG) → success; `<script>` → reject; multiple paths → reject; oversize → reject; bad charset in path-d → reject. |
| `services/admin-api/src/storage.ts` | Create | Thin S3-client wrapper. `putSilhouette(code, body) → { url, key }` PUTs at `family/<code>.<sha8>.svg`, returns the public URL. `deleteSilhouette(key)` DELETEs by key. Reads `R2_ENDPOINT`, `R2_BUCKET_NAME`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` from env (matches the ingestor's pattern). |
| `services/admin-api/src/storage.test.ts` | Create | Unit tests using the AWS SDK v3 `mockClient` from `aws-sdk-client-mock` — verifies the PUT command has the right Bucket / Key / ContentType / Body. |
| `services/admin-api/src/purge.ts` | Create | Cloudflare cache purge by URL. Reads `CLOUDFLARE_ZONE_ID` + `CLOUDFLARE_API_TOKEN`. Returns success/failure. Logs but does not throw on failure (purge is best-effort; the DB write is authoritative). |
| `services/admin-api/src/purge.test.ts` | Create | Unit tests using `vi.spyOn(global, 'fetch')` — verifies the URL, payload, and auth header. |
| `services/admin-api/src/extract-path-d.ts` | Create | Pure function: input string SVG → output `{ pathD: string }`. Uses a minimal regex-based extractor mirroring `scripts/curate-phylopic.mjs#extractPathD` (the validation step has already enforced the single-`<path>` shape, so the extractor doesn't need to handle multi-path SVGs). |
| `services/admin-api/src/extract-path-d.test.ts` | Create | Unit tests against the Phylopic-shaped SVGs already in production via `scripts/phylopic-picks.json` (use a handful of real examples as fixtures). |
| `services/admin-api/Dockerfile` | Create | Two-stage, mirrors `services/read-api/Dockerfile`. |
| `services/admin-api/.dockerignore` | Create | Mirrors `services/read-api/.dockerignore` if one exists, otherwise standard `node_modules`, `dist`, `coverage`. |
| `scripts/silhouette.mjs` | Create | Node ESM CLI, `set <family> <file>` and `unset <family>` subcommands. Reads `ADMIN_API_URL` + `ADMIN_API_TOKEN` from `process.env`. Uses `fs.readFile`, `FormData`, `fetch`. Prints success + the new URL. |
| `package.json` | Modify | Add `"silhouette": "node scripts/silhouette.mjs"` to root scripts (mirrors `"curate:phylopic": "node scripts/curate-phylopic.mjs"`). |
| `infra/terraform/silhouettes.tf` | Create | `cloudflare_r2_bucket "silhouettes"` (`bird-maps-silhouettes`, location WNAM, `prevent_destroy = false` — see "Why R2" §A). `cloudflare_workers_script "silhouette_server"` bound to the bucket. `cloudflare_workers_route "silhouettes"` for `silhouettes.${var.domain}/*`. `cloudflare_record "silhouettes"` CNAME → `${var.domain}` proxied. |
| `infra/workers/silhouette-server.js` | Create | Clone of `infra/workers/photo-server.js` retargeted at the silhouettes binding. `contentTypeFor` returns `image/svg+xml` for `.svg`, falls through to octet-stream. Same cache headers as photo-server (immutable on hit, 60s on miss). |
| `infra/workers/silhouette-server.test.js` | Create | Mirrors `infra/workers/photo-server.test.js`. |
| `infra/terraform/admin-api.tf` | Create | Secret Manager secret `bird-watch-admin-api-token`. Service account `bird-admin-api`. `google_cloud_run_v2_service "admin_api"` (mirrors `read-api.tf` shape — image pinned, `ignore_changes` on image tag, scale to zero). IAM bindings: invoker `allUsers`, secret-accessor for `admin_api_token` + `db_url` + new R2 credential secrets + CF zone/token. New env vars: `DATABASE_URL`, `ADMIN_API_TOKEN`, `R2_ENDPOINT`, `R2_BUCKET_NAME`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `CLOUDFLARE_ZONE_ID`, `CLOUDFLARE_API_TOKEN`, `API_HOST` (=`api.bird-maps.com` — for the purge URL). |
| `infra/terraform/variables.tf` | Modify | Add `variable "r2_access_key_id"` + `variable "r2_secret_access_key"` (sensitive) if not already present. Verify against existing variables — the ingestor already wires R2; these may exist. |
| `.github/workflows/deploy-admin-api.yml` | Create | Clone of `deploy-read-api.yml` with `services/admin-api/**` path filter, `bird-admin-api` service name, `admin-api` image name. |
| `frontend/src/components/ds/FamilySilhouette.tsx` | Modify | Accept new `imgUrl?: string \| null` prop. When present, render `<img src={imgUrl}>` with `style={{ filter: \`brightness(0) saturate(100%) ${tintFor(color)}\` }}` — actually use a CSS variable + masking technique (see Task 11 for the exact technique). When absent, fall back to the existing inline-path-d render. |
| `frontend/src/components/ds/FamilySilhouette.test.tsx` | Modify | Add tests for `imgUrl` precedence: when both are present, prefer `imgUrl`; when only `pathD` is present, fall back to existing path. Asserts on rendered DOM shape. |
| `frontend/src/components/FamilyLegend.tsx` | Modify | Pass `imgUrl={entry.silhouette.svgUrl}` to `<FamilySilhouette>`. |
| `frontend/src/components/SpeciesDetailSurface.tsx` | Modify | Pass `imgUrl` for the masthead silhouette. |
| `frontend/src/styles.css` (or `ds-primitives.css`) | Modify | Add CSS class `family-silhouette-img` with the SVG-mask + `background-color` recolor technique (see Task 11). |
| `docs/runbooks/silhouette-override.md` | Create | Operator runbook: prerequisites (`ADMIN_API_URL`, `ADMIN_API_TOKEN` in env), `openssl rand -hex 32` for rotation, `npm run silhouette set cuculidae ./roadrunner.svg` example, expected within-30s render, troubleshooting (purge failure → JSON envelope stale → wait 7d or run `scripts/purge-silhouettes-cache.sh`). |
| `docs/plans/2026-05-13-silhouette-admin-api.md` | Create | This plan. |

The migration filename uses `1700000037000_` so it sorts strictly after the post-#501 numbering (last landed: `1700000036000_rescue_null_silhouettes_via_species.sql`). If a new migration lands on `main` between this plan's authoring and its execution, the implementer bumps to the next free slot and updates Task 1 references accordingly.

---

## Open decisions (require Julian sign-off before execution)

These are intentionally surfaced rather than resolved in the plan — they're forks that change shape, not implementation detail.

### D1. R2 bucket: new `bird-maps-silhouettes` or reuse `birdwatch-photos` under `family/` prefix?

**Recommendation: new bucket** (Option A, argued in "Why R2 (and which R2 bucket)" above). Different durability class (`prevent_destroy = false` for silhouettes vs `true` for photos), separate metrics, no Worker conditional. ~20 lines of new Terraform. If Julian prefers Option B, the implementer deletes `infra/terraform/silhouettes.tf` + `infra/workers/silhouette-server.js`, edits `infra/workers/photo-server.js` to handle `.svg`, and `admin-api/src/storage.ts` writes to `photos.bird-maps.com/family/<code>.<sha8>.svg`.

### D2. DELETE semantics: full revert (svg_url=NULL + svg_data=NULL → `_FALLBACK`) or partial revert (svg_url=NULL only, restore the pre-override `svg_data`)?

**Recommendation: full revert.** Simpler. If the original was a Phylopic-curated path-d, the operator can re-curate via the existing pipeline (`npm run curate:phylopic`). Partial revert would require either (a) storing the "original" path-d in a third column (`svg_data_original TEXT NULL`) or (b) re-running curation against the family code on DELETE — both substantially more complex for a 10-call-per-year endpoint. The DELETE returns the row to `_FALLBACK` state, which is the worst-case rendering and the same state the row is in today. No regression.

If Julian prefers partial revert: the schema migration adds `svg_data_original TEXT NULL` instead of just touching `svg_url`. On UPLOAD, the admin-api copies the existing `svg_data` into `svg_data_original` (only if `svg_data_original IS NULL`, i.e. first override). On DELETE, the admin-api restores `svg_data = svg_data_original` and `NULL`s `svg_data_original` so the next upload reseeds it. This is a 3-line change in the admin-api handler and one extra column in the migration — but it crosses a conceptual boundary (the DB is no longer pure source-of-truth; it now has an "override layer"). Recommend deferring to a future iteration if needed.

### D3. SVG validation depth: parse-only, or enforce single-`<path>` + 0..24 viewBox + extract path-d for the cached `svg_data` column?

**Recommendation: full enforcement.** The rendering pipeline assumes single-path 0..24 viewBox SVGs (the SDF sprite wrapper at `silhouettePathToSvg` lines 185–197 hardcodes `viewBox="0 0 24 24"` and embeds the path-d directly into a wrapper). Accepting anything else would silently break the SDF render. Validation must:

1. Parse as valid XML (no XXE; use a parser with entity-expansion disabled).
2. Require a single `<svg>` root element.
3. Require exactly one `<path>` child; reject if multiple, reject if any non-`<path>` child (no `<g>`, no `<style>`, no `<script>`, no `<defs>`, no `<use>`).
4. Reject any attribute starting with `on` (onload, onclick, etc).
5. Reject `xlink:href` (SVG-1.1 link form, can reference external content).
6. Reject `<style>` / `<script>` text content (closed by #3 above but defense in depth).
7. Require the `d` attribute on the path; charset-check it via the moved `isValidSvgPathData`.
8. Require `viewBox` if present to be `0 0 24 24` or absent (Phylopic norm — most don't carry one).
9. Cap source body at 64 KB pre-parse (defends against parser DoS).
10. The extracted path-d goes into `svg_data`. The full source SVG (post-validation, unmodified bytes) goes to R2.

A future revision could relax (8) and re-write the viewBox on upload — out of scope for this plan.

### D4. CDN purge in the upload handler: synchronous wait, or fire-and-forget?

**Recommendation: synchronous wait, with a 5-second timeout and best-effort logging.** The acceptance criterion is "within ~30s a hard-reload of bird-maps.com renders the new silhouette." If the purge is fire-and-forget and the API call fails silently, the operator sees a success response and waits up to 7 days for the cache to expire (current `Cache-Control` on `/api/silhouettes`). Synchronous wait + log-on-failure means the operator gets a 200 OK on full success and a 200 OK with a warning header (`X-Purge-Status: failed`) on partial success — the DB write succeeded, but the JSON envelope is still cached. Operator runbook tells them to run `scripts/purge-silhouettes-cache.sh` manually as a fallback.

The 5s timeout is below the Cloud Run request timeout (default 5 min, easy headroom). Best-effort logging means the handler doesn't throw on purge failure — the DB is authoritative and the operator can always re-purge.

### D5. Test infrastructure for the admin-api: testcontainers Postgres + AWS SDK mocked R2 (LocalStack), or testcontainers Postgres + real R2 staging bucket?

**Recommendation: testcontainers Postgres + AWS SDK mocked R2 via `aws-sdk-client-mock`.** Three reasons:

1. CLAUDE.md "no DB mocks" rule applies to the database, not to external object stores. The ingestor's R2 tests at `services/ingestor/src/r2/uploader.test.ts` use SDK mocks today; this is consistent.
2. A real R2 staging bucket adds a CI secret (`R2_ACCESS_KEY_ID_STAGING` + `R2_SECRET_ACCESS_KEY_STAGING`) and a network dependency. The current `test` workflow has no R2 secrets wired; adding them is a separable infra change.
3. LocalStack supports R2's S3-compat shape but adds a service-startup cost (~10–30s per test run) — measurable on the CI matrix. The SDK mock has zero startup cost.

Trade-off: SDK mocks don't catch protocol-level bugs (wrong region, malformed signature, etc). Mitigation: the ingestor's R2 path has been live in production for 4 months without protocol bugs, the admin-api reuses the same `S3Client` config shape, and Task 13's manual end-to-end test (operator runs `npm run silhouette set cuculidae ./test.svg` against the deployed admin-api) catches anything the SDK mock missed.

---

## Critical-path checkpoints

The tasks below are ordered to keep CI green at every commit (per the "plan task boundaries must respect CI gates" memory). Each task either lands a fully-green PR or extends a working-tree branch in a way that the CI gate (test, lint, build, e2e) continues to pass against `main`.

1. **Schema migration** (Task 1). Adds the nullable column, no consumers yet. CI green.
2. **DB-client projection** (Task 2). Reads the new column, projects it as `svgUrl: null` for all rows. Downstream tests update. CI green.
3. **Shared types** (Task 3). Add `svgUrl` to `FamilySilhouette`. Frontend doesn't consume yet (still works because field is optional-via-`| null`). CI green.
4. **New service scaffolding** (Tasks 4–10). The `services/admin-api/` workspace builds, tests, lints. Not yet wired to Terraform — no deploy attempted. CI green.
5. **CLI** (Task 11). Pure Node script + root-package.json entry. CI green.
6. **Frontend consumes svgUrl** (Task 12). Falls back to path-d when `svgUrl` is null (all current rows). E2E green. UI smoke at canonical viewports.
7. **Terraform + Worker + deploy workflow** (Task 13). Infra lands. Cloud Run service deploys on push-to-main. First end-to-end test against deployed admin-api.
8. **Runbook + acceptance** (Task 14). Docs ship. PR opens.

Critical path: Tasks 1 → 2 → 3 can land as one small PR (`db-foundation`); Tasks 4–10 land as one feature PR (`admin-api-service`); Task 11 as a thin PR (`cli`); Task 12 as a frontend PR (`frontend-consumes-svg-url`); Task 13 as an infra PR (`infra-deploy`); Task 14 piggybacks on Task 13's PR or lands as a separate docs PR. Five PRs total is the recommended split; the plan body below describes them as one continuous task list and the implementer chooses the split point.

---

## Spec reference

- Issue #502 (this plan's parent): `gh issue view 502 --repo julianken/bird-sight-system`
- Issue #501 (most recent ancestor): the rescue-via-species pipeline that left 10 families still in `_FALLBACK` — see PR #501 body for the post-rescue audit.
- Existing patterns:
  - Read-api shape: `services/read-api/src/{app.ts,local.ts}`, `services/read-api/Dockerfile`, `services/read-api/package.json`
  - R2 uploader pattern: `services/ingestor/src/r2/uploader.ts` + `services/ingestor/src/r2/uploader.test.ts`
  - Worker pattern: `infra/workers/photo-server.js` + `infra/workers/photo-server.test.js` + `infra/terraform/photos.tf`
  - CF cache purge: `scripts/purge-silhouettes-cache.sh` + the inline purge in `services/ingestor/src/run-descriptions.ts`
  - Deploy workflow: `.github/workflows/deploy-read-api.yml`
  - Map SDF pipeline: `frontend/src/components/map/MapCanvas.tsx` lines 175–238
  - PR template: `.github/PULL_REQUEST_TEMPLATE.md`
  - PR workflow protocol: `.claude/skills/pr-workflow/SKILL.md`
  - Canonical viewports: `CLAUDE.md` `Testing > UI verification`

---

## Task 1: Migration — add `svg_url` column

**Files:**
- Create: `migrations/1700000037000_add_svg_url_to_family_silhouettes.sql`
- Test: `packages/db-client/src/migrations-down-chain.test.ts` (update one count assertion if applicable; see Step 4)

- [ ] **Step 1: Write the migration.**

```sql
-- Up Migration

-- Issue #502. Adds a nullable URL column for admin-api-uploaded silhouettes.
-- The existing svg_data column (path-d, single-path 0..24 viewBox) stays
-- load-bearing for the map's synchronous SDF sprite registration
-- (frontend/src/components/map/MapCanvas.tsx#registerSilhouetteSprite).
-- The new svg_url column powers <img>-rendered legend / detail surfaces and
-- is what the admin-api PUT endpoint writes alongside an extracted path-d
-- copy in svg_data. NULL is the steady state for rows that haven't been
-- overridden via the admin-api (all 65 current rows). DELETE via the
-- admin-api nulls both svg_url and svg_data (full revert; see D2 in
-- docs/plans/2026-05-13-silhouette-admin-api.md).

ALTER TABLE family_silhouettes ADD COLUMN svg_url TEXT NULL;

-- Down Migration

ALTER TABLE family_silhouettes DROP COLUMN svg_url;
```

- [ ] **Step 2: Run the migration locally.**

```bash
npm run db:up
npm run db:migrate
psql "postgres://postgres:postgres@localhost:5432/postgres" -c "\d family_silhouettes"
```

Expected: the `\d` output lists a new `svg_url | text |` column. Re-run is idempotent (the migration script tracks applied migrations).

- [ ] **Step 3: Verify rollback.**

```bash
npm run db:rollback
psql "postgres://postgres:postgres@localhost:5432/postgres" -c "\d family_silhouettes"
npm run db:migrate
```

Expected: after `db:rollback`, `svg_url` is absent; after re-`db:migrate`, it's back. No errors.

- [ ] **Step 4: Check `migrations-down-chain.test.ts` count assertions.**

```bash
cd packages/db-client
grep -n "toBe(" src/migrations-down-chain.test.ts
```

The down-chain test exercises Down(14000→17000); migration 37000 is post-17000 so its rows (zero new rows — this is a schema-only migration) don't affect the post-Down-15000 baseline or the re-Up assertion. No change needed.

Run to confirm:

```bash
npx vitest run src/migrations-down-chain.test.ts
```

Expected: all tests PASS (the new ALTER doesn't affect row counts).

- [ ] **Step 5: Commit.**

```bash
git add migrations/1700000037000_add_svg_url_to_family_silhouettes.sql
git commit -m "fix(migrations): add nullable svg_url column to family_silhouettes (#502)

The existing svg_data (path-d) column stays load-bearing for the map's
synchronous SDF sprite pipeline. The new svg_url column powers
<img>-rendered legend / detail surfaces and is the column the admin-api
PUT/DELETE endpoints write.

Refs #502"
```

---

## Task 2: db-client — project `svg_url` as `svgUrl`

**Files:**
- Modify: `packages/db-client/src/silhouettes.ts`
- Modify: `packages/db-client/src/silhouettes.test.ts`

- [ ] **Step 1: Write the failing test.**

Edit `packages/db-client/src/silhouettes.test.ts`. Find the existing parity-snapshot test (the one whose assertion is `expect(rows).toHaveLength(65)` per CLAUDE.md task expectations) and the projection assertion that checks each row's fields. Extend each row's expected shape with `svgUrl: null`.

Run before code change to confirm failure:

```bash
cd packages/db-client
npx vitest run src/silhouettes.test.ts
```

Expected: FAIL with something like `Expected svgUrl: null, got undefined` for every row.

- [ ] **Step 2: Update the SELECT and the projection.**

Replace `packages/db-client/src/silhouettes.ts` with:

```ts
import type { Pool } from './pool.js';
import type { FamilySilhouette } from '@bird-watch/shared-types';

/**
 * Fetch every row from `family_silhouettes`. This table is the single source
 * of truth for family → color mapping in the system (issue #55 option (a)).
 * The legacy hardcoded `FAMILY_TO_COLOR` map that previously colocated
 * family-code → color in a separate helper workspace was deleted when
 * this endpoint landed — callers now read color from the DB via the
 * Read API's `/api/silhouettes` route.
 *
 * Rows are returned ordered by family_code so consumers (e.g. parity tests,
 * deterministic snapshots) don't depend on Postgres heap order.
 *
 * svgUrl (issue #502) is the admin-api-uploaded CDN-served SVG URL; NULL for
 * rows that haven't been overridden via the admin-api. svgData remains the
 * load-bearing path-d for the map's synchronous SDF sprite pipeline; the
 * admin-api writes both atomically on upload.
 */
export async function getSilhouettes(pool: Pool): Promise<FamilySilhouette[]> {
  const { rows } = await pool.query<{
    family_code: string;
    color: string;
    svg_data: string | null;
    svg_url: string | null;
    source: string | null;
    license: string | null;
    common_name: string | null;
    creator: string | null;
  }>(
    `SELECT family_code, color, svg_data, svg_url, source, license, common_name, creator
     FROM family_silhouettes
     ORDER BY family_code`
  );
  return rows.map(r => ({
    familyCode: r.family_code,
    color: r.color,
    svgData: r.svg_data,
    svgUrl: r.svg_url,
    source: r.source,
    license: r.license,
    commonName: r.common_name,
    creator: r.creator,
  }));
}
```

- [ ] **Step 3: Run the test.**

```bash
cd packages/db-client
npx vitest run src/silhouettes.test.ts
```

Expected: PASS.

- [ ] **Step 4: Run the read-api tests (downstream parity).**

```bash
cd ../../services/read-api
npx vitest run src/app.test.ts
```

Expected: PASS. The `/api/silhouettes` route's assertion is row count + projection; the new field rides through transparently because `JSON.stringify(null)` → `"null"` is preserved and consumers (if any) accept the extra property.

- [ ] **Step 5: Commit.**

```bash
git add packages/db-client/src/silhouettes.ts packages/db-client/src/silhouettes.test.ts
git commit -m "feat(db-client): project family_silhouettes.svg_url as svgUrl (#502)

Refs #502"
```

---

## Task 3: shared-types — add `svgUrl` to `FamilySilhouette`

**Files:**
- Modify: `packages/shared-types/src/index.ts`

- [ ] **Step 1: Edit the `FamilySilhouette` interface.**

In `packages/shared-types/src/index.ts`, find:

```ts
export interface FamilySilhouette {
  familyCode: string;
  color: string;
  // …
  svgData: string | null;
  source: string | null;
  license: string | null;
  commonName: string | null;
  creator: string | null;
}
```

Add the `svgUrl` field directly after `svgData`:

```ts
  svgData: string | null;
  // svgUrl (issue #502) is the admin-api-uploaded CDN-served SVG URL. NULL
  // for rows that haven't been overridden via the admin-api. Consumers
  // that render the silhouette as an <img> (FamilyLegend's SilhouetteGlyph,
  // SpeciesDetailSurface's SpeciesDetailSilhouette) prefer svgUrl when
  // non-null and fall back to inline path-d (svgData) when null. The map's
  // SDF sprite pipeline (MapCanvas#registerSilhouetteSprite) ALWAYS uses
  // svgData and ignores svgUrl — sprite registration is synchronous at
  // map init and an external URL would require N async fetches.
  svgUrl: string | null;
  source: string | null;
```

- [ ] **Step 2: Build.**

```bash
cd packages/shared-types
npm run build
```

Expected: clean build. `dist/index.d.ts` now exports the new field.

- [ ] **Step 3: Typecheck the whole tree.**

```bash
cd ../..
npm run build -w @bird-watch/shared-types
npm run build -w @bird-watch/db-client
npm run build -w @bird-watch/read-api
npm run build -w @bird-watch/frontend
```

Expected: all four builds clean. The frontend doesn't consume `svgUrl` yet (Task 12) but the type system tolerates the new optional-via-`| null` field on all existing call sites because every consumer destructures by name.

- [ ] **Step 4: Commit.**

```bash
git add packages/shared-types/src/index.ts
git commit -m "feat(shared-types): add svgUrl to FamilySilhouette (#502)

Refs #502"
```

---

## Task 4: Scaffold `services/admin-api/` workspace

**Files:**
- Create: `services/admin-api/package.json`, `tsconfig.json`, `tsconfig.test.json`, `vitest.config.ts`

- [ ] **Step 1: Create `services/admin-api/package.json`.**

```json
{
  "name": "@bird-watch/admin-api",
  "version": "0.0.1",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "dev": "tsx src/local.ts"
  },
  "dependencies": {
    "@aws-sdk/client-s3": "^3.682.0",
    "@bird-watch/db-client": "*",
    "@bird-watch/shared-types": "*",
    "@hono/node-server": "^2.0.1",
    "hono": "^4.12.16"
  },
  "devDependencies": {
    "@testcontainers/postgresql": "^10.7.0",
    "aws-sdk-client-mock": "^4.0.0",
    "testcontainers": "^11.14.0",
    "tsx": "^4.7.0",
    "vitest": "^4.1.5"
  }
}
```

Note: `@aws-sdk/client-s3` version matches the ingestor workspace's pin — verify by running `grep '"@aws-sdk/client-s3"' services/ingestor/package.json` and copy the version range. `aws-sdk-client-mock` is a new dev dep; verify it isn't already in the root or any workspace and add it here.

- [ ] **Step 2: Create `services/admin-api/tsconfig.json`.**

Mirror `services/read-api/tsconfig.json` verbatim. Use:

```bash
cp services/read-api/tsconfig.json services/admin-api/tsconfig.json
cp services/read-api/tsconfig.test.json services/admin-api/tsconfig.test.json
cp services/read-api/vitest.config.ts services/admin-api/vitest.config.ts
```

Verify each file references no read-api-specific paths (look for `read-api` strings inside; if found, edit to `admin-api`).

- [ ] **Step 3: Install workspace deps.**

```bash
npm install
```

Expected: `package-lock.json` updates with the new workspace entries. `node_modules/@bird-watch/admin-api` is symlinked.

- [ ] **Step 4: Verify the workspace builds (no source yet → build is a no-op or errors clean).**

```bash
npm run build --workspace @bird-watch/admin-api
```

Expected: error like `error TS18003: No inputs were found in config file` — that's fine, no source yet. Task 5 adds source.

- [ ] **Step 5: Commit.**

```bash
git add services/admin-api/ package.json package-lock.json
git commit -m "feat(admin-api): scaffold @bird-watch/admin-api workspace (#502)

Mirrors @bird-watch/read-api shape (Hono + node-server + testcontainers).
New deps: @aws-sdk/client-s3 (matches ingestor's R2 client pin) +
aws-sdk-client-mock (devDep, for unit-testing S3 calls). No source yet;
Task 5+ add the app factory, routes, and tests.

Refs #502"
```

---

## Task 5: Auth middleware (bearer-token, constant-time compare)

**Files:**
- Create: `services/admin-api/src/auth.ts`
- Create: `services/admin-api/src/auth.test.ts`

- [ ] **Step 1: Write the failing test.**

```ts
// services/admin-api/src/auth.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { bearerAuth } from './auth.js';

describe('bearerAuth middleware', () => {
  let app: Hono;
  const TOKEN = 'test-token-do-not-leak';

  beforeEach(() => {
    app = new Hono();
    app.use('/admin/*', bearerAuth(TOKEN));
    app.get('/admin/ping', c => c.json({ ok: true }));
  });

  it('returns 401 when Authorization header is missing', async () => {
    const res = await app.request('/admin/ping');
    expect(res.status).toBe(401);
  });

  it('returns 401 when scheme is not Bearer', async () => {
    const res = await app.request('/admin/ping', {
      headers: { Authorization: `Basic ${TOKEN}` },
    });
    expect(res.status).toBe(401);
  });

  it('returns 401 when token is wrong', async () => {
    const res = await app.request('/admin/ping', {
      headers: { Authorization: 'Bearer wrong-token' },
    });
    expect(res.status).toBe(401);
  });

  it('returns 401 when token length differs (timing-safe-equal guard)', async () => {
    const res = await app.request('/admin/ping', {
      headers: { Authorization: 'Bearer x' },
    });
    expect(res.status).toBe(401);
  });

  it('returns 200 when token matches', async () => {
    const res = await app.request('/admin/ping', {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it('throws at construction time if token is empty', () => {
    expect(() => bearerAuth('')).toThrow(/ADMIN_API_TOKEN/);
  });
});
```

Run:

```bash
cd services/admin-api
npx vitest run src/auth.test.ts
```

Expected: FAIL with `Cannot find module './auth.js'`.

- [ ] **Step 2: Implement `auth.ts`.**

```ts
// services/admin-api/src/auth.ts
import { timingSafeEqual } from 'node:crypto';
import type { MiddlewareHandler } from 'hono';

/**
 * Bearer-token middleware. Compares the request's `Authorization: Bearer
 * <token>` header against `expected` in constant time (Node's
 * `timingSafeEqual`). The constant-time compare requires equal-length
 * buffers; we guard the length check before calling so a length-mismatch
 * is a fast 401 rather than a thrown range-check error from the crypto
 * module.
 *
 * Throws at construction time if `expected` is empty — empty token would
 * silently accept all requests carrying any non-empty Bearer header.
 * Cloud Run's env-from-secret wiring delivers a non-empty string when the
 * secret version exists, so an empty string here means the secret is
 * unbound (deploy misconfiguration); fail fast at boot rather than ship
 * an open endpoint.
 */
export function bearerAuth(expected: string): MiddlewareHandler {
  if (expected.length === 0) {
    throw new Error('ADMIN_API_TOKEN is empty; refusing to bind admin routes');
  }
  const expectedBuf = Buffer.from(expected, 'utf8');
  return async (c, next) => {
    const header = c.req.header('Authorization') ?? '';
    if (!header.startsWith('Bearer ')) {
      return c.json({ error: 'unauthorized' }, 401);
    }
    const got = header.slice('Bearer '.length);
    const gotBuf = Buffer.from(got, 'utf8');
    if (gotBuf.length !== expectedBuf.length) {
      return c.json({ error: 'unauthorized' }, 401);
    }
    if (!timingSafeEqual(gotBuf, expectedBuf)) {
      return c.json({ error: 'unauthorized' }, 401);
    }
    await next();
    return;
  };
}
```

- [ ] **Step 3: Run the test.**

```bash
npx vitest run src/auth.test.ts
```

Expected: PASS (6 tests).

- [ ] **Step 4: Commit.**

```bash
git add services/admin-api/src/auth.ts services/admin-api/src/auth.test.ts
git commit -m "feat(admin-api): bearer-token middleware with constant-time compare (#502)

Refs #502"
```

---

## Task 6: SVG validation + path-d extraction

**Files:**
- Create: `services/admin-api/src/validate.ts`
- Create: `services/admin-api/src/validate.test.ts`
- Create: `services/admin-api/src/extract-path-d.ts`
- Create: `services/admin-api/src/extract-path-d.test.ts`

- [ ] **Step 1: Write the failing test for `validate.ts`.**

```ts
// services/admin-api/src/validate.test.ts
import { describe, it, expect } from 'vitest';
import { validateSvg, ValidationError } from './validate.js';

const VALID_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M12 2 L20 22 L4 22 Z"/></svg>`;

describe('validateSvg', () => {
  it('accepts a minimal single-path 0..24 viewBox SVG', () => {
    const result = validateSvg(Buffer.from(VALID_SVG, 'utf8'));
    expect(result.pathD).toBe('M12 2 L20 22 L4 22 Z');
  });

  it('accepts a single-path SVG without an explicit viewBox', () => {
    const noViewBox = `<svg xmlns="http://www.w3.org/2000/svg"><path d="M1 1 L2 2"/></svg>`;
    const result = validateSvg(Buffer.from(noViewBox, 'utf8'));
    expect(result.pathD).toBe('M1 1 L2 2');
  });

  it('rejects an SVG with <script>', () => {
    const malicious = `<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><path d="M1 1"/></svg>`;
    expect(() => validateSvg(Buffer.from(malicious, 'utf8'))).toThrow(ValidationError);
  });

  it('rejects an SVG with multiple <path> elements', () => {
    const multi = `<svg xmlns="http://www.w3.org/2000/svg"><path d="M1 1"/><path d="M2 2"/></svg>`;
    expect(() => validateSvg(Buffer.from(multi, 'utf8'))).toThrow(ValidationError);
  });

  it('rejects an SVG with <g>', () => {
    const grouped = `<svg xmlns="http://www.w3.org/2000/svg"><g><path d="M1 1"/></g></svg>`;
    expect(() => validateSvg(Buffer.from(grouped, 'utf8'))).toThrow(ValidationError);
  });

  it('rejects an SVG with an onload attribute', () => {
    const evil = `<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><path d="M1 1"/></svg>`;
    expect(() => validateSvg(Buffer.from(evil, 'utf8'))).toThrow(ValidationError);
  });

  it('rejects an SVG with xlink:href', () => {
    const linked = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><path xlink:href="x" d="M1 1"/></svg>`;
    expect(() => validateSvg(Buffer.from(linked, 'utf8'))).toThrow(ValidationError);
  });

  it('rejects an SVG with a non-{0 0 24 24} viewBox', () => {
    const wide = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M1 1"/></svg>`;
    expect(() => validateSvg(Buffer.from(wide, 'utf8'))).toThrow(ValidationError);
  });

  it('rejects an SVG with no <path>', () => {
    const empty = `<svg xmlns="http://www.w3.org/2000/svg"/>`;
    expect(() => validateSvg(Buffer.from(empty, 'utf8'))).toThrow(ValidationError);
  });

  it('rejects a path with an unsafe character in d (charset failure)', () => {
    const bad = `<svg xmlns="http://www.w3.org/2000/svg"><path d="M1 1<script>"/></svg>`;
    expect(() => validateSvg(Buffer.from(bad, 'utf8'))).toThrow(ValidationError);
  });

  it('rejects an oversize body (>64 KB)', () => {
    const big = Buffer.alloc(64 * 1024 + 1, 'x');
    expect(() => validateSvg(big)).toThrow(ValidationError);
  });

  it('rejects non-XML garbage', () => {
    expect(() => validateSvg(Buffer.from('not xml', 'utf8'))).toThrow(ValidationError);
  });
});
```

Run:

```bash
npx vitest run src/validate.test.ts
```

Expected: FAIL — module missing.

- [ ] **Step 2: Implement `validate.ts`.**

The simplest dependency is `node:html-parser` — no, that's not stdlib. Options: `fast-xml-parser`, `node-html-parser`, or a regex-based check. For an allow-list this strict (one root, one child, fixed attribute set), a regex-anchored parse is sufficient and avoids a new dep. Use that approach. The implementer adds `fast-xml-parser` if Task 6 testing surfaces edge cases the regex misses.

```ts
// services/admin-api/src/validate.ts
const MAX_BYTES = 64 * 1024;

const SVG_PATH_DATA_CHARSET = /^[0-9MmLlHhVvCcSsQqTtAaZz \-.,]+$/;

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export interface ValidatedSvg {
  /** Extracted path-d attribute value. Caller writes this to family_silhouettes.svg_data. */
  pathD: string;
  /** Verbatim source bytes (post-size-check, pre-modification). Caller uploads this to R2. */
  source: Buffer;
}

/**
 * Validate an uploaded SVG against the silhouette allow-list:
 *
 * - body ≤ 64 KB (parser-DoS guard)
 * - parses as XML / SVG
 * - single <svg> root
 * - exactly one <path> child element
 * - no other child elements (no <g>, <style>, <script>, <defs>, <use>, etc)
 * - no attribute starting with "on" anywhere
 * - no xlink:href or xlink:* attribute anywhere
 * - viewBox, if present, equals "0 0 24 24"
 * - path has `d` attribute; d passes the same charset check the frontend's
 *   silhouette-fallback.ts uses (issue #271).
 *
 * On success, returns the verbatim source buffer (for R2 upload) and the
 * extracted path-d string (for the DB write).
 */
export function validateSvg(body: Buffer): ValidatedSvg {
  if (body.length === 0) throw new ValidationError('empty body');
  if (body.length > MAX_BYTES) throw new ValidationError(`body exceeds ${MAX_BYTES} bytes`);

  const text = body.toString('utf8');

  // Quick smell tests — fast-fail without parsing.
  if (!/<svg[\s>]/.test(text)) throw new ValidationError('no <svg> element');
  if (/<script\b/i.test(text)) throw new ValidationError('<script> not allowed');
  if (/<style\b/i.test(text)) throw new ValidationError('<style> not allowed');
  if (/<defs\b/i.test(text)) throw new ValidationError('<defs> not allowed');
  if (/<use\b/i.test(text)) throw new ValidationError('<use> not allowed');
  if (/<g\b/i.test(text)) throw new ValidationError('<g> not allowed');
  if (/\son[a-z]+\s*=/i.test(text)) throw new ValidationError('event handler attribute not allowed');
  if (/xlink:/i.test(text)) throw new ValidationError('xlink:* not allowed');

  // Single <path>; capture its tag for the d-attribute extraction.
  const pathMatches = text.match(/<path\b[^>]*\/?>/g) ?? [];
  if (pathMatches.length === 0) throw new ValidationError('no <path> element');
  if (pathMatches.length > 1) throw new ValidationError('multiple <path> elements');
  const pathTag = pathMatches[0]!;

  // viewBox, if present, must be exactly "0 0 24 24" — allows whitespace
  // variation inside the value.
  const viewBoxMatch = text.match(/\bviewBox\s*=\s*"([^"]*)"/);
  if (viewBoxMatch) {
    const normalized = viewBoxMatch[1]!.trim().replace(/\s+/g, ' ');
    if (normalized !== '0 0 24 24') {
      throw new ValidationError(`viewBox must be "0 0 24 24" (got "${viewBoxMatch[1]}")`);
    }
  }

  // Extract d=
  const dMatch = pathTag.match(/\bd\s*=\s*"([^"]*)"/);
  if (!dMatch) throw new ValidationError('<path> missing d attribute');
  const pathD = dMatch[1]!;
  if (!SVG_PATH_DATA_CHARSET.test(pathD)) {
    throw new ValidationError('path d has invalid characters');
  }

  return { pathD, source: body };
}
```

- [ ] **Step 3: Run the test.**

```bash
npx vitest run src/validate.test.ts
```

Expected: all 12 tests PASS.

- [ ] **Step 4: Skip the separate `extract-path-d.ts` file.**

Re-reading the design: `validateSvg` already returns the extracted `pathD`, so a second module is overengineering. Delete the standalone `extract-path-d.ts` / `extract-path-d.test.ts` rows from the file-structure table (note in the PR description if Julian had specifically wanted them split). The plan as executed has validation and extraction in one module.

- [ ] **Step 5: Commit.**

```bash
git add services/admin-api/src/validate.ts services/admin-api/src/validate.test.ts
git commit -m "feat(admin-api): SVG validation + path-d extraction (#502)

Allow-list parser: single <svg> root, exactly one <path>, no event
handlers, no xlink, viewBox must be 0..24 if present, body ≤ 64 KB,
path-d charset matches the frontend's existing isValidSvgPathData
check (#271).

Refs #502"
```

---

## Task 7: R2 storage wrapper (PUT + DELETE)

**Files:**
- Create: `services/admin-api/src/storage.ts`
- Create: `services/admin-api/src/storage.test.ts`

- [ ] **Step 1: Write the failing test.**

```ts
// services/admin-api/src/storage.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { createStorage } from './storage.js';

const s3Mock = mockClient(S3Client);

describe('storage', () => {
  beforeEach(() => {
    s3Mock.reset();
    process.env.R2_ENDPOINT = 'https://acct.r2.cloudflarestorage.com';
    process.env.R2_BUCKET_NAME = 'bird-maps-silhouettes';
    process.env.R2_ACCESS_KEY_ID = 'akid';
    process.env.R2_SECRET_ACCESS_KEY = 'sak';
    process.env.SILHOUETTES_PUBLIC_PREFIX = 'https://silhouettes.bird-maps.com';
  });

  it('putSilhouette uploads at family/<code>.<sha8>.svg and returns the public URL', async () => {
    s3Mock.on(PutObjectCommand).resolves({});
    const storage = createStorage();
    const body = Buffer.from('<svg><path d="M1 1"/></svg>', 'utf8');
    const result = await storage.putSilhouette('cuculidae', body);
    expect(result.key).toMatch(/^family\/cuculidae\.[0-9a-f]{8}\.svg$/);
    expect(result.url).toBe(`https://silhouettes.bird-maps.com/${result.key}`);
    const calls = s3Mock.commandCalls(PutObjectCommand);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.args[0].input).toMatchObject({
      Bucket: 'bird-maps-silhouettes',
      Key: result.key,
      ContentType: 'image/svg+xml',
    });
  });

  it('deleteSilhouette removes the given key', async () => {
    s3Mock.on(DeleteObjectCommand).resolves({});
    const storage = createStorage();
    await storage.deleteSilhouette('family/cuculidae.deadbeef.svg');
    const calls = s3Mock.commandCalls(DeleteObjectCommand);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.args[0].input).toMatchObject({
      Bucket: 'bird-maps-silhouettes',
      Key: 'family/cuculidae.deadbeef.svg',
    });
  });

  it('content hash is deterministic for the same body', async () => {
    s3Mock.on(PutObjectCommand).resolves({});
    const storage = createStorage();
    const body = Buffer.from('<svg><path d="M1 1"/></svg>', 'utf8');
    const r1 = await storage.putSilhouette('cuculidae', body);
    const r2 = await storage.putSilhouette('cuculidae', body);
    expect(r1.key).toBe(r2.key);
  });

  it('content hash changes when body changes', async () => {
    s3Mock.on(PutObjectCommand).resolves({});
    const storage = createStorage();
    const a = await storage.putSilhouette('cuculidae', Buffer.from('a'));
    const b = await storage.putSilhouette('cuculidae', Buffer.from('b'));
    expect(a.key).not.toBe(b.key);
  });

  it('throws when R2_ENDPOINT is missing', () => {
    delete process.env.R2_ENDPOINT;
    expect(() => createStorage()).toThrow(/R2_ENDPOINT/);
  });
});
```

Run:

```bash
npx vitest run src/storage.test.ts
```

Expected: FAIL — module missing.

- [ ] **Step 2: Implement `storage.ts`.**

```ts
// services/admin-api/src/storage.ts
import { createHash } from 'node:crypto';
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';

export interface PutResult {
  /** R2 object key (e.g. "family/cuculidae.a1b2c3d4.svg"). */
  key: string;
  /** Public URL served by the silhouettes Worker. */
  url: string;
}

export interface Storage {
  putSilhouette(familyCode: string, body: Buffer): Promise<PutResult>;
  deleteSilhouette(key: string): Promise<void>;
}

export function createStorage(): Storage {
  const endpoint = process.env.R2_ENDPOINT;
  if (!endpoint) throw new Error('R2_ENDPOINT is required');
  const bucket = process.env.R2_BUCKET_NAME ?? 'bird-maps-silhouettes';
  const publicPrefix = process.env.SILHOUETTES_PUBLIC_PREFIX ?? 'https://silhouettes.bird-maps.com';
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

  const clientConfig: ConstructorParameters<typeof S3Client>[0] = {
    region: 'auto',
    endpoint,
  };
  if (accessKeyId && secretAccessKey) {
    clientConfig.credentials = { accessKeyId, secretAccessKey };
  }
  const client = new S3Client(clientConfig);

  return {
    async putSilhouette(familyCode, body) {
      // Content-hash the body for a write-once-never-overwrite key. 8 hex chars
      // (32 bits) is plenty for a 10s-of-objects bucket and keeps URLs short.
      const sha = createHash('sha256').update(body).digest('hex').slice(0, 8);
      const key = `family/${familyCode}.${sha}.svg`;
      await client.send(new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: 'image/svg+xml',
        CacheControl: 'public, max-age=31536000, immutable',
      }));
      return { key, url: `${publicPrefix}/${key}` };
    },
    async deleteSilhouette(key) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
  };
}
```

- [ ] **Step 3: Run the test.**

```bash
npx vitest run src/storage.test.ts
```

Expected: all 5 tests PASS.

- [ ] **Step 4: Commit.**

```bash
git add services/admin-api/src/storage.ts services/admin-api/src/storage.test.ts
git commit -m "feat(admin-api): R2 storage wrapper with content-hashed keys (#502)

Mirrors services/ingestor/src/r2/uploader.ts S3-client config. Keys are
family/<code>.<sha8>.svg; CacheControl set to immutable+1y to match the
photos pipeline's write-once contract (infra/workers/photo-server.js).

Refs #502"
```

---

## Task 8: CDN purge for `/api/silhouettes` envelope

**Files:**
- Create: `services/admin-api/src/purge.ts`
- Create: `services/admin-api/src/purge.test.ts`

- [ ] **Step 1: Write the failing test.**

```ts
// services/admin-api/src/purge.test.ts
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { purgeSilhouettesJson } from './purge.js';

describe('purgeSilhouettesJson', () => {
  beforeEach(() => {
    process.env.CLOUDFLARE_ZONE_ID = 'zone';
    process.env.CLOUDFLARE_API_TOKEN = 'token';
    process.env.API_HOST = 'api.bird-maps.com';
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('POSTs to the Cloudflare purge endpoint with the silhouettes URL', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ success: true }), { status: 200 }),
    );
    await purgeSilhouettesJson();
    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe('https://api.cloudflare.com/client/v4/zones/zone/purge_cache');
    expect(init?.method).toBe('POST');
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer token');
    expect(JSON.parse(init?.body as string)).toEqual({
      files: ['https://api.bird-maps.com/api/silhouettes'],
    });
  });

  it('returns { ok: false } on non-200 (does not throw)', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response('boom', { status: 500 }));
    const result = await purgeSilhouettesJson();
    expect(result.ok).toBe(false);
  });

  it('returns { ok: false } on network error (does not throw)', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('nope'));
    const result = await purgeSilhouettesJson();
    expect(result.ok).toBe(false);
  });

  it('respects a 5 second timeout', async () => {
    const slow = new Promise<Response>(() => {}); // never resolves
    vi.spyOn(global, 'fetch').mockReturnValue(slow);
    const t0 = Date.now();
    const result = await purgeSilhouettesJson({ timeoutMs: 50 });
    expect(Date.now() - t0).toBeLessThan(500);
    expect(result.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Implement `purge.ts`.**

```ts
// services/admin-api/src/purge.ts
export interface PurgeResult {
  ok: boolean;
  error?: string;
}

export async function purgeSilhouettesJson(opts: { timeoutMs?: number } = {}): Promise<PurgeResult> {
  const zoneId = process.env.CLOUDFLARE_ZONE_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  const apiHost = process.env.API_HOST ?? 'api.bird-maps.com';
  if (!zoneId || !apiToken) {
    return { ok: false, error: 'CLOUDFLARE_ZONE_ID or CLOUDFLARE_API_TOKEN missing' };
  }
  const url = `https://api.cloudflare.com/client/v4/zones/${zoneId}/purge_cache`;
  const body = JSON.stringify({ files: [`https://${apiHost}/api/silhouettes`] });
  const timeoutMs = opts.timeoutMs ?? 5000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiToken}`,
        'Content-Type': 'application/json',
      },
      body,
      signal: controller.signal,
    });
    if (!res.ok) return { ok: false, error: `cloudflare status ${res.status}` };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}
```

- [ ] **Step 3: Run the test.**

```bash
npx vitest run src/purge.test.ts
```

Expected: all 4 tests PASS.

- [ ] **Step 4: Commit.**

```bash
git add services/admin-api/src/purge.ts services/admin-api/src/purge.test.ts
git commit -m "feat(admin-api): CF cache purge for /api/silhouettes envelope (#502)

Best-effort, 5s timeout, non-throwing — log-and-warn on failure so the
admin-api still returns 200 if the DB write succeeded but the CDN purge
didn't. Operator fallback: scripts/purge-silhouettes-cache.sh.

Refs #502"
```

---

## Task 9: Hono app factory + routes (`PUT` + `DELETE`)

**Files:**
- Create: `services/admin-api/src/app.ts`
- Create: `services/admin-api/src/app.test.ts`

This is the largest single task. The integration test uses testcontainers Postgres (per CLAUDE.md's "no DB mocks" rule for the database) and the SDK mock for R2.

- [ ] **Step 1: Write the failing integration test.**

```ts
// services/admin-api/src/app.test.ts
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { mockClient } from 'aws-sdk-client-mock';
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { createApp } from './app.js';
import { createStorage } from './storage.js';
import { runMigrations } from '@bird-watch/db-client/test-helpers';

const TOKEN = 'integration-token';
const s3Mock = mockClient(S3Client);

describe('admin-api app', () => {
  let container: StartedPostgreSqlContainer;
  let pool: Pool;
  let app: ReturnType<typeof createApp>;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgis/postgis:16-3.4').start();
    pool = new Pool({ connectionString: container.getConnectionUri() });
    await runMigrations(pool);
    process.env.R2_ENDPOINT = 'https://acct.r2.cloudflarestorage.com';
    process.env.R2_BUCKET_NAME = 'bird-maps-silhouettes';
    process.env.R2_ACCESS_KEY_ID = 'akid';
    process.env.R2_SECRET_ACCESS_KEY = 'sak';
    process.env.SILHOUETTES_PUBLIC_PREFIX = 'https://silhouettes.bird-maps.com';
    process.env.CLOUDFLARE_ZONE_ID = 'zone';
    process.env.CLOUDFLARE_API_TOKEN = 'cftoken';
    process.env.API_HOST = 'api.bird-maps.com';
    app = createApp({
      pool,
      storage: createStorage(),
      token: TOKEN,
    });
  }, 120_000);

  afterAll(async () => {
    await pool.end();
    await container.stop();
  });

  beforeEach(() => {
    s3Mock.reset();
    s3Mock.on(PutObjectCommand).resolves({});
    s3Mock.on(DeleteObjectCommand).resolves({});
    // Stub fetch so purgeSilhouettesJson returns success silently.
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200 }));
  });

  function multipart(filename: string, body: Buffer): FormData {
    const fd = new FormData();
    const blob = new Blob([body], { type: 'image/svg+xml' });
    fd.set('file', blob, filename);
    return fd;
  }

  const VALID_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M12 2 L20 22 L4 22 Z"/></svg>`;

  it('GET /health returns ok', async () => {
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it('PUT /admin/silhouettes/family/:code without token returns 401', async () => {
    const res = await app.request('/admin/silhouettes/family/cuculidae', {
      method: 'PUT',
      body: multipart('cuculidae.svg', Buffer.from(VALID_SVG, 'utf8')),
    });
    expect(res.status).toBe(401);
  });

  it('PUT with valid token + valid SVG returns 200, updates DB, calls R2 PUT', async () => {
    const res = await app.request('/admin/silhouettes/family/cuculidae', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${TOKEN}` },
      body: multipart('cuculidae.svg', Buffer.from(VALID_SVG, 'utf8')),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { url: string; pathD: string };
    expect(body.url).toMatch(/^https:\/\/silhouettes\.bird-maps\.com\/family\/cuculidae\.[0-9a-f]{8}\.svg$/);
    expect(body.pathD).toBe('M12 2 L20 22 L4 22 Z');

    const { rows } = await pool.query<{ svg_url: string; svg_data: string }>(
      `SELECT svg_url, svg_data FROM family_silhouettes WHERE family_code = 'cuculidae'`,
    );
    expect(rows[0]!.svg_url).toBe(body.url);
    expect(rows[0]!.svg_data).toBe('M12 2 L20 22 L4 22 Z');

    expect(s3Mock.commandCalls(PutObjectCommand)).toHaveLength(1);
  });

  it('PUT with malicious SVG (<script>) returns 400 and does NOT touch DB or R2', async () => {
    const malicious = `<svg><script>alert(1)</script><path d="M1 1"/></svg>`;
    const res = await app.request('/admin/silhouettes/family/cuculidae', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${TOKEN}` },
      body: multipart('cuculidae.svg', Buffer.from(malicious, 'utf8')),
    });
    expect(res.status).toBe(400);
    expect(s3Mock.commandCalls(PutObjectCommand)).toHaveLength(0);
  });

  it('PUT for unknown family code returns 404', async () => {
    const res = await app.request('/admin/silhouettes/family/notarealfamily', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${TOKEN}` },
      body: multipart('x.svg', Buffer.from(VALID_SVG, 'utf8')),
    });
    expect(res.status).toBe(404);
  });

  it('DELETE with valid token nulls both svg_url and svg_data, calls R2 DELETE when svg_url was set', async () => {
    // seed via PUT first
    await app.request('/admin/silhouettes/family/cuculidae', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${TOKEN}` },
      body: multipart('cuculidae.svg', Buffer.from(VALID_SVG, 'utf8')),
    });
    s3Mock.resetHistory();

    const res = await app.request('/admin/silhouettes/family/cuculidae', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect(res.status).toBe(200);

    const { rows } = await pool.query<{ svg_url: string | null; svg_data: string | null }>(
      `SELECT svg_url, svg_data FROM family_silhouettes WHERE family_code = 'cuculidae'`,
    );
    expect(rows[0]!.svg_url).toBeNull();
    expect(rows[0]!.svg_data).toBeNull();
    expect(s3Mock.commandCalls(DeleteObjectCommand)).toHaveLength(1);
  });

  it('DELETE on a row that was never overridden is idempotent (200, no R2 DELETE call)', async () => {
    const res = await app.request('/admin/silhouettes/family/turdidae', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect(res.status).toBe(200);
    expect(s3Mock.commandCalls(DeleteObjectCommand)).toHaveLength(0);
  });

  it('PUT logs but does not fail when purge fails', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response('boom', { status: 500 }));
    const res = await app.request('/admin/silhouettes/family/cuculidae', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${TOKEN}` },
      body: multipart('cuculidae.svg', Buffer.from(VALID_SVG, 'utf8')),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Purge-Status')).toBe('failed');
  });
});
```

Run:

```bash
npx vitest run src/app.test.ts
```

Expected: FAIL — `createApp` module missing. Container start may take 30–60s on first run.

- [ ] **Step 2: Implement `app.ts`.**

```ts
// services/admin-api/src/app.ts
import { Hono } from 'hono';
import type { Pool } from '@bird-watch/db-client';
import { bearerAuth } from './auth.js';
import { validateSvg, ValidationError } from './validate.js';
import type { Storage } from './storage.js';
import { purgeSilhouettesJson } from './purge.js';

export interface AppDeps {
  pool: Pool;
  storage: Storage;
  token: string;
}

const FAMILY_CODE = /^[a-z]+$/;

export function createApp(deps: AppDeps): Hono {
  const app = new Hono();

  app.get('/health', c => c.json({ ok: true }));

  app.use('/admin/*', bearerAuth(deps.token));

  app.put('/admin/silhouettes/family/:code', async c => {
    const code = c.req.param('code');
    if (!FAMILY_CODE.test(code)) {
      return c.json({ error: 'invalid family code' }, 400);
    }
    const form = await c.req.formData();
    const file = form.get('file');
    if (!(file instanceof Blob)) {
      return c.json({ error: 'file field missing' }, 400);
    }
    const body = Buffer.from(await file.arrayBuffer());

    let validated;
    try {
      validated = validateSvg(body);
    } catch (err) {
      if (err instanceof ValidationError) {
        return c.json({ error: err.message }, 400);
      }
      throw err;
    }

    // Confirm the family row exists before any side effect.
    const existing = await deps.pool.query<{ svg_url: string | null }>(
      `SELECT svg_url FROM family_silhouettes WHERE family_code = $1`,
      [code],
    );
    if (existing.rows.length === 0) {
      return c.json({ error: `unknown family_code: ${code}` }, 404);
    }

    // Upload first; only update DB if R2 succeeded. Order matters: a DB write
    // pointing at a non-existent key would render broken images.
    const put = await deps.storage.putSilhouette(code, validated.source);

    await deps.pool.query(
      `UPDATE family_silhouettes SET svg_url = $1, svg_data = $2 WHERE family_code = $3`,
      [put.url, validated.pathD, code],
    );

    const purge = await purgeSilhouettesJson();
    if (!purge.ok) {
      c.header('X-Purge-Status', 'failed');
      console.warn(`[admin-api] purge failed: ${purge.error}`);
    }

    return c.json({ url: put.url, key: put.key, pathD: validated.pathD });
  });

  app.delete('/admin/silhouettes/family/:code', async c => {
    const code = c.req.param('code');
    if (!FAMILY_CODE.test(code)) {
      return c.json({ error: 'invalid family code' }, 400);
    }
    const existing = await deps.pool.query<{ svg_url: string | null }>(
      `SELECT svg_url FROM family_silhouettes WHERE family_code = $1`,
      [code],
    );
    if (existing.rows.length === 0) {
      return c.json({ error: `unknown family_code: ${code}` }, 404);
    }
    const prevUrl = existing.rows[0]!.svg_url;

    if (prevUrl) {
      // Derive key from URL: prefix-strip "https://silhouettes.bird-maps.com/"
      // The public prefix is configurable; recover the key from the URL by
      // splitting on the bucket-path boundary.
      const url = new URL(prevUrl);
      const key = url.pathname.replace(/^\//, '');
      try {
        await deps.storage.deleteSilhouette(key);
      } catch (err) {
        console.warn(`[admin-api] R2 delete failed for ${key}: ${err}`);
        // Continue — DB null-out is still the right outcome from the
        // operator's perspective. The R2 object becomes orphaned at worst.
      }
    }

    await deps.pool.query(
      `UPDATE family_silhouettes SET svg_url = NULL, svg_data = NULL WHERE family_code = $1`,
      [code],
    );

    const purge = await purgeSilhouettesJson();
    if (!purge.ok) {
      c.header('X-Purge-Status', 'failed');
      console.warn(`[admin-api] purge failed: ${purge.error}`);
    }

    return c.json({ ok: true });
  });

  app.onError((err, c) => {
    console.error('Unhandled error', err);
    return c.json({ error: 'internal' }, 500);
  });

  return app;
}
```

- [ ] **Step 3: Run the integration test.**

```bash
npx vitest run src/app.test.ts
```

Expected: all 7 tests PASS. First run may take ~90s (container pull + boot + migrations). Subsequent runs are ~15–20s.

- [ ] **Step 4: Commit.**

```bash
git add services/admin-api/src/app.ts services/admin-api/src/app.test.ts
git commit -m "feat(admin-api): Hono PUT + DELETE silhouette routes (#502)

PUT: validate SVG → upload to R2 (content-hashed key) → UPDATE DB
(svg_url + extracted svg_data path-d) → purge /api/silhouettes JSON.
DELETE: R2 DELETE (best-effort, log on fail) → NULL both columns →
purge. Bearer-token auth on /admin/*; /health is open.

Refs #502"
```

---

## Task 10: Local entry + Dockerfile

**Files:**
- Create: `services/admin-api/src/local.ts`
- Create: `services/admin-api/src/index.ts` (re-export for `main` field)
- Create: `services/admin-api/Dockerfile`

- [ ] **Step 1: Create `src/index.ts`.**

```ts
// services/admin-api/src/index.ts
export { createApp } from './app.js';
```

- [ ] **Step 2: Create `src/local.ts`.**

```ts
// services/admin-api/src/local.ts
import { serve } from '@hono/node-server';
import { createPool } from '@bird-watch/db-client';
import { createApp } from './app.js';
import { createStorage } from './storage.js';

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error('DATABASE_URL not set');
  const token = process.env.ADMIN_API_TOKEN;
  if (!token) throw new Error('ADMIN_API_TOKEN not set');

  const pool = createPool({ databaseUrl: dbUrl });
  const app = createApp({ pool, storage: createStorage(), token });
  const port = Number(process.env.PORT ?? 8788);
  serve({ fetch: app.fetch, port });
  console.log(`Admin API listening on http://localhost:${port}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 3: Create `Dockerfile`.**

```dockerfile
# Build stage — uses the monorepo root context.
FROM node:24-alpine AS build
WORKDIR /repo

COPY package.json package-lock.json ./
COPY tsconfig.base.json ./
COPY packages ./packages
COPY services/admin-api ./services/admin-api

RUN npm ci --workspaces --include-workspace-root --include=dev
RUN npm run build --workspace @bird-watch/shared-types
RUN npm run build --workspace @bird-watch/db-client
RUN npm run build --workspace @bird-watch/admin-api

# Runtime stage.
FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080

COPY --from=build /repo/package.json /repo/package-lock.json ./
COPY --from=build /repo/packages/db-client ./packages/db-client
COPY --from=build /repo/packages/shared-types ./packages/shared-types
COPY --from=build /repo/services/admin-api/package.json ./services/admin-api/
COPY --from=build /repo/services/admin-api/dist ./services/admin-api/dist

RUN npm ci --omit=dev --workspaces --include-workspace-root

USER node

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q --spider http://localhost:8080/health || exit 1
CMD ["node", "services/admin-api/dist/local.js"]
```

- [ ] **Step 4: Build the workspace and the Docker image (smoke).**

```bash
npm run build --workspace @bird-watch/admin-api
docker build -f services/admin-api/Dockerfile -t bird-admin-api:local .
```

Expected: clean build, image builds. Skip pushing — Task 13 wires the deploy workflow.

- [ ] **Step 5: Commit.**

```bash
git add services/admin-api/src/local.ts services/admin-api/src/index.ts services/admin-api/Dockerfile
git commit -m "feat(admin-api): local entry + Dockerfile (#502)

Mirrors services/read-api: tsx for dev, node-server for prod, two-stage
Dockerfile with the same npm-workspace install discipline.

Refs #502"
```

---

## Task 11: CLI — `scripts/silhouette.mjs`

**Files:**
- Create: `scripts/silhouette.mjs`
- Create: `scripts/silhouette.test.mjs`
- Modify: `package.json` (root scripts)

- [ ] **Step 1: Write the failing test.**

```js
// scripts/silhouette.test.mjs
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { runCli } from './silhouette.mjs';
import { writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('silhouette CLI', () => {
  beforeEach(() => {
    process.env.ADMIN_API_URL = 'https://admin.example';
    process.env.ADMIN_API_TOKEN = 'tok';
  });
  afterEach(() => vi.restoreAllMocks());

  it('set <family> <file> PUTs the file with the bearer token', async () => {
    const path = join(tmpdir(), 'cuculidae.svg');
    writeFileSync(path, '<svg><path d="M1 1"/></svg>', 'utf8');
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ url: 'https://x', pathD: 'M1 1' }), { status: 200 }),
    );
    const code = await runCli(['set', 'cuculidae', path]);
    expect(code).toBe(0);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://admin.example/admin/silhouettes/family/cuculidae');
    expect(init.method).toBe('PUT');
    expect(init.headers.Authorization).toBe('Bearer tok');
    expect(init.body).toBeInstanceOf(FormData);
    unlinkSync(path);
  });

  it('unset <family> DELETEs', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    const code = await runCli(['unset', 'cuculidae']);
    expect(code).toBe(0);
    expect(fetchSpy.mock.calls[0][1].method).toBe('DELETE');
  });

  it('returns non-zero exit code on non-200', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response('boom', { status: 400 }));
    const code = await runCli(['unset', 'cuculidae']);
    expect(code).toBe(1);
  });

  it('errors when ADMIN_API_URL is missing', async () => {
    delete process.env.ADMIN_API_URL;
    const code = await runCli(['unset', 'cuculidae']);
    expect(code).toBe(2);
  });

  it('prints usage when given no subcommand', async () => {
    const code = await runCli([]);
    expect(code).toBe(2);
  });
});
```

Run from the root (vitest will discover `.mjs` test files via the root config; if not, add `scripts/**` to the existing root vitest workspace include patterns):

```bash
npx vitest run scripts/silhouette.test.mjs
```

Expected: FAIL — module missing.

- [ ] **Step 2: Implement `scripts/silhouette.mjs`.**

```js
#!/usr/bin/env node
// scripts/silhouette.mjs — admin CLI for the silhouette override admin-api (#502).
//
// Usage:
//   npm run silhouette set <family-code> <path-to-svg>
//   npm run silhouette unset <family-code>
//
// Env:
//   ADMIN_API_URL    — base URL of the admin-api (e.g. https://admin.bird-maps.com)
//   ADMIN_API_TOKEN  — bearer token (rotate via `openssl rand -hex 32`)

import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';

export async function runCli(argv) {
  const [sub, family, file] = argv;
  const base = process.env.ADMIN_API_URL;
  const token = process.env.ADMIN_API_TOKEN;
  if (!base || !token) {
    console.error('ADMIN_API_URL and ADMIN_API_TOKEN must be set in env');
    return 2;
  }
  if (sub !== 'set' && sub !== 'unset') {
    console.error('Usage: npm run silhouette set <family> <file>  |  unset <family>');
    return 2;
  }
  if (!family || !/^[a-z]+$/.test(family)) {
    console.error('Family code must be lowercase letters only');
    return 2;
  }
  const url = `${base.replace(/\/$/, '')}/admin/silhouettes/family/${family}`;

  if (sub === 'set') {
    if (!file) {
      console.error('Usage: npm run silhouette set <family> <file>');
      return 2;
    }
    const body = await readFile(file);
    const fd = new FormData();
    fd.set('file', new Blob([body], { type: 'image/svg+xml' }), basename(file));
    const res = await fetch(url, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}` },
      body: fd,
    });
    if (!res.ok) {
      console.error(`HTTP ${res.status}: ${await res.text()}`);
      return 1;
    }
    const body2 = await res.json();
    console.log(`OK: ${family} → ${body2.url}`);
    return 0;
  }

  // unset
  const res = await fetch(url, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    console.error(`HTTP ${res.status}: ${await res.text()}`);
    return 1;
  }
  console.log(`OK: ${family} reverted to _FALLBACK`);
  return 0;
}

// Run when invoked as a script (not when imported by tests).
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  runCli(process.argv.slice(2)).then(code => process.exit(code));
}
```

- [ ] **Step 3: Run the test.**

```bash
npx vitest run scripts/silhouette.test.mjs
```

Expected: all 5 tests PASS.

- [ ] **Step 4: Wire root `package.json`.**

Edit `package.json` and add to `scripts`:

```json
    "curate:phylopic": "node scripts/curate-phylopic.mjs",
    "silhouette": "node scripts/silhouette.mjs"
```

Verify:

```bash
npm run silhouette
```

Expected: prints the usage message and exits 2. (Stderr message and non-zero exit are correct here.)

- [ ] **Step 5: Commit.**

```bash
git add scripts/silhouette.mjs scripts/silhouette.test.mjs package.json
git commit -m "feat(scripts): npm run silhouette CLI for admin-api (#502)

set <family> <file> PUTs multipart; unset <family> DELETEs. Reads
ADMIN_API_URL + ADMIN_API_TOKEN from env. Returns shell-friendly exit
codes (0 ok, 1 HTTP fail, 2 usage error).

Refs #502"
```

---

## Task 12: Frontend — prefer `svgUrl` in glyph + detail surfaces

**Files:**
- Modify: `frontend/src/components/ds/FamilySilhouette.tsx`
- Modify: `frontend/src/components/ds/FamilySilhouette.test.tsx`
- Modify: `frontend/src/components/FamilyLegend.tsx`
- Modify: `frontend/src/components/SpeciesDetailSurface.tsx`
- Modify: `frontend/src/styles.css` (or `frontend/src/components/ds/ds-primitives.css` — match where the existing `family-silhouette-*` rules live; locate via `grep -n family-silhouette frontend/src/**/*.css`)

The key technical decision: how to tint an externally-loaded SVG with the family color. Two options:

**Option A: CSS mask + background-color.** `mask-image: url(<svgUrl>); background-color: var(--family-color);`. The SVG is loaded as a mask (alpha-channel only), and the family color comes from CSS. Works in all modern browsers (Safari 15.4+, Chrome 120+, FF 119+ for unprefixed; `-webkit-mask-image` covers older WebKits). This is what the rest of the design system uses (verify via `grep -n mask-image frontend/src/**/*.css`).

**Option B: CSS filter chain.** `filter: brightness(0) saturate(100%) invert(56%) sepia(76%) …`. Convoluted, fragile (filter chain must be derived per color), and degrades on SVGs that have non-monochrome content. Reject.

Use Option A.

- [ ] **Step 1: Locate the existing tint pattern.**

```bash
grep -rn "mask-image\|--family-color\|family-silhouette" frontend/src/styles.css frontend/src/components/ds/ds-primitives.css 2>/dev/null | head -30
```

Expected: existing rules around `.family-silhouette-*`. Pick the file with the most existing rules for the modification target.

- [ ] **Step 2: Write the failing test for `FamilySilhouette.tsx`.**

Edit `frontend/src/components/ds/FamilySilhouette.test.tsx` and add:

```tsx
it('renders an <img> mask when imgUrl is provided', () => {
  const { container } = render(
    <FamilySilhouette
      family="cuculidae"
      layout="thumb"
      shape="oval"
      color="#A05A3A"
      imgUrl="https://silhouettes.bird-maps.com/family/cuculidae.deadbeef.svg"
    />,
  );
  const img = container.querySelector('.family-silhouette-img');
  expect(img).not.toBeNull();
  expect(img!.getAttribute('style')).toContain('--family-silhouette-mask: url(');
  expect(img!.getAttribute('style')).toContain('#A05A3A');
});

it('falls back to inline path-d when imgUrl is null and pathD is provided', () => {
  const { container } = render(
    <FamilySilhouette
      family="cuculidae"
      layout="thumb"
      shape="oval"
      color="#A05A3A"
      pathD="M12 2 L20 22 L4 22 Z"
    />,
  );
  expect(container.querySelector('.family-silhouette-img')).toBeNull();
  expect(container.querySelector('path')).not.toBeNull();
});

it('imgUrl takes precedence over pathD when both are provided', () => {
  const { container } = render(
    <FamilySilhouette
      family="cuculidae"
      layout="thumb"
      shape="oval"
      color="#A05A3A"
      pathD="M12 2"
      imgUrl="https://silhouettes.bird-maps.com/family/cuculidae.deadbeef.svg"
    />,
  );
  expect(container.querySelector('.family-silhouette-img')).not.toBeNull();
  expect(container.querySelector('path')).toBeNull();
});
```

Run:

```bash
cd frontend
npx vitest run src/components/ds/FamilySilhouette.test.tsx
```

Expected: FAIL — `imgUrl` prop unknown.

- [ ] **Step 3: Add the `imgUrl` prop to `FamilySilhouette.tsx`.**

Locate the existing prop block (around line 38–62 per the earlier grep). Add after `pathD`:

```ts
  /**
   * Admin-api-uploaded CDN-served SVG URL (#502). When non-null, takes
   * precedence over `pathD`: the silhouette renders as a CSS-mask div with
   * the family color as background, so the same uploaded asset renders
   * tinted with each family's color without per-color asset variants.
   * When null (the default), the component falls back to the existing
   * pathD render path. The map's SDF sprite pipeline ignores this prop
   * and always reads pathD.
   */
  imgUrl?: string | null;
```

Locate the render section (around line 100–125). At the top of the render body, add the early-return for `imgUrl`:

```tsx
  if (imgUrl) {
    return (
      <div
        className={`family-silhouette family-silhouette-img layout-${layout}`}
        data-family={family}
        style={{
          ['--family-silhouette-mask' as string]: `url(${imgUrl})`,
          ['--family-silhouette-color' as string]: color,
        }}
        aria-label={`${family} silhouette`}
        role="img"
      />
    );
  }
```

Make sure `imgUrl` is destructured from props at the top of the component (alongside `pathD`, `color`, etc).

- [ ] **Step 4: Add the CSS rule.**

In the CSS file located by Step 1:

```css
.family-silhouette-img {
  display: inline-block;
  background-color: var(--family-silhouette-color);
  -webkit-mask-image: var(--family-silhouette-mask);
          mask-image: var(--family-silhouette-mask);
  -webkit-mask-repeat: no-repeat;
          mask-repeat: no-repeat;
  -webkit-mask-position: center;
          mask-position: center;
  -webkit-mask-size: contain;
          mask-size: contain;
}
.family-silhouette-img.layout-thumb { width: 28px; height: 28px; }
.family-silhouette-img.layout-hero  { width: 96px; height: 96px; }
```

(Verify which layout-* sizes the existing component uses; mirror them.)

- [ ] **Step 5: Run the test.**

```bash
npx vitest run src/components/ds/FamilySilhouette.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Wire the prop through `FamilyLegend.tsx` and `SpeciesDetailSurface.tsx`.**

`FamilyLegend.tsx` — change the existing `<FamilySilhouette>` call (around line 182):

```tsx
                  <FamilySilhouette
                    family={entry.familyCode}
                    layout="thumb"
                    shape={shape}
                    color={entry.silhouette.color}
                    {...(entry.silhouette.svgUrl != null ? { imgUrl: entry.silhouette.svgUrl } : {})}
                    {...(entry.silhouette.svgData != null ? { pathD: entry.silhouette.svgData } : {})}
                  />
```

`SpeciesDetailSurface.tsx` — find the masthead `<FamilySilhouette>` call (search via `grep -n FamilySilhouette frontend/src/components/SpeciesDetailSurface.tsx`) and add the same `imgUrl` prop wiring.

- [ ] **Step 7: Run the frontend full suite.**

```bash
cd frontend
npx vitest run
```

Expected: all tests PASS. (Existing test for `FamilyLegend` and `SpeciesDetailSurface` should still pass — the prop is additive.)

- [ ] **Step 8: Add an E2E spec (optional but recommended).**

`frontend/e2e/silhouette-override.spec.ts` — stub `GET /api/silhouettes` to return one row with `svgUrl` set, navigate, assert the legend chip renders the `.family-silhouette-img` element. Use `page.route()` per the navigation contract.

- [ ] **Step 9: Run the build + e2e.**

```bash
cd ..
npm run build -w @bird-watch/frontend
cd frontend
npx playwright test e2e/silhouette-override.spec.ts
```

Expected: clean.

- [ ] **Step 10: Commit.**

```bash
git add frontend/src/components/ds/FamilySilhouette.tsx frontend/src/components/ds/FamilySilhouette.test.tsx frontend/src/components/FamilyLegend.tsx frontend/src/components/SpeciesDetailSurface.tsx frontend/src/styles.css frontend/e2e/silhouette-override.spec.ts
git commit -m "feat(frontend): prefer svgUrl in legend + detail surfaces (#502)

FamilySilhouette accepts imgUrl; when present, renders as a CSS-mask div
tinted with the family color (no per-color asset variants). MapCanvas's
SDF sprite pipeline is unchanged — it always reads svgData (synchronous
sprite registration requires inline path-d).

Refs #502"
```

- [ ] **Step 11: Playwright MCP UI verification at the canonical viewport set.**

Per CLAUDE.md `Testing > UI verification`. Spin up the dev server, stub `/api/silhouettes` (e.g. via a one-off `page.route` in a manual session) to inject one row with `svgUrl` populated, drive at all 5 viewports × 2 themes, capture 10 screenshots, dispatch the `ui-design:ui-designer` subagent (model=opus) per CLAUDE.md's contract. Console must show zero errors and zero warnings. Then continue.

---

## Task 13: Terraform + Worker + deploy workflow + first end-to-end test

**Files:**
- Create: `infra/terraform/silhouettes.tf`
- Create: `infra/workers/silhouette-server.js`
- Create: `infra/workers/silhouette-server.test.js`
- Create: `infra/terraform/admin-api.tf`
- Modify: `infra/terraform/variables.tf`
- Create: `.github/workflows/deploy-admin-api.yml`

Use context7 for the `hashicorp/google` and `cloudflare/cloudflare` providers before writing the Terraform — provider attribute names have shifted across minor versions and CLAUDE.md's "use context7 for these libraries" table includes both.

- [ ] **Step 1: Bucket + Worker + DNS for `silhouettes.bird-maps.com`.**

`infra/terraform/silhouettes.tf`:

```hcl
# ── Storage backend for admin-api-uploaded family silhouettes (#502) ───
#
# Cloudflare R2 bucket holding the operator-curated SVGs that override the
# Phylopic-curated default in family_silhouettes. Public access via a
# separate Worker at silhouettes.${var.domain}; the bucket itself stays
# private.

resource "cloudflare_r2_bucket" "silhouettes" {
  account_id = var.cloudflare_account_id
  name       = "bird-maps-silhouettes"
  location   = "WNAM"

  # No prevent_destroy: silhouette objects are re-runnable from local SVG
  # files via `npm run silhouette set`. A destroy costs ~10 minutes of
  # operator re-uploading, not curation work — different durability class
  # than birdwatch-photos (which has prevent_destroy=true because re-fetch
  # is rate-limited iNaturalist work). See D1 in
  # docs/plans/2026-05-13-silhouette-admin-api.md.
}

resource "cloudflare_workers_script" "silhouette_server" {
  account_id = var.cloudflare_account_id
  name       = "birdwatch-silhouette-server"
  module     = true
  content    = file("${path.module}/../workers/silhouette-server.js")

  r2_bucket_binding {
    name        = "SILHOUETTES"
    bucket_name = cloudflare_r2_bucket.silhouettes.name
  }
}

resource "cloudflare_workers_route" "silhouettes" {
  zone_id     = var.cloudflare_zone_id
  pattern     = "silhouettes.${var.domain}/*"
  script_name = cloudflare_workers_script.silhouette_server.name
}

resource "cloudflare_record" "silhouettes" {
  zone_id = var.cloudflare_zone_id
  name    = "silhouettes"
  type    = "CNAME"
  content = var.domain
  proxied = true
  ttl     = 1
}
```

`infra/workers/silhouette-server.js` (clone the photos worker with a `.svg` Content-Type mapping):

```js
// silhouette-server: public read-only proxy in front of bird-maps-silhouettes R2.
// Exposes https://silhouettes.bird-maps.com/<key> → r2://bird-maps-silhouettes/<key>.
// Same write-once-never-overwrite contract as photo-server: keys are content-hashed,
// so hit responses are safe to mark immutable + max-age=1y.

export function contentTypeFor(key) {
  const dot = key.lastIndexOf('.');
  if (dot === -1) return 'application/octet-stream';
  const ext = key.slice(dot + 1).toLowerCase();
  switch (ext) {
    case 'svg':
      return 'image/svg+xml';
    default:
      return 'application/octet-stream';
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const key = url.pathname.slice(1);
    const object = await env.SILHOUETTES.get(key);
    if (object === null) {
      return new Response(null, {
        status: 404,
        headers: { 'Cache-Control': 'public, max-age=60' },
      });
    }
    return new Response(object.body, {
      headers: {
        'Content-Type': contentTypeFor(key),
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  },
};
```

`infra/workers/silhouette-server.test.js` — clone `photo-server.test.js`, change the binding name, test `.svg` returns `image/svg+xml` and unknown extension falls through.

Run:

```bash
node --test infra/workers/silhouette-server.test.js
```

Expected: PASS.

- [ ] **Step 2: Admin-api Cloud Run + Secret Manager wiring.**

`infra/terraform/admin-api.tf` — see file-structure table for the full env-var list. Mirror `read-api.tf` shape with these env-from-secret bindings:

- `DATABASE_URL` ← reuse `bird-watch-db-url` (already exists)
- `ADMIN_API_TOKEN` ← new secret `bird-watch-admin-api-token` (initial version: `openssl rand -hex 32` ran at deploy time, see runbook)
- `R2_ENDPOINT` ← new secret (or static var if not sensitive — endpoint URL is public)
- `R2_ACCESS_KEY_ID` ← new secret
- `R2_SECRET_ACCESS_KEY` ← new secret
- `R2_BUCKET_NAME` ← static env (`bird-maps-silhouettes`)
- `SILHOUETTES_PUBLIC_PREFIX` ← static env (`https://silhouettes.bird-maps.com`)
- `CLOUDFLARE_ZONE_ID` ← reuse `bird-watch-cloudflare-zone-id`
- `CLOUDFLARE_API_TOKEN` ← reuse `bird-watch-cloudflare-api-token`
- `API_HOST` ← static env (`api.bird-maps.com`)

Service account `bird-admin-api` with secret-accessor IAM on each. Cloud Run service `bird-admin-api`, `allUsers` invoker.

Add `var.r2_access_key_id` + `var.r2_secret_access_key` to `infra/terraform/variables.tf` if not already present (verify against the ingestor — these may already exist).

- [ ] **Step 3: Apply locally against the prod project.**

```bash
cd infra/terraform
terraform init
terraform plan -out=admin-api.plan
```

Expected: a positive count of new resources (1 bucket, 1 worker, 1 route, 1 record, ~6 secrets, 1 SA, ~6 IAM bindings, 1 Cloud Run service, 1 Cloud Run IAM binding). No destroys, no updates to unrelated resources.

If `terraform plan` surfaces drift on unrelated resources (e.g. image tags), confirm those are in `ignore_changes` blocks per the existing pattern in `read-api.tf` lines 76–78.

```bash
terraform apply admin-api.plan
```

Expected: green apply. New Cloud Run service URL printed in outputs.

- [ ] **Step 4: Deploy workflow.**

`.github/workflows/deploy-admin-api.yml` — clone `deploy-read-api.yml` byte-for-byte, then change:

- `paths` filter: `services/admin-api/**` (and keep `packages/**`, root manifest, tsconfig, the workflow itself)
- `IMAGE_NAME: admin-api`
- `SERVICE_NAME: bird-admin-api`
- Dockerfile path: `services/admin-api/Dockerfile`
- Smoke test URL: `https://admin.bird-maps.com/health` (or the `.run.app` URL if no custom domain is wired — pick the simpler path for the first deploy and add the custom-domain mapping in a follow-up).

- [ ] **Step 5: Commit.**

```bash
git add infra/terraform/silhouettes.tf infra/terraform/admin-api.tf infra/terraform/variables.tf infra/workers/silhouette-server.js infra/workers/silhouette-server.test.js .github/workflows/deploy-admin-api.yml
git commit -m "infra: Cloud Run admin-api + R2 silhouettes bucket + Worker (#502)

Cloud Run service bird-admin-api with allUsers invoker + bearer-token
middleware. New R2 bucket bird-maps-silhouettes served via Worker at
silhouettes.bird-maps.com (mirrors photos pipeline). New Secret Manager
secret bird-watch-admin-api-token; rotate via openssl rand -hex 32 +
gcloud secrets versions add. CD via .github/workflows/deploy-admin-api.yml,
mirrors deploy-read-api.yml shape.

Refs #502"
```

- [ ] **Step 6: First end-to-end test against the deployed admin-api.**

After the deploy workflow has run green on push-to-main (the implementer waits for the workflow run to complete):

```bash
export ADMIN_API_URL=$(gcloud run services describe bird-admin-api --region=us-west1 --format='value(status.url)')
export ADMIN_API_TOKEN=$(gcloud secrets versions access latest --secret=bird-watch-admin-api-token)
# Sanity ping
curl -s "$ADMIN_API_URL/health"
# Acceptance: upload cuculidae
npm run silhouette set cuculidae ./test-fixtures/cuckoo.svg
```

The fixture SVG is sourced by the implementer from any reasonable hand-drawn or licensed cuckoo silhouette (single path, 0..24 viewBox, ~5 KB). If the implementer has no fixture handy, hand-draw a minimal placeholder shape in a text editor and use that for the smoke test.

Expected: `OK: cuculidae → https://silhouettes.bird-maps.com/family/cuculidae.<sha>.svg`. Curl that URL → 200, content-type image/svg+xml. Reload bird-maps.com → within ~30s the cuculidae chip in the legend renders the new silhouette tinted with cuculidae's color. SpeciesDetailSurface for any cuckoo species shows the same silhouette.

```bash
# Acceptance: unset
npm run silhouette unset cuculidae
```

Expected: `OK: cuculidae reverted to _FALLBACK`. Reload → cuculidae renders the `_FALLBACK` shape tinted with cuculidae's color.

If the end-to-end test surfaces any issue (purge delay > 30s, mask rendering off, etc), file a follow-up issue rather than blocking the PR — the unit and integration tests are green and the production smoke is the validation gate.

---

## Task 14: Operator runbook + acceptance documentation

**Files:**
- Create: `docs/runbooks/silhouette-override.md`

- [ ] **Step 1: Write the runbook.**

```markdown
# Silhouette override runbook

## Purpose

The admin-api lets an operator (Julian or any agent) drop in a hand-sourced
SVG for any family whose Phylopic-curated silhouette is missing or
unsatisfactory, without a code change or deploy. Issue #502.

## Prerequisites

```bash
export ADMIN_API_URL="https://admin.bird-maps.com"          # or the .run.app URL
export ADMIN_API_TOKEN="$(gcloud secrets versions access latest --secret=bird-watch-admin-api-token --project=bird-maps-prod)"
```

## Upload a silhouette

```bash
npm run silhouette set <family-code> <path-to-svg>
# example
npm run silhouette set cuculidae ./roadrunner.svg
```

SVG constraints (enforced server-side; mismatches return 400):

- Single `<svg>` root with exactly one `<path>` child
- viewBox `"0 0 24 24"` (or absent)
- Body ≤ 64 KB
- path-d charset: digits, the SVG command letters, space, dash, dot, comma
- No `<script>`, `<style>`, `<g>`, `<defs>`, `<use>`, event handlers, or `xlink:*`

Within ~30s a hard-reload of bird-maps.com renders the new silhouette in the
legend, the map cluster mosaic, and the species-detail surface for any
species in that family.

## Revert a silhouette

```bash
npm run silhouette unset <family-code>
```

This nulls both `svg_url` and `svg_data` in the DB and removes the R2 object.
The row reverts to `_FALLBACK` state (legend renders the generic shape
tinted with the family color). To restore the Phylopic-curated default,
re-run `npm run curate:phylopic` and ship the resulting migration.

## Rotate the bearer token

```bash
NEW=$(openssl rand -hex 32)
echo "$NEW" | gcloud secrets versions add bird-watch-admin-api-token --data-file=- --project=bird-maps-prod
# Cloud Run picks up the new version at the next request (env-from-secret
# is resolved at instance start; `gcloud run services update --clear-flags`
# forces an instance recycle if needed).
```

## Troubleshooting

- **Upload returns 200 but render hasn't updated.** Cache purge may have failed (look for `X-Purge-Status: failed` on the response). Run `scripts/purge-silhouettes-cache.sh` manually.
- **Upload returns 400.** SVG fails one of the validation rules above. The response body names the failing rule.
- **Upload returns 404.** Family code doesn't exist in `family_silhouettes`. Confirm via the audit query in `scripts/curate-phylopic.mjs` comments.
- **`silhouettes.bird-maps.com/family/<code>.<sha>.svg` returns 404.** R2 PUT may have raced ahead of cache miss; wait 60s (the Worker's miss-cache TTL).
```

- [ ] **Step 2: Commit.**

```bash
git add docs/runbooks/silhouette-override.md
git commit -m "docs(runbooks): operator runbook for silhouette override admin-api (#502)

Refs #502"
```

---

## Acceptance criteria (mirrors issue #502)

- [ ] `npm run silhouette set cuculidae ./roadrunner.svg` from a laptop with `ADMIN_API_URL` + `ADMIN_API_TOKEN` in env returns 200, uploads to R2, UPDATEs `family_silhouettes.svg_url` + `svg_data`, purges the `/api/silhouettes` JSON cache. Within ~30s, a hard-reload of bird-maps.com renders the new silhouette in (a) the FamilyLegend cuculidae chip, (b) the map cluster mosaic for cuculidae observations, AND (c) the SpeciesDetailSurface for any cuckoo species. (Surface (b) is satisfied transitively — the SDF pipeline reads the refreshed `svg_data`.)
- [ ] `npm run silhouette unset cuculidae` returns 200, nulls both `svg_url` and `svg_data`, removes the R2 object, purges the JSON cache; the three surfaces fall back to the `_FALLBACK` shape tinted with cuculidae's family color.
- [ ] CI green: `test`, `lint`, `build`, `e2e`. New service has its own vitest suite covering bearer-token rejection, SVG validation rejection, happy-path PUT, happy-path DELETE, purge-failure soft-fail, idempotent DELETE on already-null row.
- [ ] `npm run build` produces a deployable Docker image and `deploy-admin-api.yml` runs green on push to `main`.
- [ ] Bot review (`julianken-bot` via the dispatch protocol in `.claude/skills/pr-workflow/SKILL.md`) approves the implementation PR.
- [ ] No new SVG content shipped in the repo — the validation IS the contract. The runbook (Task 14) documents the operator workflow.

---

## Risks and open decisions surfaced

(These compose with the "Open decisions" section above. The numbered list below is severity-ordered.)

1. **R2 bucket-naming fork (D1).** Recommendation in plan body: new bucket. If Julian prefers reuse-photos-prefix, swap the Terraform + Worker as described in "Why R2 (and which R2 bucket)".
2. **DELETE rollback semantics fork (D2).** Recommendation: full revert. If Julian wants partial revert, add `svg_data_original TEXT NULL` to the migration and adjust the handler accordingly.
3. **Validation depth (D3).** Recommendation: full enforcement. If the post-curation pipeline outputs SVGs with `viewBox` != `0 0 24 24` or with `<g>` wrappers (verify against `scripts/phylopic-picks.json`'s recent entries), relax the rule accordingly.
4. **Purge wait semantics (D4).** Recommendation: synchronous + 5s timeout + best-effort log. If first-week ops show frequent `X-Purge-Status: failed` headers, switch to fire-and-forget and have the operator always run `scripts/purge-silhouettes-cache.sh` after every upload.
5. **Test infrastructure (D5).** Recommendation: SDK mock. If a production protocol-level bug surfaces, add a LocalStack-backed integration test to the suite as a follow-up.
6. **CSS mask browser support.** `mask-image` is broadly supported but iOS Safari needs `-webkit-mask-*` prefixes (covered in Task 12's CSS). Verify with the canonical-viewport Playwright smoke; if Safari 14 (or older) shows a black box instead of a tinted silhouette, the fallback is to keep the existing inline-path-d render until that user agent fades from analytics.
7. **Custom-domain wiring for `admin.bird-maps.com`.** Plan body wires `silhouettes.bird-maps.com` (Worker route) but the admin-api itself lands on its `.run.app` URL — DNS + Cloud Run domain mapping for `admin.bird-maps.com` is a follow-up. The CLI accepts any base URL so this isn't blocking, but the runbook should be updated when the custom domain lands.
8. **Knip false-positive risk.** `scripts/silhouette.mjs` and `scripts/silhouette.test.mjs` may surface as orphan-knip findings if the root `package.json` script ref doesn't satisfy knip's static-extraction. Verify in Task 11 by running `npx knip` and adding an ignore rule per CLAUDE.md's "Knip false-positive workflow" if needed.
9. **Terraform-plan-drift on the first apply.** The plan adds ~10–15 new Cloud Run / IAM / Secret resources. The existing `terraform-plan-drift-check` workflow (currently blocked at IAM level per CLAUDE.md, see #298) won't fire as a Mergify gate, but the first `terraform apply` should be reviewed manually before merge.
10. **Migration filename slot collision.** Plan reserves `1700000037000_`. If a new migration lands on `main` between this plan's authoring and execution, the implementer bumps to the next free slot and updates Task 1's filename.

---

## Self-review checklist

(Run by the plan author before saving.)

- [x] **Spec coverage.** Issue #502's bullets — new service, R2 storage, dual-column schema, content-hashed URLs, two endpoints, bearer-token auth, allUsers invoker, npm-aliased CLI, family-level scope, retain-until-explicit-delete object lifecycle, R2 versioning skipped, three frontend surfaces with three rules — are each covered by a numbered task above.
- [x] **No placeholders in code.** Every code block is paste-ready. Two intentional fill-ins: (a) the SVG fixture path in Task 13's end-to-end test (the operator's choice of hand-sourced cuckoo silhouette) and (b) the exact `@aws-sdk/client-s3` version pin in Task 4 (must match the ingestor workspace, verified via `grep`). Both are parameters, not placeholders for unwritten logic.
- [x] **Type / name consistency.** `svgUrl` is consistent across the shared-types interface (Task 3), the db-client projection (Task 2), the admin-api handler (Task 9), and the frontend props (Task 12). The new column is `svg_url` everywhere in SQL. The R2 key shape `family/<code>.<sha8>.svg` is consistent across `storage.ts` (Task 7) and the handler's URL-to-key derivation in DELETE (Task 9). The bucket name `bird-maps-silhouettes` is consistent across `storage.ts`, `silhouettes.tf`, and the deploy workflow.
- [x] **Prototype-gate decision recorded.** Argued as satisfied transitively (SDF path validated by production; `<img>` rendering risk-surface is smaller than the existing inline-SVG path).
- [x] **D1–D5 surfaced.** Each fork the implementer should not silently resolve is enumerated with a default recommendation.
