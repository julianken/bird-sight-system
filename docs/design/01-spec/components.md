# Components — five new primitives

The redesign introduces five new components in `frontend/src/components/ds/`. Each has a defined contract: prop types, internal state machine, accessibility requirements, and what existing patterns it replaces.

## Why these five

The existing codebase has zero component primitives between tokens and surfaces. Every surface improvises against `frontend/src/styles.css` and reimplements common patterns (loading states, photo treatment, family-color rendering). Five primitives collapse the most common reimplementations into typed APIs.

| Primitive | Replaces | Phase |
|---|---|---|
| `<StatusBlock>` | 14 distinct copy+class pairs for loading/empty/error | Phase 2 |
| `<Photo>` | Inline `<img>` + manual aspect-ratio + manual attribution overlay | Phase 2 |
| `<FamilySilhouette>` | Inline SVG `<path>` from DB + manual color tinting | Phase 2 |
| `<ClusterPill>` | Solid filled MapLibre cluster circles | Phase 2/3 |
| `<FilterSentence>` | Hand-built filter-active strings per surface | Phase 2/5 |

## `<StatusBlock>`

Page-level status primitive. Replaces 9 distinct ad-hoc CSS classes (`.feed-empty`, `.species-search-empty`, `.species-detail-loading`, `.species-detail-error`, `.attribution-modal-loading`, `.attribution-modal-empty`, `.attribution-modal-error`, `.error-screen`, `.map-loading-skeleton`) and 14 distinct copy+class pairs.

```ts
type StatusBlockProps = {
  state: 'loading' | 'empty' | 'error';
  title: string;
  body?: string;
  surface?: 'page' | 'panel' | 'modal' | 'list' | 'overlay';  // affects density
  action?: { label: string; onClick: () => void };
  tone?: 'subtle' | 'alert';  // default: subtle for loading/empty; alert for error
};
```

State rendering:

- `state="loading"` — flat skeleton rectangle at expected content dimensions (no shimmer); 2px sunrise-orange progress bar at the top of the chrome (Safari URL-bar style; indeterminate `<progress>`).
- `state="empty"` — muted centered text + optional action button. Voice register: declarative-direct (see [`voice-and-content.md`](./voice-and-content.md)).
- `state="error"` — red-tinted background (`var(--color-error-bg)`), dark-red border, crafted copy. **Never** raw `error.message`. Replaces the `App.tsx:147` `<p>{error.message}</p>` pass-through.

