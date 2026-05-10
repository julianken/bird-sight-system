# Phase 3 Synthesis 2: Risk and Opportunity Analysis

## Synthesis Approach

Lens: risk-and-opportunity framing applied to the evidence accumulated across Phase 1 investigators and Phase 2 iterators. Every entry cites a Theme (A–E from phase-2-packet) and/or an Iterator artifact reference. Risks are organized from highest to lowest severity. Opportunities are organized from highest to lowest value-magnitude. Severity and value judgments are grounded in the measured evidence cited, not adjectives.

---

## Part A: Risks

### R1 — Motion introduced without `prefers-reduced-motion` guard
**Severity: High | Likelihood: High**

Evidence: Duration tokens `--dur-fast/base/slow` exist in the design system but are unused everywhere today (Theme D). The redesign has explicit motivation to consume them on loading/empty states and potentially map chrome transitions. `MapLibre easeTo` at `MapCanvas.tsx:729` is already a suspected motion-leak with no `prefers-reduced-motion` check (Theme E, low-confidence flag). The redesign has multiple entry points that would add motion (skeleton shimmer, filter-sheet animation, slide-over/sheet for chrome compaction Pattern C or detail Option C) but no existing precedent or guard infrastructure.

Trigger: Any implementation that adds CSS transitions or animation without checking `@media (prefers-reduced-motion: reduce)` at the token or component level.

Redesign decision creating exposure: consuming `--dur-*` tokens in new components without a corresponding `@media (prefers-reduced-motion)` rule wrapping every animation site.

Regression type: New risk introduced — no current animation exists to protect; the redesign creates the exposure from scratch.

---

### R2 — WAI-ARIA tablist contract broken by Pattern A (bottom-tab) implementation
**Severity: High | Likelihood: Medium**

Evidence: The tablist keyboard contract (Arrow keys, Home/End, focus follows selection) is confirmed axe-validated and listed as a non-negotiable baseline (Theme E). Pattern A relocates SurfaceNav to bottom chrome — saving 141px / 76% top-chrome reduction (Theme B, Iterator 5). Phase 2 explicitly clears Pattern A on ARIA grounds ("position-independent — DOM order matters, not screen position"), but only for the tablist role itself. The risk is in implementation: if Pattern A moves the tablist in the DOM (not just visually via CSS), keyboard focus order changes and axe-validation breaks. Separately, Pattern A requires `env(safe-area-inset-bottom)` whose full `viewport-fit` story is flagged medium-confidence (Theme B).

Trigger: DOM reorder of `<SurfaceNav>` below `<main>` during Pattern A implementation, or safe-area `env()` breakage on notched devices.

Redesign decision creating exposure: choosing Pattern A without explicitly enforcing that the tablist element stays in its current landmark position in the DOM.

Regression type: Regression of existing baseline (axe-validated tablist).

---

### R3 — Filter-active indicator omitted under any chrome-compaction pattern
**Severity: High | Likelihood: High**

Evidence: All 6 compaction patterns (Patterns A–F) that hide filters behind a trigger share one cross-cutting requirement: a filter-active indicator in persistent chrome (badge count, colored trigger, active-filter chips). This is called out as a "new design-system component requirement" (Theme B). The current system silently applies filters across all surfaces with zero indicator (App.tsx:24–29 global filter coupling, Theme B). Chrome compaction without this indicator makes an already-invisible problem structurally worse — a user arriving from a deep-linked URL or a returning session would see filtered results with no visible explanation.

Trigger: Any chrome compaction pattern shipped without a badge/indicator on the collapsed filter control.

Redesign decision creating exposure: treating filter compaction as a layout-only problem rather than a state-visibility problem.

Regression type: Amplification of existing silent failure — currently bad, becomes worse under compaction.

---

### R4 — `AttributionModal` legal prominence requirement silently broken
**Severity: High | Likelihood: Low**

Evidence: CC BY 3.0 §4(c) prominent-credit requirement is satisfied today because "Credits" is reachable from footer on every surface (Theme E). Any chrome redesign that removes or deprioritizes the footer `<AttributionModal>` trigger — e.g., a bottom-tab pattern that absorbs the footer zone, or a surface redesign that conditionally renders the footer — breaks this legal requirement.

