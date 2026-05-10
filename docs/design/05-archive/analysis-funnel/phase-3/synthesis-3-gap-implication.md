# Synthesis: Gap & Implication

## Synthesis Approach

Gap-and-implication lens applied to the full Phase 1–2 corpus. Every gap is categorized by what kind of work closes it and whether closing it is required before or during the redesign. Part B maps the designer's decision dependency graph. Part C isolates questions that require stakeholder commitment, not analysis. All citations trace to Theme or Iterator references in the phase-2-packet and five phase-1 area files.

## Core Narrative

The evidence is unusually complete: five areas × two viewports × 17 captured states × pixel-precise live-DOM chrome measurements. What remains is not more analysis — it is a sequence of commitments. The voice position decision (Theme A, Iterator 1) is not one among equals: it is the prerequisite for 19 downstream metadata actions, for onboarding copy, for type register choices, and for social sharing. Every other design question in this brief — chrome compaction, detail IA, loading states, type scale — has a tractable answer once that one commitment lands.

There is also an underappreciated parallel track. The browser-back navigation failure (Theme C, Iterator 3) is a structural problem — `replaceState`-only at `url-state.ts:87` — that is neither a design problem nor a brand problem. It is a ~40-line code change (Option D from Iterator 3) that resolves a broken user contract predating the redesign. Treating it as a pre-redesign engineering fix eliminates an entire axis of complexity from the detail IA decision space and means the designer never has to design around "browser back doesn't work."

## Part A — Gap Inventory

### Category 1: Knowable but not investigated

**G1 — Audience profile (expert birders vs. general public)**
- What's missing: PostHog runs in production (confirmed at `AttributionModal.tsx:536`: "Usage analytics via PostHog. Respects Do Not Track.") but no session data, bounce rate, mobile/desktop split, or session duration was queried in Phase 1 or 2.
- Why missing: Analytics were out of scope for the codebase evidence pass.
- Work to close: 15-minute PostHog dashboard read. Alternatively: proxy from mobile/desktop capture-split versus the actual prod traffic ratio (which is unknown).
- Required before or during: BEFORE. Audience profile is the primary input to the voice-position decision (Theme A, Iterator 1 Finding 5 — "medium confidence — trade-off severity depends on actual user population, which is unsampled"). If the audience is predominantly expert and self-orienting, Position A costs less than assessed. If general public, Position A is clearly wrong.

**G2 — Geographic data precision (is "Arizona" accurate or too broad?)**
- What's missing: The ingestor's actual geographic coverage was not audited. The eBird API call is `/data/obs/US-AZ/recent` (CLAUDE.md), which is all of Arizona. But Tucson Audubon drills to "Southeast Arizona" (Iterator 1 Finding 3); BirdCast drills to 216 named cities. Whether "Arizona" is appropriately broad or too vague for place-identity weight is unresolved.
- Why missing: Backend is out of scope for this analysis (phase-0-packet §Out of bounds).
- Work to close: Inspect the ingestor API call and BCR ecoregion data to confirm coverage. Verify whether the nine visible map regions (observable in `local/desktop/01-map-default.png`) correspond to named sub-regions that could be surfaced.
- Required before or during: BEFORE the voice decision (D1). Position B requires committing to an accurate geographic claim. If coverage is narrower than all of Arizona, the claim must be more precise.

**G3 — Production bundle size baseline**
- What's missing: No `npm run build` measurement. Current JS payload, largest chunk, and total dist size are unknown.
- Why missing: Not part of the visual/UX evidence pass.
- Work to close: `npm run build --workspace @bird-watch/frontend && du -sh frontend/dist`. One-time baseline.
- Required before or during: BEFORE design tokens work. Area-1 Finding 8 confirms zero icon libraries and zero webfonts today — the bundle is lean. Documenting that baseline now means any redesign addition (webfont, icon library, CSS framework) has a measurable regression signal.

**G4 — Filter-active indicator definition ("what counts as active?")**
- What's missing: Every chrome compaction pattern that hides filters (Patterns A, B, C from Iterator 2) requires a filter-active badge on the persistent chrome. But "active" is undefined. Does `since=14d` (the default) count? Does `notable=false` count?
- Why missing: A design specification task, not a Phase 1–2 analysis question.
- Work to close: Explicit decision: a filter is "active" when its value differs from its URL-state default (`url-state.ts:15–22` documents the defaults: `since='14d'`, `notable=false`, `familyCode=null`, `speciesCode=null`). Badge count = number of filters where `value !== default`. Straightforward but must be committed before badge UI design begins.
- Required before or during: BEFORE chrome compaction design. Iterator 2 Finding 6 establishes this as a new component requirement not present in the codebase — it cannot be designed without this spec.

### Category 2: Knowable in principle but not from this codebase alone

