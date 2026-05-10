# Investigation: Accessibility, motion, and performance design surface

## Summary

The current site encodes a serious accessibility commitment for a 4-surface SPA: explicit landmark order (`role="region"` filters → `role="tablist"` surface nav → `<main id="main-surface">` → `<footer role="contentinfo">`); a working WAI-ARIA tablist with arrow/Home/End traversal in `SurfaceNav`; a native `<dialog>` modal with focus capture, autofocus on close, focus restoration, ESC, and backdrop-click; an `aria-busy` main; and a comprehensive axe-core suite that scans every surface × `desktop|mobile` × modal-open state at WCAG 2.1 A/AA. CSS contrast tokens are documented inline with measured ratios (e.g. `#5c5c5c` on `#fff` = 6.86:1, `#666` on `#fff` = 5.74:1). However, the redesign WILL hit real gaps the existing baseline tolerates: zero `prefers-reduced-motion` handling (because zero CSS motion exists today), the hard-coded MapLibre cluster colors `#51bbd6 / #f1f075 / #f28cb1` with `#1a1a1a` text were never audited for contrast inside axe (axe scans the chrome around the canvas, not the WebGL paint), the species-detail iNaturalist photo loads eagerly with no `loading="lazy"` / `srcset` / blurhash, the skip-link only mounts on the map view, and the only tabbable interactive map markers are auto-spider leaves at zoom ≥14 — clusters at lower zoom are mouse-only. A redesign that introduces motion, web fonts, gradient cluster fills, dark-mode, or richer marker glyphs has a *lot* of new constraint surface to honor.

## Key Findings

### Finding 1: Landmark order is fixed and load-bearing

- **Evidence:** `frontend/src/App.tsx:155–257` renders, in order, `<FiltersBar role="region" aria-label="Filters">` (`FiltersBar.tsx:65`) → `<SurfaceNav role="tablist" aria-label="Surface">` (`SurfaceNav.tsx:79`) → `<main id="main-surface" tabIndex={0} aria-busy={loading && (view==='feed'||view==='species')}>` (App.tsx:169–179) → `<footer role="contentinfo" className="app-footer">` (App.tsx:233). `App.tsx:227–231` documents the contract verbatim: "main → contentinfo … Do NOT move it before FiltersBar / SurfaceNav."
- **Confidence:** high — the comment block calls out it is "axe-clean landmark order" and the order is enforced by the e2e suite (`axe.spec.ts:8–20` initial-load WCAG2A/AA scan).
- **Implication:** A redesign may RE-STYLE these regions but cannot drop or reorder them. In particular: the filters surface must remain a labeled `region`; the surface switch must remain a `tablist` (not a flat list of nav links — see Finding 3); the modal must remain inside the `contentinfo` footer or the CC BY 3.0 §4(c) prominence story breaks. Constraint.

### Finding 2: Skip-link only exists on the map view; main is the scrollable-region focus target on every other surface

