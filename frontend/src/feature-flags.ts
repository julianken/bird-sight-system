/**
 * Feature-flag helpers (epic #556, spec
 * `docs/specs/2026-05-15-cell-species-popover-design.md` §10).
 *
 * Each flag is read once at module load and memoized. esbuild inlines
 * `import.meta.env.*` at build time so the function bodies become
 * compile-time constants in production; the memoization is for clarity
 * and to give tests a single mock point.
 */

/**
 * Cell species popover — gates the Phase 1+ per-cell hover preview /
 * click popover / "Explore map markers" skip-link behind a runtime flag.
 * Default OFF (see `.env.example`). Flips to ON in Phase 3 (#560) as an
 * atomic cutover that also removes the runtime branching.
 *
 * Contract: returns `true` ONLY when `VITE_FF_CELL_POPOVER === 'true'`
 * (literal string match). Any other value — undefined, empty string,
 * "1", "yes", "TRUE" — returns false. Strict matching keeps the
 * runtime check unambiguous.
 */
const cellPopoverEnabled = import.meta.env.VITE_FF_CELL_POPOVER === 'true';

export function isCellPopoverEnabled(): boolean {
  return cellPopoverEnabled;
}
