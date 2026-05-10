# Loop 3 Critic: Accessibility & Pre-Spec Sanity Kinks

## Summary

Loops 1 and 2 settled the structural and cohesion seams. The remaining surface
is **accessibility narrative** — what assistive-tech users actually experience
across the new surfaces. The current decisions tree carries good baseline a11y
(landmark order, tablist, native `<dialog>`, axe matrix at WCAG 2.1 A/AA per
`frontend/e2e/axe.spec.ts`), but the new primitives the redesign introduces
(`<FilterSentence>`, photo-anchor masthead, non-modal bottom-sheet, density
pills, four-state freshness label, family-channel inline-styled silhouettes)
each ship a behavior that is either silent to screen readers, racey under
focus management, or color-only at the boundary of WCAG 1.4.1. Six kinks
follow, ordered by remediation cost at implementation time. Two are
load-bearing for legal compliance (1.4.1 color-only; 2.4.3 focus order on
detail), the rest are specification gaps that will produce inconsistent
component behavior unless the spec names the contract.

---

## Kinks identified

### Kink 1: Detail surface focus order puts the close button BEFORE the page heading — SR users hear "Close, button" before they know what they opened

**Where it lives:** `sky-atlas-v3.html:1090` and `:1142` —
`<button class="v3-detail-close">×</button>` is a sibling positioned
`absolute top: 14px right: 14px` rendered as the **first child** of
`.v3-detail-photo`, which is itself the first child of `.v3-detail`. The
species name (`<div class="v3-detail-name">Gila Woodpecker</div>`) is a
visually-larger overlay but DOM-later (`:1093`, `:1145`). Decisions table:
"Photo treatment: full-bleed anchor on detail surface." Loop 2 Fix 4
specified `<Photo>` owns its loading state machine but did not specify
focus order on modal open.

**The kink:** When `<dialog>.showModal()` runs and focus delegates to the
first focusable element, that first focusable is the close button. SR
users hear "Close, button" with no context for *what* was just opened.
WCAG 2.4.3 (Focus Order) and WCAG 2.4.6 (Headings and Labels) both want
the user oriented before given an exit. The existing
`AttributionModal.tsx:215` queues a microtask to focus the close button
deliberately — but it does so AFTER the dialog has an
`aria-labelledby="attribution-modal-title"` pointer, so the SR
announcement is "Attribution, dialog. Close, button." The v3 detail
modal has no equivalent labelled-by yet — the species name is presentation
markup (`<div>`), not a heading, so no `aria-labelledby` target exists.
Worse: `.v3-detail-name` is a `<div>` at 36px, not an `<h1>`, so it never
appears in the SR heading list either.

Two distinct fixes are required, both unspecified:
1. `.v3-detail-name` must be an `<h1 id="detail-title">` (or `<h2>`
   depending on outer landmark structure), and the dialog must carry
   `aria-labelledby="detail-title"`.
2. Initial focus on dialog open should target the dialog itself (or the
   `<h1>` made focusable with `tabindex="-1"`), NOT the close button.
   The close button is reachable on the next tab; it is not the
   orientation point.

**Why it matters:** WCAG 4.1.2 (Name/Role/Value) is brittle here — without
`aria-labelledby`, the dialog is announced as "dialog" alone. The
existing axe scan (`axe.spec.ts:87–102`) only validates the no-photo
silhouette path; the photo branch was added at `:115` but does not
verify dialog labelling. A redesign PR could land a no-heading photo
masthead and ship green axe with a real WCAG regression.

**Severity:** High

---

### Kink 2: `<FilterSentence>` SR announcement strategy is undefined — every keystroke in the filter panel will spam an `aria-live="polite"` region with stale strings

**Where it lives:** Loop 2 Fix 5 introduced `<FilterSentence>` with template
"Showing {filter-term-with-bullets} from the last {period}." and a
collapse-to-`null` zero-state. Decisions table absorbs it. Original a11y
inventory Finding 7 explicitly flagged: "filter changes do NOT announce
result counts or 'filter applied' — there is no live-region feedback when
a user selects '30 days' or 'Notable only' beyond the row count silently
changing."

**The kink:** Two undefined behaviors compound:

1. **Live-region attachment.** The decisions table does not say whether
   `<FilterSentence>` carries `role="status"` / `aria-live="polite"`. If
   it does, every filter mutation re-renders the sentence and SR users
   hear "Showing notable sightings, woodpeckers from the last 14 days"
   on each keystroke in a multi-select panel — an announcement storm
   that drowns the actual filter UI. If it doesn't, the filter sentence
   is silent and Finding 7's gap remains open.

