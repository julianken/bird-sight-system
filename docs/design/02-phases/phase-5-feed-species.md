# Phase 5 — Feed + Species surfaces

**Status:** Not yet planned.

**Plan:** to be written via `superpowers:writing-plans` — output to `docs/plans/2026-XX-XX-sky-atlas-phase-5-feed-species.md`.

## Goal

Apply the Sky Atlas treatment to the feed and species surfaces. Feed gets the newspaper lede + top-notable card-row + flat list rows with `<FamilySilhouette>` thumbs. Species surface sharpens the visual contrast between the surface-level autocomplete (navigates) and the header filter input (narrows in place). `<FilterSentence>` mounts on both surfaces with its live-region debounce contract.

## What ships

| Change | File |
|---|---|
| `<FeedSurface>` rewrite: lede, top-notable card-row, flat list rows with silhouette thumbs | `frontend/src/components/FeedSurface.tsx` |
| `<FeedCard>` for the top notable row (existing pattern, formalized) | `frontend/src/components/FeedCard.tsx` (new or refactored) |
| `<FeedRow>` for flat list rows | `frontend/src/components/FeedRow.tsx` (refactored from existing `ObservationFeedRow`) |
| `<SpeciesSearchSurface>` visual revision: hero autocomplete + sharper distinction from header filter | `frontend/src/components/SpeciesSearchSurface.tsx` |
| `<FilterSentence>` mounted on Map / Feed / Species surfaces | `<MapSurface>`, `<FeedSurface>`, `<SpeciesSearchSurface>` |
| `<SortLabel>` mounted on Feed surface as separate sibling above `<FilterSentence>` | `<FeedSurface>` |
| Feed list pagination/virtualization (if needed for perf at 344+ rows) | `<FeedSurface>` (only if Lighthouse flags) |

## Dependencies

- **Requires Phase 2** (`<FilterSentence>`, `<FamilySilhouette>`, `<SortLabel>`).
- **Requires Phase 3** (the surface chrome pattern is established by the map surface; feed and species inherit it).

## Acceptance criteria

- Top notable feed row renders as elevated card-row; remaining rows flat.
- Family silhouette thumbs (replacing emoji thumbs from v3 mock) render correctly for all 7 families + the null-family neutral path.
- `<FilterSentence>` debounces 500ms before SR announcement; cleared transition holds "All filters cleared." for 1500ms.
- Manual VoiceOver test confirms filter changes announce settled state once (not announce-storm on each toggle).
- Two species inputs (header filter vs surface autocomplete) are visually distinguishable: header is a chip-shaped narrow control; surface autocomplete is a hero-sized input with icon.
- `<SortLabel>` shows "Sorted by recency" (or alternative if sort changes); does not couple to `<FilterSentence>`.
- Detail navigation from feed row click pushState (per Phase 0); browser back works.

## Implementation order (within phase)

1. Refactor `<ObservationFeedRow>` → `<FeedRow>` consuming `<FamilySilhouette>` thumbs
2. Build `<FeedCard>` for top-notable treatment
3. `<FeedSurface>` lede + filter sentence + sort label structure
4. Mount `<FilterSentence>` on `<MapSurface>` and `<SpeciesSearchSurface>`
5. `<SpeciesSearchSurface>` visual revision — hero autocomplete sharpening
6. Manual VoiceOver pass on filter changes

## What this phase does NOT include

- Map surface (Phase 3 — already done)
- Detail surface (Phase 4 — already done)
- Voice / metadata (Phase 6)
- Pagination/virtualization unless flagged by perf tests

## Cross-references

- Spec: [`../01-spec/components.md`](../01-spec/components.md) (`<FilterSentence>`, `<FamilySilhouette>`, `<SortLabel>`), [`../01-spec/accessibility.md`](../01-spec/accessibility.md) (live region contract)
- Visuals: [`../04-visuals/feed-desktop.png`](../04-visuals/feed-desktop.png)
- Critique loops K2 (filter-sentence live region debounce): [`../03-research/critique-loops-summary.md`](../03-research/critique-loops-summary.md)
