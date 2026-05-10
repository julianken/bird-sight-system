# bird-maps.com Site Redesign — Analysis Report

*Phase 4 of the analysis funnel. Comprehensive briefing for the redesign work.*

---

## A) Executive Summary

bird-maps.com is a working, accessible, fast Arizona bird-sightings site whose visual layer was started but never finished — several foundational decisions were deferred and the implementation has been quietly absorbing their absence. The redesign is therefore not a visual refresh problem; it is a **systems decision-completion problem with a visual layer on top**. The single most consequential decision is voice/identity: choosing what bird-maps.com claims to be (which surface text already supports, but which the site has never declared) unblocks 19 enumerated metadata gaps, all onboarding copy, the type register, and social sharing strategy in one stroke. The single most consequential code change is `pushState` in `url-state.ts:87` — a ~40-line targeted fix that resolves browser-back failure across all four surfaces and should ship as pre-redesign engineering work, not as part of the visual brief. The most expensive UX problem on mobile is not the chrome height (185.1px / 21.9% — measurable) but the FamilyLegend overlay (44.8% of main on mobile, 57.6% on desktop — worse than mobile). The strongest existing assets — WAI-ARIA tablist with full keyboard contract, native `<dialog>` with focus management, inline-measured contrast comments, axe-validated landmark order, and the coherent 14-string copy register — are months of engineering work that the redesign must build on top of, not around. The accessibility baseline is a structural asset that will be silently destroyed by a designer who does not know it is load-bearing.

## B) Analysis Question & Scope

**Question:** What should inform a redesign of the bird-maps.com site (the surrounding application — chrome, navigation, surfaces, content, brand, type, color, density), holding the live MapLibre map *behavior* constant and only theming the map's visual layer?

**In scope:** four surfaces (`feed`, `map`, `species`, `detail`); FiltersBar, SurfaceNav, AttributionModal; mobile (390×844) and desktop (1440×900); brand identity (voice, naming, favicon, OG metadata); the map's visual *theme* (basemap style choice, marker palette, FamilyLegend treatment) but not its rendering or interactivity behavior; information architecture; accessibility; performance budget *as it relates to design choices*; content strategy (descriptions, attribution, empty states, copy register).

**Out of scope:** map clustering math, viewport-aware count logic, MapCanvas internals; backend (Read API, Ingestor, schema); auth/security/compliance; infra (Cloudflare Pages, Cloud Run, DNS, Terraform); adding new functional features; the decision to redesign at all.

**Audience:** the designer who will run brainstorm + design exploration after this analysis. Designed to be readable cold.

## C) Table of Contents

- **A. Executive Summary** — the redesign is a decision-completion problem; voice + `pushState` are the two highest-leverage commitments.
- **B. Analysis Question & Scope** — what was investigated and what wasn't.
- **C. Table of Contents** — this section.
- **D. Methodology** — analysis funnel (5→5→3→1) executed on /Users/j/repos/bird-watch with Playwright captures + codebase reads + competitor surveys.
- **E. Key Findings** — five themes with cross-cutting evidence, ordered by impact × confidence.
- **F. Analysis & Implications** — what the findings mean *together*; where the lenses converge.
- **G. Confidence Assessment** — what to trust strongly, weakly, and not at all.
- **H. Recommendations** — six high-level recommendations with priority, rationale, trade-offs.
- **I. Open Questions** — what this analysis cannot answer and how to close each gap.
- **J. Evidence Index** — every finding mapped to file:line, capture, or external URL.

## D) Methodology

**Approach:** Analysis funnel (5→5→3→1) per `~/.claude/skills/analysis-funnel/SKILL.md`. Five parallel investigators (Phase 1) → five parallel iterators (Phase 2) → three parallel synthesizers (Phase 3) → one unified report (Phase 4).

**Evidence sources:**
- **Codebase reads** of `frontend/src/App.tsx`, all `frontend/src/components/*.tsx` (12 components), `frontend/src/state/url-state.ts`, `frontend/src/styles.css` (945 lines), `frontend/src/tokens.ts`, `frontend/src/components/map/*.ts`, `frontend/playwright.config.ts`, `frontend/e2e/axe.spec.ts`.
- **Live Playwright captures** at 2 viewports × prod + local × all 4 surfaces + filtered states + AttributionModal × loading/empty/error states. Total: 48 PNGs (`tmp/redesign-analysis/screenshots/{local,prod,states}/{desktop,mobile}/`).
- **Live DOM measurements** via `getBoundingClientRect()` through Playwright `browser_evaluate` for chrome footprint quantification (Iterator 5).
- **Competitor surveys** via `WebFetch` of eBird, Merlin, iNaturalist, Audubon, BirdCast, Tucson Bird Alliance public homepages (Iterator 1).
- **Live curl** of `https://bird-maps.com/` and `https://bird-maps.com/favicon.ico` for prod metadata audit.

**What was NOT investigated:**
- PostHog session analytics (could be queried in 15 minutes — see Open Question Q1).
- Manual screen-reader (VoiceOver / NVDA) sessions.
- Physical-device safe-area / notch behavior.
- Bundle size baseline (`npm run build && du -sh frontend/dist`).
- User interviews / session recordings.

**Artifact tree:** `tmp/redesign-analysis/funnel/{phase-0,phase-1,phase-2,phase-3,phase-4,context-packets,STATUS.md}`. The funnel completed all phase verifications (`scripts/verify_phase.sh` passed at each transition).

---

## E) Key Findings

Organized by **theme**, ordered by impact × confidence. Each finding cites file:line, capture filename, or external URL. Five themes total.

### Theme 1 — Identity vacancy is the upstream blocker

#### Finding 1.1: The site has no declared identity, and that absence has measurable costs

**Confidence:** High.

**Evidence:**
- Live `curl https://bird-maps.com/` returns `<head>` with only `<meta charset>`, `<meta name="viewport">`, and `<title>bird-watch — Arizona</title>`. Every other meta/OG/Twitter/canonical/manifest tag is absent. (area-4 Finding 3, enumerated 19 gaps.)
- No surface renders the brand name "bird-watch — Arizona" as visible text. It exists only in the browser tab. (area-4 Finding 1.)
- No About surface, no tagline, no rendered "what is this for" copy on any of the four surfaces. The default surface (`feed`, per `url-state.ts:15–22` — `DEFAULTS.view='feed'`) lands the user directly in observation rows with no orientation. (area-4 Finding 5.)
- Voice register across all 14 visible strings is consistent and "functional-reassuring" but never names what the site IS. (area-4 Finding 4 — copy inventory, area-3 Flow 1.)
- All comparable platforms front-load *why this exists* in their headlines (BirdCast: "Showcasing the Spectacle of Bird Migration"; Merlin: "Identify the birds you see or hear"; iNaturalist: "Where your curiosity contributes to science"). (Iterator 1 Findings 1–4, with WebFetch URLs.)

