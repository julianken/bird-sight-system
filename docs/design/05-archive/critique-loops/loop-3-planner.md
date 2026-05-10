# Loop 3 Planner: Accessibility & Quality Fixes

## Summary

Six kinks, all accessibility narrative. Two are WCAG hard-compliance gaps (Kink 1 focus/heading, Kink 3 color-only), two are behavioral contracts that must be specified before implementation (Kink 2 live-region debounce, Kink 4 bottom-sheet ARIA roles), one is a cross-cutting motion policy (Kink 5), and one is a spec-gap that codifies already-correct behavior before a future tweak breaks it (Kink 6). None of the fixes reopen settled decisions. Three refine prior planners — named explicitly below.

---

## Fix for Kink 1: Detail dialog heading + focus order

**(a) Species name element must be `<h1 id="detail-title">` (or `<h2>` if the page has a higher-level h1) with `tabindex="-1"`.** The mock's `.v3-detail-name` is a presentational `<div>`. In the implemented `<SpeciesDetailModal>` component:

```tsx
<h1 id="detail-title" tabIndex={-1} className="v3-detail-name">
  {species.commonName}
</h1>
```

Choose the correct heading rank from the surrounding landmark tree. Spec note: "Detail dialog heading is `<h2>` (modal context) because the page-level `<h1>` is the app wordmark."

**(b) `<dialog>` carries `aria-labelledby="detail-title"`. Initial focus targets `#detail-title`, NOT the close button.**

```tsx
<dialog ref={dialogRef} aria-labelledby="detail-title">

// In open handler:
queueMicrotask(() => {
  dialog.querySelector<HTMLElement>('#detail-title')?.focus();
});
```

Close button keeps `autoFocus` removed; reachable via Tab. SR users now hear: "[species name], heading level 2 — Species detail, dialog" on open.

**Refinement to Loop 2:** Loop 2 Fix 4(b) specified `<FamilySilhouette>` as no-photo fallback inside `<Photo>`. The silhouette renders within the same `<dialog>`, so `<h1 id="detail-title">` is always in the DOM before the photo state machine resolves.

**axe spec gap:** Add a test branch in `frontend/e2e/axe.spec.ts` that opens the detail dialog in the photo path and asserts `dialog[aria-labelledby]` resolves to non-empty heading; asserts `document.activeElement` is `#detail-title` after open.

**Cost:** Small.

---

## Fix for Kink 2: `<FilterSentence>` live-region contract

**(a) Wrapper structure** — always-mounted live region:

```tsx
<div
  role="status"
  aria-live="polite"
  aria-atomic="true"
  aria-relevant="text"
  className="filter-sentence-live"
>
  {liveText}
</div>
```

**(b) Debounce gate.** 500ms debounce on the computed sentence string. Constant lives in `frontend/src/config/filter.ts` as `export const FILTER_SENTENCE_DEBOUNCE_MS = 500`. A user toggling 4 filters in ~2 seconds produces one announcement after settling.

**(c) Clear-message trick.** Transition from non-null to `null` (filters cleared) holds "All filters cleared." in the live region for 1500ms before silence:

```ts
useEffect(() => {
  if (debouncedContent !== null) {
    setLiveText(debouncedContent);
  } else if (liveText !== null) {
    setLiveText('All filters cleared.');
    const id = setTimeout(() => setLiveText(null), 1500);
    return () => clearTimeout(id);
  }
}, [debouncedContent]);
```

`FILTER_SENTENCE_CLEAR_HOLD_MS = 1500` in `config/filter.ts`. Visual element still collapses immediately; the hidden live region holds the clear message separately.

**Refinement to Loop 2 Fix 5:** Loop 2 Fix 5(b) said the visual sentence "unmounts" at zero filters. Keep visual unmount; the `role="status"` wrapper never unmounts. These are two separate elements in the DOM.

**Cost:** Small.

---

## Fix for Kink 3: Cluster pill tier discriminator (WCAG 1.4.1)

**Acknowledge tier as decorative; count is canonical.**

```tsx
<div
  className={`v3-cluster v3-cluster--${tier}`}
  aria-label={`${count} sightings`}
  role="img"
>
  {count}
</div>
```

`role="img"` with `aria-label` collapses the pill to one SR announcement ("140 sightings") — tier color/size are visual amplification only.

**Add to decisions table:** "Cluster pill tier (sky/sand/ember) is *decorative density encoding* — the visible count is the canonical information carrier. Tier color and size are amplification only. Pill renders `role='img' aria-label='{count} sightings'`. WCAG 1.4.1 satisfied by the text count inside the pill, not by color."

