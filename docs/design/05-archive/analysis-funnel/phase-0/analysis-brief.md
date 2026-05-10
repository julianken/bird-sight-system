# Phase 0: Analysis Brief — bird-maps.com Site Redesign

## 1. Analysis Question

**What should inform a redesign of the bird-maps.com site (the surrounding application — chrome, navigation, surfaces, content, brand, type, color, density), holding the live MapLibre map *behavior* constant and only theming the map's visual layer?**

Sub-questions:

- What is the site doing well today that a redesign must not break?
- What weaknesses in IA, visual hierarchy, brand voice, content, accessibility, and responsive behavior are observable now?
- Where is the largest gap between the site's stated purpose ("recent Arizona bird observations from eBird") and what users actually experience on first load?
- Which design choices are deeply coupled to the codebase (and therefore expensive to redesign) vs. cosmetic (and therefore cheap)?
- What tokens / abstractions / structural choices already exist that a redesign should build on top of rather than replace?

## 2. Context (established before this analysis)

- The system shipped to **bird-maps.com** on 2026-04-19 and is live (CLAUDE.md, repo state).
- Frontend lives under `frontend/` (npm workspace `@bird-watch/frontend`); React 18 + Vite 8 + TypeScript; MapLibre 5; no router (URL-state lives in query params via `useUrlState`).
- Four primary surfaces driven by `state.view`: `feed`, `map`, `species`, `detail` (App.tsx:155–219).
- Persistent FiltersBar across the top, SurfaceNav (tablist), main, contentinfo footer with Credits → AttributionModal (App.tsx:155–256).
- Plan 4 (frontend) shipped under prototype-gate discipline; Plan 7 ("map v1") added the live MapLibre map. Phenology, wiki descriptions, iNat photos all subsequently shipped (#358, #368).
- Existing design tokens live in `frontend/src/tokens.ts` and `frontend/src/styles.css` — exact scope to be discovered in Phase 1.
- Prior analysis-funnel artifacts exist at `docs/analyses/2026-04-20-frontend-map-analysis/` (memory: `project_frontend_map_analysis.md`) — Phase 1 should consult those rather than re-discover.
- Live captures already in `tmp/redesign-analysis/screenshots/{local,prod}/{desktop,mobile}/` covering map, feed, species-search, species-detail, attribution-modal, and filtered map states.
- 31 captured PNGs (15 local + 16 prod, two viewports each).

## 3. Scope

**In bounds:**

- The four surfaces (`feed`, `map`, `species`, `detail`) — chrome, layout, type, color, hierarchy, density, transitions, motion language.
- FiltersBar, SurfaceNav, AttributionModal, all error/loading/empty states.
- Mobile (390×844) and desktop (1440×900) — the two release-1 viewports.
- Brand identity: voice, tone, naming ("bird-watch — Arizona"), favicon (currently a 404 — observed), social/OG metadata (currently absent — `index.html` confirms no `<meta name="description">`, no OG tags).
- The map's visual *theme* (basemap style choice, marker palette, FamilyLegend treatment) — not its rendering or interactivity behavior.
- Information architecture: how surfaces relate, how a user navigates between them, how URL state and IA align.
- Accessibility (focus order, contrast, motion, keyboard).
- Performance budget *as it relates to design choices* (e.g., webfonts, image weight, animation cost).
- Content strategy: descriptions, attribution, empty states, copy register.

**Out of bounds:**

- Map clustering math, viewport-aware count logic, or anything inside MapCanvas / map data fetching.
- Backend: Read API, Ingestor, schema, Postgres/PostGIS — they are stable and platform-agnostic.
- Auth / security / compliance — none of these change with a visual redesign.
- Infra: Cloudflare Pages, Cloud Run, DNS, Terraform — out of scope.
- Adding new functional features (e.g., user accounts, saving sightings) — this is a redesign, not a feature expansion.
- The decision to redesign at all — the user has already decided.

## 4. Depth

**Deep dive on design surfaces, surface-level on supporting context.** The analysis must produce enough material to brief a designer who has not seen the codebase. Specifically:

- Catalog every visible component, every state, every surface — comprehensive.
- Establish the design-token inventory and design-system maturity precisely.
- Map UX flows and friction points at fine granularity.
- Identify accessibility violations as enumerable findings, not generalities.
- Surveys of competitor sites (eBird, Merlin, iNaturalist) only as light comparison points where they sharpen the analysis — not exhaustive.

## 5. Non-goals (explicit, prevents scope creep)

- We are NOT producing a redesign in this analysis. No mocks, no concrete color palettes, no proposed type stacks. The output is the *briefing material* a designer needs.
- We are NOT prioritizing or estimating redesign work. No issue list, no roadmap, no PRs.
- We are NOT making technology choices (CSS-in-JS vs Tailwind vs vanilla CSS). Whatever stack the redesign uses is a downstream decision.
- We are NOT changing the map's behavior (clustering, zoom, viewport math).
- We are NOT auditing test coverage or CI/CD posture — orthogonal.

## 6. Known information & assumptions (with confidence)

| Statement | Confidence | Source |
|---|---|---|
| Site is live at bird-maps.com | high | CLAUDE.md repo state |
| Prod API is at api.bird-maps.com (CORS-enabled, returns JSON) | high | curl probe, Phase 0 setup |
| Frontend has 4 surfaces (feed/map/species/detail) | high | App.tsx:181–219 |
| URL state is the single source of truth (no router) | high | App.tsx:21, useUrlState reference |
| AttributionModal is reachable from every view | high | App.tsx:233–256, observed on all captures |
| Favicon is missing (404 on local) | high | console-map-desktop.log line "Failed to load resource… favicon.ico" |
| `<meta name="description">` is absent | high | curl of bird-maps.com index.html |
| Filtersbar layout differs visibly between desktop and mobile | medium | observed in captures; underlying CSS not yet audited |
| Design tokens are centralized in `tokens.ts` | medium | filename matches convention; depth unknown |
| There is no formal design system (no Storybook, no component-library package) | medium | no `@bird-watch/design-system` in workspaces; needs Phase 1 confirmation |
| The site's "voice" is utilitarian/minimalist, not editorial | medium | observed type/spacing in captures |
| Mobile portrait UX is thinner than desktop (e.g., FamilyLegend overlays the map) | medium | mobile capture 01-map-default shows legend covering ~⅓ of viewport |

## 7. Audience

**Primary:** the designer (likely Julian + collaborators) who will run a brainstorm + design exploration after this analysis lands. The brief must be readable cold — no prior conversation context.

**Secondary:** future Claude sessions that pick up the design work and need a single canonical input document. The Phase 4 report should be the only thing they have to read.

**Tertiary:** PR reviewers who will see redesign PRs land months from now and want to know what considerations went in.

## 8. Detected domains (analysis-funnel taxonomy)

Tagged 5 of 14 (max allowed):

- **UI/Visual** — primary domain; the redesign's centre of gravity.
- **Accessibility** — already a load-bearing concern (WCAG keyboard, axe checks in tests, ARIA in App.tsx); a redesign must not regress.
- **React/Components** — the frontend is React; component boundaries shape what can change cheaply.
- **Mobile/Native (responsive)** — release-1 names 390×844 explicitly; mobile UX has known weak points.
- **Architecture (frontend)** — IA + design-token architecture + style-system choice are all "small architecture" decisions.

## 9. Quality criteria with weights (committed BEFORE findings)

| Criterion | Weight | Description |
|---|---|---|
| Evidence strength | 30% | Every claim cites a file:line, capture filename, console log, or external URL. No "feels like" claims. |
| Completeness across surfaces × viewports | 25% | All 4 surfaces × 2 viewports = 8 cells — every analysis area covers every cell or explicitly says why not. |
| Actionability for design briefing | 20% | A designer reading this should know what to design *for* and what to design *around*, even though we don't prescribe the design. |
| Nuance / trade-off recognition | 15% | Acknowledges tensions (density vs whitespace, brand voice vs neutrality, animation vs perf) — no single-axis prescriptions. |
| Clarity for the named audience | 10% | Designer-readable; minimal codebase jargon; jargon defined when used. |

## 10. Investigation areas (5, carved per skill rules)

Each is a different **facet** of the redesign, not a different conclusion. No area depends on another's findings (Phase 2 handles cross-cuts).

### Area 1 — Visual design system & token inventory
**Domain:** UI/Visual
**Focus:** Catalog the existing design vocabulary. What design tokens exist (`tokens.ts`, CSS custom properties)? What's the type system (font stack, scale, weights, line-heights)? Color palette and its semantics (family colors vs UI colors vs status colors)? Spacing scale? Border radius / shadow / elevation? What's *consistent* and what's *one-off*? Is there a design-system package or just inline CSS? What naming conventions exist? Where do styles live (CSS modules? `styles.css`? component-local?)? **Output:** an inventoried design vocabulary that the redesign brief can build on.

### Area 2 — Information architecture, navigation, and URL state
**Domain:** Architecture (frontend)
**Focus:** Map the four surfaces and their relationships. How does a user move between feed/map/species/detail? How does URL state encode location and what does it imply for shareability, deep-linking, and back-button behaviour? How does the FiltersBar (persistent, top) relate to SurfaceNav (tabs, below)? Are filters scoped per-surface or global? Where does the user enter the site and what's the first surface they see? Does the IA have a "home" or only views? How does the AttributionModal relate to the IA? **Output:** an IA model + navigation map + a list of IA-level redesign constraints (e.g., "redesign must preserve query-param URLs because they're shared externally").

### Area 3 — UX flows, density, and friction (mobile + desktop)
**Domain:** Mobile/Native (responsive) + UI/Visual
**Focus:** Walk the primary user flows on both viewports using the captures. Time-to-value (what does the user see in the first 2 seconds after load on each surface?). Where is information dense vs sparse? What overlaps or competes for attention (e.g., FamilyLegend overlapping map markers on mobile)? What's the loading/empty/error story on each surface? What's the cognitive load of the FiltersBar — visible filter count, default values, "I changed something" feedback? Are mobile gesture conventions respected? Where do users tap and what do they expect? **Output:** flow walkthroughs + a friction inventory ranked by severity.

### Area 4 — Brand, voice, content, and metadata
**Domain:** UI/Visual + content (folds into UI/Visual)
**Focus:** What brand identity does the site project today? Title is "bird-watch — Arizona" — is that intentional? What's the voice register in copy (utility error messages, attribution prose, species descriptions)? What metadata exists (favicon, OG tags, `meta description`, social card)? What does first-load look like in a Slack/Twitter/iMessage unfurl? What story does the site tell about *why* it exists — is there an "About" surface, a tagline, an empty-state introduction? How are external attributions (eBird, OpenStreetMap, Phylopic, Wikipedia, iNaturalist) handled — do they support or undermine the brand? **Output:** a brand-and-content audit including an enumerated metadata/social-unfurl gap list.

### Area 5 — Accessibility, motion, and performance design surface
**Domain:** Accessibility + Performance
**Focus:** What accessibility decisions are already encoded (ARIA roles, focus management, skip-link, keyboard handlers — see App.tsx:106–131, 169–179)? What violations are observable (contrast on family colors, focus rings, focus order, motion/animation)? What's the prefers-reduced-motion story? How do design choices affect performance: web fonts, image weight (especially the iNat photo on detail), bundle size, FCP/LCP/CLS budget? Is there a motion language at all today, or is everything instantaneous? **Output:** an accessibility/motion/performance design-constraint list a designer must respect (e.g., "any palette change must preserve 4.5:1 contrast on family-color text in FamilyLegend").

## 11. Disposition for Phase 1 dispatch

Each area maps to a primary subagent type:

- Area 1 → `frontend-excellence:css-expert`
- Area 2 → `feature-dev:code-explorer`
- Area 3 → `multi-platform-apps:ui-ux-designer`
- Area 4 → `seo-content-creation:seo-content-auditor` (closest fit for content/metadata audit; brand judgement happens in Phase 3 synthesis)
- Area 5 → `ui-design:accessibility-expert`

All 5 dispatched in a single message, parallel, each writing to `tmp/redesign-analysis/funnel/phase-1/area-{N}-{slug}.md` before returning.

## 12. Verification

After Phase 0 packet is written, run:

```sh
bash /Users/j/.claude/skills/analysis-funnel/scripts/verify_phase.sh tmp/redesign-analysis/funnel 0
```

Phase 1 cannot dispatch until this passes.
