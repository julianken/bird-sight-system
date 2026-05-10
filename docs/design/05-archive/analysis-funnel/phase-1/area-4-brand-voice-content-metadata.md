# Investigation: Brand, Voice, Content, and Metadata

## Summary

bird-maps.com is a zero-brand utility. The site title "bird-watch — Arizona" is the only brand signal present in the HTML or rendered UI; there is no logo, tagline, About surface, or introductory copy anywhere in the application. The voice register is terse and functional throughout all four surfaces, with micro-copy that guides rather than welcomes. Metadata is stripped to the minimum: no `<meta name="description">`, no OG tags, no Twitter card, no favicon asset, no manifest — every social unfurl falls back to bare URL only. Attribution to six external data sources is handled rigorously in a dedicated modal (eBird, Phylopic, OpenStreetMap, OpenFreeMap, Wikipedia, iNaturalist), but that thoroughness lives hidden behind a "Credits" button in the footer and contributes nothing to brand coherence on first load. The site's purpose — recent Arizona bird sightings from eBird on an interactive map — is never stated to first-time visitors.

---

## Key Findings

### Finding 1: Site title is the sole brand signal; it exists only in source

- **Evidence:** `frontend/index.html:5` — `<title>bird-watch — Arizona</title>`. The curl of `https://bird-maps.com/` returns the identical string (curl output, line 5 of response). No `<link rel="icon">`, no `<link rel="apple-touch-icon">`, no `<link rel="manifest">` appear anywhere in either the source file or the live response.
- **Confidence:** high — live curl confirmed; no public/ directory exists in the repo (`frontend/` contains no `public/` subdirectory; `find` returned empty).
- **Implication:** The brand name "bird-watch — Arizona" is real — the em-dash construction gives it a specific, distinctive flavor — but it surfaces only in the browser tab. No rendered element on any of the four surfaces displays it as visible text (not in FiltersBar, not in SurfaceNav, not in any surface heading). A user whose tab is buried does not see the brand at all.

### Finding 2: Favicon is absent as an asset; prod serves SPA HTML as a 404-masking fallback

- **Evidence:** No favicon file exists in `frontend/` (no `public/` dir, no `.ico` file found by `find`). Prod curl of `https://bird-maps.com/favicon.ico` returns HTTP 200 with `content-type: text/html` — Cloudflare Pages SPA fallback intercepts the missing asset and serves `index.html`. The phase-0 packet references a favicon resource failure in the local build console log. The `frontend/index.html` carries no `<link rel="icon">` tag (confirmed line-by-line read).
- **Confidence:** high — source, curl body, and directory scan all agree.
- **Implication:** Browser tabs and bookmarks display a browser-default generic icon. iOS home-screen add and PWA install flows have no asset to display. The "200 but HTML" masking on prod means automated checkers will not flag the 404, so this is easy to leave unfixed indefinitely.

### Finding 3: Metadata is at absolute minimum — every social unfurl degrades to bare URL

- **Evidence:** Full prod HTML source (curl) confirms only three tags in `<head>`:
  `<meta charset="UTF-8" />`,
  `<meta name="viewport" content="width=device-width, initial-scale=1.0" />`,
  `<title>bird-watch — Arizona</title>`.
  Tags confirmed absent:
  - `<meta name="description">` — absent
  - `<meta property="og:title">` — absent
  - `<meta property="og:description">` — absent
  - `<meta property="og:image">` — absent
  - `<meta property="og:url">` — absent
  - `<meta property="og:type">` — absent
  - `<meta name="twitter:card">` — absent
  - `<meta name="twitter:title">` — absent
  - `<meta name="twitter:image">` — absent
  - `<meta name="theme-color">` — absent
  - `<link rel="canonical">` — absent
  - `<link rel="manifest">` — absent
  - `<link rel="apple-touch-icon">` — absent
- **Confidence:** high — line-by-line read of both `frontend/index.html` and curl output.
- **Implication:** iMessage, Slack, Twitter/X, and LinkedIn unfurls will render as a plain URL string with no image, no description, and no custom title beyond what the platform's scraper infers. This is the worst-case social sharing experience.

