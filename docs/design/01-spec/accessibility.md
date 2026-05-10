# Accessibility

The redesign **inherits** an exceptional baseline and **adds** several new contracts. This file enumerates both. Phase plans cite the relevant subsection.

## Inherited baseline (preserve, do not regress)

The existing implementation has months of accessibility work that the visual redesign must not silently destroy. Each item is axe-validated where possible; CI fails on regression.

### 1. Landmark order

`<region>` (filters) → `<tablist>` (surface nav) → `<main>` → `<contentinfo>` (footer/credits). Enforced by `frontend/e2e/axe.spec.ts:8–20`. The redesign drops the footer (Phase 6) but adds `[Attribution]` to the header — landmark order is preserved as `<region>` → `<tablist>` → `<main>`.

### 2. WAI-ARIA tablist

`SurfaceNav` (`frontend/src/components/SurfaceNav.tsx:79–108`) implements the full tablist contract: `role="tablist"`, `aria-label="Surface"`, three `role="tab"` buttons with `aria-selected`, `aria-controls="main-surface"`, roving `tabIndex`, Arrow / Home / End keyboard navigation, automatic-activation pattern.

**Pattern A (mobile bottom-tab) preserves this.** The bottom-tab bar is the same `<SurfaceNav>` component re-styled via CSS — its DOM order, role attributes, and keyboard contract are unchanged. Visual position (top vs bottom) is decoupled from DOM order. CSS `position: fixed; bottom: 0` does not move the element in the DOM tree.

### 3. Native `<dialog>` modal pattern

`AttributionModal.tsx:182–261` uses the native `<dialog>` element with full focus management: `showModal()`, ESC closes, backdrop click closes, `queueMicrotask(() => closeBtn.focus())` on open, focus restoration via `previouslyFocusedRef` on close. axe-validated at desktop and mobile.

