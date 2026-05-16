# Adaptive Grid Tile Contrast & Visibility Audit — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve four independent contrast/visibility findings in `<AdaptiveGridMarker>` that surfaced post-Phase-3 of the cell-species-popover epic, and close the two open-questions gates that have been deferred since the adaptive-grid v1 ship (#539): **G7** (family palette × basemap contrast) + **G8** (dark basemap palette ratification).

**Architecture:** Four phases, mostly independent after Phase 1 lands. Phase 1 is the foundational palette overhaul — every other phase depends on the palette being verified at full opacity against BOTH light and dark basemaps before relying on those colors. Phases 2, 3, 4 can ship in any order or in parallel after Phase 1.

**Tech Stack:** TypeScript strict · React 19 · MapLibre-GL 5.x · `node-pg-migrate` for the SQL migration · existing `family_silhouettes` DB table · OpenFreeMap tile styles (`positron` for light, `dark` for dark).

**Parent epic:** #539 (closed — "adaptive cluster grid v1"). This work is the post-ship follow-up batch identified during Phase 3 of the cell-species-popover epic (#556).

**Gates closed:** `docs/design/01-spec/open-questions.md` G7 + G8.

---

## Findings summary (this plan's basis)

Three reviewer subagents + a deep palette audit established the scope. Detailed evidence in the audit output at the orchestration session log. Key data:

| # | Finding | Severity | Surface |
|---|---|---|---|
| F1 | 17 of 38 Phylopic-curated backfill colors + 2 of 15 original seed colors fail WCAG 1.4.11 (3:1 non-text contrast) against cream basemap (`#f4f1ea`) at full opacity. Examples: `#F4E04D` @ 1.19:1, `#E8D4B8` @ 1.28:1, `#E1B8C0` @ 1.58:1 | WCAG fail | `family_silhouettes.color` (DB) |
| F2 | All `'fallback'` tiles render at hardcoded inline `opacity: 0.5`. At half-alpha on cream, virtually every family color drops below 3:1. 37 of 38 backfill colors fail at 0.5 opacity. 38% of visible tiles on the live map are fallback. | WCAG fail, structural | `AdaptiveGridMarker.tsx:454, 475` |
| F3 | Zero `@media (forced-colors: active)` overrides for `.adaptive-grid-marker__cell`, `--fallback`, or `--pending`. SVG fills set via the `fill` ATTRIBUTE (not CSS property) bypass system color remapping in Windows High Contrast mode. | WCAG fail | `ds-primitives.css` + render path |
| F4 | `BASEMAP_DARK = BASEMAP_LIGHT` (literal alias). The `MutationObserver` swap mechanism in `MapCanvas.tsx:1152+` is wired but both URLs point to `positron`. Dark mode shows a light basemap with whatever theme override the app shell applies — visually inconsistent. | Deferred (G7/G8) | `basemap-style.ts:28` |

Plus a **non-bug observation** worth documenting:

| # | Observation | Status |
|---|---|---|
| O1 | `pickGridShape` in `adaptive-grid.ts:76-88` produces `'grid-overflow'` (with "+N" indicator) ONLY for `isMobile && uniqueFamilies > 8`. Desktop with 10–16 families always renders a 4×4 grid (100×100px footprint) with no overflow chevron. The deconflict module's `BUCKET_PX = 14` was sized for the 1×1 single-cell case, so a 4×4 desktop marker may conflict with adjacent markers at low zoom. | By design; document the interaction |

---

## Quantified plan literals (implementer checklist)

Before opening a PR for this plan's execution, check off each item or cite a deferral doc with a lexically-matching subject (per R13 T7, issue #461):

