# Synthesis: Thematic (Synthesizer 1)

## Synthesis Approach

Applied a thematic lens across all 5 investigation areas (phase-0-packet) and all 5 iteration deep-dives (phase-2-packet). The approach: surface patterns that persist across multiple independent areas rather than consolidating each area's findings in sequence. A pattern that appears once is a finding; a pattern that appears four times independently is a theme. Themes are named for what they reveal about the *underlying* design problem, not the surface symptom.

## Core Narrative

Bird-maps.com has a coherent, working product underneath a design layer that was never completed — it was started and then stopped before several foundational decisions were made. What looks like a collection of visual polish problems is actually a set of deferred structural decisions that compound each other: the site does not know what it claims to be (Theme 1), which means it cannot tell users what is happening at any given moment (Theme 2), which means every surface that should adapt to context instead applies one static treatment regardless of state (Theme 3). Running orthogonally to this compounding chain is a fourth reality: the accessibility and interaction baseline is stronger than the visual layer suggests (Theme 4), and nearly everything that could be improved is blocked by a single, small prerequisite class of work (Theme 5).

The redesign problem is not "make it look better." It is "make explicit the decisions that the current implementation left implicit, and then build the visual layer on those decisions rather than around them." The visual layer's incoherence is a symptom of implicit decisions, not a cause.

## Key Conclusions

### Conclusion 1 — Identity vacancy is the upstream blocker for almost everything else

**Theme:** The site has no declared identity, and that absence actively costs it.

**How it manifests across surfaces:**
- Brand/content (Theme A, phase-2-packet): 19 enumerated metadata deficits — `<title>`, `og:description`, structured data, canonical URL — are not independently fixable UI details; they are downstream of not having answered "what is this for and who is it for."
- Loading/empty states (Theme D, phase-2-packet): The functional-reassuring voice register is internally consistent but unanchored — it does not name what the product is, making cold-load moments ("Loading recent sightings in Arizona…") feel like an app that doesn't know its own name.
- Mobile/UX (Area 3, phase-0-packet): Onboarding is absent from all 8 surface × viewport cells. There is no first-run state, no explanation of the filter-to-map relationship, no region-to-data explanation. This is not a missing feature — it is a missing answer to "what do we tell someone who arrives without context?"

**Why it matters:** Identity vacancy is not a branding question; it is a prerequisite for writing copy, labeling interactions, and scoping what the filter controls mean. Iterator 1 (phase-2-packet, Theme A) named three positions, only two of which are structurally available to this product. Choosing between them costs no engineering work — it costs a decision. That decision unlocks copy, metadata, and onboarding simultaneously.

**Evidence strength:** High. Three independent areas surfaced this without being asked to look for it. Iterator 1 made it explicit with competitor evidence. The structural prerequisite argument (Position C unavailable) is grounded in feature inventory (no accounts, no checklist submission).

**Confidence:** High.

**Caveats:** The audience profile is unsampled (phase-2-packet Confidence section, Low). If the actual audience is 100% expert birders who are already self-orienting, the cost of Position A (neutral utility, current) is lower than the analysis suggests. The redesign recommendation changes under that audience assumption.

**Relation to other themes:** This is the upstream node. Themes 2, 3, and 5 are all partially or fully blocked until this decision is made. It is not orthogonal to any other theme — it compounds all of them.

---

### Conclusion 2 — State invisibility is the product's primary usability failure

**Theme:** The interface does not tell users what is true right now, in four distinct dimensions simultaneously.

**How it manifests across surfaces:**

1. **Filter state invisibility:** Filters set on one surface silently affect non-current surfaces with zero indicator (phase-2-packet, Theme B). Chrome compaction patterns that hide filters behind a trigger make this worse without a filter-active badge. The badge is flagged as a new design-system component requirement (Iterator 2 and 5, phase-2-packet, Theme B). This is not a mobile-only problem — Iterator 5's measurements showed desktop legend overlay (57.6% of main) is worse than mobile (44.8%).

2. **Loading vs. empty state invisibility:** Both states render identical muted `#555` centered text on `#f4f1ea` — indistinguishable by appearance (phase-2-packet, Theme D, Finding 1). A user cannot tell if the product is working or finished working.

