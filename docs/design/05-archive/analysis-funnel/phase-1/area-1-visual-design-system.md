# Investigation: Visual Design System & Token Inventory

## Summary

The bird-maps.com frontend has a two-layer design token architecture: a TypeScript constants file (`tokens.ts`) for numeric/structural values consumed in JSX and SVG, plus a mirrored set of CSS custom properties declared in the `:root` block of a single global stylesheet (`styles.css`). Color tokens are meaningfully semantic (background, text, border, accent, error roles) and cover the warm-cream palette the app projects visually. The type system is entirely ad-hoc: one font stack declared at the body level, six distinct font-size values hardcoded as px literals throughout the stylesheet (11-20px), no named scale, no line-height discipline. Spacing exists as a named token scale (xs/sm/md/lg/xl at 4/8/12/16/24px) but border-radius values are hardcoded at seven distinct literals (2/4/6/8/10/50%/999px). There is no design-system package, no Storybook, no primitives layer, no dark-mode scaffolding, and no prefers-reduced-motion handling anywhere in the stylesheet. Component styling is entirely vanilla CSS in one monolithic file; no CSS modules, no CSS-in-JS, no component-local stylesheets.

## Key Findings

### Finding 1: Two-layer token architecture exists but has significant gaps

- **Evidence:** `frontend/src/tokens.ts:1-16` (file-header comment explicitly names the two-layer contract: "JSX attribute to import from tokens.ts; CSS rule to reference matching `--token-name` in styles.css"). The `:root` block in `styles.css:1-63` mirrors a subset of `tokens.ts` values. The comment at `styles.css:1-3` warns "Mirrors the subset of tokens.ts that CSS rules consume. Update both sides together — tokens.test.ts only covers tokens.ts scales."
- **Confidence:** high — the rule is explicitly documented and the two files are directly inspectable.
- **Implication:** A redesign must maintain both files in sync for any token it changes. The sync is manual, not automated; there is no generated bridge. The most dangerous gap: `tokens.ts` exports a `color.palette` object (`tokens.ts:124-158`) containing 7 ecoregion hex colors and 2 map-specific colors, but NONE of these appear in the CSS `:root` block — they are DB-sync-only comments or map-internal values, leaving the ecoregion palette entirely outside the CSS token surface. A designer cannot re-skin the map markers via CSS custom properties alone.

### Finding 2: Color system is semantically organized but warm-monochrome only

- **Evidence:** `styles.css:24-62` defines 20 named color custom properties in five semantic groups: Backgrounds (6 tokens), Notable/amber accent (3), Borders (2), Text/grey scale (8), Error (3). No brand-primary, brand-secondary, or interactive-blue token exists. The page background (`--color-bg-page: #f4f1ea`) is a warm cream; surfaces are white (`--color-bg-surface: #fff`). The accent color used for the "Notable" sighting treatment is dark amber (`--color-accent-notable-fg: #b8860b`); this is the only non-neutral accent in the entire CSS palette. Family silhouette colors (the colored bird icons in the FamilyLegend and map markers) come from the database via `/api/silhouettes` at runtime and are NOT in the CSS custom property surface at all — they are stored on `FamilySilhouette.color` (a raw hex string from the DB) and applied directly as SVG `fill` values or MapLibre paint properties.
- **Confidence:** high — complete enumeration of the `:root` block is possible from the file.
- **Implication:** The site visually has two parallel color systems: (a) the CSS token palette (warm neutrals + amber accent) used in chrome, surfaces, and type; and (b) the DB-sourced family palette (8 earth tones from `tokens.ts:132-157`) used in the map and legend. A redesign touching brand color must address both systems separately. The CSS token side is relatively easy to re-skin; the DB-sourced family palette requires coordinated data changes plus CSS.

### Finding 3: Type system is entirely ad-hoc — no scale, no named tokens

