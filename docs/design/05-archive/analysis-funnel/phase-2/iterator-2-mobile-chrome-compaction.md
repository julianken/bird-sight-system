# Phase 2 — Iterator 2: Mobile Chrome Compaction

## Assignment

Resolve Phase 1 tension #2: mobile chrome (FiltersBar 2-row ~130px + SurfaceNav ~44px ≈ 174px, ~21% of 844px) consumes viewport before content. FamilyLegend overlay then eats ~40% of remaining map area. Map the design-pattern space for compacting chrome while preserving WAI-ARIA tablist semantics (SurfaceNav.tsx:79–108), native form a11y (FiltersBar.tsx:64–123), global filter coupling (App.tsx:24–29), and tap targets (44px content, 32px chrome).

---

## Pixel Budget Baseline (Medium Confidence)

| Region | Current height | Notes |
|---|---|---|
| FiltersBar | ~130px (2-row wrap) | `flex-wrap: wrap`, `styles.css:369`; 4 controls |
| SurfaceNav | ~44px | `padding: var(--space-sm) var(--space-lg)` + 6px+14px tab padding; `styles.css:381–384` |
| **Total chrome** | **~174px** | **20.6% of 844px** |
| FamilyLegend (expanded) | ~variable, est. 40% of post-chrome area | localStorage persists expanded state on map; `MapSurface.tsx:22–31` |

---

## Patterns Mapped

### Pattern A: Bottom Tab Bar + Filter Sheet

**Description.** Move SurfaceNav to the bottom of the viewport as a fixed bottom bar (Material/iOS convention). FiltersBar moves behind a "Filters" FAB or bottom-bar action item — tapping opens a modal sheet (`<dialog>`) or a bottom sheet.

**Pixel budget improvement.** SurfaceNav migrates from top-of-content to outside the scrollable viewport floor — reclaims its full ~44px from the top chrome. FiltersBar collapses to zero height unless the sheet is open. Net top reclaim: ~174px → ~0px (100% of former chrome height freed). The bottom bar itself costs ~52–56px at the viewport floor (iOS safe-area-aware), but this does not reduce map/content visibility.