**Impact:** Every social media unfurl renders as bare URL with no image, no description, no card. SEO snippets default to platform-inferred text. First-time visitors get no orientation to "recent Arizona bird sightings from eBird" — the only differentiator from global birding platforms. The 19 metadata gaps cannot be closed independently; they are downstream of a single voice decision that has not been made.

**Related findings:** 1.2 (eBird gap), 5.1 (voice register as tonal ceiling); thematic synth Theme 1.

#### Finding 1.2: bird-maps.com sits in a structural gap that eBird deliberately vacates

**Confidence:** High.

**Evidence:**
- `https://ebird.org/` redirects all unauthenticated traffic to Cornell SSO. eBird's product is addressed to *contributors* (logging checklists), not consumers. (Iterator 1 Finding 4, fetched.)
- The eBird About page identifies the platform as "the world's largest birding community" — community framing requires participation features bird-maps.com does not have (no accounts, no checklist submission, no social graph — phase-0-packet §Repo facts).
- BirdCast (https://birdcast.info/) is the structural peer: narrow scope, specific data source, no community features, no login. Its positioning ("Bird migration forecasts in real time" + scope-bounded "Active from March 1 – June 15…") is "opinionated utility" — mechanism-named, scope-bounded, declarative — and is structurally available to bird-maps.com without new features.

**Impact:** The voice space is not "neutral vs. opinionated." It is a three-position spectrum where Position C (mission/narrative) is structurally unavailable, Position A (current neutral utility) has documented ongoing costs (the 19 metadata gaps; no SEO), and **Position B (opinionated utility) is available and would close everything in one declarative claim**: e.g., "Recent Arizona bird sightings, updated in real time from eBird."

**Related findings:** 1.1 (identity vacancy), 4.2 (existing voice register supports Position B without retraining).

---

### Theme 2 — State invisibility is the product's primary usability failure

The interface fails to communicate four kinds of state simultaneously. Each is independently confirmed and individually fixable; together they compound.

#### Finding 2.1: Filters silently apply across all four surfaces with zero global indicator

**Confidence:** High.

**Evidence:**
- `App.tsx:24–29` calls `useBirdData` once at the App level with all FiltersBar values. The single resulting `observations` array is passed to all four surface components. There is no per-surface filter scoping. (area-2 Finding 3.)
- Setting "Cardinals & Allies" in the FamilyLegend on the map (`App.tsx:91–96`) writes `familyCode` to global state. Switching to Feed renders only Cardinal-family rows with no visual cue at the FiltersBar or SurfaceNav level that a filter is active.
- FiltersBar shows 4 controls always; no badge, no count, no "filters applied" summary. (area-3 friction inventory row 22.)

**Impact:** A user arriving via a deep-linked URL with `?family=corvi1` sees a filtered view and has no signal explaining why the rows are not what they expected. Returning users with filters set in localStorage (FamilyLegend `familyCode`) experience the same. The problem is **invisible today** because the visual is plain — the redesign will make it dramatically worse if filters are hidden behind a trigger (Patterns A/B/C from chrome compaction) without a filter-active indicator on persistent chrome.

#### Finding 2.2: Loading and empty states are visually identical — both are muted text on cream background

**Confidence:** High.

**Evidence:**
- Iterator 4 captured 17 non-loaded states (11 desktop + 6 mobile). All non-error, non-loaded states use one of: `.feed-empty` (`styles.css:268–275`), `.species-search-empty` (`styles.css:354–360`), `.species-detail-loading` (`styles.css:457`), `.attribution-modal-loading/.attribution-modal-empty` (`styles.css:696–701`).
- All four classes render the same: muted `#555` centered text on the warm cream `#f4f1ea` page background. None has an icon, animation, spinner, progress indicator, or any visual differentiation between "loading" and "empty." (Iterator 4 Finding 1.)
- Map skeleton (`MapSurface.tsx:148–165`) is **730px desktop / 635px mobile** of cream-on-cream text — the largest empty surface in the app by pixel area. Inline `background: '#f4f1ea'` (note: hardcoded hex, not `var(--color-bg-page)` — `MapSurface.tsx:159`). (Iterator 4 Finding 3, capture `states/desktop/map-loading-skeleton.png`.)

**Impact:** A user cannot tell from visual appearance alone whether the app is working (loading) or finished (empty). On the map's first paint — the largest pixel surface in the app — they see 730 vertical pixels of blank cream. A redesign that improves loaded surfaces without addressing the 14 distinct copy+class pairs in loading/empty/error states will widen this gap visibly.

#### Finding 2.3: Error severity and visual treatment are inverted

**Confidence:** High.

**Evidence:**
- Component-level error (`SpeciesDetailSurface.tsx:205–209`, `.species-detail-error`) uses the codebase's only `--color-error-*` token set: red tint background, dark red border, dark red text. Visually distinguished. (`styles.css:519–527`.)
- App-level error (`App.tsx:143–150`, `.error-screen`) — *more severe* — has zero error styling. Renders as unstyled `<h2>` + `<p>` on page background, inheriting `--color-text-strong: #1a1a1a`. The `<p>{error.message}</p>` passes raw `error.message` directly (App.tsx:147) — voice inconsistency from area-4 Finding (raw API error strings appear in production UI; every other error state uses crafted copy). (Iterator 4 Finding 2, capture `states/desktop/app-error-screen.png`.)

**Impact:** The more severe error has the lower visual weight. Users encountering the app-level error see plain text; users encountering the lesser component-level error see a red-bordered alert. This should be reversed.

#### Finding 2.4: Browser back navigation is silently broken

**Confidence:** High.

**Evidence:**
- `url-state.ts:87` — `window.history.replaceState({}, '', newUrl)` is the only history mutation in `writeUrl()`. `pushState` does not appear anywhere in the file. (area-2 Finding 1.)
- Surface transitions (`feed` → `detail` via feed-row click; `species` → `detail` via SpeciesAutocomplete commit; etc.) all use `replaceState`.
- `popstate` listener at `url-state.ts:97–101` exists but never fires for in-app transitions.
- The detail surface (`SpeciesDetailSurface.tsx:112–118`) explicitly documents: "No ESC dismiss, no overlay, no close button — the user navigates away via the browser back button or SurfaceNav." Browser back, however, does not return to the originating surface — it exits the site.

**Impact:** Users tap a feed row → reach detail → press browser back → leave the site (or go to wherever they came from). For a four-surface SPA, this is a fundamental violation of user expectation. **Iterator 3 Finding 4 confirms a ~40-line fix (Option D)**: conditional `pushState` for transitions to detail; modify `useUrlState.set` to pass `push: true` when the next state has `view: 'detail'`. The fix touches three files (`url-state.ts`, `App.tsx`, `SpeciesDetailSurface.tsx`) and resolves the failure across all four surfaces.

---

### Theme 3 — Mobile chrome and FamilyLegend are two separable problems with measurable cost

Phase 1's eyeball estimates were directionally correct but consistently underestimated by 5–7%. Iterator 5 produced pixel-precise `getBoundingClientRect()` measurements.

#### Finding 3.1: Mobile chrome is 21.9% of viewport and surface-invariant

**Confidence:** High.

**Evidence (Iterator 5, all values from live DOM):**

| Mobile 390×844 | Desktop 1440×900 |
|---|---|
| FiltersBar: **138.5px** (3 wrapped rows: time+notable / family / species) | FiltersBar: **52.5px** (1 row) |
| SurfaceNav: **46.6px** | SurfaceNav: **46.6px** |
| Total chrome: **185.1px = 21.9%** | Total chrome: **99.1px = 11.0%** |
| Footer: **49.0px = 5.8%** | Footer: **49.0px = 5.4%** |
| Main usable: **609.9px = 72.3%** | Main usable: **751.9px = 83.5%** |

Chrome is **surface-invariant** — same height across feed/map/species/detail at each viewport.

**Impact:** Mobile chrome consumes ~22% of the viewport before any content renders. Phase 1 said "~21%, ~174px" — measured is **+11.1px, +0.9pp**. The chrome is high-utility but most casual users never touch all four filters. There is no responsive compaction strategy today. Six chrome-compaction patterns are mapped and trade-off-rated in Iterator 2 (Patterns A–F); Pattern A (bottom tab + filter sheet) is the largest reclaim at **−141px / +24.6% main area**.

#### Finding 3.2: FamilyLegend overlay covers 44.8% of main on mobile and 57.6% on desktop

**Confidence:** High.

**Evidence:**
- Iterator 5 measurement, `.family-legend` selector (`role="complementary"` is implicit on `<aside>` and not exposed as an explicit attribute; correct selector is the class).
- Mobile expanded: **273px tall** (toggle 31px + entries 240px + 2px border) covering y=494–767 in 609.9px main area = **44.8% of main**.
- Desktop expanded: **433px tall** covering y=390–823 in 751.9px main area = **57.6% of main** — worse than mobile in absolute pixels.
- Worst-case mobile (chrome + expanded legend + footer): **507.1px = 60.1% of viewport** is non-map content. Only 39.9% of the viewport on map view is unobstructed map.
- Worst-case desktop: **64.6% of viewport** consumed.
- The legend is expanded by default on mobile in both local and prod captures (`local/mobile/01-map-default.png`, `prod/mobile/01-map-default.png`), contradicting `LEGEND_EXPAND_MIN_WIDTH=760` logic (`MapSurface.tsx:22–31`). Likely localStorage persistence: `FamilyLegend.tsx:135–138` (`stored ?? defaultExpanded`) — expanded state survives across sessions. (area-3 Finding 1.)

**Impact:** This is the single largest UX obstruction in the app. It is **independent of chrome compaction** — fixing chrome height does not fix legend overlap. Two solutions exist: (a) fix the mobile-default behavior to never honor localStorage-expanded below 760px (small code change, no design implication); or (b) migrate the legend into the chrome's filter sheet (Pattern A) — solves both problems at once but requires committing to the overlay strategy. The legend is the only labeled color key for the family-color encoding (Theme 4), so collapse-without-replacement breaks discoverability for new users.

#### Finding 3.3: The two species-search inputs coexist on the same surface with different behaviors and no visual distinction

**Confidence:** High.

**Evidence:**
- FiltersBar's "Species" input (`FiltersBar.tsx:101–122`) is a `<input type="search" list="species-options">` with `<datalist>`. Commit narrows the observation set in place. (area-2 Finding 6.)
- SpeciesSearchSurface uses `<SpeciesAutocomplete>` (`SpeciesAutocomplete.tsx`, 354 lines of custom WAI-ARIA combobox). Commit *navigates* to the detail view (`SpeciesSearchSurface.tsx:47–50` calls `set({ detail, view: 'detail' })`).
- Both inputs visible simultaneously on the Species surface (`local/{desktop,mobile}/03-species-search.png`). FiltersBar input labeled "Species"; SpeciesAutocomplete placeholder "Start typing a species…". No visual differentiation between filter-action and navigation-action. (area-3 friction inventory row 13.)

**Impact:** Two superficially similar inputs with fundamentally different behaviors create user confusion. A user on the Species surface who commits a species name in either input gets very different results. The redesign should either unify (single species entry point) or differentiate sharply (distinct visual language: e.g., "Filter by species" textbox vs. "Browse species" combobox card).

---

### Theme 4 — The design system exists as a skeleton, not a system

Tokens, primitives, and patterns are present individually but are not connected into a coherent system; every surface recombines them independently.

#### Finding 4.1: Two-layer token architecture exists but has gaps; no design-system package

**Confidence:** High.

**Evidence:**
- `frontend/src/tokens.ts` (166 lines) and `frontend/src/styles.css` `:root` block (`styles.css:1–63`) form a two-layer contract: TS for JSX, CSS for stylesheet rules. Comment at `tokens.ts:1–16` documents the contract; comment at `styles.css:1–3` warns "Update both sides together — tokens.test.ts only covers tokens.ts scales." (area-1 Finding 1.)
- The `color.palette` object at `tokens.ts:124–158` (7 ecoregion hex colors + 2 map-specific) is NOT mirrored in CSS `:root`. The family-color palette is DB-sourced via `/api/silhouettes` and applied directly as SVG `fill` or MapLibre paint properties — outside the CSS custom-property surface entirely. (area-1 Finding 2.)
- No `@bird-watch/design-system` package; no Storybook; no Radix UI; no headlessui; no primitives layer. Native `<button>`, `<input>`, `<select>` directly styled via flat CSS classes. (area-1 Finding 8, `frontend/package.json` confirmed.)

**Impact:** Two parallel color systems (CSS chrome palette + DB family palette) cannot be re-skinned through a single mechanism. A redesign of brand color must address both separately. There is no upstream design system to conform to (maximum freedom) but also no reusable primitives (must build everything).

#### Finding 4.2: Type system has no scale — 35+ font-size literals across 7 distinct values

**Confidence:** High.

**Evidence (area-1 Finding 3, all from `styles.css`):**
- Single font stack: `-apple-system, BlinkMacSystemFont, "Helvetica Neue", Helvetica, sans-serif` (`styles.css:68`). System UI only; no `@font-face`.
- Hardcoded font-sizes: 11px (2 sites), 12px (8 sites), 13px (15 sites), 14px (7 sites), 15px (1 site — autocomplete), 18px (modal heading), 20px (species common name).
- Font weights as literals: 600 (rows, legend), 700 (badges, headings).
- Line-heights only declared 4 times (no token).

**Impact:** Any redesign touching type must audit all 35+ usages individually. There is no `--font-size-sm` / `--font-size-base` abstraction to swap. The system-stack has cross-platform inconsistency (San Francisco / Segoe UI / Roboto / Liberation Sans) — the site has no cross-platform type-consistency guarantee today. Voice register sets a tonal ceiling (Iterator 4 Finding 4) — no playful display fonts; webfont must congrue with "functional-reassuring" register.

#### Finding 4.3: Border-radius and shadows are partial systems — radius is 9 hardcoded literals

**Confidence:** High.

**Evidence:**
- Spacing scale exists as 5-step token: xs=4 / sm=8 / md=12 / lg=16 / xl=24 (`tokens.ts:102–113`, `styles.css:12–17`) and is consistently used.
- Border-radius is 9 distinct hardcoded literals: 2px / 4px (9 sites) / 6px / 8px / 10px / 50% / 999px. No token. (area-1 Finding 4.)
- Shadows: 3 named custom properties (`--shadow-panel`, `--shadow-listbox`, `--shadow-drawer`) at `styles.css:20–22` — but they all compose from a single `--opacity-subtle`; geometry hardcoded inline. AttributionModal uses a 4th, ad-hoc shadow.

**Impact:** A redesign that establishes a shape language ("everything is 6px") must find/replace many independent radius literals. Current corners visibly inconsistent across screenshots: chip 10px, panel 6px, badge 50%/999px, photo 4px, modal 8px.

#### Finding 4.4: 14 distinct copy+class pairs for loading/empty/error states; no shared primitive

**Confidence:** High.

**Evidence (Iterator 4 Finding 5):**
- No `<StatusMessage>` / `<LoadingState>` / `<EmptyState>` component exists. Each surface independently renders its own DOM.
- 14 unique combinations: see Iterator 4 § Finding 4 voice inventory table.
- CSS classes: `.feed-empty`, `.species-search-empty`, `.species-detail-loading`, `.species-detail-error`, `.attribution-modal-loading`, `.attribution-modal-empty`, `.attribution-modal-error`, `.error-screen`, `.map-loading-skeleton` — slightly different padding, font-size, color across each.

**Impact:** A redesign that introduces a `<StatusMessage variant="loading|empty|error" tone="subtle|alert">` primitive unifies all 14 sites. The primitive must work in 5 container shapes: full viewport, full-width list, narrow panel, dialog section, modal section. Voice register is already coherent (Iterator 4 Finding 4) — set the tonal ceiling for visual treatment.

#### Finding 4.5: Duration tokens reserved but unused; zero motion CSS exists

**Confidence:** High.

**Evidence (area-5 Finding 6):**
- `tokens.ts:115–122`: `duration.fast: 200ms`, `duration.base: 250ms`, `duration.slow: 350ms`.
- `styles.css:16–18`: `--dur-fast`, `--dur-base`, `--dur-slow` declared.
- `grep "transition\|animation\|@keyframes" styles.css` returns NOTHING. `grep "prefers-reduced-motion" frontend/src/` returns NOTHING.
- MapLibre `easeTo` at `MapCanvas.tsx:729–732` likely does not honor `prefers-reduced-motion` — a suspected motion-leak today.

**Impact:** A redesign has a clean slate for motion language but inherits a corresponding obligation: every CSS `transition`/`@keyframes`/`animation` introduced must be wrapped in `@media (prefers-reduced-motion: reduce)`. The `duration.*` tokens exist for consumption. Map `easeTo` should be guarded at `MapCanvas.tsx:729` (G5 — knowable but not from source alone).

---

### Theme 5 — The accessibility and interaction baseline is exceptional and easy to break

The existing implementation has strong accessibility foundations that are invisible from the visual layer. A designer who does not know they are load-bearing will remove them.

#### Finding 5.1: Six load-bearing baselines documented and axe-validated

**Confidence:** High.

**Evidence (area-5 + Theme E in phase-2-packet):**
1. **Landmark order** (`region` Filters → `tablist` Surface → `<main id="main-surface">` → `<footer role="contentinfo">`) enforced by axe e2e suite (`axe.spec.ts:8–20`). Comment at `App.tsx:227–231` documents the contract: "Do NOT move it before FiltersBar / SurfaceNav."
2. **WAI-ARIA tablist** (`SurfaceNav.tsx:79–108`): `role="tablist"` + `aria-label="Surface"`, three `role="tab"` buttons with `aria-selected`, `aria-controls="main-surface"`, roving tabindex (`tabbable = selected || (!anyTabActive && index === 0)`), Arrow/Home/End keyboard handling, automatic-activation pattern (focus + selection together). Position-independent — DOM order matters, not visual.
3. **Native `<dialog>` modal** (`AttributionModal.tsx:182–261`): native `showModal()`, ESC-closes, backdrop-click, `queueMicrotask(() => closeBtn.focus())`, focus restoration via `previouslyFocusedRef`, `aria-haspopup="dialog"`, `aria-expanded`, `aria-labelledby`, `rel="noopener noreferrer"` on external links. Documented and axe-validated at desktop AND mobile (`axe.spec.ts:314–351`).
4. **Focus-visible** uniformly 2px outline `--color-text-strong` across every interactive element with consistent offset semantics (~6 sites in `styles.css`). Outline color `#1a1a1a` contrasts against every defined background.
5. **Inline contrast measurements** documented next to hex values: `styles.css:243–264, 507–512` (e.g., `#5c5c5c on #fff = 6.86:1`, `#666 on #fff = 5.74:1`). Convention exists but is not yet extended to the cluster-bubble palette.
6. **44px tap targets on content rows** (`.feed-row min-height: 44px`, `styles.css:179, 135–137` cite iOS HIG). Chrome targets at 32px (deliberate; below 44pt iOS HIG minimum).

**Impact:** These are months of engineering work. A redesign that breaks any of them regresses the axe e2e gate (`test, lint, build, e2e` are required Mergify checks per CLAUDE.md). Specific risks to call out:
- Pattern A (bottom tab) DOM-order discipline: if the SurfaceNav DOM moves below `<main>` to match its visual position, the tablist contract breaks.
- Slide-over patterns (Option C for detail): no codebase precedent; needs `inert` or full focus-trap; high risk.
- New accent color: must hold 4.5:1 on every surface AND focus outline.
- New chrome target sizes: must not regress 44px content-row floor.

#### Finding 5.2: Axe coverage matrix is comprehensive; canvas excluded

**Confidence:** High.

**Evidence (area-5 Finding 8):**
- `frontend/e2e/axe.spec.ts` enforces `wcag2a, wcag2aa, wcag21a, wcag21aa` on 13 surface×viewport×state combinations: initial load, map view (desktop + mobile), species view + autocomplete-open (desktop + mobile), error screen, species detail no-photo (desktop + mobile), species detail with-photo (desktop + mobile), feed view, attribution modal open (desktop + mobile).
- Axe **excludes the WebGL canvas** — cluster-bubble contrast (`#51bbd6 / #f1f075 / #f28cb1` × `#1a1a1a` text in `observation-layers.ts:170–237`) is not auditable. Existing colors *happen* to clear AA on inspection (≈7.7:1 / 12.4:1 / 8.5:1) but were chosen visually, not arithmetically. (area-5 Finding 5.)

**Impact:** The CI gate catches obvious regressions but cannot catch: cluster contrast, motion under reduced-motion, behavioral SR announcements (filter changes, view switches — area-5 Finding 7), focus-order changes that are technically valid but worse UX. The redesign must self-audit these surfaces.

#### Finding 5.3: Performance budget is generous *because* of intentional minimalism

**Confidence:** High.

**Evidence (area-5 Finding 9):**
- Zero web fonts (`styles.css:68` — system stack only; no `<link rel="preconnect">` to fonts.googleapis).
- Zero CSS animation; zero motion library.
- Zero icon library — "!" notable badge is a literal char (`ObservationFeedRow.tsx:81`); chevron is unicode `▾`/`▸` (`FamilyLegend.tsx:177`); silhouettes are inline `<svg><path>` from DB.
- Zero CSS framework (no Tailwind, no styled-components — plain CSS with custom properties).
- iNat photo on detail surface: NO `loading="lazy"`, NO `srcset`, NO `width`/`height` attrs, NO blurhash. CLS mitigated *by CSS only* (`styles.css:430–437` `aspect-ratio: 4/3; object-fit: cover; max-width: 480px`).
- Bundle size baseline NOT measured here.

**Impact:** Today's perf budget is small precisely because the codebase has accepted these constraints. A redesign that adds a webfont, an icon library, a motion library, or a CSS framework directly trades perf budget for visual richness. The CSS aspect-ratio CLS mitigation is the model: a 7-line solution that solves the problem completely with the comment explaining why. Photo `loading="lazy"` + `srcset` is a 1-attribute fix that has not been made.

---

## F) Analysis & Implications

### F.1) Thematic patterns — what the findings say *together*

The five themes form a layered structure. Identity (Theme 1) is the upstream blocker; state invisibility (Theme 2) is the most user-visible failure; mobile chrome + legend (Theme 3) is the most measurable problem; design-system skeleton (Theme 4) is the structural medium through which any visual change must be expressed; the accessibility baseline (Theme 5) is the constraint envelope inside which the redesign must operate.

This is **not a visual refresh problem.** It is a decision-completion problem. The visual layer was started but several foundational decisions were deferred:

- *What is this product?* — never declared (Theme 1).
- *How does the interface communicate state?* — never decided as a system (Theme 2).
- *What's the design system's primitive layer?* — never built (Theme 4 — skeleton, not system).

The visual incoherence visible in screenshots is a **symptom** of these deferred decisions, not the cause. A visual refresh that does not address the decisions will produce the same result the current design produced: visually inconsistent surfaces that drift away from each other because no shared primitive anchors them.

### F.2) Risks & vulnerabilities — convergent across the lenses

The risk-and-opportunity synthesizer (Synth 2) and the gap-and-implication synthesizer (Synth 3) converge on the same dangerous decision: **Pattern A (bottom-tab + filter sheet) is the highest-leverage chrome improvement and the highest-risk implementation.** Three high-severity risks cluster around it:

1. **R3 — Filter-active indicator omitted.** Severity: High. Likelihood: High. Pattern A hides FiltersBar behind a trigger; without a badge showing active filters, the existing silent global-filter coupling at `App.tsx:24–29` becomes catastrophically worse. The badge is a new design-system component requirement, not a tweak.
2. **R2 — DOM-order tablist break.** Severity: High. Likelihood: Medium. Pattern A relocates SurfaceNav visually. If the implementation moves the DOM element (not just CSS-positions it), the axe-validated tablist contract breaks. The risk is *implementation discipline*, not architectural.
3. **R4 — CC BY 3.0 §4(c) Credits prominence violated.** Severity: High. Likelihood: Low. Pattern A may displace or absorb the footer Credits link; if Credits become unreachable from any surface, the legal scaffolding breaks.

**Other notable risks:**
- **R1 — Motion without `prefers-reduced-motion` guard.** High/High. Duration tokens exist; redesign has multiple motion entry points (skeleton shimmer, sheet animation, slide-over). No existing guard infrastructure.
- **R5 — Loading/empty states become *more* prominent under redesign without being fixed.** Med/High. Polished loaded state + plain placeholder = jarring discontinuity.
- **R6 — Detail surface IA seam worsens without `pushState`.** Med/Med. Polished detail surface + still-broken browser back = wider expectation gap than today.
- **R7 — FamilyLegend collapse breaks color-encoding discoverability.** Med/Med. The legend is the only labeled color key.

### F.3) Strengths & opportunities — convergent leverage points

**Three opportunities have unusually high cost-to-value ratios** (all three syntheses agree):

1. **O1 — Voice/Position B decision** closes 19 metadata gaps + onboarding + loading copy + social sharing in one declarative claim. Implementation cost near-zero. Does not require new product features.
2. **O3 — `pushState` (Option D, ~40 lines)** removes the largest user-facing IA defect before any visual work raises expectations. Pre-redesign engineering fix; not a design problem.
3. **O2 — Native `<dialog>` reuse** unifies chrome compaction (Pattern A's filter sheet) and detail IA (Option B's modal) into one overlay primitive. Lower combined cost than building either independently. Inherits the AttributionModal's battle-tested focus management.

**Other notable opportunities:**
- **O4 — Loading/empty/error state redesign captures the largest unimproved pixel surface** (730px map skeleton). Tonal ceiling already established by existing voice register; can begin immediately, in parallel to other decisions.
- **O5 — Inline-measured contrast convention extends to cluster-bubble palette** at zero new process cost.
- **O6 — Filter-active indicator** converts the existing silent flaw into an explicit user-visible feature; reads existing state, not architecture change.

### F.4) Gaps & unknowns — what the analysis cannot resolve

Four categories per Synth 3:

- **Knowable but not investigated:** G1 audience profile (PostHog, 15 min); G2 geographic precision (ingestor coverage check); G3 bundle size baseline (`npm run build`); G4 filter-active definition spec (5-line decision).
- **Knowable in principle but not from this codebase:** G5 MapLibre `easeTo` reduced-motion behavior; G6 iOS safe-area `env()` story; G7 family-color palette vs basemap-tile contrast; G8 SR announcements on filter/view changes.
- **Unknowable in advance, only resolvable through prototyping:** G9 FamilyLegend collapse discoverability impact; G10 cold-load surface behind detail Options B/C; G11 webfont voice-register congruence; G12 4-tab label legibility at 97px.
- **Stakeholder decisions, not analytical:** S1 audience; S2 voice position; S3 browser-back as product requirement; S4 map-vs-feed front door.

**The single highest-leverage piece of missing information is G1 (audience profile).** It conditions Position A's cost (low if audience is expert and self-orienting; high if general public). Every voice-position trade-off in this report carries this caveat.

---

## G) Confidence Assessment

### Overall Confidence: **High** for structural and measurement findings; **Medium-High** for design implications; **Low** for stakeholder-decision-conditioned trade-offs.

### Strongest claims (high confidence)
- **All chrome and overlay measurements** (Theme 3): live `getBoundingClientRect()` from production DOM. 138.5 / 46.6 / 185.1 / 49.0 / 273 / 433 px. Reproducible.
- **Metadata gap inventory** (Finding 1.1): 19 enumerated gaps confirmed by `curl https://bird-maps.com/`. Deterministic.
- **Token system structural facts** (Theme 4): direct file read; complete enumeration.
- **Browser-back failure** (Finding 2.4): `replaceState`-only at `url-state.ts:87`; `pushState` does not appear in the file; `popstate` listener never fires for in-app transitions.
- **Accessibility baseline inventory** (Theme 5): every item cited with file:line and axe-validation status; 13 axe-tested surface×viewport×state combinations enumerated.
- **Voice-register coherence** (Theme 1): 14 strings catalogued from source.
- **Detail-IA option trade-offs** (Iterator 3): 4 options × 2 axes; each cited file:line.

### Moderate claims (medium confidence)
- **Voice-position trade-off severity** (Theme 1): conditional on G1 (audience). Position B is structurally available; whether Position A's costs are actively painful depends on audience profile.
- **Pattern A safe-area iOS behavior** (G6): needs physical-device test.
- **Family-color contrast vs basemap tiles** (G7): not arithmetically tested.
- **MapLibre `easeTo` motion behavior** (G5): suspected leak; not verified at runtime.
- **FamilyLegend localStorage root cause** (Finding 3.2): expanded-on-mobile observed in both local and prod captures; the localStorage hypothesis is the most likely explanation but session history not directly available.

### Weakest claims (low confidence)
- **Audience profile** (G1, S1): completely unsampled. PostHog data exists in production but was not queried.
- **Existing-user mental-model switching cost** (Synth 1 blind spot): if regular users have established expectations around the current neutral-utility framing, voice shift may cost more than analysis suggests.
- **SR narrative on filter changes / view changes** (G8): no NVDA/VoiceOver pass conducted.
- **Aesthetic register direction**: the analysis is structure-heavy, light on "what should it feel like." Aesthetic direction is downstream of the analysis, not derivable from it.

### Known blind spots
- **Real user behavior is entirely absent.** All evidence is structural (code, measurements, visual states). No session recordings, support tickets, usage analytics, or user interviews. Themes 1 and 2 rest on designer-inference about user experience.
- **Performance as a design constraint is underweighted.** Bundle size unmeasured; render-budget for any motion language is theoretical; MapLibre tile-load sequencing unaudited.
- **Map surface treated as a visual-layer constant.** The scope constraint excludes interactive behavior. If that's relaxed (e.g., legend interaction redesigned, not just its housing), Theme 3's dependency graph changes materially.
- **Touch interaction depth was not captured.** Screenshots cover viewports; measurements cover pixels. No capture of touch target sizes in interactive use, swipe gesture conflicts with MapLibre pan, or tap-highlight states.

---

## H) Recommendations

Six high-level recommendations. Each names priority, rationale (which findings support), trade-offs, and open questions.

### Recommendation 1: Commit to Position B (opinionated utility) voice as Phase 0

**Priority:** High.

**Rationale:** Theme 1 (Findings 1.1, 1.2) — voice is the upstream bottleneck for 19 metadata gaps + onboarding + loading copy + social sharing. Position C is structurally unavailable (no participation features). Position A has documented ongoing costs. Position B requires no new features and closes everything with a single declarative claim (e.g., "Recent Arizona bird sightings, updated in real time from eBird"). All three syntheses converge on this as decision #1.

**Trade-offs:** Position B requires committing to specific, accurate claims. If geographic coverage (G2) is narrower than all of Arizona, the claim must be more precise. The commitment creates accountability — if data is stale, the headline is factually wrong. Existing regular users may have established mental models around the neutral framing; voice shift may carry switching costs.

**Open questions:** Q1 (audience profile — conditions trade-off severity); Q2 (geographic precision — conditions claim accuracy).

### Recommendation 2: Treat browser-back as a pre-redesign engineering fix (Option D, ~40 lines)

**Priority:** High.

**Rationale:** Finding 2.4 — `replaceState`-only at `url-state.ts:87` is a fundamental violation of user expectation across all four surfaces. Iterator 3 Finding 4 quantifies the fix as ~40 lines across three files. Fixing this before the visual redesign means designers do not have to design around broken navigation; users get a polished experience that does not violate their expectations more loudly than today. Synth 3 Conclusion 3 makes this explicit.

**Trade-offs:** `pushState` introduces a growing history stack — users who visit 10 detail pages and press back 10 times traverse all of them before exiting. Standard browser behavior, but should be explicitly accepted.

**Open questions:** Q3 (is browser-back a product requirement?). If YES → Option D is mandatory; if NO → still recommended, but lower priority.

### Recommendation 3: Begin loading/empty/error state visual language *immediately*

**Priority:** High.

**Rationale:** Findings 2.2, 2.3, 4.4. The map skeleton is 730px of cream-on-cream text — the largest empty surface by pixel area. Loading and empty states are visually identical today; error severity and visual treatment are inverted. The voice register is already coherent (Iterator 4 Finding 4) and sets the tonal ceiling without waiting for the voice decision. Duration tokens are reserved and unused — a redesign that adds motion has tokens to consume without adding values. This work does NOT block on R1 (voice decision).

**Trade-offs:** A redesign that introduces motion here is the codebase's first motion CSS — must wrap every site in `@media (prefers-reduced-motion: reduce)`. The MapLibre `easeTo` audit (G5) should be done at the same time.

**Open questions:** Q4 (MapLibre `easeTo` reduced-motion behavior — needs runtime test).

### Recommendation 4: Design Pattern A and detail Option B as one overlay system

**Priority:** High.

**Rationale:** Theme 4 and Iterator 2/3. Pattern A's filter sheet and detail Option B's modal both reach for the AttributionModal's native `<dialog>` machinery (`AttributionModal.tsx:182–261`). Designing them together — one overlay primitive, shared focus management, shared ESC, shared backdrop — costs less than designing two independent systems and avoids drift. Synth 2 names this O2 (highest-leverage opportunity for unification).

**Trade-offs:** Coupling two design decisions means delivery is bound — if one is delayed, the other is too. The `<dialog>` element has cold-load behavior implications for detail Option B (modal over blank surface unless a default underlying surface is chosen — G10).

**Open questions:** Q5 (cold-load surface behind detail dialog); Q6 (whether Pattern A's filter sheet absorbs the FamilyLegend, which compounds with Q7).

### Recommendation 5: Specify the filter-active indicator before chrome compaction design begins

**Priority:** High.

**Rationale:** Finding 2.1, Iterator 2 Finding 6. Every chrome compaction pattern that hides filters (A/B/C) requires a filter-active indicator. The current global filter coupling silently affects non-current surfaces. Without a badge, hiding filters worsens the silent failure. The badge is a new design-system component requiring an explicit "what counts as active" specification (a filter is active when its value differs from its URL-state default — `url-state.ts:15–22`).

**Trade-offs:** This adds a new component to a codebase that has been deliberately minimal. The badge becomes a permanent visual element on persistent chrome. Its visual weight must not compete with primary actions.

**Open questions:** Q8 (filter-active definition spec — should be explicit before badge UI is designed).

### Recommendation 6: Prototype the FamilyLegend treatment before committing

**Priority:** Medium-High.

**Rationale:** Finding 3.2 + G9. The FamilyLegend covers 44.8% / 57.6% of main and is the single largest UX obstruction. Two clean solutions exist: (a) fix mobile-default behavior (small code change, no design implication); (b) migrate into Pattern A's filter sheet (solves both Theme 3 problems at once). But the legend is the only labeled color key for the family-color encoding. Discoverability impact of collapse-without-replacement is unknowable analytically — only resolvable through prototype testing per the CLAUDE.md prototype gate (≥344 rows, both viewports, all interactive surfaces exercised).

**Trade-offs:** Solution (a) is faster but does not solve the desktop overlay (57.6% of main, worse than mobile). Solution (b) couples to Pattern A delivery. Either solution must address how a new user discovers the family-color encoding.

**Open questions:** Q7 (family-color discoverability after legend collapse).

---

## I) Open Questions

Eight questions this analysis surfaced but did not answer.

### Q1: Who is the intended audience?

**Why it matters:** Conditions every voice-position trade-off in Theme 1. Position A's cost is low if audience is expert and self-orienting; high if general public.

**Suggested approach:** 15-minute PostHog dashboard read (`AttributionModal.tsx:536` confirms PostHog runs). Look at: bounce rate, mobile/desktop split, session duration, return rate. Expert birders → long sessions, frequent return, low bounce. General public → high bounce, short sessions, no return.

### Q2: Is "Arizona" appropriately broad, or does the data cover only a sub-region?

**Why it matters:** Position B requires accurate claims. eBird API call is `/data/obs/US-AZ/recent` (CLAUDE.md) — all of Arizona. But ingest coverage (which counties have observations, which don't) is not audited. If coverage is concentrated, the claim should be more precise.

**Suggested approach:** Inspect ingestor + Postgres data for county-level distribution. Check whether the 9 visible map regions in `local/desktop/01-map-default.png` correspond to named subregions that could be surfaced.

### Q3: Is browser-back navigation a product requirement?

**Why it matters:** Determines whether Option D (`pushState`) is mandatory pre-redesign or recommended but optional.

**Suggested approach:** PostHog session recordings (if enabled) — look for repeated back-button-then-bounce patterns on detail surface. Alternative: ask users / community.

### Q4: Does MapLibre `easeTo` honor `prefers-reduced-motion`?

**Why it matters:** Suspected motion-leak today (`MapCanvas.tsx:729`). If confirmed, any motion language redesign must guard this site.

**Suggested approach:** Set `prefers-reduced-motion: reduce` in macOS Accessibility, navigate to map, click a cluster. If camera animates: add `if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { map.jumpTo(...) } else { map.easeTo(...) }`.

### Q5: What surface renders behind a cold-loaded `?view=detail&detail=<code>` URL under detail Option B (modal)?

**Why it matters:** A user opening a shared detail-link in a new tab sees a modal over an empty/blank surface with no obvious "go back" affordance.

**Suggested approach:** Pragmatic decision — default to Feed surface behind the modal (matches DEFAULTS.view='feed'). Document explicitly. Or prototype both (Feed-behind, blank-behind) and pick.

### Q6: Should Pattern A's filter sheet absorb the FamilyLegend?

**Why it matters:** Solves Theme 3's two independent problems with one component but couples chrome compaction and legend treatment into a single delivery.

**Suggested approach:** Prototype both variants (legend-in-sheet vs. legend-stays-on-map-with-fixed-mobile-default) and test discoverability of family colors per Q7.

### Q7: Does collapsing or migrating the FamilyLegend break family-color discoverability?

**Why it matters:** The legend is the only labeled color key for the map's family-color encoding. Collapse-without-replacement leaves new users with no way to learn what colors mean.

**Suggested approach:** Prototype with collapsed legend; test with 3–5 representative users per the CLAUDE.md prototype-gate protocol (≥344 rows, mobile + desktop, all interactive surfaces exercised).

### Q8: What is the precise definition of "filter active" for the badge count?

**Why it matters:** Required before the indicator can be designed (Recommendation 5).

**Suggested approach:** Explicit spec: a filter is active when its URL-state value differs from `DEFAULTS` in `url-state.ts:15–22` (`since='14d'`, `notable=false`, `familyCode=null`, `speciesCode=null`). Badge count = number of filters where `value !== default`. 5-line decision.

---

## J) Evidence Index

Mapping of major findings to their evidence sources. Comprehensive but not exhaustive — full traceability lives in the phase-1/phase-2 artifacts.

| Finding | Evidence Source | Type | Location |
|---|---|---|---|
| 1.1 — No declared identity, 19 metadata gaps | `curl https://bird-maps.com/` | data | live HTTP response |
| 1.1 — Title-only brand surface | `frontend/index.html:5` | code | direct read |
| 1.1 — No About / no rendered name | `frontend/src/App.tsx`, all surfaces | code | full file read |
| 1.1 — Default surface is Feed | `frontend/src/state/url-state.ts:15–22` | code | DEFAULTS.view='feed' |
| 1.2 — eBird redirects unauth to login | `https://ebird.org/` | data | WebFetch |
| 1.2 — BirdCast structural peer | `https://birdcast.info/` | data | WebFetch |
| 2.1 — Filters apply globally, no indicator | `frontend/src/App.tsx:24–29, 91–96` | code | hook call signature |
| 2.1 — FiltersBar shows no active state | `frontend/src/components/FiltersBar.tsx:64–124` | code | full read |
| 2.2 — Loading + empty visually identical | `frontend/src/styles.css:268, 354, 457, 696` | code | all .empty/.loading classes |
| 2.2 — Map skeleton 730px cream-on-cream | `frontend/src/components/MapSurface.tsx:148–165` + capture | code+visual | inline style + `states/desktop/map-loading-skeleton.png` |
| 2.3 — Error styling inverted | `frontend/src/styles.css:88–92, 519–527` + `App.tsx:143–150` | code | direct read + capture `states/{desktop,mobile}/app-error-screen.png` |
| 2.4 — `replaceState`-only architecture | `frontend/src/state/url-state.ts:87, 97–101` | code | full file read |
| 2.4 — Detail surface no close affordance | `frontend/src/components/SpeciesDetailSurface.tsx:112–118` | code | source comment |
| 3.1 — Mobile chrome 185.1px / 21.9% | Live DOM `getBoundingClientRect()` | observation | Iterator 5 measurements |
| 3.1 — Desktop chrome 99.1px / 11.0% | Live DOM `getBoundingClientRect()` | observation | Iterator 5 measurements |
| 3.2 — FamilyLegend 44.8% mobile / 57.6% desktop | Live DOM measurements | observation | Iterator 5 |
| 3.2 — Legend expanded by default observed in prod | `local/mobile/01-map-default.png`, `prod/mobile/01-map-default.png` | visual | screenshot |
| 3.2 — `LEGEND_EXPAND_MIN_WIDTH=760` logic | `frontend/src/components/MapSurface.tsx:22–31` | code | direct read |
| 3.2 — localStorage persistence | `frontend/src/components/FamilyLegend.tsx:135–138` | code | `stored ?? defaultExpanded` |
| 3.3 — Two species inputs | `frontend/src/components/FiltersBar.tsx:101–122`, `SpeciesAutocomplete.tsx`, `SpeciesSearchSurface.tsx:25–30, 47–50` | code | full reads + capture `local/{desktop,mobile}/03-species-search.png` |
| 4.1 — Two-layer token system | `frontend/src/tokens.ts:1–16`, `frontend/src/styles.css:1–63` | code | both files |
| 4.1 — DB family palette outside CSS surface | `frontend/src/tokens.ts:124–158`, `data/family-color.ts` | code | direct |
| 4.1 — No design-system package | `frontend/package.json` | code | dependency list |
| 4.2 — 35+ font-size literals | `frontend/src/styles.css` (multiple) | code | grep |
| 4.3 — 9 distinct radius literals | `frontend/src/styles.css` (multiple) | code | grep |
| 4.4 — 14 distinct copy+class state pairs | Iterator 4 voice inventory + CSS classes | code | full inventory |
| 4.5 — Duration tokens reserved, unused | `frontend/src/tokens.ts:115–122`, `frontend/src/styles.css:16–18` | code | direct read |
| 4.5 — Zero motion CSS | `frontend/src/styles.css` | code | grep `transition\|animation\|@keyframes` |
| 4.5 — No `prefers-reduced-motion` | `frontend/src/` | code | grep |
| 5.1 — Landmark order axe-enforced | `frontend/src/App.tsx:155–257`, `axe.spec.ts:8–20` | code | full read + comment at App.tsx:227–231 |
| 5.1 — WAI-ARIA tablist contract | `frontend/src/components/SurfaceNav.tsx:79–108, 40–73, 22–26, 76–82` | code | full read |
| 5.1 — Native `<dialog>` modal | `frontend/src/components/AttributionModal.tsx:182–261` | code | full read |
| 5.1 — Focus-visible uniformity | `frontend/src/styles.css` (~6 sites) | code | grep |
| 5.1 — Inline contrast measurements | `frontend/src/styles.css:243–264, 507–512` | code | direct |
| 5.1 — 44px content-row min-height | `frontend/src/styles.css:179, 135–137` | code | iOS HIG citation |
| 5.2 — 13 axe-tested combinations | `frontend/e2e/axe.spec.ts` (full file) | code | enumeration |
| 5.2 — Canvas excluded from axe | `axe.spec.ts:24–32` | code | comment |
| 5.3 — System-stack font, no @font-face | `frontend/src/styles.css:68`, `frontend/index.html` | code | direct |
| 5.3 — No icon library | `frontend/package.json`, `ObservationFeedRow.tsx:81`, `FamilyLegend.tsx:177` | code | dependency + char usage |
| 5.3 — iNat photo no `loading="lazy"` | `frontend/src/components/SpeciesDetailSurface.tsx:63–71` | code | JSX inspection |
| 5.3 — CLS mitigated by aspect-ratio CSS | `frontend/src/styles.css:430–437` (with rationale comment 425–429) | code | direct |

**Capture inventory:** 31 PNGs in `tmp/redesign-analysis/screenshots/{local,prod}/{desktop,mobile}/` covering all 4 surfaces × 2 viewports × prod+local + 1 filter state + AttributionModal × 2 viewports. 17 additional non-loaded-state captures in `tmp/redesign-analysis/screenshots/states/{desktop,mobile}/`.

**Phase artifacts:** `tmp/redesign-analysis/funnel/{phase-0,phase-1,phase-2,phase-3}/`. Context packets at `funnel/context-packets/phase-{0..3}-packet.md`.

---

*End of analysis report. The redesign brief begins where this analysis ends.*
