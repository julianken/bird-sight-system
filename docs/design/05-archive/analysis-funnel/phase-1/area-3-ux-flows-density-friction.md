# Investigation: UX Flows, Density, and Friction (Mobile + Desktop)

## Summary

The site's four surfaces (map, feed, species, detail) share a persistent chrome of FiltersBar + SurfaceNav that consumes a disproportionate fraction of mobile viewport height, reducing the first-paint content area to roughly 55% of the 844px screen. The default landing surface is the map, which on mobile is substantially obstructed by the FamilyLegend overlay when expanded, rendering between a third and a half of the visible map area inaccessible to taps. The FiltersBar exposes four independent filter controls (time window, notable, family, species) in two rows on mobile, creating a high decision-surface-to-content ratio on first load. The feed and species-detail surfaces are individually well-structured but exhibit location-name truncation and species-name invisibility on mobile that impair core use-cases. The attribution flow works correctly but the "Credits" trigger is visually subordinated to the point of near-invisibility; no surface communicates what the site is before the user interacts with it.

---

## Flow 1: Cold Open — "What's here right now?" (/?view=map default)

### Desktop (1440×900) — local/desktop/01-map-default.png

**Time-to-value:** The map is visible immediately on load; the Arizona-centered base map with colored cluster circles renders in the first paint frame once data arrives. The FamilyLegend is expanded by default (MapSurface.tsx:22–31: `LEGEND_EXPAND_MIN_WIDTH = 760px`; desktop is well above it). Within 2 seconds the user sees: the Arizona map with 9 colored cluster bubbles, the FamilyLegend listing ~9 family rows in the bottom-left, and the FiltersBar + SurfaceNav chrome above.

**Information density:** The desktop map view achieves appropriate density for the surface type. Cluster bubbles vary in size (755 largest, 17 smallest visible) and are colored by family. The FamilyLegend overlay is visually distinct and readable. The FiltersBar is a single horizontal row (Time window | Notable | Family | Species) that reads clearly at this viewport.

**Visual hierarchy:** Four competing attention zones simultaneously: (1) the large pink cluster (755) in central Arizona dominates by size, (2) the FamilyLegend panel in the lower-left draws the eye via its white card on map background, (3) the FiltersBar/SurfaceNav chrome commands the top strip, (4) an observation popover (if open) anchors top-left of the map surface (styles.css:876). There is no clear visual "start here" cue — the map is all data, no narrative. The page title "bird-watch — Arizona" is only visible in browser chrome.

**FiltersBar cognitive load:** 4 controls, all visible, all default values (14d / Notable unchecked / All families / empty species). 3 decisions possible before any content changes. The filter labels ("Time window", "Notable only", "Family", "Species") are minimally legible at 13px (styles.css:371) and carry no placeholder state indicating what the defaults mean in human terms ("Last 14 days, showing all families").

**Desktop-specific friction:** The FamilyLegend max-width is 240px (styles.css:758), positioning in the bottom-left where it competes with the MapLibre AttributionControl text at bottom-right. The main content area has 16px padding on all sides (`#main-surface { padding: var(--space-lg) }`, styles.css:86) — on the map view this padding is cosmetically wasteful since the map canvas should fill the surface edge-to-edge; the padding creates visible gutters around the map that reduce the effective map area without providing any compositional benefit. The FamilyLegend must be scrolled internally (max-height: 400px, styles.css:797) when families exceed that height — no scroll indicator is visible.

**State coverage:** No loading state is observable in captures (data arrived before screenshot). Error state exists at App.tsx:143–150 as a `.error-screen` centered div — confirmed by local console log showing API 404 errors, yet the local screenshot shows the prod data (captures must have hit prod API). No "last updated" or data-freshness signal is anywhere visible. The local console log (console-map-desktop.log:4) shows `ERR_CONNECTION_REFUSED` for all API calls on local, confirming the error-screen would render if data failed — but no error-screen capture exists, so error UX is blind.

### Mobile (390×844) — local/mobile/01-map-default.png, prod/mobile/01-map-default.png

