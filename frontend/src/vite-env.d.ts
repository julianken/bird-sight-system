/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_POSTHOG_KEY?: string;
  /**
   * Cell species popover (epic #556, Phase 1+, spec
   * docs/specs/2026-05-15-cell-species-popover-design.md §10).
   * String literal "true" enables the feature flag; anything else
   * disables it. Read via `isCellPopoverEnabled()` in feature-flags.ts.
   */
  readonly VITE_FF_CELL_POPOVER?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
