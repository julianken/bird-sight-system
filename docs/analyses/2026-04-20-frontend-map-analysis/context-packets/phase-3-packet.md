# Phase 3 Packet — Handoff to the Phase 4 Unifier

The three Phase 3 synthesizers applied different lenses to the same evidence and arrived at strongly complementary — not contradictory — narratives. This packet is a compressed comparison of the three. The Phase 4 agent is the one exception to "packets only, never raw artifacts": read this packet, the phase-0 packet, AND the full Phase 3 artifacts at `phase-3/synthesis-{1..3}.md` (they are ~3k words each and carry the detail the final report cannot lose).

## Headline

All three lenses converge on the same decision space but with different emphasis. Where they disagree, the disagreement is instructive, not contradictory.

---

## Synthesis 1 — Thematic (5 themes)

Synthesis 1 frames the failure as a coherent causal chain:

1. **The Ecoregion Frame Is an Imposed Metaphor.** The ecoregion is an ornithological classification most users don't carry. The SVG suppresses observation lat/lng to polygon poles-of-inaccessibility, hides behind coloured blobs with no legend, and makes 3 Sky Islands visually indistinguishable. The frame, not the rendering bugs, is the root.
2. **The Data Is Rich; the Display Is Silent.** 12 populated fields dropped. `obsDt` is the single most indefensible omission — the server `ORDER BY`s on it, the UI shows nothing temporal. 5 latent concepts are implementable with zero backend changes.
3. **The Engineering Ledger Is Deeply Unbalanced.** ~1,000 LOC rendering code + ~1,100 LOC rendering tests + 18 dragons + 6 SVG correctness mechanisms + 2 DB migrations propagated backward into the data model. Buys 6/14 task score.
4. **The Plan Was Wrong in a Knowable Way.** 5 plan assumptions tombstoned within days. 14/17 dragons were predictable (SVG fundamentals or AZ domain knowledge). A 2-hour prototype would have caught them.
5. **The Scaffolding Is Sound.** ~653 LOC KEEP, 8/16 e2e specs survive, `SpeciesPanel` is the strongest feature. The reimagining inherits real assets.

**Thematic blind spots it names:** user preference vs. task-fit ambiguity; operational stability (ingestor stall) outside the thematic frame; hybrid-path mode-selection UX cost is unexamined.

---

## Synthesis 2 — Risk / Opportunity

Synthesis 2 rates 10 risks and 11 opportunities. The most load-bearing:

### Critical / High risks
- **R1 — Rendering churn escalates to blocking** (High, near-certain if status quo persists).
- **R2 — Ingestor stall masks volume assumptions** (High, likely; healthy volume may be 4-6x higher).
- **R3 — Reimagining recreates the ecoregion taxonomy problem in a new medium** (High, possible — if brainstorm doesn't separate taxonomy / rendering / implementation decisions).
- **R10 — Process failure repeats; no prototype gate before plan** (High, possible).

### Medium risks
- **R4 — SpeciesPanel `position: fixed` breaks in non-map layout** (Likely).
- **R5 — `?region=` URL migration silently breaks bookmarks** (Likely).
- **R6 — Path-C ceiling mismatched to Path-A implementation rubric** (Possible — ship Path A, defer Path B indefinitely).
- **R7 — "Ditch the map" misread as "ditch spatial entirely"** (Possible; user may regret losing geography).
- **R8 — No CDN/gzip on API; caching-assumption is wrong** (Near-certain; ~90% payload reduction available as a one-line fix).
- **R9 — Backend species-dedup semantics misunderstood** (Possible; observation counts ≠ species counts).

### Top opportunities (Value High × Cost Low)
- **O1 — Resurrect `obsDt`** (zero backend changes; enables T7 score 0 → 2).
- **O2 — Resurrect observation lat/lng** (zero backend changes; enables T2/T5).
- **O6 — Gzip/compression** (~90% payload reduction; one-line change).
- **O7 — Mandatory prototype gate before plan authorship** (process opportunity; eliminates R10's failure class).

### Top 5 brainstorm takeaways from S2
1. Resolve SVG-vs-geography distinction (addresses R7 + R3).
2. Commit to a prototype gate (addresses R10).
3. Treat the 5 latent fields as first-day wins (O1–O5).
4. Enable gzip before scoping mobile (O6).
5. Classify SpeciesPanel as REFACTOR-layout, not KEEP (R4).

**Risk-lens blind spots it names:** personal-project dimension; some risks are interdependent rather than independent; low-severity risks might compound.

---

## Synthesis 3 — Gap / Implication

Synthesis 3 separates decisions by who owns them:

### 8 decisions the analysis closes
1. Drop `geo/path.ts` + `computeExpandTransform` from forward design.
2. `SpeciesPanel` + `useSpeciesDetail` + `ApiClient` + `FiltersBar` + URL state + axe discipline stack survives intact.
3. Backend is ready — no backend work required for any of Paths A/B/C.
4. 5 LATENT concepts are pre-approved for integration.
5. URL filter contract migrates unchanged; `?region=` is the only open URL decision.
6. 8 map-specific e2e specs DISCARD; 8 design-agnostic specs survive.
7. Path C is strictly dominant by task fit (14/14) — but Path A is the safest starting posture.
8. Ecoregion taxonomy survives as filter/facet, not as default visual container.

### 6 questions the analysis cannot close
1. **What do actual users do?** — no user research; methodological limit.
2. **Which user archetype is the default?** — 30-second product call Julian must make.
3. **Rescue-vs-reimagine — sized, not chosen.** — 1-week 3-5 dragons vs 2-3 week Path A vs longer Path C — judgment call.
4. **Observation grain — species-aggregate or single-observation?** — determines backend-work scope.
5. **Operational hygiene — ingestor-first or redesign-first?** — static analysis cannot decide.
6. **Path A/B phase boundary — when/if spatial mode launches.** — design territory.

### 6 reframes the analysis forces
1. **"Ditch the map" → three separable decisions** (SVG rendering / ecoregion taxonomy / from-scratch implementation).
2. **"The map is broken" → half structural + half under-executed** (Iterator 4 Counter 1 credibility).
3. **"Rich data is dropped" → 5 latent concepts pre-approved with zero backend work.**
4. **"Starting from scratch" → 33% KEEP / 16% REFACTOR / 51% DISCARD.**
5. **"The UI doesn't serve users" → strongest component (SpeciesPanel) hidden behind weakest interaction.**
6. **"SVG code is too complex" → data model was modified to serve SVG — 306 SQL LOC become eligible for removal.**

### 5 questions the brainstorm MUST answer (priority order)
1. Which user archetype is the default?
2. Rescue-vs-reimagine (sized, not chosen).
3. Observation grain (species-aggregate or single-observation).
4. `?region=` URL migration policy.
5. Path A/B phase boundary.

**Gap-lens blind spots it names:** personal-project context; risk asymmetry not captured; process-legacy effect (Julian's preferences built up over 100+ PRs) underweighted.

---

## Convergences across all 3 syntheses

1. **The decision space separates into three dimensions:** taxonomy (keep/demote ecoregion), rendering (SVG/real-basemap/no-spatial), and process (prototype before plan). All three syntheses name this separation.
2. **Field resurrection is the highest-value lowest-cost improvement.** `obsDt`, observation lat/lng, `locName`, `howMany`, `isNotable` row-level, `latestObsDt`, `taxonOrder` — none require backend changes. All three syntheses name this.
3. **The scaffolding is a genuine asset.** Not starting from zero. ~33% KEEP.
4. **Path C (hybrid) dominates task fit** but Path A (non-spatial) is the safest starting posture.
5. **A 1-2 week focused rescue closes only 3–5 of 18 dragons** — not worth it if the decision is to reimagine.

## Tensions across the 3 syntheses

1. **Emphasis on "rescue is viable."** Synthesis 1 treats it as a weak option (Theme 4 Counter 1 at moderate credibility). Synthesis 2 treats it as a Medium-value Low-cost stabilization tax (neither highly valuable nor highly risky to skip). Synthesis 3 makes it a priority-2 brainstorm decision (must be sized, not assumed away). The three don't disagree, but their weighting differs. The Phase 4 unifier should carry all three perspectives rather than collapse them.

2. **How hard to push the hybrid path.** Synthesis 1 treats Path C as the leading option (dominates task fit). Synthesis 2 flags R6 (Path-C-ceiling-mismatch-to-Path-A-implementation-rubric) as a real risk — ship Path A and defer Path B indefinitely becomes the likely outcome. Synthesis 3 lists "Path A/B phase boundary" as question 5 of 5 — not the highest priority. Phase 4 should name this tension: Path C looks best on paper, but its split-ship nature is the risk.

3. **How much to emphasise the user-research gap.** Synthesis 1 names it as a thematic blind spot but does not emphasise it. Synthesis 2 does not touch it directly. Synthesis 3 makes it Question 1 ("what do actual users do?") — and explicitly says "leave user research out" in the brainstorm implications. All three agree the gap exists; they differ on how prominently to surface it. Phase 4 should acknowledge the gap honestly without paralyzing action.

4. **Operational incident framing.** Synthesis 2 raises the ingestor stall as R2 (High severity). Synthesis 3 raises it as Question 5 (brainstorm cannot decide). Synthesis 1 names it as blind spot #2. Consensus: acknowledge it, don't let it block the analysis, flag it explicitly to the user as a parallel operational concern.

## What Phase 4 must deliver

The Phase 4 unifier produces the final analysis report (`phase-4/analysis-report.md`), following the template at `/Users/j/.claude/skills/analysis-funnel/references/report-template.md`. The report:

- Weaves insights from all three lenses into a single coherent document.
- Does NOT "pick the best of three" — all three syntheses contribute.
- Is evidence-grounded with an evidence index.
- States a confidence assessment.
- Serves the stated audience: Julian (solo dev, user, about to run a brainstorm).
- Under no circumstances proposes replacement designs, recommends libraries, or closes the questions Synthesis 3 explicitly names as brainstorm-owned.

---

## Phase 3 artifact index

- `phase-3/synthesis-1.md` — Thematic synthesis (5 themes, ~3100 words).
- `phase-3/synthesis-2.md` — Risk / Opportunity synthesis (10 risks, 11 opportunities, severity-rated).
- `phase-3/synthesis-3.md` — Gap / Implication synthesis (8 closed decisions, 6 open questions, 6 reframes, 5 priority questions).
