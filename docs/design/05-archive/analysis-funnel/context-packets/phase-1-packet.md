# Context Packet: Phase 1 → Phase 2

## Key Findings (compressed; original detail in phase-1/area-{1..5}-*.md)

### Convergent across multiple areas
1. **Mobile chrome is too tall and the map's visible area is then further halved by the FamilyLegend overlay.** FiltersBar (`flex-wrap: wrap`, `styles.css:369`) wraps to 2–3 rows ≈ 130px; SurfaceNav ≈ 44px; combined ≈ 21% of 844px. On the map view, the FamilyLegend covers a further ~40% of remaining map (`local/mobile/01-map-default.png`, `prod/mobile/01-map-default.png`). [Areas 1, 3]
2. **The `detail` surface is IA-orphaned.** Not in `SurfaceNav.TABS` (`SurfaceNav.tsx:22–26`); no close/back affordance (`SpeciesDetailSurface.tsx:112–118`); browser back is broken because navigation uses `replaceState` only (`url-state.ts:87`); SurfaceNav renders all-tabs-deselected when on detail (`SurfaceNav.tsx:76`). [Areas 2, 3]
3. **Two parallel species-search controls coexist with no visual distinction but different behaviors.** FiltersBar's `Species` input narrows in place (`FiltersBar.tsx:101–122`); SpeciesAutocomplete navigates to detail (`SpeciesAutocomplete.tsx:141+`). Both visible on Species surface simultaneously (`local/{desktop,mobile}/03-species-search.png`). [Areas 2, 3]
4. **Brand surface is essentially absent.** "bird-watch — Arizona" exists only in `<title>` (`frontend/index.html:5`); no logo, tagline, About, rendered name on any surface; no `<meta description>`, no OG tags, no Twitter card, no favicon, no manifest, no theme-color. Every social unfurl is bare URL. 19 enumerated metadata gaps in area-4. [Areas 1, 4]
5. **Two parallel color systems with no shared abstraction.** CSS `:root` palette (warm cream + amber accent, 20 tokens, `styles.css:24–62`) covers chrome/text/surfaces; family colors (8 earth-tone hexes in `tokens.ts:124–158`) come from DB via `/api/silhouettes` and are *not* CSS custom properties, so they cannot be re-skinned via CSS alone. [Areas 1, 5]

### Strong baselines a redesign must preserve (not regress)
- **Landmark order** (`region` → `tablist` → `main` → `contentinfo`) enforced by axe e2e suite (`axe.spec.ts:8–20`). [Area 5]
- **WAI-ARIA tablist** with full Arrow/Home/End/Enter/Space + roving tabindex (`SurfaceNav.tsx:40–108`). [Area 5]
- **Native `<dialog>` modal** with focus capture, autofocus, restoration, ESC, backdrop-click (`AttributionModal.tsx:182–261`). [Area 5]
- **Focus-visible** uniformly 2px outline `--color-text-strong` across every interactive element (`styles.css` ~6 sites). [Area 5]
- **Measured contrast** documented inline beside hex values (`styles.css:243–264, 507–512`). [Area 5]
- **44px tap targets on content rows** (`.feed-row min-height: 44px`, styles.css:179, 135–137 cite iOS HIG). [Area 5]
- **URL-state shareability**: every external link encodes view + filters; `since=14d` default omitted; `view=hotspots` shim in place. [Area 2]
- **No DB mocks, no animation library, no icon library, no web fonts, no CSS framework** — generous performance budget that any redesign trades against deliberately. [Area 5]

### High-leverage gaps the redesign should close
- **No CSS for `.species-detail-description`** — Wikipedia HTML renders with browser-default link colors instead of `--color-text-strong` (`SpeciesDescription.tsx:62`, no rules in styles.css). [Area 1]
- **No `loading="lazy"` / `srcset` / blurhash** on iNat species-detail photo (CLS mitigated by aspect-ratio only) (`SpeciesDetailSurface.tsx:63–71`). [Area 5]
- **No `prefers-reduced-motion` queries** anywhere; `duration.*` tokens reserved but unused (`tokens.ts:115–122`, `styles.css:16–18`). [Area 5]
- **No filter-change announcement to SR users** (`aria-busy` gated to feed+species only, no live-region for filter result counts). [Area 5]
- **`error.message` rendered raw** in `App.tsx:148` — voice inconsistency vs. all other crafted error strings. [Area 4]
- **Type system is fully ad-hoc** — no scale, no named tokens; ~35 hardcoded font-size literals across 7 distinct values. [Area 1]
- **Border-radius is 9 distinct hardcoded literals** (2/4/6/8/10px/50%/999px) — no shape token. [Area 1]
- **Loading & error states have zero captures** (none of 31 PNGs show error-screen, map skeleton, feed loading, etc.). [Area 3]
- **FamilyLegend appears expanded by default on mobile** in both local & prod captures, contradicting `LEGEND_EXPAND_MIN_WIDTH=760` logic (`MapSurface.tsx:22–31`) — likely localStorage persistence; either way, expanded legend on return visit covers the map. [Area 3]
- **Cluster bubble contrast unaudited** (`#51bbd6/#f1f075/#f28cb1` × `#1a1a1a` text in `observation-layers.ts:170–237`); axe excludes the WebGL canvas. [Area 5]
- **No "why this exists" / About surface**; first-time visitors land on data with no orientation. [Area 4]
- **FiltersBar global filters silently affect non-current surfaces** (e.g. legend click filters the feed) with no global active-filter indicator. [Areas 2, 3]
- **32px chrome targets** (attribution trigger, modal close, legend entry) sit below iOS HIG 44pt. [Area 5]