**Time-to-value:** The map with clusters is visible. However, the FamilyLegend is expanded by default on mobile (visible in both local and prod 01-map-default.png captures), contradicting the code intent. The code at MapSurface.tsx:22–31 sets `LEGEND_EXPAND_MIN_WIDTH = 760` and `readLegendDefaultExpanded()` returns `false` for viewports below 760px — but both captures show the legend expanded on first load. This is a code/behavior discrepancy requiring investigation: either localStorage from a prior session is persisting, or the matchMedia logic is not firing correctly in the capture environment. **Regardless of root cause, the expanded legend on mobile is the dominant friction.**

**FamilyLegend overlap on mobile:** The legend panel in the mobile capture spans from roughly y=495 to y=770 (out of 842px viewport, below the chrome). The map visible below the SurfaceNav is approximately y=180 to y=842 (height ~660px). The legend thus covers approximately the bottom 40% of the visible map area, from y=495 downward. In the local/mobile/01-map-default.png capture, the legend shows 6 visible family rows (Cardinals & Allies 383, Crows Jays & Magpies 267, Cuckoos & Roadrunners 41, Ducks Geese & Swans 704, Finches 197, Hawks Eagles & Kites 390) before being cut off. The map clusters behind the legend are partially or fully obscured. No map cluster can be tapped through the legend overlay.

**Chrome height on mobile:** The FiltersBar renders in 2 rows on mobile (visible in 01-map-default.png): row 1 is "Time window [14 days] [Notable only]" and row 2 is "Family [All families] / Species [Common name]". Total FiltersBar height is approximately 130px. SurfaceNav adds approximately 44px. Combined chrome consumes roughly 174px of the 844px total (21%), leaving 670px for content — but the map's usable tap area is further reduced by the legend.

**FiltersBar on mobile:** `flex-wrap: wrap` (styles.css:369) causes the 4-control bar to wrap to 2 rows. This is functional but adds height cost. The "Notable only" checkbox label is 13px with a small checkbox — marginal tap-target size. No responsive resizing of individual controls occurs.

**Thumb-reach considerations:** The FamilyLegend toggle button ("Bird families in view ▾") is at approximately y=495 in the mobile capture — within comfortable one-handed thumb reach for a right-handed user (bottom quarter of screen). The actual map clusters (the primary data surface) are in the center of the screen, also thumb-reachable. The SurfaceNav tabs (Feed, Species, Map) are approximately y=155, within the top-third — harder to reach one-handed.

---

## Flow 2: "Show me only notable birds in the last 30 days"

### Desktop — local/desktop/06-map-notable-30d.png

**Time-to-value:** After selecting "30 days" from the time window dropdown and checking "Notable only", the map re-renders with sparser clusters. The 06-map-notable-30d.png capture shows dramatically fewer and smaller clusters than 01-map-default.png — most clusters are small individual-bird markers (no large aggregation bubbles). The FamilyLegend updates to reflect the filtered set.

**Interaction path:** The user must (1) locate "Time window" label in the FiltersBar, (2) open the select dropdown, (3) choose "30 days", (4) find the "Notable only" checkbox, (5) click it. Two separate controls, no single "notable + 30d" preset. The select and checkbox are not visually grouped as a related pair — they sit in horizontal sequence without separator. No "active filters" summary or badge count informs the user that filters are applied.

**Filter confirmation feedback:** After applying filters, there is no visual confirmation beyond the map re-rendering. The FiltersBar controls reflect their new values (30d selected, checkbox checked), but the map rendering is the only signal that something changed. On a slow connection, the map would appear unchanged while data fetches — there is no loading indicator specific to filter application. The `data-render-complete` attribute on `#main-surface` (App.tsx:172) is for e2e testing only, not user-visible.

**Notable filter on mobile (inferred from source, no mobile capture for 06):** The notable checkbox is the second item in FiltersBar row 1 on mobile. Its tap target is the inline checkbox + "Notable only" label text. The label has `gap: 6px` between checkbox and text (FiltersBar.tsx:80–88, styles.css:371). The checkbox input itself is browser-default size (~16–18px) — borderline for the iOS HIG 44pt tap target minimum (the label wrapper extends the tap area, but the hit region is not explicitly sized). No mobile-specific sizing is applied.