**G5 — MapLibre `easeTo` prefers-reduced-motion behavior**
- What's missing: `MapCanvas.tsx:729–732` calls `easeTo` on cluster expansion without a `prefers-reduced-motion` guard. Area-5 Finding 6 confirms zero `prefers-reduced-motion` queries anywhere in the codebase; the phase-2-packet confidence table lists this as low confidence.
- Why missing: Requires a browser session with `prefers-reduced-motion: reduce` engaged — not verifiable from source alone.
- Work to close: Set reduced-motion in system accessibility settings, navigate to the map, click a cluster, observe whether the camera animates. If it does: conditionally use `jumpTo` instead of `easeTo` at `MapCanvas.tsx:729`.
- Required before or during: DURING redesign, when motion language is being designed. Not a blocker for any other decision.

**G6 — Pattern A iOS safe-area `env()` story**
- What's missing: A bottom-fixed tab bar (Pattern A, Iterator 2) requires `padding-bottom: env(safe-area-inset-bottom)` on devices with a home indicator. The codebase has zero `env()` calls and no `viewport-fit=cover` in `frontend/index.html`. Iterator 2 remaining unknown 4 explicitly flags this.
- Why missing: Requires physical device testing — not determinable from code.
- Work to close: Add `viewport-fit=cover` to the viewport meta tag and test on a physical iPhone X+ or BrowserStack iOS simulator.
- Required before or during: DURING Pattern A implementation, not before.

**G7 — Family-color palette worst-case contrast against basemap tiles**
- What's missing: The seven earth-tone family colors from `tokens.ts:132–157` were not arithmetically tested against OpenFreeMap positron basemap tile mid-tones at any zoom level. Area-5 Finding 5 flags this as medium confidence.
- Why missing: Requires actual tile imagery and a color picker — not computable from source.
- Work to close: Screenshot the map at worst-case zoom, sample tile colors under silhouettes, and compute WCAG 1.4.11 (3:1 for non-text UI components) contrast ratios.
- Required before or during: DURING palette redesign. Existing colors likely pass (area-5 Finding 5 notes they "were chosen visually, not arithmetically"); new palette proposals must be checked.

**G8 — Screen-reader announcements on filter changes and surface switches**
- What's missing: Area-5 Finding 7 documents that applying a filter or switching surfaces triggers no live-region announcement. Whether this causes SR confusion in practice requires manual VoiceOver or NVDA testing — axe cannot test behavioral announcements over time.
- Why missing: Manual SR testing was out of scope for the evidence pass.
- Work to close: Manual VoiceOver pass: apply a filter, listen for announcement. Tab to SurfaceNav, switch surface, listen. If no feedback: add `role="status" aria-live="polite"` count near the FiltersBar.
- Required before or during: DURING accessibility validation, after chrome compaction work lands.

### Category 3: Unknowable in advance, only resolvable through design exploration

**G9 — FamilyLegend collapse on mobile: does it break family-color discoverability?**
- What's missing: The FamilyLegend is the only labeled color key for the map's family-color encoding. Collapsing it (or migrating it to the filter sheet) removes that key. No alternative discovery path was identified in any phase. Iterator 2 remaining unknown 3 explicitly raises this.
- Why unknowable: Discoverability depends on user mental models that only surface in a prototype or usability test. Cannot be resolved analytically.
- Work to close: Prototype with collapsed legend; test with representative users. Minimum: meet the CLAUDE.md prototype gate (≥344 rows, 390×844 and 1440×900 viewports, all interactive surfaces exercised).

**G10 — Cold-load surface behind detail Options B and C**
- What's missing: When a user opens `?view=detail&detail=ablkin` cold, Options B (`<dialog>`) and C (slide-over) must decide what renders behind the overlay. URL state has no "prior surface" param. Iterator 3 remaining unknown 2.
- Why unknowable: "What surface is most useful behind a cold-loaded detail dialog" is a UX judgment about user expectations, not a codebase fact.
- Work to close: Prototype and test, or make a pragmatic call (default to Feed, document the decision).

**G11 — Webfont congruence with voice register**
- What's missing: Whether a display webfont would clash with the existing "functional-reassuring" tonal ceiling (Iterator 4 Finding 4) is a design judgment, not an analytical finding.
- Why unknowable: Type/voice congruence is validated through visual exploration, not code reading.
- Work to close: Visual exploration — try a webfont candidate in a design mockup against the existing copy strings.

**G12 — Tab label legibility at 97px (Option A, 4-tab variant)**
- What's missing: Iterator 3 remaining unknown 4: at 390px with 4 tabs, each tab is ~97px. Whether static "Detail" at 97px and 13px font is legible needs visual validation.
- Why unknowable: Requires a screen-at-size prototype.
- Work to close: Render 4-tab SurfaceNav at 390px and evaluate.

---

## Part B — Designer Implications: Decision Dependency Graph

