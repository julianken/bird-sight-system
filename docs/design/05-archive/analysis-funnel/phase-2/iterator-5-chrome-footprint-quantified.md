# Phase 2 — Iterator 5: Chrome Footprint Quantified

## Assignment

Replace Phase 1's medium-confidence eyeball numbers (~130px FiltersBar, ~44px SurfaceNav, ~21% viewport) with pixel-precise `getBoundingClientRect()` measurements at all 8 cells (4 surfaces × 2 viewports), then project what those numbers become under 2–3 chrome-compaction scenarios.

**Method:** Playwright MCP, `browser_evaluate` with `getBoundingClientRect()` calls, dev server at http://localhost:5173. All values are CSS pixels. Measurements taken on 2026-05-09.

---

## Raw Measurements — Chrome Elements

### Mobile 390×844

| Surface | FiltersBar h | SurfaceNav h | Chrome total | Chrome % VP | Main h | Main % VP | Footer h | Footer % VP |
|---|---|---|---|---|---|---|---|---|
| feed | 138.5 | 46.6 | **185.1** | **21.9%** | 609.9 | 72.3% | 49.0 | 5.8% |
| map | 138.5 | 46.6 | **185.1** | **21.9%** | 609.9 | 72.3% | 49.0 | 5.8% |
| species | 138.5 | 46.6 | **185.1** | **21.9%** | 609.9 | 72.3% | 49.0 | 5.8% |
| detail | 138.5 | 46.6 | **185.1** | **21.9%** | 609.9 | 72.3% | 49.0 | 5.8% |

Chrome is **surface-invariant at mobile**: same FiltersBar height, same SurfaceNav height across all four surfaces.

### Desktop 1440×900

| Surface | FiltersBar h | SurfaceNav h | Chrome total | Chrome % VP | Main h | Main % VP | Footer h | Footer % VP |
|---|---|---|---|---|---|---|---|---|
| feed | 52.5 | 46.6 | **99.1** | **11.0%** | 751.9 | 83.5% | 49.0 | 5.4% |
| map | 52.5 | 46.6 | **99.1** | **11.0%** | 751.9 | 83.5% | 49.0 | 5.4% |
| species | 52.5 | 46.6 | **99.1** | **11.0%** | 751.9 | 83.5% | 49.0 | 5.4% |
| detail | 52.5 | 46.6 | **99.1** | **11.0%** | 751.9 | 83.5% | 49.0 | 5.4% |

Chrome is also **surface-invariant at desktop** and nearly halves relative to mobile because FiltersBar collapses from 3 stacked rows (138.5px) to 1 single row (52.5px).

---

## FiltersBar Row Structure (Mobile)

At 390px, the four `<label>` children of FiltersBar wrap to **3 visual rows**:

| Row | Controls | y-top | Height |
|---|---|---|---|
| 1 | Time window (select) + Notable only (checkbox) | 12px | ~27px |
| 2 | Family (select) | 55px | ~27px |
| 3 | Species (text input) | 98px | ~27.5px |

The 138.5px total = 3 rows × ~27px each + 2 gaps (~10px each) + 16px top/bottom padding.

At 1440px, all four controls fit on **1 row** → FiltersBar=52.5px.

**Phase 1 said "~130px" for FiltersBar.** Measured value is **138.5px** (+8.5px, +6.5%).
**Phase 1 said "~44px" for SurfaceNav.** Measured value is **46.6px** (+2.6px, +5.9%).
**Phase 1 said "~174px total" (21%).** Measured total is **185.1px** (21.9%) — 11.1px underestimate.

---

## FamilyLegend Overlay — Map Surface Only

The `<aside class="family-legend">` does not carry `role="complementary"` — the prescribed selector in the assignment returns null. Correct selector: `.family-legend`.

### Mobile 390×844

| State | Legend h | Legend w | Top anchor | Bottom anchor | As % of Main (609.9px) |
|---|---|---|---|---|---|
| Collapsed | 33px | 165px | y=734 | y=767 | **5.4%** |
| Expanded | 273px | 261px | y=494 | y=767 | **44.8%** |

Expanded breakdown: toggle button=31px + entries list=240px + 2px border = 273px total.

Collapsed state is default after localStorage.clear(). Expanded state was the default when localStorage retained a prior session (confirmed in Phase 1: "appears expanded by default on mobile in both local & prod captures" — localStorage persistence).

### Desktop 1440×900

| State | Legend h | Legend w | Top anchor | Bottom anchor | As % of Main (751.9px) |
|---|---|---|---|---|---|
| Expanded | 433px | 240px | y=390 | y=823 | **57.6%** |

Expanded breakdown: toggle button=31px + entries list=400px + 2px = 433px. The legend is **taller on desktop** than mobile because it uses a grid layout that renders more rows at wider width. Collapsed state on desktop was not captured (localStorage cleared → map loaded with expanded legend at desktop, matching `LEGEND_EXPAND_MIN_WIDTH=760` auto-expand logic in `MapSurface.tsx:22–31`).

---

## Summary: What Each Budget Region Actually Costs

### Mobile 390×844

| Region | Measured px | % of 844px |
|---|---|---|
| Chrome (FiltersBar + SurfaceNav) | 185.1 | 21.9% |
| Footer | 49.0 | 5.8% |
| Main usable area | 609.9 | 72.3% |
| — of which: legend (expanded) overlays | 273 | 44.8% of main = 32.3% of VP |
| — of which: legend (collapsed) overlays | 33 | 5.4% of main = 3.9% of VP |