- [ ] **Phase 1: 19+ failing colors re-picked** — every `family_silhouettes.color` value scores ≥ 3:1 against BOTH `positron` light (`#f4f1ea`) AND `dark` (`https://tiles.openfreemap.org/styles/dark`, sample background `#0E1116`) basemaps at full opacity. Tested with an automated WCAG harness (see Phase 1 Task 3).
- [ ] **Phase 1: 1 SQL migration** under `migrations/` introducing either (a) a `color_dark` column on `family_silhouettes` OR (b) a runtime palette override map exported from `frontend/src/config/family-palette.ts`. Decision lives in Phase 1 Task 2.
- [ ] **Phase 1: 1 contrast-harness script** under `scripts/check-family-palette-contrast.{ts,sh}` that fails CI if any color value drops below 3:1 against either basemap.
- [ ] **Phase 2: fallback opacity 0.5 → 0.85** in `AdaptiveGridMarker.tsx:454, 475`.
- [ ] **Phase 2: dashed border on `.adaptive-grid-marker__cell--fallback`** — 1.5px dashed `currentColor` (or SVG stroke-dasharray equivalent at the silhouette path), visible at 22×22px cell size. Preserves the "no curated art" affordance per the original spec's design intent.
- [ ] **Phase 3: forced-colors block** for `.adaptive-grid-marker__cell` + variants in `ds-primitives.css`. Uses system color tokens (`CanvasText`, `LinkText`, `ButtonBorder`).
- [ ] **Phase 3: SVG fill migration** — attribute-set `fill={tile.color}` → CSS-property `fill: var(--tile-color)` so `forced-color-adjust: auto` engages.
- [ ] **Phase 4: `BASEMAP_DARK` alias flipped** from `= BASEMAP_LIGHT` to `= 'https://tiles.openfreemap.org/styles/dark'` in `basemap-style.ts:28`.
- [ ] **Phase 4: open-questions.md G7 + G8 marked CLOSED** with a sentence each summarizing how the gate closed.
- [ ] **Doc addendum**: parent spec `docs/specs/2026-05-14-adaptive-cluster-grid-design.md` §4 sizing table gains a 2–3 sentence note about the deconflict `BUCKET_PX = 14` vs 4×4 desktop grid interaction at low zoom (observation O1).
- [ ] **All 5 canonical viewports** × 2 themes screenshot-captured and uploaded to each phase's PR body via the `pr-screenshots-via-user-attachments` skill. **10 captures minimum** per phase × 4 phases = 40 captures total across the epic.
- [ ] **All 4 Mergify-required CI checks** (test, lint, build, e2e) green at HEAD of each PR before posting `@Mergifyio queue`.
- [ ] **No new orphan classnames** introduced. Every new className matches a CSS rule.
- [ ] **No new knip findings.**

---

## File map

| File | Status | Responsibility |
|---|---|---|
| `migrations/<n>_family_silhouettes_color_audit.sql` | NEW (Phase 1) | Adjust 19+ failing color hex values; OR add `color_dark` column |
| `frontend/src/config/family-palette.ts` | Modify (Phase 1) | If Phase 1 chooses the "runtime override map" path, this file gains the override |
| `scripts/check-family-palette-contrast.ts` | NEW (Phase 1) | Automated WCAG harness; runs in CI; fails on < 3:1 |
| `.github/workflows/family-palette-contrast.yml` | NEW (Phase 1) | CI workflow invoking the contrast harness; soft-launch `continue-on-error: true` for 7 days |
| `frontend/src/components/map/AdaptiveGridMarker.tsx` | Modify (Phase 2) | `opacity: 0.5` → `0.85`; SVG/CSS for dashed border |
| `frontend/src/components/ds/ds-primitives.css` | Modify (Phase 2, Phase 3) | `.adaptive-grid-marker__cell--fallback` dashed-border rule; forced-colors block for all cell variants |
| `frontend/src/components/map/basemap-style.ts` | Modify (Phase 4) | `BASEMAP_DARK = '…/dark'` |
| `docs/design/01-spec/open-questions.md` | Modify (Phase 4) | G7 + G8 marked CLOSED |
| `docs/specs/2026-05-14-adaptive-cluster-grid-design.md` | Modify (Addendum) | §4 sizing table note about deconflict bucket interaction |