Trigger: A Pattern A bottom-tab implementation that occupies the footer zone without preserving the Credits link.

Redesign decision creating exposure: bottom-chrome patterns (Pattern A) that visually merge with or displace the footer.

Regression type: Regression of existing legal baseline.

---

### R5 — Loading and empty states become more prominent under redesign without being fixed
**Severity: Medium | Likelihood: High**

Evidence: Loading and empty states are currently visually identical (both: muted `#555` centered text on `#f4f1ea`, Theme D). The map skeleton is 730px desktop / 635px mobile of cream-on-cream text — the largest empty surface by pixel area. A redesign that updates the loaded state's visual hierarchy without touching loading/empty states widens the visual discontinuity: polished loaded → jarring placeholder on every cold load or filter change.

Trigger: Any redesign that ships token/color changes to loaded surfaces without applying the same pass to the 14 distinct loading/error/empty copy+class pairs.

Redesign decision creating exposure: treating loading/empty/error states as out-of-scope for a "visual layer" redesign when they occupy the majority of pixel area during normal interaction.

Regression type: New perceived-regression — the gap is currently invisible because both states are plain; the redesign makes it visible.

---

### R6 — Detail surface IA seam worsens without `pushState` decision
**Severity: Medium | Likelihood: Medium**

Evidence: `replaceState`-only architecture (`url-state.ts:87`) means browser-back does not work on the detail surface today — a silent IA failure. Only Option D (~40 lines, `pushState`) fixes it (Theme C, Iterator 3). A redesign that improves detail surface visual design (Option A: 4th tab, Option B: dialog, Option C: slide-over) without resolving `pushState` compounds user confusion: a polished new surface that still breaks browser-back is a worse user experience than a plain one that does.

Trigger: Shipping any detail-IA option (A, B, or C) without the `pushState` change in the same release.

Redesign decision creating exposure: scoping the detail redesign as purely visual when the deepest user-facing defect is behavioral.

Regression type: Amplification of existing silent failure via expectation-gap (polished UI raises bar).

---

### R7 — FamilyLegend collapse on mobile breaks color-encoding discoverability
**Severity: Medium | Likelihood: Medium**

Evidence: FamilyLegend covers 44.8% of main on mobile and 57.6% on desktop (Theme B, Iterator 5, worse than mobile). The obvious fix is to collapse or move it. But there is no alternative discovery path for the family-color encoding (Theme B, medium-confidence flag). The legend is the only place where the color → taxonomic-family mapping is explained. Collapsing it without providing an alternative (e.g., cluster-bubble tooltip, legend within filter sheet) breaks the encoding for new users.

Trigger: FamilyLegend collapsed or migrated without a replacement explanation path for the color-to-family mapping.

Redesign decision creating exposure: treating FamilyLegend as a layout problem (it covers too much) rather than a semantic problem (it carries the only color explanation).

Regression type: Regression of discoverability baseline.

---

### R8 — Position B voice adoption introduces SEO/metadata without `og:` / `<meta>` implementation
**Severity: Medium | Likelihood: Medium**

Evidence: Choosing Position B ("Arizona bird sightings, updated in real time from eBird") closes the metadata gap in principle (Theme A). But the 19 enumerated metadata deficits are absent from the current implementation. A brand-voice decision that lands in copy (loading states, onboarding) without corresponding `<meta name="description">`, `og:title`, `og:description`, and `og:image` delivers incomplete SEO value and produces bare social unfurls (no card, no image, no excerpt — the current Position A cost explicitly named in Theme A).

Trigger: Brand-voice copy written and shipped without `<head>` meta tag implementation in the same change.

Redesign decision creating exposure: treating voice as a content/copy concern separate from the technical metadata layer.

Regression type: Incomplete opportunity realization rather than regression — stays at current deficient state.

---

### R9 — IntersectionObserver analytics sentinel breaks under dialog/sheet detail IA
**Severity: Low | Likelihood: Medium**

Evidence: `SpeciesDetailSurface.tsx:174–195` uses `IntersectionObserver` for analytics. Theme C (Iterator 3) explicitly flags that Options B and C change the scroll container, which requires re-wiring the observer. If not re-wired, the sentinel fires against the wrong root or not at all — silently broken analytics.