- **Evidence:** `styles.css:68` declares the only font stack: `-apple-system, BlinkMacSystemFont, "Helvetica Neue", Helvetica, sans-serif` — system UI fonts, no webfont loaded. Font sizes are hardcoded px literals with no custom property or named token: 11px (`styles.css:842, 904`), 12px (8 occurrences: lines 219, 262, 571, 587, 714, 786, 815, 924, 935), 13px (15 occurrences including `styles.css:371` inline), 14px (7 occurrences), 15px (line 293 — species autocomplete input only), 18px (lines 649, 912 — modal heading), 20px (line 444 — species common name). Font weights appear as literals: 600 for row names and legend titles, 700 for badges, modal headings, and species common name. Line-height appears only 4 times explicitly: 1 (badge, `styles.css:221`), 1.2 (tab, `styles.css:395`), 1.3 (autocomplete option, `styles.css:335`), 1.4 (modal body, `styles.css:684`). No line-height token exists in either file.
- **Confidence:** high — exhaustive grep of font-size and font-weight in styles.css.
- **Implication:** A redesign that introduces a web font or a different type scale has no named scale to replace — it must audit all 35+ hardcoded font-size usages individually. There is no `--font-size-sm` / `--font-size-base` abstraction layer to swap. The system UI font stack is zero-load-cost but produces visually different results across macOS/iOS (San Francisco), Windows (Segoe UI), Android (Roboto), and Linux (Liberation Sans) — the site has no cross-platform type consistency guarantee today.

### Finding 4: Spacing scale exists as tokens but border-radius and shadows do NOT

- **Evidence:** `tokens.ts:102-113` and `styles.css:12-17` define a 5-step spacing scale: xs=4px, sm=8px, md=12px, lg=16px, xl=24px. These are used throughout the stylesheet via `var(--space-xs)` etc. However, border-radius values are hardcoded literals at 9 distinct values: 2px (`styles.css:694`), 4px (9 occurrences including lines 131, 389, 436, 524, 590, 657, 812), 6px (lines 295, 316, 349, 753, 772, 878), 8px (lines 619, 846), 10px (`styles.css:240`), 50% (`styles.css:216` for the circular badge), 999px (`styles.css:898` for the popover badge pill). Shadows are declared as 3 named custom properties (`--shadow-panel`, `--shadow-listbox`, `--shadow-drawer` at `styles.css:20-22`) but these compose from a single `--opacity-subtle` token; the shadow geometry (blur=12px, offset) is hardcoded inline. The `.attribution-modal` uses a fourth shadow not in the named set: `0 12px 40px rgba(0, 0, 0, var(--opacity-hover))` at `styles.css:628` — a one-off.
- **Confidence:** high — full enumeration from stylesheet.
- **Implication:** A redesign that establishes a shape language (e.g., "everything is 6px rounded") must find and replace many independent border-radius literals. The absence of a radius token means corners are currently inconsistent: chip uses 10px, panel uses 6px, badge uses 50%/999px, photo uses 4px, modal uses 8px. This mix is visible in the screenshots — compare the feed count chip (10px pill) against the tab (4px), the autocomplete listbox (6px), and the modal (8px).

### Finding 5: Component styling is vanilla CSS in one monolithic file — zero component isolation

- **Evidence:** There is exactly ONE CSS file in the frontend: `/Users/j/repos/bird-watch/frontend/src/styles.css` (945 lines). `find /Users/j/repos/bird-watch/frontend/src -name "*.css"` returns only this file. No CSS modules (`.module.css`), no CSS-in-JS imports, no Tailwind utility classes, no `@layer`. All component styles use flat BEM-like class names (`feed-row`, `feed-row-notable`, `surface-nav-tab`, `family-legend-entry`) declared in this one file. Component `.tsx` files reference these via `className="..."` strings only — no local style import. Inline styles appear in 2 specific places: `MapSurface.tsx:153-160` (loading skeleton `background: '#f4f1ea'` — a hardcoded hex that duplicates `--color-bg-page`) and `MapCanvas.tsx:793` (canvas `width/height: '100%'`).
- **Confidence:** high — exhaustive file scan.
- **Implication:** A redesign can replace `styles.css` wholesale without touching component `.tsx` files as long as all existing class names are preserved. This is a significant advantage for a CSS-only redesign. The monolithic file is also a technical debt surface: adding a new component requires editing a shared 945-line file. The inline `'#f4f1ea'` in `MapSurface.tsx:159` is a known inconsistency — the loading skeleton background is hardcoded rather than referencing the CSS token, and will not respond to palette changes made via CSS custom properties alone.

### Finding 6: Naming convention is flat semantic BEM-ish — consistent throughout

- **Evidence:** Class names follow a `component-element` or `component-element--modifier` pattern without the double-underscore BEM separator: `.feed-row`, `.feed-row-notable`, `.feed-row-badge`, `.feed-row-name`, `.feed-row-count`, `.surface-nav-tab`, `.surface-nav-tab.is-active`, `.family-legend-entry.is-active`, `.species-autocomplete-option.is-highlighted`. State modifiers use `.is-{state}` (`.is-active`, `.is-highlighted`) rather than BEM `--modifier`. This is consistent throughout the file.
- **Confidence:** high — pattern is uniform across the 945-line file.
- **Implication:** The naming convention is readable and designer-friendly. A redesign can add variant classes (e.g., `.feed-row-notable--urgent`) without breaking existing selectors. The `.is-active` / `.is-highlighted` modifier pattern is easy to document and extend.

