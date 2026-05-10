# v3 Token Mapping — Mock → Production Names

Companion artifact for Sky Atlas Phase 1 (`docs/plans/2026-05-09-sky-atlas-phase-1-token-foundation.md`).

Records the translation from v3/v4 Figma mock token names to the production `--color-*` namespace. The production names coexist with the existing flat `:root` tokens in `frontend/src/styles.css:1–63` without collision.

## Translation table

| Mock name (v3/v4) | Production name | Status | Notes |
|---|---|---|---|
| `--bg-page` | `--color-bg-page` | Exists in styles.css | Semantic token on `[data-theme]` overrides the `:root` declaration |
| `--bg-surface` | `--color-bg-surface` | Exists in styles.css | Same override mechanism |
| `--bg-tint` | `--color-bg-tint` | Exists in styles.css | Same |
| `--bg-skeleton` | `--color-bg-skeleton` | **New in tokens.css** | Aliases `--color-bg-tint` initially; Phase 2 may diverge |
| `--text-strong` | `--color-text-strong` | Exists in styles.css | — |
| `--text-body` | `--color-text-body` | Exists in styles.css | — |
| `--text-muted` | `--color-text-muted` | Exists in styles.css | — |
| `--text-subtle` | `--color-text-subtle` | Exists in styles.css | — |
| `--border` | `--color-border-ui` | Exists in styles.css | Live codebase already uses `--color-border-ui` |
| `--accent` | `--color-decision-point` | **New in tokens.css** | DO NOT use `--color-accent-notable-fg` — different semantic |
| `--notable` | `--color-accent-notable-fg` | Exists in styles.css | Preserved as-is; DO NOT rename |
| `--font` | (dropped) | — | `body { font-family: var(--font-stack) }` replaces it |
| `--density-sky` | `--color-density-low` | **New in tokens.css** | Cluster low-density tier |
| `--density-sand` | `--color-density-mid` | **New in tokens.css** | Cluster mid-density tier |
| `--density-ember` | `--color-density-high` | **New in tokens.css** | Cluster high-density tier |

## Phase 1 color-value preservation

The `[data-theme="light"]` block in `frontend/src/styles/tokens.css` preserves the **existing** production color values from `frontend/src/styles.css` `:root` for tokens that already exist (text grays, borders, accents, errors). The redesign palette from the spec (lighter grays, warm cream surfaces) is coupled to surface redesign and lands in Phase 3+, not Phase 1.

This preserves AA contrast invariants verified by the e2e axe spec (e.g. `.feed-row-time` at 11px on `#fff` with `--color-text-subtle = #5c5c5c` = 6.86:1, passing 4.5:1). New tokens with no existing equivalent (`--color-bg-skeleton`, `--color-decision-point`, `--color-density-*`) take the spec values directly.

## Phase 1 dark-mode contract

The `[data-theme="dark"]` block in `tokens.css` intentionally overrides ONLY new tokens (no existing equivalent in styles.css `:root`). Existing tokens stay at their light-mode values in dark mode for now.

Why: existing CSS patterns like `.surface-nav-tab.is-active { background: var(--color-text-strong); }` reuse text tokens as backgrounds. Flipping `--color-text-strong` to a near-white in dark mode would put white text on near-white background (1.07:1 contrast). The full dark-mode palette landing requires component rewrites that are out of Phase 1 scope.

What this means visually: when a user toggles to dark mode in Phase 1, the page mostly looks like light mode (because no existing token has a dark-mode value). Only NEW tokens (cluster density triad, decision-point) take their dark-mode pairing. This is the deliberate "mechanism-ready, palette-deferred" Phase 1 contract. Phases 3-5 add full dark-mode palette pairings as each surface is rewritten on Phase 2 primitives.

Tokens overridden in `[data-theme="dark"]` (Phase 1):
- `--color-bg-skeleton` (NEW)
- `--color-decision-point` (NEW)
- `--color-density-low|mid|high` (NEW)
- `--color-density-text` (NEW)

Tokens NOT overridden in `[data-theme="dark"]` (Phase 1):
- All existing tokens carried from `styles.css :root` (`--color-text-*`, `--color-bg-page|surface|tint|*`, `--color-border-ui`, `--color-accent-notable-*`, `--color-error-*`).

The MutationObserver mechanism in `MapCanvas.tsx` is still active and verified to fire on `[data-theme]` change; it calls `map.setStyle(basemapStyleDark)` even though OpenFreeMap's dark style aliases visually similar tiles for now (G8 is also deferred — see `docs/design/01-spec/open-questions.md`).

## Lint guard

The CI step `Forbidden raw token names` in `.github/workflows/lint.yml` fails on any
`var(--<mock-name>)` usage outside a legacy scope. See `docs/design/01-spec/tokens.md §Lint guard`.

## Source

Canonical spec: `docs/design/01-spec/tokens.md §Namespace migration`