### Finding 4: Voice register is terse, functional, and internally consistent — but cold on first load

The complete copy inventory by surface:

**FiltersBar (persistent chrome, all surfaces x both viewports):**
- Visible labels: "Time window", "Notable only", "Family", "Species"
- Select option labels: "Today", "7 days", "14 days", "30 days", "All families"
- Placeholder: "Common name" (`FiltersBar.tsx:107`)
- Register: noun phrases only; no verbs, no elaboration.

**SurfaceNav (persistent chrome, all surfaces x both viewports):**
- Tab labels: "Feed", "Species", "Map" (`SurfaceNav.tsx:23-26`)
- Accessible names: "Feed view", "Species view", "Map view"
- Register: single-word nouns; zero description of what each surface does.

**Feed surface (desktop + mobile):**
- Loading state: "Loading observations…" (`FeedSurface.tsx:96`)
- Sort controls: "Recent", "Taxonomic" (radio group, `FeedSurface.tsx:135,143`)
- Empty (notable+window): "No notable sightings in this window. Try widening the time window or turning off Notable only." (`FeedSurface.tsx:104`)
- Empty (today, 1d): "No observations reported today. Try expanding the time window." (`FeedSurface.tsx:106`)
- Empty (catch-all): "No observations to show." (`FeedSurface.tsx:108`)
- Feed row data: species common name, count chip (xN), location name, relative time — no editorial framing.
- Notable badge: "!" (visible), "Notable sighting" (screen reader, `ObservationFeedRow.tsx:62,80`)

**Map surface (desktop + mobile):**
- Skip link: "Skip to species list" (`MapSurface.tsx:143`)
- Loading skeleton: "Loading map…" (`MapSurface.tsx:162`)
- Map error: "Map failed to load" / "The map could not be displayed. Try refreshing the page." (`MapSurface.tsx:128-129`)
- FamilyLegend header: "Bird families in view" (`FamilyLegend.tsx:175`)
- FamilyLegend toggle chevron: "▾" / "▸" (no text label; accessible via `aria-expanded`)
- Entry count: "{N} observations in view" (screen reader, `FamilyLegend.tsx:201`)

**Species surface (desktop + mobile):**
- Autocomplete placeholder: "Start typing a species…" (`SpeciesAutocomplete.tsx:279`)
- Prompt (no selection): "Start typing a species name to explore its recent sightings." (`SpeciesSearchSurface.tsx:54`)
- Loading: "Loading observations…" (`SpeciesSearchSurface.tsx:60`)
- Empty (species selected, no results): "No recent sightings for this species in the current window." (`SpeciesSearchSurface.tsx:66`)

**Detail surface (desktop + mobile):**
- Loading: "Loading species details…" (`SpeciesDetailSurface.tsx:201`)
- Error: "Could not load species details" (`SpeciesDetailSurface.tsx:207`)
- Data fields: common name (h2), scientific name (em), family name (p) — labels are implicit in visual hierarchy, not explicit field labels.
- Wikipedia credit inline: "From Wikipedia, CC BY-SA" (`SpeciesDescription.tsx:76-81`)

**App-level error screen (all surfaces):**
- "Couldn't load bird data" / `error.message` pass-through (`App.tsx:146-148`)

