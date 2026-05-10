# 05 Archive — raw research artifacts

Read-only snapshots of the research that produced the redesign. Synthesized versions are in [`../03-research/`](../03-research/). The originals here are evidence of provenance, not source of truth.

## Why an archive

Two reasons:

1. **Auditability.** When a synthesis claim in `03-research/` cites "the analysis funnel found X," a reviewer can follow the link to `05-archive/analysis-funnel/...` and verify the claim against the original artifact. The synthesis files don't reproduce every detail; the archive does.

2. **Decision archaeology.** Months from now, when someone asks "why did we choose Sky Atlas over Field Notebook?", the answer is in `05-archive/design-agents/agent-5-dissent-counterproposal.md` — Agent 5's full reasoning at the time of the brainstorm. The synthesized version compresses; the archive preserves.

## Contents

```
05-archive/
├── README.md                        ← you are here
├── analysis-funnel/                 5→5→3→1 funnel artifacts
│   ├── STATUS.md                    funnel state at completion
│   ├── phase-0/analysis-brief.md    framing (audience, scope, criteria)
│   ├── phase-1/area-{1..5}-*.md     5 parallel investigations
│   ├── phase-2/iterator-{1..5}-*.md 5 parallel iterations
│   ├── phase-3/synthesis-{1..3}.md  3 synthesizers (thematic, risk/opportunity, gap/implication)
│   ├── phase-4/analysis-report.md   final unified report (700+ lines, the canonical analysis output)
│   └── context-packets/phase-{0..3}-packet.md  compressed handoffs between phases
│
├── design-agents/                   5 specialist design agents
│   ├── agent-1-ui-ux-designer.md    user moments + visual hierarchy
│   ├── agent-2-design-system-architect.md  primitives, tokens, scale
│   ├── agent-3-accessibility-designer.md   a11y-shaped design
│   ├── agent-4-ios-style-designer.md       Apple HIG / native polish
│   └── agent-5-dissent-counterproposal.md  pushback + alternative directions
│
├── critique-loops/                  3 critic-planner loops
│   ├── decisions-table.md           snapshot of decisions at start of loops
│   ├── loop-1-critic.md / loop-1-planner.md   strategic kinks
│   ├── loop-2-critic.md / loop-2-planner.md   system cohesion
│   └── loop-3-critic.md / loop-3-planner.md   a11y + final polish
│
└── brainstorm-mocks/                standalone HTML brainstorm mocks
    ├── sky-atlas-system.html        system poster (palette + type + components)
    ├── sky-atlas-v3.html            full v3 mock (all surfaces, light + dark)
    └── sky-atlas-v4.html            v3→v4 deltas (3 visual changes + 16 spec-only)
```

## When to read which file

| If you're asking… | Read… |
|---|---|
| "What's the overall analysis evidence?" | `analysis-funnel/phase-4/analysis-report.md` (the full 700-line unified report) |
| "What did the analysis find about <specific area>?" | `analysis-funnel/phase-1/area-N-*.md` (one of the 5 parallel investigations) |
| "How did one of the design agents argue?" | `design-agents/agent-N-*.md` |
| "What did the dissent agent push back on?" | `design-agents/agent-5-dissent-counterproposal.md` |
| "What kinks did the critique loops find?" | `critique-loops/loop-N-critic.md` |
| "What were the proposed fixes for those kinks?" | `critique-loops/loop-N-planner.md` |
| "What did the brainstorm mockup actually look like in HTML?" | `brainstorm-mocks/sky-atlas-v3.html` (open in a browser) |
| "Where did the v3→v4 changes come from?" | `brainstorm-mocks/sky-atlas-v4.html` + `critique-loops/loop-N-*` |

## Read-only invariant

**These files are not updated when decisions evolve.** They reflect the state at time of capture. If a decision in [`../00-overview/decisions.md`](../00-overview/decisions.md) was reversed after Phase 3 implementation surfaced a problem, that's recorded in the synthesis files (with a dated footnote) — not by editing the archive.

If you find an error in the archive (typo, broken link), fix it. If you find that a claim in the archive is *no longer true*, **don't edit it** — instead update the relevant synthesis file in `03-research/` with a dated note.

## Cross-references

- Synthesis index: [`../03-research/README.md`](../03-research/README.md)
- Decisions table (current state): [`../00-overview/decisions.md`](../00-overview/decisions.md)
- Spec contracts (current state): [`../01-spec/`](../01-spec/)