Trigger: Shipping detail-IA Options B or C without auditing and updating the `IntersectionObserver` root configuration.

Redesign decision creating exposure: choosing dialog or sheet overlay (Options B or C) for detail surface without auditing all scroll-container dependencies.

Regression type: Silent regression of existing analytics instrumentation.

---

## Part B: Opportunities

### O1 — Voice decision closes metadata, onboarding, and loading-state gaps in one stroke
**Value-magnitude: High | Implementation cost: Low**

Evidence: Theme A identifies the voice/brand gap as the prerequisite for closing 19 metadata deficits, designing onboarding, and writing useful loading/empty copy. Position B requires no new product features — it is a single declarative claim ("Arizona bird sightings, updated in real time from eBird") that gives the redesign a spine. Iterator 1 confirms eBird deliberately vacates the read-only, no-login, recency-driven consumer use case. Position A (current) has active costs: no SEO, no onboarding, bare social unfurls. The implementation cost of the voice decision itself is near-zero; the cost of the downstream metadata (14 `<meta>` tags, updated loading/empty copy) is low-medium.

Redesign decisions that unlock it: committing to Position B as a prerequisite rather than treating it as deferred branding work.

---

### O2 — Native `<dialog>` reuse unifies chrome compaction and detail IA at low combined cost
**Value-magnitude: High | Implementation cost: Low**

Evidence: Theme C (Iterator 3) identifies that detail-IA Option B (dialog modal) reuses the battle-tested `AttributionModal` pattern (`AttributionModal.tsx:182–261`), cutting ~half the implementation work. Theme B (Iterator 2) separately identifies that a filter sheet under Pattern A could use the same modal machinery. Both solutions converge on the same existing native `<dialog>` infrastructure. A single `<BaseSheet>` / `<BaseDialog>` primitive built once serves both problems. The combined cost is less than either built independently; the combined user-experience gain (consistent overlay behavior, shared focus management, shared ESC affordance) is greater.

Redesign decisions that unlock it: recognizing chrome compaction and detail-IA as one "overlay strategy" question (phase-2-packet Open Question 2) rather than two independent decisions.

---

### O3 — `pushState` addition is 40 lines that removes the biggest IA defect before any visual work
**Value-magnitude: High | Implementation cost: Low**

Evidence: Theme C (Iterator 3) quantifies Option D as approximately 40 lines and the only option that fixes browser-back. Browser-back failure is a fundamental navigation contract violation across all four surfaces. Phase 2 explicitly flags this as a candidate prerequisite rather than part of the redesign (Open Question 4). Shipping it first removes a user-facing defect that will otherwise be highlighted by a polished redesign (polished UI raises expectations, R6 above). The cost/value ratio is among the highest of any discrete action in the redesign.

Redesign decisions that unlock it: treating `pushState` as Phase 0 / prerequisite work, not as part of the detail-surface visual redesign.

---

### O4 — Loading/empty/error state redesign captures the largest unimproved pixel surface
**Value-magnitude: High | Implementation cost: Medium**

Evidence: Theme D (Iterator 4) documents that the map skeleton is 730px desktop / 635px mobile — the largest empty surface by pixel area. Duration tokens (`--dur-fast/base/slow`) exist and are unused. 14 loading/empty/error copy+class pairs are inconsistent. A `<StatusMessage>` / `<LoadingState>` / `<EmptyState>` primitive built once covers all 14 sites and all 5 container shapes. The voice register is already coherent (functional-reassuring, declarative-direct — Theme D, Iterator 4), so copy governance is handled. This is high-value because loading states are what users see during every filter change, every surface switch, and every cold load — the most frequently encountered pixel surface in the app.

Redesign decisions that unlock it: including loading/empty/error states explicitly in the redesign scope, not treating them as "not chrome."

---

### O5 — Inline-measured contrast convention can extend to cluster-bubble palette with zero new process
**Value-magnitude: Medium | Implementation cost: Low**

Evidence: Theme E identifies "inline-measured contrast comments alongside hex values" as an existing non-negotiable baseline. The cluster-bubble palette is not yet documented this way. Extending the same convention to cluster-bubble hex values requires no new tooling, no new process, no new review gate — it is pattern propagation. The value is that the cluster-bubble palette becomes auditable by inspection (no axe run required to verify contrast), matching the documented standard for the rest of `tokens.ts`.