The detail-surface modal (Phase 4 desktop) reuses this pattern verbatim. The bottom-sheet (Phase 4 mobile) does NOT use `<dialog>` — see [New contract: bottom-sheet ARIA](#new-contract--bottom-sheet-aria).

### 4. Focus-visible

Uniform 2px outline `--color-text-strong` at every `:focus-visible` site (~6 places in styles.css). Color contrasts against every defined background.

The redesign **upgrades** this to an inverse-luminance halo with 2px outline-offset gap. See [New contract: focus halo](#new-contract--focus-halo).

### 5. Inline-measured contrast

The codebase's documentation convention: every `#hex` value in `styles.css` carries an inline contrast measurement against its expected pairing surface. Examples at `styles.css:243–264, 507–512`.

The redesign **extends** this convention to:

- Cluster pill colors against their text (Sky 8.2:1 / Sand 10.4:1 / Ember 5.1:1)
- Family palette colors against their `on` partner (auto-paired in `getFamilyChannel`, asserted in unit tests)

### 6. 44px content tap targets

`.feed-row` (and similar primary content rows) declare `min-height: 44px` per iOS HIG. Documented at `styles.css:135–137, 179`. The redesign preserves this for content; chrome elements may stay at 32px (existing `.attribution-trigger` minimum).

## New contracts (the redesign adds)

### New contract — focus halo

Visible focus indicator becomes a brand element. 2px outline + 2px outline-offset gap creates a halo around the focused element:

```css
:focus-visible {
  outline: 2px solid var(--focus-ring-color);
  outline-offset: 2px;
}
```

`--focus-ring-color` is computed via `color-mix` so it contrasts at 3:1 against the immediate surface (WCAG 2.4.11 Focus Appearance, new in 2.2). Default to `--color-text-strong`; the brand-color override is per-element via `--focus-on-bg`.

### New contract — detail dialog heading + focus order

Species name in the detail dialog must be a heading element, not a presentational `<div>`:

```tsx
<h1 id="detail-title" tabIndex={-1} className="detail-name">
  {species.commonName}
</h1>
```

(Use `<h2>` if the page already has a higher-level `<h1>` — choose rank from the surrounding landmark tree.)

The `<dialog>` element carries `aria-labelledby="detail-title"`. Initial focus targets `#detail-title`, NOT the close button:

```ts
queueMicrotask(() => {
  dialog.querySelector<HTMLElement>('#detail-title')?.focus();
});
```

SR users hear: "Gila Woodpecker, heading level 1 — Species detail, dialog" on open. The close button is reachable via Tab, never via initial focus. axe assertion: `dialog[aria-labelledby]` resolves to non-empty heading; `document.activeElement === #detail-title` after open.

### New contract — bottom-sheet ARIA

The bottom-sheet on mobile is **not** a `<dialog>` (which is modal-only by definition; the peek/half states need the map underneath to stay interactive). It's a `<div>` whose role flips with snap state:

| Snap | Role | aria-modal | aria-label |
|---|---|---|---|
| peek | `region` | absent | "Selected sighting" |
| half | `region` | absent | "Selected sighting" |
| full | `dialog` | `"true"` | species common name |

Sequencing matters at the half→full transition: `inert` is set on the map container BEFORE the role attribute flips to `dialog`, so SR never sees both as simultaneously browseable. On full→half (collapse), the order reverses: React renders `role="region"` first, then JS removes `inert`.

Tab order at peek/half: sheet is DOM-last (after `<main>` containing the map). Default DOM tab sequence is correct; no `tabindex` manipulation. The drag handle is the first focusable inside the sheet.

ESC handler is scoped to focus inside the sheet:

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

If focus is on a map element (cluster button), ESC does nothing — MapLibre's own handlers run. ESC only collapses the sheet when focus is inside it.

### New contract — cluster pill ARIA

The pill is a single SR announcement, not separately-readable color + count:

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

Tier (sky / sand / ember — color, padding, font-size) is decorative density encoding. The visible count is the canonical information carrier. WCAG 1.4.1 satisfied by the count text inside the pill, not by color.

### New contract — `<FilterSentence>` live region

Settled-state SR announcements with explicit debouncing and a "filters cleared" hold:

```tsx
<div role="status" aria-live="polite" aria-atomic="true" aria-relevant="text">
  {liveText}
</div>
```

500ms debounce on settled state (a user toggling 4 filters in 2 seconds gets one announcement after the toggles stop). On filter-cleared transition, hold "All filters cleared." in the live region for 1500ms before going silent. See [`components.md`](./components.md) for full implementation contract.

### New contract — color-independent state encoding

Family palette pairs color with shape modifier in the legend (circle / square / pentagon / diamond — see `frontend/src/config/family-palette.ts`). WCAG 1.4.1 holds without depending on luminance differences alone — color-blind users (8% of male users) read state from greyscale.

The notable affordance is preserved as a CARD layout + label text. Color (`--color-accent-notable-fg`) is amplification only. A future redesign that moves notable cards to flat rows MUST retain a non-color discriminator before removing the card treatment.

## Existing axe coverage matrix

`frontend/e2e/axe.spec.ts` covers 13 surface×viewport×state combinations:

1. Initial load
2. Map view, desktop
3. Map view, mobile 390×844
4. Species view + autocomplete OPEN, desktop
5. Species view + autocomplete OPEN, mobile
6. Error screen
7. Species detail, no photo, desktop
8. Species detail, no photo, mobile
9. Species detail with photo, desktop
10. Species detail with photo, mobile
11. Feed view
12. Attribution modal OPEN, desktop
13. Attribution modal OPEN, mobile

## Redesign extensions to axe coverage

Phase 4 + Phase 3 add three new branches:

1. **Detail dialog photo path** — assert `dialog[aria-labelledby]` resolves to non-empty heading; `document.activeElement === #detail-title` after open
2. **Bottom-sheet at full snap** — assert `role="dialog"` is present, `aria-label` matches species name, map has `inert` attribute
3. **Cluster pill** — assert `role="img"` + `aria-label` includes count

These are added when their producing component lands.

## What axe does NOT catch

- **Cluster bubble contrast** when MapLibre paints solid fills (canvas excluded from axe). Sky Atlas's cluster pills move text off the colored fill onto `--color-bg-surface`, making contrast arithmetic and axe-readable in the rendered DOM. This is the structural fix.
- **Motion under reduced-motion** — no axe rule for it. Manual VoiceOver / NVDA pass + DevTools "emulate prefers-reduced-motion" required.
- **Filter-change SR announcements** — axe checks structure at a point in time, not behavior over time. The `<FilterSentence>` live-region contract is verified manually post-implementation.
- **Color-blind verification** — 1.4.1 axe rule helps, but visually verifying greyscale legibility requires a designer pass with a color-blindness simulator.

## Manual verification checklist

Before Phase 6 ships:

- [ ] VoiceOver pass on filter changes (announcements settle correctly with 500ms debounce)
- [ ] VoiceOver pass on view changes (SurfaceNav tab activation announces the new surface)
- [ ] DevTools "emulate prefers-reduced-motion: reduce" — confirm no transitions or animations on every surface
- [ ] DevTools "emulate prefers-color-scheme: dark" — confirm initial default works (and that user-explicit toggle persists across reloads)
- [ ] Color-blindness simulator pass on family legend (all 7 families distinguishable in deuteranopia, protanopia, tritanopia)
- [ ] Physical iPhone X+ test — bottom tab bar safe-area + bottom-sheet drag (G6)

## Cross-references

- Components implementing these contracts: [`components.md`](./components.md)
- Phase that introduces each contract:
  - Focus halo: [Phase 1](../02-phases/phase-1-token-foundation.md) (token) + [Phase 2](../02-phases/phase-2-primitives.md) (consumed)
  - Detail dialog heading + focus order: [Phase 4](../02-phases/phase-4-detail-surface.md)
  - Bottom-sheet ARIA: [Phase 4](../02-phases/phase-4-detail-surface.md)
  - Cluster pill ARIA: [Phase 2](../02-phases/phase-2-primitives.md) + [Phase 3](../02-phases/phase-3-map-surface.md)
  - `<FilterSentence>` live region: [Phase 2](../02-phases/phase-2-primitives.md) + [Phase 5](../02-phases/phase-5-feed-species.md)
- Reduced-motion: [`motion.md`](./motion.md)