- **Evidence:** The skip-link button class (`.skip-link`) only renders inside `MapSurface.tsx:137–145` ("first interactive element on the map view"). It is NOT rendered on feed / species / detail. Compensating control on non-map views: `<main id="main-surface" tabIndex={0}>` (App.tsx:179) is itself a focusable scroll container — comment cites `axe scrollable-region-focusable (WCAG 2.1.1)`. The skip-link's *target* — `onSkipToFeed` in App.tsx:116–131 — sets `view: 'feed'` then focuses `ol.feed[aria-label="Observations"]` after `setTimeout(_, 0)`.
- **Confidence:** high — both code paths verified.
- **Implication:** The skip-link is a *map-specific* affordance because the map canvas is intentionally NOT in the global tab order (styles.css:94–100 cites this as deliberate: "a 344-marker tab sequence is hostile"). A redesign that introduces a global header/nav cluster taller than ~one surface-nav row should add a global skip-link; redesigns that keep today's chrome height MAY keep the per-surface pattern. Either way, do not regress the map-view skip-link or the feed `<ol>`'s `aria-label="Observations"` (the focus target query depends on it). Both constraint and gap (a designer should know it's currently asymmetric across surfaces).

### Finding 3: SurfaceNav implements the WAI-ARIA "automatic activation" tablist pattern fully

- **Evidence:** `SurfaceNav.tsx:79–108` — `role="tablist"` with `aria-label="Surface"`, three `role="tab"` buttons each carrying `aria-selected`, `aria-controls="main-surface"`, `id="surface-tab-<value>"`, and a roving `tabIndex` (`tabbable = selected || (!anyTabActive && index === 0)` at line 82). Keyboard: ArrowLeft/Right wrap, Home jumps to first, End jumps to last, Enter/Space activate (`SurfaceNav.tsx:40–73`). Activation moves focus AND selection together (the "automatic activation" variant — line 19 comment).
- **Confidence:** high.
- **Implication:** Visual redesign of the tabs must preserve roving tabindex semantics, the three `aria-controls` pointers at `#main-surface`, and the bidirectional Home/End/Arrow contract. A redesign that turns the tabs into "real" navigation links (`<a href>`) breaks the contract that SR users have learned and breaks `aria-controls`. Constraint.

### Finding 4: AttributionModal uses native `<dialog>` with manual focus management — no library

- **Evidence:** `AttributionModal.tsx:182–261`. Open: stash `document.activeElement` in `previouslyFocusedRef` (line 199), call `dialog.showModal()` (line 205), `queueMicrotask(() => closeBtn.focus())` to override Chrome's autofocus delegation race (line 215). Close: a single `handleClose` (line 237) restores focus to the stashed element. ESC closes natively (no JS); backdrop click closes via `event.target === dialog` (line 251). Trigger button has `aria-haspopup="dialog"` and `aria-expanded={open}` (lines 279–280); dialog has `aria-labelledby="attribution-modal-title"` (line 287). All external links use `rel="noopener noreferrer" target="_blank"` (lines 31–37 comment justifies why this diverges from MapCanvas's `noopener`-only convention).
- **Confidence:** high — explicit axe scan in modal-open state at desktop AND mobile (`axe.spec.ts:314–351`).
- **Implication:** The redesign can repaint the modal's chrome (header divider, list density) but must keep: native `<dialog>` element (not a React portal div), aria-labelledby pointer, the focus-on-close-button-on-open contract, and `rel="noopener noreferrer"` on external attribution links. A "designer wants Framer Motion modal" change is a non-trivial regression of this whole machinery. Constraint.

### Finding 5: Color contrast — text-on-cluster-bubble is unaudited and the dominant visual risk

- **Evidence:** `frontend/src/components/map/observation-layers.ts:170–205` (cluster circle layer) and `:211–237` (cluster-count symbol layer). Three step-graduated cluster fills:
  - `point_count <  100`: `#51bbd6` (sky-blue)
  - `point_count <  750`: `#f1f075` (yellow)
  - `point_count >= 750`: `#f28cb1` (pink)
  - text-color: `#1a1a1a` (`--color-text-strong`, line 234)

  Approximate luminance contrast of dark-on-fill: `#1a1a1a` on `#51bbd6` ≈ 7.7:1, on `#f1f075` ≈ 12.4:1, on `#f28cb1` ≈ 8.5:1 — all PASS WCAG AA 4.5:1 for normal text and AAA 7:1, despite never having been formalized as such. Visible in `tmp/redesign-analysis/screenshots/local/desktop/01-map-default.png` and `local/mobile/01-map-default.png` — pink "755", yellow "276", blue "60". Axe coverage explicitly excludes the canvas: `axe.spec.ts:24–32` documents that axe "scans the chrome around the map" because the WebGL canvas has no DOM for axe to read.
  Other text-on-fill audits in CSS are explicit and measured: `styles.css:243–249` (`#666 on #fff = 5.74:1, clears 4.5:1`), `:255` (`#555 on #fff = 7.46:1`), `:264` (`#5c5c5c on #fff = 6.86:1`), `:507–512` (white-on-`--color-text-strong` ~16:1 for `phenology-count-on-bar`).

  Family-color palette in `tokens.ts:124–158`: 7 earth-tone hex values (rust-orange, dark umber, olive, desert-tan, sand-bronze, warm-gold, brick red `#B84C3A`) plus hotspot blue `#00A6F3` and overflow grey `#888888`. These appear as: (a) silhouette fills on cluster-mosaic markers and unclustered icons (the colored bird shapes against the basemap in `01-map-default.png`); (b) silhouette fills inside FamilyLegend (against `--color-bg-surface: #fff` panels); (c) `species-detail-silhouette` fill on uncurated rows (`SpeciesDetailSurface.tsx:106`).