2. **Debounce + settled-state contract.** A filter panel with
   `since`/`notable`/`familyCode`/`speciesCode` lets a user toggle 4
   filters in ~2 seconds. The sentence should announce on the *settled*
   state, not on every intermediate one. The standard pattern is a
   wrapper `<div role="status" aria-live="polite" aria-atomic="true">`
   that holds the sentence, with React content updates debounced
   (~500ms) before the live-region content actually changes. None of
   that mechanism is specified.

   Compounding: when the sentence collapses to `null` at zero filters
   (Loop 2 Fix 5 (b)), an `aria-live` region whose contents become
   empty does not announce a "filters cleared" message — it silently
   goes blank. The announce-on-clear case needs an explicit string
   (e.g. "All filters cleared") that the live region can hold for one
   tick before the element unmounts.

**Why it matters:** Position B's voice argument ("opinionated utility =
honest claims") promises SR users get the same narrative sighted users
get. Without a debounce + settled-state + clear-message contract, SR
users get either nothing (gap) or a noisy stream that's worse than
nothing (regression). The existing axe matrix doesn't catch live-region
spam — it's a behavioral, not structural, defect.

**Severity:** High

---

### Kink 3: Cluster pills convey count tier through color only — the dot prefix is the same shape across all three tiers (a 6×6 round dot), so non-color discrimination depends on font-size differences <2px

**Where it lives:** `sky-atlas-v3.html:373–381` —
`.v3-cluster::before` is a 6×6 round dot whose only differentiator is
`background: var(--density-sky|sand|ember)`. Class-driven size escalation
(`:370–372`) bumps padding from `5px 10px` (sky) → `6px 12px` (sand) →
`7px 14px` (ember) and font-size from `--type-sm` (13px) → `--type-base`
(15px) → `--type-md` (17px). Loop 2 Fix 2 locked count thresholds.

**The kink:** WCAG 1.4.1 (Use of Color) prohibits color as the *sole*
visual means of conveying information. The mock differentiates tiers by
(a) color of the prefix dot, (b) color of the border, (c) padding scale,
(d) font scale. (a) and (b) are color-only; (c) is 2px between tiers
(below the noticeable-difference threshold for non-adjacent pills); (d)
is 2–4px between tiers (visible adjacent, ambiguous in isolation). The
density triad colors (`#6ec5d9` / `#e8c060` / `#e87a4a`) are not
distinguishable to deuteranopic / protanopic users (the sand/ember pair
collapses) and the prefix dot is the only carrier — there is no shape
change, no glyph differentiation, no numeric label *of the tier*.

Concrete defect: a colorblind user looking at "140" (sand) vs "755"
(ember) sees two pills with similar-looking border/dot colors, slightly
different sizes, and different counts. The tier is meant to communicate
"density category" beyond just the count — but if the count is already
shown, the tier is redundant for sighted-non-colorblind users and
inaccessible for colorblind users. The pill is doing zero accessible
work via color.

**Why it matters:** Either the tier needs a non-color discriminator
(small glyph, e.g. 1/2/3 dots in the prefix; or shape variation —
circle/square/pentagon mirroring the family legend's already-paired
shape system) OR the tier needs to be acknowledged as **decorative
density encoding** with the count being the canonical information,
which is fine but should be specified. Currently the spec implies the
tier is meaningful but provides no accessible read of it.

**Severity:** High (WCAG 1.4.1 compliance)

---

### Kink 4: Mobile bottom-sheet's `aria-modal="false"` (Loop 1 Fix 3) creates an unresolved landmark question — what *role* does the underlying map have while the sheet is at peek/half?

**Where it lives:** Loop 1 Fix 3 specified `<div role="dialog"
aria-modal="false">` for the bottom sheet, with map remaining
interactive at peek/half snaps and `inert` applied to map only at full.
Decisions table absorbs this. Existing app landmark order
(`App.tsx:155–257`): `region` → `tablist` → `<main>` → `contentinfo`.

**The kink:** A non-modal `role="dialog"` is an unusual ARIA pattern.
The ARIA Authoring Practices document non-modal dialogs but most SR
implementations treat `aria-modal="false"` dialogs inconsistently —
NVDA reads them as dialogs but doesn't trap virtual cursor; VoiceOver
on iOS treats them as a region with focus-able contents. Three undefined
behaviors:

1. **Landmark reachability rotor.** When the sheet is at peek with
   `aria-modal="false"`, both the map (`<main>`) and the sheet are
   simultaneously in the SR landmark rotor. A VoiceOver user
   navigating by landmark hears "main" then "dialog" — but the sheet
   is currently displaying species detail, not a dialog of choices.
   Should it be `role="region" aria-label="Selected sighting"` until
   it reaches full snap, then become `role="dialog"`? This is a
   role-change-on-state question the spec doesn't answer.

2. **Tab order across the partial occlusion.** At peek (96px tall), the
   sheet contains the handle + photo thumb + 1 stat line. The map
   below is fully interactive. If a keyboard user tabs from the
   filter strip, do they enter the sheet first (DOM order) or the
   map first (visual top-to-bottom)? Loop 1 Fix 3(c) said "focus
   stays on map" when sheet opens at peek — but if a user then tabs
   forward, the next tab-stop is undefined. The mock has no
   demonstrated tab order.

3. **ESC handling under non-modal.** ESC on a true `<dialog>` closes
   automatically. ESC on a `role="dialog" aria-modal="false"` div has
   no native handler — Loop 1 Fix 3(a) said "ESC handler implemented
   independently." But under non-modal ARIA, ESC could legitimately
   mean "dismiss sheet" OR "exit current focus context" — and if the
   user's focus is on a map cluster (not the sheet), ESC pressing
   probably shouldn't close the sheet. The handler scope is undefined.

**Why it matters:** Apple Maps achieves this via native API; on web,
the closest analogue is the `popover` attribute (Baseline 2024) with
`popover="manual"` — which gives the right "non-modal but dismissible"
semantics. The spec should either reference the native `popover` API
explicitly or document the exact ARIA + keyboard behavior the
custom div will simulate. Currently it does neither.

**Severity:** Medium

---

### Kink 5: Reduced-motion compliance is unspecified for every motion the redesign introduces — the codebase has zero existing motion (Finding 6), so the redesign is the entire surface

**Where it lives:** Original a11y inventory Finding 6: "zero
`prefers-reduced-motion` queries, because zero CSS motion exists."
Decisions table is silent on motion. Mocks introduce: bottom-sheet
snap transitions (Loop 1 Fix 3 (b) — drag triggers snap, no duration
specified); modal opacity transition (Loop 1 Fix 5 — 200ms); cluster
pill hover (`:130 transition: transform 0.15s, box-shadow 0.15s`);
focus halo appearance (`:702–704 outline` — instant in mock but a
focus-visible halo is often animated); 2px sunrise progress bar
(`:639–646` mocked static but implies linear-progress motion).

**The kink:** Each new motion needs an explicit reduced-motion
fallback. None is specified. WCAG 2.3.3 (Animation from Interactions,
AAA) and the broader vestibular-disorder considerations push for:
- Sheet snap: under reduced-motion, no transition — the sheet jumps
  directly to the target snap.
- Modal opacity 200ms: under reduced-motion, no transition (or
  ≤100ms — the spec is "either remove or shorten"; the design system
  should pick one rule).
- Pill hover transform: under reduced-motion, no transform; only
  the box-shadow change (or no change at all).
- Progress bar: under reduced-motion, the 2px bar should NOT
  pulse/animate; it should appear instantly at its current
  percentage.
- Photo loading state machine (Loop 2 Fix 4 (a)): the skeleton →
  loaded transition has no specified motion in either path; if it
  fades or wipes, reduced-motion needs the alternative.

**Why it matters:** The codebase's `tokens.ts` already defines
`duration.fast/base/slow` (200/250/350ms) and `--dur-*` custom
properties (Finding 6) — they exist exactly so the redesign can
consume them. The redesign should commit to a one-line global rule
(`@media (prefers-reduced-motion: reduce) { *, *::before, *::after
{ transition-duration: 0ms !important; animation-duration: 0ms
!important; } }`) plus per-motion explicit overrides where total
removal isn't right (e.g. sheet snap shouldn't be `0ms` — it should
be `jumpTo`-style instant positional change with no transition at
all). MapLibre `easeTo` calls (`MapCanvas.tsx:729–732`, Finding 6)
also need `respectPrefersReducedMotion` on every camera animation.

**Severity:** Medium

---

### Kink 6: NOTABLE meta-label is color-only-plus-text — but Loop 1 Fix 2 placed `--notable` on the same hue family as `--accent` in dark mode, so colorblind users have NO non-color signal that "NOTABLE" is special

