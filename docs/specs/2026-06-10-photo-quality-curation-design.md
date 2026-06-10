# Species Photo Quality Curation — Design Spec

- **Date:** 2026-06-10
- **Status:** Draft (brainstormed; awaiting review → implementation plan as GitHub epic + child issues)
- **Author:** Julian + Claude (brainstorming session)
- **Related:** `docs/specs/2026-04-16-bird-watch-design.md` (system architecture), `DESIGN.md` (design language), photo ingestion (`services/ingestor/src/run-photos.ts`), admin-api silhouette precedent (`services/admin-api/`)

## 1. Problem

Many species detail photos on bird-maps.com are not "nature-guide" quality: dead birds, specimens on tables, captive/in-hand shots, birds too distant in frame, soft/blurry images, harsh flash. The ingestor (`run-photos.ts`) currently grabs the **single top-voted** research-grade iNaturalist photo per species (`per_page=1`) with **no quality filtering** beyond iNat's research grade, then a Wikipedia lead-image fallback. There is no human review gate between fetch and live, and no way to see, rate, sort, or selectively replace existing photos.

Across ~715 observed species (99% photo coverage), a meaningful fraction need replacement. We want:

1. A **researched, repeatable quality rubric** to score any species photo.
2. A **local interactive review server** to view every photo with its score, sort/filter by quality, and mark photos for swap.
3. **The same rubric mechanism** applied to new incoming photos (future ingest runs), gating them automatically.
4. For marked photos: **source better candidates**, present **old-vs-new** in the same server, **approve / deny each** (deny carries a reason), and have the **deny reason feed back** into re-sourcing.
5. Approved swaps **pushed to the live site** safely.

## 2. Goals / Non-Goals

**Goals**
- One scoring mechanism shared by the bulk-review tool *and* the ingestor new-photo gate (no duplicated criteria → no drift).
- A research-derived, version-controlled, tunable rubric — calibrated on a sample before the full run.
- A local, on-brand review UI (adopts `DESIGN.md`) for triage and old-vs-new approve/deny with deny-reason feedback.
- A safe, batched apply path that mutates prod only on explicit confirmation, dodging the immutable-CDN-cache trap.

**Non-Goals**
- No new upstream photo source beyond iNaturalist top-N this round (Wikipedia fallback stays for zero-iNat species; Macaulay/Commons are future work).
- No always-on hosted review UI — the review server is a single-operator local tool.
- No change to how the frontend *renders* photos (the `Photo` component and wire shape stay as-is, aside from the new content-hashed URL form, which is transparent to it).
- No automated unattended swapping of existing photos — bulk replacement is always human-approved.

## 3. Locked decisions (from brainstorming)

| # | Decision | Choice |
|---|---|---|
| 1 | Scoring machinery | **Hybrid**: cheap deterministic checks gate a vision-LLM judge |
| 2 | Replacement candidate source | **iNaturalist top-N deep** (10–20 research-grade per species, each scored) |
| 3 | Review workspace store | **Local SQLite + cached thumbnails**; prod untouched until apply |
| 4 | Apply timing | **Stage decisions, then one batched "Apply approved swaps"** |
| 5 | Deny semantics | **Re-source + re-present**: deny reason feeds candidate selection; iterate until approve or "keep original" |
| 6 | New-photo gate | **Auto-accept above threshold**; below/borderline queue for review |
| 7 | Rubric calibration | **Calibrate on a ~30–40 photo sample first**, tune, then run all ~715 |
| 8 | Review server styling | **Adopts `DESIGN.md`** (colors, type ramp, elevation, 12px cards, light/dark via `[data-theme]`) — minus the four-corner map contract, which is map-specific |

## 4. Architecture (Approach A: shared rubric core)

The linchpin is a **shared scoring package** that both the review tool and the ingestor import — so "same criteria for new photos" is structural, not a copy.

