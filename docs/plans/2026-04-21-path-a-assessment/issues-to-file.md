# Plan 6 Issues — Ready to File

Seventeen GitHub issues for Plan 6 (Path A frontend reimagining). The source plan is `docs/plans/2026-04-21-plan-6-path-a-reimagine.md` (15 tasks); this file decomposes that plan into 17 filing units per `docs/plans/2026-04-21-path-a-assessment/final-sequencing.md`. Issue numbering below matches `final-sequencing.md` and is canonical — do not re-number.

Each body is self-contained: Goal, Context, Scope, Files touched, Acceptance criteria, Gotchas, Out of scope, Dependencies, a commit-message template, and a Plan reference anchor. In-batch dependencies use `#TBD-N` placeholders (where N is the in-batch issue number); Julian will resolve these to real GitHub issue numbers during filing.

Decisions baked in (do not relitigate in issue bodies): Path A is final, not a hedge; SpeciesPanel drawer-at-mobile / sidebar-at-desktop at 768px; all 5 latent fields ship in release 1; default surface is `?view=feed`; T6 is deferred to release 2 (honest 10/14); `lat`/`lng` surface on hotspot rows only; single-cutover migration; no prototype gate task in release 1 filing — Issue 15 is optional and labelled `needs-scoping`.

## Pre-flight

The label `plan:6` does NOT exist in the repo at time of drafting (only `plan:5` is present). Julian must create it before filing:

```
gh label create "plan:6" \
  --description "Traces to docs/plans/2026-04-21-plan-6-path-a-reimagine.md" \
  --color c5def5
```

All 17 issues in this batch carry the `plan:6` label. The `area:frontend` label applies to every issue except Issue 1 (`area:read-api`) and Issue 3 (`area:docs`).

## Filing order

| # | Title | Depends on (in-batch) | Week |
|---|---|---|---|
| 1 | Enable gzip compression on the Read API | — | 0 |
| 2 | Fix ingestor stall | — | 0 |
| 3 | Update CLAUDE.md — prototype gate + stale opening | — | 0 |
| 4 | Introduce `?view=` URL param + SurfaceNav scaffold | — | 0 |
| 5 | url-state + `?region=` migration banner | 4 | 1 |
| 6 | Delete the map rendering chain (DISCARD wave) | 4, 5 | 1 |
| 7 | Add `[data-render-complete]` readiness gate | 6 | 1 |
| 8 | SpeciesPanel — drawer <768, sidebar >=768 | 6 | 1 |
| 9 | ObservationFeed with 4 of 5 latent fields | 1, 6, 7 | 2 |
| 10 | HotspotList with lat/lng coordinate display | 5, 6 | 2 |
| 11 | SpeciesSearch autocomplete surface | 6, 8 | 2 |
| 12 | Integrate taxonOrder / familyCode | 9 | 2 |
| 13 | T6 encoding — scoping (recommend defer) | — | 2 |
| 14 | Migrate REFACTOR e2e specs to readiness gate | 6, 7, 8 | 2 |
| 15 | Optional Path A prototype commit | — | 0–2 |
| 16 | New happy-path e2e spec | 9, 10, 11, 14 | 3 |
| 17 | Release-1 exit criteria meta-issue | 9, 10, 11, 12, 13, 14, 16 | 3 |

Parallel batches (can all file and begin at once):
- **Week 0 parallel:** Issues 1, 2, 3, 4, 15 (file all five in one pass).
- **Week 2 parallel:** Issues 9, 10, 11 (surface builds); Issue 13 scoping and Issue 14 e2e in parallel.

---

## Issue 1: feat(read-api): enable gzip compression middleware

**Labels:** `agent-ready`, `area:read-api`, `enhancement`, `plan:6`
**Plan 6 task:** T1

### Goal

Add `compress()` middleware to the Hono app so all JSON responses ship with `Content-Encoding: gzip`. Unblocks mobile viability for the new feed surface once ingest volume returns to the ~1,500–2,000-row healthy baseline.

### Context

`risk-viability.md` §R8 and the opportunity list §O6 flag this as a pre-cutover blocker: at healthy ingest volume the uncompressed `?since=14d` payload is ~101 KB, which is painful on 3G/slow-LTE mobile. Gzip drops it below 20 KB in local measurement. Plan 6 Task 1 elevates this to Week 0 so ObservationFeed (Issue 9) can assume mobile viability when it lands.

### Scope

- Import `compress` from `hono/compress`.
- Register `app.use('*', compress())` at the top of the middleware chain, before any routes in `services/read-api/src/app.ts`.
- Add an `app.test.ts` case sending `accept-encoding: gzip` and asserting `content-encoding: gzip` on the response.
- No route or response-shape changes. No API contract change.

### Files touched

- `services/read-api/src/app.ts`
- `services/read-api/src/app.test.ts`

### Acceptance criteria

- [ ] `GET /api/observations?since=14d` with `accept-encoding: gzip` returns `content-encoding: gzip`.
- [ ] `?since=14d` payload measurably smaller post-middleware (target < 20 KB compressed vs ~101 KB raw).
- [ ] All existing read-api tests pass (`npm test --workspace @bird-watch/read-api`).
- [ ] `npm run build --workspace @bird-watch/read-api` clean.

### Gotchas

- `compress()` must be registered before any route handler. Registering it after a route means that route bypasses compression.
- Hono's compress middleware does not compress responses smaller than ~1 KB by default. The small health-check route may still return uncompressed; test the measurement on `?since=14d`, not `/healthz`.

### Out of scope

- Do not add any other middleware (CORS, security headers) in this PR.
- Do not change the response shape on any route.
- Do not bump Hono's version.

### Dependencies

- Blocks: `#TBD-9` (feed mobile viability is gated on compression at healthy ingest volume).
- Does not block: `#TBD-2`, `#TBD-3`, `#TBD-4`.

### Commit message template

```
git commit -m "feat(read-api): enable gzip compression middleware"
```

### Plan reference

Part of Plan 6, Task 1. See `docs/plans/2026-04-21-plan-6-path-a-reimagine.md#task-1-enable-gzip-compression-on-the-read-api`.

---

## Issue 2: fix(ingestor): restore fresh observation writes (R2)

**Labels:** `agent-ready`, `area:ingestor`, `bug`, `plan:6`
**Plan 6 task:** operational prerequisite (tracked outside task list, §Release-1 blocking operational items)

### Goal

Diagnose and fix the ingestor stall so `GET api.bird-maps.com/api/observations?since=1d` returns a non-empty array with `obsDt` within the last 24 hours. Without this fix the feed lands on release day looking empty, which reads as "site broken" (`risk-viability.md` Part 5).

### Context

