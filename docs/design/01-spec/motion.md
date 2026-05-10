# Motion policy

Single source of truth: `frontend/src/styles/motion.css`. One global rule + one CSS exception + one JS exception. Lands in Phase 0; survives every subsequent phase.

## Why a single source

The existing codebase has zero `prefers-reduced-motion` queries and zero CSS motion. The redesign introduces motion (skeleton state transitions, modal opacity, sheet snap) and inherits an obligation: every site that animates must respect the reduced-motion preference. A single global rule prevents per-component drift; the alternative is an audit liability where every PR could miss the guard.

## The global rule

```css
/* frontend/src/styles/motion.css */

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    transition-duration: 0ms !important;
    animation-duration: 0ms !important;
    animation-iteration-count: 1 !important;
  }
}
```

`!important` is intentional — this is a user accessibility preference, not a design decision, and should override any component-level duration. Components don't get to opt out.

Imported once from `frontend/src/main.tsx`, after `styles.css`:

```ts
import './styles.css';
import './styles/motion.css';
```

Order matters — `motion.css` must come AFTER `styles.css` so its `!important` rules override transition durations declared in component CSS rules above.

## CSS exception — cluster pill hover transform

The global rule collapses *durations* to 0. Some hover transforms are still jarring even at 0ms — a sudden `scale(1.05)` jump on hover is undesirable under reduced-motion. Add one explicit override:

```css
@media (prefers-reduced-motion: reduce) {
  .cluster-pill:hover {
    transform: none;
  }
}
```

This skips the transform entirely (not just the interpolation). Pattern: when a transform itself is part of the motion vocabulary (not just its interpolation), the per-element override removes it under reduced-motion. Future components that animate transforms on hover should add similar overrides.

The cluster-pill `box-shadow` change on hover is preserved under reduced-motion — shadows are not motion.

## JS exception — MapLibre camera animations

MapLibre's `easeTo`, `flyTo`, `panTo` are JavaScript-driven and not under the CSS cascade. The global rule does NOT reach them. Each call site reads the preference and conditionally sets `duration: 0`:

```ts
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

map.easeTo({
  center,
  zoom,
  ...(prefersReducedMotion ? { duration: 0 } : {}),
});
```

The spread-of-conditional-object pattern keeps the call shape byte-identical to the prior behavior under non-reduced-motion (so existing tests asserting `easeTo` was called with `{center, zoom}` continue to pass).

In React, read the preference once at component mount via `useMemo`:

```tsx
const prefersReducedMotion = useMemo(
  () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  []
);
```

The empty dep array reads once on mount and never re-checks. Re-running on prefs change adds complexity for a low-value case (the user must reload to fully apply some other reduced-motion changes anyway).

The known call site requiring this guard is `frontend/src/components/map/MapCanvas.tsx:729` (cluster expansion `easeTo`). Phase 0 adds the guard there. If new `easeTo` / `flyTo` / `panTo` calls are added, they MUST include the same guard — there's no lint rule for this; it's a code review check.

## Allowed motion in the redesign

The redesign uses motion sparingly. Allowed motion sites:

- **Modal / sheet open/close** — opacity transition (200ms ease-in-out) on the dialog/sheet container
- **Sheet snap** — `transform: translateY` on the sheet container; CSS transition; collapses to instant under reduced-motion
- **Photo skeleton → loaded crossfade** — opacity transition on the `<img>` (250ms)
- **MapLibre cluster expansion** — `easeTo` (default 1000ms; 0 under reduced-motion)
- **2px sunrise progress bar** — `width` transition during indeterminate `<progress>` (handled by browser native behavior)

Disallowed:

- Shimmer / gradient sweeps on skeletons (cargo-cult; against the iOS-restraint posture)
- Continuous animations (e.g., looping pulse on the brand mark — there is no brand mark)
- Spring physics with overshoot — the only candidate was the cluster popover entry; deferred to v1.1
- Motion that conveys meaning beyond decoration — anything that affects state should also be readable from a static snapshot

## Duration tokens

The existing `frontend/src/tokens.ts:115–122` reserves three duration tokens:

```ts
duration: {
  fast: 200,    // ms — modal opacity, photo crossfade
  base: 250,    // ms — sheet snap
  slow: 350,    // ms — reserved for future use
}
```

Mirrored in CSS as `--dur-fast`, `--dur-base`, `--dur-slow`. Components consume these:

```css
.modal-overlay {
  transition: opacity var(--dur-fast) ease-in-out;
}
.bottom-sheet {
  transition: transform var(--dur-base) cubic-bezier(0.4, 0, 0.2, 1);
}
```

The global rule overrides these durations with `0ms !important` under reduced-motion.

## Phase that ships this

[Phase 0](../02-phases/phase-0-pre-redesign.md) ships the global rule and the MapLibre `easeTo` guard. Subsequent phases consume the policy; they don't add per-component reduced-motion queries.

## Cross-references

- Architecture (allowed motion sites): [`architecture.md`](./architecture.md)
- Token layer (duration tokens): [`tokens.md`](./tokens.md)
- Analysis report Theme 5 finding 5.6 (suspected MapLibre motion-leak): [`../03-research/analysis-funnel-summary.md`](../03-research/analysis-funnel-summary.md)