```
                 ┌──────────────────────────────────────────┐
                 │  packages/photo-quality  (shared core)    │
                 │  scoreImage(buf, meta) → QualityReport    │
                 │  Stage 1 deterministic → Stage 2 LLM judge│
                 │  rubric.config.ts (weights/thresholds/    │
                 │  judge prompt) — ONE config, two consumers│
                 └───────────────┬─────────────┬─────────────┘
                                 │             │
         ┌───────────────────────┘             └───────────────────────┐
         ▼                                                             ▼
┌─────────────────────────────────────┐         ┌──────────────────────────────────┐
│ Curation tool (LOCAL — deliverable) │         │ Ingestor gate (PROD — monthly job)│
│ 1 score-current → SQLite            │         │ run-photos.ts (refactored):       │
│ 2 source-candidates (iNat top-N)    │         │  new species → iNat top-N → score │
│ 3 review server (localhost)         │         │  ≥ threshold → auto-accept (write) │
│ 4 apply approved swaps → admin-api  │         │  < threshold → flag needs_review  │
│   ↕ review.sqlite + ./thumb-cache/  │         └──────────────────────────────────┘
└──────────────────┬──────────────────┘
                   │ only on "Apply"
                   ▼
┌──────────────────────────────────────────────────────────────────┐
│ NEW: PUT /admin/species-photos/:code  (mirrors silhouette admin)  │
│ {sourceUrl, attribution, license} + bearer token →                │
│ fetch → validate → R2 birdwatch-photos at CONTENT-HASHED key      │
│ species/<code>.<sha8>.<ext> → insertSpeciesPhoto upsert →         │
│ purge Cloudflare cache for /api/species/<code>                    │
└──────────────────────────────────────────────────────────────────┘
```

**Why a content-hashed key (new):** today's R2 keys are `<code>.<ext>` served `immutable, max-age=31536000`. Overwriting the same key would leave the old image cached at the edge and in browsers for up to a year. The silhouette admin already solved this with content-hashed keys (`family/<code>.<sha8>.svg`) + DB-URL update + cache purge. Species-photo swaps adopt the same pattern: a new key per image, the DB `url` points to the new key, and we purge the JSON endpoint so the API serves the new URL immediately.

## 5. Components and interfaces

### 5.1 `packages/photo-quality` (new workspace package)

**Purpose:** Score one image against the rubric. Pure, dependency-light, no network except the LLM call (injected client).

**Interface:**
```ts
interface ImageInput { buffer: Buffer; mime: string; sourceUrl?: string; }
interface SpeciesContext { speciesCode: string; comName: string; sciName: string; family: string; }

interface QualityReport {
  overall: number;                 // 0–100 composite
  verdict: 'great' | 'good' | 'mediocre' | 'reject';
  deterministic: {
    width: number; height: number; megapixels: number;
    sharpness: number;             // normalized Laplacian variance
    exposure: number;              // 0–1, clipping penalty
    aspectRatio: number;
    passedGate: boolean;           // false → skip LLM, auto-reject
    failReasons: string[];
  };
  criteria: {                      // Stage 2, each 0–10
    framing: number;               // subject size/placement/crop
    subjectClarity: number;        // focus on the bird, eye sharpness
    liveness: number;              // alive & healthy (low = dead/sick/injured)
    naturalness: number;           // wild setting (low = captive/in-hand/feeder/specimen)
    pose: number; background: number; lighting: number;
  };
  flags: string[];                 // 'dead','in-hand','specimen','sick','distant',
                                   // 'multiple-subjects','watermark','captive','harsh-flash'
  rationale: string;               // one-line judge explanation
  rubricVersion: string;
}

function scoreImage(img: ImageInput, ctx: SpeciesContext, opts: { judge: VisionJudge; config: RubricConfig }): Promise<QualityReport>;
```

**Stage 1 — deterministic (local, free):** decode with `sharp`; compute dimensions/megapixels, sharpness (variance of Laplacian over a downscaled grayscale), exposure (histogram clipping), aspect ratio. Hard-gate on configured minimums (e.g. min 0.3 MP, min sharpness). A gate failure short-circuits — the image never reaches the LLM (this is the hybrid cost saving).

**Stage 2 — vision-LLM judge:** Claude vision call with the rubric prompt; returns the per-criterion sub-scores + flags + rationale as structured output (tool/JSON schema). The composite `overall` is computed from sub-scores via configured weights, with disqualifier flags applying hard penalties (e.g. `dead`/`specimen` caps overall at ≤20 regardless of other scores).

**`rubric.config.ts`** (the tunable contract, version-stamped):
```ts
interface RubricConfig {
  version: string;
  deterministic: { minMegapixels: number; minSharpness: number; allowedAspect: [number, number]; };
  weights: Record<keyof QualityReport['criteria'], number>;
  disqualifiers: { flag: string; cap: number }[];   // e.g. { flag:'dead', cap:20 }
  thresholds: { autoAccept: number; review: number; reject: number };
  judgePrompt: string;   // researched rubric text (Phase 0 deliverable)
  model: string;         // e.g. claude vision model id; calibration picks tier
}
```

