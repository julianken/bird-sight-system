# Loop 2 Critic: System Cohesion Kinks

## Summary

With Loop 1's runtime-contract gaps imagined-applied (lede templates, four-state
freshness label, snap-point definitions, `priority` prop on `<Photo>`,
`REGION_LABEL` config), the system graduates from "undefined state" problems into
a new class: **structural incompatibilities** between primitives, token-system
collisions between the v3 mock and the live codebase, and an underspecified
family-channel mechanism that quietly controls a large portion of the visual
system. Five kinks follow, ordered by the cost-to-fix-at-implementation-time.

---

## Kinks identified

### Kink 1: Family-channel color-pairing mechanism has no defined implementation contract — it could be CSS-only, JS-computed, or DB-driven, and each path produces a different component API

**Where it lives:** Decisions table row "Family palette: Role-channel
(`--channel-family-fill` + auto-paired `--channel-family-on` for AA contrast)";
mock `sky-atlas-v3.html:979–1006` (legend rows use inline `style="color:#c47a3a"`,
`style="color:#3a4a2a"`, etc. — hard-coded per-family hex, NOT CSS custom
properties); `frontend/src/tokens.ts:133–158` (ecoregion palette is DB-synced
hard-codes, not a CSS custom property tree).

**The kink:** The decisions table names a `--channel-family-fill` /
`--channel-family-on` token pair, implying a CSS custom property that components
would reference as `var(--channel-family-fill)`. But there is no mechanism
defined for how this token gets its value — there are at least three
incompatible paths:

- **CSS-only (static):** one `--channel-family-fill` custom property per family
  code set on a parent element via `data-family="woodpeck"`. This means the
  family code must reach the DOM as an attribute, which requires every component
  that consumes family color (`<FamilyLegend>`, `<Photo>` silhouette tint,
  `<FeedCard>` silhouette color, map legend shape color) to accept a `family`
  prop and forward it to a DOM attribute. The component prop API contract is
  therefore: `family: string` everywhere family color appears.
- **JS-computed (lookup table):** a `getFamilyColor(familyCode: string)` utility
  returns `{ fill: string; on: string }` and callsites pass the pair as inline
  `style`. This is what the mock actually does (inline hex). Auto-pairing for AA
  contrast would live in the utility function.
- **DB-driven (per-family token from backend):** the read API response includes
  a `color` field on each family (analogous to `display_color` on regions in
  `tokens.ts:133`). The frontend maps it to an inline style. No CSS custom
  property is ever set.

The `--channel-family-on` "auto-pairing for AA contrast" language in the
decisions table is only achievable via the JS-computed path — CSS cannot
auto-compute a contrasting color from a dynamic fill without `color-contrast()`
(not yet widely supported). The mock uses the DB-driven path (hard-coded inline
hex). The decisions table implies the CSS custom property path. All three
conflict.

**Why it matters:** The component API surface changes completely depending on
which path is chosen. `<Photo>` needs either `family="woodpeck"` (CSS path),
`familyColor={{ fill, on }}` (JS-computed path), or nothing extra (DB path).
Whichever lands in implementation is right — but all three paths will be
attempted by different devs reading different parts of the spec, producing
incompatible components that fight at integration time.

**Severity:** High

---

### Kink 2: Cluster pill density-threshold is undefined — the mock uses 3 tiers (sky/sand/ember) with sample values that imply thresholds, but the thresholds are not stated anywhere and differ from v2

**Where it lives:** `sky-atlas-v3.html:970–976` — cluster counts rendered in
mock: 38 (sky), 140 (sand), 304 (sand), 755 (ember), 17 (sky), 171 (sand), 30
(sky). CSS at `:370–372` assigns class names `sky`, `sand`, `ember` with no
comment on the numeric boundary. No row in the decisions table names a threshold.