**Where it lives:** `sky-atlas-v3.html:88` (`--notable: #f5853b` in dark)
collides with `:78` (`--accent: #6db8d4` in dark). Light mode
`--notable: #c43a1a` vs `--accent: #f5853b`. Loop 1 Fix 2 explicitly
documented that notable and accent are distinct tokens but acknowledged
the "dark-mode value is close to the light-mode `--accent` hue."
Mocks: `.v3-feed-card-meta` at `:800–807` paints "NOTABLE · MOST
RECENT" in `var(--notable)`. `.v3-detail-meta-overlay` at `:513–521`
paints "RECENTLY SEEN · 26 SIGHTINGS THIS MONTH" in
`rgba(255,255,255,0.85)` (white on photo) — not notable-tagged.

**The kink:** The text "NOTABLE" *is* the non-color signal — it's the
word "notable." That's adequate for WCAG 1.4.1 — text content is
always non-color. The kink isn't compliance, it's *salience for
deuteranopic users*: in dark mode, "NOTABLE" rendered in
`#f5853b` against `#131c30` background is the same visual
prominence as any other accent-adjacent text on the page, so the
"this is the notable card" affordance is weaker for colorblind users.
Loop 2 Fix 4 (b) introduced `<FamilySilhouette>` at hero scale —
notable cards could pair the text label with a small glyph (e.g. ⚡
or ★ or a custom SVG flag icon) to give shape-paired emphasis.

Currently the entire "notable" treatment is: word "NOTABLE" + accent
color + (on the feed) the card vs row treatment. The card vs row IS
a non-color signal (the entire visual structure differs) — so this
is borderline. Promote to spec: "Notable affordance is *card
treatment + label text*; color is amplification, not the carrier."
That documents the existing reality.

**Why it matters:** This is the only kink that's mostly already
solved by the mocks (the card-vs-row distinction carries the
information). But the spec should *say* that explicitly so a future
design tweak doesn't drop the card treatment and leave NOTABLE as
color-only-plus-text on a flat row.

**Severity:** Low (compliant today; spec gap that could regress
later)

---

## Issues considered but NOT flagged

- **Wordmark "Bird Maps · Arizona" landmark role.** The wordmark is
  inside `<header>` (top of `<v3-header>`) which is implicitly
  `role="banner"` if it's a direct child of `<body>`. The wordmark
  itself doesn't need a role — it's text inside banner. Borderline
  but already correct under HTML semantics.

- **`loading="eager"` on detail photo (Loop 1 Fix 5) vs CLS.** The
  CLS-mitigation contract from the analysis report's Finding 9 is
  CSS `aspect-ratio: 4/3` reserving the box, NOT `loading=lazy`.
  `loading="eager"` doesn't defeat CLS mitigation — they're
  complementary. (Eager prevents LCP penalty; aspect-ratio prevents
  layout shift. Different mechanisms.) Real concern dismissed.

- **`<StatusBlock>` SR announcement during photo load.** Loop 2 Fix
  4 (a) has `<Photo>` own its skeleton internally, not via
  `<StatusBlock>`. The skeleton is a presentational rect with no
  SR announcement — that's fine; the species name `<h1>` (Kink 1
  fix) is already in the DOM by then, and SR users get oriented
  via heading. Concern absorbed by Kink 1 fix.

- **Filter chip strip keyboard navigation (`tablist`/`radio`/`listbox`).**
  Loop 1 Fix 4 demoted the strip to read-only mirrors that
  open the filter panel on tap. Read-only means no
  tablist/radio/listbox semantics needed — just buttons. Concern
  resolved by Loop 1.

- **Lede "stale" announcement.** Loop 1 Fix 7 four-state freshness
  label specifies the rendered text ("Data from {absolute time}")
  — that text IS the SR announcement on a fresh page load. The
  *transition* from fresh → stale during a long session would
  benefit from `aria-live` on the meta element, but that's a
  Loop-1-deferred refinement; the v1 ship can render the static
  state without live updates. Real but not pre-spec-blocking.

- **Brand mark dropped — no role for wordmark.** Wordmark is text
  inside `<header role="banner">`. No additional landmark needed.

- **Family channel inline `style={{ background, color }}` on
  silhouettes.** Inline styles are accessible (axe doesn't flag
  them); the AA-pairing test (Loop 2 Fix 1) is the structural
  guard. Already covered.