**Worst case (chrome + expanded legend + footer):** 185.1 + 273 + 49 = 507.1px consumed from 844px → **60.1% of VP is non-map-content** (chrome and overlay). Only 336.9px (39.9%) of viewport height is unobstructed map.

### Desktop 1440×900

| Region | Measured px | % of 900px |
|---|---|---|
| Chrome (FiltersBar + SurfaceNav) | 99.1 | 11.0% |
| Footer | 49.0 | 5.4% |
| Main usable area | 751.9 | 83.5% |
| — of which: legend (expanded) overlays | 433 | 57.6% of main = 48.1% of VP |

**Worst case (chrome + expanded legend + footer):** 99.1 + 433 + 49 = 581.1px from 900px → **64.6% of VP consumed**. Only 318.9px (35.4%) of VP is unobstructed map — worse than mobile in absolute pixel terms.

---

## Projection: Chrome Compaction Scenarios

All projections hold SurfaceNav at 46.6px (WAI-ARIA tablist; cannot be eliminated without breaking keyboard semantics). The attack surface is FiltersBar.

### Scenario A — Drawer / Sheet (filters hidden behind trigger)

FiltersBar collapses to a single 44px trigger bar (e.g. "Filters ▾" pill). SurfaceNav stays at 46.6px.

| Metric | Current mobile | Scenario A | Delta |
|---|---|---|---|
| Chrome total | 185.1px | **90.6px** | −94.5px (−51%) |
| Chrome % VP | 21.9% | **10.7%** | −11.2pp |
| Main usable area | 609.9px | **704.4px** | +94.5px (+15.5%) |
| Main % VP | 72.3% | **83.5%** | matches current desktop |

Recovered px go to content. If legend stays expanded, worst-case obstruction drops from 60.1% to 49.7% of VP. At desktop this scenario has no impact (FiltersBar already 52.5px; the drawer trigger would need to be ≤52.5px, a wash).

### Scenario B — Bottom Tab Bar replaces SurfaceNav (top), merges with footer

SurfaceNav moves to bottom (40px), footer Credits merges into the tab bar or is removed from the persistent layout. FiltersBar also gets the drawer treatment (44px trigger).

| Metric | Current mobile | Scenario B | Delta |
|---|---|---|---|
| Chrome total (top) | 185.1px | **44px** (FiltersBar drawer only) | −141.1px (−76%) |
| Bottom bar | 0 | **40px** | new element at bottom |
| Footer | 49px | **0px** (merged into bottom bar) | −49px |
| Main usable area | 609.9px | **760px** | +150.1px (+24.6%) |
| Main % VP | 72.3% | **90.1%** | +17.8pp |

This most aggressively recovers vertical space. Trade-off: WAI-ARIA tablist roving-tabindex behavior (`SurfaceNav.tsx:40–108`) must be preserved in the new bottom-bar implementation; Apple HIG recommends bottom tabs ≥49px for native apps but 40px is acceptable for web.

### Scenario C — Autohide Chrome on Map surface only

Chrome stays at 185.1px on feed/species/detail. On map surface only, FiltersBar slides up out of viewport on scroll/pan (CSS `transform: translateY(-138.5px)` + `transition`). SurfaceNav stays visible (46.6px) for tab switching.

| Metric | Current mobile/map | Scenario C (map, autohidden) | Delta |
|---|---|---|---|
| Visible chrome (top) | 185.1px | **46.6px** | −138.5px (−74.8%) |
| Main usable area | 609.9px | **748.4px** | +138.5px (+22.7%) |
| Legend (expanded) as % of new main | — | 36.5% | vs 44.8% current |

Constraint: `prefers-reduced-motion` must gate the autohide animation (currently zero `prefers-reduced-motion` queries exist anywhere — `tokens.ts:115–122`). This is a map-specific optimization that leaves feed/species chrome unchanged. It also requires a "show filters" re-entry affordance (adds IA complexity).

---

## Corrections to Phase 1 Estimates

| Metric | Phase 1 estimate | Measured value | Error |
|---|---|---|---|
| FiltersBar mobile height | ~130px | **138.5px** | +8.5px underestimate |
| SurfaceNav height | ~44px | **46.6px** | +2.6px underestimate |
| Combined chrome mobile | ~174px (21%) | **185.1px (21.9%)** | +11.1px, +0.9pp |
| FiltersBar row count | "2–3 rows" | **3 rows exactly** | correct range |
| Legend % of remaining area | "~40%" | **44.8% of main** (mobile expanded) | +4.8pp underestimate |

Phase 1's estimates were directionally correct but consistently underestimated by 5–7%. The legend obstruction is more severe than stated: **44.8% of main area** at mobile, and **57.6% of main area** at desktop (desktop was not estimated at all in Phase 1).

---

## Confidence

All measurements in this document are **high confidence** — directly read from `getBoundingClientRect()` on live DOM at the dev server (http://localhost:5173). No estimation. The only value not measured is the desktop legend collapsed height (collapsed state at desktop was inaccessible via the toggle without navigation side-effects from localStorage).

**Legend selector correction:** The prescribed selector `[role="complementary"]` returns null in the live DOM. The correct selector is `.family-legend` (`<aside class="family-legend">`). The `role="complementary"` implicit semantic of `<aside>` is not exposed as an explicit attribute in the rendered HTML.