Redesign decisions that unlock it: including cluster-bubble palette documentation in the token redesign pass.

---

### O6 — Filter-active indicator is a net-new capability that makes the existing global filter coupling visible
**Value-magnitude: Medium | Implementation cost: Low-Medium**

Evidence: Global filter coupling at `App.tsx:24–29` silently applies filters across all surfaces. This is invisible today. Any chrome compaction requires an active-filter indicator as a prerequisite (Theme B). Building the indicator as part of the redesign converts an existing silent flaw into an explicit, user-visible feature. The indicator does not require filter architecture changes — it reads existing state and reflects it. Implementation cost is a new design-system component (badge/chip), not a state management change.

Redesign decisions that unlock it: scoping the indicator as a first-class redesign deliverable, not a follow-on.

---

### O7 — FamilyLegend migration into filter sheet solves two independent problems simultaneously
**Value-magnitude: Medium | Implementation cost: Medium**

Evidence: FamilyLegend covers 44.8% / 57.6% of main on mobile/desktop (Theme B, Iterator 5). Moving it into the filter sheet under Pattern A or Pattern B kills both the legend-overlay problem and its color-encoding discoverability risk (R7 above) in one move. The filter sheet context is where users are already making filter decisions; the legend becomes contextually relevant there. The implementation cost is medium because FamilyLegend must be restructured to render in two contexts (map overlay for desktop non-compact, filter sheet for compact/mobile), but the visual component itself does not change.

Redesign decisions that unlock it: treating FamilyLegend as a filter-sheet citizen rather than a standalone map overlay.

---

### O8 — Position B enables structured data markup (`application/ld+json`) at low marginal cost
**Value-magnitude: Medium | Implementation cost: Low**

Evidence: If Position B voice is chosen (Theme A), the app has a machine-readable identity: location (Arizona), content type (bird sightings), update frequency (near-real-time from eBird). This is sufficient to author a `Dataset` or `WebPage` JSON-LD block — a structured data format Google uses for rich search results. Marginal cost over the base `<meta>` implementation is one `<script>` block. Value: search engines surface structured data results differently from plain pages; for a data-centric birding app, this is a discoverable differentiation from eBird (which addresses contributors, not search-landing consumers — Theme A).

Redesign decisions that unlock it: Position B voice adoption plus `<meta>` implementation in the same release.

---

### O9 — Coherent voice register means new copy is free to write to an established standard
**Value-magnitude: Medium | Implementation cost: Low**

Evidence: Iterator 4 (Theme D) finds the existing 14 loading/empty/error strings are already voice-coherent: functional-reassuring, no exclamation marks, no apology language, declarative-direct. This is an under-recognized asset. Writing new copy (onboarding, empty-state improvements, social-share copy) does not require a brand-voice workshop or style guide authoring — the register is already documented by example. Implementation cost of new copy is near-zero; the main cost is the voice decision (O1).

Redesign decisions that unlock it: auditing existing copy as the style guide rather than commissioning one.

---

### O10 — `anyTabActive=false` is already safe — detail redesign can ship without ARIA remediation
**Value-magnitude: Low | Implementation cost: Low**

Evidence: Theme C (Iterator 3) confirms `SurfaceNav.tsx:76`'s no-tab-selected state on the detail surface is not an ARIA violation; the tablist spec tolerates no active tab. This removes a perceived blocker. Any of the four detail-IA options can ship without first remediating a non-existent ARIA problem. The value is in reducing scope-creep risk (teams sometimes add ARIA workarounds for non-problems, increasing complexity).

Redesign decisions that unlock it: treating `anyTabActive=false` as cleared, not as a risk to mitigate.

---

## Part C: Highest-Leverage Opportunity-Risk Pairing

**Pairing: Chrome compaction (Pattern A) + Filter-active indicator (O6 / R3)**

The single redesign decision where capturing the opportunity simultaneously creates the largest risk if mis-handled is **adopting Pattern A (bottom tab + filter sheet, −141px / −76% top chrome)**.