**Attribution modal (accessible from all surfaces, both viewports):**
- Trigger: "Credits" button (`AttributionModal.tsx:281`)
- Modal title: "Credits"
- Sections and prose:
  - "Bird Sightings Data" / "Bird sightings provided by eBird (Cornell Lab of Ornithology)." (`AttributionModal.tsx:303-313`)
  - "Family Silhouettes" / "Family silhouettes from PhyloPic. Per-silhouette credits:" (`AttributionModal.tsx:354-356`)
  - "Photos" / "Species photos by [photographer] — [license]. Photos sourced from iNaturalist." (`AttributionModal.tsx:437-459`)
  - "Species descriptions" / "Species descriptions adapted from Wikipedia under CC BY-SA. See each species panel for a per-article link." (`AttributionModal.tsx:487-499`)
  - "Map Tiles" / "Base map data © OpenStreetMap contributors, tile hosting by OpenFreeMap." (`AttributionModal.tsx:505-521`)
  - "Privacy" / "Usage analytics via PostHog. Respects Do Not Track. No session recordings or personal data collected." (`AttributionModal.tsx:536-539`)
  - Error state: "Couldn't load silhouette attributions — try again later." (`AttributionModal.tsx:334`)
  - Loading state: "Loading silhouette attributions…" (`AttributionModal.tsx:338`)
  - Empty state: "No silhouette attributions available." (`AttributionModal.tsx:342`)
  - Close button: "Close" / aria-label "Close credits" (`AttributionModal.tsx:297-298`)

- **Confidence:** high — all strings sourced directly from component files with line citations.
- **Implication:** Voice is consistent in register (terse, functional, lowercase nouns) but consistently cold. There is no editorial warmth, no sense of community, and no invitation to explore. "Loading observations…" and "No observations to show." convey no personality. The register is appropriate for a developer-built utility; it would need to change if the redesign targets casual birders.

### Finding 5: No "why this exists" surface — zero onboarding or first-visit framing

- **Evidence:** No About page, no route defined for `/about`, no router at all (App.tsx uses URL params not routes). No landing copy, no tagline rendered in any component. The spec (`docs/specs/2026-04-16-bird-watch-design.md:8`) states the goal — "let a user wander Arizona visually and discover what birds have been seen where, recently" — but this prose exists only in a markdown file, not on screen. The README describes the site as "Visualize Arizona bird sightings on a real-geographic map" but that is developer documentation, not UI copy. First load renders FiltersBar + SurfaceNav + the feed (default view=feed) immediately populated with observation rows; there is no interstitial, splash, or zero-data-state introduction.
- **Confidence:** high — all four surface components read; no welcome/intro component exists in `frontend/src/components/`.
- **Implication:** First-time visitors land directly on observation data with no context. "Feed" as a tab label does not communicate what it contains. A new visitor who does not understand eBird or bird citizen-science has no orientation. The map surface is the most visually impressive entry but is not the default.

### Finding 6: Six external attributions present — attribution is thorough but architecturally hidden

- **Evidence:** All six data partners are credited in `AttributionModal.tsx`: eBird (`l.303-313`), Phylopic (`l.354-356`), OpenStreetMap (`l.505`), OpenFreeMap (`l.519-520`), Wikipedia (`l.487-499`), iNaturalist (`l.452-459`). The per-species Wikipedia credit also appears inline in `SpeciesDescription.tsx:76-81` ("From Wikipedia, CC BY-SA"). No attribution copy appears on any surface in normal visible flow outside these two locations. The Credits modal trigger is a text-only button in the footer, last item in document order.
- **Confidence:** high — full component reads confirm this is the complete attribution register.
- **Implication:** Attribution is legally comprehensive (eBird ToU, CC license, ODbL compliance documented in `AttributionModal.tsx:10-17`). From a brand perspective, the partners — eBird, Cornell Lab, Phylopic, Wikipedia, iNaturalist, OpenStreetMap — are prestigious and could be surfaced as trust signals rather than buried in a modal. Currently they signal nothing to first-time visitors.

### Finding 7: Wikipedia species descriptions are third-party prose — not rewritable by a redesign

- **Evidence:** `SpeciesDescription.tsx:56-84` injects sanitized HTML from the database field `species_descriptions.body`, which is sourced from Wikipedia's REST API at ingest time. The attribution comment in `AttributionModal.tsx:471-475` confirms "descriptions exist for >85% of species." The inline credit "From Wikipedia, CC BY-SA" is a license requirement and is non-negotiable.
- **Confidence:** high.
- **Implication:** The species detail surface has substantial prose content (Wikipedia summaries) but that prose is not the site's voice — it is Wikipedia's encyclopedic style, rendered verbatim. A redesign cannot rewrite these descriptions. The design must frame third-party prose gracefully and distinguish it visually from the site's own copy.

