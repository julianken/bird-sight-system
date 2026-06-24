# Design — `map-consistency-audit`

- **Date:** 2026-06-23
- **Status:** Approved design; pending implementation plan
- **Author:** Julian (brainstormed with Claude)
- **Repo:** `julianken/bird-sight-system` (local `bird-watch/`)
- **Artifacts produced:** a committed Playwright harness (`frontend/scripts/map-consistency/`), a project agent (`.claude/agents/map-consistency-auditor.md`), and a project skill (`.claude/skills/map-consistency-audit/SKILL.md`).

---

## 1. Problem

bird-maps.com shows the same underlying eBird data through several numeric and visual surfaces that are computed independently, and they can disagree. Observed symptoms:

- **Pills disappear at zoom on desktop** and never "split out" the way they correctly do on mobile.
- **A stated count and the rendered count diverge** — e.g. the filter/lede says *7 sightings* but only *3* are visible on screen.
- **Counts are not conserved when zooming in** — a sub-region that the zoomed-out view counted as N does not show N when you zoom into exactly that box.

There is no ground-truth oracle: for a random patch of map, nobody knows the "true" bird count. This is the classic **test oracle problem**. The solution is **metamorphic testing** — assert *relations that must hold between related views*, even without knowing the absolute right answer. The relations below are the conservation / monotonicity / parity invariants the app's own design implies.

We want this **automated, repeatable, and delegatable**: a tool that randomly samples real prod data at a **configurable sample count**, walks a zoom ladder at desktop and mobile, and produces a **preserved findings brief** (screenshots + reliable repro + raw data) that Julian uses for ticket-writing, triage, and analysis. The agent **stops at the brief** and never files anything itself.

## 2. Goals / Non-goals

**Goals**
- Detect real consistency violations on **live prod** (bird-maps.com) using metamorphic relations.
- **Configurable scale** via `--samples N` (small group for a quick pass, large group for a deep sweep) plus `--scope`, `--seed`, `--zoom-ladder`, `--viewports`, `--pace-ms`.
- Distinguish **real bugs** from the app's **documented-legitimate divergences** (lede is scope-total not viewport; aggregated vs per-observation mode switch at zoom 6; per-observation row cap → `truncated`).
- Produce a **self-contained, durable brief**: every finding bundles screenshots, exact `#map=` repro URL(s), the raw `/api/observations` payloads, console logs, and the stated/rendered/network numbers — so it stays analyzable after prod data shifts.
- Be runnable by a **subagent** (via Bash; no MCP browser dependency) and in principle by CI.

**Non-goals**
- Not a fix for any bug it finds (detection only; the brief points at hypotheses).
- Not a replacement for the stubbed `frontend/e2e/*.spec.ts` suite (those are deterministic unit-style e2e against seeded local data; this is a real-data audit against prod).
- No auto-filing of GitHub issues. No DB writes. No `gh pr merge`.

## 3. Architecture

Three artifacts plus one human-in-the-loop orchestrator touchpoint.

| Artifact | Path | Role |
|---|---|---|
| **Harness** (engine) | `frontend/scripts/map-consistency/` | Standalone headless-Playwright script (run via `tsx`, **not** a `*.spec.ts`). Drives prod, captures evidence, evaluates relations, writes the brief. A subagent can run it via Bash — that is what makes it delegatable; MCP browsers cannot be driven by subagents. |
| **Agent** | `.claude/agents/map-consistency-auditor.md` | Project subagent (mirrors the `dependabot` agent). Runs the harness, applies triage judgment + carve-outs, ranks findings, writes/curates the brief, **stops for Julian's confirmation**. Tools: Bash, Read, Grep, Glob, TodoWrite (no MCP). |
| **Skill** | `.claude/skills/map-consistency-audit/SKILL.md` | Runbook + knowledge: the MR catalog with tolerances/carve-outs, the CF pacing guard, the two-stage hash-wait protocol, the legend-expand step, the brief schema, and the triage→confirm→file flow. Loaded by the agent and the orchestrator. |
| **Orchestrator MCP** (confirm) | — | On a flagged finding, the orchestrator opens the `#map=` repro URL in chrome-devtools/Playwright MCP, eyeballs it, and captures the canonical screenshot for the eventual ticket. Human-in-loop, after the brief, before any GitHub action. |