```
D1: Voice position (A / B / C)                        ← MUST BE FIRST
├── Unblocks: all 19 metadata gap closures (area-4 Finding 3 gap list)
├── Unblocks: onboarding / first-load copy framing
├── Unblocks: type register choice (D5)
└── Closes: G2 (geographic precision — must be confirmed before committing to B's claim)

D2: Browser-back as product requirement (yes / no)     ← PARALLEL TO D1
├── If YES → Detail IA collapses to Option D only (~40 lines, pushState)
└── If NO  → Options A / B / C remain open

D3: Detail IA pattern (A / B / C / D)                 ← DEPENDS ON D2
├── If Option B: unblocks shared overlay strategy with Pattern A
│   (Pattern A filter sheet + Option B detail dialog = one <dialog> system)
└── If Option D: unblocks pushState implementation spec

D4: Chrome compaction pattern (A / B / C / D / E / F) ← DEPENDS ON D3, REQUIRES G4
├── Requires G4 (filter-active indicator definition) before design, not code
└── FamilyLegend treatment (migrate into filter sheet, or collapse separately?)
    ↳ G9 (discoverability) must be prototyped before committing

D5: Type system and token redesign scope              ← DEPENDS ON D1
├── Voice position determines type register (Position B = declarative; likely system UI + better scale)
└── Audit of 35+ hardcoded font-sizes (area-1 Finding 3) can begin immediately as inventory

D6: Loading/empty state visual language               ← CAN BEGIN IMMEDIATELY
├── Tonal ceiling already established by existing 14 strings (Iterator 4 Finding 4)
├── Duration tokens reserved and unused (tokens.ts:115–122, styles.css:16–18)
├── 5 container shapes must work (Iterator 4 Finding 5 constraint)
└── Does NOT wait for D1 — existing copy register is sufficient signal
```

**Critical shortcut:** D6 (loading/empty state visual language) can begin before D1 is committed. The existing copy register already establishes the tonal ceiling with high confidence. This is the one place the graph has a shortcut — start here if the stakeholder decisions are delayed.

