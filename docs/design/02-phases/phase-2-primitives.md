# Phase 2 — Design-system primitives

**Status:** Not yet planned.

**Plan:** to be written via `superpowers:writing-plans` — output to `docs/plans/2026-XX-XX-sky-atlas-phase-2-primitives.md`.

## Goal

Ship the five new component primitives in `frontend/src/components/ds/`, each with a defined contract, unit tests, snapshot tests, and contract-enforcement (e.g., AA contrast assertions in `family-palette.test.ts`).

## What ships

| Primitive | File | Contract location |
|---|---|---|
| `<StatusBlock>` | `frontend/src/components/ds/StatusBlock.tsx` | [`../01-spec/components.md#statusblock`](../01-spec/components.md#statusblock) |
| `<Photo>` | `frontend/src/components/ds/Photo.tsx` | [`../01-spec/components.md#photo`](../01-spec/components.md#photo) |
| `<FamilySilhouette>` | `frontend/src/components/ds/FamilySilhouette.tsx` | [`../01-spec/components.md#familysilhouette`](../01-spec/components.md#familysilhouette) |
| `<ClusterPill>` | `frontend/src/components/ds/ClusterPill.tsx` | [`../01-spec/components.md#clusterpill`](../01-spec/components.md#clusterpill) |
| `<FilterSentence>` | `frontend/src/components/ds/FilterSentence.tsx` | [`../01-spec/components.md#filtersentence`](../01-spec/components.md#filtersentence) |
| `<SortLabel>` (sibling of `<FilterSentence>`) | `frontend/src/components/ds/SortLabel.tsx` | (small; prop is single string) |

Plus the `frontend/src/config/` files that drive primitive behavior:

- `frontend/src/config/cluster.ts` — `CLUSTER_TIER_BOUNDARIES`, `clusterTier()`
- `frontend/src/config/family-palette.ts` — `FAMILY_PALETTE`, `getFamilyChannel()`, AA-contrast unit tests
- `frontend/src/config/filter.ts` — `FILTER_SENTENCE_DEBOUNCE_MS`, `FILTER_SENTENCE_CLEAR_HOLD_MS`
- `frontend/src/config/freshness.ts` — `FRESHNESS_FRESH_MAX_MS`, `FRESHNESS_RECENT_MAX_MS`, `FRESHNESS_STALE_MIN_MS`

## Dependencies

- **Requires Phase 1** (token foundation) — primitives consume `--color-decision-point`, `--color-bg-skeleton`, etc. Without the tokens in place, primitive CSS would fall back to defaults.
- **Requires G4** (closed) — `<Photo>` no-photo state design treats silhouette fallback as hot path, not edge case.

## Acceptance criteria

- All five primitives covered by Vitest unit tests with full state-machine coverage.
- `family-palette.test.ts` asserts AA contrast (≥4.5:1) for every family channel against its `on` partner.
- `cluster.ts` has threshold boundary tests (sand at 100, ember at 750).
- Each primitive has at least one Playwright snapshot test in light + dark modes.
- `<Photo>` no-photo state renders `<FamilySilhouette>` correctly across all 7 family codes + the null-family case.
- Bundle size delta vs. G3 baseline is documented in PR description.

## What this phase does NOT include

- No surface-level adoption. The primitives ship in `components/ds/` and unit-test there; the surfaces (Phases 3–5) consume them.
- No `<FilterSentence>` mounting on actual surfaces — the component exists but doesn't ship integrated until Phase 5.

## Cross-references

- Spec: [`../01-spec/components.md`](../01-spec/components.md), [`../01-spec/accessibility.md`](../01-spec/accessibility.md)
- Critique loops K1 (family-channel mechanism), K2 (cluster threshold), K4 (`<Photo>` × `<StatusBlock>` boundary), K5 (filter-sentence template), K2/K3 (live-region debounce + role="img" cluster): [`../03-research/critique-loops-summary.md`](../03-research/critique-loops-summary.md)
- G4 photo coverage: [`../03-research/pre-ship-gates/G4-photo-coverage.md`](../03-research/pre-ship-gates/G4-photo-coverage.md)