**Does NOT compose with `<Photo>`.** They live at different levels of the tree. See [`<Photo>`](#photo) below.

A11y: the loading skeleton renders inside `role="status" aria-live="polite"` so SR users hear "Loading…" once on entry. The 2px progress bar is `<progress>` (indeterminate); SR identifies it as "progress, busy."

## `<Photo>`

Owns its own internal state machine. Replaces the inline iNat photo `<img>` on the species detail surface; generalizes for future use (feed thumbs, future `species` surface results).

```ts
type PhotoProps = {
  src: string | null;                  // null = no photo for this species
  alt: string;
  family: FamilyCode | null;           // null = species has no family code (rare; ~2 species in 14d window)
  priority?: boolean;                  // default false; true → loading="eager" fetchpriority="high"
  attribution?: { text: string; href: string };
  layout?: 'inline' | 'masthead' | 'thumb';  // default 'inline'
};
```

Internal state machine (4 states):

| Condition | Render |
|---|---|
| `src === null` | `<FamilySilhouette family={family} layout={layout} />` at hero scale |
| `src !== null && !loaded && !errored` | flat skeleton rect at aspect-ratio for the layout (16/10 masthead, 1/1 thumb, 4/3 inline) |
| `src !== null && loaded` | `<img>` with attribution overlay (translucent scrim bottom-right) |
| `src !== null && errored` (`onError`) | same as `src === null` |

CSS aspect-ratio reserves the layout box before the image loads (per existing `styles.css:430–437` model — preserved verbatim, generalized).

**Priority for masthead use:** `<Photo priority={true}>` flips to `loading="eager" fetchpriority="high"`. The detail-surface masthead always passes `priority={true}` to avoid LCP penalty.

**G4 audit closed at 91.1% photo coverage** — `src === null` exercised on ~9% of detail opens. Hot path, not edge case. The silhouette fallback at hero scale must be designed and prototype-gated at the same fidelity as the photo path.

## `<FamilySilhouette>`

Synchronously renderable SVG silhouette tinted with family-channel `fill`. Used by `<Photo>` as no-photo fallback, by feed rows as thumbnails, by `<FamilyLegend>` as the swatch. Path data lives in the existing `family_silhouettes` DB table, exposed via `/api/silhouettes`.

```ts
type FamilySilhouetteProps = {
  family: FamilyCode | null;     // null → neutral grey rendering, generic bird shape
  layout?: 'inline' | 'masthead' | 'thumb';
  shape?: 'circle' | 'square' | 'pentagon' | 'diamond';  // a11y shape pairing per family
};
```

The `shape` prop pairs with the family color so the family encoding survives greyscale (WCAG 1.4.1). Mapping defined in `frontend/src/config/family-palette.ts`.

For the null-family path: `--color-bg-tint` background + a generic bird-silhouette path; no family-channel tint. This is the case for the ~2 species without `familyCode` observed in the G4 audit (e.g., `ixlbun`, `mallar4`).

## `<ClusterPill>`

Replaces solid filled cluster circles on the map. Apple-Maps idiom: white/dark fill + density-coded stroke + count text on the surface (not on the colored fill). Text contrast becomes arithmetic.

```ts
type ClusterPillProps = {
  count: number;     // tier computed internally
  onClick: () => void;
};
```

Tier thresholds (in `frontend/src/config/cluster.ts`):

```ts
export const CLUSTER_TIER_BOUNDARIES = { sand: 100, ember: 750 } as const;
export type ClusterTier = 'sky' | 'sand' | 'ember';
export function clusterTier(count: number): ClusterTier {
  if (count >= CLUSTER_TIER_BOUNDARIES.ember) return 'ember';
  if (count >= CLUSTER_TIER_BOUNDARIES.sand) return 'sand';
  return 'sky';
}
```

The MapLibre cluster layer config (`frontend/src/components/map/observation-layers.ts`) imports the same constants — single source of truth.

A11y:

```tsx
<div
  className={`cluster-pill cluster-pill--${tier}`}
  role="img"
  aria-label={`${count} sightings`}
  onClick={onClick}
>
  {count}
</div>
```

`role="img"` + `aria-label` collapses the pill to one SR announcement ("140 sightings"). Tier (color, padding/font-size step) is **decorative density encoding**; the count is canonical. WCAG 1.4.1 satisfied by the count text inside the pill, not by color.

## `<FilterSentence>`

Renders the active-filter narrative. Single template; collapses to `null` at zero filters; always-mounted hidden live region for SR announcements.

```ts
type FilterSentenceProps = {
  filters: ActiveFilters;  // existing typed shape from frontend/src/state/url-state.ts
};
```

Visible template: `"Showing {filter-terms-with-bullets} from the last {period}."`

- 0 filters → component returns `null`
- 1 filter → "notable sightings"
- 2+ filters → comma-joined ("notable sightings, woodpeckers")

Period clause is always present when the component renders (default 14 days; user-settable).

Live region (always mounted, separate DOM element):

```tsx
<div role="status" aria-live="polite" aria-atomic="true" aria-relevant="text" className="filter-sentence-live">
  {liveText}
</div>
```

Behavior (from `frontend/src/config/filter.ts`):

- `FILTER_SENTENCE_DEBOUNCE_MS = 500` — settled state debounce; rapid filter toggles produce one SR announcement after they stop.
- `FILTER_SENTENCE_CLEAR_HOLD_MS = 1500` — when filter content transitions from non-null to null, hold "All filters cleared." in the live region for 1500ms before silence.

Visual element collapses to `null` immediately on filter clear; the hidden live region holds the clear message separately. Two separate DOM elements with separate lifecycles.

**Sort prefix is NOT this component.** The feed-surface "Sorted by recency" prefix is a separate `<SortLabel>` sibling, owned by the feed surface. `<FilterSentence>` does not gain a `view` prop.

## Composition rules

- `<Photo>` and `<StatusBlock>` **do not compose**. They live at different levels: `<StatusBlock>` is page-level (zero results, fetch error, surface skeleton); `<Photo>` owns its own internal state machine for the photo's own loading/error states. The detail-surface modal contains `<h1>` + `<Photo>` + body — not `<StatusBlock>` wrapping `<Photo>`.

- `<FamilySilhouette>` is a sibling of `<Photo>` in the family-color encoding system. It's also the no-photo fallback rendered *inside* `<Photo>` when `src === null`.

- `<ClusterPill>` is rendered as React `<Marker>` overlays on MapLibre, not as MapLibre paint. The MapLibre cluster layer's circle styling is suppressed in favor of React-rendered pills.

- `<FilterSentence>` mounts at the bottom of the context strip on every surface that shows filters (map, feed, species). On the detail surface, filters don't apply (detail fetches for a specific species code regardless of filter state); `<FilterSentence>` is not mounted there.

## Phase that ships these

All five primitives ship in [Phase 2](../02-phases/phase-2-primitives.md). Phase 3 onwards consumes them.

## Cross-references

- Tokens consumed by these primitives: [`tokens.md`](./tokens.md)
- A11y contracts: [`accessibility.md`](./accessibility.md)
- Voice / copy register: [`voice-and-content.md`](./voice-and-content.md)
