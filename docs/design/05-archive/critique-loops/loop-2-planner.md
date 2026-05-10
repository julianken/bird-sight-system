# Loop 2 Planner: Cohesion Fixes

## Summary

Loop 2's kinks are about **boundaries**: where one primitive's contract ends and
another's begins, and where the v3 mock's improvised vocabulary collides with the
live codebase's enforced one. The fixes below name the mechanism (Kink 1, 2),
the namespace (Kink 3), the composition contract (Kink 4), the null-state shape
(Kink 5), and the prominence equivalent (Kink 6). Two of the fixes refine Loop
1's work — specifically Loop 1's Fix 5 (`<Photo>` `priority` prop) needs an
explicit `fallback` slot, and Loop 1's Fix 1 (lede templates) needs to absorb
the filter-sentence template so the two surfaces share a single content-model.

---

## Fixes

### Fix for Kink 1: Family-channel mechanism

**The fix:** Lock the **JS-computed lookup-table** path. Every other path
either fails AA-pairing in CSS, or creates a circular dependency at hero
fallback (Kink 4 sub-question 2).

Concrete contract:

- New file `frontend/src/config/family-palette.ts` exports:
  ```ts
  export type FamilyCode = 'woodpeck' | 'corv' | 'parul' | /* … */;
  export type FamilyChannel = { fill: string; on: string };
  export const FAMILY_PALETTE: Record<FamilyCode, FamilyChannel>;
  export function getFamilyChannel(code: FamilyCode | undefined): FamilyChannel;
  ```
  The `on` value is hand-paired against `fill` for ≥4.5:1 AA contrast and
  asserted in a unit test (`family-palette.test.ts`) using a `wcag-contrast`
  helper. No `color-contrast()` CSS, no DB column.

- The `family` field already exists on `species`; the API returns
  `species.family_code`. No schema change.

- Consumer prop API is uniform: every component that paints with family color
  accepts `family: FamilyCode` and calls `getFamilyChannel(family)` once at the
  top of render, applying `{ background: ch.fill, color: ch.on }` via inline
  `style`. This affects `<FamilyLegend>`, `<Photo fallback>` (silhouette tint),
  `<FeedCard>` (silhouette glyph), and the map legend swatch.

- The decisions-table token names `--channel-family-fill` /
  `--channel-family-on` are **retired** in favor of the JS-computed contract.
  Replace the row with: "Family palette: JS-computed channel via
  `getFamilyChannel(familyCode)` returning `{ fill, on }` (AA-paired);
  components consume via inline `style`, not CSS custom properties."

**Why this works:** Removes the three-path ambiguity by picking the only path
that satisfies all named requirements (AA pairing, hero-fallback availability,
no DB churn). Inline `style` for ≤30 family entries on screen at once is a
non-issue.

**Cost:** Small — one new file, one test, one decisions-table edit.

**Refines Loop 1:** None. Loop 1 didn't address family-channel.

---

### Fix for Kink 2: Cluster pill density thresholds

**The fix:** Lock the v2 thresholds (`<100` / `100–749` / `≥750`) and put them
in `frontend/src/config/cluster.ts` as named constants. The `<ClusterPill>`
component takes `count: number` (not `tier`) and computes the tier internally.

Concrete contract:

```ts
// frontend/src/config/cluster.ts
export const CLUSTER_TIER_BOUNDARIES = { sand: 100, ember: 750 } as const;
export type ClusterTier = 'sky' | 'sand' | 'ember';
export function clusterTier(count: number): ClusterTier {
  if (count >= CLUSTER_TIER_BOUNDARIES.ember) return 'ember';
  if (count >= CLUSTER_TIER_BOUNDARIES.sand) return 'sand';
  return 'sky';
}
```

The MapLibre cluster-rendering code (existing layer config) imports the same
constants for any size-driven cluster styling on the map — so MapLibre and the
React component cannot disagree.

