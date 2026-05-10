# Context Packet: Phase 2 → Phase 3

Organized by **theme**, not by iterator. Iterator artifacts in `phase-2/iterator-{1..5}-*.md`; states screenshots in `screenshots/states/`.

## Theme A — Brand voice as foundation, not flourish

The brand-voice gap and the metadata gap are **the same gap**. Choosing what bird-maps.com *claims to be* is the prerequisite for closing 19 enumerated metadata deficits *and* designing onboarding *and* writing useful loading/empty copy.

Three positions on a spectrum, each with structurally different prerequisites:

- **Position A — Neutral utility (current)**: not a "neutral" choice — it has active costs (no SEO, no onboarding, bare social unfurls). Sustainable only if the audience is already expert and self-orienting.
- **Position B — Opinionated utility (BirdCast model)**: name the mechanism. "Arizona bird sightings, updated in real time from eBird" is a complete value prop in one sentence. Available without new product features. Closes metadata + onboarding gaps with a single declarative claim.
- **Position C — Mission/narrative (Audubon, iNaturalist)**: requires participation features bird-maps.com lacks (no checklist submission, no accounts, no community). Structurally unavailable.

**Salient finding:** eBird redirects unauthenticated traffic to login — its product is addressed to *contributors*, not consumers. The read-only, no-login, recency-driven, place-specific consumer use case is a gap eBird deliberately vacates. Naming this gap is positioning, not narrative. (Iterator 1)

## Theme B — Mobile chrome is a 2-problem bundle that Phase 1 collapsed into one

Phase 1 said "~174px chrome / ~21% / ~40% legend overlap." Iterator 5 measured: **chrome 185.1px / 21.9% / legend 44.8% of main on mobile and 57.6% on desktop** (worse than mobile in absolute pixels). Phase 1 underestimated by 5–7%.

Two **separable** sub-problems:

1. **Top-chrome height** (FiltersBar 138.5px + SurfaceNav 46.6px). Addressable by 6 mapped patterns: Pattern A (bottom tab + filter sheet, **−141px / −76% top chrome**, +24.6% main); Pattern B (compact chip + More, −86px); Pattern C (drawer, −130px but filter state invisible); Pattern D (segmented + icon toggle, −44–86px, lowest cost); Pattern E (autohide, has WCAG 2.4.7 focus-reveal risk on fixed chrome — disqualified as primary); Pattern F (per-surface variation, **IA-unsafe** — directly conflicts with confirmed global filter coupling at `App.tsx:24–29`).

2. **FamilyLegend overlay** (independent of chrome height). Returns visible in localStorage-persisted expanded state on map; covers 44.8% / 57.6% of main. Either fix mobile-default behavior or migrate legend into the filter sheet.

**Cross-cutting requirement** under any pattern that hides filters behind a trigger: a **filter-active indicator** (badge count, colored trigger, active-filter chips) must be added to persistent chrome. Currently filters silently affect non-current surfaces with no indicator — chrome compaction makes this worse without a badge. New design-system component requirement. (Iterators 2, 5)

## Theme C — Detail surface IA: 4 options cluster on 2 axes

Two axes: **overlay vs replacement** (B/C vs A/D) and **history-enabled vs replaceState-only** (D with pushState vs A/B/C).

- **Option A — 4th tab**: small impl; preserves tablist; doesn't fix browser-back; mobile labels tight at 97px/tab.
- **Option B — `<dialog>` modal**: medium impl; reuses AttributionModal pattern (battle-tested + axe-validated); cleanest "Back" answer (ESC → underlying surface, never left); cold-load awkward (modal over blank).
- **Option C — slide-over / sheet**: large impl; no codebase precedent; needs `inert`/custom focus mgmt; strongest spatial cue; highest cost.
- **Option D — sub-surface + close button + `pushState`**: small impl (~40 lines); only option that fixes browser-back; doesn't fix the no-active-tab IA seam.

**Constraints discovered:**
- `replaceState`-only architecture (`url-state.ts:87`) is the deepest constraint; only Option D fixes browser back.
- AttributionModal native `<dialog>` (`AttributionModal.tsx:182–261`) is the only overlay precedent; reuse cuts ~half the work for Option B.
- `IntersectionObserver` analytics sentinel (`SpeciesDetailSurface.tsx:174–195`) needs re-wiring under B/C (scroll container changes).
- `anyTabActive=false` on detail (`SurfaceNav.tsx:76`) is *not* an ARIA violation; tablist tolerates no-tab-selected.

(Iterator 3)

## Theme D — Loading/empty/error states are the largest unaudited UX surface

Phase 1 noted zero captures of these states; Iterator 4 captured 17 (11 desktop + 6 mobile) using fetch-interception + DOM injection.

**Findings:**