### Finding 7: No dark-mode scaffolding, no prefers-reduced-motion, single responsive breakpoint

- **Evidence:** `grep "@media|prefers-color-scheme|prefers-reduced-motion" styles.css` returns only two `@media (max-width: 760px)` blocks (lines 731 and 858) and zero `prefers-color-scheme` or `prefers-reduced-motion` queries. The 760px breakpoint is the project's ONLY responsive breakpoint and is documented as such in the comment at `styles.css:537-543`. Duration tokens exist (`--dur-fast: 200ms`, `--dur-base: 250ms`, `--dur-slow: 350ms` at `styles.css:18-20`) but no rule wraps them in a `prefers-reduced-motion: reduce` override.
- **Confidence:** high — exhaustive grep confirmed no additional media queries.
- **Implication:** Dark mode is entirely absent — not even a commented-out scaffold. A redesign adding dark mode would need to either (a) add a `@media (prefers-color-scheme: dark)` block overriding all 20 color tokens at `:root`, or (b) introduce a `.dark` class on `<html>`. No existing hook for this exists. The single breakpoint means the design currently has only two layout states (mobile at or below 760px, desktop above 760px); any additional breakpoint requires new CSS additions.

### Finding 8: Design system maturity — informally structured, no package or tooling layer

- **Evidence:** `frontend/package.json` shows zero design-system dependencies: no `@bird-watch/design-system`, no Storybook, no Radix UI, no headlessui. The token architecture (two-file sync with manual maintenance) is documented via code comments rather than enforced by tooling. The `tokens.test.ts` referenced in `tokens.ts:14` asserts monotonicity of scales but does not validate CSS custom property presence or naming alignment. There is no primitives layer (no `<Button>`, `<Input>`, `<Card>` base components) — every interactive element is a raw `<button>` or `<input>` styled via flat CSS classes.
- **Evidence (screenshots):** The FiltersBar (`local/desktop/02-feed.png`) uses native `<select>` and `<input>` elements with default browser chrome alongside the custom dark-fill SurfaceNav tabs. These two chrome bars read as coming from different visual systems — the FiltersBar is browser-default, the SurfaceNav is custom-designed.
- **Confidence:** high — package.json inspection is definitive; visual reading confirmed by screenshots.
- **Implication:** A redesign has maximum freedom — there is no upstream design system to conform to. But it also has no reusable primitives to build on. Any new component library or design system introduced by the redesign starts from scratch.

## Surface x Viewport Coverage

### Map surface — desktop (1440x900)
Screenshot: `local/desktop/01-map-default.png`, `local/desktop/06-map-notable-30d.png`

The map chrome (FiltersBar + SurfaceNav) sits on a white `--color-bg-surface` band. The map canvas is the OpenFreeMap "positron" basemap — a light grey/white tile style. Cluster circles are multi-colored (family colors from DB: pinks, yellows, blues, teals visible). The FamilyLegend is expanded and floats bottom-left, using `--color-bg-surface` (white), 6px radius, `--shadow-listbox`. Legend silhouette glyphs are 28px SVGs colored with DB family colors. The active tab ("Map") has the full black fill + white text treatment. FiltersBar uses native browser form controls on a single row — no custom styling visible beyond the label/gap spacing.

### Map surface — mobile (390x844)
Screenshot: `local/mobile/01-map-default.png`

FiltersBar wraps to three rows (Time window + Notable only on row 1; Family on row 2; Species on row 3) because of `flex-wrap: wrap` at `styles.css:369`. FamilyLegend is collapsed by default on mobile via the 760px CSS + JS breakpoint. When expanded (visible in the screenshot), the legend occupies approximately the bottom third of the visible map area, obscuring markers behind it.

### Feed surface — desktop (1440x900)
Screenshot: `local/desktop/02-feed.png`

Rows are white (`--color-bg-surface`), centered max-width 760px, on warm cream (`--color-bg-page`). The two-column layout (species name left, location + time right) is visually clear. Count chips have `--color-bg-tint: #f0ebe0` background, 10px radius. Text hierarchy: species name 14px weight-600, location 13px (`--color-text-muted`), time 12px (`--color-text-subtle`).

### Feed surface — mobile (390x844)
Screenshot: `local/mobile/02-feed.png`