3. **Error severity inversion:** Component-level error has full error token styling (red tint, border); app-level error (more severe) has zero error styling — raw unstyled `<h2>` (phase-2-packet, Theme D, Finding 2). The severity signal and the visual weight are inverted.

4. **Navigation state invisibility:** Browser back is broken across all four surfaces due to `replaceState`-only architecture (`url-state.ts:87`, phase-2-packet, Theme C). Users who navigate and press back are silently deposited at a prior URL with no recovery affordance. The `anyTabActive=false` on detail (`SurfaceNav.tsx:76`) is not an ARIA violation, but it is a navigation seam that has no visual resolution.

**Why it matters:** These four invisibilities share a root: the interface was designed as if the user always knows what state they are in, what the app is doing, and what navigation they have available. At any non-trivial moment of use (applied filter + feed + detail open = three simultaneous invisibilities), the user is flying blind. A visual redesign that does not address state communication will remain fundamentally unusable despite improved aesthetics.

**Evidence strength:** High. Iterator 4's 17 captured states (phase-2-packet, Theme D) are the strongest single evidence block: 14 distinct copy+class pairs, zero shared primitive, loading/empty visually identical. Iterator 5's pixel-precise measurements (phase-2-packet, Theme B) ground the filter-state story in exact numbers rather than impressions.

**Confidence:** High for findings 1-3 (direct measurement and capture). Medium for finding 4 (replaceState is confirmed; full user-impact scope is modeled, not directly tested with real users).

**Caveats:** Duration tokens exist (`--dur-fast/base/slow`) but are unused (Theme D, Finding 4). This means motion-based state differentiation is architecturally available at zero token-definition cost — a constraint that slightly reduces the difficulty of addressing findings 1 and 2, but does not change their priority.

**Relation to other themes:** Orthogonal to Theme 1 (identity) — state visibility can be addressed independently of voice/brand positioning. Compounding with Theme 3 (static treatments): the absence of a state-aware design system means every new state is hand-coded with no shared language.

---

### Conclusion 3 — The design system exists as a skeleton, not a system

**Theme:** Tokens, primitives, and patterns are present individually but are not connected into a coherent system; every surface recombines them independently.

**How it manifests across surfaces:**

- **Token inventory:** `tokens.ts` and `styles.css` contain design tokens (colors, typography, duration) but inline-measured contrast comments exist only for documented colors, not for the cluster-bubble palette (phase-2-packet, Theme E). Tokens are defined; usage is ad hoc.
- **State primitives:** 14 distinct copy+class pairs for loading/empty/error states across 4 surfaces, each with slightly different padding and font-size, and no shared `<StatusMessage>` / `<LoadingState>` / `<EmptyState>` component (phase-2-packet, Theme D, Finding 5).
- **Motion tokens:** `--dur-fast/base/slow` reserved but unused everywhere including loading states (Theme D, Finding 4). Tokens exist as placeholders, not as a motion design decision.
- **Legend integration:** FamilyLegend persists in localStorage-expanded state on mobile, covering 44.8% of main (phase-2-packet, Theme B). No shared pattern governs when a legend should be visible vs. collapsed vs. absent — each surface manages it independently.
- **Overlay pattern:** `AttributionModal` native `<dialog>` is the only overlay precedent, is axe-validated, and has full keyboard/focus contract (Theme E). It is not currently the basis of a generalized overlay pattern — it is a one-off that happens to be reusable (Iterator 3, phase-2-packet, Theme C, Option B notes this directly).

**Why it matters:** A visual redesign applied on top of this skeleton will produce the same result the current design produced: visually inconsistent surfaces that drift away from each other over time because there is no shared primitive to anchor them. The redesign problem is not "restyle the components" — it is "decide what the design system's primitives actually are, then restyle components as instances of those primitives." The components already exist; the abstraction layer between tokens and components does not.

**Evidence strength:** High for the skeleton-not-system characterization (directly evidenced by the 14-pair finding and the motion-token gap). Medium for the cluster-bubble contrast gap (identified but not fully audited per phase-2-packet Confidence section).

**Confidence:** High.

**Caveats:** The existing accessibility baseline (Theme E) is strong precisely because the native elements (`<select>`, `<datalist>`, `<dialog>`) were chosen over custom components. A move toward a richer component system risks trading accessibility robustness for visual consistency. This is a real tension, not a solvable-by-convention problem.