**The kink:** From the mock data, a reader can infer: sky ≤ 38 or ≤ 100 (unclear),
sand is somewhere around 100–750, ember is ≥ 755. But 140, 171, and 304 are all
sand — so the sand band spans at least 31 to ~750 if sky is ≤ 30, or 100 to 750
if sky is < 100. The v2 codebase used `point_count < 100` / `< 750` / `≥ 750`
(mentioned in the Loop 2 brief as prior art). Those thresholds are NOT carried
over to any v3 spec text.

Two concrete boundary collisions result:

- A cluster of 99 and a cluster of 100 look different (sky vs sand) but nothing
  in the spec says why or where that line is drawn.
- The sand pill's visual size is larger than sky (`padding: 6px 12px` vs `5px 10px`,
  `font-size: var(--type-base)` vs `var(--type-sm)`), and ember is larger still
  (`7px 14px`, `font-size: var(--type-md)`). These size steps are baked into the
  CSS class, so the visual size change is discrete and potentially jarring at the
  boundary — a cluster that grows from 99 to 100 snaps from one size to a larger
  one.

**Why it matters:** This is a prop API question for the `<ClusterPill>` component:
what prop drives the tier? If it's `count`, the component owns the threshold logic
internally. If it's `tier: 'sky' | 'sand' | 'ember'`, the threshold logic lives
in the MapLibre cluster configuration (which is JavaScript, not CSS). Either is
valid — but a component dev will invent one independently, and a MapLibre config
dev will invent the other, producing a split that requires a reconciliation PR.

**Severity:** High

---

### Kink 3: The v3 token namespace (`--bg-page`, `--text-strong`, `--accent`, etc.) collides with the live codebase token namespace (`--color-bg-page`, `--color-text-strong`, etc.) — migration path is undefined

**Where it lives:** Mock `sky-atlas-v3.html:26–94` — tokens are defined as
`--bg-page`, `--bg-surface`, `--text-strong`, `--accent`, `--border`, etc.
directly on `.sa3-light` / `.sa3-dark` class selectors. Live codebase
`frontend/src/styles.css:1–63` — the existing token namespace uses
`--color-bg-page`, `--color-bg-surface`, `--color-text-strong`, etc. with a
`--color-` prefix, all on `:root`. `frontend/src/tokens.ts` additionally
exports JavaScript constants (`color.palette.*`, `spacing.*`, `zIndex.*`) that
parallel the CSS custom properties.

**The kink:** Three naming systems coexist after redesign:

1. **v3 mock names** (no prefix: `--bg-page`, `--text-strong`, `--accent`).
2. **Live codebase names** (prefixed: `--color-bg-page`, `--color-text-strong`; no `--accent` exists today).
3. **tokens.ts export names** (`color.palette.coloradoPlateau`, `spacing.lg`, etc.) — no accent token exists here either.

The three-tier architecture in the decisions table (primitive → semantic →
component) requires a defined mapping between these, but none is written. The
mock's `--accent` token conflicts directly with the live codebase's
`--color-accent-notable-bg` / `--color-accent-notable-fg` pair — these are
NOT the same thing (live codebase uses "accent" for the amber notable-row
background; v3 mock uses `--accent` for the subtractive orange decision-point
color). If a dev copies the mock tokens naively, `--accent` overwrites the
existing notable-row semantic and the notable row loses its amber tinting
across the entire live codebase.

This is not a "rename later" problem — the two systems must be reconciled before
any v3 component touches the CSS layer, or the notable-row regression ships
silently.

**Severity:** High

---

### Kink 4: `<StatusBlock>` and `<Photo>` loading states are both proposed but their boundary is undefined — specifically, who owns the loading state when photo is the first element of the detail surface?

**Where it lives:** Decisions table row "Loading/empty/error: `<StatusBlock>`
primitive; flat skeletons + 2px sunrise progress bar"; row "Photo treatment:
`<Photo>` primitive with built-in `loading='lazy'` / `srcset` / attribution
overlay." Loop 1 Kink 1 open question: "Confirm whether `<StatusBlock>` replaces
or supplements the lede area at zero results." Loop 1 Fix 5 adds `priority={true}`
to the masthead `<Photo>`.

