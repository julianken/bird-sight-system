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

## Lint guard

The CI step `Forbidden raw token names` in `.github/workflows/lint.yml` fails on any
`var(--<mock-name>)` usage outside a legacy scope. See `docs/design/01-spec/tokens.md §Lint guard`.

## Source

Canonical spec: `docs/design/01-spec/tokens.md §Namespace migration`