**Idempotency / cost control:** `scoreImage` results are keyed by image content hash; the curation tool caches reports in SQLite so re-runs don't re-call the LLM for unchanged images.

### 5.2 Candidate sourcing (iNat top-N)

Extend the existing iNat client (`services/ingestor/src/inat/client.ts`) to a `fetchInatCandidates(sciName, { limit, excludeIds, placeCascade })` that returns up to N research-grade, CC-licensed (no NC/ND) candidates ordered by votes — instead of `per_page=1`. Returns `{ inatId, photoUrl, attribution, license, exifHints }[]`. The license allowlist and NC/ND deny logic are reused verbatim. This function lives where both the ingestor and the curation tool can import it (either in the shared package or a small `packages/inat-client` extraction — see Open Questions).

**Deny-reason biasing:** the sourcer accepts an optional `denyContext` (free-text reason + structured tags from quick-chips). Tags map to score/flag biases on re-source (e.g. `captive/feeder` → down-rank candidates flagged `captive`/`in-hand`; `still distant` → require higher `framing`; `wrong sex/morph` → surface a wider variety rather than near-duplicates). Already-shown candidate ids are excluded.

### 5.3 Local review store (SQLite + thumb cache)

A single `review.sqlite` (path under the tool's working dir, gitignored) plus `./thumb-cache/` for downloaded candidate thumbnails. Tables:

```sql
-- snapshot of live photos pulled from prod at sync time
photo_current(species_code PK, com_name, sci_name, family, url, attribution, license, content_hash);
-- one scoring report per (subject, content_hash)
photo_score(id PK, species_code, role TEXT,   -- 'current' | 'candidate'
            candidate_inat_id, content_hash, overall, verdict, criteria_json, flags_json,
            rationale, rubric_version, scored_at);
-- sourced candidates and their cached thumbnails
photo_candidate(id PK, species_code, inat_id, photo_url, thumb_path, attribution, license,
                excluded INTEGER DEFAULT 0, source_round INTEGER);
-- operator decisions (staged until apply)
photo_decision(species_code PK, action TEXT,  -- 'approve' | 'keep' | 'deny' | 'pending'
               chosen_candidate_id, deny_reason, deny_tags_json, decided_at,
               applied INTEGER DEFAULT 0, applied_at);
```

The store is the single source of truth for the review server; prod is read at sync time (to snapshot current photos + any `needs_review` flags) and written only on apply.

### 5.4 Review server (local app)

A small local server (Node/Express or Vite + a thin API) serving two screens, styled per `DESIGN.md` (full light/dark via `[data-theme]`, mockups in `.superpowers/brainstorm/`). It reads/writes `review.sqlite`.

**Screen 1 — Overview grid:** every species card with current photo, color-coded score, disqualifier-flag chips, per-criterion sub-scores, and a "Mark for swap" checkbox. Sort: worst-first / best-first / has-better-candidate / recently-scored. Filter: All / Flagged / Dead-sick / Distant / In-hand / Soft / Marked-for-swap. A red/amber inset rail marks below-threshold cards.

**Screen 2 — Swap review:** side-by-side **Current (live)** vs **Proposed replacement** (top-scored candidate), each with score, flag chips, sub-scores, and full attribution/license (including a visible note when a higher-raw candidate was filtered for a non-commercial license). A scored, ranked **alternates strip** (iNat top-N) — click to feature a different candidate. Action bar: **Approve** (records featured candidate) · **Keep original** · **Deny** (reason text + quick-chips → re-source). A "staged: N approved" indicator; nothing touches prod until **Apply**.

**Deny → re-source loop:** Deny writes `action='deny'` + reason/tags, marks shown candidates `excluded`, and triggers `source-candidates` for that species with `denyContext`. New candidates land in the store and the screen refreshes. Iterates until Approve or Keep-original.

### 5.5 New admin-api endpoint

`PUT /admin/species-photos/:speciesCode` — added to `services/admin-api` following the silhouette precedent exactly (bearer-token auth via `ADMIN_API_TOKEN`, constant-time compare).

- **Request:** JSON `{ sourceUrl, attribution, license }` (server fetches+mirrors, like the ingestor — avoids shipping image bytes from the local tool). License must pass the same CC allowlist / NC-ND deny used at ingest.
- **Write sequence (R2 before DB, mirroring silhouette):** fetch image from `sourceUrl` (must 200, must be image/*, min dimensions) → compute `sha8` → upload to `birdwatch-photos` at `species/<code>.<sha8>.<ext>` with `Content-Type` + `immutable` cache headers → `insertSpeciesPhoto(pool, { speciesCode, purpose:'detail-panel', url: publicUrl, attribution, license })` (upsert on `(species_code,purpose)`) → purge Cloudflare cache for `https://<API_HOST>/api/species/<code>`.
- **Idempotent & reversible-ish:** re-applying upserts in place; old R2 object is left (best-effort delete optional). No DELETE path this round.
- **Infra:** the `bird-admin-api` Cloud Run service already has R2 + DB + CF-purge env/secrets; it needs write access to the `birdwatch-photos` bucket (today it targets `bird-maps-silhouettes`) — add the bucket binding / `R2_PHOTOS_BUCKET` env. Terraform: `infra/terraform/admin-api.tf`.

### 5.6 Apply (batched)

A `apply-swaps` action in the curation tool reads all `photo_decision` rows where `action='approve' AND applied=0`, prints a confirmation summary (N species, old→new, license check), and on confirm calls the admin endpoint per species, marking `applied=1` on success. Failures are reported and left un-applied for retry. Uses `ADMIN_API_URL` + `ADMIN_API_TOKEN` (same env as `scripts/silhouette.mjs`).

### 5.7 Ingestor new-photo gate

Refactor `run-photos.ts` to import `packages/photo-quality` and the top-N sourcer. For a species needing a photo: fetch top-N → score each → pick the best. If best `overall ≥ thresholds.autoAccept`, write it (as today, now with a content-hashed key). If none clear the bar, write the best available **but** set `needs_review=true` and `quality_score`, so the species still shows a photo and the curation tool surfaces it for human attention on next sync. (Keeping a photo rather than leaving a gap preserves current coverage behavior; the flag is the queue.)

### 5.8 Prod schema change (minimal)

A single migration adds two columns to `species_photos`:
```sql
-- Up
ALTER TABLE species_photos ADD COLUMN quality_score REAL;
ALTER TABLE species_photos ADD COLUMN needs_review BOOLEAN NOT NULL DEFAULT false;
-- Down
ALTER TABLE species_photos DROP COLUMN needs_review;
ALTER TABLE species_photos DROP COLUMN quality_score;
```
This persists the gate's decision durably and lets the curation tool sync live scores. It does **not** widen the wire type — the read-api projection is unchanged unless we later choose to expose review state. (The review *workspace* remains local SQLite per decision #3; these two columns are durable photo metadata, a separate concern.)

## 6. Phase 0: rubric research (workflow deliverable)

Before any scoring, a research pass produces the rubric. Deliverables, committed before the rubric config is finalized:

- `docs/research/2026-06-10-bird-photo-quality-rubric.md`: what makes a field-guide-quality bird photo (framing/subject-size conventions, diagnostic feather detail, natural perch/habitat, lighting, eye sharpness, avoiding captive/in-hand/specimen/dead/distant), synthesized from authoritative sources (Sibley/National Geographic/Audubon photo guidance, Macaulay/eBird media rating norms, bird-photography critique literature, NIMA/aesthetic-scoring background). Includes the explicit disqualifier taxonomy.
- The initial `rubric.config.ts` (weights, thresholds, judge prompt) derived from it.

**Calibration loop (decision #7):** assemble a ~30–40 image sample spanning known-good and known-bad (including obvious dead/in-hand cases). Score with the draft rubric, view in the review server, and adjust weights/thresholds/prompt until the judge's verdicts match operator judgment. Only then run the full ~715.

## 7. Cost

One-time full pass: ~715 current photos scored once (cached by content hash). Candidate scoring: for the flagged fraction (say ~25% → ~180 species) × top-N (~15) ≈ ~2.7k candidate scores, minus deterministic-gate rejects that never hit the LLM. Total order ~3–4k vision calls one-time, plus small re-source increments. Calibration picks the model tier (a cheaper vision model for bulk scoring may suffice; a stronger one for borderline judgments). Re-runs are cache-cheap. This is comfortably affordable and not latency-sensitive (offline batch).

## 8. Error handling

- **iNat / network failures during sourcing:** per-species isolation (one failure doesn't abort the batch); retries with backoff as the ingestor already does; failures logged and left `pending`.
- **LLM judge errors / malformed output:** structured-output schema with retry; on persistent failure, mark the report `errored` and surface in the tool rather than silently scoring 0.
- **Apply failures (admin-api):** per-species; failed applies stay `applied=0` for retry; the summary reports them. R2-before-DB ordering means a failed DB write never leaves a dangling live URL.
- **License edge cases:** any candidate failing the CC allowlist / NC-ND deny is filtered at source and never offered; the admin endpoint re-validates license server-side as a backstop.
- **Cache purge failure:** non-fatal (DB authoritative); surfaced as a warning; operator can re-purge.

## 9. Security

- Admin endpoint gated by `ADMIN_API_TOKEN` bearer (constant-time compare), same as silhouettes; `AllUsers` invoke + token is the gate.
- Server-side license re-validation prevents a mis-tagged non-commercial image from going live.
- The local tool holds `ADMIN_API_TOKEN` only in env (never committed); `review.sqlite`, `thumb-cache/`, and any `.superpowers/` artifacts are gitignored.
- No new public surface; the review server binds localhost only.

## 10. Testing strategy

Per repo conventions (TDD per task; no DB mocks; integration via `@testcontainers/postgresql`):

- **`packages/photo-quality`:** unit tests for Stage 1 deterministic metrics (known fixtures → expected sharpness/exposure/gate), composite/weight math, disqualifier caps, and config versioning. The LLM judge is exercised with a stubbed `VisionJudge` returning canned structured output (the rubric *math* is what we test deterministically; judge quality is validated by the human calibration loop, not unit tests).
- **Candidate sourcer:** `msw`-stubbed iNat responses (top-N parsing, license filtering, exclude/deny-bias logic).
- **Admin endpoint:** integration test against testcontainers Postgres + a stubbed R2 (S3 mock) + stubbed CF purge — asserts the R2-before-DB order, content-hashed key, upsert, and purge call; auth tests for missing/bad token.
- **Ingestor gate:** test that ≥threshold auto-accepts and <threshold sets `needs_review` + `quality_score`.
- **Migration:** schema contract test (columns exist, default false) alongside the existing `species-photos-migration.test.ts`.
- **Review server:** lighter weight (local tool) — unit tests for the SQLite data layer (decisions, deny→exclude, staging/apply state machine) and the sort/filter logic. Full Playwright e2e is optional given it's a single-operator local tool; if added, it stubs the data layer.

## 11. Implementation decomposition (feeds the plan → GitHub epic + child issues)

Rough independently-shippable slices (exact tasks authored in `writing-plans`):

1. **Phase 0 research + draft rubric config** (`docs/research/...` + `rubric.config.ts`).
2. **`packages/photo-quality`** core (deterministic + judge interface + math) with unit tests.
3. **iNat top-N sourcer** (+ deny-bias) with msw tests.
4. **Review store + curation CLI** (`score-current`, `source-candidates`, SQLite).
5. **Review server UI** (two screens, DESIGN.md, light/dark) over the store.
6. **Prod migration** (`quality_score`, `needs_review`).
7. **Admin endpoint** `PUT /admin/species-photos/:code` + infra (photos bucket binding) + tests.
8. **Apply-swaps** action (batched, calls admin endpoint).
9. **Ingestor gate refactor** (import shared core; auto-accept/needs-review).
10. **Calibration run** (sample → tune) — a gated checkpoint, then the full ~715 pass.

Dependency order: 1→2; 2→{3,9}; 4 needs 2+3; 5 needs 4; 6→7→8; 8 needs 5; 9 needs 2+6. Calibration (10) gates the full existing-photo pass and the gate go-live.

## 12. Open questions

- **iNat client placement:** extend in-place in `services/ingestor/src/inat/` and import across the workspace boundary, or extract a `packages/inat-client`? Extraction is cleaner for sharing but is more churn; lean extract only if the import boundary proves awkward.
- **Review server stack:** plain Express + vanilla/htmx (fastest, fewest deps for a local tool) vs. a small Vite/React app reusing frontend tokens. Recommendation: minimal Express + static HTML/JS using the DESIGN.md token CSS directly — avoids dragging in the frontend build for an internal tool. Decide in `writing-plans`.
- **Vision model tier:** finalized during calibration (cost vs. judgment quality on borderline cases).
- **Spec/plan home:** this spec is committed to `docs/specs/`; the implementation *plan* will be a GitHub epic + self-contained child issues per the current repo convention (plans live in issues, not committed plan docs).