**A11y consequences.**
- `role="tablist"` can remain on the bottom bar container; `role="tab"` buttons survive; roving tabindex and Arrow/Home/End keyboard contract (`SurfaceNav.tsx:40–73`) are fully preservable since the DOM structure is unchanged — only position changes.
- `aria-controls="main-surface"` pointer on each tab still resolves correctly since `<main id="main-surface">` (App.tsx:169) is not moved.
- Landmark order (`region` → `tablist` → `main` → `contentinfo`) would be VIOLATED if the bottom bar is rendered after `<footer role="contentinfo">` in DOM order. Fix: render the bottom-bar tablist in DOM position 2 (same slot as today's SurfaceNav) and use `position: fixed; bottom: 0` visually, or use CSS `order` within a flex column. The axe landmark-order test at `axe.spec.ts:8–20` constrains this — DOM order must be preserved even if visual order changes.
- Filter sheet: if implemented as native `<dialog>`, inherits AttributionModal's existing focus-capture pattern (`AttributionModal.tsx:182–261`) at zero additional ARIA cost. A div-based bottom sheet would require full WAI-ARIA `role="dialog"`, `aria-modal`, focus trap, ESC, and backdrop-click — roughly the same implementation cost as `SpeciesAutocomplete.tsx`'s custom combobox (354 lines).
- Native `<select>` and `<datalist>` inside the filter sheet remain native — no a11y regression on FiltersBar.tsx:64–123.

**Implementation cost.** Medium. SurfaceNav position change is CSS-only (add `position: fixed; bottom: 0; width: 100%`; add `padding-bottom` to `<main>` to prevent content from hiding behind bar). Filter sheet requires a new modal/sheet component if native `<dialog>` is used — analogous to AttributionModal, ~60–80 lines. A div-based animated bottom sheet from scratch would be ~150–200 lines plus `prefers-reduced-motion` guard. No new JS dependencies if using native `<dialog>`.

**Discoverability.** High for navigation (bottom tabs are the dominant mobile nav pattern for 4-surface apps). Lower for filters — "Filters" button must have a visible count badge ("3 active") to surface filter state. Without the badge, users may not know filters are set (this is an existing gap: "FiltersBar global filters silently affect non-current surfaces" — Phase 1 Finding, area-2). The badge would also satisfy SR users' need for filter-change announcement (Phase 1 area-5 Finding 7 gap).

**Global filter coupling tension.** Moving filters behind a sheet does not change the global coupling in App.tsx:24–29 — it just hides the controls. Users who interact with the FamilyLegend on the map surface (which writes `familyCode` to global state via App.tsx:91–96) would still see the filter reflected in the sheet when they open it. A "Filters active" badge on the FAB/tab-bar action would make this visible.

---

### Pattern B: Sticky Compact Header (Single-Row Chip Strip + "More" Button)

**Description.** Collapse FiltersBar from `flex-wrap: wrap` (2–3 rows) to a single horizontal row of chips showing active filters only, plus a "More filters" overflow button. Inactive/default filters are hidden until "More" is tapped, which opens an inline expansion or a popover.

**Pixel budget improvement.** FiltersBar collapses from ~130px to ~40–44px (single row, matching SurfaceNav height). SurfaceNav stays at top. Combined chrome: ~44px + ~44px = ~88px, reclaiming ~86px (~10% of 844px, roughly halving the current chrome overhead). Less dramatic than Pattern A but keeps all chrome topside.

**A11y consequences.**
- FiltersBar's `role="region" aria-label="Filters"` (FiltersBar.tsx:65) survives at reduced height. No ARIA role changes.
- Native `<select>` and `<datalist>` can be preserved in the "More" expanded state. The chip strip showing active values can be read-only spans or buttons that focus the relevant filter on click — no new ARIA required beyond `aria-label` on each chip.
- Keyboard: the chip row must be tab-traversable; each chip that clears a filter needs a `<button>` not a `<span>` (current FiltersBar has no chip-remove pattern). Clear-button on each chip needs `aria-label="Clear Species filter"` etc.
- "More filters" popover: if implemented as a `<details>/<summary>` element, it is zero-JS and fully accessible. If implemented as a floating overlay, it requires `role="dialog"` or `role="listbox"` depending on interaction model.

**Implementation cost.** Medium-high. Requires a new chip-strip rendering layer on top of the existing FiltersBar. The existing FiltersBar.tsx:36–124 renders labels + native controls — this would need a significant refactor or a wrapper component that derives chip state from current filter values and maps "chip click to clear" to `props.onChange`. The "More" panel could reuse the existing labels/controls markup verbatim. Risk: the `<datalist>`-based species input does not render well inside a compact chip — the common name is variable-length. A truncated chip with a title attribute is workable but requires careful width management.

**Discoverability.** Good — chips are inherently visible ("Notable only" chip appearing when that filter is active). Risk: when all filters are at defaults, the chip strip is empty and the only affordance is "More filters" — first-time users may not find filters at all.

**Global filter coupling.** Same as today — no change to coupling. The chip strip would make active filters more visible on every surface (gap identified in Phase 1 area-2 Finding 3 and area-3).

---

### Pattern C: Drawer-From-Edge for Filters

**Description.** Remove FiltersBar from persistent top chrome entirely. A filter icon button in the SurfaceNav row (or a FAB) opens a left or right slide-in panel covering ~80% of the viewport width, containing all FiltersBar controls.

**Pixel budget improvement.** FiltersBar: ~130px → 0px at rest. SurfaceNav stays at ~44px. Total chrome: ~44px (74% reduction from ~174px). Reclaims the most top space of any top-only pattern.

**A11y consequences.**
- Drawer must implement `role="dialog"` with `aria-modal="true"`, `aria-label="Filters"`, focus trap on open, ESC to close, focus restoration on close. This is a complete duplication of AttributionModal's machinery (`AttributionModal.tsx:182–261`).
- The `role="region" aria-label="Filters"` landmark on FiltersBar.tsx:65 would be replaced by a dialog role — landmark order changes (no region between tablist and main). The axe landmark-order test (`axe.spec.ts:8–20`) may pass because `role="dialog"` is an acceptable landmark replacement, but this needs verification — the current test asserts a specific landmark sequence.
- Native `<select>` / `<datalist>` survive inside the drawer.
- The filter trigger button needs `aria-haspopup="dialog"` and `aria-expanded` — same pattern as AttributionModal's trigger (App.tsx:279–280 cited in area-5 Finding 4).

**Implementation cost.** Medium. CSS `transform: translateX` slide-in with `prefers-reduced-motion` guard (instant open/close under reduced-motion). Focus management is ~60 lines following the AttributionModal pattern. Total: ~100–120 new lines plus CSS. The largest cost is the landmark-order regression audit — the axe suite may need an assertion update if the `region` landmark disappears from the sequence.

**Discoverability.** Lower than A or B. Filter state is completely invisible until the drawer is opened. The filter trigger button can show an active-filter count badge, but this is a secondary affordance. Users who have never seen a filter drawer may not find it. Most appropriate for surfaces where filtering is an advanced, infrequent action — at odds with Phase 1's finding that the notable filter and time-window filter are high-utility for engaged users.

**Global filter coupling.** No change to coupling. Drawer closes after interaction; changes take effect globally (same as today).

---

### Pattern D: Segmented Control + Condensed Time Selector

**Description.** Keep FiltersBar in place but redesign the individual controls: replace the `<select>` time window with a 4-option segmented control (Today / 7d / 14d / 30d) rendered as a single-row button group; move the "Notable only" checkbox into an icon-toggle (star/flag icon + `aria-pressed`); keep Family `<select>` and Species `<datalist>` as-is. Result: 2 fewer wrapped items, potentially single-row on all but the narrowest viewports.

**Pixel budget improvement.** A segmented control with 4 short labels at 13px font fits in ~180px width on a 390px viewport leaving room for Family select and Notable toggle. If it fits in one row: ~130px → ~44px (single row). If it still wraps for the Family + Species controls: ~130px → ~88px (two rows). Improvement is 33–66% depending on control widths. Less reliable than Patterns A or C at reducing pixel cost.

**A11y consequences.**
- Segmented control for time window: replace `<select>` with a `role="radiogroup"` + `role="radio"` button group (WAI-ARIA radio group pattern), or with a single-row `role="tablist"` (less appropriate semantically). Each option needs `aria-checked` and `aria-label`. The native `<select>` requires zero code; the custom segment requires ~40 lines plus keyboard handling (Arrow keys within group, Enter/Space to select). This is a deliberate trade of native a11y for visual density.
- Notable icon toggle: replace `<input type="checkbox">` with `<button aria-pressed={notable}>`. Needs `aria-label="Notable only"` to convey meaning without visible text. Icon must have an accessible name via `aria-label` on the button or `<title>` on an inline SVG. Loss: the native checkbox communicated its state via the OS control; `aria-pressed` communicates it via ARIA only — SR users get equivalent information but the interaction model changes.
- Family `<select>` and Species `<datalist>` unchanged — no a11y impact.

**Implementation cost.** Low-medium. Segmented control is ~40 lines of new React + CSS. Icon toggle is ~10 lines replacing the checkbox. No new dialog/drawer/sheet infrastructure. This is the lowest net-new-code pattern.

**Discoverability.** Same as today for the segmented control (always visible). Icon toggle for Notable may be less discoverable than the checkbox label — depends on icon clarity. A tooltip on hover/focus helps desktop; mobile users need a visible label or an aria-label that is also used as a visible tooltip on long-press.

**Global filter coupling.** No change.

---

### Pattern E: Hide Chrome on Scroll (Autohide)

**Description.** On scroll-down, FiltersBar and/or SurfaceNav slide offscreen via CSS transform. On scroll-up (or scroll-to-top), they reappear. Common in mobile browser chrome and some list apps.

**Pixel budget improvement.** At rest (top of page, not scrolled): 0 improvement. While scrolled: effectively ~174px reclaimed. Net improvement is conditional and unpredictable — the chrome is visible on initial load (when FamilyLegend conflict occurs) and after any scroll-up gesture.

**A11y consequences.**
- Hidden chrome must remain in the DOM (not `display:none` or `visibility:hidden` while offscreen) for SR users — SR users navigate the DOM structure, not the visual position. Using `transform: translateY(-174px)` keeps elements accessible to SR but may cause confusion: a SR user hears "Surface: Feed, Species, Map tabs" but the tabs are visually offscreen.
- Focus management: if a user tabs to a SurfaceNav tab that is autohidden, the viewport must scroll to reveal it — browsers do this for focusable elements via `scrollIntoView`, but only if the element is inside the scroll container, not `position: fixed`. A fixed-position autohiding header with `transform` will not auto-reveal on focus in all browsers. This is a WCAG 2.4.7 (Focus Visible) risk.
- `prefers-reduced-motion`: the slide animation must be disabled; can offer an instant show/hide instead, which may be jarring — abrupt chrome appearance/disappearance is a UX regression.
- The map surface is the most affected: the FiltersBar/SurfaceNav are fixed-position overlaying the map. Autohide does not apply to a non-scrolling surface like the map. For feed and species (scrollable lists), autohide is more natural, but the SurfaceNav needs to be accessible throughout.

**Implementation cost.** Medium. Requires a scroll-position listener (IntersectionObserver or scroll event on `<main>`). The scroll listener drives a CSS class that applies the `transform`. Multiple edge cases: rapid scroll direction changes, keyboard focus forcing reveal, map surface exemption, mobile momentum scrolling jitter. The jitter problem alone typically requires a debounced velocity check (~50 additional lines).

**Discoverability.** Worst of all patterns for first-time users — chrome disappears as soon as they scroll, and they must know to scroll up to reveal it. Combined with the existing back-navigation problem (replaceState, Phase 1 area-2 Finding 1), users on the detail surface who autohide the SurfaceNav cannot easily return to other surfaces.

**Verdict as standalone pattern.** Not recommended as a primary compaction strategy. Can supplement Pattern A or B for the feed/species scroll surfaces once the primary chrome has already been reduced.

---

### Pattern F: Per-Surface Chrome Variation

**Description.** Show only the filters relevant to each surface: map view shows Family + Notable (map-relevant); feed shows Time + Notable + Species; species shows Species only (since the surface itself is a species browser). FiltersBar renders a different subset per `activeView`.

**Pixel budget improvement.** Map view: 2 controls instead of 4 → likely fits in single row (~44px). Feed: 3 controls → borderline single row. Species: 1 control → trivially single row. Improvement: 33–66% depending on surface, unpredictable across the set.

**A11y consequences.**
- FiltersBar.tsx:23–33 `FiltersBarProps` already carries all 4 filters as props; a variant prop or a per-surface render path is straightforward. No ARIA changes — the region label and native controls stay the same.
- The key a11y risk is cognitive: SR users who learn "Time window filter is in Filters region" will discover it is absent on certain surfaces and may think they're on a different page or that the filter disappeared. Consistent chrome reduces SR cognitive load.

**Implementation cost.** Low — add a `visibleControls` prop to FiltersBar or add surface-conditional rendering inside the component. ~15 lines of code.

**CRITICAL CONFLICT with Phase 1 finding.** This pattern directly contradicts the global filter coupling confirmed in App.tsx:24–29 and documented in Phase 1 area-2 Finding 3: "FiltersBar filters are global across all surfaces — no per-surface scoping." If the Time filter is hidden on the map view, a user who set it on the feed view has no way to see or change it while on the map — it silently affects the map data. This could be addressed by always showing "active" filters regardless of surface-relevance, but that reintroduces the width problem. The per-surface variation pattern risks creating a misleading UI that implies per-surface filter scoping when the data model has none. Phase 1 identifies this as a core IA duality that must be communicated clearly, not obscured.

**Discoverability.** Inconsistent across surfaces — the same filter appears and disappears depending on where the user is. High friction for users who switch surfaces frequently.

---

## Trade-Off Matrix

| Pattern | Top chrome reclaim | Tablist preserved | Native filter a11y | New ARIA required | Impl. cost | Discoverability |
|---|---|---|---|---|---|---|
| A: Bottom tab + filter sheet | ~174px (100%) | Yes — DOM order preserved | Yes | `<dialog>` attrs (if native dialog) or full focus-trap (~60 lines) | Medium | High nav, Medium filters (needs badge) |
| B: Compact chip strip + More | ~86px (~49%) | Yes | Yes | Chip-clear buttons need aria-label | Medium-high | Good chips, Low default-state |
| C: Drawer from edge | ~130px (75%) | Yes | Yes | Full `role="dialog"` + focus trap | Medium | Low — filter state invisible |
| D: Segmented + icon toggle | ~44–86px (25–50%) | Yes | Partial — custom radio group replaces `<select>` | `role="radiogroup"` + `aria-pressed` | Low-medium | Good — always visible |
| E: Autohide on scroll | 0 at rest, ~174px scrolled | At risk — focus-reveal issue | Yes | No new ARIA but focus-visible risk (WCAG 2.4.7) | Medium | Worst — chrome disappears |
| F: Per-surface variation | 33–66% per surface | Yes | Yes | None | Low | Inconsistent; conflicts with global coupling |

---

## Findings

### Finding 1: Bottom Tab Bar (Pattern A) gives the largest reliable pixel reclaim and preserves the tablist contract fully

The tablist semantics (`SurfaceNav.tsx:79–108`) are decoupled from screen position. Moving the nav to a `position: fixed; bottom: 0` bar does not touch `role="tablist"`, roving tabindex, `aria-controls`, or Arrow/Home/End handling. The only constraint is landmark DOM order: the tablist element must appear second in DOM source order (after FiltersBar's `role="region"`, before `<main>`) regardless of visual position. CSS `position: fixed` achieves this. The axe suite (`axe.spec.ts:8–20`) will catch any regression.

The filter sheet, if implemented as a native `<dialog>`, inherits the AttributionModal's battle-tested focus management pattern at minimal additional cost. The modal is already tested across desktop + mobile viewports (`axe.spec.ts:314–351`).

### Finding 2: The FamilyLegend expanded-on-mobile problem is separable from chrome compaction

Phase 1 identified the FamilyLegend as consuming ~40% of post-chrome map area due to localStorage persistence (`MapSurface.tsx:22–31`). This is independent of FiltersBar/SurfaceNav height — even if all 6 chrome patterns above are applied, the FamilyLegend overlay remains. Compacting the top chrome does not solve the map visibility problem for returning users with an expanded legend. The FamilyLegend either needs a separate mobile default (collapsed on viewports < 760px regardless of localStorage), or needs to be migrated out of the map overlay into the filter sheet or a bottom sheet of its own.

### Finding 3: Pattern D (segmented control) trades native form a11y for density — a deliberate design-system choice

The existing `<select>` for time window is zero-ARIA-cost. A segmented control requires a `role="radiogroup"` with keyboard handling that the codebase does not currently have. The codebase already has one custom ARIA pattern (SpeciesAutocomplete.tsx, ~354 lines of custom combobox). Adding a second custom pattern for a 4-option time selector raises the maintenance surface. The component API question for this pattern: does it live in FiltersBar.tsx (increasing its complexity) or as a standalone `<SegmentedControl>` component with its own prop API? The latter is the right abstraction level but adds a new component to the system.

### Finding 4: Per-surface chrome variation (Pattern F) is IA-unsafe given the global coupling

`App.tsx:24–29` makes all filters global. Showing different filter subsets per surface creates an affordance that implies per-surface scoping when none exists. This is the highest-risk pattern from an IA integrity standpoint and should only be considered if the global coupling is refactored simultaneously — a larger scope change than chrome compaction alone.

### Finding 5: Autohide (Pattern E) has a WCAG 2.4.7 focus-reveal risk on fixed chrome

If SurfaceNav uses `position: fixed; top: 0` with `transform: translateY(-100%)` while autohidden, browser focus scrolling will not auto-reveal it when a keyboard user tabs to a nav tab. This is a real regression for keyboard users who rely on SurfaceNav for surface switching. Pattern E is only viable as a supplement to Pattern A (where the bottom bar is always visible and the top FiltersBar can autohide because it is not the primary navigation control).

### Finding 6: The filter-active-state visibility gap amplifies under any compaction pattern

Phase 1 area-2 Finding 3 documented: "FiltersBar global filters silently affect non-current surfaces with no global active-filter indicator." This gap becomes more severe when filters move behind a trigger (Patterns A, C) — users have no signal that a filter is active unless a badge count is displayed on the trigger. Any chrome compaction pattern that moves filters off-screen MUST add a filter-active indicator to the persistent chrome (a count badge, a colored trigger, or active-filter chips). This is a new component requirement not present in the current codebase.

---

## Resolved Questions

**Q: Does moving the tablist element to a bottom-fixed position break the WAI-ARIA contract?**
A: No. The WAI-ARIA tablist contract is a DOM structure and keyboard interaction contract, not a visual position contract. `role="tablist"`, roving tabindex, `aria-controls`, and Arrow/Home/End are all preserved independent of CSS position. The only constraint is that the element must remain second in DOM source order (after `role="region"` FiltersBar, before `<main>`). This is achievable with `position: fixed; bottom: 0` and appropriate `<main>` bottom padding.

**Q: Does native `<dialog>` work as a filter sheet on iOS Safari?**
A: Native `<dialog>` has been supported in Safari since 15.4 (released March 2022). The AttributionModal already uses it (`AttributionModal.tsx:182`). No compatibility concern for current browser targets.

**Q: Does the 44px content tap target rule extend to bottom tab bar items?**
A: The 44px minimum (styles.css:135–137, citing iOS HIG) applies to content rows. Chrome tab targets are currently documented at 32px (`styles.css:579–592` attribution trigger, line 819 legend entries). A bottom tab bar at 52–56px total height gives ~44px per tab touch target, which satisfies iOS HIG for navigation — an improvement over the current 32px chrome target ceiling.

---

## Remaining Unknowns

1. **SurfaceNav CSS position behavior (medium confidence gap).** Area-2 Finding's unknowns list: "Whether SurfaceNav itself is sticky or scrolls out of view is not confirmed from source alone." `styles.css:378–384` sets `display: flex` and `border-bottom` but no `position: sticky` or `fixed`. On mobile, if `<body>` has `overflow: hidden` and only `<main>` scrolls, the SurfaceNav is already de-facto sticky. Needs viewport scroll behavior audit before any positioning change.

2. **Filter sheet animation budget.** The `--dur-fast/base/slow` tokens (tokens.ts:115–122) exist but are unused. A filter sheet slide-in would be the first CSS animation in the codebase. The `prefers-reduced-motion` obligation (area-5 Finding 6) kicks in immediately — the sheet must open instantly at 0ms duration under reduced-motion. Whether an instant-open sheet is a good UX (vs. a modal that appears without transition) is a design question without a code answer.

3. **FamilyLegend mobile default behavior.** The `LEGEND_EXPAND_MIN_WIDTH=760` logic (`MapSurface.tsx:22–31`) is overridden by localStorage persistence. The correct fix (reset localStorage on viewport change vs. ignore localStorage below threshold vs. never expand on mobile by default) has IA implications — if the legend is always collapsed on mobile, the family-color encoding of the map markers is unexplained unless there is an alternative discovery path. This interacts with Pattern A (filter sheet could absorb the FamilyLegend on mobile, unifying all filter controls in one place).

4. **Safe-area inset for bottom tab bar.** iOS devices with home indicator (iPhone X+) require `padding-bottom: env(safe-area-inset-bottom)` on any `position: fixed; bottom: 0` element. The current codebase has no safe-area handling (no `<meta name="viewport">` `viewport-fit=cover`, no `env()` calls in styles.css). Pattern A requires this addition to avoid the home indicator overlapping tab labels.

5. **Filter badge count: which filters count?** A "3 active" badge needs a definition of "active" — is a filter active when it differs from its default? `since=14d` is the default (url-state.ts:15–22) and is omitted from URLs. A badge that shows "1 active" when since=7d and "0 active" when since=14d is correct but requires the badge logic to know defaults. This is straightforward but needs explicit spec before implementation.

---

## Revised Understanding

The chrome compaction problem has two separable sub-problems that Phase 1 treated as one:

1. **Top chrome height** (FiltersBar + SurfaceNav, ~174px): addressable by any of Patterns A–D. Pattern A (bottom tab + filter sheet) offers the largest reliable reclaim with the cleanest a11y story because the tablist DOM contract is position-independent and the filter sheet can reuse the existing `<dialog>` machinery. Pattern D (segmented control) is the lowest-cost incremental improvement without structural change.

2. **FamilyLegend map overlap** (~40% of post-chrome area on map surface): independent of top chrome height. Must be addressed separately — either by fixing the localStorage persistence default on mobile, or by migrating the FamilyLegend into the filter sheet (Pattern A) to unify all filter controls off the map canvas.

The global filter coupling (App.tsx:24–29) is a constraint, not a problem to solve in chrome compaction. Any pattern that moves filters behind a trigger must add a filter-active indicator to persistent chrome to compensate for reduced visibility. This is a new design system requirement — a filter badge or chip summary that lives in the top or bottom chrome bar and reads active filter state at all times.

The WAI-ARIA tablist (SurfaceNav.tsx:79–108) and native form controls (FiltersBar.tsx:64–123) are both preservable under all viable patterns (A, B, C, D). Pattern E (autohide) has a keyboard-focus regression risk that makes it unsuitable as a primary strategy. Pattern F (per-surface variation) has an IA integrity conflict with global coupling that makes it unsafe without a simultaneous data-model change.
