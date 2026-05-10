# 03 Research — synthesized evidence

Three research streams produced the evidence behind every decision in [`../00-overview/decisions.md`](../00-overview/decisions.md). This folder holds the *synthesized* version of each. The full raw artifacts are in [`../05-archive/`](../05-archive/) for traceability.

## Streams

| Stream | When run | What it produced | Synthesis here | Raw archive |
|---|---|---|---|---|
| **Analysis funnel** (5→5→3→1 method) | Before brainstorm | 5 areas of investigation, 5 iterations, 3 syntheses, 1 unified report | [`analysis-funnel-summary.md`](./analysis-funnel-summary.md) | [`../05-archive/analysis-funnel/`](../05-archive/analysis-funnel/) |
| **5 design agents** | Mid-brainstorm | 5 specialist perspectives generating their own design ideas | [`design-agents-summary.md`](./design-agents-summary.md) | [`../05-archive/design-agents/`](../05-archive/design-agents/) |
| **3 critique-planner loops** | After brainstorm | 19 kinks identified; 16 spec contracts + 3 visual deltas | [`critique-loops-summary.md`](./critique-loops-summary.md) | [`../05-archive/critique-loops/`](../05-archive/critique-loops/) |

Plus one cross-stream artifact:

- **Pre-ship gates** (G1–G8) — open questions from the analysis funnel, status updated as work progresses. See [`pre-ship-gates/`](./pre-ship-gates/).

## How these connect to the spec

Every spec contract in [`../01-spec/`](../01-spec/) traces back to one or more research findings. When in doubt about *why* a decision was made, follow this chain:

1. Decision in [`../00-overview/decisions.md`](../00-overview/decisions.md) (one-row entry)
2. Spec contract in [`../01-spec/<topic>.md`](../01-spec/) (the contract)
3. Research synthesis in this folder (the evidence)
4. Raw archive in [`../05-archive/`](../05-archive/) (the original artifact)

Layers 1–3 are kept current; layer 4 is read-only (snapshot at time of capture).

## Reading order

If you're new to the redesign and want to understand how the decisions were derived:

1. [`analysis-funnel-summary.md`](./analysis-funnel-summary.md) — what the existing site does well + where it fails
2. [`design-agents-summary.md`](./design-agents-summary.md) — what 5 specialists independently proposed
3. [`critique-loops-summary.md`](./critique-loops-summary.md) — what 3 rounds of critic-planner iteration sharpened
4. [`pre-ship-gates/`](./pre-ship-gates/) — what's still open and how to close it

## What you won't find here

- Detailed contract specifications — those live in [`../01-spec/`](../01-spec/)
- Implementation steps — those live in [`../02-phases/`](../02-phases/) and the phase plans
- Visual mockups — those live in [`../04-visuals/`](../04-visuals/)