Critical styling issue confirmed visually: species names are NOT visible in the mobile screenshot. Only count chips, location text (truncated to "..."), and timestamps are visible. The flex layout's priorities mean `.feed-row-name` (flex:1, overflow:hidden) is crowded out by the location string on 390px. The primary information signal — the bird species name — is hidden or severely truncated on mobile's most-used view.

### Species surface — desktop (1440x900)
Screenshot: `local/desktop/03-species-search.png`

Large empty-state: the autocomplete input is centered at max-width on warm cream. The input has white fill, 6px radius, 1px border. The page is predominantly empty with only the prompt text in `--color-text-muted` below the input. Visually very sparse — no illustration, no entry-state guidance beyond text.

### Species surface — mobile (390x844)
Screenshot: `local/mobile/03-species-search.png`

Same as desktop proportionally. The FiltersBar on mobile takes approximately 135px of vertical chrome above the SurfaceNav; the actual content surface begins at roughly 40% of the viewport height. The sparse empty state is proportionally even larger.

### Species Detail surface — desktop (1440x900)
Screenshot: `local/desktop/04-species-detail.png`

The iNaturalist photo renders at full container width capped at 480px, aspect-ratio 4:3, 4px border-radius. Below: common name (20px, weight 700), scientific name italic (14px, `--color-text-muted`), family name (13px, `--color-text-body`). The phenology chart SVG renders below at max-width 432px. The Wikipedia description body is rendered into `.species-detail-description` — this CSS class has NO rules in `styles.css` (confirmed by grep). The description's HTML inherits only body styles with no scoping, meaning browser-default link colors (blue) rather than `--color-text-strong` will appear on Wikipedia anchor tags in the description.

### Species Detail surface — mobile (390x844)
Screenshot: `local/mobile/04-species-detail.png`

The photo fills the full 390px content width. Text hierarchy below is readable. The phenology chart is proportionally wide and legible. The FiltersBar still consumes 3 rows above the SurfaceNav on this view too.

### AttributionModal — desktop (1440x900)
Screenshot: `local/desktop/05-attribution-modal.png`

Modal at max-width 560px, centered, 8px radius, white background, 1px border. The Phylopic per-silhouette list is dense (12px font, 4px vertical gap per row). Modal header "Credits" is 18px weight-700; section headings are 14px weight-700. Backdrop is `rgba(0,0,0,0.45)`.

### AttributionModal — mobile (390x844)
Screenshot: `local/mobile/05-attribution-modal.png`

Modal goes to `calc(100vw - 2 * var(--space-md))` wide. The list is legible and scrollable. The "Close" button is in the upper-right of the modal header.

## Surprises

- The `SpeciesDescription` component (`SpeciesDescription.tsx:62`) uses two CSS classes — `.species-detail-description` and `.species-detail-description-credit` — that have zero corresponding rules in `styles.css`. This means the Wikipedia description body renders with zero scoping, inheriting only body-level browser defaults. Wikipedia content includes arbitrary paragraph and inline-markup structure; without scoped CSS it produces inconsistent typographic rhythm and unexpected link colors (browser-default blue, not `--color-text-strong`).

- The map loading skeleton in `MapSurface.tsx:159` hardcodes `background: '#f4f1ea'` as an inline React style rather than referencing the CSS custom property `--color-bg-page`. This one-off inconsistency will not respond to a palette re-skin via CSS alone.

- The `observation-layers.ts` file implements a `readToken()` function (`observation-layers.ts:136-141`) that reads CSS custom properties at runtime via `getComputedStyle` and passes the resolved value to MapLibre paint specs. This bridges 2 CSS tokens into the map layer system (notable ring color, cluster count text color). However, family colors remain DB-sourced and outside this bridge entirely.

- The FiltersBar mobile layout consumes approximately 135px of vertical space (3 rows) above the SurfaceNav's ~40px, eating 21% of the mobile viewport before any content surface begins.

- On the Feed surface mobile screenshot, species common names are not visible. The flex layout gives location text priority over the species name, which is the primary data signal on this view. This is a structural styling issue observable directly in `local/mobile/02-feed.png`.

## Unknowns & Gaps

- The Wikipedia description body HTML structure (tags, classes, nesting produced by `services/ingestor/src/wikipedia/sanitize.ts`) is not inventoried here. Without the sanitizer's allowlist output, the missing `.species-detail-description` CSS rules cannot be fully specified.

- The family silhouette color values (8 ecoregion earth tones in `tokens.ts:132-157`) are described as "DB-sync-only" and may differ from the DB-seeded values. The CSS custom property surface does not expose these values. A designer needs a live `/api/silhouettes` response to audit the actual rendered family palette.

