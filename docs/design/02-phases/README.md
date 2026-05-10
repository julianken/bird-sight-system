# 02 Phases — implementation roadmap

Seven phases (0 through 6). Each phase becomes its own implementation plan in `docs/plans/`. Phase order is causally driven — earlier phases unblock later ones; out-of-order execution produces rework.

## Dependency graph

```
Phase 0 (engineering)
  ├── pushState — independent
  ├── DEFAULTS.view = 'map' — independent
  ├── motion.css — independent
  └── MapLibre easeTo guard — independent

Phase 1 (token foundation)
  ├── depends on: G3 (bundle baseline) for measurement
  ├── depends on: G7 (family-color × basemap contrast) before family-palette commits
  └── unblocks: Phase 2 (primitives consume tokens), all surface phases

Phase 2 (design-system primitives)
  ├── depends on: Phase 1 tokens
  ├── depends on: G4 (photo coverage) — closed; informs <Photo> no-photo state
  └── unblocks: Phase 3, 4, 5

Phase 3 (map surface)
  ├── depends on: Phase 2 (<ClusterPill>, <FamilyLegend> revision, <FilterSentence>)
  └── independent of Phase 4/5

Phase 4 (detail surface)
  ├── depends on: Phase 2 (<Photo>, <FamilySilhouette>, <StatusBlock>)
  ├── depends on: G6 (iOS safe-area) before mobile sheet
  └── independent of Phase 3/5

Phase 5 (feed + species surfaces)
  ├── depends on: Phase 2 (<FilterSentence>, <FamilySilhouette>)
  └── independent of Phase 3/4

Phase 6 (metadata + voice)
  ├── depends on: G1 (audience) — must close before voice strings ship
  ├── depends on: G2 (region precision) for region claim accuracy
  ├── depends on: Phase 1 (REGION_LABEL config)
  └── ships last — voice work needs all surface infrastructure in place
```

Phases 3, 4, 5 can ship in any order or in parallel after Phase 2 lands.

## Phase index

| # | Title | Goal | Plan | Status |
|---|---|---|---|---|
| 0 | [Pre-redesign engineering](./phase-0-pre-redesign.md) | `pushState` + `DEFAULTS.view='map'` + `motion.css` + MapLibre guard | [`../../plans/2026-05-09-sky-atlas-phase-0-pre-redesign.md`](../../plans/2026-05-09-sky-atlas-phase-0-pre-redesign.md) | Plan written |
| 1 | [Token foundation](./phase-1-token-foundation.md) | Three-tier tokens, `[data-theme]` mechanic, type ramp, lint guard | not yet written | — |
| 2 | [Design-system primitives](./phase-2-primitives.md) | `<StatusBlock>`, `<Photo>`, `<FamilySilhouette>`, `<ClusterPill>`, `<FilterSentence>` | not yet written | — |
| 3 | [Map surface redesign](./phase-3-map-surface.md) | Cluster pills + lede + FamilyLegend revision | not yet written | — |
| 4 | [Detail surface redesign](./phase-4-detail-surface.md) | Modal desktop + bottom-sheet mobile, photo masthead, h1 + focus | not yet written | — |
| 5 | [Feed + species surfaces](./phase-5-feed-species.md) | Top-notable card, search visual contrast, FilterSentence live region | not yet written | — |
| 6 | [Metadata + brand voice](./phase-6-metadata-voice.md) | 19 metadata gaps, voice strings, structured data | not yet written | — |

## Sequencing rationale

**Why Phase 0 first.** The `pushState` fix and `DEFAULTS.view='map'` resolve user-contract failures that exist *today*. Shipping them before any visual redesign means the visual redesign lands on a foundation users already trust. The motion policy + MapLibre guard land here too because they're prerequisites for any later motion work — once they exist, every subsequent phase can introduce CSS transitions or camera animations without an audit liability.

**Why Phase 1 before primitives.** The token system is the substrate for every primitive's visible properties. Implementing primitives against an unmigrated token namespace would mean rewriting them when the token migration lands. Phase 1 also establishes the lint guard that prevents silent collisions between v3 mock token names and the existing `--color-accent-notable-fg` semantics.

**Why Phase 2 before surfaces.** The five primitives unblock all three surface phases simultaneously. Building surfaces against ad-hoc CSS classes would mean rewriting them when the primitives land.

**Why Phases 3, 4, 5 are independent.** Each surface consumes the same primitives; they don't share state with each other. They can ship in parallel (different developers, different PRs) without coordination.

**Why Phase 6 last.** Voice + metadata is meaningful only when all the surfaces it speaks for exist. Shipping voice strings against unfinished surfaces creates revision churn (every Phase 3/4/5 PR would re-evaluate the affected copy). Phase 6 is also the one phase that depends on G1 — it must wait for that gate to close.

## Out-of-band engineering work

Two pieces of engineering that don't fit the phase model but are required:

- **Theme attribute inline script** in `frontend/index.html` — pre-paint script that reads `localStorage.theme` and sets `[data-theme]` on `<html>`. Lands in Phase 1 alongside the token migration, but is technically a one-line script change to `index.html`.
- **`frontend/src/config/` module** — five files (`region.ts`, `cluster.ts`, `family-palette.ts`, `filter.ts`, `freshness.ts`). Lands across Phases 1 and 2 (region in Phase 1; the rest in Phase 2 alongside the primitive that consumes them).

Both are called out in the phase plans where they land.

## Out-of-scope (deferred to v1.1)

- Stillness 3rd reduced-motion mode (explicit user toggle beyond OS-level)
- Geolocation "near me" map default
- Cluster-manifest keyboard rail (a11y improvement)
- Dark basemap (gated on G8; Phase 1 ships the mechanism but the toggle stays disabled if G8 fails)
- Per-surface chrome variation (Pattern F from analysis — IA-unsafe given current global filter coupling)

## Cross-references

- Decisions: [`../00-overview/decisions.md`](../00-overview/decisions.md)
- Spec contracts: [`../01-spec/`](../01-spec/)
- Critique loops that produced the phase boundaries: [`../03-research/critique-loops-summary.md`](../03-research/critique-loops-summary.md)