### Mobile (inferred — no dedicated mobile notable capture)

The mobile filter flow requires the user to: navigate to the top FiltersBar (row 1 visible), interact with the "Time window" select (opens a native system picker — full-width on iOS), then tap the "Notable only" checkbox (row 1, inline). The Family dropdown (row 2) is a second native select. All four FiltersBar controls require individual taps with no batch-apply or confirm. On mobile the FiltersBar has `flex-wrap: wrap` (styles.css:369) so both rows are always visible — an advantage for discoverability but the 2-row chrome is always present regardless of surface.

---

## Flow 3: "Tell me about a specific bird I'm seeing" (Feed → Species Detail)

### Desktop — local/desktop/02-feed.png → local/desktop/04-species-detail.png

**Feed surface time-to-value:** The feed (02-feed.png) renders immediately with bold species names in the leftmost column position, location strings in the middle, and relative timestamps at right. The "Belted Kingfisher" first entry has no count chip (solo sighting), so the name takes more horizontal space. The information hierarchy is: species name (bold, 14px, --color-text-strong) > count chip (optional, muted bg) > location (muted, 13px) > timestamp (subtle, 12px). This ordering matches natural reading priority.

**Feed density on desktop:** The desktop feed shows ~16 rows visible without scrolling in a 1440×900 viewport. Feed is capped at max-width 760px (styles.css:144) and centered — meaning 340px on each side of the feed list is left as empty cream-colored background (--color-bg-page) at 1440px width. This is a substantial whitespace band. The centering is intentional (760px content cap mirrors the mobile-first layout constraint) but on a 1440px desktop the side margins are visually empty and attention-directing properties of the layout are absent.

**Location name truncation on desktop:** Location strings like "10721 N Highlands Dr, Oro Valley US-AZ 32.40131, -110.97613" are visible in full on desktop (02-feed.png shows these untruncated). The raw coordinates appear as part of the location string — "US-AZ 32.40131, -110.97613" — which is not a user-friendly location descriptor. This is data from the eBird API locName field and is not transformed before display.

**Detail surface navigation:** Clicking a feed row calls `onSelectSpecies` (ObservationFeedRow.tsx:36, FeedSurface.tsx:154) which triggers `set({ detail: speciesCode, view: 'detail' })` (App.tsx:102–104). The detail surface replaces the feed in `<main>`. There is no navigation breadcrumb or back indicator — the only way back is the browser back button or switching SurfaceNav tabs. The SurfaceNav's active tab changes from "Feed" to nothing (view=detail is not a SurfaceNav tab; `anyTabActive = TABS.some(t => t.value === props.activeView)` at SurfaceNav.tsx:76 — when view='detail', no tab is selected). The result is all three SurfaceNav tabs appear unselected while the detail surface is showing.

**Detail surface layout on desktop (04-species-detail.png, 04-species-detail-fullpage.png):** The iNat photo renders at max-width 480px (styles.css:432), left-aligned within the 760px content cap. The species name (Gila Woodpecker, 20px bold) appears below the photo. Scientific name (14px, muted) and family name (Woodpeckers, 13px) follow. The phenology chart (12 monthly bars) renders below at max-width 432px. Below that, the Wikipedia description begins. All content is in a single left-aligned column — no sidebar, no sticky header, no image-right layout option.

**Desktop-specific friction on detail:** The photo is left-aligned but padded right, leaving the right portion of the 760px column blank. The layout is mobile-first extended to desktop without adaptation — on a 1440px viewport the content column is 760px wide centered, with 340px margins. The phenology chart (432px max) is narrower than the photo (480px max), creating a step-in that reads as unintentional rather than rhythmic.

### Mobile — local/mobile/04-species-detail.png, local/mobile/04-species-detail-fullpage.png