**Boundary smoothing:** the discrete size jump at `count === 100` and
`count === 750` is acceptable; this matches v2 behavior, and clusters near
those boundaries are statistically rare (the cluster-count histogram is heavy
in the low tail). No interpolation; keep the discrete CSS classes.

Add row to decisions table: "Cluster pill: prop is `count`, not `tier`;
threshold constants live in `frontend/src/config/cluster.ts` (sand ≥100,
ember ≥750); MapLibre cluster layer imports the same constants."

**Why this works:** Names the prop, the file, and the numbers. Two
implementations cannot diverge because they both import the same source.

**Cost:** Tiny — one file, three constants, one component prop signature.

**Refines Loop 1:** None.

---

### Fix for Kink 3: Token namespace collision

**The fix:** Make the live codebase namespace authoritative. The v3 mock's
unprefixed names (`--bg-page`, `--accent`) are **mock-only** and must be
translated to the `--color-*` prefix before any v3 component touches the CSS
layer. Add the missing tokens; do not rename existing ones.

Concrete contract — three sub-fixes:

**(a) Translation table** in `docs/specs/2026-05-09-v3-token-mapping.md`:

| v3 mock name | Production name | Notes |
|---|---|---|
| `--bg-page` | `--color-bg-page` | exists |
| `--bg-surface` | `--color-bg-surface` | exists |
| `--bg-skeleton` | `--color-bg-skeleton` | **new**; value `var(--color-bg-tint)` |
| `--text-strong` | `--color-text-strong` | exists |
| `--text-body` | `--color-text-body` | exists |
| `--text-subtle` | `--color-text-subtle` | exists |
| `--border` | `--color-border-ui` | exists |
| `--accent` | `--color-decision-point` | **new** — DO NOT collide with notable |
| `--notable` | `--color-accent-notable-fg` | exists; do not alias |
| `--font` | (drop) | hoisted to `body { font-family }` already |
| `--density-sky` / `--density-sand` / `--density-ember` | same names, kept | new cluster tokens, no prefix collision |