**The smallest credible unit of work** (phase-2-packet §Contradictions & Open Questions #1): a voice decision (D1) PLUS a filter-active indicator spec (G4). Both are prerequisites for nearly every other visual change. Neither requires writing code — one requires a stakeholder conversation, the other requires a 5-line specification.

---

## Part C — What This Analysis Cannot Resolve

**S1: Who is the intended audience?**
- Right decider: Product owner (Julian)
- Information needed: PostHog session data (G1) — 15 minutes to retrieve
- What changes: Voice position trade-off cost becomes accurately assessable. Iterator 1 Finding 5 notes this explicitly as the limiting factor on confidence.

**S2: Which voice position — A, B, or C?**
- Right decider: Product owner
- Information needed: S1 result + Iterator 1 Finding 5 three-position spectrum + G2 geographic confirmation
- What changes: All 19 metadata gaps become actionable. Type register and onboarding copy open. This is the gating decision for the entire redesign brief. Position C is structurally unavailable (no participation features — phase-0-packet §Repo facts). Position A has documented, ongoing costs (Iterator 1 Revised Understanding). Position B closes the metadata gap with one declarative sentence and requires no new features.

**S3: Is browser-back navigation a product requirement?**
- Right decider: Product owner
- Information needed: Whether users encounter and are frustrated by broken browser-back (PostHog session recordings if enabled); the fix cost (~40 lines, Option D — Iterator 3 Finding 4)
- What changes: If YES → detail IA collapses to Option D; Options A/B/C are moot. If NO → all four options remain open. Recommendation regardless: treat as a pre-redesign engineering fix. It is a live user-contract failure that predates the redesign.

**S4: Is the map or the feed the intended front door?**
- Right decider: Product owner
- Information needed: The current default is `view='feed'` (`url-state.ts:15–22`). The brand name "bird maps" and URL "bird-maps.com" suggest map. Area-3 Flow 1: "no visual 'start here' cue — the map is all data, no narrative."
- What changes: Whether onboarding copy is written for a map-first or feed-first experience. A map-as-front-door decision raises the urgency of the map skeleton fix (Iterator 4 Finding 3 — 730px of blank cream) and the FamilyLegend treatment.

---

## Key Conclusions

### Conclusion 1: The voice decision is infrastructure, not brand

- **Evidence:** Iterator 1 Finding 6: "The metadata gap and the brand-voice gap are the same gap." Area-4 Finding 3 gap list: all 19 metadata deficits are unblocked by one voice commitment. Phase-2-packet Theme A: "Choosing what bird-maps.com claims to be is the prerequisite for closing 19 enumerated metadata deficits and designing onboarding and writing useful loading/empty copy."
- **Confidence:** High — the causal chain (voice → tagline → meta description → OG tags → social unfurl → SEO) is deterministic.
- **Caveats:** Position B requires accurate claims. G2 (geographic coverage) must be confirmed before committing.

### Conclusion 2: The two biggest mobile problems are separable

- **Evidence:** Phase-2-packet Theme B: chrome is 185.1px and FamilyLegend overlay is 44.8% of main — two independent problems. Iterator 5 worst-case: 60.1% of viewport consumed on mobile. Both have independent solutions.
- **Confidence:** High — pixel measurements from live DOM.
- **Caveats:** They could be solved together if Pattern A's filter sheet absorbs the FamilyLegend — but G9 (discoverability) must be prototyped before committing to that integration.

### Conclusion 3: Option D (pushState + close button) should be a pre-redesign engineering fix

- **Evidence:** Iterator 3 Finding 4: ~40 lines across three files. Phase-2-packet Contradiction #4: "does not require visual redesign." The current `replaceState`-only architecture is a live user-contract failure.
- **Confidence:** High — implementation scope is precisely bounded.
- **Caveats:** Introduces a growing history stack — users who visit 10 detail pages and press back 10 times traverse all of them. Expected browser behavior, but must be accepted explicitly.

### Conclusion 4: Loading/empty state visual language can begin without waiting for the voice decision

- **Evidence:** Iterator 4 Finding 4: 14-string copy register establishes the tonal ceiling — calm, declarative, functional-reassuring — regardless of which voice position is chosen. Duration tokens (`tokens.ts:115–122`) are reserved and unused. Map skeleton (Iterator 4 Finding 3) is the highest-impact empty surface by pixel area and needs no brand context to fix.
- **Confidence:** High — tonal ceiling is established by code-verified strings.
- **Caveats:** If voice position C were chosen (mission/narrative), the ceiling might shift. C is structurally unavailable, so this is theoretical.

---

## Blind Spots

The gap-and-implication lens focuses on what is missing and what must be decided. Named explicitly to avoid the frame coloring the output:

**1. The strong baselines are underweighted.** This synthesis identifies 12 gaps; it does not dwell on what is already excellent. Theme E documents exceptional infrastructure: the WAI-ARIA tablist keyboard contract, the native `<dialog>` focus management (directly reusable for both chrome compaction and detail IA), the inline contrast documentation, the coherent 14-string copy register, and the CC BY legal scaffolding. These are months of engineering work that the redesign must build on top of, not around. A designer reading only the gap inventory might underestimate the quality of the existing foundation.

**2. The dependency graph implies everything must wait for D1.** This is not true. Chrome compaction design (D4) depends on G4 (filter-active indicator spec) but not on the voice decision. The type system audit (35+ hardcoded font-sizes) can begin immediately as an inventory task. D6 (loading/empty states) can begin immediately. The graph is a dependency map, not a serial schedule — D1 is a prerequisite for metadata and onboarding, not for structural/layout redesign.

**3. "Gap" language can pathologize intentional minimalism.** The 19 metadata deficits are real costs. But the system-UI font stack, the zero-animation CSS, and the terse copy register are not gaps — they are deliberate engineering choices that produced a fast, accessible, maintainable app. The redesign should have a high bar for departing from them. Webfonts add LCP cost; CSS animations require prefers-reduced-motion guards (G5); editorial copy creates voice drift risk.

**4. This lens cannot assess risk tolerance.** Each open gap has a cost if left unfixed that depends on the user population (G1, unsampled). G5 (MapLibre motion-leak) matters a great deal if 15% of users have reduced-motion enabled; it matters very little if 0.5% do. That data is in PostHog.

---

## Recommendations

1. **Before any other design work:** Commit S2 (voice position) and resolve G1 (PostHog read). These are 15-minute tasks that unlock 19 blocked actions. The strong recommendation from the evidence is Position B — it closes every metadata gap with one declarative sentence, requires no new features, and has a direct precedent in BirdCast (Iterator 1 Finding 1).

2. **Treat browser-back as a pre-redesign fix:** Dispatch a code-only PR for Option D (pushState + close button, ~40 lines — Iterator 3 Finding 4) before visual redesign begins. Resolves a live user-contract failure and eliminates one axis of design complexity.

3. **Begin D6 (loading/empty state visual language) immediately:** The tonal ceiling is established. The map skeleton (Iterator 4 Finding 3) — 730px of blank cream — is the highest-impact empty surface by pixel area and requires no pending stakeholder decisions.

4. **Design Pattern A and Option B as one overlay system:** If chrome compaction and detail IA both reach for `<dialog>`, design them together. The AttributionModal (`AttributionModal.tsx:182–261`) is the proven pattern; extend its focus management machinery once.

5. **Prototype the FamilyLegend collapse before committing to it:** G9 is a real discoverability unknown. Any design that collapses or migrates the legend must provide an alternative path to the family-color encoding — or accept and monitor the risk.