**Time-to-value on mobile detail:** The photo renders at full container width (max-width 480px, but container is 390px so photo is full-bleed at ~358px accounting for the 16px padding in #main-surface). The Gila Woodpecker photo fills the top of the detail surface. Below it: common name (bold), scientific name (italic, muted), family name, phenology chart, and description begin. This is the strongest time-to-value of all surfaces — the photo is immediately engaging.

**Mobile detail density:** The content fits within one scroll depth for many species. The phenology chart bars show the two active months (May: 35, Apr: 26) with most months empty — 10 empty grey bars dominate visually, two black bars are the signal. The chart is information-light relative to its vertical footprint when most months have no data.

**FiltersBar persistence on detail:** The FiltersBar and SurfaceNav remain visible on the detail surface. The FiltersBar filters (time window, family, species) apply globally, but on the detail surface they have no visible effect — the detail view fetches data for a specific species code regardless of FiltersBar state (SpeciesDetailSurface.tsx does not consume FiltersBar props). This creates a misleading UI: the filter chrome implies controls are active when they are not acting on the current surface content.

**Back navigation (mobile):** No back button or "close" affordance exists on the detail surface (SpeciesDetailSurface.tsx:127+: "No ESC dismiss, no overlay, no close button"). The active SurfaceNav tab appears unselected. A mobile user who tapped a feed row to reach the detail surface has no native affordance to go back except browser back — which may be off-screen gesture territory on some devices.

---

## Flow 4: "What's the credit / who built this?" (Credits → AttributionModal)

### Desktop — local/desktop/05-attribution-modal.png

**Trigger discoverability:** The "Credits" link is in `<footer role="contentinfo">` at the bottom of the viewport. At 1440×900, the footer is pinned to the very bottom of the viewport (styles.css:563–573). The trigger is `font-size: 12px`, underlined, muted color (`--color-text-muted: #555`), a button styled as a link. It is the only element in the footer. It is visible at all times across all surfaces but is visually minimal — an informed user will find it; an uninformed user exploring the page may not think to look at the footer for a "credits" concept.

**Modal content on desktop (05-attribution-modal.png):** The modal opens over the map (native `<dialog>` showModal(), top layer). It shows: Credits header with Close button, then Bird Sightings Data (eBird), Family Silhouettes (PhyloPic list), Map Tiles (OSM + OpenFreeMap), Privacy. The PhyloPic list is the bulk of the content — individual per-family photographer credits (Hawks Eagles & Kites / Andy Wilson, Ducks Geese & Swans / Kai Caspar, etc.). The modal itself is approximately 560px wide on desktop (max-width: 560px, styles.css:623) centered. At 1440×900 it appears as a compact centered panel.

**Desktop-specific friction:** The modal is sized for the content rather than the viewport, which is correct. The close button is top-right in the header. The backdrop click closes the modal. One friction: the PhyloPic list is long and scrollable inside the modal — on desktop the modal has max-height: 80vh (styles.css:625) and `.attribution-modal-content` also has max-height: 80vh with overflow-y: auto (styles.css:634–637). Double-scrolling context (page scroll + modal internal scroll) is present but not conflicting since the page doesn't scroll behind the modal backdrop.

**Who built this:** The Credits modal does not contain any "About" or author information — only data source attributions. There is no answer to "who built this" in the modal or anywhere in the visible UI.

### Mobile — local/mobile/05-attribution-modal.png

**Modal on mobile:** The modal correctly adjusts to `width: calc(100vw - 2 * var(--space-md))` (styles.css:732) on mobile, filling most of the viewport width. The PhyloPic list is the primary content and takes most of the modal body. The list in the mobile capture shows approximately 20 family attribution rows, each with species name / photographer / license. This is dense at 12px line height on a 390px screen.

**Mobile-specific friction:** The per-row content in the PhyloPic list is three data points compressed onto one line: "[Family name] by [Creator] — [License]". At 12px (`.attribution-modal-phylopic-row { font-size: 12px }`, styles.css:715) on a 390px viewport these are very small tap targets for the embedded links (source links and license links). The Close button is the primary CTA and autofocuses correctly (AttributionModal.tsx:296). No other friction: the modal dismisses on backdrop tap (AttributionModal.tsx:247–253) and Escape key (native dialog behavior).

---

## Flow 5: "Find a specific species" (Species Surface)

### Desktop — local/desktop/03-species-search.png

**Empty state on landing:** The species surface shows a centered text field ("Start typing a species...") and below it the status message "Start typing a species name to explore its recent sightings." (SpeciesSearchSurface.tsx:52–55, visible in 03-species-search.png). Below that, approximately 700px of empty cream-colored background fills the viewport. The entire lower two-thirds of the desktop viewport is empty on species surface cold open. This is an extreme whitespace-to-content ratio.

**Time-to-value:** Zero: there is no content visible until the user types. The empty-state copy tells the user what to do but does not provide any browse or discovery path. A user who lands here without a specific species in mind has no fallback.

**Input design:** The autocomplete input is centered and narrow (`max-width: 760px`, styles.css:282 — but the input itself within that container is `width: 100%`, styles.css:292). On desktop it renders at approximately 700px wide, which is broader than feels natural for a type-ahead input (most search inputs are 400–500px on desktop). The placeholder "Start typing a species…" (SpeciesAutocomplete.tsx:279) differs slightly from the empty-state prompt "Start typing a species name to explore its recent sightings" — the two strings are not identical, creating a minor copy inconsistency.

**Relationship to FiltersBar species input:** The FiltersBar also has a "Species" input (FiltersBar.tsx:101–122) visible at the top of every surface. That input narrows the observation set (filtering Feed/Map in place). The SpeciesSearchSurface's autocomplete *navigates* to the detail view. Both inputs look similar (search type text field), appear on the same viewport simultaneously, and have the same placeholder-level UX — but they do completely different things. This dual-input UX creates potential for user confusion: "I'm already on the Species tab, and I see a Species search box in the filters at the top — which one should I use?"

### Mobile — local/mobile/03-species-search.png

**Mobile species surface:** Matches desktop pattern but with a full-width input (358px usable width). The empty state text wraps to two lines at 390px ("Start typing a species name to explore its / recent sightings."). The remaining ~580px of viewport height is empty cream background.

**Keyboard interaction:** On mobile, tapping the species autocomplete input raises the virtual keyboard, which compresses the visible viewport. The autocomplete listbox positioning logic (SpeciesAutocomplete.tsx:177–189) checks `window.innerHeight` and flips the dropdown above the input if space is insufficient — this will fire on mobile with keyboard open, which is correct. But the test calculates against `window.innerHeight` (which changes with keyboard), and a race condition exists if the keyboard animation hasn't settled when the positioning runs.

**FiltersBar on mobile species surface:** The FiltersBar with its own "Species" input is visible above the SurfaceNav, above the SpeciesSearchSurface input. At mobile viewport, two search-style inputs are visible simultaneously: the FiltersBar species input (row 2, shorter, labeled "Species") and the SpeciesAutocomplete input (full-width, labeled "Search species"). No visual distinction in control type or purpose beyond label text.

---

## State Coverage Audit

| Surface | State | Evidence |
|---|---|---|
| Map | Loading skeleton | MapSurface.tsx:148–165: "Loading map…" in `.map-loading-skeleton` div; no capture |
| Map | Error (ErrorBoundary) | MapSurface.tsx:126–131: "Map failed to load" + "try refreshing" via ErrorBoundary; no capture |
| Map | Error (API / global) | App.tsx:143–150: `.error-screen` "Couldn't load bird data"; local console log confirms this fires |
| Map | Loaded | local/desktop/01-map-default.png — confirmed |
| Feed | Loading | FeedSurface.tsx:93–99: "Loading observations…" in `.feed-empty`; no capture |
| Feed | Empty (notable) | FeedSurface.tsx:103–105: "No notable sightings in this window." + hint |
| Feed | Empty (1d) | FeedSurface.tsx:106–108: "No observations reported today." + hint |
| Feed | Loaded | local/desktop/02-feed.png, local/mobile/02-feed.png — confirmed |
| Species | Loading (search) | SpeciesSearchSurface.tsx:58–61: "Loading observations…" with aria-live |
| Species | Empty (no selection) | local/desktop/03-species-search.png, local/mobile/03-species-search.png — confirmed |
| Species | Empty (no results) | SpeciesSearchSurface.tsx:64–67: "No recent sightings for this species…" |
| Detail | Loading | SpeciesDetailSurface.tsx:199–202: "Loading species details…" in aria-live status |
| Detail | Error | SpeciesDetailSurface.tsx:204–208: "Could not load species details" in role=alert |
| Detail | Loaded | local/desktop/04-species-detail.png, local/mobile/04-species-detail.png — confirmed |

Zero loading or error state captures exist in the screenshot set. All three error branches are exercised only via code inspection, not visual evidence.

---

## Friction Inventory

| Surface | Viewport | Friction | Severity | Evidence |
|---|---|---|---|---|
| Map | Mobile | FamilyLegend expanded by default covers ~40% of map tap area | High | local/mobile/01-map-default.png; MapSurface.tsx:22–31 (breakpoint logic that should collapse it) |
| Map | Mobile | Chrome (FiltersBar 2-row + SurfaceNav) consumes ~21% of viewport before any content | High | local/mobile/01-map-default.png; styles.css:362–384 (flex-wrap wrap, no mobile height reduction) |
| Map | Desktop | 16px padding around map canvas creates wasteful gutter on a full-viewport surface | Medium | local/desktop/01-map-default.png; styles.css:86 (`#main-surface { padding: var(--space-lg) }`) |
| Map | Both | No feedback when filters are applied (loading state absent during data refetch) | Medium | local/desktop/06-map-notable-30d.png; App.tsx:24–29 (loading state exists but no map-specific indicator) |
| Map | Both | FamilyLegend internal scrollbar not signaled — content hidden below fold | Low | styles.css:797 (`max-height: 400px`, no scroll indicator) |
| Map | Desktop | FamilyLegend competes with MapLibre attribution text (both bottom, different sides) | Low | local/desktop/01-map-default.png |
| Feed | Mobile | Species name visible, but location strings truncated with "..." leaving key context hidden | High | local/mobile/02-feed.png; ObservationFeedRow.tsx: `overflow: hidden; text-overflow: ellipsis` on `.feed-row-loc` (styles.css:256–259) |
| Feed | Mobile | Raw eBird coordinates included in location name (e.g. "US-AZ 32.40131, -110.97613") | Medium | local/desktop/02-feed.png (visible in full on desktop; truncated on mobile) |
| Feed | Desktop | 340px side margins (blank cream) on each side of 760px-wide feed at 1440px viewport | Medium | local/desktop/02-feed.png; styles.css:144 (`max-width: 760px; margin-inline: auto`) |
| Feed | Both | No visual back indicator after navigating from feed to species detail | High | App.tsx:181–219 (mutual-exclusive surface render); SurfaceNav.tsx:76 (anyTabActive false for view=detail) |
| Feed | Both | FiltersBar remains visible on detail surface but has no effect on detail content | Medium | SpeciesDetailSurface.tsx:127+ (no FiltersBar props consumed); local/desktop/04-species-detail.png |
| Species | Both | Empty state (species surface cold open) leaves lower ~70% of viewport blank | Medium | local/desktop/03-species-search.png; local/mobile/03-species-search.png |
| Species | Both | Two species-search inputs simultaneously visible (FiltersBar + SpeciesAutocomplete) with different behaviors | High | local/mobile/03-species-search.png; FiltersBar.tsx:101–122 vs SpeciesAutocomplete.tsx (different onCommit behaviors) |
| Species | Mobile | Virtual keyboard raises viewport; autocomplete dropdown positioning race condition possible | Medium | SpeciesAutocomplete.tsx:177–189 (useLayoutEffect on orderedMatches); no capture |
| Detail | Both | No explicit back navigation / close affordance on species detail surface | High | SpeciesDetailSurface.tsx:127+ ("No ESC dismiss, no overlay, no close button"); SurfaceNav.tsx:76 (no active tab on detail view) |
| Detail | Desktop | Phenology chart (432px max) narrower than photo (480px max) creates unintentional ragged right edge | Low | local/desktop/04-species-detail.png; styles.css:432, 471 |
| Detail | Mobile | Phenology chart shows 10 empty months, 2 active — empty bars dominate visual space | Low | local/mobile/04-species-detail.png; PhenologyChart renders all 12 months always |
| Attribution | Both | "Credits" trigger at 12px in footer is the only "about this site" / attribution entry point; easily overlooked | Medium | local/desktop/05-attribution-modal.png; styles.css:586 (`font-size: 12px`) |
| Attribution | Both | No "who built this" information anywhere in the visible UI or Credits modal | Low | AttributionModal.tsx: sections are data-source-only; no author/about content |
| Attribution | Mobile | PhyloPic list rows at 12px with embedded links — marginal tap target size | Medium | local/mobile/05-attribution-modal.png; styles.css:715 (`.attribution-modal-phylopic-row { font-size: 12px }`) |
| All surfaces | Mobile | Notable-only checkbox hit target is inline-label sized, not explicitly 44px | Low | FiltersBar.tsx:79–88; styles.css:371 (no min-height on checkbox label) |
| All surfaces | Both | FiltersBar provides no "filters active" summary badge or state indicator | Medium | local/desktop/06-map-notable-30d.png (filters changed, no indicator); FiltersBar.tsx:64–124 |

---

## Key Findings

### Finding 1: FamilyLegend-map collision is the primary mobile friction point
- **Evidence:** local/mobile/01-map-default.png, prod/mobile/01-map-default.png — both show the legend expanded and covering the bottom 40% of the visible map area. MapSurface.tsx:22–31 defines `LEGEND_EXPAND_MIN_WIDTH = 760` and `readLegendDefaultExpanded()` returns false below 760px — yet the mobile captures show the legend expanded. Either localStorage from a prior session is overriding the responsive default (FamilyLegend.tsx:135–138: `stored ?? defaultExpanded`), or the breakpoint logic did not fire in the capture environment.
- **Confidence:** High for the visual overlap; medium for the root cause of the defaultExpanded contradiction (no session-history data available).
- **Implication:** Even if the collapsed-by-default behavior fires correctly on first visit, the legend's expanded state on any return visit will cover the map. The design must either (a) relocate the legend off the map canvas on mobile, (b) make the legend non-overlapping by giving it in-flow space, or (c) strongly gate expansion behind explicit user intent on mobile.

### Finding 2: Dual species-search input creates behavioral confusion
- **Evidence:** FiltersBar.tsx:101–122 (species input, commits via blur/Enter, narrows feed in place), SpeciesAutocomplete.tsx:141+ (navigates to detail view on commit). Both are visible simultaneously on the Species surface (local/mobile/03-species-search.png, local/desktop/03-species-search.png). The FiltersBar input is labeled "Species" in a filter region; the SpeciesAutocomplete input has placeholder "Start typing a species…". Both accept free-text species names. They resolve to different actions.
- **Confidence:** High — code and captures confirm both inputs are present simultaneously.
- **Implication:** A redesign must either (a) eliminate one input path, (b) make the behavioral distinction visually obvious (different control style, explicit verb labeling like "Filter by species" vs "Browse species"), or (c) unify the two into one smart input with context-sensitive behavior.

### Finding 3: Detail surface has no explicit back navigation
- **Evidence:** SpeciesDetailSurface.tsx:127 comment "No ESC dismiss, no overlay, no close button — the user navigates away via the browser back button or SurfaceNav." SurfaceNav.tsx:76: `anyTabActive = TABS.some(t => t.value === props.activeView)` — when `view='detail'`, no TABS entry matches, so all three tabs render unselected. local/desktop/04-species-detail.png shows the SurfaceNav with no active tab highlighted.
- **Confidence:** High.
- **Implication:** Users who reach the detail surface via feed-row tap (the primary path) have no explicit UI affordance to return. On mobile, the back gesture works but is not discoverable. On desktop, the back button works but requires mouse travel off the content area. The unselected-tab state of SurfaceNav also breaks the tab affordance as a navigation model — tabs appear broken, not just "none selected."

### Finding 4: Chrome height disproportionate to mobile content area
- **Evidence:** local/mobile/01-map-default.png: FiltersBar wraps to 2 rows at 390px (styles.css:369 `flex-wrap: wrap`) consuming approximately 130px; SurfaceNav adds ~44px; combined ~174px of 844px total = 21% chrome. On the map surface, the FamilyLegend then overlaps an additional 40% of the remaining map area. On the feed surface (local/mobile/02-feed.png), the chrome is constant — every row in the feed is within a narrow 670px content area, which is workable.
- **Confidence:** High for the chrome height measurement (visual); medium for the exact pixel counts (estimated from captures without precise ruler).
- **Implication:** Mobile redesign needs a strategy for reducing chrome footprint — either collapsing the FiltersBar (drawer/sheet), reducing SurfaceNav height, or combining the two into a bottom navigation bar with an accessible filter sheet.

### Finding 5: No loading or error state is captured — blind spots in UX evidence
- **Evidence:** Zero of the 31 captures show a loading state or error state. The local console log (console-map-desktop.log:4–9) shows API connection errors for local, yet the local screenshots show fully-loaded prod data — implying the local captures were taken against prod API or screenshots were taken post-API fix. The error-screen branch (App.tsx:143–150) is never demonstrated visually.
- **Confidence:** High (absence of captures is observable fact); low (can't assess quality of loading/error UX without seeing it).
- **Implication:** The redesign brief lacks visual evidence for loading and error states. These states need separate capture or code review to assess whether they are designed consistently with the loaded states.

---

## Surprises

- The FamilyLegend appears expanded on mobile in both local and prod captures, contradicting the `readLegendDefaultExpanded()` logic that should return `false` below 760px. This is unexpected.
- The detail surface (view=detail) is not a SurfaceNav tab — the three tabs (Feed, Species, Map) go unselected when the detail view is active. This is architecturally intentional (detail is a sub-surface of species navigation) but visually breaks the tab affordance.
- The FiltersBar species input and the SpeciesAutocomplete input coexist without visual differentiation between their different behaviors — this was not flagged in prior documentation reviewed.
- The feed has no pagination or infinite-scroll — it renders all matching observations at once (FeedSurface.tsx:148–157 renders the entire `visibleObservations` array). No performance cap is visible in the code. At 344+ observations this could be a long list.
- No loading or data-freshness indicator exists anywhere in the UI — observations could be hours stale with no visual signal.

---

## Unknowns and Gaps

- **What does the error-screen look like?** No capture of App.tsx:143–150 `.error-screen` or MapSurface.tsx:126–131 ErrorBoundary fallback exists. Visual quality of error states is unknown.
- **What does the map loading skeleton look like?** MapSurface.tsx:148–165 defines a `map-loading-skeleton` div but no capture of this state exists.
- **Root cause of FamilyLegend expanded-on-mobile:** Is this localStorage persistence from a prior test session, or a genuine code bug? Cannot determine from static captures alone.
- **Observation popover UX on mobile:** The `.observation-popover` (styles.css:867) appears at top-left of the map surface — on mobile this would overlap cluster bubbles in the upper portion of the map. No mobile popover capture exists.
- **Feed pagination / virtualization:** FeedSurface renders all observations in a single DOM list. At 344+ items performance impact on mobile is uninvestigated.
- **Deep-link UX:** No capture of what happens when a user shares a URL with `?detail=GIAWO&view=detail` — does the detail surface load correctly before data arrives? The detail surface loads its own data (SpeciesDetailSurface.tsx:129) but the FiltersBar and map data depend on the global `useBirdData` hook which has its own loading cycle.

---

## Raw Evidence

- Captures read: local/desktop/ (01, 02, 02-fullpage, 03, 04, 04-fullpage, 05, 06), local/mobile/ (01, 02, 02-fullpage, 03, 04, 04-fullpage, 05), prod/desktop/ (01, 04-fullpage, 05), prod/mobile/ (01, 02)
- Source files read: App.tsx, FiltersBar.tsx, SurfaceNav.tsx, FeedSurface.tsx, MapSurface.tsx, FamilyLegend.tsx, SpeciesSearchSurface.tsx, SpeciesDetailSurface.tsx, ObservationFeedRow.tsx, AttributionModal.tsx, SpeciesAutocomplete.tsx, styles.css
- Console log read: local/console-map-desktop.log
- Phase documents read: context-packets/phase-0-packet.md, phase-0/analysis-brief.md
- Template read: ~/.claude/skills/analysis-funnel/references/phase-templates.md