- **Confidence:** high (palette + paint values), medium (the implicit cluster-text contrast — measured-by-eye, not by tool, because axe excludes the canvas).
- **Implication:** The redesign's most fragile contrast surface is anything that puts text on a colored bubble or chip. Three concrete constraints: (1) any change to cluster fill colors must keep ≥4.5:1 against the count text color, ideally 7:1 (the current values clear it); (2) any change to family-color palette must keep ≥4.5:1 contrast with the silhouette's *surroundings* (the white legend bg, the basemap tile mid-tone) AND with the SVG's stroke if one is added; (3) any new "color chip + text-inside" pattern (the kind a redesign often introduces — pill counts, status badges) must be measured against the same 4.5:1 / 3:1 contrast targets the existing CSS rules document inline. Both constraint (existing values) and gap (no automated audit covers the canvas).

### Finding 6: Zero `prefers-reduced-motion` queries, because zero CSS motion exists

- **Evidence:** `grep -rn "prefers-reduced-motion" frontend/src/` returns nothing. `grep -n "transition\|animation\|@keyframes" frontend/src/styles.css` returns nothing. `tokens.ts:115–122` defines `duration.fast/base/slow` (200/250/350 ms), but no CSS rule consumes them — they are reserved for future use, evidenced by the `--dur-*` custom properties at `styles.css:16–18` being declared but unreferenced. The only motion in the running app is MapLibre's built-in pan/zoom/easeTo (used in `MapCanvas.tsx:729–732` for `getClusterExpansionZoom` → `easeTo`), which MapLibre itself does NOT honor `prefers-reduced-motion` for unless the consumer passes `respectPrefersReducedMotion` or skips animations explicitly.
- **Confidence:** high.
- **Implication:** The redesign has a clean slate for motion language but inherits a corresponding obligation: every CSS `transition` / `@keyframes` / `animation` introduced must be wrapped in or guarded by `@media (prefers-reduced-motion: reduce) { … }`. The `duration.*` tokens already exist as the obvious values to consume from `tokens.ts`. MapLibre `easeTo` calls in `MapCanvas.tsx` should be audited and either passed `duration: 0` under reduced-motion or replaced with `jumpTo` — currently they animate unconditionally. Pure gap.

### Finding 7: Screen-reader announcements — comprehensive on slow paths, silent on filter changes

- **Evidence:** Loading states use `role="status"` + `aria-live="polite"` consistently:
  - `FeedSurface.tsx:95` ("Loading observations…"), `:111` (empty-state hints — has role status, aria-live only on the loading branch).
  - `SpeciesSearchSurface.tsx:53–65` (prompt + empty + no-results, all `role="status"`).
  - `SpeciesDetailSurface.tsx:200` ("Loading species details…"), `:206` `role="alert"` for the error branch.
  - `MapSurface.tsx:151–152` (Suspense fallback "Loading map…").
  - `PhenologyChart.tsx:103` (loading), and `phenology-chart-loading` SVG aria-label survives axe (`axe.spec.ts:87–102`).
  - `AttributionModal.tsx:333/337/341` (error / loading / empty for the silhouette section, all `aria-live="polite"`).
  - `App.tsx:172`: `<main aria-busy={loading && (view==='feed'||view==='species')}>` — note the `aria-busy` is gated to only TWO views (feed + species), not detail or map.
- **Confidence:** high.
- **Implication:** Strong baseline. But two narrative gaps: (1) filter changes (FiltersBar — `since` / `notable` / `family` / `species`) do NOT announce result counts or "filter applied" — there is no live-region feedback when a user selects "30 days" or "Notable only" beyond the row count silently changing; (2) view changes via SurfaceNav do not announce the new surface to SR users beyond `aria-selected` flipping on the tab. Both are gaps a redesign could close (a single `<div role="status" aria-live="polite">{ N observations after filter }</div>` near the filters bar, e.g.) but the redesign does NOT have to close them — they are preexisting, pre-redesign gaps. Mostly gap.

### Finding 8: axe coverage matrix — what is enforced today

- **Evidence:** `frontend/e2e/axe.spec.ts` enforces WCAG tags `wcag2a, wcag2aa, wcag21a, wcag21aa` (line 5) on:
  - initial load (line 8)
  - map view, desktop (line 33)
  - map view, mobile 390×844 (line 201)
  - species view + autocomplete OPEN, desktop (line 54)
  - species view + autocomplete OPEN, mobile (line 182)
  - error screen (line 72)
  - species detail surface, no photo, desktop (line 87)
  - species detail surface, no photo, mobile (line 140)
  - species detail surface WITH photo, desktop (line 115)
  - species detail surface WITH photo, mobile (line 161)
  - feed view (line 286)
  - attribution modal OPEN, desktop (line 314)
  - attribution modal OPEN, mobile (line 336)

  The eBird ToU §3 attribution-reachability suite (line 225–278) is structural, not WCAG, but lives alongside.
