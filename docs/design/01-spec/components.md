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

**Photo `srcset` — DEFERRED-INTENTIONAL (v1):** The brainstorm design-system agent (agent-2 idea 6, `agent-2-design-system-architect.md:51`) specified `srcset` as a mandatory property baked into `<Photo>` so it "cannot be forgotten." The v1 `<Photo>` primitive shipped without a `srcset` prop. Decision: `DEFERRED-INTENTIONAL` — the eBird / iNat photo API returns a single URL at the photo's canonical resolution; there is no multi-resolution endpoint available at v1. When a CDN image-resize pipeline is added (v1.1+), introduce `srcset: string | undefined` to the prop type and set `sizes` based on `layout`. Do not add a dead `srcset` prop pointing at the same URL — that is false affordance. File a follow-up issue when the CDN pipeline is in scope.

**Attribution scrim token — CAPTURED (W5):** The `attribution` prop renders a translucent scrim over the bottom-right of the photo. The scrim background color is `rgba(0,0,0,0.55)` — sourced from agent-2 idea 6 token shape (`--photo-attribution-bg: rgba(0,0,0,0.55)`) and confirmed in `sky-atlas-v3.html:551-556` (`.v3-detail-photo-credit`). Implementation must use this value or reference a semantic token `--color-photo-attribution-scrim: rgba(0,0,0,0.55)`. A free implementation choice is not acceptable — the 0.55 opacity was chosen to clear 4.5:1 for white text on the range of photo content tested in the brainstorm.

**Masthead overlay visual contract — CAPTURED (W5):** The `layout='masthead'` variant (used on the detail surface) renders species name and sci-name over a darkening gradient on the photo bottom half. The contracted visual treatment, from `sky-atlas-v3.html:499-501`, is:

```css
background:
  linear-gradient(180deg, transparent 0%, transparent 50%, rgba(0,0,0,0.7) 100%),
  <photo-image>;
```

Species name text: `color: white`, `font-weight: 800`, `font-size: var(--type-hero)` (34px), `letter-spacing: -0.8px`, `line-height: 1`. Sci-name text: `color: rgba(255,255,255,0.85)`, `font-style: italic`, `font-size: var(--type-base)`. Photo credit (attribution): `font-size: var(--type-xs)`, `text-transform: uppercase`, `letter-spacing: 1.5px`, `color: rgba(255,255,255,0.85)`, position `bottom: 14px; right: 14px`.

Dark-mode masthead gradient deepens to `rgba(0,0,0,0.85)` at 100% (see `sky-atlas-v3.html:508-512`).

This overlay contract was previously `MODIFIED — UNSTATED` in `coverage-matrix-v4.md` (row 96); the `layout: 'masthead'` prop existed but without this visual definition, leaving the implementation as free-fill. The contract above is now **inescapable** — any Phase 4 implementation that deviates must update this file first.

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

**Cluster-pill `::before` dot prefix — DEFERRED-INTENTIONAL (v1.1), follow-up filed:** Both v3 and v4 mocks show a small colored dot inside the pill preceding the count (`sky-atlas-v3.html:373-381` — the v3 cluster idiom; adopted in v4 visually). The v1 `<ClusterPill>` API (`count` + `onClick`) has no `::before` dot. Decision: the dot is a visual density-encoding reinforcement — it repeats information already conveyed by the pill's border color and size tier. Dropping it simplifies the component and removes a compositing layer on the map canvas, where many cluster pills render simultaneously. This drop was `DROPPED — UNSTATED` in `coverage-matrix-v4.md` (row 92); it is now `DEFERRED-INTENTIONAL — DOCUMENTED`. If adopted in v1.1: the dot color should be `currentColor` (matches the density-stroke color via `color` property inheritance), size `6px` circle, positioned with `display: flex; align-items: center; gap: 4px` (the v4 pill already uses this flex layout at `sky-atlas-v4.html:271-273`). Follow-up: [#475](https://github.com/julianken/bird-sight-system/issues/475) — file this issue after this PR merges if the dot behavior is wanted for v1.1.

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