**(b) Naming rule, written into the decisions table:** "All v3 design tokens
that map to a semantic role use the `--color-*` prefix (continuing the live
codebase convention). The v3 mock's `--accent` is renamed `--color-decision-
point` in production to prevent collision with `--color-accent-notable-fg`.
The token names `--notable` and `--accent` are **forbidden in production CSS**
— use the `--color-*` form."

**(c) Lint guard:** add a `stylelint` rule (or a one-line grep in the existing
lint workflow) that fails CI on `var(--accent)` or `var(--notable)` outside
the mock HTML directory. Specifically: `grep -rE 'var\(--(accent|notable|bg-|text-|border)[^-]' frontend/src/` should return zero.

**Why this works:** Closes the silent-regression vector (notable amber gets
overwritten) by making the collision impossible to introduce. The translation
table is the dev's reference when porting mock CSS to production.

**Cost:** Small — one spec doc, three new tokens (`--color-bg-skeleton`,
`--color-decision-point`, the three `--density-*`), one lint rule.

**Refines Loop 1:** Loop 1 Fix 2 enumerates accent sites using the name
`--accent`. Update those references to `--color-decision-point`. The
substantive rule is unchanged.

---

### Fix for Kink 4: `<StatusBlock>` × `<Photo>` boundary

**The fix:** `<Photo>` owns its own internal three-state machine (loading /
loaded / error). `<StatusBlock>` is for **page-level** status (zero results,
fetch error, surface skeleton) and never wraps `<Photo>`. The two primitives
do not compose; they live at different levels of the tree.

Concrete contract:

**(a) `<Photo>` internal state machine** — extend Loop 1 Fix 5's prop API:

```tsx
type PhotoProps = {
  src: string | null;            // null = no photo for this species
  alt: string;
  priority?: boolean;            // Loop 1 Fix 5
  family: FamilyCode;            // Kink 1 — always required
  attribution?: { text: string; href: string };
};
// Internal states:
// 1. src === null  → render <FamilySilhouette family={family} /> at hero scale
// 2. src !== null, !loaded, !errored → skeleton rect (--color-bg-skeleton)
// 3. src !== null, loaded → <img>
// 4. src !== null, errored (onError) → render same fallback as state 1
```

The skeleton rect has a fixed aspect ratio matching the photo container
(`aspect-ratio: 16/10` for masthead, `1/1` for thumb), so layout doesn't
shift on load. The skeleton is **internal** to `<Photo>`, not a `<StatusBlock>`.

**(b) `<FamilySilhouette>` is a sibling primitive** at
`frontend/src/components/FamilySilhouette.tsx`. It takes `family: FamilyCode`,
calls `getFamilyChannel(family)` (Kink 1 fix), and renders an SVG silhouette
tinted with the family-channel `fill`. It is **synchronously renderable** —
no data fetch — which resolves the circular-dependency concern (the species
data is already in scope by the time `<Photo>` mounts; family code is a field
on that data).

**(c) Modal open animation:** the modal opens with a 200ms `opacity` transition
(per Loop 1 Fix 5). The `<Photo>` inside is mounted at `opacity: 0` of the
modal, but its state machine starts immediately — so by the time the modal
finishes opening, either the photo is loaded (state 3) or the skeleton is
visible (state 2). Option (a) from Kink 4 sub-question 3 is locked in; do not
gate the modal animation on photo load.

**(d) `<StatusBlock>` scope, written into decisions table:** "`<StatusBlock>`
is a page-level primitive; renders zero-result, fetch-error, and surface-
skeleton states. It is never composed with `<Photo>`. `<Photo>` owns its
internal loading/error state machine. The masthead photo's missing/loading
states are `<Photo>`'s responsibility, not `<StatusBlock>`'s."

**Why this works:** Two primitives, two concerns, no overlap. The composition
question dissolves because there is no composition. Family-color circular
dependency dissolves because `family` arrives synchronously on the species
record.

**Cost:** Medium — `<Photo>` gains state-machine code; `<FamilySilhouette>`
is new but small (~40 lines including the SVG paths registry).

**Refines Loop 1:** Loop 1 Fix 5 added `priority` to `<Photo>`. This fix
extends that prop sig with `family: FamilyCode` and `src: string | null`
(making `src` nullable rather than required), and adds an internal state
machine. The `priority` semantics are unchanged.

---

### Fix for Kink 5: Filter-sentence null state and template unification

**The fix:** Unify the map and feed filter sentences into a single
`<FilterSentence>` primitive with one template, plus a defined zero-state
that **collapses the element** (does not occupy layout). The "Sorted by
recency · …" prefix on feed becomes a separate sibling element owned by
the feed surface, not part of the filter sentence.

Concrete contract:

**(a) Single template:** "Showing {filter-term-with-bullets} from the last
{period}." rendered by a single `<FilterSentence>` component. The component
takes `filters: ActiveFilters` (already a typed shape in
`frontend/src/state/url-state.ts`) and computes the term-string and period.

**(b) Term composition rules:**
- 0 active filters → component returns `null` (the element is unmounted; the
  surrounding container has `min-height: 0` so no layout reservation).
- 1 active filter (e.g. `notable=true`) → "notable sightings" (one bullet).
- ≥2 active filters → "notable sightings, woodpeckers" (comma-joined bullets).

**(c) Period is always present** when the component renders, because period
defaults to 14 days but is a deliberate user choice (settable in the filter
panel). The period clause never disappears — only the filter-term clause
varies.

**(d) Layout-shift guard:** the filter sentence sits below the lede in a
container with `min-height: 0` and `transition: none`. When it appears /
disappears at filter clear, the lede block height changes by exactly one
line-height (~24px). This is acceptable (and matches the badge visibility
toggle from Loop 1 Fix 4). No shimmer, no animation — abrupt show/hide
matches the other filter-active surfaces.

**(e) Feed-surface "Sorted by recency" prefix** is a separate
`<SortLabel>` element above `<FilterSentence>` on the feed view. It is not
controlled by filters; it is controlled by the (currently single-option)
sort. This decouples the two narrative claims so the filter sentence
template doesn't need a `view` prop.

Add to decisions table: "Filter sentence: single `<FilterSentence>`
component; renders `null` at zero filters; period always present when
rendered. Feed-surface sort prefix is a separate `<SortLabel>` sibling."

**Why this works:** One template, one component, no `view` prop, no broken-
sentence null state. The collapse-to-`null` resolution matches Loop 1 Fix
4's mobile-strip approach (hide entirely at zero); the system gains a
consistent "zero filters → no narrative element" rule.

**Cost:** Small — one component, one decisions-table row, minor copy edit on
the feed view.

**Refines Loop 1:** Loop 1 Fix 1 defined four lede templates. The
filter-sentence null-state rule here means template 4 (default) no longer
needs to repeat filter info — the lede stays at "{N} species seen across
Arizona in the last {period}." regardless of filter state, and
`<FilterSentence>` carries the filter-active narrative. Update Loop 1 Fix 1's
template 1 (zero results) to also unmount `<FilterSentence>` — it's
semantically zero-filter from the *result* side even if filters are set.
This is a copy-coordination note, not a contradiction.

---

### Fix for Kink 6: Mobile Credits tab vs desktop attribution prominence

**The fix:** Add an attribution-trigger affordance to the desktop top
chrome — an "Attribution" link in the desktop header's right cluster (next
to the theme toggle), visible on every desktop view. Drop the mobile
"Credits" tab from the bottom bar; replace it with the same "Attribution"
link in the mobile top header (next to the wordmark). The footer can be
removed from desktop chrome (the mock implies this) without losing the
prominence guarantee, because the header link is now present on every view.

Concrete contract:

**(a) Header right-cluster** (both desktop and mobile): `[Attribution]
[ThemeToggle]`. "Attribution" is a `<button>` that opens the existing
`<AttributionModal>` (no API change).

**(b) `SurfaceNav` stays at 3 tabs** (Feed / Species / Map) on both desktop
and mobile. The `View` type in `url-state.ts` does **not** gain a `credits`
member. No URL state for attribution; it's a modal, opened via a button,
not a route.

**(c) Compliance: update the comment in `AttributionModal.tsx:1–38`** to
read "The trigger lives in the persistent app header (visible on every
view, desktop and mobile) so the prominence requirement is met." Remove
the reference to `<footer role='contentinfo'>` if the footer is dropped.

**(d) The footer's removal is a separate decision** the redesign should
make explicitly, not by silent omission. Add row to decisions table:
"Desktop footer: removed from v3 chrome. Attribution prominence is met
by a persistent header button (`<header>` right-cluster on every view).
`AttributionModal` trigger location moves from footer to header."

**Why this works:** Restores the cross-viewport symmetry, satisfies the
compliance comment without inventing a `credits` route, and makes the
footer removal an explicit decision rather than an inference from mock
omission.

**Cost:** Small — one new button in the header, one comment update,
one decisions-table row, one mock revision (drop the 4th mobile tab; add
header button on both viewports).

**Refines Loop 1:** None. Loop 1 deferred this as not strategic.

---

## Cross-cutting recommendation

Three of the six fixes (Kink 1, 2, 5) introduce a `frontend/src/config/`
file alongside the `region.ts` / `freshness-threshold.ts` files Loop 1's
cross-cutting recommendation already established. The pattern is now
explicit: **runtime parameters, taxonomies, and lookup tables that drive
visual or behavioral branching live in `frontend/src/config/`, never in
component bodies and never in CSS custom properties when AA pairing or
threshold logic is involved.** This module becomes the auditable home for
"where does the system get its truths from" — and the lint guard from Kink
3 (forbidding `var(--accent)` / `var(--notable)`) is the structural enforcement
that prevents new components from re-improvising the same answers.

The token-system clash (Kink 3) is the only fix that mutates the existing
codebase rather than adding to it; the others are additive. Schedule Kink 3
first in implementation order, before any v3 component work begins, so the
lint guard is in place to catch namespace regressions on the Loop-2-derived
component PRs.
