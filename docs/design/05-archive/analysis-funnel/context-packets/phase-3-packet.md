# Context Packet: Phase 3 → Phase 4

Compares the 3 synthesis lenses. Phase 4 will read the full Phase 3 artifacts plus this packet plus phase-0-packet.

## Where the 3 lenses agree (the spine of the report)

All three syntheses converge on the same core structure:

1. **Voice/identity decision is the upstream bottleneck.** Synth 1 calls it "identity vacancy is the upstream blocker." Synth 2 names voice (Position B) as the highest-leverage opportunity (O1) at lowest cost. Synth 3 makes it D1 in the dependency graph and S2 in stakeholder decisions. All three converge: this is **decision #1**.

2. **`pushState` (~40 lines, Option D) is a pre-redesign engineering fix, not a design problem.** Synth 1 lists it under "two small decisions unlock the majority of the redesign surface." Synth 2 lists it as O3 ("removes the biggest IA defect before any visual work"). Synth 3 makes it Conclusion 3 with explicit "should be a pre-redesign engineering fix." Treat as **prerequisite work**.

3. **Pattern A (bottom tab + filter sheet) + detail Option B (`<dialog>`) converge on one overlay strategy.** Synth 1 names the design system as a "skeleton, not a system" and identifies `<dialog>` as the load-bearing asset. Synth 2 names this O2 (highest-leverage opportunity for unification). Synth 3 makes it Recommendation 4. **One overlay primitive serves both.**

4. **Filter-active indicator is a new design-system component, not a tweak.** Synth 1 calls state-invisibility the "primary usability failure." Synth 2 makes it R3 (highest-likelihood high-severity risk if Pattern A ships without it) AND O6 (opportunity). Synth 3 makes it G4 (gap that must close *before* chrome compaction design begins). **Required prerequisite for any chrome compaction.**

5. **Loading/empty/error state redesign is the largest unimproved pixel surface and can begin immediately.** Synth 1 (Theme 2): state invisibility is the primary failure. Synth 2 O4: highest-value opportunity by pixel area. Synth 3 D6: the only decision that does NOT wait for D1. **Start here if other decisions are blocked.**

6. **The accessibility baseline is exceptional and easy to break.** All three syntheses end with a non-regression imperative: WAI-ARIA tablist (DOM-order, not visual), native `<dialog>`, native `<select>`/`<datalist>`, focus-visible 2px outline, landmark order. Axe enforces 13 surface×viewport×state combinations. **Redesign must protect, not refactor.**

## Where the 3 lenses see different things (productive tensions)

- **Synth 1 (Thematic) emphasizes** that the underlying problem is "implicit decisions made explicit." The visual redesign is downstream of structural commitments. → Frames the problem at the *systems* level.
- **Synth 2 (Risk/Opportunity) emphasizes** Pattern A as the highest-leverage-and-highest-risk single decision (its named pairing). Risks cluster around 3 things mis-handled at once: filter indicator, DOM-order tablist, Credits prominence. → Frames the problem at the *implementation discipline* level.
- **Synth 3 (Gap/Implication) emphasizes** that the analysis is *complete* — no more analysis needed; what's needed is stakeholder commitments (S1–S4). → Frames the problem at the *decision-sequencing* level.

These are complementary, not conflicting. Phase 4 should weave all three: systems framing (Synth 1) + implementation pairing-risks (Synth 2) + decision dependency graph (Synth 3).

## What each synthesis identifies as its blind spot (so Phase 4 can compensate)

**Synth 1 (Thematic) blind spots:**
- Real user behavior absent (no analytics, sessions, interviews).
- Performance underweighted as design constraint.
- Map surface treated as visual-layer constant (scope artifact).
- Existing user mental models (switching costs of voice change) unsampled.
- Touch interaction depth not captured.

**Synth 2 (Risk/Opportunity) blind spots:**
- Reversibility bias — under-weights aesthetic/qualitative considerations.
- User-sampling gap (audience profile unknown).
- Sequencing as strategy — identifies what to do, weaker on when.

**Synth 3 (Gap/Implication) blind spots:**
- Strong baselines underweighted (focuses on 12 gaps; doesn't dwell on excellent infrastructure).
- Dependency graph implies serial schedule when it's actually a dependency map.
- "Gap" language can pathologize intentional minimalism (system fonts, no animation, terse copy = deliberate engineering).
- Lens cannot assess risk tolerance without audience data.

**Common gap across all three:** the audience profile (G1 in Synth 3) — unsampled PostHog. This single piece of data could shift trade-off severities meaningfully. Phase 4 should surface this as a top-of-report caveat.

## Convergent recommendations (with strongest support)

1. **Commit to Position B (opinionated utility) voice as Phase 0.** All 3 syntheses agree: lowest cost, broadest unblocking. Position C structurally unavailable; Position A has documented ongoing costs.
2. **Ship `pushState` as a standalone pre-redesign code-only PR (Option D, ~40 lines).** All 3 syntheses agree.
3. **Begin loading/empty/error state visual language immediately** — does not wait for voice decision. Synth 1, 2, 3 all surface this as the parallel-startable workstream.
4. **Design Pattern A and detail Option B as one overlay system.** All 3 syntheses converge on `<dialog>` reuse.
5. **The filter-active indicator must be specified before chrome compaction design begins.** Synth 2 makes it R3+O6; Synth 3 makes it G4 (prerequisite gap).
6. **Prototype the FamilyLegend collapse before committing.** Synth 2 R7; Synth 3 G9 — agreed unknowable analytically.
7. **Protect the accessibility baseline as an explicit constraint layer in the brief.** All 3 syntheses identify this.

## Caveats for Phase 4

- **Audience profile gap** (G1 / Synth 3): the single highest-leverage piece of missing information. Phase 4 should explicitly note that any voice-position trade-off assessment is conditional on this.
- **Existing-user switching costs** (Synth 1 blind spot 4): if the site has regular users with established mental models, voice shift may cost more than analysis suggests. Worth a sentence in the report.
- **Aesthetic register is under-evidenced** (Synth 2 blind spot 1): the analysis is heavy on structure, light on "what should it feel like." Phase 4 should be honest that aesthetic direction is downstream of the analysis, not derivable from it.

## Artifacts (Phase 4 reads these in full)

- `phase-3/synthesis-1-thematic.md` (~158 lines)
- `phase-3/synthesis-2-risk-opportunity.md` (~273 lines)
- `phase-3/synthesis-3-gap-implication.md` (~250 lines)
- `phase-2/iterator-1..5-*.md` (read on demand)
- `phase-1/area-1..5-*.md` (read on demand)
- `screenshots/{local,prod,states}/{desktop,mobile}/*.png` (~48 captures)