- **Confidence:** high.
- **Implication:** Every PR that breaks these scans is automatically blocked at the e2e CI gate (`test, lint, build, e2e` — Mergify required checks). The redesign's CI safety net is *strong* for the existing surface contracts; it will catch obvious regressions like "removed alt text on the photo" or "modal lost its aria-labelledby" automatically. It will NOT catch: cluster-bubble contrast (canvas excluded — Finding 5), motion not respecting reduced-motion (no axe rule for that), color-only conveyance (axe `color-contrast` is on but `use-of-color` is not a single rule — depends on context), focus order changes that are technically valid but worse UX. Both constraint (these scans must keep passing) and gap (the things it does not catch).

### Finding 9: Performance design surface — system fonts, eager photo, no animation, no icon library

- **Evidence:**
  - Web fonts: NONE. `styles.css:68` uses `-apple-system, BlinkMacSystemFont, "Helvetica Neue", Helvetica, sans-serif`. No `@font-face`, no `<link rel="preconnect">` to fonts.googleapis or similar in `frontend/index.html`. Phenology SVG `<text>` uses `font-family: inherit` (`styles.css:493, 502`) so the SVG picks up the system stack rather than the SVG default.
  - iNat photo: `SpeciesDetailSurface.tsx:63–71` renders `<img className="species-detail-photo" src={photoUrl} alt={...} onError={...}>`. **No `loading="lazy"`, no `srcset`, no `width`/`height` attributes, no blurhash placeholder.** CLS is mitigated by CSS only: `styles.css:430–437` uses `aspect-ratio: 4/3; object-fit: cover; max-width: 480px;` to reserve a stable 4:3 box before the image loads. Comment at `styles.css:425–429` explicitly cites CLS as the rationale.
  - MapLibre cluster expansion uses `easeTo` (`MapCanvas.tsx:729–732`) — animated camera. `react-map-gl` and `maplibre-gl` are by far the heaviest deps; basemap style is OpenFreeMap positron (HTTP cached on Cloudflare).
  - Icon library: NONE. The "!" notable badge is a literal character (`ObservationFeedRow.tsx:81`); the chevron in FamilyLegend is a unicode "▾" / "▸" (`FamilyLegend.tsx:177`); silhouettes are inline `<svg><path d=…>` from `family_silhouettes.svgData` (`FamilyLegend.tsx:60–71`, `SpeciesDetailSurface.tsx:81–95`). Zero font-icon, zero lucide-react / heroicons / phosphor.
  - Bundle: not measured here, but the absence of an icon library, font CSS, animation library, and CSS framework (no Tailwind, no styled-components — plain CSS with custom properties) means the design tokens budget is small and a redesign that adds any of those increases TTI / LCP measurably.