- The `ObservationPopover` CSS is defined in `styles.css:867-946` but no screenshot captures it in the open state. Its visual treatment (white card, 6px radius, shadow-listbox) is readable from CSS but not visually confirmed.

- The FiltersBar uses a native `<input type="search" list="species-options">` with `<datalist>` (`FiltersBar.tsx:101-122`) — entirely browser-styled. The SpeciesSearchSurface uses `<SpeciesAutocomplete>` with a custom-styled listbox (`styles.css:307-352`). These are two different implementations for what appears to the user as the same interaction pattern. A redesign should rationalize these into one approach.

- Duration tokens (`--dur-fast`, `--dur-base`, `--dur-slow`) exist in both `tokens.ts` and `styles.css` but no CSS `transition` or `animation` rule in `styles.css` actually references them. Whether this is intentional (no transitions by design) or an incomplete implementation cannot be confirmed from the code alone.

## Raw Evidence

Files read in full:
- `/Users/j/repos/bird-watch/tmp/redesign-analysis/funnel/context-packets/phase-0-packet.md`
- `/Users/j/repos/bird-watch/tmp/redesign-analysis/funnel/phase-0/analysis-brief.md`
- `/Users/j/repos/bird-watch/frontend/src/tokens.ts` (166 lines)
- `/Users/j/repos/bird-watch/frontend/src/styles.css` (945 lines)
- `/Users/j/repos/bird-watch/frontend/src/components/FiltersBar.tsx`
- `/Users/j/repos/bird-watch/frontend/src/components/SurfaceNav.tsx`
- `/Users/j/repos/bird-watch/frontend/src/components/FeedSurface.tsx`
- `/Users/j/repos/bird-watch/frontend/src/components/ObservationFeedRow.tsx`
- `/Users/j/repos/bird-watch/frontend/src/components/MapSurface.tsx`
- `/Users/j/repos/bird-watch/frontend/src/components/SpeciesDetailSurface.tsx`
- `/Users/j/repos/bird-watch/frontend/src/components/SpeciesSearchSurface.tsx`
- `/Users/j/repos/bird-watch/frontend/src/components/SpeciesDescription.tsx`
- `/Users/j/repos/bird-watch/frontend/src/components/AttributionModal.tsx`
- `/Users/j/repos/bird-watch/frontend/src/components/FamilyLegend.tsx`
- `/Users/j/repos/bird-watch/frontend/src/components/PhenologyChart.tsx`
- `/Users/j/repos/bird-watch/frontend/src/components/map/basemap-style.ts`
- `/Users/j/repos/bird-watch/frontend/src/components/map/observation-layers.ts` (partial)
- `/Users/j/repos/bird-watch/frontend/src/data/family-color.ts` (partial)
- `/Users/j/repos/bird-watch/frontend/src/App.tsx` (260 lines)
- `/Users/j/repos/bird-watch/frontend/package.json`

Screenshots read (all 8 surface x viewport cells covered):
- `local/desktop/01-map-default.png` — map desktop
- `local/mobile/01-map-default.png` — map mobile
- `local/desktop/02-feed.png` — feed desktop
- `local/mobile/02-feed.png` — feed mobile (species-name truncation confirmed visually)
- `local/desktop/03-species-search.png` — species desktop
- `local/mobile/03-species-search.png` — species mobile
- `local/desktop/04-species-detail.png` — detail desktop
- `local/mobile/04-species-detail.png` — detail mobile
- `local/desktop/04-species-detail-fullpage.png` — detail desktop full-page
- `local/desktop/05-attribution-modal.png` — modal desktop
- `local/mobile/05-attribution-modal.png` — modal mobile
- `local/desktop/06-map-notable-30d.png` — map notable filter desktop

Shell commands run:
- `find frontend/src -name "*.css"` — confirmed single stylesheet
- `grep -n "font-size" styles.css | sort` — enumerated 7 distinct font sizes
- `grep -n "border-radius" styles.css` — enumerated 9 distinct radius values
- `grep -n "@media|prefers-color-scheme|prefers-reduced-motion" styles.css` — confirmed no dark-mode or motion queries
- `grep -rn "style={{" components/` — located inline style usages
- `grep -n "species-detail-description" styles.css` — confirmed missing CSS class rules
- `cat frontend/package.json` — confirmed no design system or component library dependencies
- `grep -n "FAMILY_COLOR_FALLBACK" frontend/src/data/family-color.ts` — confirmed DB-source fallback color value