**Relation to other themes:** This theme is where Themes 1 and 2 land structurally. Identity decisions (Theme 1) produce copy and brand constraints; state visibility decisions (Theme 2) produce component requirements. Both will be expressed through the design system (Theme 3). Theme 4 (strong baseline) is both an asset (reusable `<dialog>`) and a constraint (native controls limit customization range).

---

### Conclusion 4 — The accessibility and interaction baseline is a structural asset, not a given

**Theme:** The existing implementation has strong accessibility foundations that are invisible from the visual layer and easy to accidentally destroy in a redesign.

**How it manifests across surfaces:**

- **Landmark order** (region → tablist → main → contentinfo) is axe-enforced and semantically correct (Theme E, phase-2-packet).
- **WAI-ARIA tablist** with full keyboard contract: position-independent (DOM order, not screen position), which means Pattern A (bottom tabs) is architecturally safe for the tablist despite spatial reordering (Theme B, phase-2-packet).
- **Native `<dialog>`** with focus capture, ESC, backdrop, and restoration: battle-tested and directly reusable (Theme E, phase-2-packet; Theme C Iterator 3 Option B).
- **Skip-link to feed** (`App.tsx:116–131`) and `tabIndex={0}` on `<main/>` for keyboard scroll access (`App.tsx:169–179`) — both load-bearing for keyboard users (phase-0-packet).
- **Native `<select>` / `<datalist>` filter controls**: zero-ARIA-cost, deliberately chosen (Theme E, phase-2-packet).
- **One known motion-leak**: MapLibre `easeTo` at `MapCanvas.tsx:729` likely does not respect `prefers-reduced-motion` (phase-2-packet, Low confidence).

**Why it matters:** Visual redesigns regularly destroy accessibility baselines because the accessible behaviors are invisible in the visual design layer. In this codebase, several accessibility-correct decisions look wrong from a visual design perspective: the tablist being DOM-ordered rather than visually ordered, the native select controls appearing visually inconsistent, the skip-link being visually invisible. A designer who does not know these are load-bearing will remove them. A redesign brief that does not name them explicitly as non-negotiable constraints will produce an inaccessible result.

**Evidence strength:** High. Theme E in the phase-2-packet is the strongest evidence block here — all items are cited with file:line and axe-validation status.

**Confidence:** High for the baseline inventory. Low for the motion-leak (flagged as likely, not confirmed).

**Caveats:** The baseline was audited at Phase 1/2 depth. A full WCAG 2.1 AA audit with assistive technology testing would likely surface additional gaps not captured here (no screen reader sessions were conducted in this analysis). The cluster-bubble palette contrast is explicitly flagged as undocumented.

**Relation to other themes:** Orthogonal to Theme 1 (identity). Compounding constraint on Theme 3 (design system): native controls limit the redesign's visual design range in ways that cannot be removed without explicit accessibility tradeoff decisions. This theme functions as a brake on the velocity of the other themes — it narrows the solution space rather than expanding it.

---

### Conclusion 5 — Two small decisions unlock the majority of the redesign surface

**Theme:** The redesign's dependency graph has a narrow bottleneck — two targeted decisions unlock a disproportionate fraction of the total design space.

**How it manifests:** The phase-2-packet (Contradictions & Open Questions, item 1) names this explicitly: "The redesign's smallest credible unit of work is a *voice decision plus a filter-active indicator*." The analysis across all 5 iterations supports this:

- Voice/identity decision (Theme A): unlocks metadata, onboarding copy, loading/empty copy, and social sharing — all blocked on a single declarative claim about what the product is.
- Filter-active indicator (Theme B): is a prerequisite for every chrome-compaction pattern that hides filters behind a trigger (Patterns A, B, C, D in Iterator 2). Without the badge, hiding filters makes the state invisibility problem (Theme 2) catastrophically worse. With the badge, Patterns A and D become viable.
- `pushState` (~40 lines, Option D, Theme C): resolves browser-back failure across all four surfaces. It does not require visual redesign. It is a prerequisite or a co-requisite depending on whether the detail surface IA decision (Theme C) is made first.

