# Going National — umbrella plan (AZ → CONUS at HN-scale)

> **For agentic workers:** This is an **umbrella** plan, not an executable one. Component PRs and execution-grade plans live in sibling files (see §3 status matrix). This document sequences them, names the literal flip, and records what was decided in the 2026-05-14 → 2026-05-17 working window. Use `superpowers:subagent-driven-development` against the component plans, not this one.

**Date:** 2026-05-17
**Author:** Julian (orchestrated)
**Triggering analysis:** `docs/analyses/2026-05-14-process-scale-options/phase-4/analysis-report.md` (17-agent funnel, the funnel that produced this commitment).
**Triggering measurement:** `docs/analyses/2026-05-14-process-scale-options/cache-hit-ratio.md` — 99.91% (30d) cache-miss on `bird-maps.com`, ~17× the egress break-even.
**Decision:** going national at **200× audience multiplier** (HN-front-page tail, per Tension 2 / Open Question O5 of the analysis report).

---

## §1 Goal and non-goals

### Goal — what "going national" means concretely

1. **Ingest expands from `US-AZ` to `US`.** The recent-lane recent-ingest cron flips from `regionCode: 'US-AZ'` to `regionCode: 'US'` and starts pulling **Shape 2** species-rollup data for the entire continental US (~683 species/day, ~2 eBird calls/day for the rollup — see Finding 5 of the analysis report). Per-state Shape 3 backfill remains state-scoped because `/historic` is not species-rolled up.
2. **Cloud SQL replaces Neon.** Per `docs/plans/2026-05-17-cloud-sql-migration.md`, the database moves from Neon (AWS us-west-2) to Cloud SQL Postgres 16 (GCP us-west1, `db-g1-small`, zonal). Justification is dominated by the ~$230/mo cross-cloud egress delta at HN-scale traffic with 100% cache-miss on `/api/*`. Migration is a one-time `pg_dump | pg_restore` + secret-version flip.
3. **14-day rolling retention.** The prune job (PR #595, queued at writeup time) deletes observations older than 14 days. National scale at AZ-shape retention would 50× the row count; the 14-day window holds total rows around the same ~17k-rows-per-state × 50 ≈ 850k order, well under any DB-tier ceiling.
4. **HN-scale audience.** The Tier-1 audience-protection moves (rate limit PR #597, TTL caching PR #592 merged, monitoring PRs #591/#598) all ship before the flip. Capacity target: survive a 200× spike without paging Cornell and without exceeding Cloud Run's per-region scale guards.
5. **Monitoring + heartbeat live.** The "deaf system" finding is closed: every signal has a subscriber before the flip lands. Healthchecks.io heartbeat catches cron-no-shows; Cloud Monitoring alert policies S1–S6 + uptime check fire on `julian.kennon.d@gmail.com`.

### Non-goals (explicit, with reason)

- **No payments / monetization / donation button** in v1. Cornell's ToS treats donations as commercial revenue generation (Finding 10); the Cornell conversation (Open Question O3) is upstream of any donate surface.
- **No user accounts / auth / per-user features.** The product remains a public read-only map.
- **No geographic expansion beyond CONUS.** Alaska, Hawaii, Puerto Rico, territories are deferred. Shape 2 verification (Iterator 1) was on US-only; AK/HI introduce different species sets and the silhouette coverage gap widens (e.g. Alcidae for AK). File as a follow-up post-launch.
- **No new product surfaces** (no embed widget, no phenology rework, no list-mode toggle). Going national is a scope flip on existing surfaces.
- **No BigQuery cold tier.** Recommendation 2B's second half is deferred — the cold-tier read-path coupling on the phenology endpoint is irreversible and not load-bearing for the v1 flip. Filed as a future plan.
- **No "Arizona" branding sweep** as a hard precondition. Issue #533 tracks the wider-scope branding removal; it can ship with the flip or as a fast-follow. Decision recorded in §6 below.

---

## §2 Decision log

Decisions taken in the 2026-05-14 → 2026-05-17 window, with citation:

| # | Decision | Source |
|---|---|---|
| D1 | Commit to going national. | This session; user direction |
| D2 | Audience multiplier assumption: **200×** (HN-scale tail), not 25× median. | Open Question O5 / Tension 2 of `analysis-report.md` |
| D3 | Architecture: **Shape 2** national rollup + per-state Shape 3 backfill. | Recommendation 2A/2B; Finding 5 (species-rollup) |
| D4 | DB platform: **Cloud SQL collocated in GCP us-west1**, not Neon Launch. | Recommendation 2B; `cache-hit-ratio.md` (99.91% miss, 17× break-even) |
| D5 | **14-day rolling retention** via the prune job (issue #587 / PR #595). | Recommendation 2C-adjacent (lean storage) + national row-count math |
| D6 | Heartbeat strategy: **Healthchecks.io** (free tier), not Cloud Monitoring custom-metric absent-for. | `2026-05-17-monitoring-and-alerts.md` §"Heartbeat strategy" + D2 decision |
| D7 | Audience protection: Tier-1 **rate limit ships before the flip** (PR #597). | Tension 2; Recommendation 1E |
| D8 | TTL caching on read-API ships before the flip (PR #592 merged). | Recommendation 1E-adjacent (Cloudflare cache-miss is independently worth ~$50/mo at national) |
| D9 | Shape-2 contract probe ships **as a sibling**, not folded into monitoring. | `2026-05-17-monitoring-and-alerts.md` §"Shape 2 re-sample" + `2026-05-17-shape-2-rollup-probe.md` |
| D10 | Cloud SQL launches **zonal, no HA**. Flip to REGIONAL is a single Terraform commit later. | `2026-05-17-cloud-sql-migration.md` §2 sizing |
| D11 | EBD data-request form (Recommendation 1D) and Cornell ToS outreach (O3) **are owed by the user**; the plan does not block on them but documents them as timing risks. | `analysis-report.md` §I |
| D12 | Phenology endpoint **stays** (Option 2C drop is off the table for v1). | Frontend grep shows phenology consumed by `SpeciesDetailSurface`; product call |
| D13 | Region-table treatment: **drop entirely** (region-removal audit PR sequence). | `docs/analyses/2026-05-14-region-removal-audit/00-synthesis.md` |
| D14 | "Arizona" branding sweep: **wider scope (#533)** lands with or shortly after the flip; not a hard block. | Issue #533; §6 below |
| D15 | No dual-write / no logical-replication during DB cutover; **30-min ingest pause** is acceptable per the "within an hour" freshness SLO. | `2026-05-17-cloud-sql-migration.md` §6 |

---

## §3 Component status matrix

Each row names the issue / PR, current status as of 2026-05-17, and what remains.

| Component | Issue | PR(s) | Status | What's left |
|---|---|---|---|---|
| TTL caching on read-API | #586 | #592 | **merged** | nothing; effect already in production |
| Nightly prune (14d retention) | #587 | #595 | **queued** | merge; verify first nightly run prunes expected count |
| Cloud SQL migration **plan** | #588 | #590 | **merged** (plan only, execution deferred) | nothing on the plan; execution is Phase 1 below |
| Monitoring + alerts **plan** | #589 | #591 | **merged** (plan only) | nothing on the plan |
| Monitoring Tasks 1+2 (heartbeat module + cli wiring) | #589 | #598 | **queued** | merge |
| Monitoring Tasks 3–7 (Terraform, secrets, runbook, smoke tests) | #589 | pending | **not started** | dispatch implementation; ~3 PRs |
| Shape-2 probe **plan** | #593 | #594 | **merged** (plan only) | nothing on the plan |
| Shape-2 probe **implementation** | #593 | #599 | **queued** | merge; verify first weekly run lands green |
| Audience-protection rate-limit | #596 | #597 | **queued** | merge; smoke against `hey` synthetic load |
| Alarming follow-up (Rec 0B legacy issue) | #528 | — | open | likely closes when monitoring Tasks 3–7 ship; verify on merge |
| Region-table cleanup (5–6 PR sequence) | — (audit) | not opened | **not started** | open the 5-PR sequence per `docs/analyses/2026-05-14-region-removal-audit/00-synthesis.md` |
| "Arizona" branding sweep | #533 | not opened | **not started** | wider-scope frontend PR; can interleave |
| Silhouette coverage extension (US-only families) | — | — | **not started** | audit `/api/silhouettes` for null families that appear in national data (Alcidae, Gaviidae, etc.); curate via `curating-fallback-silhouettes` skill |
| Frontend default viewport (CONUS) | — | — | **not started** | edit `INITIAL_VIEW` in `frontend/src/components/map/MapCanvas.tsx:246` from AZ center to CONUS center + zoom 4 |
| The literal flip | — | — | **not started** | edit `regionCode: 'US-AZ'` → `'US'` in `services/ingestor/src/cli.ts` (3 sites) + `services/ingestor/src/handler.ts` (3 sites) |
| Cloud SQL execution (T1–T5) | — | not opened | **not started** | per `2026-05-17-cloud-sql-migration.md`; 5 PRs, ~30–40h |
| Cornell ToS outreach (O3) | — | — | **user owes** | email `ebird@cornell.edu` from a project address; pre-monetization is the strongest negotiating moment |
| EBD data-request form (Rec 1D) | — | — | **user owes** | 1 form, 7-day approval lag; preserves Option 2D as a later layer |

---

## §4 The literal flip

The flip is **one diff across two files**. After it lands, the recent-ingest cron pulls US-wide species-rollup data. All other phases of this plan exist to make this single PR safe to ship.

**Files:**

```
services/ingestor/src/cli.ts
  Line 122: regionCode: 'US-AZ'  →  'US'
  Line 124: regionCode: 'US-AZ'  →  'US'   (hotspots — see §4.4 sub-decision)
  Line 126: regionCode: 'US-AZ'  →  'US'   (backfill — see §4.4)
  Line 149: regionCode: 'US-AZ'  →  'US'   (backfill-extended)

services/ingestor/src/handler.ts
  Line 42:  regionCode: 'US-AZ'  →  'US'
  Line 44:  regionCode: 'US-AZ'  →  'US'
  Line 47:  regionCode: 'US-AZ'  →  'US'
```

### §4.1 Pre-conditions (all must be true)

Before this PR opens:

- [ ] Cloud SQL execution complete: T1–T5 of `2026-05-17-cloud-sql-migration.md` merged. **T5 (Neon removal) is required pre-flip** — this matches Phase 1's exit gate (§7) and avoids operator confusion at cutover. Reconciled 2026-05-17: the earlier "optional pre-flip" wording contradicted Phase 1's gate; the stricter rule wins.
- [ ] Monitoring Tasks 1–7 all merged; smoke tests pass for each S1–S7 alert (operator-verified, runbook dated).
- [ ] Healthchecks.io heartbeat green on `bird-ingest-recent` for ≥48h.
- [ ] Audience rate-limit (#597) merged and proven against synthetic load (~5× baseline RPS sustained, no false-positive 429s).
- [ ] Prune job (#595) merged; at least one nightly run completed; row count steady within 14-day window.
- [ ] Shape-2 probe (#599) merged; **at least one green workflow run** posted to `o2-probe-history.csv`. If the probe fires on the day of the flip PR, defer the flip.
- [ ] Frontend default viewport changed to CONUS (separate PR, can ship beforehand without ingestor changes — at AZ ingest, a CONUS map just shows no markers outside AZ; that's acceptable as a brief intermediate state).
- [ ] Silhouette coverage audit run: `/api/silhouettes` null-rate computed against the species set returned by a live `GET /v2/data/obs/US/recent?back=14&maxResults=10000` (~860 species); any high-prevalence family with null silhouette is curated before the flip.
- [ ] Cost alerts set on the GCP project (see §10).
- [ ] Region-table cleanup PR-1 merged (ingest path stopped writing `region_id`). PR-2 and PR-3 of the cleanup can ship after the flip without coupling.

### §4.2 The PR itself

- Conventional commit: `feat(ingestor): expand ingest from US-AZ to US (Shape 2 national rollup)`
- Multi-line body cites this umbrella plan + Finding 5 of the analysis report.
- Tests: extend `cli.test.ts` and `handler.test.ts` to assert the `regionCode: 'US'` literal in the call shape. No existing AZ-only test can stay unchanged.
- e2e: no surface change; existing e2e suite must remain green.
- Screenshots: `N/A — backend-only`.

### §4.3 Post-flip verification

Within the first hour after merge + first scheduled `recent` execution:

- [ ] Cloud Run Job execution exits 0.
- [ ] Healthchecks.io receives a green ping.
- [ ] `psql ... -c "SELECT COUNT(DISTINCT species_code) FROM observations WHERE ingested_at > now() - interval '1 hour';"` returns a number in the 200–1400 band (Shape-2 probe band for `US/recent?back=1`).
- [ ] No S1–S6 alert fires.
- [ ] Frontend map shows non-AZ markers (smoke test: navigate to `bird-maps.com`, drag to e.g. Texas, see clusters).

Within 24h:
- [ ] Row count grows in proportion to the species-rollup expectation, not the per-observation expectation. If the table grew by ≥10× the AZ baseline, the Shape-2 contract is in question — escalate to the Shape-2 probe rerun procedure.
- [ ] GCP billing dashboard shows no anomalous spike on `network-egress-from-us-west1-to-internet`.

### §4.4 Sub-decision: do `hotspots` and `backfill` also flip?

**Yes for `hotspots` and `backfill`, with caveats:**

- `hotspots` (`/data/ref/hotspot/{region}`) returns one record per hotspot. US-wide returns the full national set (~tens of thousands). The hotspot ingest already runs weekly; one week of US-wide is acceptable load. Flip in the same PR.
- `backfill` calls `/data/obs/{region}/historic/YYYY/MM/DD` — **this is NOT species-rolled up**. A US-wide `/historic` call returns one record per observation, which is hundreds of thousands per day. **The backfill flip must be paired with the per-state Shape 3 fan-out**, which is a separate refactor — not in the same PR. Hold `backfill` and `backfill-extended` at `'US-AZ'` for the initial flip and file a follow-up issue for the per-state backfill fan-out.

**Corrected diff scope for the literal flip:**

```
services/ingestor/src/cli.ts      Line 122 (recent), Line 124 (hotspots)
services/ingestor/src/handler.ts  Line 42 (recent), Line 44 (hotspots)
```

Backfill stays at `'US-AZ'` until the fan-out PR lands.

---

## §5 Frontend changes

### §5.1 Map default viewport

`frontend/src/components/map/MapCanvas.tsx:246` currently centers on Arizona:

```ts
const INITIAL_VIEW = {
  longitude: -111.0937,
  latitude: 34.0489,
  zoom: 6,
} as const;
```

Change to CONUS:

```ts
const INITIAL_VIEW = {
  longitude: -98.5795,   // geographic center of CONUS
  latitude: 39.8283,
  zoom: 4,               // shows all of CONUS at 1440x900 desktop
} as const;
```

Verify all 5 canonical viewports per the CLAUDE.md screenshot rule. Mobile (390×844) at zoom 4 may need zoom 3.5 — verify and tune.

### §5.2 PMTiles regional coverage

Per `docs/plans/2026-04-22-plan-7-map-v1.md` the basemap is now served from `tiles.openfreemap.org` (PMTiles never shipped). OpenFreeMap is global; no coverage gap. No change required.

### §5.3 Hard-coded AZ assumptions

Identified by grep:

| File | Reference | Action |
|---|---|---|
| `frontend/src/config/region.ts` | `REGION_LABEL = 'Arizona'` | Deleted by issue #533 (branding sweep) |
| `frontend/src/components/AppHeader.tsx:84-85` | `Bird Maps · Arizona` wordmark | Deleted by #533 |
| `frontend/src/components/MapLede.tsx:41,44,47` | `in ${REGION_LABEL}` / `across ${REGION_LABEL}` | Rewritten or deleted by #533 |
| `frontend/src/components/FeedSurface.tsx:43,216` | `regionLabel = 'Arizona'` default | Deleted by #533 |
| `frontend/src/components/SurfaceTitleSync.tsx:9` | `SITE_SUFFIX = 'Bird Maps · Arizona'` | Updated by #533 (suffix becomes `Bird Maps` only) |
| `frontend/src/styles.css:141,1773,1802` | `.brand-region` rules + comments | Deleted by #533 |
| `services/ingestor/src/run-photos.ts:75-77`, `inat/client.ts:14-15` | iNaturalist `place_id=40` (Arizona) for photo lookup | **Discussed inline; not a blocker.** The fallback path still works: photo lookup falls through to a global search when the place_id query returns nothing. National species not yet in AZ will work; the photo coverage for AZ species is unchanged. File a follow-up to switch `place_id=40 → undefined` (global) for cleaner UX. |
| `packages/db-client/src/species.ts:251` | "Arizona timezone" comment for phenology month-boundary | Comment-only; the math uses `America/Phoenix` which is fine for AZ data. National data spans timezones — file a follow-up to switch to UTC month boundaries. Not a blocker. |

### §5.4 Silhouette coverage

National data introduces families not present in AZ. Audit procedure (run before the flip, repeat 24h after):

```sh
curl -s 'https://api.bird-maps.com/api/silhouettes' \
  | jq -r '.families[] | select(.svgData == null and .svgUrl == null) | .familyCode'
```

Cross-reference with families appearing in `GET /v2/data/obs/US/recent?back=14&maxResults=10000`. Families likely to surface that are absent or rare in AZ: **Alcidae** (auks), **Gaviidae** (loons), **Procellariidae** (shearwaters), **Sulidae** (boobies/gannets), **Pelecanidae** (browns/whites). Curate via the `curating-fallback-silhouettes` skill before the flip; species without a curated silhouette fall back to `_FALLBACK` (working, just generic).

### §5.5 Hotspot density

National hotspot count is on the order of 100k vs AZ's ~3k. The map's existing cluster + adaptive-grid logic (PR #553 + ancestors) handles this in principle but has not been load-tested. Browser-side smoke at 100k hotspots is the highest-risk frontend item; verify with a local data dump and the Lighthouse-style harness already in use for canonical viewports. If FPS degrades below 30 on the mid-range mobile profile, file a follow-up for a hotspot-density LOD pass before the flip.

---

## §6 Region-table treatment

**Decision (D13): drop entirely** per `docs/analyses/2026-05-14-region-removal-audit/00-synthesis.md`.

Rationale:
- 9-region AZ-only ecoregion shape doesn't carry to 50 states without re-curation.
- Drop deletes the unfixed `upsertHotspots` O(table) UPDATE (Rec 0C of the analysis report) as an incidental win.
- 458 unstamped observations + 65 unstamped hotspots become moot — they disappear with the column.
- Spatial substrate (PostGIS `geom` columns + GIST indexes) is **kept** per the audit's PostGIS verdict; future 50-state spatial queries (bbox, radius, nearest) use them.

### §6.1 PR sequence (from the audit, mandatory order PR 1 → PR 2)

| # | Title | Files | Done = |
|---|---|---|---|
| RR-1 | Stop writing `region_id` (ingest path) | `packages/db-client/src/observations.ts`, `packages/db-client/src/hotspots.ts` | One ingest cycle elapses with `SELECT MAX(ingested_at) FROM observations WHERE region_id IS NOT NULL` not advancing |
| RR-2 | Drop `regionId` from the wire shape | `packages/shared-types/`, `db-client/observations.ts`, `frontend/src/dev/DsPreview.tsx`, e2e fixtures | `curl .../api/observations \| jq '.data[0] \| has("regionId")'` returns false |
| RR-3 | Drop schema (7 migrations) | `migrations/1700000039000`–`1700000045000`, `.github/workflows/e2e.yml` seed SQL | `\d observations` shows no `region_id` |
| RR-4 | Spec + CLAUDE.md + README + PR template | docs only | grep returns zero hits |
| RR-5b | (optional, may interleave) Drop "Arizona" branding (issue #533) | `frontend/src/config/region.ts`, `AppHeader`, `MapLede`, `FeedSurface`, `styles.css`, `tokens.ts` | grep `Arizona` in `frontend/src/` returns zero |

### §6.2 Sequencing relative to the flip

- RR-1 should land **before** the literal flip — it removes write-side dependence on region polygons, which only cover AZ today and would otherwise leave national observations unstamped.
- RR-2, RR-3, RR-4 can ship before or after the flip with no coupling.
- RR-5b (branding sweep, #533) can ship any time; recommend before the flip so the live site doesn't claim "Arizona" while serving national data.

---

## §7 Cutover sequence

Linear phases. Each phase names what can ship pre-national-in-production and what is the cutover itself.

### Phase 0 — pre-conditions (ship now; AZ remains live)

These all land while the site is still serving AZ-only. Multiple can ship in parallel.

- [x] P0.a — TTL caching live (#592, merged 2026-05-17)
- [ ] P0.b — Nightly prune live (#595, queued)
- [ ] P0.c — Monitoring Tasks 1+2 (#598, queued)
- [ ] P0.d — Monitoring Tasks 3–7 (Terraform + secrets + runbook + smoke; not started)
- [ ] P0.e — Audience rate-limit (#597, queued)
- [ ] P0.f — Shape-2 probe live (#599, queued; ≥1 green run required)
- [ ] P0.g — Region cleanup RR-1 (not started)
- [ ] P0.h — Frontend CONUS viewport (not started; can ship with AZ ingest, will just show empty outside AZ briefly)
- [ ] P0.i — Branding sweep #533 (not started; recommended pre-flip)
- [ ] P0.j — Silhouette coverage curation (not started)
- [ ] P0.k — Cost budget alerts (§10)
- [ ] P0.l — **Cloudflare Pages request-count tripwire.** Configure CF analytics/notification alerts on the Pages project at **80k requests/day (warning)** and **95k requests/day (critical)** — the free-tier cap is 100k/day (§11 Q6). Wire into the same notification channel as the monitoring plan's S1–S7 (email `julian.kennon.d@gmail.com`). Rationale: at 200× HN tail the cap is reachable in ~4h of viral attention; the tripwire gives ~20% headroom to decide whether to enable paid tier before degradation.
- [ ] P0.m — **Frontend 100k-marker load test.** Drive the canonical viewport set against a synthetic 100k-hotspot dataset (local data dump per §5.5). Acceptance: zero console errors, **FCP < 3s on 1440×900**, ≥30 FPS interaction on mid-range mobile profile. Threshold rationale: 1440×900 is the canonical desktop viewport; FCP<3s matches Lighthouse "Good" for slow-4G class connections, which is the realistic HN-tail viewer profile. This is the highest-risk frontend item (§5.5) and gates the flip explicitly.

**Phase 0 exit gate:** every checkbox above ticked; monitoring smoke-test runbook is dated within the last 7 days; Shape-2 probe has at least 1 green run on file; CF Pages tripwire (P0.l) verified by a synthetic alert fire; frontend 100k-marker load test (P0.m) passes on all 5 canonical viewports with no console errors and FCP<3s on 1440×900.

### Phase 1 — Cloud SQL cutover (~45 min operator session)

Per `2026-05-17-cloud-sql-migration.md` §6. **Site is still AZ-only during this phase.** Order:

1. P1.a — T1: provision Cloud SQL alongside Neon (`infra/terraform/cloud-sql.tf`).
2. P1.b — T2: mount Cloud SQL socket on read-api / admin-api / ingestor.
3. P1.c — T3: dump Neon → restore Cloud SQL (operator session, no PR).
4. P1.d — T4: cutover commit (Secret Manager version flip + service restart + ingestor resume).
5. P1.e — observe for ≥48h.
6. P1.f — T5: remove Neon (≥48h after T4).

**Phase 1 exit gate:** 48h of clean Cloud SQL operation; T5 merged; cost dashboard shows expected DB line item.

### Phase 2 — frontend pre-flip polish

These can interleave with Phase 0 / Phase 1 but should be all-green before Phase 3.

1. P2.a — Branding sweep (#533).
2. P2.b — CONUS viewport.
3. P2.c — Silhouette curation for high-prevalence US families.
4. P2.d — Smoke at all 5 canonical viewports × 2 themes (canonical PR-screenshot procedure).

### Phase 3 — the flip (one PR)

Per §4 above. Recent + hotspots flip to `'US'`; backfill stays at `'US-AZ'` pending per-state fan-out.

**Phase 3 exit gate:** §4.3 post-flip verification all-pass within the first 24h.

### Phase 4 — post-flip monitoring + cost review

- T+7d cost review: GCP + Cloudflare + Healthchecks.io + Neon (residual until P1.f). Compare against §10 budget.
- T+7d behavior review: rate-limit fire count, S1–S7 alert fire count, Shape-2 probe assertions still green.
- T+30d cost review: full month bill; if outside the §10 band by more than 50%, file an investigation.
- T+30d: open per-state backfill fan-out plan.
- T+30d: open Cornell ToS conversation closure (assuming the user sent the email at Phase 0).

---

## §8 Rollback story

Per-phase reversibility:

| Phase | Reversibility | RTO | Cost of rollback |
|---|---|---|---|
| Phase 0 | High — each component is its own PR, revert is `gh pr revert <N>` | minutes | small per-PR retry cost |
| Phase 1 (Cloud SQL cutover) | **Medium** — reversible only while Neon is still up (between T4 and T5). After T5, rollback is forward-only (`pg_dump` from Cloud SQL to a freshly-provisioned Neon). Per `2026-05-17-cloud-sql-migration.md` §6 rollback: ~15 min RTO via secret-version pin to Neon, ingestor pause+resume, lift Neon read-only. | ~15 min (pre-T5); hours (post-T5) | Cloud SQL stays provisioned ($25/mo idle) |
| Phase 2 (frontend) | High — revert PR; Cloudflare Pages redeploys previous build | minutes | nil |
| Phase 3 (the flip) | **High** — single PR, single revert, recent-ingest goes back to AZ on next cron tick. National observations already ingested remain in the table (no data loss); they age out via the 14-day prune. | next 30-min cron interval (~30 min RTO) | nil; left-behind national data is auto-pruned in 14d |
| Phase 4 | N/A — observation only | — | — |

**Asymmetric reversal points (be deliberate):**

1. **T5 (Neon removal).** Hold ≥48h after T4. Once T5 lands, Neon is gone; rollback requires re-provisioning from scratch. Take a safety `pg_dump` of Cloud SQL to local disk on the day T5 merges, retain 30 days.
2. **RR-3 (schema drop of `region_id`).** Once columns are dropped, restoring them costs a backfill (data lost). Order RR-1 → RR-2 → RR-3 deliberately; do not skip the wait.
3. **Cornell ToS email.** Once sent, cannot be unsent. Send from a project-appropriate email address with a clear scope of use.

---

## §9 External dependencies (timing risks the plan can't control)

### O3 — Cornell ToS conversation

Per Open Question O3 of the analysis report. User owes an email to `ebird@cornell.edu` naming `bird-maps.com`, the use case (public hobby map), the call profile (~100/day under Shape 2), and asking for a posture conversation.

- **Pre-flip posture:** strongest negotiating moment (no monetization, no embed, no press, pre-HN). Send before Phase 3.
- **Response SLA:** none published. Cornell can take days to weeks.
- **Plan does not block on Cornell's response.** A non-response is not a blocker; an explicit "no" or "stop" is.
- **Risk if skipped:** Cornell's first signal could be a key revocation during an HN spike, with no appeal process. The email is unidirectional cheap insurance.

### Rec 1D — EBD data-request form

7-day approval lag (`analysis-report.md` Rec 1D). Filing preserves Option 2D (EBD-augmented historic) as a later additive layer. Cost: ~10 minutes; commitment cost: zero.

- **Pre-flip:** ideally filed at the same time as O3.
- **Risk if skipped:** Option 2D becomes a 7-day-delayed extension instead of an additive layer ready at need.

---

## §10 Cost projection

Numbers sourced from `analysis-report.md` Tables A–B + `2026-05-17-cloud-sql-migration.md` §7. Monthly USD.

| Phase | Compute | DB | Egress | Storage | Total |
|---|---|---|---|---|---|
| AZ today | <$1 | $0 (Neon Free) | <$1 | $0 | **<$5** |
| AZ + monitoring + rate-limit + prune (Phase 0 complete, pre-Cloud SQL) | <$1 | $0 | <$1 | $0 | **<$5** |
| AZ on Cloud SQL (Phase 1, pre-flip) | <$1 | ~$25 | <$1 | <$1 | **~$27** |
| **National launch (Phase 3 complete, 25× audience baseline)** | ~$5 | ~$25 | <$1 (intra-region) | ~$1 | **~$32** |
| **National steady-state (200× audience tail, HN spike absorbed)** | ~$15–30 | ~$25–45 (one tier up) | <$1 | ~$2 | **~$45–80** |

Cost band reconciles with `analysis-report.md` 50-state Table B Shape 2 + Cloud SQL row (~$80/mo upper bound).

**Budget alerts (set during Phase 0):**

- GCP project `bird-maps-prod` budget alert at $50/mo (50% of upper-band) and $100/mo (hard ceiling).
- Cloudflare account dashboard: enable Workers paid-tier opt-in disabled (stay on free tier; runaway Worker bills $5/10M requests once paid is enabled — keep off until needed).
- Healthchecks.io: free-tier covers v1 (20 checks vs ~6 used).
- Neon: removed in T5; budget alert no longer relevant.

**Egress sanity:** at 99.91% miss × 200× audience the projected egress is dominated by GCP→Cloudflare PoP (free for our pattern, intra-region us-west1 → Cloudflare). The pre-Cloud SQL number ($230/mo Neon-side at HN-scale) is the avoided cost, not a planned cost.

---

## §11 Open questions surfaced during this planning exercise

1. **Per-state backfill fan-out scope.** Backfill stays at `US-AZ` in the literal flip per §4.4. The per-state fan-out is its own architecture decision: 50 sequential calls per day × 19 days = 950 calls/day (well inside eBird's tolerance) but the wall-clock cost is non-trivial (current AZ backfill p50 is 645s; 50× sequential is unviable). Likely shape: a Cloud Workflow that fans out 50 parallel state backfills with per-state pacing. **Files as an open question.**
2. **iNaturalist `place_id=40` photo lookup.** National species not yet observed in AZ will have no `place_id=40` photo; the fallback path works but introduces a UX asymmetry (AZ species get higher-quality place-scoped photos). Switching to global lookup is one line but changes AZ photo quality. Not a blocker; needs a one-shot product call.
3. **Phenology month-boundary timezone.** `packages/db-client/src/species.ts:251` uses `America/Phoenix` for phenology month boundaries. National data spans timezones; the right answer is probably UTC, but it changes existing data. **Files as an open question** for a v1.1 follow-up.
4. **Hotspot density at 100k markers.** The cluster + adaptive-grid layers haven't been load-tested at national scale. Browser-side smoke at the canonical viewport set is the highest-risk pre-flip frontend item.
5. **Cloud SQL HA at scale.** Currently zonal; if HN-scale traffic surfaces a single-zone availability incident in the first 30 days, flip to REGIONAL ($25 → $50/mo). Document the trigger as "any availability incident attributable to zone failure in the first 30 days".
6. **Cloudflare Pages request-count caps.** Phase 0 of the analysis brief flagged this as a suspected unknown. The free tier has a 100k requests/day cap; at 200× HN spike that's 4 hours of viral attention before paid tier kicks in. **Decision: keep Pages on free tier**; if the cap fires, the static frontend serves 1000-class errors briefly. Acceptable degradation; revisit if it happens.

---

## §12 Task breakdown

Most of this work is split across other plans. This section points at them rather than duplicating tasks.

| Phase | Component | Plan / PR / Issue | Subagent invocation |
|---|---|---|---|
| 0 | Monitoring impl | `docs/plans/2026-05-17-monitoring-and-alerts.md` Tasks 3–7 | `superpowers:subagent-driven-development` against the monitoring plan |
| 0 | Shape-2 probe | `docs/plans/2026-05-17-shape-2-rollup-probe.md` + PR #599 | merge PR #599; verify first green run |
| 0 | Prune | PR #595 | merge |
| 0 | Rate-limit | PR #597 | merge; smoke under synthetic load |
| 0 | Region-removal RR-1 | `docs/analyses/2026-05-14-region-removal-audit/00-synthesis.md` PR 1 | new subagent dispatch; ~1 PR |
| 0 | Branding sweep #533 | issue #533 + audit PR 5b | new subagent dispatch; frontend PR with full canonical viewport screenshot set |
| 0 | CONUS viewport | this plan §5.1 | small PR; bundle with branding sweep if convenient |
| 0 | Silhouette curation | `curating-fallback-silhouettes` skill | iterative operator session; no PR per family |
| 0 | Budget alerts | this plan §10 | small infra PR; one Terraform commit |
| 1 | Cloud SQL execution | `docs/plans/2026-05-17-cloud-sql-migration.md` T1–T5 | sequential subagent dispatch per task; operator session for T3/T4 |
| 2 | Frontend polish | bundled in P0.h / P0.i / P0.j | (no new dispatch) |
| 3 | The flip | this plan §4 | small subagent dispatch; ~1 PR; all preconditions verified |
| 4 | Post-flip review | this plan §7 Phase 4 | operator-driven, not a code PR |
| 4 | Per-state backfill fan-out | new plan (not yet written) | T+30d follow-up |

---

## §13 Honest open items

- **The Shape-2 contract has a sample-size-of-one-day.** The probe (`2026-05-17-shape-2-rollup-probe.md`) addresses this with weekly re-sampling, but the flip itself ships on a still-incomplete sample. If the probe fails post-flip, the rollback story is fast (§8) and the per-state backfill fan-out becomes the fallback shape.
- **The 200× multiplier is a tail estimate, not a measured number.** HN spikes are bounded by HN's own front-page volume (~tens of thousands of visits over a day at most). Cloud Run's scale-up is monotonic; the rate-limit and TTL cache absorb the rest. Watch the first viral moment and tune.
- **No critic pass was run on this umbrella plan.** It was assembled from the analysis report, the cache-hit measurement, and three sibling plans + one audit. A read-through by a fresh agent before Phase 3 is recommended; the flip itself is small but the precondition list is long.
- **Cornell's response could arrive between Phase 0 and Phase 3.** If Cornell says "stop," the flip is off. If Cornell says "talk to us about commercial," the flip can proceed with the conversation as a parallel track. Plan does not branch on this; document the response and revisit at the next phase boundary.
- **The `services/ingestor/src/run-photos.ts` iNat place_id=40 hard-code is a known UX asymmetry.** Filed under §11 open question #2; not a blocker but should not be forgotten.

---

## Methodology

Plan produced by a single-pass agentic write-up off five inputs: (1) the 2026-05-14 analysis funnel report at `docs/analyses/2026-05-14-process-scale-options/phase-4/analysis-report.md`; (2) the 2026-05-17 Cloudflare cache-hit measurement at `cache-hit-ratio.md`; (3) the three sibling plans dated 2026-05-17 (Cloud SQL migration, monitoring, Shape-2 probe); (4) the 2026-05-14 region-removal audit at `docs/analyses/2026-05-14-region-removal-audit/00-synthesis.md`; (5) a fresh grep of `services/ingestor/src/` and `frontend/src/` for hard-coded `US-AZ` / `Arizona` references at writing time. No multi-pass critic loop; recommend one pre-Phase-3.