### Finding 8: Story coherence — recency-driven discovery, no stated narrative

- **Evidence:** The spec (`docs/specs/2026-04-16-bird-watch-design.md:8`) and README both frame the site as "recent Arizona bird sightings." The default SurfaceNav tab is "Feed" with sort defaulting to "Recent" (`FeedSurface.tsx:64` — `useState<FeedSortMode>('recent')`). The FiltersBar defaults to a time window (`since` param) which gates all data. The site's identity is built around recency and place (Arizona), but neither word "recent" nor "Arizona" appears in any rendered surface copy outside the `<title>` tag (where "Arizona" appears once).
- **Confidence:** high.
- **Implication:** "Recent" and "Arizona" are the two story pillars that actually distinguish this site from global platforms like eBird, iNaturalist, and Merlin, but neither pillar is visible in the UI itself. A designer needs to decide whether to surface this story or leave the site as a neutral utility.

---

## Surprises

- The FamilyLegend has the site's richest visible copy ("Bird families in view") — it is the most descriptive label on the map surface, yet it lives inside a collapsible panel toggle, not as a surface heading.
- Wikipedia descriptions inject dense encyclopedic paragraphs that are markedly different in register and length from the terse app copy around them. This contrast is likely jarring but is currently unmarked by any visual framing.
- The error screen at `App.tsx:146-148` passes `error.message` directly into a `<p>` element. Raw API or network error strings may appear in production. This is a voice inconsistency: every other error state uses crafted copy, but the top-level error exposes the raw exception message.
- `frontend/index.html` has no `<link rel="icon">` at all — not even a reference to a missing file. The absence is total; there is no attempt to load a favicon.
- The modal section "Privacy" (PostHog disclosure) sits as the last section of the Credits modal alongside artistic attribution prose. The two concerns share a dialog without visual separation beyond section headings.

---

## Unknowns & Gaps

- **`theme-color` value:** No `<meta name="theme-color">` exists. A designer specifying a palette will need to add this; `#f4f1ea` appears as the map loading skeleton background color in an inline style at `MapSurface.tsx:159`, which may approximate the intended background tone, but this has never been canonically designated as a brand color.
- **Default `view` on load:** The phase-0 packet confirms view defaults to `feed`. Whether "Feed" or "Map" is the better first surface for brand impression is a design question this investigation can flag but not resolve.
- **Tab title dynamism:** The `<title>` is static ("bird-watch — Arizona") across all views and species. A redesign could make it surface-aware (e.g., "Vermilion Flycatcher — bird-watch Arizona") but no mechanism for this exists today.
- **MapLibre's own OSM attribution:** MapCanvas renders its own OSM credit inline in the map canvas (referenced in `AttributionModal.tsx:4` as "MapCanvas customAttribution"). Its visual rendering — position, legibility, styling — is a brand surface in the map view that was not inspected in this pass and may need alignment with the redesign's attribution approach.
- **Manifest and PWA scope:** No `manifest.json` or `site.webmanifest` exists. PWA installability is entirely absent; whether this is in redesign scope is undetermined.

---

## Enumerated Gap List (metadata and brand)