Plan 6 §Release-1 blocking operational items names R2 (ingestor) as a non-task pre-cutover blocker. Candidates for root cause: Cloud Run Job scheduler misfire (possibly the same incident as existing issue #106), eBird API key expiry or rate-limit revocation, or a schema migration that silently broke the insert path. Confirm root cause before writing the fix.

### Scope

- Reproduce the stall against `api.bird-maps.com`; capture Cloud Run Job log tail and the Cloud Scheduler history pane.
- Identify root cause — one of scheduler/auth/migration. Fix at that layer.
- Verify `GET api.bird-maps.com/api/observations?since=1d` returns fresh data.
- Confirm `GET api.bird-maps.com/api/hotspots` is also healthy (same ingestor).
- If the root cause matches existing issue #106 scope, close #106 in this PR.

### Files touched

- `services/ingestor/src/**` (root-cause-dependent; likely one of the service-account, retry, or migration paths).
- Possibly `infra/terraform/*` if scheduler or IAM changed.

### Acceptance criteria

- [ ] `GET api.bird-maps.com/api/observations?since=1d` returns ≥1 row with `obsDt` within 24 hours.
- [ ] `GET api.bird-maps.com/api/hotspots` returns the expected hotspot set.
- [ ] Cloud Run Job shows green in GCP console for two consecutive scheduled runs.
- [ ] No API contract change; read-api tests unchanged.
- [ ] If root cause == #106: issue #106 closed in this PR body with `Fixes #106`.

### Gotchas

- Do NOT move the problem by rerunning the job manually — the fix must survive the scheduler's next tick.
- The ingestor calls `/data/obs/US-AZ/recent` AND `/data/obs/US-AZ/recent/notable` (CLAUDE.md). If one call is failing, the `is_notable` flag intersection silently breaks; verify both paths.
- Region-assignment happens at ingest via `ST_Contains` (CLAUDE.md). Do not add point-in-polygon math to the read path to work around a missing `region_id`.

### Out of scope

- Do not refactor the ingestor beyond what the root cause demands.
- Do not change the `observations` table schema.
- Do not add observability/monitoring improvements in this PR (separate ticket if needed).

### Dependencies

- Independent; can run in parallel with every other issue.
- Release-1 exit criterion (`#TBD-17`) depends on this being green.

### Commit message template

```
git commit -m "fix(ingestor): restore fresh observation writes (R2)"
```

### Plan reference

Part of Plan 6, §Release-1 blocking operational items. See `docs/plans/2026-04-21-plan-6-path-a-reimagine.md#release-1-blocking-operational-items`.

---

## Issue 3: docs: CLAUDE.md prototype-gate section + clear stale opening

**Labels:** `agent-ready`, `area:docs`, `documentation`, `plan:6`
**Plan 6 task:** process artifact (no Plan 6 task counterpart — closes #103)

### Goal

Add a `## Prototype gate` convention section to `CLAUDE.md` and rewrite the opening paragraph which still claims the repo is "planning artifacts only" — application code has shipped to `bird-maps.com`.

### Context

Existing issue #103 flags the stale opening. The new prototype-gate convention comes from `docs/plans/2026-04-21-path-a-assessment/risk-viability.md` Part 7: any rendering approach (feeds, marker clusters, SVG) must render ≥344 representative rows at 390×844 AND 1440×900 before the plan body is committed. This prevents Plan 4's "looks fine in a demo, breaks at production dimensions" failure mode from recurring.

### Scope

- Add a new section `## Prototype gate` under `## Before authoring a plan` in `CLAUDE.md`. Include the mobile (390×844) and desktop (1440×900) dimension callouts and the ≥344-row minimum.
- Rewrite the opening paragraph so it no longer says "planning artifacts only". Reference the `bird-maps.com` deployment as of 2026-04-19 and the active `frontend/`, `services/read-api/`, `services/ingestor/`, `infra/` workspaces.
- Reference #103 as superseded in the PR body.

### Files touched

- `CLAUDE.md`

### Acceptance criteria

- [ ] `## Prototype gate` section present with mobile + desktop dimension callouts.
- [ ] Opening paragraph accurately reflects the current repo state.
- [ ] PR body includes `Closes #103` so Mergify auto-closes that issue on merge.
- [ ] `npm run build` unaffected (CLAUDE.md is not in any build pipeline, but verify no hook misbehaves).

### Gotchas

- CLAUDE.md is auto-loaded into every session — be precise. Broken markdown or missing backticks will propagate.
- Do not replace existing sections wholesale; add and edit. The `## Use context7` and `## Testing` sections must be preserved verbatim.

### Out of scope

- Do not restructure the Plan dependency graph or architecture section.
- Do not rewrite the PR workflow section.
- Do not add prescriptive rules beyond the prototype-gate convention.

### Dependencies

- Independent; file in week 0 alongside Issues 1, 2, 4, 15.

### Commit message template

```
git commit -m "docs: CLAUDE.md prototype gate + clear stale opening"
```

### Plan reference

Out of plan — process/conventions update. Supersedes existing issue #103.

---

## Issue 4: feat(frontend): introduce `?view=` URL param + SurfaceNav scaffold

**Labels:** `agent-ready`, `area:frontend`, `enhancement`, `plan:6`
**Plan 6 task:** T2, T3

### Goal

Extend `UrlState` with a `view: 'feed' | 'species' | 'hotspots'` field (default `'feed'`) and introduce a new `<SurfaceNav>` tab component that toggles it via `aria-selected` + keyboard arrows per the WAI-ARIA tablist pattern.

### Context

Plan 6 §Architecture names `?view=` as the single URL-driven selector for the three non-spatial surfaces. Feed-primary is the default per `phase-1/area-3-user-task-fit.md` — it grades strongest on T1/T7/T3 (the dogfood tasks). `SurfaceNav` is the new UI affordance that makes the three surfaces reachable.

### Scope

- Add `view: 'feed' | 'species' | 'hotspots'` to `UrlState`, default `'feed'`. Add a `VALID_VIEW` set for parsing.
- `readUrl()` sniff refinement: if `?view=` is absent AND `?species=` is set, return `view: 'species'` (cold-loaded bookmarked species URLs land on the search surface with the panel open; see Plan 6 architecture §9).
- `writeUrl()`: if `state.view !== 'feed'`, set `?view=...`; never serialise the default.
- Create `frontend/src/components/SurfaceNav.tsx` with `role="tablist"` and three `role="tab"` buttons. Click sets view; ArrowLeft/ArrowRight cycle focus AND activate the adjacent tab; Enter/Space activate the focused tab.
- Wire into `App.tsx` between `<FiltersBar>` and `<main>`.

### Files touched

- `frontend/src/state/url-state.ts`
- `frontend/src/state/url-state.test.ts`
- `frontend/src/components/SurfaceNav.tsx` (new)
- `frontend/src/components/SurfaceNav.test.tsx` (new)
- `frontend/src/App.tsx`

### Acceptance criteria

- [ ] `?view=feed`, `?view=species`, `?view=hotspots` round-trip through `useUrlState`.
- [ ] `?view=` absent on cold load resolves to `'feed'` by default.
- [ ] `?species=vermfly` with no `?view=` resolves to `view: 'species'`.
- [ ] `SurfaceNav` renders three tabs; active tab has `aria-selected="true"`.
- [ ] ArrowRight on the active tab moves focus AND fires `onSelectView` with the next value (tablist pattern).
- [ ] `npm run typecheck && npm run test` green.
- [ ] PR screenshots attached at 390×844 and 1440×900 showing the new nav above the (still-SVG) map.

### Gotchas

- `UrlState` still has `regionId` at this point — `#TBD-5` drops it. Do NOT delete `regionId` in this issue; the concerns are sequenced separately so each PR touches `url-state.ts` exactly once.
- `aria-controls="main-surface"` will not resolve until `#TBD-6` adds the `<main id="main-surface">` element. The `aria-controls` value still belongs on the tab buttons per the tablist pattern; browsers tolerate an unresolved target until the DOM catches up.

### Out of scope

- Do not build any of the three surface components — they land in `#TBD-9`, `#TBD-10`, `#TBD-11`.
- Do not add migration-banner logic for `?region=` — that is `#TBD-5`.
- Do not delete the map chain — that is `#TBD-6`.

### Dependencies

- Blocks: `#TBD-5` (url-state refactor), `#TBD-6` (deletion wave expects SurfaceNav slot in App.tsx).

### Commit message template

```
git commit -m "feat(frontend): introduce ?view= URL param + SurfaceNav scaffold"
```

### Plan reference

Part of Plan 6, Tasks 2 and 3. See `docs/plans/2026-04-21-plan-6-path-a-reimagine.md#task-2-refactor-stateurl-statets--drop-regionid-add-view` and `#task-3-introduce-surfacenav-tab-component`.

---

## Issue 5: refactor(frontend): drop regionId + `?region=` migration banner

**Labels:** `agent-ready`, `area:frontend`, `enhancement`, `plan:6`
**Plan 6 task:** T2 (url-state) + T4 (migration banner) — folded per `final-sequencing.md` §8 to avoid merge-conflict risk on `url-state.ts`

### Goal

Remove `regionId` from `UrlState`, parse `?region=` for one-release back-compat detection only, and ship a dismissible `<MigrationBanner>` that rewrites the URL to drop `?region=` on dismiss. Also drop `getRegions()` from `use-bird-data.ts`.

### Context

Plan 6 §Architecture preserves the existing `?since`/`?notable`/`?species`/`?family` contract byte-for-byte and treats `?region=` as "parsed-and-discarded for one release" with an optional migration banner (architecture §9). `risk-viability.md` R5 (bookmark breakage) is closed by shipping the banner and the silent URL rewrite together. Folding T2 and T4 into one PR avoids two PRs touching `url-state.ts` in the same week.

### Scope

- `url-state.ts`: delete `regionId` field + defaults. Keep `readUrl()` calling `p.get('region')` for side-channel detection; do not store the value. Never write `region` in `writeUrl()`.
- Export `readMigrationFlag(): boolean` returning `new URLSearchParams(window.location.search).has('region')`.
- Create `<MigrationBanner>` — `role="status"`, copy "The region view has been replaced. Use the Filters bar to filter by family or species.", dismiss button (`aria-label="Dismiss migration notice"`). Dismiss sets local state to hide AND calls `window.history.replaceState` on a URL with `?region=` removed so refresh does not re-show.
- Remove `client.getRegions()` from `use-bird-data.ts`. First effect becomes `client.getHotspots().then(...)`. Drop `regions: Region[]` from `BirdDataState`.
- Update tests: four new `url-state.test.ts` cases (default has `view: 'feed'`; `?view=hotspots` parses; `?species=X` with no `?view=` implies `view: 'species'`; `?region=X&view=feed` returns `view: 'feed'` and no `regionId`); four `MigrationBanner.test.tsx` cases (visible when flag true, null when false, dismiss hides, dismiss calls `replaceState` with URL lacking `region=`); `use-bird-data.test.tsx` drops the regions assertion and mock.

### Files touched

- `frontend/src/state/url-state.ts`
- `frontend/src/state/url-state.test.ts`
- `frontend/src/data/use-bird-data.ts`
- `frontend/src/data/use-bird-data.test.tsx`
- `frontend/src/components/MigrationBanner.tsx` (new)
- `frontend/src/components/MigrationBanner.test.tsx` (new)
- `frontend/src/App.tsx` (conditionally render banner)
- `frontend/src/styles.css` (banner layout)

### Acceptance criteria

- [ ] `UrlState` no longer contains `regionId`.
- [ ] Navigating to `/?region=sky-islands-huachucas` shows the banner and rewrites the URL to `/` (no `?region=`) without navigation.
- [ ] `/?region=sky-islands-huachucas&species=vermfly` shows banner, sets `view='species'`, opens SpeciesPanel.
- [ ] Dismiss persists within session (refresh shows no banner because the param is gone).
- [ ] `use-bird-data` no longer calls `getRegions()`; `Region` type stays exported from shared-types.
- [ ] Axe scan passes with banner visible.
- [ ] `npm run typecheck` will be RED against `App.tsx:82,84` that still references `state.regionId` — `#TBD-6` deletes those lines. Document this in the PR body; do not fix here.

### Gotchas

- Typecheck failures in `App.tsx` during this PR are intentional. Splitting the fix across two PRs keeps each reviewable — `#TBD-6` is the deletion-wave PR and is allowed to be large. If you try to land both at once you will rediscover the merge-conflict risk that motivated the fold.
- `MigrationBanner.tsx` needs a top-of-file sunset comment: "Release 2: remove this component and `readMigrationFlag` after `?region=` traffic ages out." Deferred-to-release-2 tracking in Plan 6.

### Out of scope

- Do not delete any map components — that is `#TBD-6`.
- Do not build SurfaceNav here — it ships in `#TBD-4`.
- Do not change the `Region` shared-types shape (back-compat at the schema layer is free).

### Dependencies

- Blocked by: `#TBD-4` (needs `view` in `UrlState` before the sniff logic can set it).
- Blocks: `#TBD-6` (deletion wave expects `regionId` already gone from url-state).
- Blocks: `#TBD-10` (hotspots re-add in `use-bird-data` follows the trim here).

### Commit message template

```
git commit -m "refactor(frontend): drop regionId + ?region= migration banner"
```

### Plan reference

Part of Plan 6, Tasks 2 and 4 (folded). See `docs/plans/2026-04-21-plan-6-path-a-reimagine.md#task-2-refactor-stateurl-statets--drop-regionid-add-view` and `#task-4-region-graceful-degradation-banner`.

---

## Issue 6: refactor(frontend): delete map rendering chain (DISCARD wave)

**Labels:** `agent-ready`, `area:frontend`, `enhancement`, `plan:6`
**Plan 6 task:** T5

### Goal

Delete every SVG-map production file, its unit tests, and its DISCARD e2e specs. Replace the `<div className="map-wrap">` block in `App.tsx` with a `<main id="main-surface" data-render-complete={...}>` scaffold that surfaces (Issues 9–11) will populate. Net: remove ~1,300 prod LOC + ~1,100 test LOC.

### Context

Plan 6 Task 5 is the single highest-risk PR in the plan. The seam is clean at `App.tsx:77-89`; rollback is `git revert`. Every subsequent surface PR lands in the cleared `<main>` slot. `docs/analyses/2026-04-20-frontend-map-analysis/phase-1/area-5-salvage-map.md` is the authoritative DISCARD inventory.

### Scope

- Delete production files: `Map.tsx`, `Region.tsx`, `Badge.tsx`, `BadgeStack.tsx`, `HotspotDot.tsx`, `geo/path.ts` — and each of their unit test files.
- Delete e2e specs: `badge-containment.spec.ts`, `cross-region-badge-containment.spec.ts`, `expand-cap.spec.ts`, `paint-order.spec.ts`, `sizing.spec.ts`, `stroke-scaling.spec.ts`, `region-collapse.spec.ts`, `happy-path.spec.ts` (this one gets rewritten in `#TBD-16`).
- `App.tsx`: delete lines 13–43 (`GENERIC_SILHOUETTE`, `silhouetteFor`, `colorFor`, COUPLING NOTE) and the `Map`/`colorForFamily` imports; delete lines 77–89 (the `<div className="map-wrap">` block). Replace with `<SurfaceNav ... />`, `<main id="main-surface" data-render-complete={!loading && observations !== null ? 'true' : 'false'} aria-busy={loading}>{/* surfaces land in #TBD-9/10/11 */}</main>`, `<MigrationBanner />`. Update error-screen copy at `:59-64`: "Couldn't load map data" → "Couldn't load bird data".
- `use-bird-data.ts`: already trimmed in `#TBD-5`; this PR just verifies the trim stuck and removes any remaining dead code.
- `styles.css`: delete map-specific rule blocks (`.region`, `.region-expanded`, `vector-effect`, `.badge`, `.badge-selected`, `.badge-label`, `.map-wrap`, `.bird-map`) — lines 9–53 and 60–75 per the plan Step 4 reference. Net reduction ~60 LOC. Add scaffold CSS for `.surface-nav` and base `main` styles.

### Files touched

- Delete: `frontend/src/components/{Map,Region,Badge,BadgeStack,HotspotDot}.tsx` and each `.test.tsx` sibling.
- Delete: `frontend/src/geo/path.ts` and `path.test.ts`.
- Delete: eight `frontend/e2e/*.spec.ts` files listed above.
- Modify: `frontend/src/App.tsx`, `frontend/src/data/use-bird-data.ts`, `frontend/src/styles.css`.

### Acceptance criteria

- [ ] `npm run typecheck` passes with zero errors (this finally clears the RED state from `#TBD-5`).
- [ ] `npm run test --workspace @bird-watch/frontend` passes.
- [ ] `npm run build --workspace @bird-watch/frontend` produces a clean production bundle.
- [ ] Dev-server smoke (`npm run dev`) confirms no crash; FiltersBar renders; SpeciesPanel opens on `?species=vermfly`; SurfaceNav visible; `<main>` renders empty (surfaces land later).
- [ ] Error-screen copy reads "Couldn't load bird data".
- [ ] `grep -r 'data-region-id' frontend/src frontend/e2e` returns no matches.
- [ ] PR screenshots attached at 390×844 and 1440×900 confirming the app renders without visible crash.

### Gotchas

- E2E will be RED after this PR — `#TBD-14` migrates the REFACTOR specs to the new readiness gate. Note this explicitly in the PR body so the bot review does not flag the red e2e as a regression.
- `Region` type stays exported from shared-types for schema back-compat (`Region[]` response shape unchanged). Do not delete it.
- This is the largest single PR in Plan 6. Stage the deletes + App.tsx rewrite as one commit; do not try to split — partial states don't typecheck.

### Out of scope

- Do not build any surface component here.
- Do not migrate e2e specs here — `#TBD-14` does that.
- Do not change shared-types.

### Dependencies

- Blocked by: `#TBD-4` (SurfaceNav slot), `#TBD-5` (`regionId` must be out of url-state so App.tsx can compile).
- Blocks: `#TBD-7`, `#TBD-8`, `#TBD-9`, `#TBD-10`, `#TBD-11`, `#TBD-14`.

### Commit message template

```
git commit -m "refactor(frontend): delete map rendering chain (DISCARD wave)"
```

### Plan reference

Part of Plan 6, Task 5. See `docs/plans/2026-04-21-plan-6-path-a-reimagine.md#task-5-delete-the-map-rendering-chain--discard-wave`.

---

## Issue 7: refactor(frontend): add `[data-render-complete]` readiness gate

**Labels:** `agent-ready`, `area:frontend`, `testing`, `plan:6`
**Plan 6 task:** T12 (readiness-gate signal)

### Goal

Add the `data-render-complete="true"` attribute to `<main id="main-surface">` as the e2e readiness signal. Update the Page Object Model to consume it via a new `waitForAppReady()` helper, replacing the now-dead `[data-region-id]` count=9 gate.

### Context

The DISCARD wave (`#TBD-6`) removed `[data-region-id]`. Playwright specs need a stable "app finished its first data render" signal. Plan 6 architecture §8 defines `data-render-complete` on `<main>`: `"true"` iff `!loading && observations !== null` (feed/species surfaces) or `!hotspotsLoading && hotspots !== null` (hotspots surface). It is test-only metadata; it does not replace `aria-busy` (which stays for screen readers).

### Scope

- `App.tsx`: compute the `data-render-complete` boolean based on the active surface's data state; write it to the `<main>` element.
- `frontend/e2e/pages/app-page.ts`: rename `waitForMapLoad()` → `waitForAppReady()`; selector becomes `main[data-render-complete="true"]`, `state: 'attached'`, `timeout: 10_000`. Keep a temporary alias `waitForMapLoad = waitForAppReady` for the life of this PR so specs that still reference the old name (until `#TBD-14` lands) don't break.
- Do NOT touch any spec content in this PR — only the POM method and the App.tsx attribute.

### Files touched

- `frontend/src/App.tsx`
- `frontend/e2e/pages/app-page.ts`

### Acceptance criteria

- [ ] `document.querySelector('main[data-render-complete="true"]')` resolves once data loads (at both initial render and after filter changes).
- [ ] `aria-busy` toggles correctly and independently of `data-render-complete`.
- [ ] POM exports both `waitForAppReady` and the temporary `waitForMapLoad` alias (alias removed in `#TBD-14`).
- [ ] `npm run typecheck && npm run test` green.
- [ ] `npm run test:e2e` not required to pass in this PR (specs still RED from `#TBD-6` deletion; `#TBD-14` is where they go green).

### Gotchas

- `data-render-complete` is not a React controlled attribute name React recognises — it is a plain HTML data-attr, fine to pass as a string prop. Do not typo it as `dataRenderComplete`.
- The attribute must be `"true"` (string) or `"false"` (string), not a boolean. React serialises booleans differently and `attached` Playwright selectors fail silently on the boolean form.

### Out of scope

- Do not update spec files — `#TBD-14` does the spec migration.
- Do not change `aria-busy` semantics.

### Dependencies

- Blocked by: `#TBD-6` (the `<main>` element must exist).
- Blocks: `#TBD-14`.

### Commit message template

```
git commit -m "refactor(frontend): add [data-render-complete] readiness gate"
```

### Plan reference

Part of Plan 6, Task 12. See `docs/plans/2026-04-21-plan-6-path-a-reimagine.md#task-12-migrate-refactor-e2e-specs-to-the-new-readiness-gate` (the gate attribute is introduced here; spec migration is the next issue).

---

## Issue 8: refactor(frontend): SpeciesPanel — drawer <768, sidebar >=768

**Labels:** `agent-ready`, `area:frontend`, `accessibility`, `enhancement`, `plan:6`
**Plan 6 task:** T11

### Goal

Replace the monolithic `position: fixed` 320px SpeciesPanel with a viewport-responsive layout: full-width drawer at `<768px` with tap-outside-overlay dismiss and scroll-restore-on-close; 320px right-docked sidebar at `>=768px` (unchanged behaviour). Preserve ESC, close button, `aria-labelledby`, sr-only heading, and `?species=` deep-link contract verbatim.

### Context

Plan 6 binding pre-plan decision 1 elevates this from a "one-line CSS tidy" to a standalone M-sized issue. `risk-viability.md` Part 2: a 320px fixed panel on a 390px viewport is 82% of screen with no scroll-restore — unacceptable. Desktop (>=768px) behaviour is unchanged from today; the whole change is mobile.

### Scope

- New hook `useScrollRestore(active: boolean)` — captures `window.scrollY` when `active` transitions `false → true`; restores it when `true → false`. If the user scrolled while active (new scrollY differs materially from captured), preserve user position instead.
- New hook `useMediaQuery(query: string): boolean` — matches via `window.matchMedia`, updates on resize.
- `SpeciesPanel.tsx` structural change: overlay added as a sibling when `isMobile`. `useScrollRestore(speciesCode !== null)` runs alongside. `useMediaQuery('(max-width: 767px)')` drives `isMobile`. Panel gets `data-layout={isMobile ? 'drawer' : 'sidebar'}`.
- `styles.css`: replace the `.species-panel` block. Desktop stays 320px fixed right; mobile becomes `width: 100vw; max-width: 100vw` with a `.species-panel-overlay` absolute sibling. ESC/close-button/heading rules preserved verbatim.
- Controlled `matchMedia` mock goes into `test-setup.ts`.
- Tests: ALL existing tests preserved. Add cases for drawer layout at <=767, sidebar layout at >=768, overlay-tap dismiss (drawer only), scroll-restore on close (drawer), sidebar does NOT dismiss on outside click.

### Files touched

- `frontend/src/components/SpeciesPanel.tsx` and test
- `frontend/src/styles.css`
- `frontend/src/hooks/use-scroll-restore.ts` (new) and test
- `frontend/src/hooks/use-media-query.ts` (new) and test
- `frontend/src/test-setup.ts` (matchMedia mock helper)

### Acceptance criteria

- [ ] Panel renders as full-width drawer at 390×844 viewport (`data-layout="drawer"`).
- [ ] Panel renders as 320px right-docked sidebar at 1440×900 (`data-layout="sidebar"`).
- [ ] Tap outside the panel closes it at 390px (overlay `onClick` → `onDismiss`).
- [ ] Sidebar at 1440px does NOT dismiss on outside click (intentional different contract — see plan gotcha).
- [ ] Scroll position restored to within 2px of pre-open position after close at 390px.
- [ ] ESC closes in both modes.
- [ ] `axe-playwright` clean at both viewports with panel open (WCAG 2.1 AA tag set).
- [ ] Existing `?species=vermfly` deep-link cold-load test still passes.
- [ ] PR screenshots attached: mobile drawer (390×844) and desktop sidebar (1440×900), panel open state.

### Gotchas

- The sidebar-vs-drawer dismiss contract is asymmetric on purpose: desktop users click other app chrome while the panel is open, and dismissing on every outside click frustrates that flow. Mobile has no "other chrome to click" — the panel consumes the viewport — so tap-outside is the natural gesture. Do not unify these contracts.
- `useScrollRestore` must capture on the `false → true` transition, not on mount. Mounting when `speciesCode` is already set (deep-link) means there is no pre-open scroll position — capture `scrollY === 0` and restoration is a no-op. That is correct behaviour.
- `matchMedia` in jsdom does not fire change events unless the test wires them; use the mock helper in `test-setup.ts` that simulates the change.

### Out of scope

- Do not add swipe-right-to-dismiss gesture (deferred to release 2 per Plan 6 §Deferred).
- Do not add focus-trap inside the drawer (deferred to release 2 — WCAG 2.2 AA-strict).
- Do not change `SpeciesPanel`'s interaction logic beyond the overlay sibling.

### Dependencies

- Blocked by: `#TBD-6` (map block removed so panel no longer contends with SVG z-index).
- Blocks: `#TBD-11` (SpeciesSearchSurface needs stable panel layout), `#TBD-14` (e2e spec migration needs the new drawer/sidebar selectors).

### Commit message template

```
git commit -m "refactor(frontend): SpeciesPanel — drawer <768, sidebar >=768"
```

### Plan reference

Part of Plan 6, Task 11. See `docs/plans/2026-04-21-plan-6-path-a-reimagine.md#task-11-refactor-speciespanel--drawer-at-mobile-sidebar-at-desktop`.

---

## Issue 9: feat(frontend): FeedSurface with 4 of 5 latent fields

**Labels:** `agent-ready`, `area:frontend`, `enhancement`, `plan:6`
**Plan 6 task:** T7

### Goal

Ship the default `?view=feed` surface — reverse-chronological observation rows showing `comName`, relative `obsDt`, `locName`, `howMany` (null-safe), and row-level `isNotable` badge. This lands 4 of 5 latent fields. Clicking a row opens SpeciesPanel via the existing `?species=` deep-link contract.

### Context

Plan 6 binding decision names feed-primary as the default archetype. `phase-1/area-3-user-task-fit.md` grades feed-primary strongest on T1/T7/T3 — the dogfood tasks. Each row-level field has a specific user-task payoff: `obsDt` → T7 ("what's new"), `locName` → T2 ("near a place"), `howMany` + `isNotable` → T1 ("what was seen").

### Scope

- `format-time.ts` pure helper: `formatRelativeTime(iso: string, now: Date = new Date()): string`. Buckets: "just now" (<60s), "N min ago" (<60m), "Nh ago" (<24h), "yesterday" (24–48h), "Mon 3pm" (<7d), "Apr 14" (<1y), "2023-11-03" (>1y). Hand-rolled (no `Intl.RelativeTimeFormat`).
- `<ObservationFeedRow>` — `React.memo`'d. DOM column order: notable badge → `comName` → count chip (if > 1) → `locName` (if non-null) → relative time. Row `tabIndex={0}`, `role="button"`, click + Enter fire `onSelectSpecies(speciesCode)`.
- `<FeedSurface>` — renders `<ol className="feed" aria-label="Observations">`. Empty state distinguishes "no matches for filters" from "site broken" via filter-aware hints (`notable`, `since === '1d'`).
- Wire into `App.tsx` gated by `state.view === 'feed'`.
- CSS: 44px min-height per row (iOS HIG, `risk-viability.md` Part 2). `.feed-row-notable` background/border for the row-level isNotable badge.

### Files touched

- `frontend/src/utils/format-time.ts` (new) + test
- `frontend/src/components/ObservationFeedRow.tsx` (new) + test
- `frontend/src/components/FeedSurface.tsx` (new) + test
- `frontend/src/App.tsx`
- `frontend/src/styles.css`

### Acceptance criteria

- [ ] `obsDt` renders as relative time (not ISO string) in every row.
- [ ] `locName`, `howMany` (null → "—", 1 → nothing, >1 → "×N"), and `isNotable` badge visible per row.
- [ ] `isNotable` row badge visible even when global `?notable=true` filter is active (row-level flag is independent).
- [ ] Clicking a row opens SpeciesPanel with the correct species.
- [ ] `?notable=true` filter correctly narrows the feed.
- [ ] Empty state renders filter-aware hint text (e.g. "Try turning off Notable only.").
- [ ] No row uses `observation.lat` or `observation.lng` for display (that is `#TBD-10`).
- [ ] 7 `format-time` unit tests (one per bucket); 5 `ObservationFeedRow` tests; FeedSurface tests cover empty state, loading state, single row, notable badge, row click.
- [ ] Feed cold-render under 1s at 2,000 rows on mid-tier phone profile.
- [ ] PR screenshots attached: feed default at 1440×900 and 390×844, plus notable-filtered state.

### Gotchas

- Row-level `isNotable` appearance must not depend on the global `?notable` filter state. These are two different things: the global filter narrows the set; the row badge flags the observation as ornithologically notable regardless of filter.
- `howMany: null` renders as "—", not "0" or blank. eBird sends null when the observer didn't record a count. 0 is semantically different and the wire does not produce it.
- `locName: null` renders the row without the location text (eBird edge case). Do not render the string "null".

### Out of scope

- Do not render `observation.lat`/`lng` — that goes on hotspot rows in `#TBD-10`.
- Do not add the taxonomic-sort toggle — that is `#TBD-12`.
- Do not add virtualisation — `React.memo` is sufficient at current volume (prototype-verified; see `risk-viability.md` §Part 7).

### Dependencies

- Blocked by: `#TBD-1` (gzip for mobile), `#TBD-6` (`<main>` slot), `#TBD-7` (readiness gate).
- Blocks: `#TBD-12` (taxonomic-sort toggle extends FeedSurface), `#TBD-16` (happy-path spec).

### Commit message template

```
git commit -m "feat(frontend): FeedSurface with 4 of 5 latent fields"
```

### Plan reference

Part of Plan 6, Task 7. See `docs/plans/2026-04-21-plan-6-path-a-reimagine.md#task-7-build-feedsurface--observationfeedrow--format-time`.

---

## Issue 10: feat(frontend): HotspotListSurface with lat/lng + richness sort

**Labels:** `agent-ready`, `area:frontend`, `enhancement`, `plan:6`
**Plan 6 task:** T8

### Goal

Ship the `?view=hotspots` surface: hotspot rows sorted by `latestObsDt` DESC (default), with a three-way sort toggle (latest / richness-desc / richness-asc). Each row shows `locName`, relative `latestObsDt`, `numSpeciesAlltime`, and formatted `lat`/`lng` — this is where the 5th latent-field group lands.

### Context

Plan 6 Task 8 places `lat`/`lng` on hotspot rows (not observation rows) because hotspot rows carry a stable per-location coordinate suitable for trip planning, while per-observation coordinates are noisy and redundant with `locName` (Decision C in `final-sequencing.md`). Serves user tasks T5 ("where to go") and T6-partial.

### Scope

- `format-coords.ts` helper: `formatCoords(lat: number, lng: number): string` → "31.51°N, 110.35°W".
- `<HotspotSortControls>` — three radio-like buttons (latest / richness-desc / richness-asc). `aria-pressed="true"` on active. Space/Enter activate.
- `<HotspotRow>` — renders `locName`, `formatRelativeTime(latestObsDt)`, `numSpeciesAlltime` as "412 species", `formatCoords(lat, lng)`. 44px min-height.
- `<HotspotListSurface>` — holds sort mode in local `useState` (NOT URL-persisted per Plan 6 §Architecture decision 4). `latestObsDt === null` sorts last in every mode. Stale hotspots (null `latestObsDt` or > 30 days) get `.hotspot-row-stale` (faded; still clickable).
- Wire into `App.tsx` gated by `state.view === 'hotspots'`.

### Files touched

- `frontend/src/utils/format-coords.ts` (new) + test
- `frontend/src/components/HotspotRow.tsx` (new) + test
- `frontend/src/components/HotspotSortControls.tsx` (new) + test
- `frontend/src/components/HotspotListSurface.tsx` (new) + test
- `frontend/src/App.tsx`
- `frontend/src/styles.css`

### Acceptance criteria

- [ ] Hotspot list renders `locName`, `latestObsDt` relative, `numSpeciesAlltime` count, and coordinate text per row.
- [ ] Coordinate text format: "31.51°N, 110.35°W" (two decimal places; N/S/E/W suffix based on sign).
- [ ] Default sort is freshest-first (`latestObsDt DESC`).
- [ ] Sort controls cycle between `latest` / `richness-desc` / `richness-asc`; default restores on surface re-entry (local state only).
- [ ] `latestObsDt === null` rows sort last in every mode.
- [ ] Stale rows (null or > 30 days old) de-emphasised via `.hotspot-row-stale`.
- [ ] 4 `format-coords` tests (one per hemisphere).
- [ ] `npm run typecheck && npm run test` green.
- [ ] PR screenshots attached: default sort and richness-desc sort at 1440×900 and 390×844.

### Gotchas

- `lng` sign → hemisphere: positive → E, negative → W. `lat` sign → N/S. Do NOT assume the data is all one hemisphere (US-AZ is all western + northern, but the formatter must still branch correctly).
- Local sort state resets to default on surface re-entry. URL-persistence of this state is explicitly deferred to release 2 (see `#TBD-17` exit criteria score).
- `use-bird-data.ts` already fetches hotspots (re-enabled in `#TBD-5`). Do not add a second fetch here.

### Out of scope

- Do not add URL-persistence for the sort mode.
- Do not add a map thumbnail or any spatial visualisation.
- Do not add hotspot search/filter input.

### Dependencies

- Blocked by: `#TBD-5` (use-bird-data cleanup), `#TBD-6` (`<main>` slot).
- Blocks: `#TBD-16` (happy-path spec), `#TBD-17` (5-of-5 latent fields grep).

### Commit message template

```
git commit -m "feat(frontend): HotspotListSurface with lat/lng + richness sort"
```

### Plan reference

Part of Plan 6, Task 8. See `docs/plans/2026-04-21-plan-6-path-a-reimagine.md#task-8-build-hotspotlistsurface--hotspotrow--hotspotsortcontrols`.

---

## Issue 11: feat(frontend): SpeciesSearchSurface — navigation-style autocomplete

**Labels:** `agent-ready`, `area:frontend`, `enhancement`, `plan:6`
**Plan 6 task:** T9

### Goal

Ship the `?view=species` surface: a navigation-style autocomplete (distinct from FiltersBar's filter-style species input) that sets `?species=` on selection and opens SpeciesPanel. When `?species=` is set, the surface also renders a client-side filtered list of recent sightings for that species.

### Context

Plan 6 Task 9 emphasises the navigation-vs-filter distinction: the FiltersBar species input narrows the global observation set; the autocomplete here is navigation — it opens the panel without narrowing anything. Both coexist. Cold-load with `?species=X` and no `?view=` implies `view='species'` (from `#TBD-4` sniff).

### Scope

- `<SpeciesAutocomplete>` — typing 2+ chars filters `deriveSpeciesIndex(observations)` by case-insensitive substring on `comName`. ArrowDown moves focus into the option list; Enter selects; ESC clears. Dropdown flips above the input when `input.bottom > window.innerHeight / 2` (prototype-identified dragon: overflow on mobile).
- `<SpeciesSearchSurface>` — when `speciesCode === null`, shows autocomplete + placeholder prompt. When set, shows autocomplete + a "Recent sightings for this species" list reusing `<ObservationFeedRow>` filtered by `speciesCode` client-side.
- Wire into `App.tsx` gated by `state.view === 'species'`.

### Files touched

- `frontend/src/components/SpeciesAutocomplete.tsx` (new) + test
- `frontend/src/components/SpeciesSearchSurface.tsx` (new) + test
- `frontend/src/App.tsx`
- `frontend/src/styles.css`

### Acceptance criteria

- [ ] Typing 2+ chars shows matching species (substring match on `comName`).
- [ ] Selecting a species sets `?species=CODE` and opens SpeciesPanel.
- [ ] Deep-link `?species=vermfly` cold-load still opens panel (existing `species-panel.spec.ts` passes).
- [ ] When `?species=` is set, the recent-sightings list renders that species's observations with the same row shape as ObservationFeed.
- [ ] Dropdown flips above the input when input is below viewport midline (`data-position="above"`).
- [ ] Keyboard nav: ArrowDown into list, Enter selects, ESC clears query.
- [ ] `npm run typecheck && npm run test` green.
- [ ] PR screenshots attached: autocomplete open at 390×844 (bottom-of-viewport — expect above-flip) and at 1440×900 (top — normal below).

### Gotchas

- Positioning uses `getBoundingClientRect()` on the input ref and flips via a `data-position` attribute. Do NOT use a portal — pure CSS placement is sufficient and simpler to test.
- The autocomplete is navigation, NOT a filter. Do not call `set({ family: ... })` or similar — only `set({ speciesCode: code })`.
- `deriveSpeciesIndex` is enriched in `#TBD-12` with `taxonOrder` + `familyCode`; this issue uses the current `{code, comName}` shape. Family grouping lands in `#TBD-12`.

### Out of scope

- Do not pre-populate the autocomplete with a "top 20 species" list on empty query — that is release-2 polish.
- Do not add family grouping or optgroups — `#TBD-12`.
- Do not add server-side species search — client-side substring is sufficient at current volume.

### Dependencies

- Blocked by: `#TBD-6` (`<main>` slot), `#TBD-8` (SpeciesPanel layout stable).
- Blocks: `#TBD-16` (happy-path spec).

### Commit message template

```
git commit -m "feat(frontend): SpeciesSearchSurface — navigation-style autocomplete"
```

### Plan reference

Part of Plan 6, Task 9. See `docs/plans/2026-04-21-plan-6-path-a-reimagine.md#task-9-build-speciessearchsurface--speciesautocomplete`.

---

## Issue 12: feat(frontend): integrate taxonOrder + familyCode — 5 of 5 latent fields

**Labels:** `agent-ready`, `area:frontend`, `enhancement`, `plan:6`
**Plan 6 task:** T10

### Goal

Close the "all 5 latent fields in release 1" binding decision by integrating `taxonOrder` and `familyCode`. Adds a taxonomic sort toggle to FeedSurface ("Recent" / "Taxonomic"), groups SpeciesAutocomplete options by family, and decouples `familyCode` from `silhouetteId` in `derived.ts` — partially unblocking existing issue #57.

### Context

`taxonOrder` lives on `SpeciesMeta`, not `Observation` (`shared-types/src/index.ts:40`), so the feed taxonomic sort requires a `speciesIndex` lookup; species without cached `taxonOrder` sort last (explicit null-last policy). The `silhouetteId`/`familyCode` coupling documented in `App.tsx:32-43` blocks #57; this issue does the minimal decouple (read `familyCode` first, fall back to `silhouetteId`) without resolving #57 fully.

### Scope

- Enrich `deriveSpeciesIndex` to `{code, comName, taxonOrder: number | null, familyCode: string | null}`. `familyCode` sourced via the existing coupling; `taxonOrder` populated only from cached `SpeciesMeta` (else null).
- `FeedSurface` sort toggle: `'chrono'` (default, preserve server order) | `'taxonomic'` (sort by `speciesIndex[code]?.taxonOrder ?? Infinity`). Render `<div className="feed-sort">` toggle above the first row — two radio-buttons mirroring `HotspotSortControls`.
- `SpeciesAutocomplete` grouping: group options by `familyCode`. Sort within group by `taxonOrder ?? comName.localeCompare`. Render visual headers (or `<optgroup>` if using a datalist fallback).
- `derived.ts` decouple: `deriveFamilies` reads `observation.familyCode` first; falls back to `silhouetteId` only when `familyCode` is null/absent. PR body references #57 as partially unblocked.
- Grep-verify all 5 latent fields (paste output into the commit body per Plan 6 Task 10 Step 5).

### Files touched

- `frontend/src/derived.ts` + test
- `frontend/src/components/FeedSurface.tsx` + test
- `frontend/src/components/SpeciesAutocomplete.tsx` + test
- `frontend/src/styles.css`

### Acceptance criteria

- [ ] `deriveSpeciesIndex` returns `{code, comName, taxonOrder, familyCode}`.
- [ ] FeedSurface "Taxonomic" sort orders by `taxonOrder ASC` with nulls last; "Recent" preserves server order (no client re-sort).
- [ ] Feed sort toggle is keyboard-accessible.
- [ ] SpeciesAutocomplete groups options by `familyCode` when the speciesIndex contains >1 family.
- [ ] `deriveFamilies` reads `familyCode` first; falls back to `silhouetteId` only when `familyCode` null.
- [ ] All 5 latent-field greps return ≥1 non-test source match (paste outputs in commit body).
- [ ] PR body references #57 as partially unblocked.
- [ ] `npm run typecheck && npm run test` green.
- [ ] PR screenshots attached: sort toggle in both states.

### Gotchas

- `taxonOrder` null-handling policy MUST be stated explicitly in a component comment: "null values sort after all non-null values; within null group, sort alphabetically by comName".
- Cold-load without any cached `SpeciesMeta` means every `taxonOrder` is null — taxonomic sort degrades to alphabetical. That is expected; the stable `/api/species-index` endpoint is deferred to release 2 per Plan 6 §Deferred.
- The `silhouetteId` decouple is minimal. #57 full resolution (remove the coupling entirely) is NOT in scope for this PR.

### Out of scope

- Do not close #57 here — only partially unblock.
- Do not add a `/api/species-index` endpoint — deferred to release 2.
- Do not URL-persist the feed sort mode.

### Dependencies

- Blocked by: `#TBD-9` (FeedSurface must exist).
- Blocks: `#TBD-17` (release-1 5-of-5 grep exit criterion).
- Relates to: #57 (partially unblocked, not closed).

### Commit message template

```
git commit -m "feat(frontend): integrate taxonOrder + familyCode — 5 of 5 latent fields"
```

### Plan reference

Part of Plan 6, Task 10. See `docs/plans/2026-04-21-plan-6-path-a-reimagine.md#task-10-integrate-taxonorder--familycode--the-fifth-latent-field`.

---

## Issue 13: T6 diversity encoding — scoping (recommend defer to release 2)

**Labels:** `needs-scoping`, `area:frontend`, `plan:6`
**Plan 6 task:** T14

### Goal

Decide whether a T6 "diversity at a glance" encoding (candidate: 9-bar horizontal chart of species-per-region) ships in release 1. Recommendation is to defer to release 2 and accept T6=0 / honest 10/14 score. This issue captures the scoping decision; if deferred, it closes with a documentation comment.

### Context

`risk-viability.md` §T6-weakness: a sorted hotspot list is not a "glance" — "at a glance" is the defining verb. Shipping a half-done 9-bar chart to claim 11/14 is the first-release-ship-pressure H6 warns against. Plan 6 binding decision 2 scopes this out of release 1 and targets honest 10/14. The 9-region axis is also semantically awkward while `?region=` is deprecated as a navigation surface param.

### Scope

- Document the scoping decision in an issue comment: ship in release 1 or defer, with explicit T6 score consequence (1 → 11/14 vs 0 → 10/14).
- If deferred (recommended): close this issue with the comment linked from `#TBD-17` exit criteria, and confirm the decision is reflected in Plan 6 §Deferred-to-release-2.
- If shipped (contrary decision): file a follow-up implementation issue with full scope (files, tests, axe-clean). Not expected.

### Files touched (if executed)

- `frontend/src/components/DensityStrip.tsx` (new)
- `frontend/src/components/DensityStrip.test.tsx` (new)
- `frontend/src/App.tsx` (render above feed)

### Acceptance criteria (scoping)

- [ ] Decision documented in an issue comment: defer OR ship.
- [ ] If deferred: issue closed; `final-sequencing.md` §8 crosswalk reflects 10/14 target; `#TBD-17` exit-criteria score updated accordingly.
- [ ] If shipped: follow-up implementation issue filed; acceptance criteria include bar chart rendering per-region counts, `axe-clean`, PR screenshots.

### Gotchas

- Do not execute the 9-bar chart without an explicit ship decision. The recommendation is defer; if executed anyway, the score claim becomes indefensible because the 9-region axis is going away as a primary surface param.
- Closing this issue without leaving a decision comment makes `#TBD-17`'s exit-criteria score ambiguous. Always write the defer/ship comment before closing.

### Out of scope

- Do not add any T6 UI in this issue regardless of decision — that would be a separate implementation issue.
- Do not restore `?region=` as a primary surface param to make the 9-bar chart make sense.

### Dependencies

- Independent — can be scoped in parallel with surface builds.
- Blocks: `#TBD-17` (exit-criteria score depends on this decision).

### Commit message template (if deferred, no code change — close comment only)

```
(no commit; close issue with scoping comment)
```

### Commit message template (if shipped — unlikely)

```
git commit -m "feat(frontend): T6 diversity-strip chart above feed"
```

### Plan reference

Part of Plan 6, Task 14. See `docs/plans/2026-04-21-plan-6-path-a-reimagine.md#task-14-t6-scope-out-with-tracking-ticket`.

---

## Issue 14: test(frontend): migrate REFACTOR e2e specs to data-render-complete

**Labels:** `agent-ready`, `area:frontend`, `testing`, `e2e`, `plan:6`
**Plan 6 task:** T12

### Goal

Update the 8 surviving REFACTOR e2e specs to consume the new `[data-render-complete="true"]` readiness signal and the new surface-interaction contract. Replace every `[data-region-id]` reference and every `app.expandRegion()` call. Drop the POM alias `waitForMapLoad` at PR end.

### Context

The dying signal is `[data-region-id]` count=9 (cited in 5 spec files). The replacement is `data-render-complete="true"` on `<main>` (`#TBD-7`). Spec-by-spec migration keeps the diff reviewable and ensures each legacy interaction has a sensible surface-native replacement.

### Scope

- POM: remove the `waitForMapLoad` alias introduced in `#TBD-7`. Confirm no caller remains via `rg waitForMapLoad frontend/e2e`.
- `species-panel.spec.ts`: open panel via `?species=` deep link or a feed-row click (not map-expand-then-badge-click).
- `deep-link.spec.ts`: URL round-trip on autocomplete-select, view toggle, filter change. Drop `?region=` cases.
- `a11y.spec.ts` test 1: "Space expands region" → "Space activates a focused feed row, opens SpeciesPanel".
- `axe.spec.ts`: three scan targets — feed, species-search, hotspots. Drop the region-expanded scan.
- `prod-smoke.preview.spec.ts`: production URL loads to `data-render-complete="true"` within 10s; default feed has ≥1 row (skip-gracefully on ingestor stall with an informative message).
- `error-states.spec.ts`: `aria-busy` selector moves from `.map-wrap` to `main`.
- `history-nav.spec.ts`: back/forward exercises surface toggles + filter changes instead of `expandRegion`.
- `filters.spec.ts`: assertions become "row count decreases with `?notable=true`" (not "badge count decreases").

### Files touched

- `frontend/e2e/pages/app-page.ts`
- `frontend/e2e/species-panel.spec.ts`
- `frontend/e2e/deep-link.spec.ts`
- `frontend/e2e/a11y.spec.ts`
- `frontend/e2e/axe.spec.ts`
- `frontend/e2e/error-states.spec.ts`
- `frontend/e2e/history-nav.spec.ts`
- `frontend/e2e/prod-smoke.preview.spec.ts`
- `frontend/e2e/filters.spec.ts`

### Acceptance criteria

- [ ] All 8 surviving spec files pass: `npm run test:e2e --workspace @bird-watch/frontend` exits 0.
- [ ] Zero `[data-region-id]` references in `frontend/e2e/` (`rg data-region-id frontend/e2e`).
- [ ] Zero `app.expandRegion` calls.
- [ ] Zero `.map-wrap` selectors.
- [ ] `axe.spec.ts` scans feed + species-search + hotspots and passes WCAG 2.1 AA at both viewports.
- [ ] `retries: 0` setting unchanged.
- [ ] `waitForMapLoad` alias removed from POM.

### Gotchas

- `prod-smoke.preview.spec.ts` runs against the deployed preview and may legitimately surface ingestor stall (`#TBD-2`) as an empty feed. The spec must skip-gracefully (with a message) rather than fail-hard, so CI in that case flags the ingestor not the frontend. Document the skip condition clearly.
- Playwright `workers: 2` in CI means two specs can execute concurrently. Any `page.route` stub must be scoped per-test (not per-worker); otherwise one test's stub leaks into another.
- `axe.spec.ts` scans are WCAG 2.1 AA (tag set unchanged). Do not upgrade to 2.2 — that is out of scope and would fail on known-deferred patterns.

### Out of scope

- Do not write the new happy-path spec here — `#TBD-16`.
- Do not add new specs beyond the migrations listed.
- Do not change the Playwright config (`workers`, `retries`, `fullyParallel`).

### Dependencies

- Blocked by: `#TBD-6` (DISCARD specs deleted), `#TBD-7` (gate attribute exists), `#TBD-8` (SpeciesPanel drawer/sidebar layout stable).
- Blocks: `#TBD-16`, `#TBD-17`.

### Commit message template

```
git commit -m "test(frontend): migrate REFACTOR e2e specs to data-render-complete"
```

### Plan reference

Part of Plan 6, Task 12. See `docs/plans/2026-04-21-plan-6-path-a-reimagine.md#task-12-migrate-refactor-e2e-specs-to-the-new-readiness-gate`.

---

## Issue 15: chore: optional Path A prototype (2–4 hours, throwaway branch)

**Labels:** `needs-scoping`, `area:frontend`, `plan:6`
**Plan 6 task:** T6

### Goal

Optional 2–4 hour Path A prototype on a throwaway branch (`prototype/path-a-feed`) to validate the Path A dragons (filter-flip latency, scroll-restore, autocomplete overflow, empty-state legibility) before the deletion wave lands. Output: a 5-line `prototype-notes.md` that tightens acceptance criteria on `#TBD-9` and/or `#TBD-8`.

### Context

Plan 6 pre-plan decision 3 budgets 2 hours for this gate. Path A dragons differ from Plan 4's SVG dragons (`risk-viability.md` Parts 5, 7). If skipped, Julian accepts the evidence from the analysis funnel (the posted filing context says the prototype is being skipped for this round — this issue is filed as optional insurance and can be closed if not executed).

### Scope

- Branch: `git checkout -b prototype/path-a-feed` off main. Do NOT push.
- Fixture: save `GET /api/observations?since=14d` as `observations-344.json`. Optionally upsample to 2000 rows via `Array.from({length: 2000}, (_, i) => data[i % 344])` for stress runs.
- Minimal `<PrototypeFeed>` (~80 LOC) rendering rows with all five fields.
- Exercise at production dimensions: 390×844, 768×1024, 1440×900. Target: cold render < 1s on mid-tier phone; filter flip < 200ms at 2000 rows with `React.memo`.
- Write `docs/plans/2026-04-21-path-a-assessment/prototype-notes.md` with 5 bullets: row density at 390px; whether `React.memo` suffices; mobile drawer slide direction (right vs bottom); scroll-restore observations; one unanticipated dragon.
- Feed learnings back into `#TBD-9` or `#TBD-8` acceptance criteria (at least one concrete update).

### Files touched (throwaway branch only)

- `frontend/src/prototype/PrototypeFeed.tsx`
- `frontend/src/prototype/observations-344.json`
- `docs/plans/2026-04-21-path-a-assessment/prototype-notes.md`

### Acceptance criteria

- [ ] `prototype-notes.md` exists with the 5 bullets.
- [ ] At least one concrete acceptance-criteria update lands on `#TBD-9` or `#TBD-8`.
- [ ] Throwaway branch is NOT pushed or merged to main.
- [ ] If skipped per Julian's decision: close this issue with comment "Skipped — analysis funnel evidence accepted per 2026-04-20 decision".

### Gotchas

- Do not push the branch. The prototype fixture can contain real observation data that is cheap to regenerate but not useful in the main history.
- Do not land prototype code in any surface PR (`#TBD-9`, `#TBD-10`, `#TBD-11`) — the throwaway is for calibration only.

### Out of scope

- Do not wire the prototype to the real API.
- Do not write unit or e2e tests for the prototype.
- Do not style the prototype beyond what is needed to exercise dimensions.

### Dependencies

- Independent. File it alongside Week 0 issues; execute before `#TBD-9` if Julian opts in.

### Commit message template (throwaway branch)

```
git commit -m "chore(prototype): Path A feed prototype — learnings capture"
```

### Plan reference

Part of Plan 6, Task 6. See `docs/plans/2026-04-21-plan-6-path-a-reimagine.md#task-6-prototype-gate-throwaway-branch`.

---

## Issue 16: test(frontend): new Path A happy-path e2e spec

**Labels:** `agent-ready`, `area:frontend`, `testing`, `e2e`, `plan:6`
**Plan 6 task:** T13

### Goal

Write the new `frontend/e2e/happy-path.spec.ts` replacing the DISCARD'd spec of the same name. Covers the five Path A scenarios that together exercise the default surface, filtering, the species deep-link cold-load, and the SpeciesPanel drawer-vs-sidebar contract.

### Context

`#TBD-6` deleted the old happy-path spec (it was entirely about map expansion). The new spec validates the release-1 user journey end-to-end. `retries: 0` is deliberate (CLAUDE.md); any flake here is a bug, not a retry candidate.

### Scope

Five tests in one `test.describe('Path A happy path', ...)`:

1. `feed surface loads by default` — goto `/`, `await app.waitForAppReady()`, assert ≥1 `.feed-row`, assert `aria-selected="true"` on the Feed tab.
2. `filters narrow the feed` — toggle `?notable=true` via the checkbox; assert fewer rows (or equal + informative log if fixture has no non-notable rows).
3. `species deep link cold-loads to search surface with panel open` — goto `/?species=vermfly`; assert `view=species` tab active, SpeciesPanel visible (`getByRole('complementary')`), `?species=vermfly` still in URL.
4. `panel opens at mobile as drawer with overlay` — `page.setViewportSize({ width: 390, height: 844 })`, goto `/?species=vermfly`; assert `[data-layout="drawer"]` + overlay present; tap overlay; assert panel dismissed and `?species=` removed.
5. `panel opens at desktop as sidebar without overlay` — `page.setViewportSize({ width: 1440, height: 900 })`, same flow; assert `[data-layout="sidebar"]`; overlay NOT present; ESC dismisses.

No DB writes. Audit with the CLAUDE.md grep:

```
grep -rE "request\.(post|patch|delete|put)|fetch\(.*method:|fetch\(.*[\"']POST[\"']" frontend/e2e/happy-path.spec.ts
```

### Files touched

- `frontend/e2e/happy-path.spec.ts` (new)

### Acceptance criteria

- [ ] All 5 tests pass with `npm run test:e2e --workspace @bird-watch/frontend`.
- [ ] No DB-write grep hits (zero output from the CLAUDE.md grep).
- [ ] `retries: 0` unchanged.
- [ ] `workers: 2` in CI / `fullyParallel: true` — tests survive parallel execution without flake across 5 runs.
- [ ] No `test.fail()` in the file.

### Gotchas

- Test 2 (filter narrowing) can legitimately produce equal-row-count when the fixture happens to be all-notable. Log and continue rather than assert strict inequality — the goal is "filter is wired", not "fixture diversity".
- Test 4 (overlay tap) must assert both panel dismissal AND `?species=` URL removal. Mobile users rely on both.
- Test 5 must NOT assert tap-outside dismissal at desktop (that is intentionally NOT supported per `#TBD-8` contract). ESC is the desktop dismiss gesture.

### Out of scope

- Do not add prod-smoke coverage here — that stays in `prod-smoke.preview.spec.ts` (`#TBD-14`).
- Do not test individual FiltersBar input quirks.
- Do not add screenshot diffing.

### Dependencies

- Blocked by: `#TBD-9`, `#TBD-10`, `#TBD-11` (surfaces must exist), `#TBD-14` (readiness gate + POM migration complete).
- Blocks: `#TBD-17`.

### Commit message template

```
git commit -m "test(frontend): new Path A happy-path e2e spec"
```

### Plan reference

Part of Plan 6, Task 13. See `docs/plans/2026-04-21-plan-6-path-a-reimagine.md#task-13-new-happy-path-e2e-spec`.

---

## Issue 17: test(frontend): release-1 exit criteria meta-issue

**Labels:** `needs-scoping`, `area:frontend`, `testing`, `plan:6`
**Plan 6 task:** T15

### Goal

Close Plan 6 by walking the §Release 1 acceptance checklist, landing a machine-checkable `release-1-assertions.test.ts` that grep-verifies all 5 latent fields are read by the frontend, and documenting the final 10/14 or 11/14 score depending on `#TBD-13`'s decision.

### Context

Plan 6 Task 15 is the self-review gate. Five checks: 5-of-5 latent fields grep-verified; T2/T5/T7 observable on feed/hotspots/species; SpeciesPanel drawer+sidebar; ingestor + gzip green; axe-clean on all surfaces. This issue's PR captures the evidence and declares "Path A shipped."

### Scope

- Write `frontend/src/release-1-assertions.test.ts` — a Vitest spec that runs the 5 grep commands from Plan 6 Task 10 Step 5 and fails if any returns only test matches. (Alternatively, a CI-runnable grep script; Vitest is preferred because it runs inside the existing `test` workflow.)
- Walk the §Release 1 acceptance checklist from Plan 6; every item must be checked. Any unchecked item loops back to the owning task.
- Confirm `/api/observations?since=1d` returns data within 24h (ingestor green) and `content-encoding: gzip` on `/api/observations?since=14d` (gzip green) via curl against the preview URL.
- Axe scan at 390×844 and 1440×900 for each of feed/species/hotspots (via `#TBD-14`'s updated `axe.spec.ts`).
- Visual smoke at 320 / 390 / 768 / 1440 px — one screenshot per breakpoint per surface (12 total). Attach to merge PR.
- Document final score (10/14 or 11/14) based on `#TBD-13`'s decision.

### Files touched

- `frontend/src/release-1-assertions.test.ts` (new)

### Acceptance criteria

- [ ] `release-1-assertions.test.ts` passes: all 5 latent-field greps return ≥1 non-test source match.
- [ ] All four CI checks green on the merge PR: `test`, `lint`, `build`, `e2e`.
- [ ] §Release 1 acceptance checklist items all checked.
- [ ] Final score documented: 11/14 if T6 shipped; 10/14 if T6 deferred (expected).
- [ ] 12 visual-smoke screenshots attached to the PR body.
- [ ] Ingestor green curl output pasted into PR body.
- [ ] Gzip curl output pasted into PR body (`curl -sIH 'accept-encoding: gzip' https://api.bird-maps.com/api/observations?since=14d | grep -i content-encoding`).

### Gotchas

- The grep test relies on `rg` being available in the CI image. If Vitest cannot shell out, fall back to a Node-level `fs.readFileSync` + regex implementation — but emit the same 5-assertion surface.
- Screenshot attachment must use absolute raw-githubusercontent URLs with the commit SHA (per PR template) — relative paths do not render in GitHub PR bodies.
- Do not close this issue if T6 scoping (`#TBD-13`) is still open. Exit-criteria score is ambiguous until that decision lands.

### Out of scope

- Do not add new features here.
- Do not migrate any remaining specs (should all be done by `#TBD-14` and `#TBD-16`).
- Do not file release-2 issues from within this PR — Plan 6 §Deferred already names them.

### Dependencies

- Blocked by: `#TBD-9`, `#TBD-10`, `#TBD-11`, `#TBD-12`, `#TBD-13` (scoping resolved), `#TBD-14`, `#TBD-16`.
- Also blocked by `#TBD-2` (ingestor must be green for the curl assertion).

### Commit message template

```
git commit -m "chore(frontend): Plan 6 self-review sweep"
```

### Plan reference

Part of Plan 6, Task 15. See `docs/plans/2026-04-21-plan-6-path-a-reimagine.md#task-15-self-review-gate-and-release-1-acceptance-check`.

---

## Crosswalk

| Sequencing Issue # | Plan 6 Task # | Title | Primary label set | Size | Critical path? |
|---|---|---|---|---|---|
| 1 | T1 | feat(read-api): enable gzip compression | `agent-ready` `area:read-api` `enhancement` `plan:6` | XS | No (unblocks 9) |
| 2 | §R2 (operational) | fix(ingestor): restore fresh observation writes | `agent-ready` `area:ingestor` `bug` `plan:6` | S | No (17 blocker) |
| 3 | — | docs: CLAUDE.md prototype-gate + stale opening | `agent-ready` `area:docs` `documentation` `plan:6` | XS | No |
| 4 | T2 + T3 | feat(frontend): `?view=` + SurfaceNav scaffold | `agent-ready` `area:frontend` `enhancement` `plan:6` | S | Yes |
| 5 | T2 + T4 + T5 (folded) | refactor(frontend): drop regionId + `?region=` banner | `agent-ready` `area:frontend` `enhancement` `plan:6` | M | Yes |
| 6 | T5 | refactor(frontend): delete map rendering chain | `agent-ready` `area:frontend` `enhancement` `plan:6` | L | Yes |
| 7 | T12 (gate) | refactor(frontend): `[data-render-complete]` gate | `agent-ready` `area:frontend` `testing` `plan:6` | XS | Yes |
| 8 | T11 | refactor(frontend): SpeciesPanel drawer/sidebar | `agent-ready` `area:frontend` `accessibility` `enhancement` `plan:6` | M | Partial |
| 9 | T7 | feat(frontend): FeedSurface with 4/5 latent fields | `agent-ready` `area:frontend` `enhancement` `plan:6` | M | Yes |
| 10 | T8 | feat(frontend): HotspotListSurface + lat/lng | `agent-ready` `area:frontend` `enhancement` `plan:6` | M | No (but 17 blocker) |
| 11 | T9 | feat(frontend): SpeciesSearchSurface | `agent-ready` `area:frontend` `enhancement` `plan:6` | M | No (but 16/17 blocker) |
| 12 | T10 | feat(frontend): taxonOrder + familyCode 5-of-5 | `agent-ready` `area:frontend` `enhancement` `plan:6` | M | Yes |
| 13 | T14 | T6 diversity-encoding scoping | `needs-scoping` `area:frontend` `plan:6` | XS | No |
| 14 | T12 (migration) | test(frontend): migrate REFACTOR e2e specs | `agent-ready` `area:frontend` `testing` `e2e` `plan:6` | M | Partial |
| 15 | T6 | chore: optional Path A prototype | `needs-scoping` `area:frontend` `plan:6` | XS | No |
| 16 | T13 | test(frontend): new Path A happy-path spec | `agent-ready` `area:frontend` `testing` `e2e` `plan:6` | S | Yes |
| 17 | T15 | test(frontend): release-1 exit criteria | `needs-scoping` `area:frontend` `testing` `plan:6` | XS | Yes |

Critical path: 4 → 5 → 6 → 7 → 9 → 12 → 17 (seven deep); intersecting chain 6 → 8 → 14 → 16 → 17 (five deep).

---

## Batch filing guide

File in dependency order. Issues 1–4 and 15 can be filed as one parallel batch — they have no in-batch dependencies. After they are open, file 5 (needs the `view` UrlState field referenced from 4). After 5, file 6. After 6, file 7 and 8 as a parallel batch. After 6, 7, and 8 are open, file 9, 10, 11 as a parallel batch; file 13 and 14 alongside them. After 9 is open, file 12 (extends FeedSurface). After 9, 10, 11, 14 are all filed, file 16. File 17 last.

Parallel-safe batches (can be filed in one pass each):

- **Batch A (Week 0):** 1, 2, 3, 4, 15
- **Batch B (Week 1 opener):** 5 (after 4 is filed)
- **Batch C (Week 1 body):** 6 (after 4 and 5 are filed)
- **Batch D (Week 1 tail):** 7, 8 (after 6 is filed)
- **Batch E (Week 2 opener):** 9, 10, 11, 13, 14 (after 6, 7, 8 are filed)
- **Batch F (Week 2 mid):** 12 (after 9 is filed)
- **Batch G (Week 3):** 16, then 17

Resolve every `#TBD-N` placeholder to the real GitHub issue number after each batch — otherwise dependency chains lose their cross-links.

### Example `gh issue create` invocation (use this pattern)

```
gh issue create \
  --title "feat(read-api): enable gzip compression middleware" \
  --label "agent-ready,area:read-api,enhancement,plan:6" \
  --body "$(cat <<'EOF'
**Labels:** agent-ready, area:read-api, enhancement, plan:6
**Plan 6 task:** T1

### Goal

Add compress() middleware to the Hono app so all JSON responses ship with Content-Encoding: gzip. [...]

### Commit message template

git commit -m "feat(read-api): enable gzip compression middleware"

### Plan reference

Part of Plan 6, Task 1. See docs/plans/2026-04-21-plan-6-path-a-reimagine.md#task-1-enable-gzip-compression-on-the-read-api
EOF
)"
```

Paste the full body from this document verbatim into the heredoc. No backslash-escaped backticks (per the `feedback_pr_description_format` memory note). No newlines in the `--title`. Labels must exist before filing — run the `gh label create "plan:6"` command from §Pre-flight first.