**CSS sub-task gate (per project writing-plans extension):** Phase 2 introduces a dashed-border rule on `.adaptive-grid-marker__cell--fallback`. Phase 3 introduces a `@media (forced-colors: active)` rule for `.adaptive-grid-marker__cell`, `--fallback`, `--pending`. Each phase's CSS task pins those classes against the orphan-classname check.

**Multi-viewport design-review gate (per project writing-plans extension):** Each phase's implementation PR captures 5 canonical viewports × 2 themes (10 screenshots minimum) via Playwright MCP and dispatches a `ui-design:ui-designer` opus subagent for the design review pass.

---

## Phase 1 — Dual-axis palette overhaul

Foundational. Re-audit every color against both basemaps. Re-pick failures. Add CI harness.

**Files:**
- Create: `scripts/check-family-palette-contrast.ts`
- Create: `.github/workflows/family-palette-contrast.yml`
- Create: `migrations/<n>_family_silhouettes_color_audit.sql`
- Modify: `frontend/src/config/family-palette.ts` (only if runtime override path chosen)
- Test: `frontend/src/config/family-palette.test.ts` (assert every color is ≥ 3:1 against both basemaps at full opacity, using the same WCAG formula as the script)

### Task 1: WCAG contrast harness — script + tests (RED → GREEN)

- [ ] **Step 1: Write the failing test**

In `frontend/src/config/family-palette.test.ts` (new file):

```typescript
import { describe, it, expect } from 'vitest';
import { contrastRatio } from '../utils/wcag-contrast.js';
// Plus: pull the DB silhouette palette via test fixture or a JSON snapshot.

const LIGHT_BASE = '#f4f1ea';
const DARK_BASE = '#0E1116';

/** Parses INSERT/UPDATE color hex values out of the family_silhouettes
 *  migrations. Single source of truth — the test runs the same parse
 *  pass that the migration runner does at deploy time. */
function loadPaletteFromMigrations(): Array<{ familyCode: string; color: string }> {
  const migrationDir = path.resolve(__dirname, '../../../migrations');
  const files = fs.readdirSync(migrationDir).filter((f) => f.includes('family_silhouettes'));
  const entries: Array<{ familyCode: string; color: string }> = [];
  for (const f of files) {
    const sql = fs.readFileSync(path.join(migrationDir, f), 'utf-8');
    for (const match of sql.matchAll(/family_code\s*=\s*'([^']+)'[^']*color\s*=\s*'(#[0-9A-Fa-f]{6})'/g)) {
      entries.push({ familyCode: match[1], color: match[2] });
    }
    for (const match of sql.matchAll(/VALUES[^;]*'([^']+)'[^']*'(#[0-9A-Fa-f]{6})'/g)) {
      entries.push({ familyCode: match[1], color: match[2] });
    }
  }
  // De-duplicate by familyCode, last-write-wins (matches migration apply order).
  const map = new Map<string, string>();
  for (const e of entries) map.set(e.familyCode, e.color);
  return Array.from(map, ([familyCode, color]) => ({ familyCode, color }));
}

describe('family palette WCAG 1.4.11 (3:1 non-text contrast)', () => {
  it('every family color is ≥ 3:1 against the light basemap at full opacity', () => {
    const palette = loadPaletteFromMigrations();
    const failures = palette.filter((p) => contrastRatio(p.color, LIGHT_BASE) < 3);
    expect(failures).toEqual([]);
  });

  it('every family color is ≥ 3:1 against the dark basemap at full opacity', () => {
    const palette = loadPaletteFromMigrations();
    const failures = palette.filter((p) => contrastRatio(p.color, DARK_BASE) < 3);
    expect(failures).toEqual([]);
  });
});
```

- [ ] **Step 2: Run; confirm failures**

```bash
npm run test --workspace @bird-watch/frontend -- --run frontend/src/config/family-palette.test 2>&1 | tail -10
```

Expected: 2 failing tests listing 19+ failing palette entries with their hex + contrast ratios.

