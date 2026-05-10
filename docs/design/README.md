# Sky Atlas — Design Documentation

This directory holds the synthesized design documentation for the Sky Atlas redesign of bird-maps.com. It is the single source of truth for the redesign — what it is, why it exists, what's been decided, what ships in what order, and where the underlying research lives.

**Audience:** maintainers, implementers (human or agent), reviewers. Everything here is meant to be readable cold.

## How to use this directory

- **If you're picking up implementation work** → start with `02-phases/` (find your phase's file, follow it to its plan in `docs/plans/`).
- **If you need a specific design contract** (token, component API, ARIA shape, motion rule) → go to `01-spec/`.
- **If you want to know why something was decided the way it was** → start with `00-overview/decisions.md`, then drill into `03-research/` if you need the evidence.
- **If you need a visual reference** → `04-visuals/`.
- **If you're auditing a claim or want to see the original research** → `05-archive/`. Everything synthesized in `00`–`04` traces back to artifacts here.

## Map

```
docs/design/
├── README.md                        ← you are here
├── 00-overview/                     why, decisions, visual direction
├── 01-spec/                         architecture, components, tokens, motion, voice, a11y, URL state, open questions
├── 02-phases/                       7 phases (0..6) + dependency graph; each phase links to its implementation plan
├── 03-research/                     synthesis of analysis funnel + design agents + critique loops + pre-ship gates
├── 04-visuals/                      hero mocks, system poster, surface mockups, before/after deltas
└── 05-archive/                      raw artifacts (analysis funnel, design-agent ideas, critique loop outputs, brainstorm HTML mocks)
```

## Index

### 00 Overview — what is this?
- [`00-overview/why.md`](./00-overview/why.md) — what bird-maps.com is today, what changed, why the redesign exists, who it's for
- [`00-overview/decisions.md`](./00-overview/decisions.md) — the 16-row canonical decisions table (every commitment, every source)
- [`00-overview/visual-direction.md`](./00-overview/visual-direction.md) — Sky Atlas visual identity in one page (palette, type, accent, mood)

### 01 Spec — what's it look like under the hood?
- [`01-spec/README.md`](./01-spec/README.md) — spec section index + reading order
- [`01-spec/architecture.md`](./01-spec/architecture.md) — three-tier token contract, surface system, light/dark mechanic
- [`01-spec/tokens.md`](./01-spec/tokens.md) — primitive → semantic → component token layers, namespace migration, type ramp
- [`01-spec/components.md`](./01-spec/components.md) — five new primitives (`<StatusBlock>`, `<Photo>`, `<FamilySilhouette>`, `<ClusterPill>`, `<FilterSentence>`) with prop APIs
- [`01-spec/motion.md`](./01-spec/motion.md) — global `prefers-reduced-motion` policy + MapLibre exception
- [`01-spec/voice-and-content.md`](./01-spec/voice-and-content.md) — Position B voice, lede contract, freshness label state machine, accent discipline
- [`01-spec/accessibility.md`](./01-spec/accessibility.md) — preserved baseline + new contracts (focus halo, cluster pill ARIA, sheet role-switching)
- [`01-spec/url-state.md`](./01-spec/url-state.md) — `pushState` for detail entry, `DEFAULTS.view='map'`, URL contract preserved
- [`01-spec/open-questions.md`](./01-spec/open-questions.md) — pre-ship gates G1–G8 (status, cost, resolution path)

### 02 Phases — what ships in what order?
- [`02-phases/README.md`](./02-phases/README.md) — phase index, dependency graph, sequencing rationale
- [`02-phases/phase-0-pre-redesign.md`](./02-phases/phase-0-pre-redesign.md) — `pushState` + `DEFAULTS.view='map'` + `motion.css` + MapLibre easeTo guard *(plan written)*
- [`02-phases/phase-1-token-foundation.md`](./02-phases/phase-1-token-foundation.md) — three-tier tokens, `[data-theme]` mechanic, type ramp, lint guard
- [`02-phases/phase-2-primitives.md`](./02-phases/phase-2-primitives.md) — five new components in `frontend/src/components/ds/`
- [`02-phases/phase-3-map-surface.md`](./02-phases/phase-3-map-surface.md) — Sky Atlas map redesign (cluster pills, lede, FamilyLegend revision)
- [`02-phases/phase-4-detail-surface.md`](./02-phases/phase-4-detail-surface.md) — modal desktop + bottom-sheet mobile, photo masthead, h1 + focus
- [`02-phases/phase-5-feed-species.md`](./02-phases/phase-5-feed-species.md) — feed top-notable card-row, species-search visual contrast, FilterSentence live region
- [`02-phases/phase-6-metadata-voice.md`](./02-phases/phase-6-metadata-voice.md) — 19 metadata gaps, voice strings rewritten in Position B, structured data