**The kink:** The detail surface layout is:

```
<DetailModal>
  <Photo priority={true} />       ← full-bleed, 320px tall
  <DetailBody>                    ← phenology, prose, etc.
```

Three undefined boundary questions:

1. **Photo-fetch pending:** when `<Photo priority={true}>` is mounted but the
   image hasn't loaded yet, what renders? The `<Photo>` primitive presumably
   shows a skeleton, but the decisions table says `<StatusBlock>` owns skeletons.
   If `<Photo>` has its own internal skeleton (a `--bg-skeleton` rectangle at
   320px × 100%), it is a miniature private `<StatusBlock>` with no shared
   contract. If `<StatusBlock>` wraps `<Photo>`, then `<StatusBlock>` must
   know the photo's expected height, which breaks its status-as-primitive.

2. **Photo 404 / missing photo (the open question in the decisions table):** the
   fallback is defined as "silhouette default at hero scale + family-color tint."
   But the silhouette tint color requires the family-channel mechanism (Kink 1
   above) to be resolved. If family-channel is DB-driven, the silhouette tint
   cannot render until the species data loads — which is a circular dependency
   (you need data to render the fallback that shows while data loads).

3. **Detail modal open-animation + photo fetch race:** Loop 1 Fix 5 addresses
   this for `fetchpriority="high"`, but the spec does not address what the user
   *sees* during the 200ms modal open if the photo hasn't arrived yet. Options:
   (a) show skeleton inside the photo area during animation, (b) delay the open
   animation until the photo is available (`onLoad` gate), (c) animate open
   without photo and let the photo pop in. Each produces a different perceived
   quality. None is specified.

**Why it matters:** Two primitives (`<StatusBlock>`, `<Photo>`) are proposed
without a composition contract. The prop API question is: does `<Photo>` accept
a `fallback` prop? A `loading` render prop? Does `<StatusBlock>` accept
`<Photo>` as a child? A dev will answer all three questions independently and
produce a component that's impossible to refactor without breaking both
primitives.

**Severity:** Medium

---

### Kink 5: The "empty state" for the filter sentence when zero filters are active — the sentence that reads "Showing notable sightings from the last 14 days" — is undefined for its null case, and the mock's filter sentence structure is inconsistent across the two surfaces shown

**Where it lives:** `sky-atlas-v3.html:966` (map surface): "Showing
`<span class='filter-bullet'>notable sightings</span>` from the last 14 days."
`:1223` (feed surface): "Sorted by recency · `<span class='filter-bullet'>Notable only</span>` filter active." Decisions table row "Filter-active indicator:
Badge + sentence."

**The kink:** Two structural inconsistencies compound:

1. **Sentence template diverges between map and feed.** Map uses "Showing [filter term] from the last [period]." Feed uses "Sorted by recency · [filter term] filter active." These are not the same sentence shape applied to different views — they're two different templates. The filter sentence component either needs a `view` prop to switch between templates (adding hidden surface-coupling to what should be a stateless display component) or each surface owns its own sentence string (in which case the "filter sentence component" is just a styled text container, not a meaningful primitive).

2. **Zero-filter state (all defaults active) is never mocked.** Loop 1 Fix 4 demoted the chip strip but the filter sentence's zero-filter form is still undefined. The sentence currently reads "Showing notable sightings..." — what does it say when no filters are active (no `notable`, default 14-day period, no family, no species)? Options: (a) hide the sentence entirely (the bar collapses), (b) show "Showing all sightings from the last 14 days" — a valid non-filter state that the lede repeats, creating redundancy, (c) show nothing in the `.filter-bullet` span (just "Showing  from the last 14 days" — broken sentence). None of these is specified and all three produce different layout behavior (the lede + filter sentence block changes height when the sentence appears/disappears, which could cause layout shift on filter-clear).

