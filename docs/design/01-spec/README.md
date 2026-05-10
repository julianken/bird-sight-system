# 01 Spec — design contracts

This folder holds the canonical design contracts for the redesign. Each file covers one concern. Read them in any order; they're cross-linked.

## Reading order (if new to the redesign)

1. [`architecture.md`](./architecture.md) — the 30,000ft view: surfaces, primitives, layered structure
2. [`tokens.md`](./tokens.md) — three-tier token contract; namespace migration; type ramp
3. [`components.md`](./components.md) — five new primitives with prop APIs
4. [`url-state.md`](./url-state.md) — `pushState` for detail entry; `DEFAULTS.view='map'`
5. [`motion.md`](./motion.md) — global `prefers-reduced-motion` policy + MapLibre exception
6. [`voice-and-content.md`](./voice-and-content.md) — Position B voice, lede contract, freshness label, accent discipline
7. [`accessibility.md`](./accessibility.md) — preserved baseline + new contracts
8. [`open-questions.md`](./open-questions.md) — pre-ship gates G1–G8

## What each file is for

| File | When to read |
|---|---|
| `architecture.md` | First read; orienting view |
| `tokens.md` | When implementing or extending the token system, or adding a new theme |
| `components.md` | When building or consuming any of the 5 new primitives |
| `url-state.md` | When changing URL handling, default view, or back-navigation |
| `motion.md` | When adding any CSS transition or JS-driven animation |
| `voice-and-content.md` | When writing copy, the lede, error messages, or filter sentence |
| `accessibility.md` | When introducing or modifying any interactive element |
| `open-questions.md` | When you need to know what's not yet decided and why |

## Source of truth invariants

Several files in this folder reference single-source-of-truth modules:

- **Region label** — `frontend/src/config/region.ts` (Phase 1 deliverable)
- **Cluster thresholds** — `frontend/src/config/cluster.ts` (Phase 2 deliverable; consumed by both React and MapLibre)
- **Family palette** — `frontend/src/config/family-palette.ts` (Phase 2 deliverable)
- **Filter timings** — `frontend/src/config/filter.ts` (Phase 2 deliverable)
- **Freshness thresholds** — `frontend/src/config/freshness.ts` (Phase 2 deliverable)
- **Reduced-motion CSS** — `frontend/src/styles/motion.css` (Phase 0 deliverable)
- **Theme attribute** — `[data-theme]` on `<html>` (Phase 1 deliverable)

When in doubt, the code module's TS exports are the source of truth; this spec describes the contract those modules implement.

## Cross-references

- **Decisions table** that drives this spec: [`../00-overview/decisions.md`](../00-overview/decisions.md)
- **Phase plans** that ship the contracts here: [`../02-phases/`](../02-phases/)
- **Research backing each contract**: [`../03-research/`](../03-research/)