### Data flow

```
Julian/orchestrator → "audit, N samples, scope S"
  → map-consistency-auditor agent
      → runs harness via Bash (npm run audit:map-consistency -- --samples N --scope S --seed K)
          → Sampler: 1 national/scope low-zoom fetch → density-weighted seeded sample points
          → for each (sample × zoom-ladder × viewport):
                Camera driver: navigate ?scope=…#map=z/lat/lng ; wait for the matching /api/observations
                Capture: network payload + DOM (lede, expanded legend, marker/cell aria) + console
          → Relations engine (pure): evaluate MR-0..MR-8 with tolerances + carve-outs
          → Reporter: write brief.md + findings.json + per-finding evidence bundles (+ screenshots on fail)
      → agent parses findings.json → ranks, dedupes, writes the human brief, STOPS
  → Julian reviews brief → confirms → orchestrator MCP screenshot pass → Julian files tickets
```

## 4. Live-verified prod facts (ground truth, 2026-06-23)

Verified directly against bird-maps.com (the local primary tree is stale at #930 and gave wrong answers; these supersede it):

1. **`#map=` hash restore works on prod**, two-stage: `?scope=us` fits national and fetches first (`zoom=3`), **then** the hash camera flies in and fetches again (`zoom=9` at the hash bbox). Therefore `data-render-complete="true"` (which flips on the national interstitial) is **not** a sufficient "settled" signal.
2. **Hash format:** `#map=<zoom>/<lat>/<lng>` — zoom `toFixed(3)`, lat/lng `toFixed(5)`; optional `/bearing/pitch` and `&v=WxH@dpr`. Field order is **ZOOM / LAT / LNG**. Scope is a **separate query param**: `?scope=us` (national) or `?state=US-AZ`. Filters are query params too: `?since=7d&family=CODE&species=CODE&notable=true`.
   - Example: `https://bird-maps.com/?scope=us#map=9.000/32.22175/-110.97648`
3. **Ground-truth viewport = the `/api/observations` request `bbox=` + `zoom=` params.** `data-camera-bounds` is the **scope code** (`"us"`), not real bounds — do not use it for geometry.
4. **Mode switch at zoom 6** confirmed live: `zoom<6` → `mode:"aggregated"` buckets; `zoom>=6` → `mode:"observations"` rows (row-capped, `meta.truncated`).
5. **Per-family marker counts are readable from the DOM via `aria-label`** — **no instrumentation change needed**:
   - Cell: `aria-label="Falcons & Caracaras, 2 observations"` — parses to `{family, count}`, **including count-1 cells that have no badge** (`"Hawks, Eagles & Kites, 1 observation"`). Regex: `/^(?<family>.+),\s+(?<count>\d+)\s+observations?$/`.
   - Marker: `aria-label="Cluster: 7 observations, 5 families. Activate to zoom in."` — parses to `{markerTotal, familyCount}`.
   - Cell testids: `adaptive-grid-marker-cell-rendered` / `-cell-fallback` / `-cell-pending`; badge `adaptive-grid-marker-badge` (only when count>1); marker `adaptive-grid-marker`.
6. **Legend is collapsed by default on desktop:** `<aside class="family-legend">` with toggle `#family-legend-toggle`; entries mount only when expanded. The harness **clicks the toggle** before reading rows. (Local-tree testid `family-legend-entry` must be re-confirmed post-expand during implementation; container/title/toggle selectors are confirmed live.)
7. **Lede is scope-total, not viewport** — stayed `"2,300 sightings"` (national) at zoom-9 Tucson. `data-testid="map-lede"`; integer has thousands separators in the rendered string (`"2,300"`), so strip commas before parsing.
8. **`window.__birdMap` is absent on prod** (gated to `MODE !== 'production'`). DOM + network only.

## 5. Metamorphic relation catalog

Each relation: definition, the comparison, tolerance, and carve-outs (conditions under which a difference is legitimate and must NOT be flagged).

### MR-0 — Drill-down bbox conservation (HEADLINE)
*Zooming into a sub-region must conserve the count attributed to it.*
- **MR-0a (server truth):** pick a parent view; choose a child bbox inside it; `expected = Σ parent network counts geographically inside child bbox`. Navigate to the child bbox; `actual = child view network total`. Assert `actual == expected`.
- **MR-0b (rendered truth):** `parentClusterCount over the child area == Σ rendered cell counts after zooming into the child bbox`.
- **Tolerance:** exact (tol=0) **only** for observations↔observations drill-down (discrete points). Aggregated views use **centroids**, so a boundary bucket bins all-or-nothing → aggregated (and cross-mode / `truncated` / freshness-skewed) drill-downs use a tolerance band and only flag **LOSS** (`child < parent`); a **GAIN** is parent-grid coarseness or a row-capped parent, never a conservation bug. (Refined per bot review of #1267.)
- **Carve-outs:** `meta.truncated` on either side; aggregated-centroid binning; `freshestObservationAt` differs between parent and child fetch (prod ingested new data mid-sample) → annotate as freshness-skew, downgrade severity.

### MR-8 — Desktop ↔ mobile parity (HEADLINE)
*Same `#map=` camera must render the same coverage on desktop (1440×900) and mobile (390×844).*
- Compare rendered family presence between viewports at the same camera, **restricted to families present in BOTH viewports' (viewport-scoped) legends** — the coverage-controlled common ground. *Viewport-coverage normalization is load-bearing: desktop (1440×900) and mobile (390×844) cover different geographic bboxes at the same zoom, so an un-normalized raw family-set comparison emits one-directional false positives — desktop's wider frame legitimately sees coastal/edge families mobile's bbox excludes. Proven by the first prod run (#1269); fixed in C4.*
- **Violation:** a family present in BOTH legends (so both viewports have the data) that renders on only one side — a real rendering disparity, not a coverage difference.
- **Emits the desktop−mobile delta per sample** as the evidence for porting mobile's split logic.
- **Leading hypothesis (from code):** `pickGridShape(uniqueFamilies, pointCount, isMobile)` where `isMobile = containerWidth < 768`. Mobile has a `grid-overflow` 3×3+"+N" path that always renders; desktop in the same density range can fall to a bare `{tag:'pill'}` that renders empty. (`frontend/src/components/map/adaptive-grid.ts`, `MapCanvas.tsx` reconciler ~L1843.)
- **Carve-out:** legitimate layout differences (grid shape, "+N" overflow affordance) are fine **as long as coverage is conserved** — the check is on *which families/counts render*, not pixel layout.

### MR-1 — Zoom non-vanishing
*Zooming in over an area with positive count must not collapse to ~0.*
- Along a sample's zoom ladder, if zoom Z shows count>0 over a point, deeper zooms covering that point must not show ~0.
- **Carve-outs:** the point leaves the viewport as you zoom; `meta.truncated`.

### MR-2 — Stated vs rendered
*A stated count must equal what is rendered in the same viewport.*
- `stated (lede/legend/filter) == Σ rendered cell counts in viewport` (within rounding ε).
- This is the **"says 7, shows 3"** check. When `stated` is the lede, apply MR-5's scope-vs-viewport carve-out; when `stated` is the (viewport-scoped) legend or a filtered result, equality is expected.

### MR-3 — Per-family conservation
*Each family reconciles across panel, markers, and network.*
- For each family: `expanded-legend count == Σ that family's cell counts == network family slice` (viewport-scoped).

### MR-4 — Filter consistency (family/species/notable/since)
*Filters partition and bound the data coherently.* Applied via URL params (not clicks).
- Family/species/notable filtered view: `stated == Σ rendered` (MR-2 under filter).
- `Σ over families (filter=family_i) == unfiltered total`.
- `count(species S) ≤ count(family of S)`; `count(notable) ≤ count(all)`.
- **Since-window monotonicity:** at a fixed camera, `count(14d) ≥ count(7d) ≥ count(1d)` (windows are nested).
- **Carve-out:** species/family codes with `null` joins are excluded from species-count lines by design — reconcile against the same filtered set the UI uses.

### MR-5 — Lede vs scope-total (conditional)
*The lede equals the scope-wide total, not the viewport.*
- Compare lede to the **scope-wide** network total, not the viewport sum. **Only** assert lede==viewport when `data-scope-fitted="true"` AND the camera ⊇ all scope data. Otherwise lede≠viewport is expected, not a bug.

### MR-6 — Clean console
*Zero console errors/warnings across the whole sweep.*
- Catches `clusters-hit` layer-missing errors, `styleimagemissing` warnings, etc.
- **Carve-out:** OpenFreeMap basemap-tile fetch failures (CDN flake) → mark the sample **inconclusive**, not a violation (a blank map from a tile error is not a data bug).

### MR-7 — Idempotence / intermittency probe
*Same camera twice → same counts.*
- Re-request a settled camera; counts should be stable. Used both as its own relation (catches precompute-vs-live + cache-key drift) and to tag every other finding **deterministic vs intermittent**.
- **Carve-out:** `freshestObservationAt` changed between the two reads → freshness-skew, not a bug.

### 5.1 Relation model correction (empirical — from the first full prod run, #1270)

The first `--samples` run falsified three assumptions baked into the naive relations (45→0 coastal MR-8 artifacts confirmed the viewport-normalization fix, but exposed deeper gaps). Corrected, prod-verified model:

- **The conservation law (reliable):** `Σ legend ≈ network.total ≈ lede` — all three track the **viewport** total (verified z9: lede 872 = network.total 872 = legend-sum 869). **The lede tracks the viewport, NOT the scope** (this overturns the earlier "lede is scope-total" reading — that was the two-stage load *interstitial*).
- **Rendered cells are LOSSY, not a conservation bound:** the adaptive grid renders a capacity-limited top-K-by-count subset of families (9–29% of legend at z9; ~2 cells at a z4 national cluster). So `legend == rendered` and `Σrendered == total` are false whenever families exceed grid capacity (overflow/pill drops the tail) — asserting them produced 317 MR-3 + 6 MR-2 capacity artifacts.

Corrected relations (supersede the naive bullets above):
- **MR-2 (conservation):** **lede leg (always):** `|lede − network.total| ≤ ε`. **legend leg (per-observation mode only):** `|Σlegend − network.total| ≤ ε`, ε = max(3, total·2%). The **lede tracks the API RESPONSE total** (= viewport extent in per-obs mode; = scope extent in aggregated mode, where the fetch uses the scope-envelope bbox, so the lede shows the national total). The legend is always **viewport-scoped**, so it equals the response total ONLY in per-obs mode — in aggregated mode the response is scope-wide, so skip the legend leg (carve-out `aggregated-response-scopewide`). (Same guard MR-3 needs; corrects the 2 residual MR-2 z4-mobile artifacts.)
- **MR-2b (render-completeness — the "says 7, shows 3" catcher):** when `network.total ≤ 50` AND no marker overflow, `Σ rendered cell counts ≈ network.total`. At low counts everything fits the grid, so rendered must conserve; a shortfall = render loss. Skipped at high totals (capacity).
- **MR-3 (server↔client family, aggregated-mode only):** in `mode:aggregated`, `legend[fam] ≈ network.familyCounts[fam]` (both common-name). Skipped in observations mode (no per-family network + code↔name mismatch). NO legend-vs-rendered.
- **MR-5 (lede vs viewport):** `lede ≈ network.total` (viewport, not scope). `scopeTotal` dropped.
- **MR-8 (directional pill-collapse — THE bug detector):** keep the legend-intersection; fire ONLY when `mobile renders F && desktop does NOT` (desktop under-rendering = the reported "desktop pills disappear, mobile splits out" bug). Suppress the reverse (desktop renders more = its larger 4×4 capacity — legit, was the 21 residual artifacts).
- **Unchanged:** MR-0, MR-1, MR-4, MR-6, MR-7. (MR-6 already caught a genuine prod CORS error on the national `zoom=3` prefetch — `No 'Access-Control-Allow-Origin'`, filed for independent follow-up.)

### 5.2 Two render modes — `cluster-pill` vs `adaptive-grid-marker` (THE actual bug surface)

Live MCP inspection of the MR-1 candidate (`#map=4.000/36.5/-84.5&v=390x844@2`, mobile) revealed the capture was **blind to half the map.** A cluster renders in one of two DOM forms:

- **`cluster-pill`** — a collapsed pill: `<button class="cluster-pill cluster-pill--ember" aria-label="1,164 sightings">1,164</button>`. Shows the total count, NO family breakdown. (16 of these were on screen where the capture read 0 markers.)
- **`adaptive-grid-marker`** — the "split out" form: the family-silhouette grid with per-family `-cell` aria-labels.

`pickGridShape` returns `{tag:'pill'}` when a cluster exceeds the family/point cap. That cap is viewport-independent, **but desktop's wider bbox aggregates MORE points per cluster** → more clusters exceed the cap → **desktop collapses to pills where mobile (narrower clusters) splits into grids.** This is precisely the reported bug: *"desktop pills disappear and never split out like they do on mobile."* The capture only ever read `adaptive-grid-marker`, so it could not see pills at all — causing the MR-1 false-fire and the "rendered = 9–29% of legend" undercount (pills hold most of the low-zoom count).

**Required fixes (land in the capture + relations — task C4c):**
1. **Capture pills.** `readMarkers` must also read `.cluster-pill` markers: `kind:'pill'`, `total` = parsed `aria-label "N sightings"`, `color` = the `cluster-pill--<x>` modifier, `cells:[]`. `adaptive-grid-marker` markers become `kind:'grid'`. Add `kind: 'pill' | 'grid'` and `total: number` to `MarkerRead`.
2. **Conservation counts pills.** `renderedTotal` = Σ pill totals + Σ grid cell counts. This fixes MR-1 (pills count as rendered) and MR-2b (low-zoom conservation).
3. **MR-9 (NEW — pill-split parity, the user's bug):** at the same camera, flag when **mobile splits materially more clusters than desktop** (`mobileGridMarkers − desktopGridMarkers > threshold`, i.e. desktop leaves as pills clusters mobile splits into grids). Severity high — this is the reported defect. (The implementer must empirically confirm the asymmetry direction in the smoke before fixing the threshold — capture desktop vs mobile pill/grid counts across z5–z10.)

## 6. The harness

`frontend/scripts/map-consistency/` (TypeScript, run with `tsx`):

| Module | Responsibility |
|---|---|
| `audit.ts` | CLI entry; parses flags; orchestrates sampler → driver → capture → relations → reporter; enforces the pacing guard. |
| `sampler.ts` | One low-zoom scope fetch → **density-weighted seeded** sample points (PRNG seeded by `--seed`) so samples land where birds are. Also emits a few **uniform** points to catch "empty area shows phantom count". |
| `camera.ts` | Builds `?scope=…#map=z/lat/lng[&v=…]` URLs; navigates; **waits for the `/api/observations` whose `zoom`+`bbox` match the requested camera** (two-stage hash-restore protocol); paces ≥ `--pace-ms`. |
| `capture.ts` | Per cell: intercept the matching `/api/observations` response (`mode`, `buckets`/`observations`, `meta.truncated`, `freshestObservationAt`); expand legend + read rows; read lede; read marker/cell aria-labels → `{family,count}`; collect console messages. |
| `relations.ts` | **Pure** `(captured snapshots) → verdicts`. No browser. This is the TDD core. |
| `report.ts` | Writes `brief.md` + `findings.json` + per-finding evidence bundles + screenshots-on-fail. |
| `relations.test.ts` | Vitest unit tests for `relations.ts` against good + violating fixtures. |

**CLI** (npm script `audit:map-consistency` in `frontend/package.json`):
```
npm run audit:map-consistency --workspace @bird-watch/frontend -- \
  --samples 20 --scope US --seed 42 \
  --zoom-ladder 3,5,7,10,13 --viewports desktop,mobile \
  --pace-ms 1200 --base-url https://bird-maps.com
```
- `--samples N` (required, the headline knob), `--scope US|US-XX`, `--seed`, `--zoom-ladder`, `--viewports`, `--pace-ms`, `--base-url` (default prod), `--out` (default the gitignored `out/`).
- Browser: headless `chromium` from `@playwright/test` (already a devDep).

**Placement guard:** the file lives under `frontend/scripts/` (NOT `frontend/e2e/`) and is named `audit.ts`, so the Playwright test runner's `testMatch` never picks it up. `out/` is gitignored.

## 7. The findings brief (primary deliverable)

```
frontend/audit-out/<UTC-timestamp>-seed<N>/
  brief.md                      # human brief: run metadata + summary table + per-finding writeups
  findings.json                 # machine-readable: every number, param, verdict, carve-out applied
  findings/<finding-id>/
    repro.md                    # exact #map= URL(s), scope/filter params, viewport, zoom, click steps
    desktop.png  mobile.png     # screenshots (both viewports for parity findings)
    observations-parent.json    # raw /api/observations payload(s) — the evidence
    observations-child.json
    console.log                 # console errors/warnings at capture time
    meta.json                   # relation, severity, stated/rendered/network + delta, deterministic?, freshestObservationAt
```

**Per-finding fields:** `id`, `relation` (MR-x), `severity`, one-line `symptom`, `repro` (URLs + params + steps), the **three numbers** (stated / rendered / network) + `delta`, `deterministic` (from MR-7 re-check), `carveOutsApplied`, `screenshots`, `rawPayloads`, optional `hypothesis`.

**Brief summary:** counts by relation, by severity, by determinism; the run's `freshestObservationAt` range; the exact command + seed to reproduce the run.

**Data-preservation guarantee:** every finding is self-contained (raw payloads + DOM numbers + screenshots + repro URL), so it remains analyzable months later even though prod data has moved on.

**Viewbox link is the repro primitive (epic #1238 — always include it):** each finding's repro is a `#map=` viewbox link that bakes in the camera, viewport, scope, and active filters — open it and you land on the exact broken view. Because the viewbox feature is recent and easy to forget, the convention is explicit and mandatory: `brief.md` surfaces the `#map=` link per finding (a `🔗 viewbox repro:` line), `repro.md` instructs including it, and **every ticket written from a finding (and any hand-written bird-maps map/data bug ticket) must lead with the viewbox link** as the canonical one-click reproduction.

## 8. The agent

`.claude/agents/map-consistency-auditor.md` — project subagent.
- **When:** Julian says "run a map consistency audit", "audit the map for consistency", "check the bird counts", or names a scope/sample count.
- **Tools:** Bash, Read, Grep, Glob, TodoWrite. **No MCP** (so it runs as a real subagent).
- **Flow:** confirm scope + sample count (surfacing `--samples` prominently) → run the harness via Bash → parse `findings.json` → apply final real-vs-noise triage + dedupe + severity ranking → write/curate `brief.md` → **stop and hand the brief path to Julian**. Never files issues; never merges.
- **Loads** the `map-consistency-audit` skill for the MR catalog, carve-outs, and brief schema.

## 9. The skill

`.claude/skills/map-consistency-audit/SKILL.md` — house style matches `pr-workflow` / `curating-fallback-silhouettes` (frontmatter `name` + `description` with triggers; numbered runbook; gotchas; references).
- The MR catalog (§5) with tolerances and carve-outs.
- The **two-stage hash-wait protocol** and the **legend-expand** step (§4).
- The **CF pacing guard** (§10).
- The **brief schema** (§7) and the triage → confirm → orchestrator-MCP-screenshot → Julian-files flow.
- The live-verified selector/format reference (§4).

## 10. Error handling & prod landmines

- **Cloudflare 60/min/IP.** Each settled camera triggers ≥1 `/api/observations`. The harness computes projected request rate from `samples × |zoom-ladder| × |viewports| × (1 + filter probes + idempotence re-checks)` and **refuses to start** if it would exceed the CF budget, instructing the user to lower `--samples` or raise `--pace-ms`. Default `--pace-ms` conservative (≥1100ms between camera navigations).
- **Flaky OpenFreeMap basemap CDN.** Blank map from a tile error ≠ data bug → detect the tile-fetch failure in console and mark the sample **inconclusive** (MR-6 carve-out).
- **Non-determinism (prod data shifts).** Every finding saves raw payloads + `freshestObservationAt`; `--seed` fixes sample points; the `#map=` URL is the human repro. Findings stay reproducible from the saved artifact.
- **Retries: 0** (repo law). Environment faults → `inconclusive`, never pass/fail.
- **Two-stage hash settle.** Always wait on the network request whose `zoom`+`bbox` match the requested camera; never trust `data-render-complete` alone.

## 11. Testing strategy

- **`relations.ts` is pure and unit-tested** (vitest) against fixtures: a captured-good snapshot passes; hand-crafted violating snapshots (vanishing desktop pill; stated-7/rendered-3; broken drill-down) fail. This is the TDD core and the bulk of the confidence.
- **Browser glue** gets a `--samples 2 --pace-ms 1500` smoke run against prod in the implementer's verification step (and the agent's first run), proving the two-stage wait + selectors + brief generation end-to-end.
- **No DB writes; no stubs** (deliberately a real-data audit, unlike `e2e/*.spec.ts`).

## 12. Sequencing (phases)

1. **Phase 1 — drill-down + parity skeleton.** Harness scaffold (`audit.ts`, `sampler.ts`, `camera.ts`, `capture.ts`), the pure `relations.ts` with **MR-0** and **MR-8** + tests, the brief reporter, the npm script. First runnable slice targets the two headline bugs (drill-down conservation + desktop/mobile pills). Smoke-run on prod.
2. **Phase 2 — full relation catalog.** Add MR-1/2/3/4/5/6/7 + tests, filter-param driving, idempotence/intermittency tagging, the CF pacing guard.
3. **Phase 3 — agent + skill.** `map-consistency-auditor.md` + `SKILL.md`; wire the triage→confirm→brief flow; document the orchestrator MCP screenshot pass.

(Effort expressed per repo norm as fan-out/sequence, not calendar — see writing-plans output.)

## 13. Open questions / risks

- **Child-bbox choice for MR-0:** start with "zoom into one parent grid cell" (clean same-mode case) and "zoom into a viewport quadrant"; tune from first-run signal.
- **Legend entry testid** (`family-legend-entry`) needs post-expand re-confirmation live during Phase 2 (container/toggle confirmed; entries weren't in the collapsed DOM).
- **Sampling weight** balance (density vs uniform) — start ~80/20, adjust from how much signal uniform points add.
- **CF tolerance** for larger `--samples` runs — the pacing guard makes this safe but caps practical sweep size; document the math in the skill.

## 14. File manifest (what implementation creates)

```
frontend/scripts/map-consistency/audit.ts
frontend/scripts/map-consistency/sampler.ts
frontend/scripts/map-consistency/camera.ts
frontend/scripts/map-consistency/capture.ts
frontend/scripts/map-consistency/relations.ts
frontend/scripts/map-consistency/relations.test.ts
frontend/scripts/map-consistency/report.ts
frontend/scripts/map-consistency/README.md
.claude/agents/map-consistency-auditor.md
.claude/skills/map-consistency-audit/SKILL.md
.claude/skills/map-consistency-audit/DESIGN.md   # this file
frontend/package.json                            # + "audit:map-consistency" script
.gitignore                                       # + frontend/audit-out/
```