**Refinement to Loop 2 Fix 2:** Threshold constants and `clusterTier()` function unchanged. Tier drives CSS class; spec text changes; code does not.

**Cost:** Tiny — one `aria-label` prop, `role="img"`, decisions-table edit.

---

## Fix for Kink 4: Bottom-sheet ARIA role + keyboard contract

**(a) Role changes on snap state — `region` at peek/half, `dialog` at full.**

```tsx
const sheetRole = snap === 'full' ? 'dialog' : 'region';
const sheetLabel = snap === 'full' ? speciesName : 'Selected sighting';

<div
  role={sheetRole}
  aria-label={sheetLabel}
  aria-modal={snap === 'full' ? 'true' : undefined}
  className={`v3-bottom-sheet v3-bottom-sheet--${snap}`}
>
```

At full snap: `inert` on map container set BEFORE role flips to `dialog` (so SR never sees both browseable simultaneously). When collapsing back: React renders `role="region"` first, then JS removes `inert`.

**(b) Tab order at peek/half:** sheet is DOM-last after `<main>` (map). Tab from last map focusable enters sheet. Handle (`v3-sheet-handle`) is first focusable inside sheet. No `tabindex` manipulation needed.

**(c) ESC handler scope:** only fires when a sheet focusable has focus.

```ts
useEffect(() => {
  const handler = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    if (!sheetRef.current?.contains(document.activeElement)) return;
    collapseSheet();
    e.preventDefault();
  };
  document.addEventListener('keydown', handler);
  return () => document.removeEventListener('keydown', handler);
}, [collapseSheet]);
```

**Refinement to Loop 1 Fix 3:** Loop 1 Fix 3's underspecified `aria-modal="false"` is replaced by this role-switching contract.

**Cost:** Medium.

---

## Fix for Kink 5: Reduced-motion policy

**(a) Global rule in `frontend/src/styles/motion.css`:**

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    transition-duration: 0ms !important;
    animation-duration: 0ms !important;
    animation-iteration-count: 1 !important;
  }
}
```

Imported once from `index.css`. Single source of truth.

**(b) Per-surface override** — cluster pill hover skips the `transform: scale(1.05)` entirely under reduced-motion (not just instant interpolation):

```css
@media (prefers-reduced-motion: reduce) {
  .v3-cluster:hover { transform: none; }
}
```

**(c) MapLibre camera animations** — JS concern, not CSS:

```ts
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
// At every easeTo / flyTo call site:
map.easeTo({ duration: prefersReducedMotion ? 0 : DEFAULT_DURATION, ... });
```

**Add to decisions table:** "Reduced-motion: global `motion.css` rule sets `transition-duration: 0ms !important` and `animation-duration: 0ms !important` under `prefers-reduced-motion: reduce`. Per-surface exception: cluster pill hover skips transform. MapLibre camera calls read the media query and pass `duration: 0`. `motion.css` is the single source of truth — no per-component reduced-motion queries except MapLibre."

**Cost:** Small — one new CSS file, two JS lines in `MapCanvas.tsx`, one CSS override.

---

## Fix for Kink 6: Notable affordance spec entry

**Add to decisions table:** "Notable affordance: *card layout + label text* are the canonical non-color signals. `--color-accent-notable-fg` (Loop 2 Fix 3's production name) is amplification only. A future design that moves notable cards to flat rows MUST retain a non-color discriminator (icon, border, or other structural difference) before removing the card treatment. The compliant state is card + text; color alone is insufficient."

No code change. Encodes existing compliant state as explicit constraint.

**Cost:** Zero — decisions-table text edit.

---

## Cross-cutting: axe spec coverage gap

Add two axe test branches:
1. Detail dialog **photo path** — assert `dialog[aria-labelledby]` resolves to non-empty heading; assert `document.activeElement === #detail-title` after open.
2. Bottom-sheet at **full snap** — assert `role="dialog"` is present and `aria-label` matches species name.

---

## Implementation order

1. **Kink 5 first** — `motion.css` global rule; one PR, zero visual change.
2. **Kink 3** — `aria-label` on `<ClusterPill>`; ships with cluster threshold constants PR.
3. **Kink 1** — heading + focus order in `<SpeciesDetailModal>`.
4. **Kink 2** — `<FilterSentence>` live-region wrapper + debounce.
5. **Kink 4** — bottom-sheet role-switching + ESC scope.
6. **Kink 6** — decisions-table edit; no PR gate.