**Why it matters:** The filter sentence is the primary confirmation surface that filters are active (decisions table: "Badge + sentence"). If the sentence's zero-filter state is undefined, clearing all filters produces an undefined layout state. This is a content-model gap that touches lede height, badge visibility, and the chip strip's `display: none` rule — three separately-implemented components that must agree on what "zero filters" looks like.

**Severity:** Medium

---

### Kink 6 (borderline): The `SurfaceNav` component (`SurfaceNav.tsx`) has 3 tabs (Feed/Species/Map); the mobile bottom bar has 4 (Feed/Species/Map/Credits) — the redesign's desktop nav inherits 3 tabs but the mobile redesign adds a 4th with no stated rationale for the asymmetry

**Where it lives:** `frontend/src/components/SurfaceNav.tsx:22–26` — `TABS`
array has 3 entries: `feed`, `species`, `map`. Mock `sky-atlas-v3.html:1339–1352`
— mobile bottom bar has 4 tabs: Feed / Species / Map / Credits. Loop 1 considered-
not-flagged: "Mobile bottom-tab 'Credits' tab is questionable IA."

**The kink:** Loop 1 noted this but deferred it as "not strategic." From a
component-API perspective it's a cohesion issue: the `SurfaceNav` component as
implemented does not support a `credits` view — `View` type in `url-state.ts`
would need to be extended. More importantly, Credits on mobile has no desktop
equivalent in the mocks (the desktop header has a theme-toggle icon button but
no Credits tab). The attribution surface on desktop is the existing
`<AttributionModal>` triggered from `<footer role="contentinfo">` — but that
footer is not shown in any v3 desktop mock (it may be below the fold or
deliberately omitted). If the redesign removes the footer from visible desktop
chrome, the attribution compliance requirement (eBird ToU §3, CC BY attribution,
ODbL §4.3) documented in `AttributionModal.tsx:1–38` loses its "prominent enough
to be reachable from every surface" guarantee.

**Why it matters:** This is not merely IA — it's a compliance gap. The
`AttributionModal.tsx` comment is explicit: "The trigger lives in App.tsx's
persistent `<footer role='contentinfo'>` so the prominence requirement is met on
every view." If the v3 redesign drops the footer from desktop chrome, a new
prominence mechanism must be designed. The Credits tab on mobile IS that
mechanism for mobile — but desktop has no equivalent.

**Severity:** Medium (compliance-adjacent)

---

## Issues considered but NOT flagged

- **Mobile landscape / 320px width / virtual keyboard.** The bottom tab bar +
  fixed top header pattern does break meaningfully in landscape on small phones
  (content area collapses to ~200px). Real, but the decisions table already
  defers to "390×844 mobile, 1440×900 desktop" as the two exit-criteria
  viewports; landscape is not a release-1 target. Flagging it would be
  re-litigating scope.

- **The `v3-lede` font-size is 26px — outside the 6-step type ramp (11/13/15/17/22/34).** The decisions table specifies a 6-step ramp; the lede sits between `--type-lg` (22px) and `--type-hero` (34px). This could be a seventh scale step or an intentional off-ramp. Minor editorial inconsistency, not a cohesion issue — a spec note resolves it.

- **Token `--font` defined in both `.sa3-light` and `.sa3-dark` with identical
  values — can be hoisted to a base selector.** Implementation-style choice, not
  a cohesion issue. The redundancy is harmless and can be fixed in the same PR
  that converts mock tokens to production tokens.

- **`v3-popover-silhouette` uses `fill: currentColor` and `color: var(--accent)` — this means the cluster popover silhouette is accent-colored.** Loop 1 Kink 2 / Fix 2 addressed accent usage at the popover CTA, but the silhouette color at line 444–448 is also `var(--accent)`. It's an additional accent site Loop 1's revised rule didn't enumerate. Borderline — small enough that the revised 8-site enumeration could add a 9th entry without changing the rule's intent. Not flagging as a new kink since it's a 1-line amendment to Fix 2.