1. **Loading and empty states are visually identical** — both render muted `#555` centered text on `#f4f1ea` page background. A user cannot distinguish "working" from "finished" by appearance.
2. **Error severity and visual treatment are inverted.** Component-level error (`SpeciesDetailSurface`) uses the only `--color-error-*` tokens (red tint + border). App-level error (more severe) has *zero* error styling — raw unstyled `<h2>` on page background.
3. **Map skeleton is 730px desktop / 635px mobile of cream-on-cream text** — the largest empty surface in the app by pixel area. Zero shape, shimmer, or animation.
4. **Duration tokens (`--dur-fast/base/slow`) reserved but unused everywhere**, including loading states. A redesign that adds motion has tokens to consume.
5. **No shared `<StatusMessage>` / `<LoadingState>` / `<EmptyState>` primitive** — 14 distinct copy+class pairs across 4 surfaces, each with slightly different padding and font-size.
6. **Voice register is consistent ("functional-reassuring")** — no exclamation marks, no apology language, declarative-direct. Sets a tonal ceiling visual design must respect (no mascots, no alarm illustrations).

**Design constraints surfaced:** any new loading/empty/error visual must work in 5 container shapes (full viewport, full-width list, narrow panel, dialog section, modal section). (Iterator 4)

## Theme E — Pre-existing baselines that survived audit and must not regress

- **Landmark order** (region → tablist → main → contentinfo) — axe-enforced.
- **WAI-ARIA tablist** with full keyboard contract; position-independent (DOM order matters, not screen position — clears Pattern A).
- **Native `<dialog>` modal pattern** with focus capture, ESC, backdrop, restoration — directly reusable for any new modal/sheet.
- **Native `<select>` / `<datalist>` filter controls** — zero-ARIA-cost; deliberate trade against custom-control density.
- **Inline-measured contrast comments** alongside hex values — the model for the cluster-bubble palette that's not yet documented this way.
- **Voice register** — coherent across all 14 strings; new copy should match.
- **`AttributionModal` legal scaffolding** — CC BY 3.0 §4(c) prominence requirement satisfied; redesign must keep "Credits" reachable from every surface.

## Confidence Levels

**High confidence:**
- All chrome measurements (`getBoundingClientRect()` on live DOM): 138.5/46.6/185.1/49.0 px.
- Three competitor positions and their structural prerequisites.
- 14-row loading/error copy inventory with exact strings.
- Detail-IA option trade-off table grounded in cited file:line.

**Medium confidence:**
- Pattern A bottom-tab safe-area `env()` story — needs viewport-fit audit.
- Filter-badge "active" definition — straightforward but needs explicit spec.
- Whether collapsing FamilyLegend on mobile breaks the family-color encoding discoverability (no alternative discovery path captured).

**Low confidence:**
- Audience profile (expert birders vs general public) — affects which voice position has lowest cost; unsampled.
- Tucson Audubon birding-by-area pages 404'd; sub-region precision question (Arizona vs Southeast Arizona) unresolved.
- MapLibre `easeTo` `prefers-reduced-motion` behavior at `MapCanvas.tsx:729` — likely a real motion-leak today.

## Contradictions & Open Questions for Phase 3 Synthesizers

1. **The redesign's smallest credible unit of work is a *voice decision plus a filter-active indicator*.** Both are prerequisites for nearly every other change (metadata can't land without voice; chrome compaction can't land without indicator). Synthesizers should consider whether these are "Phase 0" of any redesign roadmap.

2. **Mobile chrome compaction (Pattern A) and detail-IA Option B converge on `<dialog>` reuse.** Both reach for the same existing modal machinery. Are they separate decisions or one cohesive "overlay strategy"?

3. **The map's most expensive UX seam is the FamilyLegend on the map surface, not the chrome above it** (44.8% / 57.6% of main). Phase 1 framed this as one of multiple frictions; quantification suggests it dominates.

4. **`pushState` is one targeted change** (~40 lines, Option D) that resolves the silent IA failure of broken browser-back across all four surfaces. It does not require visual redesign. Synthesizers should consider whether this is a *prerequisite* to redesign work or *part of* it.

5. **Position A (current voice/brand) is not a defensible default.** Iterator 1 made this explicit: the costs of Position A apply *regardless of any other redesign decision*. Synthesizers should treat "stay at Position A" as a choice with measurable consequences, not a no-op.

## Artifacts (read on demand for Phase 3)

- `phase-2/iterator-1-competitor-positioning.md` — voice register spectrum with competitor evidence
- `phase-2/iterator-2-mobile-chrome-compaction.md` — 6 patterns × trade-off matrix
- `phase-2/iterator-3-detail-surface-ia-options.md` — 4 IA options × 2 axes
- `phase-2/iterator-4-loading-error-state-inventory.md` — 14-row state inventory + visual treatment audit
- `phase-2/iterator-5-chrome-footprint-quantified.md` — pixel-precise measurements + 3 compaction-scenario projections
- `screenshots/states/{desktop,mobile}/*.png` — 17 captured non-loaded states