The pattern: the most expensive-looking design problems (chrome height, detail surface IA, loading state system) each have a small decision or targeted code change that unlocks the design space for the full solution. The analysis did not find a case where a visually ambitious redesign was the cheapest path to fixing a core problem.

**Evidence strength:** High for the voice + filter-badge unit (three independent iterators converged on this). Medium for `pushState` as prerequisite (the argument is structurally sound but the sequencing is a judgment call, not a derived fact).

**Confidence:** Medium-high. The dependency argument is strong; whether these two decisions are "Phase 0 of the roadmap" (as the packet suggests) or "part of Phase 1" is a planning judgment, not an analytical one.

**Caveats:** The filter-active indicator being a "new design-system component requirement" (phase-2-packet, Theme B) means it is not a trivial UI tweak — it requires specifying what "active" means (which filter values are non-default, how to count them, how to display the count across different chrome compaction patterns). This is more design work than it first appears.

**Relation to other themes:** This theme is about the shape of the redesign roadmap, not a design problem per se. It is downstream of all four other themes and functions as the synthesis of their dependency relationships.

---

## Blind Spots

1. **Real user behavior is entirely absent.** All evidence is structural (code, measurements, visual states). No session recordings, no support tickets, no usage analytics, no user interviews. Themes 1 and 2 are analytically compelling but rest on designer inference about what users experience, not observed behavior. The identity vacancy problem (Theme 1) might be invisible to expert users who arrived knowing what the tool is.

2. **Performance as a design constraint is underweighted.** The phase-2-packet lists `prefers-reduced-motion` as a low-confidence gap. Thematic synthesis tends to amplify dramatic structural findings (chrome height, IA seam, brand vacuum) and underweight boring performance constraints (render budget for loading animations, network-conditioned skeleton behavior, MapLibre tile load sequencing). These may be harder design constraints than any of the 5 themes suggest.

3. **The map surface itself is treated as a visual-layer constant.** The scope constraint (hold map behavior constant, only theme the visual layer) is load-bearing here. Everything in this synthesis assumes the map's interactive behavior does not change. If that constraint is relaxed — e.g., if the FamilyLegend overlay problem is addressed by changing legend interaction, not just its housing — the dependency graph of Theme 5 changes materially.

4. **Existing user population and their mental models are unknown.** "Position B — Opinionated utility" is recommended as available and low-cost. But if existing regular users have already formed mental models around the current neutral/tool framing, a voice shift may cause confusion even if it is analytically correct. Thematic synthesis over-weights structural arguments and under-weights switching costs for existing users.

5. **Touch interaction depth was not captured.** Screenshots cover viewports; iterator measurements cover pixels. No capture of touch target sizes, swipe gesture conflicts with MapLibre pan, or tap highlight states. Mobile UX findings are viewport-geometry findings, not touch-interaction findings.

---

## Recommendations

1. **Treat this as a systems design problem, not a visual refresh problem.** The evidence shows that the visual incoherence is downstream of three unresolved structural decisions: identity/voice, state communication, and design system abstraction layer. A visual refresh that does not address these decisions will drift back to incoherence within one release cycle.

2. **Sequence the redesign on its actual dependency graph, not by surface.** The smallest credible first unit of work is identity decision + filter-active indicator, not "redesign the map surface" or "redesign mobile." The dependency structure (Theme 5) should drive the redesign roadmap, not the visual hierarchy of surfaces.

3. **The design brief must name the accessibility baseline as a non-negotiable constraint layer.** Specifically: the native control decisions, the tablist DOM-order contract, the skip-link, and the `<dialog>` focus contract. These must be explicit constraints in any design brief, not implicit hopes.

4. **Design the state vocabulary before designing any individual state.** The 14-copy-pair finding (Theme 3/D) is not a copy problem — it is a symptom of no shared state vocabulary. A redesign of loading, empty, and error states should start by defining the vocabulary (what states exist, what they mean, what visual weight they carry) rather than by designing each state independently.

5. **The identity decision is a product decision, not a design decision.** Do not assign it to a visual designer. It requires a product owner or stakeholder to choose between Positions A and B. Until that choice is made, the design brief for copy, metadata, onboarding, and social unfurls cannot be written — only the visual layer changes are specifiable.
