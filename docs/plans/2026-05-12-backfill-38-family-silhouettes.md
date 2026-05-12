# Backfill 38 Family Silhouettes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This plan is designed to be picked up by a fresh subagent with zero prior context for this codebase — every task lists exact file paths, full code, expected commands, and a commit-message template.

**Goal:** Close the `family_silhouettes` audit-query gap by inserting one row for each of the 38 AZ-observed bird families currently missing from `family_silhouettes` (after PR #494 lands icteridae). Every new row carries a real CC-licensed Phylopic silhouette, a distinct color, full attribution, and an English common-name string — so the legend, cluster mosaics, and detail surface stop falling back to `_FALLBACK` for nearly half of the live AZ birds.

**Architecture:** One batched data-only SQL migration under `migrations/` inserts all 38 rows in a single transaction. SVG path-data is sourced by re-running `scripts/curate-phylopic.mjs` (the existing curation pipeline that produced migration 17000's 22 Phylopic rows) against the new family list, then hand-reviewed using `scripts/curate-phylopic-review.html`. Three test snapshots are updated to reflect the new row counts and the new color/common-name entries. No frontend code changes — the existing `<FamilyLegend>` join, the SDF symbol layer, and `<SpeciesDetailSurface>` all read these rows through the existing `/api/silhouettes` route and will start rendering the new families automatically. No new schema, no new endpoint.

**Tech Stack:** Plain SQL migration (`node-pg-migrate`-managed, `-- Up Migration` / `-- Down Migration` markers), `scripts/curate-phylopic.mjs` (Node ESM, no deps beyond stdlib), Vitest 4 + `@testcontainers/postgresql` for migration-aware integration tests, Playwright MCP for UI verification at 390×844 and 1440×900.

---

## Background and motivation

### The chain

1. **Issue #55** — original "per-family Phylopic silhouettes" epic. Status: still open, `needs-scoping`. Predates the live system.
2. **Epic #251** — decomposed #55 into 9 sub-issues. Shipped migration 17000 (22 real Phylopic rows for the 25 families seeded by migrations 9000 + 15000) plus the `_FALLBACK` row in migration 18000.
3. **Issue #482 + PR #494** — flagged that the production `observations` table had ~49 Western Meadowlark rows whose `family_code = 'icteridae'` had no matching row in `family_silhouettes`. Three rendering symptoms (silently dropped from `<FamilyLegend>`, neutral `_FALLBACK` grey in `<SpeciesDetailSurface>`, gray 50%-opacity tile in cluster mosaics) all collapsed to one missing seed row. PR #494 shipped the single-row fix.
4. **PR #494's audit-query disclosure** — the implementer ran the audit query suggested in #482 and found icteridae is one of **39** observed-but-unseeded families. After #494 merges, the audit returns **38**.
5. **This plan / issue #495** — closes the remaining 38 rows in one batched migration, following the same curation/seed/test pattern epic #251 established and PR #494 modeled at single-row scale.

### The audit query

```sql
SELECT DISTINCT family_code FROM observations
WHERE family_code NOT IN (SELECT family_code FROM family_silhouettes);
```

Currently returns 39 rows. After PR #494 merges, this returns 38. After the migration produced by this plan applies, this returns **0**.

### Why this isn't part of PR #494

PR #494's implementer explicitly scoped down: "Hand-curating 38 Phylopic rows in a single PR would re-implement the audit/curation pipeline that already exists at `scripts/curate-phylopic.mjs`. The right shape for the 38-family fix is: re-run that script against the current observed-family set, review each suggested silhouette/license/contributor, generate one batched migration." That's exactly what this plan does.

### What the existing pipeline does

`scripts/curate-phylopic.mjs` (the script that produced migration 17000):

1. For each family in `FAMILIES`, calls Phylopic `/nodes?filter_name=<family>` → resolves taxonomic node UUID. HTTP 404 → "genuine absence", emit a NULL UPDATE; HTTP 5xx / network error → retry 3× then **abort the whole run** (never write a misleading migration).
2. For the node UUID, calls `/images?filter_node=<uuid>&embed_items=true` → enumerates candidates. Filters out anything without `_links.vectorFile.href` or with a license outside `{CC0-1.0, CC-BY-3.0, CC-BY-4.0, CC-BY-SA-3.0}`.
3. Auto-pick: license preference (CC0 > CC-BY-3.0 > CC-BY-4.0 > CC-BY-SA-3.0) → alphabetical creator → UUID. Downloads vectorFile, runs `extractPathD` (potrace `<g transform>` flattening + normalize to 0..24 viewBox).
4. Writes `scripts/phylopic-picks.json` (full audit trail) and `migrations/1700000017000_seed_family_silhouettes_phylopic.sql` (one UPDATE per row).
5. `scripts/phylopic-picks.json#skipFamilies` lets the operator permanently flag families with no usable Phylopic entry — those produce a NULL UPDATE with the migration comment naming each one.

Two parts of this script need attention for the 38-family backfill:

- **`FAMILIES` constant** (lines 89–97): hardcoded to the 25 original families. This plan replaces it with the 38 new families and changes the output path so the new migration sits alongside (not overwriting) migration 17000.
- **Statement type**: the script emits `UPDATE family_silhouettes SET ... WHERE family_code = '...'`, but the 38 new rows don't exist yet — we need `INSERT`s. The plan handles this by generating the script output into a staging file, then transforming UPDATEs to INSERTs with the additional columns (`id`, `color`, `common_name`) that migration 17000's UPDATEs don't carry.

### Why a single batched migration (not 38 separate migrations)

- Operationally cleaner: one `node-pg-migrate up` either applies the whole set or rolls back — partial state is not a valid landing.
- Mirrors migration 17000's shape: batched UPDATEs for all 22 successful picks plus one batched NULL UPDATE for the skip families. We're following the established precedent, not inventing one.
- The down migration is a single `DELETE FROM family_silhouettes WHERE family_code IN (...38 codes...)` — surgical, won't disturb rows from other migrations.

---

## Prototype gate decision

**Prototype gate is satisfied transitively. No new prototype is required.**

The CLAUDE.md prototype gate exists to validate **rendering approach** at production data volume and viewports before authoring a plan body. The rendering approach for family silhouettes was validated three times before this plan was written:

1. Migration 17000 (epic #251, 2026-04-26) shipped 22 real Phylopic-curated rows through `<FamilyLegend>` + the SDF symbol layer + the cluster mosaic + `<SpeciesDetailSurface>`. That code path is unchanged and serves bird-maps.com in production today.
2. PR #494 (2026-05-11) added one new row (`icteridae`) through the exact same code path. The PR's Playwright MCP smoke (5 viewports × 2 themes, zero console errors/warnings) confirms a single new `family_silhouettes` row produces the expected rendering across all four surfaces with no code changes.
3. The geometry contract is identical: 0..24-viewBox path-d strings, the same `extractPathD` routine in `scripts/curate-phylopic.mjs`, same `<FamilySilhouette viewBox="0 0 24 24">` consumer in `frontend/src/components/ds/FamilySilhouette.tsx`.

What this plan adds is **data volume**: 38 rows instead of 1. There is no rendering question being asked that PR #494 hasn't already answered at N=1. The risks for this plan are curation-quality (does Phylopic actually have a usable silhouette for each family? — handled by the script's NULL-skip + `skipFamilies` mechanism) and color-palette distinctness (handled in Task 3 below) — neither is a rendering question a prototype could de-risk.

**The Playwright MCP UI verification at the end of this plan (Task 10) is still mandatory** — that's a different gate (per-PR UI smoke under CLAUDE.md's "Testing > UI verification") and it catches console drift, layout breakage at the two release-1 viewports, and the actual visual quality of the picked silhouettes at 24-28px in the legend chip. It is *not* a prototype gate.

---

## Conventions baked in

- **TDD per task.** Every code-producing task in this plan follows: write failing test → confirm failure → write minimal implementation → confirm pass → commit. No batching.
- **No DB mocks.** Tests run against real Postgres + PostGIS via `@testcontainers/postgresql`. The `migrations-down-chain.test.ts` boots `postgis/postgis:16-3.4` and runs the full migration set.
- **Plain SQL migrations under `migrations/`** with `-- Up Migration` / `-- Down Migration` markers. `node-pg-migrate` sorts by filename so the lexically-next filename is the next-to-apply.
- **Conventional commits.** Each task lists a commit-message template using `fix(migrations):`, `chore(scripts):`, `test(db-client):`, etc.

---

## File structure

| Path | Disposition | Responsibility |
|---|---|---|
| `scripts/curate-phylopic.mjs` | Modify | Add new `BACKFILL_FAMILIES` array + a `--backfill` flag that switches output to the new migration filename and emits INSERTs (not UPDATEs). Existing `--refresh` flag and the 25-family path stay byte-for-byte unchanged so re-running for migration 17000 is still possible. |
| `scripts/phylopic-picks.json` | Modify | Append per-family audit entries for the 38 new families (the script writes this automatically when `--backfill` is set). |
| `migrations/1700000034000_backfill_observed_family_silhouettes.sql` | Create | The batched migration. One `INSERT … VALUES (...), (...), ...` over all 38 rows (or fewer if `skipFamilies` excludes some) with `ON CONFLICT (id) DO NOTHING`. Down filters by exact family-code list. |
| `packages/db-client/src/silhouettes.test.ts` | Modify | Update the row-count assertion (27 → 27 + N picked), extend the color snapshot with N entries, extend the common-name snapshot with N entries. (N = picked families ≤ 38.) |
| `packages/db-client/src/migrations-down-chain.test.ts` | Modify | Bump the post-17000 baseline in the two count assertions to include the new INSERTs (15 → 15 + N picked + 1 icteridae from PR #494; 25 → 25 + N picked + 1 icteridae). |
| `services/read-api/src/app.test.ts` | Modify | Update `GET /api/silhouettes` row-count assertion (27 → 27 + N picked). |
| `docs/plans/2026-05-12-backfill-38-family-silhouettes.md` | Create | This plan document. |

The migration filename uses `1700000034000_` so it sorts strictly after the post-#494 numbering. After PR #494 merges, the highest-numbered migration is `1700000033000_seed_family_silhouette_icteridae.sql`. The number `1700000034000_` is reserved by this plan.

**Migration-filename collision note.** Pre-#494, the `1700000032000_` slot was claimed by **both** `1700000032000_backfill_species_meta_spuh_hybrid.sql` (PR #485) and `1700000032000_seed_family_silhouette_icteridae.sql` (the early PR #494 iteration). PR #494 renamed its file to `1700000033000_…` on the same branch. This plan's `1700000034000_…` does not collide with any landed or in-flight file as of 2026-05-12. If a new migration lands on `main` between when this plan is authored and when it executes, the implementer must bump the prefix to the next free slot and update Tasks 4–8 accordingly.

---

## Open decisions for the implementer

Before starting, the implementer should surface a question on the issue thread (or to Julian directly) for any of these that aren't already resolved:

- **D1: Color palette source.** Are colors chosen formulaically (HSL-rotate around the existing 26 colors so each new one is visually distinct from its neighbors) or hand-picked one by one? Task 3 documents a formulaic default but invites a hand-pick override. Hand-pick is preferred if any family has strong field-mark associations (e.g. red-shouldered, blue-headed) — that signal is lost in a generic rotation.
- **D2: Display-name override list.** eBird's family-display convention is generally "Plural common noun" (e.g. "Larks", "Swallows", "Thrushes") but ornithological convention sometimes prefers "Group & Allies" forms (e.g. PR #494's "Blackbirds, Orioles & Allies"). Task 4 includes a default list per family but every name is up for revision in code review. The default list is sourced from the eBird taxonomy v2024 and matches `migration 19500`'s precedent.
- **D3: License-rejection cohort.** If any of the 38 families have no usable Phylopic candidate (404 from `/nodes`, no candidate with `vectorFile + accepted license`, or only candidates with non-flatten-able transforms), they land in `skipFamilies` and the migration emits an `INSERT` with `svg_data = NULL, source = NULL, license = NULL, creator = NULL` — the `_FALLBACK` consumer renders them with their assigned color. The implementer must surface the skip list at PR-review time so Julian can confirm none of the high-impact families (laridae, hirundinidae, turdidae, falconidae) got skipped through accident rather than genuine absence. PR #485's lead-image learning applies: license filtering is conservative and the operator must visually verify the chosen silhouettes match the family's iconic field-mark.
- **D4: Will #55 be closed?** Issue #55 is the original "per-family Phylopic silhouettes" epic. It pre-dates the live system. Epic #251 implemented most of it; PR #494 + this plan close the residual audit-query gap. After this plan executes, every AZ-observed family has a row. Task 11 below proposes the PR's body include `Refs #55` (not `Closes #55`) and a comment recommending #55 be closed manually by a maintainer once they confirm there's no remaining sub-issue scope. Don't auto-close from the migration PR.

---

## Spec reference

- Issue #495 — full body and acceptance criteria: `gh issue view 495 --repo julianken/bird-sight-system`
- Issue #482, PR #494 — the single-row precedent: `gh issue view 482 --repo julianken/bird-sight-system`, `gh pr view 494 --repo julianken/bird-sight-system`
- Epic #251 plan — `docs/plans/2026-04-25-phylopic-silhouettes-epic-251/plan.md`
- The curation script — `scripts/curate-phylopic.mjs`
- Existing seed migrations — `migrations/1700000009000_seed_family_silhouettes.sql`, `migrations/1700000015000_seed_family_silhouettes_az_families.sql`, `migrations/1700000017000_seed_family_silhouettes_phylopic.sql`, `migrations/1700000018000_seed_family_silhouettes_fallback.sql`, `migrations/1700000019500_seed_family_common_names.sql`
- Common-name convention — `migrations/1700000019500_seed_family_common_names.sql`
- PR template — `.github/PULL_REQUEST_TEMPLATE.md`

---

## Task 1: Audit-query baseline + derive the 38 family list

We need a deterministic, committed list of the 38 families before touching the script. The list comes from the production observations table (via the audit query), not from a hand-typed list.

**Files:**
- Create (scratch, not committed): `/tmp/audit-495.sql`

- [ ] **Step 1: Confirm PR #494 is merged to `main`.**

```bash
gh pr view 494 --repo julianken/bird-sight-system --json state,mergedAt
```

Expected: `"state": "MERGED"`. If not merged, **stop and report back** — this plan strictly assumes #494's icteridae row is already in production. Running the audit query against pre-#494 state would surface 39 families and the row-count math in subsequent tasks is off by one.

- [ ] **Step 2: Run the audit query against production-equivalent local DB.**

```bash
cd services/read-api
docker-compose up -d postgres
npx node-pg-migrate up --migrations-dir ../../migrations \
  --connection-string "postgres://postgres:postgres@localhost:5432/postgres"

psql "postgres://postgres:postgres@localhost:5432/postgres" -c "
  SELECT DISTINCT family_code FROM observations
  WHERE family_code NOT IN (SELECT family_code FROM family_silhouettes)
  ORDER BY family_code;
" > /tmp/audit-495.txt
```

Expected: 38 rows. If 39, PR #494 has not yet migrated locally — re-run `node-pg-migrate up`. If <38, observations table is empty or stale; run a small ingest first via `npm run dev --workspace @bird-watch/ingestor` or seed observations from the test fixture at `services/ingestor/test/fixtures/`. If >38, new families have been ingested since 2026-05-12 — proceed with the larger list and update every `N picked ≤ 38` reference in this plan to `N picked ≤ <new total>`.

- [ ] **Step 3: Save the list as a script constant.**

Save the 38-family list as a JSON array to a scratch file you'll paste into Task 2:

```bash
psql "postgres://postgres:postgres@localhost:5432/postgres" -tA -c "
  SELECT DISTINCT family_code FROM observations
  WHERE family_code NOT IN (SELECT family_code FROM family_silhouettes)
  ORDER BY family_code;
" | tr '\n' ',' | sed 's/,$//'
```

Expected output: a comma-separated list of 38 lowercase family codes (e.g. `alaudidae,anhingidae,apodidae,...,vireonidae`). Save the output verbatim — it becomes `BACKFILL_FAMILIES` in Task 2.

- [ ] **Step 4: No commit.** This task is investigation only.

---

## Task 2: Add `--backfill` mode to `scripts/curate-phylopic.mjs`

Teach the script to take a different family list, write a different migration path, and emit `INSERT` statements (not `UPDATE`s).

**Files:**
- Modify: `scripts/curate-phylopic.mjs:83-97`, `scripts/curate-phylopic.mjs:737-831`

- [ ] **Step 1: Add `--backfill` argv parsing near the top of the script.**

Find the line `const REFRESH = process.argv.includes('--refresh');` (around line 83) and replace it with:

```js
const REFRESH = process.argv.includes('--refresh');
const BACKFILL = process.argv.includes('--backfill');
```

- [ ] **Step 2: Add the 38-family constant.**

After the existing `FAMILIES` constant (around line 97), append:

```js
// Families to backfill per issue #495. Derived from the production audit
// query `SELECT DISTINCT family_code FROM observations WHERE family_code
// NOT IN (SELECT family_code FROM family_silhouettes)` run on 2026-05-12
// after PR #494's icteridae row landed. Ordered alphabetically for
// deterministic curation.
const BACKFILL_FAMILIES = [
  // PASTE THE 38-FAMILY LIST FROM TASK 1, STEP 3 HERE,
  // one quoted lowercase code per array element, alphabetically sorted.
  // Example shape (replace with real list from Task 1):
  // 'alaudidae', 'anhingidae', 'apodidae', 'falconidae', 'gaviidae',
  // 'hirundinidae', 'laridae', 'pandionidae', 'turdidae', 'vireonidae',
  // …
];
```

- [ ] **Step 3: Switch the `FAMILIES` reference in `main()` to honor the flag.**

Find `for (const family of FAMILIES) {` inside `main()` (around line 864) and change `FAMILIES` to `(BACKFILL ? BACKFILL_FAMILIES : FAMILIES)`:

```js
const targetFamilies = BACKFILL ? BACKFILL_FAMILIES : FAMILIES;
console.log(`Curating ${targetFamilies.length} families against Phylopic API (build=${PHYLOPIC_BUILD})`);
…
for (const family of targetFamilies) {
```

(Replace the existing `Curating ${FAMILIES.length} families…` log line and the loop header. Leave every other line in `main()` alone.)

- [ ] **Step 4: Switch the migration output path under `--backfill`.**

Find `const MIGRATION_PATH = resolve(REPO_ROOT, 'migrations/1700000017000_seed_family_silhouettes_phylopic.sql');` (around line 77) and replace with:

```js
const MIGRATION_PATH = resolve(
  REPO_ROOT,
  process.argv.includes('--backfill')
    ? 'migrations/1700000034000_backfill_observed_family_silhouettes.sql'
    : 'migrations/1700000017000_seed_family_silhouettes_phylopic.sql',
);
```

(`process.argv.includes` is used here, not the `BACKFILL` constant, because this is a module-top constant declared before `BACKFILL` and we don't want to reorder. Tradeoff: one extra `argv.includes` call. Acceptable.)

- [ ] **Step 5: Rewrite `emitMigrationSql` to emit `INSERT`s in backfill mode.**

This is the largest change. Find the function `function emitMigrationSql(picks, skipFamilies) {` (around line 737) and add a `mode` parameter. The existing function emits `UPDATE family_silhouettes SET svg_data = '...', source = '...', license = '...', creator = '...' WHERE family_code = '...'`. Backfill mode needs to emit `INSERT INTO family_silhouettes (id, family_code, svg_data, color, source, license, creator, common_name) VALUES (...), (...), ...`.

Replace the entire function body with this implementation. (The full replacement is included here; the engineer can paste over the existing body wholesale.)

```js
/**
 * Emit a SQL migration string. `mode` controls statement shape:
 *   - 'update' (default, existing behavior): UPDATE family_silhouettes SET
 *     ... WHERE family_code = '...' — for re-curating already-seeded rows
 *     (migration 17000).
 *   - 'backfill' (new, issue #495): INSERT INTO family_silhouettes (...)
 *     VALUES (...), (...), ... ON CONFLICT (id) DO NOTHING — for adding
 *     rows that don't exist yet. Carries the extra columns (`id`, `color`,
 *     `common_name`) that UPDATE mode doesn't touch.
 *
 * `colorByFamily` and `commonNameByFamily` (both Record<string, string>)
 * are only consumed in 'backfill' mode and are looked up by family code.
 */
function emitMigrationSql(picks, skipFamilies, mode = 'update', colorByFamily = {}, commonNameByFamily = {}) {
  const today = todayUtc();
  const lines = [];
  lines.push('-- Up Migration');
  if (mode === 'backfill') {
    lines.push('-- Issue #495. Backfills family_silhouettes rows for the 38 AZ-observed');
    lines.push('-- bird families surfaced by the audit query in #482/#494, closing the');
    lines.push('-- last gap between observations.family_code and family_silhouettes.');
    lines.push(`-- Generated by scripts/curate-phylopic.mjs --backfill on ${today}`);
    lines.push('-- using the Phylopic API two-step recipe (/nodes?filter_name →');
    lines.push('-- /images?filter_node) and the auto-pick heuristic (license preference');
    lines.push('-- CC0 > CC-BY > CC-BY-SA, then alphabetic creator, then UUID).');
    lines.push('--');
    lines.push('-- Each row carries: a 0..24-viewBox single-path SVG extracted from the');
    lines.push('-- Phylopic vectorFile (potrace <g transform> flattened + normalized),');
    lines.push('-- a distinct hex color (assigned in this PR; visible-from-#555 fallback),');
    lines.push('-- a Phylopic image-page URL as `source`, a short license identifier in');
    lines.push('-- `license` (CC0-1.0 | CC-BY-3.0 | CC-BY-4.0 | CC-BY-SA-3.0), the');
    lines.push('-- contributor name as `creator`, and an English common_name matching the');
    lines.push('-- eBird family-display convention.');
    lines.push('--');
    lines.push('-- ON CONFLICT (id) DO NOTHING — defensive: if a future migration adds');
    lines.push('-- any of these rows independently (e.g. a hot-fix similar to PR #494 for');
    lines.push('-- icteridae), re-running this migration after that hot-fix is a no-op.');
    lines.push('-- The Down migration matches by exact family_code list so it cannot');
    lines.push('-- accidentally remove rows owned by other migrations.');
    lines.push('--');
    lines.push('-- The full audit trail (every candidate the heuristic considered, per');
    lines.push('-- family) lives at scripts/phylopic-picks.json under the new entries.');
    lines.push('--');
    lines.push('-- After this migration lands in main, the operator runs');
    lines.push('-- scripts/purge-silhouettes-cache.sh (#252) as part of the production');
    lines.push('-- deploy runbook to purge the CDN cache for /api/silhouettes.');
    lines.push('');
  } else {
    // ... existing UPDATE-mode preamble (unchanged from current file) ...
    lines.push('-- Issue #245 (epic #251). Replaces the placeholder geometric SVGs from');
    lines.push('-- migrations 9000 + 15000 with real CC-licensed Phylopic silhouettes for');
    lines.push('-- every seeded AZ bird family. Generated by scripts/curate-phylopic.mjs');
    lines.push(`-- on ${today} (curator run date) using the Phylopic API two-step recipe`);
    lines.push('-- (/nodes?filter_name → /images?filter_node) and an auto-pick heuristic');
    lines.push('-- (license preference CC0 > CC-BY > CC-BY-SA, then alphabetic creator).');
    lines.push('');
  }

  const sortedPicks = [...picks].sort((a, b) => a.family.localeCompare(b.family));
  const successes = sortedPicks.filter(p => p.picked);
  const failures = sortedPicks.filter(p => !p.picked);

  if (mode === 'backfill') {
    // Single multi-row INSERT for all successes. Skipped families land in a
    // separate INSERT below (svg_data=NULL — they still get a row so the
    // _FALLBACK consumer can resolve their color/common_name).
    if (successes.length > 0) {
      lines.push('INSERT INTO family_silhouettes (id, family_code, svg_data, color, source, license, creator, common_name) VALUES');
      const rows = successes.map((pick, idx) => {
        const p = pick.picked;
        const d = escapeSqlString(p.svgPathD);
        const src = escapeSqlString(p.imagePageUrl);
        const lic = escapeSqlString(p.licenseId);
        const cre = p.creatorName ? `'${escapeSqlString(p.creatorName)}'` : 'NULL';
        const color = colorByFamily[pick.family];
        const cn = commonNameByFamily[pick.family];
        if (!color) throw new Error(`color missing for family ${pick.family} — populate COLOR_BY_FAMILY`);
        if (!cn) throw new Error(`common_name missing for family ${pick.family} — populate COMMON_NAME_BY_FAMILY`);
        const comma = idx < successes.length - 1 || failures.length > 0 ? ',' : '';
        return `  ('${pick.family}', '${pick.family}', '${d}', '${color}', '${src}', '${lic}', ${cre}, '${escapeSqlString(cn)}')${comma}`;
      });
      lines.push(...rows);
      if (failures.length === 0) lines[lines.length - 1] = lines[lines.length - 1].replace(/,$/, '');
      lines.push('ON CONFLICT (id) DO NOTHING;');
      lines.push('');
    }
    if (failures.length > 0) {
      lines.push('-- Families with no usable Phylopic silhouette (operator-skipped or API-absent).');
      lines.push('-- Row inserted with svg_data=NULL so the _FALLBACK consumer renders the');
      lines.push('-- generic shape tinted with the assigned family color. Color + common_name');
      lines.push('-- are still useful: the legend chip shows the right color and the right name.');
      lines.push('INSERT INTO family_silhouettes (id, family_code, svg_data, color, source, license, creator, common_name) VALUES');
      const rows = failures.map((pick, idx) => {
        const color = colorByFamily[pick.family];
        const cn = commonNameByFamily[pick.family];
        if (!color) throw new Error(`color missing for skipped family ${pick.family}`);
        if (!cn) throw new Error(`common_name missing for skipped family ${pick.family}`);
        const comma = idx < failures.length - 1 ? ',' : '';
        return `  ('${pick.family}', '${pick.family}', NULL, '${color}', NULL, NULL, NULL, '${escapeSqlString(cn)}')${comma}`;
      });
      lines.push(...rows);
      lines.push('ON CONFLICT (id) DO NOTHING;');
      lines.push('');
    }
    lines.push('-- Down Migration');
    lines.push('DELETE FROM family_silhouettes WHERE family_code IN (');
    lines.push('  ' + sortedPicks.map(p => `'${p.family}'`).join(', '));
    lines.push(');');
    lines.push('');
  } else {
    // Existing UPDATE-mode emission — copy verbatim from the original
    // function body. (Engineer: keep the original UPDATE loop here, lines
    // 777–828 in the pre-change script. Not duplicated in this plan to
    // keep the patch minimal; the diff shape is "add new branches around
    // the existing emit code, do not delete it".)
  }

  return lines.join('\n');
}
```

When wiring the new branches, the engineer should preserve the pre-existing UPDATE-emission code (currently lines ~777–828 of the original `emitMigrationSql`) inside the `else` branch above. The intent is **additive only** — backfill mode is a new code path; the existing UPDATE path for migration 17000 must keep behaving identically so re-running `node scripts/curate-phylopic.mjs` (without `--backfill`) regenerates an identical migration 17000.

- [ ] **Step 6: Wire `colorByFamily` and `commonNameByFamily` through `main()`.**

These mappings are populated in Task 3 (color) and Task 4 (common name) below. For this task, define two empty exports near the top of `main()`:

```js
// Populated in Task 3 + Task 4 of docs/plans/2026-05-12-backfill-38-family-silhouettes.md.
// Keys MUST be the lowercase family_code; values MUST be the per-row column
// value. emitMigrationSql throws on missing keys so the migration cannot
// silently land with NULL color or NULL common_name.
const COLOR_BY_FAMILY = {};
const COMMON_NAME_BY_FAMILY = {};
```

…and pass them through the `emitMigrationSql` call:

```js
const sql = emitMigrationSql(
  picks,
  config.skipFamilies,
  BACKFILL ? 'backfill' : 'update',
  BACKFILL ? COLOR_BY_FAMILY : {},
  BACKFILL ? COMMON_NAME_BY_FAMILY : {},
);
```

- [ ] **Step 7: Commit.**

```bash
git add scripts/curate-phylopic.mjs
git commit -m "chore(scripts): teach curate-phylopic.mjs a --backfill mode for #495

Adds BACKFILL_FAMILIES + --backfill flag. In backfill mode the script
writes migrations/1700000034000_backfill_observed_family_silhouettes.sql
with multi-row INSERTs (vs migration 17000's per-row UPDATEs). The 25-
family / migration-17000 path is unchanged.

Refs #495"
```

---

## Task 3: Author the color palette for all 38 families

The DB is the single source of truth for family colors (per the #55 option-(a) decision recorded in `frontend/src/data/family-color.ts` and the `silhouettes.test.ts` parity snapshot). The 38 new colors must be (a) all distinct from each other, (b) all distinct from the existing 27 colors (26 from migrations 9000+15000+18000 plus icteridae's `#F4B400`), (c) WCAG-AA-readable as a 24-28px tinted SVG on the production basemap, and (d) where possible, evoke a recognizable field-mark of the family's primary AZ species.

**Files:**
- Modify: `scripts/curate-phylopic.mjs` (the `COLOR_BY_FAMILY` constant added in Task 2)

- [ ] **Step 1: Inventory the existing 27 colors so we don't collide.**

The full existing palette (snapshot from `packages/db-client/src/silhouettes.test.ts`):

```
#222222 #3A6B8E #5A6B2A #444444 #222244 #5E4A20 #7A5028 #D4923A
#FF0808 #9B7B3A #5A4A2A #7B2D8E #7A5028 #FF0808 #C77A2E #3D2E5C
#B0231A #A89880 #E0A82E #8E7B5A #4A6FA5 #D4C84A #1F1F35 #9AAE8C
#C56B9D #555555 #F4B400
```

(Note: `#7A5028` and `#FF0808` each repeat once across `troglodytidae`/`odontophoridae` and `picidae`/`trogonidae` — that's existing drift, not a precedent to extend. New colors must be unique against this full set including duplicates.)

- [ ] **Step 2: Populate `COLOR_BY_FAMILY` with the 38 entries.**

Edit `scripts/curate-phylopic.mjs` and fill in `COLOR_BY_FAMILY` from Task 2. **The engineer MUST replace this default block with values chosen against the real 38-family list from Task 1.** The defaults below cover the 8 highest-impact families called out in the issue body or PR #494 — the engineer fills the remaining ~30 entries using the methodology in Step 3.

```js
const COLOR_BY_FAMILY = {
  // High-impact AZ families called out in #495 issue body / PR #494
  alaudidae:        '#B89060',  // Larks — warm sand, evokes desert lark plumage
  hirundinidae:     '#5BA0C0',  // Swallows — barn-swallow back blue
  turdidae:         '#A05A3A',  // Thrushes — robin breast / hermit-thrush mantle
  vireonidae:       '#7E9B5C',  // Vireos — olive-green back
  falconidae:       '#5C3E2A',  // Falcons — peregrine mantle
  laridae:          '#8FA7B5',  // Gulls — neutral grey-blue
  gaviidae:         '#2B3845',  // Loons — common-loon black-with-blue-sheen
  pandionidae:      '#4A3520',  // Osprey — dorsal brown
  // … remaining ~30 families — engineer fills in alphabetical order
  // sourced from BACKFILL_FAMILIES in Task 2, Step 2. Hand-pick each
  // against the field-mark methodology below.
};
```

- [ ] **Step 3: Methodology for the remaining ~30 entries.**

For each family in `BACKFILL_FAMILIES` not yet in `COLOR_BY_FAMILY`:

1. Look up the family's primary AZ-observed species in `species_meta`:
   ```sql
   SELECT species_code, common_name FROM species_meta
   WHERE family_code = '<family>'
   ORDER BY common_name LIMIT 5;
   ```
2. Identify the dominant field-mark color from a field guide or eBird species page (Sibley / Cornell-AllAboutBirds / Wikipedia). Prefer the color the most-common AZ species in the family shows in good light. For families dominated by drab birds (e.g. emberizids), use a desaturated form of the back/mantle color.
3. Pick a hex value. Constraint: ΔE > 10 (perceptual) from every existing color in Step 1's inventory **and** every color already placed in `COLOR_BY_FAMILY`. Quick check tool: paste candidates into https://www.color-blindness.com/color-name-hue/ or eyeball against the inventory; if two colors look "the same family" to you they probably are.
4. Constraint: contrast against the dark basemap (`#1A1A1A`) and the light basemap (`#FAFAF6`) must produce a readable SDF tile at 28px. Test by tinting an SVG path with the color in browser devtools against both backgrounds. Anything below 3:1 against the light bg or the dark bg gets bumped one shade darker or lighter.
5. Constraint: prefer single-syllable color recognition ("blue-ish", "orange-ish"). Avoid muddy mid-tones that read as "brown-grey" — those collide perceptually with the existing 27-color set.

- [ ] **Step 4: Write a quick collision test before committing the 38 colors.**

Add an inline assertion at the bottom of `scripts/curate-phylopic.mjs` (under a `process.argv.includes('--check-colors')` flag or in a one-off Node REPL) that throws if any two values in `COLOR_BY_FAMILY` are identical or if any value matches the existing inventory in Step 1. The implementer can keep this as a temporary script or paste it into a REPL — it doesn't need to ship in the migration.

```bash
node -e "
const COLOR_BY_FAMILY = { /* paste the 38-entry object literal here */ };
const existing = ['#222222','#3A6B8E','#5A6B2A','#444444','#222244','#5E4A20','#7A5028','#D4923A','#FF0808','#9B7B3A','#5A4A2A','#7B2D8E','#C77A2E','#3D2E5C','#B0231A','#A89880','#E0A82E','#8E7B5A','#4A6FA5','#D4C84A','#1F1F35','#9AAE8C','#C56B9D','#555555','#F4B400'];
const all = [...existing, ...Object.values(COLOR_BY_FAMILY)];
const dupes = all.filter((c, i) => all.indexOf(c) !== i);
if (dupes.length) { console.error('Duplicate colors:', dupes); process.exit(1); }
console.log('All ' + all.length + ' colors unique. OK.');
"
```

Expected: `All 65 colors unique. OK.` (27 existing + 38 new = 65. If any of the 38 lands as a skip family with NULL svg_data, its color row still counts.)

- [ ] **Step 5: Commit the color palette as a code-only change before the migration is generated.**

```bash
git add scripts/curate-phylopic.mjs
git commit -m "chore(scripts): hand-pick 38 family colors for #495 backfill

Each new color is distinct (ΔE > 10) from the existing 27-color palette
and from the other new 37, and where possible echoes the primary AZ
species' field-mark color. Verified via the inline duplicate-check.

Refs #495"
```

---

## Task 4: Author the common-name list for all 38 families

eBird family-display convention is generally a short plural noun (e.g. "Larks", "Swallows", "Thrushes"). For mixed-genus families the established precedent from migration 19500 uses "Group & Allies" (e.g. "Cardinals & Allies", "Mockingbirds & Thrashers") or "Group A & Group B" (e.g. "Ducks, Geese & Swans", "Crows, Jays & Magpies"). PR #494 used "Blackbirds, Orioles & Allies" for icteridae following this convention.

**Files:**
- Modify: `scripts/curate-phylopic.mjs` (the `COMMON_NAME_BY_FAMILY` constant added in Task 2)

- [ ] **Step 1: Populate `COMMON_NAME_BY_FAMILY` with all 38 entries.**

```js
const COMMON_NAME_BY_FAMILY = {
  // High-impact families with established eBird names. Engineer fills
  // out the remaining ~30 alphabetically using the methodology in Step 2.
  alaudidae:        'Larks',
  hirundinidae:     'Swallows',
  turdidae:         'Thrushes',
  vireonidae:       'Vireos',
  falconidae:       'Falcons & Caracaras',
  laridae:          'Gulls, Terns & Skimmers',
  gaviidae:         'Loons',
  pandionidae:      'Ospreys',
  // …remaining ~30 families alphabetically
};
```

- [ ] **Step 2: Methodology for the remaining entries.**

For each family in `BACKFILL_FAMILIES` not yet in `COMMON_NAME_BY_FAMILY`:

1. Look up the family's display name on the eBird taxonomy v2024 (https://www.birds.cornell.edu/clementschecklist/download/ — the "Family" column) or the iNaturalist family page. Both surface the same convention.
2. If the eBird/iNat name is "Group, Group & Group" (3+ words) and the family has one dominant AZ species, prefer the eBird form anyway — the legend chip wraps to two lines if needed.
3. If the family has only one AZ-observed species (check `species_meta` count), use the simple plural — e.g. `gaviidae` → "Loons" not "Loons & Allies".
4. Cross-check against the convention pattern in migration 19500: simple plural for monogeneric families (e.g. "Wrens", "Hummingbirds"), "X & Y" for biguous-genera families (e.g. "Ducks, Geese & Swans"), "X & Allies" for catch-all families (e.g. "Cardinals & Allies").

- [ ] **Step 3: Commit.**

```bash
git add scripts/curate-phylopic.mjs
git commit -m "chore(scripts): author 38 family common-names for #495 backfill

Names follow the eBird family-display convention and match the
'X & Y' / 'X & Allies' precedent set by migration 19500 (issue #249).

Refs #495"
```

---

## Task 5: Generate the migration file and the picks audit trail

Run the script. This produces the migration and updates `scripts/phylopic-picks.json` with the audit trail for all 38 new families.

**Files:**
- Generates: `migrations/1700000034000_backfill_observed_family_silhouettes.sql`
- Modifies: `scripts/phylopic-picks.json`

- [ ] **Step 1: Run the script in backfill mode.**

```bash
node scripts/curate-phylopic.mjs --backfill --refresh
```

`--refresh` bypasses the local Phylopic API cache so the run reflects the live Phylopic build at curation time (avoids the "your cache is two months old" failure mode).

Expected stdout: per-family `[<family>] resolving node…` / `[<family>] node <uuid>, enumerating images…` / `[<family>] picked-by-license-CC0-1.0` lines, followed by `Wrote scripts/phylopic-picks.json` and `Wrote migrations/1700000034000_backfill_observed_family_silhouettes.sql`. Final line: `Summary: N picked, M NULL` where `N + M = 38`.

If the run aborts with `ABORT: Phylopic API failed for these families after 3 retries:` — the API is having a bad day. Wait an hour, re-run. Do not commit a partial migration.

- [ ] **Step 2: Inspect the generated migration.**

```bash
wc -l migrations/1700000034000_backfill_observed_family_silhouettes.sql
head -40 migrations/1700000034000_backfill_observed_family_silhouettes.sql
tail -20 migrations/1700000034000_backfill_observed_family_silhouettes.sql
```

Expected: a comment block, a single `INSERT INTO family_silhouettes (...) VALUES` covering the N successes, optionally a second `INSERT` covering the M `skipFamilies`, and a `-- Down Migration` / `DELETE FROM family_silhouettes WHERE family_code IN (...)` block listing all 38 codes.

- [ ] **Step 3: Visually review the audit trail.**

Open `scripts/phylopic-picks.json` in your editor. For each of the 38 new entries, confirm:

- `picked.licenseId` is one of `CC0-1.0`, `CC-BY-3.0`, `CC-BY-4.0`, `CC-BY-SA-3.0`. **No exceptions.**
- `picked.creatorName` is non-null and looks like a real human name (not a placeholder like `null`, `"Anonymous"`, or `"-"`).
- `picked.imagePageUrl` resolves to a Phylopic page (test 3–5 random URLs in browser).
- The thumbnail at the imagePageUrl is biologically plausible for the family. **This is the human-review gate.** Reject any silhouette that's the wrong silhouette (e.g. a placeholder geometric shape, an unrelated taxon, a hand-drawn doodle). To reject, add the family code to `scripts/phylopic-picks.json#skipFamilies` and re-run Step 1.

For any family that lands in `skipFamilies` (operator-rejected) or has a `failed` kind in the picks log (API-absent), the migration's second `INSERT` block covers it with `svg_data = NULL` — the `_FALLBACK` consumer renders the generic shape tinted with that family's color. **The PR review must surface every skip-family and confirm Julian sees the list.**

- [ ] **Step 4: Open `scripts/curate-phylopic-review.html` for visual review at 24-28px.**

```bash
open scripts/curate-phylopic-review.html
```

This is the existing picker HTML from epic #251. It loads `scripts/phylopic-picks.json` and renders each candidate at the FamilyLegend/MapCanvas symbol-layer scale (24-28px). Click through each of the 38 picks and visually confirm the silhouette is recognizable as the family at that scale. Anything unrecognizable is a candidate for `skipFamilies`.

- [ ] **Step 5: Commit the migration + picks json.**

```bash
git add migrations/1700000034000_backfill_observed_family_silhouettes.sql scripts/phylopic-picks.json
git commit -m "fix(migrations): backfill family_silhouettes for 38 observed families (#495)

Audit query SELECT DISTINCT family_code FROM observations WHERE family_code
NOT IN (SELECT family_code FROM family_silhouettes) returned 38 rows after
PR #494's icteridae row landed. This migration closes that gap with one
batched INSERT per Phylopic-curated family + one batched INSERT for the
N families with no usable Phylopic silhouette (svg_data NULL → renders
_FALLBACK tinted with the assigned family color).

Generated by scripts/curate-phylopic.mjs --backfill --refresh against
Phylopic build <BUILD>.

Refs #495"
```

(Replace `<BUILD>` with the value from `scripts/phylopic-picks.json#phylopicBuild`.)

---

## Task 6: Update the db-client silhouettes parity tests

These tests are the row-count parity snapshot. They must move in lockstep with the migration or the test suite fails.

**Files:**
- Modify: `packages/db-client/src/silhouettes.test.ts:10-26`, `:88-135`, `:149-186`

- [ ] **Step 1: Write the (now-failing) updated assertions.**

The new total row count is **27 + 38 = 65** (existing 27 rows + 38 new rows). Skip-families still count: they get a row with NULL svg_data so the legend chip can resolve color + common_name.

Update three assertions in `packages/db-client/src/silhouettes.test.ts`:

a) Line 10–16 — row-count assertion:

```ts
  it('returns all 65 seeded families (64 real + _FALLBACK)', async () => {
    // 15 from migration 9000 + 10 AZ-family expansion from migration 15000
    // (#244) + the `_FALLBACK` row from migration 18000 (#246) + icteridae
    // from migration 33000 (#482) + 38 observed-family backfill from
    // migration 34000 (#495). The _FALLBACK row backs the SDF symbol
    // layer's fallback rendering for observations whose family has no
    // usable Phylopic silhouette.
    const rows = await getSilhouettes(db.pool);
    expect(rows).toHaveLength(65);
```

b) Line 88–135 — color snapshot. Append all 38 new entries inside the `expect(byFamily).toEqual({ … })` block, in alphabetical order, each on its own line, prefixed with a `// --- migration 34000 (issue #495 backfill) ---` section comment. Each entry mirrors `COLOR_BY_FAMILY` from Task 3. Example shape:

```ts
      // --- migration 34000 (issue #495 backfill) ---
      alaudidae:    '#B89060',
      // …all 38 alphabetically…
      vireonidae:   '#7E9B5C',
```

c) Line 149–186 — common-name snapshot. Same pattern: append all 38 new entries inside the `expect(byFamily).toEqual({ … })` block under a `// --- migration 34000 (issue #495 backfill) ---` section comment. Each entry mirrors `COMMON_NAME_BY_FAMILY` from Task 4. Update the test-name string `'common-name snapshot for all 26 seeded families'` to `'common-name snapshot for all 65 seeded families'`.

- [ ] **Step 2: Run the test.**

```bash
cd packages/db-client
npx vitest run src/silhouettes.test.ts
```

Expected: PASS. If any assertion fails, the migration's color or common_name values don't match the test snapshot — re-sync `COLOR_BY_FAMILY` / `COMMON_NAME_BY_FAMILY` (Task 3 / Task 4) with the test snapshot. The test snapshot is the contract; the migration is the implementation.

- [ ] **Step 3: Commit.**

```bash
git add packages/db-client/src/silhouettes.test.ts
git commit -m "test(db-client): extend silhouettes parity snapshots for 38 #495 backfill rows

Row count 27 → 65 (existing 27 + 38 new from migration 34000). Color
snapshot and common-name snapshot each gain 38 alphabetically-ordered
entries under the new section comment.

Refs #495"
```

---

## Task 7: Update the migrations-down-chain count assertions

`migrations-down-chain.test.ts` runs the full forward → backward → forward cycle through migrations 14000–17000. It includes count assertions that need to account for the post-17000 INSERTs (icteridae from #494, plus the 38 from this PR).

**Files:**
- Modify: `packages/db-client/src/migrations-down-chain.test.ts:108-115`, `:153-170`

- [ ] **Step 1: Update the Down(15000) baseline.**

After PR #494, that assertion was `expect(Number(rows[0]!.count)).toBe(16)` (15 from migration 9000 + 1 icteridae from migration 33000, since the chain rolls back through 15000 but not through 33000). After this plan adds 38 rows in migration 34000, the baseline becomes **15 + 1 + 38 = 54**.

```ts
    // After Down(15000), only the 15 original families from migration 9000
    // plus any post-17000 INSERTs that this test chain doesn't roll back
    // (migration 33000 / issue #482 added the `icteridae` row; migration
    // 34000 / issue #495 added 38 backfill rows) should remain. The chain
    // deliberately only exercises Down(14000→17000), so post-17000 seeds
    // are out of scope and counted into the baseline.
    const { rows } = await pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM family_silhouettes`
    );
    expect(Number(rows[0]!.count)).toBe(54);
```

- [ ] **Step 2: Update the re-Up round-trip assertion.**

After the chain re-applies Up(14000)–Up(17000), the count of non-`_FALLBACK` rows is the 25 originally-seeded families plus the post-17000 INSERTs the chain didn't roll back. After PR #494 this was `26`; after this plan, `25 + 1 + 38 = 64`.

```ts
    // After re-applying Up(14000→17000), all 25 originally-seeded families
    // should be present with svg_data set by the Phylopic seed (non-null
    // for the 22 families that have usable Phylopic SVGs). Exclude the
    // _FALLBACK sentinel row. The +1 accounts for the `icteridae` row
    // inserted by migration 33000 (issue #482); the +38 accounts for the
    // backfill from migration 34000 (issue #495). The test container
    // applies both before the down/up chain runs but this chain doesn't
    // roll them back.
    const { rows } = await pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count
         FROM family_silhouettes
        WHERE family_code != '_FALLBACK'`
    );
    expect(Number(rows[0]!.count)).toBe(64);
```

- [ ] **Step 3: Run the test.**

```bash
cd packages/db-client
npx vitest run src/migrations-down-chain.test.ts
```

Expected: all 4 tests PASS.

- [ ] **Step 4: Commit.**

```bash
git add packages/db-client/src/migrations-down-chain.test.ts
git commit -m "test(db-client): bump down-chain count baselines for migration 34000

The chain rolls back through 17000 only; post-17000 INSERTs (33000:
icteridae, 34000: 38-family backfill) sit in the baseline. New
expected counts: 54 (post-Down(15000)) and 64 (post-re-Up,
excluding _FALLBACK).

Refs #495"
```

---

## Task 8: Update the read-api silhouettes count assertion

The `GET /api/silhouettes` integration test asserts the response array length.

**Files:**
- Modify: `services/read-api/src/app.test.ts:249-253`

- [ ] **Step 1: Update the assertion.**

```ts
    // 15 rows from migration 9000 + 10 AZ-family expansion rows from
    // migration 15000 (issue #244) + the `_FALLBACK` row from migration
    // 18000 (issue #246) + icteridae row from migration 33000 (issue #482)
    // + 38 observed-family backfill rows from migration 34000 (issue #495)
    // → 65 total.
    expect(body).toHaveLength(65);
```

- [ ] **Step 2: Run the test.**

```bash
cd services/read-api
npx vitest run src/app.test.ts -t 'GET /api/silhouettes'
```

Expected: PASS.

- [ ] **Step 3: Commit.**

```bash
git add services/read-api/src/app.test.ts
git commit -m "test(read-api): bump /api/silhouettes count to 65 for #495 backfill

Refs #495"
```

---

## Task 9: Full test sweep + production build

Before opening the PR, every workspace's test suite must be green and the production build must compile.

**Files:** none (verification only).

- [ ] **Step 1: Run the full test suite.**

```bash
npm run typecheck
npm run test
```

Expected: every workspace green. Notable: `@bird-watch/db-client` (silhouettes.test + migrations-down-chain.test), `@bird-watch/read-api` (app.test → 65-row assertion), `@bird-watch/frontend` (full suite passes — no frontend code changes, so this is a "did I break something inadvertently" check).

If `npm run test` flakes on testcontainer startup (Docker thrash), retry the failing workspace individually. Do not commit until every workspace passes a clean run.

- [ ] **Step 2: Production build.**

```bash
npm run build
```

Expected: clean across all workspaces.

- [ ] **Step 3: Knip dead-code check.**

```bash
npx knip
```

Expected: no new findings. Pre-existing findings (frontend config hints) are unchanged from `main`.

- [ ] **Step 4: No commit if everything's green — proceed to UI verification.**

---

## Task 10: Playwright MCP UI verification

Per CLAUDE.md "Testing > UI verification": any PR touching `frontend/**` is exempt-or-required for Playwright MCP smoke. This PR is data-only (migrations + tests), so on the strict reading of the rule it's exempt. **However**, the user-visible effect of the migration is entirely UI — 38 families that previously rendered `_FALLBACK` grey now render their assigned silhouette. The Playwright MCP smoke is therefore required *as user-visible-behavior verification*, even though no `frontend/**` files changed.

**Files:** none (verification only). Screenshots committed via `pr-screenshots-via-user-attachments` paste flow.

- [ ] **Step 1: Apply the migration to a local stack.**

```bash
docker-compose up -d postgres
cd packages/db-client
npx node-pg-migrate up --migrations-dir ../../migrations \
  --connection-string "postgres://postgres:postgres@localhost:5432/postgres"
```

- [ ] **Step 2: Seed real observations covering at least 5 of the new families.**

Use the existing ingestor against the AZ eBird feed:

```bash
npm run dev --workspace @bird-watch/ingestor
# … wait for one full cron cycle …
```

Or, for a faster turnaround, run the test-fixture seed:

```bash
psql "postgres://postgres:postgres@localhost:5432/postgres" -f services/ingestor/test/fixtures/seed-observations.sql
```

Confirm via:

```sql
SELECT family_code, COUNT(*) FROM observations
WHERE family_code IN ('alaudidae','hirundinidae','turdidae','vireonidae','laridae')
GROUP BY family_code;
```

Expected: at least 5 rows across these families (or any 3 of the previously-broken families — the issue's acceptance criteria say "at least 3").

- [ ] **Step 3: Drive the dev server via Playwright MCP at both required viewports.**

```bash
npm run dev --workspace @bird-watch/frontend
```

Then in the agent session:

1. `mcp__plugin_playwright_playwright__browser_navigate` → `http://localhost:5173/`.
2. `browser_resize` → 390×844 (mobile).
3. `browser_take_screenshot` of the legend overlay showing the new family chip.
4. Click the chip to confirm the filter works.
5. `browser_console_messages` → must return zero errors AND zero warnings.
6. Repeat steps 2–5 at 1440×900 (desktop).
7. For at least three of the previously-broken families (the issue specifies a minimum of 3; aim for 5 across the most visually impactful: hirundinidae, turdidae, vireonidae, laridae, falconidae), capture both viewports and confirm:
   - The legend chip renders the family's new silhouette tinted with the family's color.
   - Cluster mosaic tiles in the chip-filtered map render the new silhouette at 50%-opacity tiled positions (not the grey `_FALLBACK` square).
   - Opening `<SpeciesDetailSurface>` on a species in that family shows the family silhouette in the header (not `_FALLBACK`).

- [ ] **Step 4: Upload screenshots via the user-attachments paste flow.**

Per `~/.claude/skills/pr-screenshots-via-user-attachments/SKILL.md`. The screenshots become `https://github.com/user-attachments/assets/<uuid>` URLs to paste into the PR body's Screenshots section.

- [ ] **Step 5: No commit.**

Screenshots live on GitHub's user-attachments CDN, never in the repo.

---

## Task 11: Open the PR

**Files:** none (PR creation only).

- [ ] **Step 1: Push the branch.**

```bash
git push -u origin fix/495-backfill-38-family-silhouettes
```

(Branch name per the implementer's preference; the recommended form mirrors PR #494's `fix/icteridae-silhouette-482`.)

- [ ] **Step 2: Run pre-PR knip + lockfile checks.**

```bash
npx knip
ls package-lock.json && git diff --exit-code package-lock.json
```

Expected: `knip` clean (or only pre-existing findings); `package-lock.json` unchanged (this PR adds no deps). If `package-lock.json` is dirty, **do not push** — investigate the drift first.

- [ ] **Step 3: Compose the PR body following `.github/PULL_REQUEST_TEMPLATE.md` verbatim.**

The PR body must have all five sections (Diagrams, Summary, Screenshots, Test plan, Plan reference). Screenshots section uses real `user-attachments/assets/<uuid>` URLs from Task 10. Plan reference cites this plan file.

Recommended PR title: `fix(migrations): backfill family_silhouettes for 38 observed families (#495)`.

The PR body must include `Closes #495` near the end. **Do not include `Closes #55`** — that issue is the original meta-epic and a maintainer should close it manually after review (see "Open decisions D4" above).

- [ ] **Step 4: Create the PR via `gh pr create`.**

```bash
gh pr create \
  --repo julianken/bird-sight-system \
  --base main \
  --title "fix(migrations): backfill family_silhouettes for 38 observed families (#495)" \
  --body "$(cat <<'EOF'
…full PR body following the template…
EOF
)"
```

- [ ] **Step 5: Dispatch the bot review.**

Per CLAUDE.md PR-workflow rules, the bot review goes through the `julianken-bot` Agent subagent — never `gh pr review` from the main session. Trigger that dispatch per `.claude/skills/pr-workflow/SKILL.md`.

- [ ] **Step 6: After approval, queue with `@Mergifyio queue`.**

The queue comment body is exactly `@Mergifyio queue` — no prose, literal-string match per CLAUDE.md. Never `gh pr merge`.

---

## Acceptance criteria (mirrors #495)

- [ ] `SELECT DISTINCT family_code FROM observations WHERE family_code NOT IN (SELECT family_code FROM family_silhouettes)` returns **0 rows** after the migration applies (verify against prod via the post-deploy smoke).
- [ ] Every affected family has: a real Phylopic silhouette (UUID + CC license + contributor cited in SQL comments) OR a `NULL svg_data` row with operator-confirmed `skipFamilies` justification, a distinct color (verified against the 27-color existing palette), and a non-NULL `common_name` matching the eBird family-display convention.
- [ ] `<FamilyLegend>` renders entries for these families on bird-maps.com when observations are present in viewport — confirmed via Task 10's Playwright MCP smoke + a post-merge production check.
- [ ] PR body has screenshots for at least 3 previously-broken families across desktop + mobile (Task 10).

---

## Risks and open decisions surfaced

1. **License-rejection cohort risk (D3 above).** If any high-impact family (laridae, hirundinidae, turdidae, falconidae) lands in `skipFamilies` because Phylopic 404s its node, the user-visible improvement is partial — those species render the `_FALLBACK` shape tinted with the new family color, which is better than today (no row → no chip) but worse than a real silhouette. The PR should explicitly flag every skip-family at review time so Julian can decide whether to (a) accept the NULL row and ship as-is, (b) commission a hand-drawn 24-viewBox SVG as a follow-up, or (c) substitute a different Phylopic node (the script's auto-pick can be overridden by hand-editing `scripts/phylopic-picks.json` to pin a specific `uuid`).
2. **Color-collision risk.** The 38 new colors plus the 27 existing colors put us at 65 distinct values — that's already at the limit of perceptual distinctness on a single chart. Tight ΔE between two families that frequently co-occur in a viewport will be a UX problem. Mitigation: the Step-4 collision test in Task 3 catches exact matches; the Playwright UI verification in Task 10 catches perceptual collisions at the actual rendered scale. If a collision surfaces post-merge, a hot-fix migration can `UPDATE family_silhouettes SET color = '...' WHERE family_code = '...'` without disturbing svg_data.
3. **eBird display-name normalization quirks (D2 above).** Some families have multiple valid common-name conventions (e.g. emberizidae is "Old World Buntings" in eBird but is sometimes called "Buntings & Allies" in older field guides). The Step-2 methodology in Task 4 picks eBird's form, but reviewers may push back on individual choices.
4. **Migration-filename slot collision.** This plan reserves `1700000034000_`. If a new migration lands on `main` between this plan's authoring and its execution, the implementer bumps to the next free slot — see the note in "File structure" above.
5. **`#55` close timing (D4 above).** Recommended action: this PR's body uses `Closes #495` (the audit-query gap) and `Refs #55` (the parent epic). After merge, a maintainer reviews #55 to confirm there is no remaining sub-issue scope before closing it manually. This plan does NOT auto-close #55 from the migration PR.
6. **Local-DB seeding caveat.** Task 1's audit query against a clean local DB returns **0 rows** unless real observations have been ingested. Implementer must run a real ingest cycle or load the seed fixture before the audit is meaningful. If the local audit returns 0, do not assume the migration is unnecessary — confirm against prod via `gcloud sql connect bird-sight-prod` or via a `read-api` query.

---

## Self-review checklist

(Run by the plan author before saving.)

- [x] **Spec coverage.** Issue #495's acceptance criteria are each covered by a task: 0-row audit (Task 5 generates, Task 10 verifies), real Phylopic silhouette + license + creator (Task 5), distinct color (Task 3), English common-name display string (Task 4), `<FamilyLegend>` renders entries (Task 10 verifies), screenshots for 3+ families (Task 10 captures).
- [x] **No placeholders in code blocks.** Every code snippet is paste-ready except (a) the `BACKFILL_FAMILIES` list which is sourced live from the audit query in Task 1 and explicitly marked as "PASTE THE 38-FAMILY LIST FROM TASK 1 HERE", and (b) the `COLOR_BY_FAMILY` / `COMMON_NAME_BY_FAMILY` constants which are partially populated and explicitly invite per-family hand-picking. These are not placeholders for unwritten logic — they're parameters the implementer fills from real data.
- [x] **Type consistency.** The migration filename `1700000034000_backfill_observed_family_silhouettes.sql` is consistent across Tasks 2, 5, 6, 7, 8. The row counts (27 → 65; 16 → 54; 26 → 64; 27 → 65 for read-api) are consistent across Tasks 6, 7, 8. The `COLOR_BY_FAMILY` / `COMMON_NAME_BY_FAMILY` constant names are consistent across Tasks 2, 3, 4, 5.
- [x] **Prototype-gate decision recorded.** The plan argues explicitly that the gate is satisfied transitively (PR #494 + migration 17000), not skipped.
- [x] **D1–D4 surfaced.** Every decision the implementer needs Julian's input on is enumerated under "Open decisions for the implementer" with a default proposed.