- [ ] **Step 3: Implement the WCAG harness library**

Create `frontend/src/utils/wcag-contrast.ts`:

```typescript
/** WCAG 2.2 relative luminance per https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToSRGB(hex).map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(hexA: string, hexB: string): number {
  const lumA = relativeLuminance(hexA);
  const lumB = relativeLuminance(hexB);
  const lighter = Math.max(lumA, lumB);
  const darker = Math.min(lumA, lumB);
  return (lighter + 0.05) / (darker + 0.05);
}

function hexToSRGB(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}
```

Add unit tests for `contrastRatio` (verify black/white = 21:1, identical colors = 1:1, the known-good values from this audit).

- [ ] **Step 4: Run script + test against current palette to enumerate failures**

```bash
npm run test --workspace @bird-watch/frontend -- --run frontend/src/utils/wcag-contrast 2>&1 | tail -10
```

Pass. Then run the palette test (still fails — the palette has 19 failures). Capture the failure output verbatim as the input for Task 2.

### Task 2: Decide single-palette vs dual-palette (decision task)

Two architectural paths for fixing the dual-axis failures:

**Path A (single palette, dual-pass):** Pick replacement hex values that score ≥ 3:1 against BOTH basemaps. The fix is a single color per family; works in both modes.
- Pros: simple data model; no schema change; one source of truth.
- Cons: constrained color space (must hit 3:1 vs both `#f4f1ea` AND `#0E1116` — narrow band of mid-saturation mid-value colors); palette aesthetics suffer.