- **Confidence:** high (system-font + photo loading), medium (bundle size — un-measured).
- **Implication:** The design's *current* performance budget is generous BECAUSE the codebase has accepted a constraint of "no fonts, no animation, no icon library." A redesign that wants any of those must (a) self-host fonts with `font-display: swap` AND `<link rel="preload">`, (b) wrap motion in reduced-motion guards, (c) tree-shake icons (no full-library imports), (d) add `loading="lazy"` + `srcset` to the species-detail photo. The CSS aspect-ratio CLS mitigation is the model to copy: it's a 7-line solution that solves the problem completely and the comment explains why. Both constraint (today's budget is small) and gap (the photo lacks `loading="lazy"`/`srcset`).

### Finding 10: Map markers — keyboard/touch reachability is zoom-dependent and partial

- **Evidence:** Cluster circles (zoom < CLUSTER_MAX_ZOOM=14) are MapLibre `<Layer type="circle">` features — they have NO DOM, NO tabindex, NO keyboard handler. Click is via maplibre's event system (`MapCanvas.tsx:707–740` `handleMosaicClick`). Mosaic markers (small clusters, point_count ≤ 8) are HTML `<Marker>` elements at `MapCanvas.tsx:859–872` rendering `<MosaicMarker>` whose root is a `<button>` (`MosaicMarker.tsx:114` data-testid). Stacked spider leaves (zoom ≥ 14) are `<Marker><StackedSilhouetteMarker/></Marker>` (line 879–910) — also clickable. Hit-test layer for non-stacked individual obs at zoom ≥14 is `MapCanvas.tsx:761–776` → `MapMarkerHitLayer` per styles.css:870 comment ("popover is keyboard-reachable via the MapMarkerHitLayer (which gives every observation marker a real tabindex)").
- **Confidence:** medium (verified the layers, did not enumerate every marker's tabindex outright).
- **Implication:** A keyboard user on the map at default zoom CAN tab through small mosaic markers (≤8 obs) and the FamilyLegend, but CANNOT tab into a large cluster — they have to zoom in via the map's own controls (or the legend filter) until the cluster expands, then tab into individual leaves. The skip-link is the primary keyboard escape hatch. A redesign that changes the cluster threshold or adds new hover-only affordances must preserve this contract: every interactive marker class must have a DOM root with tabindex and a keyboard handler. Constraint.

### Finding 11: Touch-target / iOS HIG — 44px is the documented floor, 32px appears for chrome

- **Evidence:** `styles.css:135–137` ("Row min-height is 44px — iOS HIG tap-target minimum, also referenced in risk-viability.md Part 2.") on `.feed`. `styles.css:579–592` (`.attribution-trigger`) sets `min-height: 32px` ("32px min-height satisfies the iOS HIG tap target on mobile"). `.attribution-modal-close` has `min-height: 32px` (line 663). `.family-legend-entry` has `min-height: 32px` (line 819). `.feed-row` has `min-height: 44px` (line 179).
- **Confidence:** high (CSS values are explicit).
- **Implication:** Two sizes coexist: 44px for primary content rows, 32px for chrome. A redesign should NOT shrink primary-content rows below 44px (the documented commitment); chrome may stay at 32px BUT iOS HIG actually mandates 44pt — the codebase is taking a small risk on chrome targets that a redesign should at minimum NOT make worse. Constraint (44px for rows) and minor gap (32px chrome could be tightened-up to 44px under a redesign).

### Finding 12: Focus-visible styling is uniform — 2px outline, var(--color-text-strong), inset or 2px offset

- **Evidence:** Every interactive surface defines `:focus-visible`:
  - `.skip-link:focus-visible` → 2px outline `--color-text-strong`, offset 2px (styles.css:120–132).
  - `.feed-row:focus-visible` → 2px outline `--color-text-strong`, offset -2px (styles.css:194–197).
  - `.species-autocomplete-input:focus-visible` → identical, -2px offset (styles.css:300–303).
  - `.surface-nav-tab:focus-visible` → +2px offset (styles.css:398–401).
  - `.attribution-trigger:focus-visible`, `.attribution-modal-close:focus-visible` (styles.css:597–600, 668–671).
  - `.family-legend-toggle:focus-visible`, `.family-legend-entry:focus-visible` (styles.css:777–780, 824–827).

  Outline color is always `--color-text-strong` (`#1a1a1a`), which contrasts against every defined background token. The radio/checkbox inputs in FiltersBar and FeedSurface use `accent-color: var(--color-text-strong)` (styles.css:166) so the browser's native focus indicator inherits the same accent.
- **Confidence:** high.
- **Implication:** A redesign that introduces a new accent color (especially a brand-color override of `--color-text-strong`) MUST keep the focus outline contrast at 3:1 against EVERY surface the focused element can sit on. Today's all-`#1a1a1a`-on-everything is the simplest possible focus story; a redesign that breaks it (e.g. white-text-on-dark-button with white outline) regresses WCAG 2.4.7. Constraint.

### Finding 13: Filter inputs — `<select>`s and `<datalist>` are native, no custom dropdown

- **Evidence:** `FiltersBar.tsx:64–123` — every filter is a native form control: `<select>` for time-window, `<select>` for family, `<input type="checkbox">` for notable, `<input type="search" list="species-options">` + `<datalist>` for species. Each carries `aria-label`. The `<input type="search">` autocomplete is browser-native: typing "e" pops the OS's `<datalist>` UI (see `tmp/redesign-analysis/screenshots/local/mobile/01-map-default.png` showing the input).
- **Confidence:** high.
- **Implication:** The filters surface is performant (zero JS for the dropdown UI), accessible by default, but visually constrained — `<select>` styling is OS-locked beyond a small set of properties. A redesign that wants custom-styled dropdowns trades native a11y + perf for a custom WAI-ARIA combobox/listbox implementation (which `SpeciesAutocomplete.tsx` shows the pattern for, but at the cost of ~340 lines of code per surface). The species autocomplete on the species view (`SpeciesAutocomplete.tsx:273–347`) IS a custom combobox — `role="combobox"`, `aria-autocomplete="list"`, `aria-expanded`, `aria-controls`, `aria-activedescendant`, listbox with `role="option"`, group headers as `role="presentation"` siblings, "no matches" as `role="status" aria-live="polite"`. So the codebase has both patterns. Constraint (don't drop ARIA on the species combobox), trade-off (filters bar can be customized but at a cost).

## Surprises

- **Cluster bubble colors are unaudited for contrast.** Despite the codebase's otherwise meticulous inline contrast comments (every `#hex` on `#fff` carries a measured ratio), the `#51bbd6 / #f1f075 / #f28cb1` cluster fills with `#1a1a1a` text in `observation-layers.ts` carry NO comment about contrast and are not measurable by axe (canvas excluded). They happen to pass AA on inspection, but they were chosen visually, not arithmetically.
- **The skip-link only exists on the map view.** Other surfaces rely on `<main tabIndex={0}>` being a focus + scroll target. This is a deliberate architectural decision (map canvas not in tab order, list-surface scroll-region focusability) but a designer may not realize it.
- **Zero motion CSS today.** The `duration` tokens in `tokens.ts` are reserved-but-unused. A reader of the file might assume there is a motion language; there isn't one.
- **`aria-busy` is gated to feed + species views only.** Map + detail loading do NOT toggle `aria-busy` on `<main>`; they rely on per-component `role="status"` instead. Slight inconsistency.
- **No `loading="lazy"` on the species-detail photo.** The CSS `aspect-ratio` CLS mitigation is impressive; the missing `loading="lazy"` is a 1-attribute fix that has not been made. Easy gap.
- **`accent-color: var(--color-text-strong)`** is set only on `.feed-sort-option input[type="radio"]` (styles.css:166), not on FiltersBar's checkbox or other native controls. Inconsistent accent.

## Unknowns & Gaps

- **Bundle size today** (current production JS payload, biggest single chunk, etc.) — not measured here. Worth a `npm run build` and a `du -sh frontend/dist` before the redesign starts so any regression is observable.
- **Does MapLibre `easeTo` honor `prefers-reduced-motion`?** Not verified — the call site at `MapCanvas.tsx:729` does not pass duration:0 or any reduced-motion guard. Likely a real motion-leak today even though no CSS motion exists.
- **Touch target audit** for sub-44px chrome elements (the 32px `attribution-trigger`, modal close, legend entries) — not enforced by axe; would need manual touch-target.spec.ts or a dedicated tool.
- **Family-color palette contrast** against the basemap tile mid-grey was not arithmetically measured here; the silhouettes are visible against the OpenFreeMap positron tiles but the worst-case (a silhouette in a desert-tan over a desert-tan map region) was not quantified. Probably fine; not certain.
- **Screen reader narrative on filter changes / view changes** — not covered by axe (axe checks structure, not behavior over time). Manual NVDA / VoiceOver pass would be the only way to know if "30 days" announces "showing N more observations" or just silently re-renders.

## Raw Evidence

- Read: `frontend/src/App.tsx`, `frontend/src/components/SurfaceNav.tsx`, `frontend/src/components/FiltersBar.tsx`, `frontend/src/components/AttributionModal.tsx`, `frontend/src/components/FamilyLegend.tsx`, `frontend/src/components/FeedSurface.tsx`, `frontend/src/components/SpeciesDetailSurface.tsx`, `frontend/src/components/ObservationFeedRow.tsx`, `frontend/src/components/MapSurface.tsx` (lines 120–180), `frontend/src/components/map/MapCanvas.tsx` (lines 700–910), `frontend/src/components/map/observation-layers.ts` (lines 150–240), `frontend/src/styles.css`, `frontend/src/tokens.ts`, `frontend/playwright.config.ts`, `frontend/e2e/axe.spec.ts`.
- grep: `prefers-reduced-motion` (zero hits); `transition\|animation\|@keyframes` in styles.css (zero hits); `aria-live\|role="status"\|role="alert"` across components (enumerated above); `loading="lazy"\|srcset\|@font-face` (zero hits in src + index.html); `axe` in e2e (axe.spec.ts is the entire suite).
- Captures viewed: `tmp/redesign-analysis/screenshots/local/desktop/01-map-default.png` (cluster pink/yellow/blue bubbles confirmed; legend visible bottom-left), `local/desktop/04-species-detail.png` (photo + phenology chart layout confirmed), `local/desktop/05-attribution-modal.png` (modal layout + Phylopic list scrolling confirmed), `local/mobile/01-map-default.png` (mobile filters stacking + legend expanded confirmed).
