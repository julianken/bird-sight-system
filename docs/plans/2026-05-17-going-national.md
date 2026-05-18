# Going National — umbrella plan (AZ → CONUS at HN-scale)

> **For agentic workers:** This is an **umbrella** plan, not an executable one. Component PRs and execution-grade plans live in sibling files (see §3 status matrix). This document sequences them, names the literal flip, and records what was decided in the 2026-05-14 → 2026-05-17 working window. Use `superpowers:subagent-driven-development` against the component plans, not this one.

**Date:** 2026-05-17 (original); **Amended:** 2026-05-18 (R1–R5, R-Cornell); **Re-amended:** 2026-05-18 (R6 — R1 reversed)
**Author:** Julian (orchestrated)
**Triggering analysis:** `docs/analyses/2026-05-14-process-scale-options/phase-4/analysis-report.md` (17-agent funnel, the funnel that produced this commitment).
**Triggering measurement:** `docs/analyses/2026-05-14-process-scale-options/cache-hit-ratio.md` — 99.91% (30d) cache-miss on `bird-maps.com`, ~17× the egress break-even.
**Decision:** going national at **200× audience multiplier** (HN-front-page tail, per Tension 2 / Open Question O5 of the analysis report).

---

## §0 Amendment log

### 2026-05-18 — R6: R1 reversed (Cloud SQL back to pre-flip)

Reversed R1's Cloud SQL deferral. Cloud SQL T3–T5 moved back to Phase 1 (pre-flip). Driver: **operational safety > cost optimization** at this scale. Migrating the DB at AZ-only volume is safer than migrating under national load; the small migration window is calmer when there's no audience to disrupt. Trade-off: ~$5–10/mo premium during AZ-only ramp (Neon Launch + Cloud SQL `db-g1-small` both live until T5 tears Neon down) accepted as a **risk-reduction tax**. Sections touched: §0, §2 item 2, §3 D4 + status rows, §4.1 pre-conditions, §7 Phases (Cloud SQL stages moved Phase 4 → Phase 1; Phase 4 retains only Cornell, silhouettes, cost reviews), §10 cost band, §11 Q5. The R1 framing (cost-driven deferral, post-flip trigger) is superseded; references to R1 in this document now read as historical context only.

### 2026-05-18 — execution-window decisions baked in

Source: dashboard-critic agent pass against the 2026-05-17 draft plus 5 structural reorderings approved by Julian during execution. Summary:

- **Cornell ToS moves pre-flip → post-flip.** §9 and §11 risk-wording were drafted assuming pre-flip negotiation. Updated: send the email **after** Phase 3 with the real call profile (~120 calls/day verified per Shape-2 probe + Finding 8 of the funnel) in hand. Rationale: post-flip evidence is stronger leverage than pre-flip projection, and the actual call volume is well inside Cornell's tolerance — so the HN-spike-revocation risk is the price we accept for evidence-based outreach.
- **R1 — Cloud SQL migration deferred from Phase 1 (hard pre-flip gate) → Phase 4 (post-flip optimization).** ~~Stages T1+T2 (provisioning + Auth Proxy mount) shipped pre-flip as completed prep work and stay where they are; T3/T4/T5 move into Phase 4. Rationale: financially only pays off at expansion scale (per analysis report cache-miss math); Neon Launch handles AZ + early national; migration is reversible with ~15min RTO (per migration plan §6); deferring removes a pre-flip blocker.~~ **Superseded by R6 (2026-05-18): reversed. Cloud SQL T3–T5 are pre-flip; operational safety trumps cost optimization at this scale.**
- **R2 — Per-state backfill fan-out moves from Phase 4 (T+30d) → Phase 3.5, staged-with-flip.** Concurrent with flip stability monitoring; backfill staggers over days, not hours, so the umbrella stays solvent if it slips. Rationale: "flip → 30d wait → backfill" leaves national history sparse for a month inside the 14d prune window.
- **R3 — Silhouette coverage curation demoted from Phase 0 hard pre-condition → Phase 4 polish.** Flip ships with `_FALLBACK` SVG; Alcidae, Gaviidae, Sulidae etc. curated post-flip. Note: this is distinct from the `colorDark` test+type fix (#604/#610), which was not coverage work.
- **R4 — Server-side bbox filtering added as a Phase 2 hard pre-condition.** Source: `docs/analyses/2026-05-17-hotspot-density-100k-viability/report.md` — at national scale `/api/observations` returns ~24 MB without bbox; that's a real UX gate. Tracked under §5.6 below. Distinct from #608 (frontend 100k-marker load test) and #568 (SpeciesDetailSurface client-side bbox follow-up); a new server-side tracking issue is owed.
- **R5 — The flip is staged in two steps: (a) recent first, monitor 24h, (b) hotspots after recent stable.** Rationale: recent is higher-traffic, isolating it surfaces problems faster; hotspots is lower-volume and lower-risk. Reduces total surface area in any single rollback window.
- **Stage naming:** Phase 1 stages normalized to T1–T5 (drop the mixed "Stage N / T-N" naming).
- **Phase 0 exit gates P0.k / P0.l / P0.m** confirmed explicit in §7 with exit-gate semantics (already named in draft; verified discoverable, not buried).
- **§11 product-question wording** clarified: PR #609 landed the *plumbing* for iNat `place_id` and phenology-timezone parameterization; the product *choice* (global vs configurable; UTC vs per-observation-tz) remains open.
- **Phase 3 / Phase 3.5 boundary** clarified: Phase 3 remains the phase boundary that names the flip itself (Step A → Step B over ≥24h), and Phase 3.5 is an **overlapping sibling** that runs concurrent with Phase 3/4 stability monitoring rather than a successor phase. The Phase 3 heading is kept as-is — "flip window" framing lives in §4 + §7 prose, not in the heading.

---

## §1 Goal and non-goals

### Goal — what "going national" means concretely

1. **Ingest expands from `US-AZ` to `US`.** The recent-lane recent-ingest cron flips from `regionCode: 'US-AZ'` to `regionCode: 'US'` and starts pulling **Shape 2** species-rollup data for the entire continental US (~683 species/day, ~2 eBird calls/day for the rollup — see Finding 5 of the analysis report). Per-state Shape 3 backfill remains state-scoped because `/historic` is not species-rolled up.
2. **Cloud SQL migrated pre-flip (R6, 2026-05-18, reversing R1).** Per `docs/plans/2026-05-17-cloud-sql-migration.md`, the database moves from Neon (AWS us-west-2) to Cloud SQL Postgres 16 (GCP us-west1, `db-g1-small`, zonal) **before the national flip**. All five stages (T1–T5: provision, Auth Proxy mount, `pg_dump`/`pg_restore`, secret-version flip, Neon teardown) complete pre-flip. Rationale: migrate the DB at AZ-only volume to validate the new infra before adding national traffic. The ~$5–10/mo premium during the AZ-only ramp (both DBs live until T5) is the **operational-safety tax** — a calmer migration window beats short-term cost optimization. Reversible at ~15min RTO between T4 and T5 (§8). The cross-cloud egress arbitrage (~$230/mo at expansion scale) materializes only later; it's a fringe benefit of being on Cloud SQL when national traffic arrives, not the reason for the move.
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
| D4 | DB platform: **Cloud SQL collocated in GCP us-west1**, migrated **pre-flip** per R6 (2026-05-18, reversing R1). Full migration (T1–T5) completes before Phase 3a. Rationale: operational safety > cost optimization — migrating at AZ-only volume is safer than under national load. ~$5–10/mo premium during ramp accepted as risk-reduction tax. | Recommendation 2B; `cache-hit-ratio.md` (99.91% miss, 17× break-even); R6 amendment §0 |
| D5 | **14-day rolling retention** via the prune job (issue #587 / PR #595). | Recommendation 2C-adjacent (lean storage) + national row-count math |
| D6 | Heartbeat strategy: **Healthchecks.io** (free tier), not Cloud Monitoring custom-metric absent-for. | `2026-05-17-monitoring-and-alerts.md` §"Heartbeat strategy" + D2 decision |
| D7 | Audience protection: Tier-1 **rate limit ships before the flip** (PR #597). | Tension 2; Recommendation 1E |
| D8 | TTL caching on read-API ships before the flip (PR #592 merged). | Recommendation 1E-adjacent (Cloudflare cache-miss is independently worth ~$50/mo at national) |
| D9 | Shape-2 contract probe ships **as a sibling**, not folded into monitoring. | `2026-05-17-monitoring-and-alerts.md` §"Shape 2 re-sample" + `2026-05-17-shape-2-rollup-probe.md` |
| D10 | Cloud SQL launches **zonal, no HA**. Flip to REGIONAL is a single Terraform commit later. | `2026-05-17-cloud-sql-migration.md` §2 sizing |
| D11 | EBD data-request form (Recommendation 1D) and Cornell ToS outreach (O3) **are owed by the user**; the plan does not block on them but documents them as timing risks. | `analysis-report.md` §I |
| D12 | Phenology endpoint **stays** (Option 2C drop is off the table for v1). | Frontend grep shows phenology consumed by `SpeciesDetailSurface`; product call |
| D13 | Region-table treatment: **dropped entirely** — issue #532 closed; PR-1 (#534), PR-2 (#535), PR-3 (#536), PR-4 (#537) all merged. RR-1..RR-4 are complete; only RR-5b (Arizona branding sweep, #533) remains and is tracked as a separate row. | issue #532; migrations 1700000039000–1700000045000 on `main` |
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
| Region-table cleanup (RR-1..RR-4) | #532 | #534, #535, #536, #537 | **merged** | nothing; regions table + `region_id` columns gone from `main`. RR-5b (branding sweep #533) tracked separately below. |
| "Arizona" branding sweep | #533 | not opened | **not started** | wider-scope frontend PR; can interleave |
| Silhouette coverage extension (US-only families) | — | — | **not started** | audit `/api/silhouettes` for null families that appear in national data (Alcidae, Gaviidae, etc.); curate via `curating-fallback-silhouettes` skill |
| Frontend default viewport (CONUS) | — | — | **not started** | edit `INITIAL_VIEW` in `frontend/src/components/map/MapCanvas.tsx:246` from AZ center to CONUS center + zoom 4 |
| The literal flip | — | — | **not started** | edit `regionCode: 'US-AZ'` → `'US'` in `services/ingestor/src/cli.ts` (3 sites) + `services/ingestor/src/handler.ts` (3 sites) |
| Cloud SQL execution T1+T2 (prep) | — | shipped | **shipped** | provisioning + Auth Proxy mount; both DBs live during ramp |
| Cloud SQL execution T3/T4/T5 (cutover) | — | not opened | **pre-flip per R6 (2026-05-18) — Phase 1** | per `2026-05-17-cloud-sql-migration.md`; ~30–40h; completes before Phase 3a (the flip) |
| Cornell ToS outreach (O3) | — | — | **user owes — post-flip per R-Cornell (2026-05-18)** | email `ebird@cornell.edu` post-flip (Phase 4 P4.a) with real call-profile evidence (~120/day verified) in hand |
| EBD data-request form (Rec 1D) | — | — | **user owes** | 1 form, 7-day approval lag; preserves Option 2D as a later layer |

---

## §4 The literal flip

The flip is **staged across two PRs** (R5, 2026-05-18) targeting two files. After Step A lands, the recent-ingest cron pulls US-wide species-rollup data; Step B lands ≥24h later if recent is stable. All other phases of this plan exist to make these PRs safe to ship.

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

- [ ] Cloud SQL migration complete (T1–T5 all landed; Neon torn down). **Per R6 (2026-05-18), the full migration is pre-flip** — Cloud SQL must be primary, Neon gone, ≥48h elapsed since T5, before Phase 3a opens. Rationale: validate the new infra at AZ-only volume; do not stack DB migration risk on top of national-traffic risk.
- [ ] Monitoring Tasks 1–7 all merged; smoke tests pass for each S1–S7 alert (operator-verified, runbook dated).
- [ ] Healthchecks.io heartbeat green on `bird-ingest-recent` for ≥48h.
- [ ] Audience rate-limit (#597) merged and proven against synthetic load (~5× baseline RPS sustained, no false-positive 429s).
- [ ] Prune job (#595) merged; at least one nightly run completed; row count steady within 14-day window.
- [ ] Shape-2 probe (#599) merged; **at least one green workflow run** posted to `o2-probe-history.csv`. If the probe fires on the day of the flip PR, defer the flip.
- [ ] Frontend default viewport changed to CONUS (separate PR, can ship beforehand without ingestor changes — at AZ ingest, a CONUS map just shows no markers outside AZ; that's acceptable as a brief intermediate state).
- [ ] **Server-side bbox filtering on `/api/observations` shipped** (Phase 2 hard pre-condition — see §5.6). Without this, national `/api/observations` returns ~24 MB; this is the next bottleneck per `docs/analyses/2026-05-17-hotspot-density-100k-viability/report.md`.
- [ ] Cost alerts set on the GCP project (see §10).
- [x] Region-table cleanup complete (#532 PR-1..PR-4 all merged: #534, #535, #536, #537). Ingest path no longer writes `region_id`; columns and `regions` table are dropped from `main`.

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

### §4.4 Sub-decision: flip staging (R5, 2026-05-18 amendment)

The flip ships in **two PRs**, not one. Recent and hotspots are decoupled.

**Step A — flip `recent` only.** Higher-traffic surface; isolating it surfaces problems faster. Monitor ≥24h post-merge against §4.3 verification checklist before progressing.

```
services/ingestor/src/cli.ts      Line 122 (recent)
services/ingestor/src/handler.ts  Line 42 (recent)
```

**Step B — flip `hotspots` after recent is stable.** Lower volume, lower risk. Decoupling reduces total surface area in any single rollback window: if recent destabilizes, hotspots is untouched; if hotspots destabilizes after step A landed, we already know recent is healthy.

```
services/ingestor/src/cli.ts      Line 124 (hotspots)
services/ingestor/src/handler.ts  Line 44 (hotspots)
```

`hotspots` (`/data/ref/hotspot/{region}`) returns one record per hotspot. US-wide returns ~100k records; the hotspot ingest already runs weekly so one week of US-wide is acceptable load.

**Backfill (`cli.ts:126`, `cli.ts:149`, `handler.ts:47`)** is **not** part of the literal flip — `/historic` is not species-rolled up and a US-wide call returns hundreds of thousands of rows per day. Per R2 (2026-05-18) the per-state Shape 3 fan-out is opened as **Phase 3.5**, concurrent with flip stability monitoring. Backfill calls stay at `'US-AZ'` until the fan-out lands (see §7 Phase 3.5).

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

### §5.4 Silhouette coverage (Phase 4 polish — demoted per R3, 2026-05-18)

**No longer a pre-flip gate.** The flip ships with the existing `_FALLBACK` SVG covering any uncurated family; users see a generic silhouette for new national families until curation lands as Phase 4 polish. Distinct from PR #604/#610 (silhouette `colorDark` test+type fix), which was not coverage work.

National data introduces families not present in AZ. Audit procedure (run post-flip, drives Phase 4 curation queue):

```sh
curl -s 'https://api.bird-maps.com/api/silhouettes' \
  | jq -r '.families[] | select(.svgData == null and .svgUrl == null) | .familyCode'
```

Cross-reference with families appearing in `GET /v2/data/obs/US/recent?back=14&maxResults=10000`. Families likely to surface that are absent or rare in AZ: **Alcidae** (auks), **Gaviidae** (loons), **Procellariidae** (shearwaters), **Sulidae** (boobies/gannets), **Pelecanidae** (browns/whites). Curate via the `curating-fallback-silhouettes` skill before the flip; species without a curated silhouette fall back to `_FALLBACK` (working, just generic).

### §5.5 Hotspot density

National hotspot count is on the order of 100k vs AZ's ~3k. The map's existing cluster + adaptive-grid logic (PR #553 + ancestors) handles this in principle but has not been load-tested. Browser-side smoke at 100k hotspots is the highest-risk frontend item; verify with a local data dump and the Lighthouse-style harness already in use for canonical viewports. Tracked as Phase 0 exit gate P0.m (issue #608). If FPS degrades below 30 on the mid-range mobile profile, file a follow-up for a hotspot-density LOD pass before the flip.

### §5.6 Server-side bbox filtering on `/api/observations` (R4 — Phase 2 hard pre-condition, 2026-05-18)

**Added by 2026-05-18 amendment.** Source: `docs/analyses/2026-05-17-hotspot-density-100k-viability/report.md` — at national scale `/api/observations` returns approximately **24 MB** without bbox constraint. That payload size is the next bottleneck after rendering: it dominates TTFB on slow-4G HN-tail connections, defeats Cloudflare cache (objects too large for some PoP tiers), and makes mobile cold-load unworkable.

**Requirement:** `/api/observations` must accept and enforce a `bbox` query parameter (west,south,east,north). The frontend always sends the current viewport bbox on map-load and after pan/zoom (debounced). Server queries become `WHERE ST_Intersects(geom, ST_MakeEnvelope(...))` against the existing PostGIS GIST index — no new index needed.

**Distinct from existing tracking:**
- **#608** = frontend 100k-hotspot load test (Phase 0 exit gate, render-side).
- **#568** = `SpeciesDetailSurface` client-side bbox follow-up for species detail observations threading.
- **This** = `/api/observations` *server-side* bbox enforcement at the read-API tier.

**Tracking issue: not yet opened.** Open during Phase 2 planning; reference this section and the viability report.

**Acceptance:** at national scale, `GET /api/observations?bbox=<viewport>` returns payload ≤ ~500 KB at 1440×900 zoom 4 (CONUS-wide). Verify under the synthetic 100k-hotspot harness from P0.m before Phase 3.

---

## §6 Region-table treatment

**Decision (D13): dropped entirely.** Status as of 2026-05-17: **complete on `main`.** The 2026-05-14 region-removal audit referenced by earlier drafts of this plan was never authored as a standalone document — the work shipped directly under issue #532 in four sequential PRs, matching the RR-1..RR-4 breakdown below.

Rationale (preserved for posterity):
- 9-region AZ-only ecoregion shape doesn't carry to 50 states without re-curation.
- Drop deletes the unfixed `upsertHotspots` O(table) UPDATE (Rec 0C of the analysis report) as an incidental win.
- 458 unstamped observations + 65 unstamped hotspots become moot — they disappear with the column.
- Spatial substrate (PostGIS `geom` columns + GIST indexes) is **kept**; future 50-state spatial queries (bbox, radius, nearest) use them.

### §6.1 PR sequence (shipped, not pending)

| # | Title | PR | Status |
|---|---|---|---|
| RR-1 | Stop writing `region_id` (ingest path) | #534 | merged |
| RR-2 | Drop `regionId` from the wire shape | #535 | merged |
| RR-3 | Drop schema (migrations 1700000039000–1700000045000) | #536 | merged |
| RR-4 | Spec + CLAUDE.md + README + PR template cleanup | #537 | merged |
| RR-5b | (optional, may interleave) Drop "Arizona" branding (issue #533) | not opened | **not started** — tracked separately below and in §3 |

Verification (run 2026-05-17 against `main`):

```
$ grep -rEn "region_id|regionId" services/ packages/ frontend/src/ \
    | grep -v node_modules | grep -v ".test." \
    | grep -vE ":[0-9]+:\s*(//|\*|--)"
# (no output — zero non-comment references remain)
```

### §6.2 Sequencing relative to the flip

RR-1..RR-4 are all merged ahead of the literal flip, which satisfies the original "RR-1 must land before the flip" ordering constraint by a wide margin. The remaining branding sweep (RR-5b / #533) is tracked in §3 and Phase 0 (P0.i); it can ship any time and is recommended before the flip so the live site doesn't claim "Arizona" while serving national data.

---

## §7 Cutover sequence

Linear phases as restructured by the 2026-05-18 amendments (R2, R3, R5, R6 — R6 reversed R1). Each phase names what can ship pre-national-in-production and what is the cutover itself.

### Phase 0 — pre-conditions (ship now; AZ remains live)

These all land while the site is still serving AZ-only. Multiple can ship in parallel.

- [x] P0.a — TTL caching live (#592, merged 2026-05-17)
- [ ] P0.b — Nightly prune live (#595, queued)
- [ ] P0.c — Monitoring Tasks 1+2 (#598, queued)
- [ ] P0.d — Monitoring Tasks 3–7 (Terraform + secrets + runbook + smoke; not started)
- [ ] P0.e — Audience rate-limit (#597, queued)
- [ ] P0.f — Shape-2 probe live (#599, queued; ≥1 green run required)
- [x] P0.g — Region cleanup RR-1..RR-4 (#532 closed; #534, #535, #536, #537 merged)
- [ ] P0.h — Frontend CONUS viewport (not started; can ship with AZ ingest, will just show empty outside AZ briefly)
- [ ] P0.i — Branding sweep #533 (not started; recommended pre-flip)
- [ ] ~~P0.j — Silhouette coverage curation~~ **Demoted to Phase 4 polish per R3 (2026-05-18); flip ships with `_FALLBACK` SVG.**
- [ ] P0.k — Cost budget alerts (§10)
- [ ] P0.l — **Cloudflare Pages request-count tripwire.** Configure CF analytics/notification alerts on the Pages project at **80k requests/day (warning)** and **95k requests/day (critical)** — the free-tier cap is 100k/day (§11 Q6). Wire into the same notification channel as the monitoring plan's S1–S7 (email `julian.kennon.d@gmail.com`). Rationale: at 200× HN tail the cap is reachable in ~4h of viral attention; the tripwire gives ~20% headroom to decide whether to enable paid tier before degradation. **Phase 0 exit-gate semantics: required.**
- [ ] P0.m — **Frontend 100k-marker load test (issue #608).** Drive the canonical viewport set against a synthetic 100k-hotspot dataset (local data dump per §5.5). Acceptance: zero console errors, **FCP < 3s on 1440×900**, ≥30 FPS interaction on mid-range mobile profile. Threshold rationale: 1440×900 is the canonical desktop viewport; FCP<3s matches Lighthouse "Good" for slow-4G class connections, which is the realistic HN-tail viewer profile. This is the highest-risk frontend item (§5.5) and gates the flip explicitly. **Phase 0 exit-gate semantics: required.**

**Phase 0 exit gate:** every unticked checkbox above ticked (P0.j demoted, not required); monitoring smoke-test runbook is dated within the last 7 days; Shape-2 probe has at least 1 green run on file; CF Pages tripwire (P0.l) verified by a synthetic alert fire; frontend 100k-marker load test (P0.m) passes on all 5 canonical viewports with no console errors and FCP<3s on 1440×900.

### Phase 1 — Cloud SQL migration (R6, 2026-05-18 amendment — reverses R1)

**Per R6, the full Cloud SQL migration runs pre-flip.** All five stages complete before Phase 3a opens. Rationale: migrate at AZ-only volume so the new infra is validated before national traffic lands. The ~$5–10/mo cost premium during the AZ-only ramp (both DBs live until T5) is the operational-safety tax.

- [x] T1 — provision Cloud SQL alongside Neon (`infra/terraform/cloud-sql.tf`). **Shipped.**
- [x] T2 — mount Cloud SQL Auth Proxy on read-api / admin-api / ingestor. **Shipped.**
- [ ] T3 — `pg_dump` from Neon, `pg_restore` into Cloud SQL; verify row counts and PostGIS extension parity.
- [ ] T4 — flip the DB-URL secret version; ingest pause/resume; verify read-api + admin-api + ingestor all read/write Cloud SQL cleanly.
- [ ] **48h warm rollback window** — Neon stays live and in read-only for 48h after T4. Reversal during this window is a single secret-version pin back to Neon (~15min RTO, §8). No flip-related work may begin during this window.
- [ ] T5 — tear down Neon (Terraform destroy of `kislerdm_neon_project`); take a final safety `pg_dump` of Cloud SQL to local disk on the day T5 lands; retain 30 days.

**Phase 1 exit gate:** Cloud SQL primary; Neon torn down; ≥48h elapsed since T4 (i.e. T5 has merged or the warm-rollback window is closed); read-api + admin-api + ingestor all green against Cloud SQL for ≥24h; one full nightly prune cycle has run cleanly post-T5.

### Phase 2 — frontend + read-API pre-flip polish

These can interleave with Phase 0 but should be all-green before Phase 3.

1. P2.a — Branding sweep (#533).
2. P2.b — CONUS viewport (§5.1).
3. P2.c — **Server-side bbox filtering on `/api/observations`** (§5.6, R4, 2026-05-18). **Hard pre-condition for Phase 3.** Open a tracking issue; ship as a read-API PR.
4. P2.d — Smoke at all 5 canonical viewports × 2 themes (canonical PR-screenshot procedure).

**Phase 2 exit gate:** P2.c verified against the synthetic 100k-hotspot harness — `/api/observations?bbox=<viewport>` returns ≤ ~500 KB at 1440×900 zoom 4.

### Phase 3 — the flip (two PRs, staged per R5)

Per §4 above. Two-step staging (2026-05-18):

- **Phase 3 Step A — flip `recent` only** (`cli.ts:122`, `handler.ts:42`). Monitor §4.3 verification ≥24h.
- **Phase 3 Step B — flip `hotspots`** (`cli.ts:124`, `handler.ts:44`) after recent stable.

Backfill stays at `'US-AZ'` pending Phase 3.5 fan-out.

**Phase 3 exit gate:** §4.3 post-flip verification all-pass within the first 24h of Step A; Step B verification clean within 24h of Step B merge.

### Phase 3.5 — per-state backfill fan-out (R2, 2026-05-18, staged-with-flip)

**Concurrent with Phase 3 / 4 stability monitoring, not a T+30d follow-up.** Opens the per-state Shape 3 backfill so national history fills into the 14d prune window the same week the flip lands, instead of leaving a month-long sparse history.

- Phase 3.5 is **not** a single PR; per-state Shape 3 calls stagger over days (not hours) to stay inside eBird tolerance and Cloud Run scale guards.
- The umbrella stays solvent if Phase 3.5 slips — Phase 3 verification does not depend on backfill completion. Step A / Step B monitoring continues against the §4.3 checklist regardless.
- See §11 Q1 for the open architecture question on fan-out shape (Cloud Workflow with 50 parallel state backfills + per-state pacing is the likely shape).

### Phase 4 — post-flip optimization, monitoring, polish

- **P4.a — Cornell ToS outreach** with real call-profile evidence (Shape-2 probe assertions + ingest logs) in hand. See §9 (R-Cornell, 2026-05-18).
- **P4.b — Silhouette coverage curation** (R3, 2026-05-18) for Alcidae, Gaviidae, Sulidae, etc. Iterative via `curating-fallback-silhouettes` skill; not a single PR.
- T+7d cost review: GCP + Cloudflare + Healthchecks.io + Neon. Compare against §10 budget.
- T+7d behavior review: rate-limit fire count, S1–S7 alert fire count, Shape-2 probe assertions still green.
- T+30d cost review: full month bill; if outside the §10 band by more than 50%, file an investigation.
- T+30d: Cornell response review; revisit posture if needed.

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
2. **RR-3 (schema drop of `region_id`).** Already shipped (#536); recorded here as a historical asymmetric point. The RR-1 → RR-2 → RR-3 ordering was honored. Restoring the columns now would cost a backfill (data lost); no rollback is planned.
3. **Cornell ToS email.** Once sent, cannot be unsent. Send from a project-appropriate email address with a clear scope of use.

---

## §9 External dependencies (timing risks the plan can't control)

### O3 — Cornell ToS conversation (R-Cornell, 2026-05-18: post-flip)

Per Open Question O3 of the analysis report. User owes an email to `ebird@cornell.edu` naming `bird-maps.com`, the use case (public hobby map), the **real measured call profile (~120/day under Shape 2, per the Shape-2 probe + Finding 8 of the funnel)**, and asking for a posture conversation.

**Revised timing (2026-05-18):** send **post-flip** (Phase 4, P4.a), not pre-flip. The pivot reason: post-flip evidence is stronger negotiating leverage than pre-flip projection. With ~120 calls/day verified — well inside Cornell's published tolerance for hobby projects per Finding 8 — the conversation opens with "here's what we're actually doing" instead of "here's what we project we'll do." Cornell's reviewers respond better to measurement than to plans.

- **Response SLA:** none published. Cornell can take days to weeks.
- **Plan does not block on Cornell's response.** A non-response is not a blocker; an explicit "no" or "stop" is, and triggers a §8 Phase-3-style rollback (revert recent → `'US-AZ'`).
- **Risk we accept:** Cornell's first signal could be a key revocation during an HN spike, with no appeal process. **We accept this risk** because Shape 2's actual call volume (~120/day verified, per Finding 8 of the funnel) is well inside Cornell's tolerance — the probability of an unprompted revocation at this call profile is low, and the value of evidence-based outreach is high. Pre-flip projection-based outreach was the original plan; the 2026-05-18 amendment swaps to post-flip evidence-based.

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
| AZ + monitoring + rate-limit + prune (Phase 0 complete) | <$1 | $0 (Neon Free) | <$1 | $0 | **<$5** |
| Cloud SQL provisioned alongside Neon (T1+T2 shipped) | <$1 | ~$25 (Cloud SQL idle) + ~$0–19 (Neon) | <$1 | <$1 | **~$25–45** |
| **AZ-only ramp during Cloud SQL migration (T3–T5 in flight, both DBs live)** | <$1 | ~$25 (Cloud SQL) + ~$19 (Neon Launch) | <$1 | <$1 | **~$45** |
| **Cloud SQL primary, Neon torn down (post-T5, still AZ-only)** | <$1 | ~$25 (Cloud SQL) | <$1 | <$1 | **~$30** |
| **National launch (Phase 3 complete, 25× audience baseline) — Cloud SQL primary** | ~$5 | ~$25 (Cloud SQL) | <$1 (intra-region for cached traffic) | ~$1 | **~$35** |
| **National steady-state (200× audience tail, HN spike absorbed) — Cloud SQL primary** | ~$15–30 | ~$25–45 (Cloud SQL one tier up if needed) | varies with miss-rate | ~$2 | **~$45–80** |

**Cost-vs-risk trade-off (R6):** The pre-flip migration carries a small cost premium — roughly ~$5–10/mo for the duration of the AZ-only ramp (Cloud SQL ~$25/mo from go-live, versus what would have been Neon Free / Neon Launch at ~$0–19/mo had the migration been deferred). The cross-cloud egress arbitrage (~$230/mo at expansion scale) does not yet apply at AZ volume, so during the ramp this premium buys *only* infra validation and migration calm — no offsetting savings. We accept that explicitly: operational safety > short-term cost optimization. Once national traffic lands, Cloud SQL's intra-region egress to Cloudflare turns the premium into a savings against the post-flip counterfactual. Cost band reconciles with `analysis-report.md` 50-state Table B Shape 2 + Cloud SQL row (~$80/mo upper bound at national steady-state).

**Budget alerts (set during Phase 0):**

- GCP project `bird-maps-prod` budget alert at $50/mo (50% of upper-band) and $100/mo (hard ceiling).
- Cloudflare account dashboard: enable Workers paid-tier opt-in disabled (stay on free tier; runaway Worker bills $5/10M requests once paid is enabled — keep off until needed).
- Healthchecks.io: free-tier covers v1 (20 checks vs ~6 used).
- Neon: torn down at T5 (Phase 1) per R6. Keep the existing Neon budget alert in place through the 48h warm rollback window after T4; remove it once T5 merges.

**Egress sanity:** at 99.91% miss × 200× audience the projected egress is dominated by GCP→Cloudflare PoP (free for our pattern, intra-region us-west1 → Cloudflare). The ~$230/mo Neon-side cross-cloud egress that *would have* applied under R1's deferred-migration counterfactual is avoided by R6's pre-flip migration — by the time national traffic arrives, the DB is already collocated with the read-API. The cost premium during the AZ-only ramp (§above) is the price of buying that collocation early.

---

## §11 Open questions surfaced during this planning exercise

1. **Per-state backfill fan-out scope.** Backfill stays at `US-AZ` in the literal flip per §4.4. The per-state fan-out is its own architecture decision: 50 sequential calls per day × 19 days = 950 calls/day (well inside eBird's tolerance) but the wall-clock cost is non-trivial (current AZ backfill p50 is 645s; 50× sequential is unviable). Likely shape: a Cloud Workflow that fans out 50 parallel state backfills with per-state pacing. **Files as an open question.**
2. **iNaturalist `place_id` photo lookup — product choice still open.** PR #609 landed the *plumbing* (parameterized `place_id` instead of hard-coded 40). The *product choice* — global default vs configurable per-deploy default — is still open. National species not yet observed in AZ will have no `place_id=40` photo; the fallback path works but introduces a UX asymmetry. Switching the default to global is one config change; needs a one-shot product call.
3. **Phenology month-boundary timezone — product choice still open.** PR #609 landed the *plumbing* (parameterized timezone instead of hard-coded `America/Phoenix`). The *product choice* — UTC for all observations vs per-observation timezone derived from `geom` — is still open. UTC is simpler and matches eBird's own convention; per-observation-tz is more faithful to the observer's local season but requires a TZ lookup per row. **Files as an open question** for a v1.1 follow-up.
4. **Hotspot density at 100k markers.** The cluster + adaptive-grid layers haven't been load-tested at national scale. Browser-side smoke at the canonical viewport set is the highest-risk pre-flip frontend item.
5. **Cloud SQL HA tier — REGIONAL vs zonal (R6, 2026-05-18).** Migration timing is no longer open: per R6 the cutover is pre-flip (Phase 1), so the timing-trigger language from R1 is retired. The remaining open question is post-flip resilience: Cloud SQL launches **zonal** (~$25/mo) to keep the AZ-ramp premium small. If post-flip HN-scale traffic surfaces a single-zone availability incident in the first 30 days after the flip, promote to REGIONAL (~$25 → ~$50/mo). Trigger: any availability incident attributable to zone failure in the first 30 days post-flip. Flip is a single Terraform commit (`availability_type = "REGIONAL"`).
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
| 0 | Region-removal RR-1..RR-4 | issue #532 (closed); PRs #534, #535, #536, #537 | done — no dispatch needed |
| 0 | Branding sweep #533 | issue #533 + audit PR 5b | new subagent dispatch; frontend PR with full canonical viewport screenshot set |
| 0 | CONUS viewport | this plan §5.1 | small PR; bundle with branding sweep if convenient |
| 0 | Budget alerts | this plan §10 | small infra PR; one Terraform commit |
| 1 | Cloud SQL T1+T2 prep | `docs/plans/2026-05-17-cloud-sql-migration.md` T1+T2 | shipped |
| 1 | Cloud SQL T3/T4/T5 cutover (R6 — pre-flip) | `docs/plans/2026-05-17-cloud-sql-migration.md` T3–T5 | sequential subagent dispatch per task; operator session for T3/T4; 48h warm rollback window before T5 |
| 2 | Frontend polish | bundled in P0.h / P0.i | (no new dispatch) |
| 2 | `/api/observations` bbox filter (R4) | this plan §5.6 | new tracking issue + read-API PR; hard pre-condition for Phase 3 |
| 3 | The flip — Step A (recent) | this plan §4.4 | small subagent dispatch; ~1 PR; all preconditions verified |
| 3 | The flip — Step B (hotspots) | this plan §4.4 | small subagent dispatch; ≥24h after Step A stable |
| 3.5 | Per-state backfill fan-out (R2) | new plan (not yet written) | concurrent with Phase 3/4; not blocking |
| 4 | Cornell ToS outreach (R-Cornell) | §9 P4.a | user-owed email with verified call profile |
| 4 | Silhouette curation (R3) | `curating-fallback-silhouettes` skill | iterative operator session; no PR per family |
| 4 | Post-flip review | this plan §7 Phase 4 | operator-driven, not a code PR |

---

## §13 Honest open items

- **The Shape-2 contract has a sample-size-of-one-day.** The probe (`2026-05-17-shape-2-rollup-probe.md`) addresses this with weekly re-sampling, but the flip itself ships on a still-incomplete sample. If the probe fails post-flip, the rollback story is fast (§8) and the per-state backfill fan-out becomes the fallback shape.
- **The 200× multiplier is a tail estimate, not a measured number.** HN spikes are bounded by HN's own front-page volume (~tens of thousands of visits over a day at most). Cloud Run's scale-up is monotonic; the rate-limit and TTL cache absorb the rest. Watch the first viral moment and tune.
- **No critic pass was run on this umbrella plan.** It was assembled from the analysis report, the cache-hit measurement, and three sibling plans + one audit. A read-through by a fresh agent before Phase 3 is recommended; the flip itself is small but the precondition list is long.
- **Cornell's response could arrive between Phase 0 and Phase 3.** If Cornell says "stop," the flip is off. If Cornell says "talk to us about commercial," the flip can proceed with the conversation as a parallel track. Plan does not branch on this; document the response and revisit at the next phase boundary.
- **The `services/ingestor/src/run-photos.ts` iNat place_id=40 hard-code is a known UX asymmetry.** Filed under §11 open question #2; not a blocker but should not be forgotten.

---

## Methodology

Plan produced by a single-pass agentic write-up off five inputs: (1) the 2026-05-14 analysis funnel report at `docs/analyses/2026-05-14-process-scale-options/phase-4/analysis-report.md`; (2) the 2026-05-17 Cloudflare cache-hit measurement at `cache-hit-ratio.md`; (3) the three sibling plans dated 2026-05-17 (Cloud SQL migration, monitoring, Shape-2 probe); (4) the region-removal work tracked under issue #532 (the standalone audit doc at `docs/analyses/2026-05-14-region-removal-audit/` was never authored; the four-PR sequence shipped directly — see §6); (5) a fresh grep of `services/ingestor/src/` and `frontend/src/` for hard-coded `US-AZ` / `Arizona` references at writing time. No multi-pass critic loop; recommend one pre-Phase-3.