## Confidence Levels

**High confidence (cited file:line, capture, or curl):**
- All metadata gaps (Area 4 enumeration #1–#19)
- All token-system structural facts (Area 1 Findings 1–8)
- IA replaceState architecture (Area 2 Finding 1)
- 44px / 32px tap-target split (Area 5 Finding 11)
- Voice inventory by surface (Area 4 Finding 4)

**Medium confidence:**
- Mobile chrome pixel measurements (~130px / ~44px / ~21%) — visual estimation, not ruler-precise. [Area 3]
- Cluster contrast ratios (calculated by eye, not axe — canvas excluded). [Area 5]
- Bundle size implications of design choices (no `npm run build` measurement taken). [Area 5]
- Root cause of FamilyLegend expanded-on-mobile (localStorage vs matchMedia race). [Area 3]

**Low confidence / unverified:**
- MapLibre `easeTo` reduced-motion behavior at `MapCanvas.tsx:729`. [Area 5]
- Family-color palette contrast against OpenFreeMap basemap mid-tones. [Area 5]
- SR narrative on filter / view changes (no NVDA/VoiceOver pass). [Area 5]

## Contradictions & Open Questions for Phase 2

1. **Tension: brand voice neutrality vs. needed onboarding.** Today's voice is utilitarian (Area 4); zero "why this exists" surface (Area 4); but the site's recency-and-place identity is its only differentiation from eBird/iNaturalist. Does the redesign add an opinionated narrative voice, or preserve neutrality and lean on visual cues? **Phase 2 should iterate on competitor positioning + content register.**
2. **Tension: density vs. mobile chrome.** Chrome consumes 21% of mobile viewport before content (Area 3); FamilyLegend overlap eats more (Area 3); but the chrome is full of high-utility filters most casual users never touch. **Phase 2 should iterate on a chrome-compaction strategy and per-surface filter relevance.**
3. **Tension: IA simplicity vs. `detail` orphaning.** Detail is intentionally not a tab (it's a sub-surface) but breaks the tab affordance and back-navigation (Areas 2, 3). **Phase 2 should iterate on detail-as-modal vs detail-as-tab vs detail-as-overlay.**
4. **Tension: native filter controls (perf + a11y) vs. custom controls (visual brand).** FiltersBar uses native `<select>`/`<datalist>` (zero JS, default a11y, OS-locked styling); SpeciesAutocomplete is 354 lines of custom combobox (Area 5). Where should the redesign land? **Phase 2 should iterate on the custom-control budget.**
5. **Open question: where does the redesign START?** Map first (front door) or feed first (current default, more dense)? `DEFAULTS.view='feed'` is one-line code change but IA implications are large (Area 2). **Phase 2 should iterate on the front-door choice.**

## Cross-cuts to consider in Phase 2

- **A11y × Visual × Brand:** new accent palette must hold 4.5:1 contrast on every surface AND the cluster-bubble counts AND the focus outline target. (Areas 1, 4, 5)
- **Mobile UX × IA × A11y:** mobile chrome compaction must not regress the WAI-ARIA tablist or focus-visible targets. (Areas 2, 3, 5)
- **Content × Loading states:** loading and error UX is uncaptured (Area 3); voice register is consistent (Area 4); a redesign that adds loading states must extend the existing voice. (Areas 3, 4)

## Artifacts (read on demand)

- `phase-1/area-1-visual-design-system.md` — design tokens, type, color, shape, naming conventions; 8 findings
- `phase-1/area-2-ia-nav-url-state.md` — surfaces, navigation transitions, URL state shape; 10 findings
- `phase-1/area-3-ux-flows-density-friction.md` — 5 flow walkthroughs × 2 viewports + 22-row friction inventory
- `phase-1/area-4-brand-voice-content-metadata.md` — copy inventory, metadata gaps, brand surface; 19 enumerated gaps
- `phase-1/area-5-a11y-motion-performance.md` — landmark/ARIA/focus/motion/perf constraints; 13 findings, 12 axe surfaces enforced