1. **No `<meta name="description">`** — every search-engine snippet and social unfurl falls back to platform-inferred text or bare URL.
2. **No `<meta property="og:title">`** — Slack, iMessage, LinkedIn show raw URL or inferred page title only.
3. **No `<meta property="og:description">`** — Open Graph description absent.
4. **No `<meta property="og:image">`** — every social share card has no image.
5. **No `<meta property="og:url">`** — canonical share URL is unset.
6. **No `<meta property="og:type">`** — defaults to platform-specific behavior.
7. **No `<meta name="twitter:card">`** — Twitter/X renders plain URL only, no card.
8. **No `<meta name="twitter:title">`** — absent.
9. **No `<meta name="twitter:image">`** — absent.
10. **No `<meta name="theme-color">`** — browser chrome color (Android Chrome, Safari iOS) unset.
11. **No `<link rel="canonical">`** — query-param URLs are not declared canonical or non-canonical.
12. **No `<link rel="manifest">`** — PWA install, home-screen icon, display-mode customization all unavailable.
13. **No `<link rel="apple-touch-icon">`** — iOS home-screen add uses a browser-generated screenshot thumbnail.
14. **No favicon asset** — `frontend/` has no `public/` dir and no icon file; prod serves SPA HTML for `/favicon.ico` requests (HTTP 200, `content-type: text/html`).
15. **No rendered brand name** — "bird-watch — Arizona" exists only in `<title>`; no surface renders it as visible text.
16. **No tagline or site description visible to users** — purpose is implicit in the data, not stated.
17. **No About or onboarding surface** — first-time visitors have no orientation to the site's purpose.
18. **No dynamic `<title>`** — tab title is static regardless of surface or species selected.
19. **`error.message` exposed raw** — `App.tsx:148` renders the raw error object's `.message` property in production UI; all other error states use crafted copy.

---

## Raw Evidence

Files read in full:
- `/Users/j/repos/bird-watch/tmp/redesign-analysis/funnel/context-packets/phase-0-packet.md`
- `/Users/j/repos/bird-watch/tmp/redesign-analysis/funnel/phase-0/analysis-brief.md`
- `/Users/j/.claude/skills/analysis-funnel/references/phase-templates.md`
- `/Users/j/repos/bird-watch/frontend/index.html`
- `/Users/j/repos/bird-watch/frontend/src/components/AttributionModal.tsx`
- `/Users/j/repos/bird-watch/frontend/src/components/SpeciesDescription.tsx`
- `/Users/j/repos/bird-watch/frontend/src/components/FeedSurface.tsx`
- `/Users/j/repos/bird-watch/frontend/src/components/SpeciesDetailSurface.tsx`
- `/Users/j/repos/bird-watch/frontend/src/components/SpeciesSearchSurface.tsx`
- `/Users/j/repos/bird-watch/frontend/src/components/FiltersBar.tsx`
- `/Users/j/repos/bird-watch/frontend/src/components/SurfaceNav.tsx`
- `/Users/j/repos/bird-watch/frontend/src/components/MapSurface.tsx`
- `/Users/j/repos/bird-watch/frontend/src/components/ObservationFeedRow.tsx`
- `/Users/j/repos/bird-watch/frontend/src/App.tsx` (lines 1-100 and 100-259)
- `/Users/j/repos/bird-watch/frontend/src/components/FamilyLegend.tsx` (selectively)
- `/Users/j/repos/bird-watch/frontend/src/components/SpeciesAutocomplete.tsx` (selectively)
- `/Users/j/repos/bird-watch/README.md`
- `/Users/j/repos/bird-watch/docs/specs/2026-04-16-bird-watch-design.md` (first 80 lines)

Shell commands run:
- `curl -s https://bird-maps.com/` — confirmed live head matches `frontend/index.html` exactly; no additional tags added by build or CDN.
- `curl -sI https://bird-maps.com/favicon.ico` — confirmed HTTP 200 with `content-type: text/html` (SPA fallback, not a real icon file).
- `curl -s https://bird-maps.com/favicon.ico | head -5` — confirmed body is SPA HTML, not binary icon data.
- `find /Users/j/repos/bird-watch/frontend -name "favicon*" -o -name "*.ico" -o -name "manifest.json"` — returned empty; no icon or manifest assets exist.
- `ls /Users/j/repos/bird-watch/frontend/dist/` — confirmed no favicon in built output.
- `grep -rn` scans across `frontend/src/` for all visible copy strings (loading states, empty states, error states, labels, placeholders, aria-labels).

Screenshot files consulted as visual reference:
- `tmp/redesign-analysis/screenshots/prod/desktop/01-map-default.png` through `05-attribution-modal.png`
- `tmp/redesign-analysis/screenshots/prod/mobile/01-map-default.png` through `05-attribution-modal.png`
- `tmp/redesign-analysis/screenshots/local/desktop/06-map-notable-30d.png`