**Path B (dual palette, mode-switched):** Add `color_dark` column to `family_silhouettes`. Light mode uses `color`, dark mode uses `color_dark`. Two colors per family.
- Pros: full color freedom in each mode; palette aesthetics can be tuned per theme.
- Cons: 2× data entry; harder to keep visually-distinct families distinct in both modes; runtime swap requires reading `[data-theme]` in the silhouette renderer (currently it doesn't).

- [ ] **Step 1: Run the audit script with both basemaps and tabulate failures**

Compute for each of the 19 failing colors:
- Light contrast (current)
- Dark contrast (current)
- Whether a single replacement hex can hit ≥ 3:1 on both
- If single-palette infeasible for that color, mark dual-palette required

- [ ] **Step 2: Pick the path**

Make a recommendation based on the tabulated data. If ≥ 17/19 families can hit dual-axis with a single hex, go Path A. If < 17/19, go Path B.

- [ ] **Step 3: Commit the decision**

Write a short ADR-style note at the top of `migrations/<n>_family_silhouettes_color_audit.sql` explaining the path chosen and why. ~100 words.

### Task 3: Migration — re-pick 19+ colors (or add color_dark column)

- [ ] **Step 1: Write the migration**

Path A example:

```sql
-- Up Migration
UPDATE family_silhouettes SET color = '#A87038' WHERE family_code = 'passerellidae'; -- was #D4923A (light 2.34:1)
UPDATE family_silhouettes SET color = '#9E5F2A' WHERE family_code = 'tyrannidae';    -- was #C77A2E (light 2.98:1)
-- ... 17 more rows ...

-- Down Migration
UPDATE family_silhouettes SET color = '#D4923A' WHERE family_code = 'passerellidae';
UPDATE family_silhouettes SET color = '#C77A2E' WHERE family_code = 'tyrannidae';
-- ... 17 more rows ...
```

Path B example:

```sql
-- Up Migration
ALTER TABLE family_silhouettes ADD COLUMN color_dark VARCHAR(7);
UPDATE family_silhouettes SET color_dark = '#E0B870' WHERE family_code = 'passerellidae';
-- ... per-family color_dark assignments ...
ALTER TABLE family_silhouettes ALTER COLUMN color_dark SET NOT NULL;

-- Down Migration
ALTER TABLE family_silhouettes DROP COLUMN color_dark;
```

- [ ] **Step 2: Run migration locally + verify**

```bash
npm run db:migrate
PGPASSWORD=birdwatch psql -h localhost -p 5433 -U birdwatch -d birdwatch -c "SELECT family_code, color FROM family_silhouettes;"
```

Confirm the 19 updated rows have new colors.

- [ ] **Step 3: Run the palette tests**

```bash
npm run test --workspace @bird-watch/frontend -- --run frontend/src/config/family-palette.test 2>&1 | tail -5
```

Expected: both tests PASS.

- [ ] **Step 4: Commit**

```bash
git add migrations/ frontend/src/utils/wcag-contrast.ts frontend/src/utils/wcag-contrast.test.ts frontend/src/config/family-palette.test.ts
git commit -m "feat(palette): WCAG 3:1 audit harness + 19-color rebalance (Phase 1, closes G7)

19 of 38 Phylopic-curated backfill colors + 2 of 15 seed colors failed
WCAG 1.4.11 (3:1 non-text contrast) against either light or dark basemap.
Re-pick each failing hex to score ≥ 3:1 against both basemaps at full
opacity. Adds a contrastRatio utility + tests that fail CI if any palette
entry drops below threshold.

Closes G7 (palette × basemap contrast). G8 depends on Phase 4."
```

### Task 4: CI workflow — fail on contrast regressions

- [ ] **Step 1: Write the workflow file**

`.github/workflows/family-palette-contrast.yml`:

```yaml
name: family-palette-contrast
on:
  pull_request:
    paths:
      - 'migrations/**'
      - 'frontend/src/config/family-palette.ts'
      - 'frontend/src/utils/wcag-contrast.ts'
jobs:
  contrast:
    runs-on: ubuntu-latest
    continue-on-error: true   # 7-day soft launch; flip to false after a clean-run review
    steps:
      - uses: actions/checkout@v6
      - uses: actions/setup-node@v6
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npm run test --workspace @bird-watch/frontend -- --run frontend/src/config/family-palette.test
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/family-palette-contrast.yml
git commit -m "ci: family-palette-contrast workflow — soft-launch (Phase 1)

7-day soft launch with continue-on-error: true. Flip to false after a
clean-run review per the orphan-classname-check rollout precedent
(CLAUDE.md). Adding to the Mergify queue gate is a deliberate
admin-op on branch protection; do not assume load-bearing until the
flip lands."
```

### Task 5: Phase 1 PR — open + review + queue

- [ ] **Step 1: Push branch**

```bash
git push -u origin worktree-grid-contrast-phase-1
```

- [ ] **Step 2: Open PR via `pr-workflow` skill**

Title: `feat(palette): WCAG 3:1 audit + 19-color rebalance — adaptive-grid contrast phase 1 (closes G7)`.

Body MUST follow `.github/PULL_REQUEST_TEMPLATE.md` verbatim. Required sections:
1. **Diagram** — table of before/after contrast ratios for the 19 updated families. ASCII or Mermaid.
2. **Summary** — 2 bullets pointing at G7, plan reference, and the audit harness.
3. **Screenshots** — 10 user-attachments URLs (5 viewports × 2 themes). Map shows the new palette; banner-less surface so the actual cluster tiles are the design-review focus.
4. **Test plan** — checkboxes for harness tests, migration, palette tests, build, knip, orphan-classname, e2e.
5. **Plan reference** — link to this plan + the new adaptive-grid-contrast epic.

- [ ] **Step 3: Dispatch `julianken-bot` review subagent (opus, cross-tier).**

- [ ] **Step 4: Dispatch `ui-design:ui-designer` design-review subagent (opus) with the 10 screenshot URLs.**

- [ ] **Step 5: After both APPROVE, post `@Mergifyio queue` (literal, 16 chars).**

---

## Phase 2 — Fallback tile rework

Replace flat `opacity: 0.5` with `opacity: 0.85` + dashed-border affordance.

**Files:**
- Modify: `frontend/src/components/map/AdaptiveGridMarker.tsx`
- Modify: `frontend/src/components/ds/ds-primitives.css`
- Modify: `frontend/src/components/map/AdaptiveGridMarker.test.tsx` (verify new opacity value)

### Task 1: TSX inline style — opacity 0.5 → 0.85

- [ ] **Step 1: Modify `AdaptiveGridMarker.tsx:454` (interactive branch)**

```typescript
// BEFORE:
style={{ all: 'unset', cursor: 'pointer', display: 'block', opacity: 0.5 }}

// AFTER:
style={{ all: 'unset', cursor: 'pointer', display: 'block', opacity: 0.85 }}
```

- [ ] **Step 2: Modify `AdaptiveGridMarker.tsx:475` (non-interactive branch)**

```typescript
// BEFORE:
style={{ opacity: 0.5 }}

// AFTER:
style={{ opacity: 0.85 }}
```

- [ ] **Step 3: Update tests pinning the opacity value**

Search `AdaptiveGridMarker.test.tsx` for `opacity: 0.5` or `0.5` near fallback tests. Update to `0.85`.

### Task 2: CSS — dashed border on `.adaptive-grid-marker__cell--fallback`

- [ ] **Step 1: Add the rule in `ds-primitives.css`**

```css
.adaptive-grid-marker__cell--fallback {
  /* Preserves the "no curated art" affordance per spec §348, §377.
     Replaces the prior opacity: 0.5 mechanism (which failed WCAG 1.4.11
     against the cream basemap). Phase 2 of adaptive-grid contrast epic. */
  border: 1.5px dashed currentColor;
  border-radius: 3px;
  box-sizing: border-box;
}
```

- [ ] **Step 2: Verify visibility at 22×22px**

Drive Playwright MCP at 5 canonical viewports. Confirm the dashed border is visible against both cream and dark basemaps. If 1.5px is too thin at the 22×22 cell size, bump to 2px.

- [ ] **Step 3: Run orphan-classname check**

```bash
bash scripts/check-orphan-classnames.sh 2>&1 | tail -5
```

Expected: PASS.

### Task 3: Phase 2 PR — open + review + queue

Same pattern as Phase 1 Task 5.

Title: `style(map): fallback tile WCAG fix — opacity 0.85 + dashed border (Phase 2)`.

5 viewports × 2 themes screenshots required. Both bot review + design review.

---

## Phase 3 — Forced-colors mode support

Add `@media (forced-colors: active)` rules for all cell variants; switch SVG fill attribute to CSS property.

**Files:**
- Modify: `frontend/src/components/ds/ds-primitives.css`
- Modify: `frontend/src/components/map/AdaptiveGridMarker.tsx`

### Task 1: CSS — forced-colors block

- [ ] **Step 1: Add the rules in `ds-primitives.css`**

```css
@media (forced-colors: active) {
  .adaptive-grid-marker__cell {
    border: 1px solid CanvasText;
    forced-color-adjust: auto;
  }
  .adaptive-grid-marker__cell--fallback {
    border-style: dashed;
    color: GrayText;
  }
  .adaptive-grid-marker__cell--pending {
    /* shimmer animation is reduced/replaced by system color in forced-colors */
    background: Canvas;
    animation: none;
    border: 1px dashed CanvasText;
  }
}
```

### Task 2: SVG fill — attribute → CSS property

- [ ] **Step 1: Modify SVG path fill in `AdaptiveGridMarker.tsx`**

Find every `<path d={...} fill={tile.color} />` instance. Replace with:

```tsx
<path
  d={tile.svgData /* or FALLBACK_SILHOUETTE_PATH */}
  style={{ fill: tile.color, forcedColorAdjust: 'auto' }}
/>
```

This routes the fill through CSS so `forced-color-adjust: auto` (CSS default) engages and the system color remap takes effect.

The white halo stroke (`stroke="white"`) should similarly become `style={{ stroke: 'white' }}` for the same reason. (Or `stroke="white"` may need to become `stroke="CanvasText"` in forced-colors mode — verify visually.)

- [ ] **Step 2: Verify with Playwright forced-colors emulation**

```typescript
// In a new e2e test or as an extension to the existing map-cell-popover spec:
test('adaptive-grid-marker renders accessibly in forced-colors mode', async ({ page }) => {
  await page.emulateMedia({ forcedColors: 'active' });
  await page.goto('/');
  await page.locator('[data-testid="adaptive-grid-marker"]').first().waitFor();
  // Visual assertion: cells have a system-color border + system-color fill
  const cell = page.locator('[data-testid^="adaptive-grid-marker-cell-rendered"]').first();
  const borderColor = await cell.evaluate((el) => getComputedStyle(el).borderColor);
  // In forced-colors mode, the browser maps to system colors — exact value varies by OS theme
  // but border should not be transparent
  expect(borderColor).not.toBe('rgba(0, 0, 0, 0)');
});
```

### Task 3: Phase 3 PR — open + review + queue

Same pattern. Title: `feat(map): forced-colors mode support for adaptive-grid cells (Phase 3)`.

---

## Phase 4 — Flip BASEMAP_DARK alias

**Files:**
- Modify: `frontend/src/components/map/basemap-style.ts`
- Modify: `docs/design/01-spec/open-questions.md`

### Task 1: Flip the alias

- [ ] **Step 1: Edit `basemap-style.ts:28`**

```typescript
// BEFORE:
/** Aliased to the light URL until G8 closes — see the module comment. */
export const BASEMAP_DARK: string = BASEMAP_LIGHT;

// AFTER:
/** Real dark tile URL — G8 closed 2026-MM-DD (PR #XXX). */
export const BASEMAP_DARK: string = 'https://tiles.openfreemap.org/styles/dark';
```

Update the module-level JSDoc to remove the "deferred until G7/G8 close" framing and replace with "G7 closed by PR #YYY (palette overhaul); G8 closed by this PR (dark basemap alias flipped)".

- [ ] **Step 2: Verify the `MutationObserver` swap works**

Drive Playwright MCP:
1. Load the map in light mode.
2. Take a screenshot of the basemap.
3. Toggle the theme via the theme button.
4. Wait for the basemap to re-style.
5. Take a screenshot.
6. Verify: the two screenshots are visually distinct (light vs dark basemap).

If the observer fires but `setStyle` doesn't update the basemap visibly, debug the observer. Cite `MapCanvas.tsx:1152+`.

### Task 2: Close G7 + G8 in open-questions.md

- [ ] **Step 1: Edit `docs/design/01-spec/open-questions.md`**

Find G7 and G8 sections. Mark them as CLOSED with a one-sentence resolution summary:

```markdown
## G7 — Family palette × basemap contrast

**Status:** CLOSED 2026-MM-DD (PR #XXX, Phase 1 of adaptive-grid contrast epic).
Audit ran via `scripts/check-family-palette-contrast.ts`; 19 failing colors
re-picked to score ≥ 3:1 against both basemaps at full opacity. CI workflow
`.github/workflows/family-palette-contrast.yml` gates regressions.

## G8 — Dark basemap palette ratification

**Status:** CLOSED 2026-MM-DD (PR #YYY, Phase 4 of adaptive-grid contrast epic).
BASEMAP_DARK alias flipped to `https://tiles.openfreemap.org/styles/dark`.
Existing MutationObserver in MapCanvas.tsx handles the live swap on theme
toggle. Verified at 5 canonical viewports × 2 themes via Playwright MCP.
```

### Task 3: Phase 4 PR — open + review + queue

Same pattern. Title: `feat(map): flip BASEMAP_DARK to real dark tile (closes G8, Phase 4)`.

Screenshots: ESPECIALLY the dark-theme ones for this PR — they're the verification.

---

## Doc-only addendum (small PR, not a phase)

**Files:**
- Modify: `docs/specs/2026-05-14-adaptive-cluster-grid-design.md` §4

### Task 1: §4 sizing table note

- [ ] **Step 1: Add the note after the existing sizing table**

```markdown
### Note: deconflict-bucket interaction with 4×4 desktop grid (observation O1)

The deconflict module (#554) sizes its `BUCKET_PX = 14` constant based on
the 1×1 single-cell marker case. A 4×4 desktop grid (uniqueFamilies 10–16)
renders at 100×100px footprint — significantly larger than the 14px bucket.
At low zoom levels, two such markers in adjacent buckets may visually
overlap even though their anchor centroids are deconflicted.

This is not a deconflict bug — the layer correctly resolves anchor-level
collisions. The visual interaction is between marker SVG size and bucket
spacing. If user reports surface, the fix is either (a) re-tune
`BUCKET_PX` for the 4×4 case, OR (b) raise the cluster threshold so 4×4
grids only appear at zoom levels where the bucket distance is naturally
larger.

Cross-reference: `frontend/src/components/map/deconflict.ts` `BUCKET_PX`;
`pickGridShape` in `adaptive-grid.ts:76-88`.
```

### Task 2: Small docs-only PR

Title: `docs(spec): note deconflict-bucket × 4×4 grid interaction (#539 addendum)`.

No screenshots required (docs only). Bot review still recommended but design review skipped.

---

## Self-review

**Findings coverage:**
- F1 (palette failures): ✓ Phase 1 Tasks 1–3 (harness + migration)
- F2 (fallback opacity): ✓ Phase 2 Tasks 1–2
- F3 (forced-colors): ✓ Phase 3 Tasks 1–2
- F4 (BASEMAP_DARK alias): ✓ Phase 4 Task 1
- O1 (deconflict-bucket × 4×4): ✓ Doc addendum

**Gate closure:**
- G7 closes via Phase 1 (palette audit + harness)
- G8 closes via Phase 4 (alias flip)

Both gates explicitly referenced in the closing PRs.

**Placeholder scan:**

```bash
grep -nE "TBD|XXX|placeholder text|implement later|implement similarly|add appropriate" docs/plans/2026-05-16-adaptive-grid-tile-contrast.md
```

Expected: no matches (the `#XXX` and `#YYY` strings are PR-number placeholders to fill at PR-open time, not unresolved plan content).

**Type consistency:**
- `BASEMAP_DARK` signature `string` unchanged across the alias flip
- `contrastRatio(a: string, b: string): number` consistent across Phase 1 tests
- No new shared types introduced

All consistent.

**CSS sub-task gate:**

```bash
grep -n "className" docs/plans/2026-05-16-adaptive-grid-tile-contrast.md | grep -v "grep\|CSS rules\|Step\|MUST\|orphan-classname"
```

Phase 2 introduces `.adaptive-grid-marker__cell--fallback` rule (existing class, new rule). Phase 3 introduces forced-colors block for existing classes. No new classNames introduced.

**Multi-viewport design-review gate:**
- Each phase's implementation PR captures 5 canonical viewports × 2 themes (10 screenshots) and dispatches a `ui-design:ui-designer` opus subagent.
- Phase 4 ESPECIALLY needs dark-theme captures (verification of the alias flip).

Both gates satisfied per-phase.

---

## Notes for the executor

- **Don't rush Phase 1.** The palette audit is the foundation. If a few replacement colors don't visually fit (e.g., two adjacent families end up with hard-to-distinguish hues), the fix is to re-pick — not to lower the contrast threshold.
- **The dual-palette path (`color_dark`)** has a runtime cost (silhouette renderer must read `[data-theme]`). If Phase 1 chooses Path B, factor in the additional render-path change in Phase 1 Task 3 + a renderer update task.
- **Phase 4 has a soft dependency on Phase 2.** The dark basemap will be active; fallback tiles need to be readable against it. If Phase 4 ships before Phase 2, expect dark-mode-only fallback-tile invisibility regressions.
- **The doc-only addendum is small** but cross-references closed epic #539. Maintain the cross-reference; do not silently rewrite the parent spec without flagging.