### 03 Research — what evidence does this rest on?
- [`03-research/README.md`](./03-research/README.md) — research index
- [`03-research/analysis-funnel-summary.md`](./03-research/analysis-funnel-summary.md) — 5-area analysis condensed to its 5 themes + 6 recommendations
- [`03-research/design-agents-summary.md`](./03-research/design-agents-summary.md) — 5 specialist agents' ideas: convergent moves, individual moves, dissent
- [`03-research/critique-loops-summary.md`](./03-research/critique-loops-summary.md) — 3 critic-planner loops: 19 kinks, 16 spec contracts, 3 visual deltas
- [`03-research/pre-ship-gates/G1-audience.md`](./03-research/pre-ship-gates/G1-audience.md) — PostHog audit brief (deferred, gates Phase 6)
- [`03-research/pre-ship-gates/G4-photo-coverage.md`](./03-research/pre-ship-gates/G4-photo-coverage.md) — closed at 91.1% coverage; no-photo state on hot path

### 04 Visuals — what does it look like?
- [`04-visuals/README.md`](./04-visuals/README.md) — visual index + when to look at each image
- `system-poster.png` — palette, type ramp, components, photo treatment, motion (light + dark)
- `map-desktop-pair.png` — map surface, light + dark
- `detail-desktop-pair.png` — species detail modal, light + dark
- `feed-desktop.png` — feed view with newspaper lede + top-notable card-row
- `mobile-triplet.png` — mobile map + bottom-sheet detail + system skeleton loading state
- `v3-full.png` — full v3 mock page (all surfaces, all modes)
- `v4-full.png` — v3→v4 critique-loop deltas

### 05 Archive — where did this come from?
- [`05-archive/README.md`](./05-archive/README.md) — what's archived and why
- `05-archive/analysis-funnel/` — full analysis-funnel artifacts (5 areas + 5 iterators + 3 syntheses + final report)
- `05-archive/design-agents/` — 5 specialist agent outputs (UX, design-system, a11y, iOS-style, dissent)
- `05-archive/critique-loops/` — 3 loops × (critic + planner) = 6 outputs + decisions table snapshot
- `05-archive/brainstorm-mocks/` — standalone HTML mockups from the brainstorm (system, v3, v4)

## Cross-links to other repo locations

- **Implementation plans:** `docs/plans/` — one plan per phase. Phase 0 plan: [`docs/plans/2026-05-09-sky-atlas-phase-0-pre-redesign.md`](../plans/2026-05-09-sky-atlas-phase-0-pre-redesign.md)
- **Original architecture spec:** [`docs/specs/2026-04-16-bird-watch-design.md`](../specs/2026-04-16-bird-watch-design.md) — pre-redesign system architecture; the redesign sits on top
- **Repo CLAUDE.md:** [`../../CLAUDE.md`](../../CLAUDE.md) — repo-wide conventions (PR workflow, prototype gate, library churn list)

## Conventions used in this directory

- **Synthesis files** (00–04) are tight, current-state-of-truth documents. They reference each other and `05-archive/` for evidence; they don't duplicate it.
- **Archive files** (05) are read-only — they reflect the state at the time of capture and are NOT updated as decisions evolve. Treat them as evidence, not as source of truth.
- **Every contract has concrete values** (token names, debounce ms, font sizes, snap heights, threshold counts). No "TBD" or "appropriate" qualifiers.
- **File paths** in citations use the form `frontend/src/path:LINE` (single line) or `frontend/src/path:START–END` (range). Asset paths are repo-relative.
- **Decisions are versioned only by date.** When a decision changes, update the relevant `01-spec/` file and add a footnote linking to the prior decision in `05-archive/`.

## When this directory needs to change

- **Adding a new phase / shifting phase boundaries** → update `02-phases/README.md` + the affected phase files. Don't break the dependency graph.
- **Resolving an open question (G1–G8)** → update `01-spec/open-questions.md` + the relevant `03-research/pre-ship-gates/` file. If the resolution affects spec contracts, follow through to `01-spec/`.
- **A critique-loop revision after implementation surfaces something** → update the relevant `01-spec/` file + add a dated note. Don't rewrite the archive.
- **The visual direction itself changes** → that's a new redesign, not a revision. Open a new `docs/design/<date>-<name>/` tree alongside this one.
