# `@bird-watch/frontend` — bird-maps.com web client

Map-first React + Vite + MapLibre GL app for visualizing recent eBird
observations across the continental US (CONUS). Deployed as a static bundle to
Cloudflare Pages and served at [bird-maps.com](https://bird-maps.com); it reads
from the Read API at `api.bird-maps.com`.

This is the `frontend` npm workspace of the `bird-watch` monorepo. It is the
only workspace that ships browser code; the others (`packages/*`,
`services/*`) are the data layer and backend services.

## What it is

The UI is a single always-mounted, full-viewport MapLibre canvas (`#map-layer`)
with floating chrome anchored to the four corners — there is no top bar, no
nav tabs, and no feed/list surface. The map is the application. Geographic
scope is URL-driven, not tab-driven:

- `?state=US-XX` — a single state (48 contiguous states + DC; no AK/HI/territories)
- `?scope=us` — the whole-CONUS escape hatch
- bare URL — a scope chooser landing (the default), shown over the idle map

Observations render through MapLibre's built-in GeoJSON clustering, with
server-side aggregation at low zoom for the national-scale payload. The full
layout law (corner anchors, elevation tiers, transient layer) lives in the
design spec linked below, not here.

## Develop

From the repo root:

```sh
npm install                                   # installs the whole workspace
npm run dev --workspace @bird-watch/frontend  # vite dev server on :5173
```

Other workspace scripts (run with `--workspace @bird-watch/frontend`):

| Script | Command | Purpose |
| --- | --- | --- |
| `dev` | `vite` | dev server |
| `build` | `tsc -b && vite build` | typecheck + production bundle to `dist/` |
| `preview` | `vite preview` | serve the built `dist/` on :4173 |
| `test` | `vitest run` | unit/component tests |
| `test:e2e` | `playwright test` | end-to-end specs (`e2e/*.spec.ts`) |

### Build-time environment

Vite reads `VITE_*` variables at build time:

- `VITE_API_BASE_URL` — Read API origin (production: `https://api.bird-maps.com`)
- `VITE_REGION_CODE` — eBird region code (production: `US`)
- `VITE_CLARITY_PROJECT_ID` — Microsoft Clarity project; analytics initialize
  only when this is set **and** `import.meta.env.PROD` is true. Never import
  `@microsoft/clarity` directly — go through the `safeClarity` wrapper in
  `src/clarity.ts`.

## Reference

Do not duplicate the canonical references below — they are the higher-trust
anchors and this README is deliberately thin to avoid drifting against them.

- **`../CLAUDE.md`** — the repo's source of truth for the floating-card
  four-corner anchor contract, the canonical 5-viewport set, the Playwright
  MCP UI-verification protocol, the E2E spec-authoring conventions, and the
  PR workflow. Read this before touching visible UI.
- **`../docs/design/standalone/2026-05-30-floating-ui-design-spec.md`** — the design
  authority for the map-first floating-UI system (anchors, tokens, elevation,
  popover/detail/filters behavior).
- **`../docs/specs/2026-04-16-bird-watch-design.md`** — the original system
  design. Note: it predates the map-first re-architecture and the national
  flip and is materially stale on UX and service topology; treat `CLAUDE.md`
  as current ground truth where they conflict.
