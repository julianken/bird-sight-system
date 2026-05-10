# Analysis funnel — synthesized

Method: **5→5→3→1 funnel**. Five parallel investigations, then five iterations on what they found, then three syntheses through different lenses, then one unified report. Run before any visual brainstorming. Goal: ground the redesign in evidence about what the site is, what works, and what fails.

Full artifacts: [`../05-archive/analysis-funnel/`](../05-archive/analysis-funnel/) — original 700+ line phase-4 report at `analysis-funnel/phase-4/analysis-report.md`. This is the synthesis.

## What the site does well (preserve, don't regress)

The existing implementation has months of accessibility and engineering work that the visual redesign must build on, not around. Five strong baselines:

1. **Landmark order** (`region` → `tablist` → `main` → `contentinfo`) — axe-validated.
2. **WAI-ARIA tablist** (`SurfaceNav`) — full keyboard contract, position-independent (DOM order matters, not visual).
3. **Native `<dialog>` modal** (`AttributionModal`) — focus capture, ESC, backdrop, restoration. Reusable for detail-surface.
4. **Inline-measured contrast** (`styles.css:243–264`) — every `#hex` has an inline ratio. Convention extends naturally.
5. **44px content-row tap targets** (iOS HIG-compliant).

Plus deliberate engineering minimalism that creates a generous performance budget:

- Zero web fonts (system stack only)
- Zero CSS animations (clean motion slate)
- Zero icon library (DB-backed inline SVG)
- Zero CSS framework (vanilla CSS with custom properties)

The redesign preserves all of these.

## What the site fails at

Five themes, each cited with concrete evidence in the original report:

### Theme 1 — Identity vacancy

The site has no declared identity. Title "bird-watch — Arizona" exists only in the browser tab. No surface renders the brand name, no tagline explains the purpose, no About page exists. **19 enumerated metadata gaps**: `<meta description>`, all OG tags, Twitter card, favicon, manifest, theme-color, canonical, JSON-LD. Every social unfurl on Slack/Twitter/iMessage degrades to a bare URL.

The voice register across 14 visible strings is internally consistent ("functional-reassuring") but cold and unanchored. Position B (opinionated utility) closes 19 metadata gaps with a single declarative claim.

### Theme 2 — State invisibility

Four kinds of state communication fail simultaneously:

1. **Filters silently apply across all surfaces** with no global indicator. Setting "Cardinals" in the FamilyLegend on the map surface narrows the feed silently when the user switches tabs.
2. **Loading and empty states render visually identical**: muted `#555` text on cream `#f4f1ea` background. A user can't tell working from finished.
3. **Error severity is inverted**: component-level errors have red-tinted styling; the app-level error (more severe) renders as unstyled `<h2>` on page background.
4. **Browser back is silently broken**: `replaceState`-only at `url-state.ts:87` means pressing back from a detail surface exits the site, not returns to the previous surface. ~40-line `pushState` fix resolves it.

### Theme 3 — Mobile chrome + FamilyLegend overlay

Pixel-precise live-DOM measurements:

- **Mobile chrome: 185.1px = 21.9% of viewport** (FiltersBar 138.5px wraps to 3 rows + SurfaceNav 46.6px).
- **FamilyLegend overlay: 44.8% of main on mobile, 57.6% on desktop** (worse than mobile in absolute pixels because the legend renders larger at desktop width).
- **Worst case**: 60.1% of mobile viewport is chrome + footer + expanded legend; only 39.9% is unobstructed map.

Not one problem; two separable problems. Chrome compaction patterns (Pattern A bottom-tab + filter sheet recovers ~141px / +24.6% main area). FamilyLegend collapse-by-default on mobile is independent.

### Theme 4 — Design system as skeleton, not system

Tokens exist (`tokens.ts`, CSS custom properties). Components exist. The abstraction layer between them does not. **14 distinct copy+class pairs** for loading/empty/error states, each surface improvising. **35+ hardcoded font-size literals** across 7 distinct values, no scale. Two parallel color systems (CSS chrome palette + DB family palette) cannot be re-skinned through a single mechanism.

The 5 new component primitives (`<StatusBlock>`, `<Photo>`, `<FamilySilhouette>`, `<ClusterPill>`, `<FilterSentence>`) are the missing layer.

### Theme 5 — A11y baseline strong, but several known gaps

- **Cluster bubble contrast** is unaudited. axe excludes WebGL canvas. `#51bbd6/#f1f075/#f28cb1` with `#1a1a1a` text happens to clear AA but was chosen visually, not arithmetically.
- **Zero `prefers-reduced-motion` queries** anywhere. MapLibre `easeTo` at `MapCanvas.tsx:729` is a suspected motion-leak.
- **Filter / view-change announcements** are silent — no `aria-live` for filter state.
- **Photo loading** lacks `loading="lazy"` / `srcset` (analysis Finding 5.3) — CLS mitigation is via CSS aspect-ratio only.
- **32px chrome targets** sit below the 44pt iOS HIG minimum (deliberate; primary content is 44px).

## Six recommendations (the report's directional output)

1. **Treat as systems decision-completion**, not visual refresh.
2. **Sequence on the dependency graph**, not by surface — voice + filter-active indicator first; surface work after.
3. **Name the a11y baseline as a non-negotiable constraint layer** in the design brief.
4. **Design the state vocabulary before designing any individual state** (`<StatusBlock>` primitive).
5. **Voice/identity decision is a product decision, not a design decision** — assign to product owner.
6. **Treat `pushState` as a pre-redesign engineering fix**, not a design problem.

All six absorbed into the spec.

## Stakeholder decisions surfaced

The report cited 4 stakeholder-level questions ("Right decider: product owner") that gate substantial downstream work:

- **S1** Audience profile (G1 PostHog read) — gates voice register
- **S2** Voice position (Position A vs B vs C) — gates 19 metadata gap closures
- **S3** Browser-back as product requirement — answers cleanly "yes, treat as pre-redesign fix"
- **S4** Map vs feed front door — **resolved: map** (`DEFAULTS.view='map'`)

Phase 0 ships S3 + S4. Phase 6 closes S1 + S2.

## What the analysis didn't tell us

Honestly named in the original report's confidence assessment:

- **Real user behavior**: no analytics read, no session recordings, no user interviews. All evidence structural (code, measurements, captures).
- **Performance as design constraint**: bundle size unmeasured; render-budget for motion is theoretical.
- **Touch interaction depth**: pixel measurements done; gesture conflicts with MapLibre pan unverified.
- **Map surface as scope-fixed**: spec excludes map *behavior* changes, only its visual *theme*. If that's relaxed, the dependency graph changes.

These are the eight pre-ship gates (G1–G8) tracked in [`../01-spec/open-questions.md`](../01-spec/open-questions.md).

## Cross-references

- Decisions: [`../00-overview/decisions.md`](../00-overview/decisions.md)
- Spec contracts that implement the recommendations: [`../01-spec/`](../01-spec/)
- Phase plans that ship the work: [`../02-phases/`](../02-phases/)
- Original full report: [`../05-archive/analysis-funnel/phase-4/analysis-report.md`](../05-archive/analysis-funnel/phase-4/analysis-report.md)