The opportunity: Pattern A delivers the largest measurable chrome reduction (24.6% more main area on mobile, Theme B / Iterator 5). Combined with the native `<dialog>` reuse (O2), it converges with detail-IA Option B into a single coherent overlay strategy at low combined cost.

The risk if mis-handled: Pattern A ships without the filter-active indicator (R3, Severity: High, Likelihood: High) — the silently-applied global filter coupling at `App.tsx:24–29` becomes worse, not better. Additionally, Pattern A mis-implemented in DOM order breaks the axe-validated tablist contract (R2, Severity: High). And Pattern A may displace the footer Credits link, violating CC BY 3.0 §4(c) prominence (R4, Severity: High).

One decision, three high-severity risk vectors, one high-magnitude opportunity. It is the design decision with the tightest coupling between "getting it right" and "getting it very wrong."

---

## Core Narrative

The redesign has two categories of work: prerequisites and improvements. The prerequisites — voice/brand decision, filter-active indicator, `pushState` — are not visual work, but they gate nearly every visual improvement. A redesign that skips them ships polished surfaces onto a broken behavioral foundation.

The improvements cluster into two coalitions. The first coalition is overlay strategy: Pattern A chrome compaction + detail-IA Option B + FamilyLegend migration into filter sheet, all sharing `<dialog>` machinery. The second coalition is state-surface redesign: loading/empty/error states using the existing duration tokens and the existing voice register as a built-in standard.

The single most dangerous design decision is Pattern A adoption without the filter indicator and without DOM-order discipline — it combines the highest opportunity with three concurrent high-severity risks.

---

## Key Conclusions

1. Voice decision (Position B) is the cheapest change with the widest downstream benefit. It is a prerequisite to metadata, onboarding, and loading-copy work — treat it as Phase 0.
2. Pattern A is the highest-leverage chrome improvement and the highest-risk implementation decision. It must ship with: filter-active indicator, DOM-order-preserving tablist, and Credits link preserved.
3. `pushState` (~40 lines) should precede or accompany any detail-surface visual redesign; shipping the visual upgrade without it widens the expectation gap.
4. Loading/empty/error states are the largest unimproved pixel surface in the app — they are structurally in scope for a "visual layer" redesign even if they feel like UX work.
5. The `<dialog>` infrastructure is the most valuable reusable asset in the current codebase. The redesign should exploit it (filter sheet, detail modal) rather than build adjacent alternatives.

---

## Blind Spots

Risk/opportunity framing carries three systematic blind spots in this context:

1. **Reversibility bias.** This lens weights risks by measurability (WCAG violations, pixel measurements, legal requirements) and opportunities by implementation cost. It systematically under-weights aesthetic and qualitative considerations: whether the redesign feels like a coherent place, whether the visual hierarchy communicates hierarchy (not just passes contrast), whether the design is memorable. A site can satisfy every risk criterion here and still feel generic.

2. **User-sampling gap.** Audience profile (expert birders vs. general public) is flagged low-confidence (phase-2-packet Confidence Levels). Risk/opportunity analysis assumes a user population to estimate likelihood. Without it, R3 (filter indicator) and O1 (voice decision) could be magnitude-wrong in either direction. Expert birders tolerate silent filter state; general public does not.

3. **Sequencing as strategy.** This analysis identifies what to do but is weaker on when. The prerequisite/improvement distinction in Core Narrative is a gesture at sequencing; a fuller treatment would map each item to a release boundary, which this lens does not naturally produce.

---

## Recommendations

1. **Commit to Position B voice before any other redesign work begins.** It is the cheapest prerequisite with the most downstream unblocking power.
2. **Ship `pushState` (Option D, ~40 lines) as a standalone pre-redesign commit.** No visual work required; removes the largest behavioral defect before visual polish raises expectations.
3. **Treat Pattern A as the central design decision** requiring simultaneous delivery of: filter-active indicator (new design-system component), DOM-order-preserving tablist implementation, and Credits link audit.
4. **Scope loading/empty/error states explicitly into the redesign.** Use the existing duration tokens and voice register as the implementation foundation.
5. **Audit `MapCanvas.tsx:729` (`easeTo`) for `prefers-reduced-motion` before consuming any `--dur-*` tokens** in new components.
