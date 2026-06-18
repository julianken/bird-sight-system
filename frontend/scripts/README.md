# frontend/scripts

Standalone operator tools for the frontend workspace. These are **not** specs
(they live outside `frontend/e2e/`, so `playwright test` never runs them) and
**not** part of the `vite build` (they live outside `src/`, so `tsc -b` never
compiles them). Each is run by hand via an npm script and is `knip`-ignored with
a dated rationale in `knip.ts`.

## replay-viewbox

Open & diff **N viewbox links** side by side — the consumer for reproducing a
multi-view **data inconsistency** (epic #1238, child C3 / #1241).

A "viewbox link" is the `?state=…&since=…#map=<zoom>/<lat>/<lng>…&v=<W>x<H>@<dpr>`
URL that the in-app **"Copy link to this view"** button (C2) produces. Given
several of them, `replay-viewbox`:

1. opens each link at its **captured viewport + camera** (the `&v=` viewport
   becomes the browser context's size + `deviceScaleFactor`; the `#map=` camera
   is applied via `window.__birdMap.jumpTo`),
2. captures the **live, proxied `/api/observations` request + response** (no
   stub — the real read-api body, which is where an inconsistency shows up),
3. screenshots the rendered map, and
4. emits a generated **side-by-side diff** highlighting response deltas — a
   `mode` flip (`aggregated` vs `observations`), observation/species/family
   count drift, truncation differences.

### Requires the DEV server (not the preview build)

`window.__birdMap` — the live MapLibre instance the tool drives — is exposed by
`MapCanvas.tsx` only when `import.meta.env.MODE !== 'production'`, i.e. on the
**Vite dev server**, and is **absent** in the preview/prod build. The tool owns
its base URL (defaults to `http://localhost:5173`) and fails loudly if
`__birdMap` is missing. The dev server must also be able to reach a real
read-api at `/api` (its Vite proxy forwards `/api` → `VITE_DEV_API_TARGET`,
default `http://localhost:8787`).

### Run it

```sh
# 1. Stand up the data path (in separate shells / background):
#    - Postgres + PostGIS on :5440, then `npm run db:seed` (writes demo data)
#    - the read-api on :8787 (it serves /api/observations)
#    - the frontend dev server:
npm run dev -w @bird-watch/frontend            # serves on :5173

# 2. Replay N links (a `label=` prefix is optional; default label is view-N):
npm run -w @bird-watch/frontend replay:viewbox -- \
  'desktop=http://localhost:5173/?state=US-AZ#map=11.000/33.45000/-112.07000&v=1440x900@1' \
  'mobile=http://localhost:5173/?state=US-AZ#map=11.000/33.45000/-112.07000&v=390x844@2'

# …or from a file (one `[label=]<url>` per line; blank lines and # comments ok):
npm run -w @bird-watch/frontend replay:viewbox -- --links-file ./links.txt
```

A link copied from **prod** (`https://bird-maps.com/…`) replays fine — the tool
keeps the link's path + query + hash and swaps only the origin for the dev base.

Flags:

| Flag | Default | Purpose |
|---|---|---|
| `--base <url>` | `$REPLAY_BASE_URL` or `http://localhost:5173` | Override the dev base URL the tool drives. |
| `--out <dir>` | `./replay-out/<timestamp>` | Override the run directory. |
| `--links-file <path>` | — | Read links from a file (one `[label=]<url>` per line). |
| `--headed` | off | Show the browser window. |

### Output

A run directory containing, per link, a `<label>-<WxH>.png`, plus:

- **`replay-report.json`** — `[{ label, url, requestUrl, responseBody, screenshotPath }]`
  (JSON-first so it is machine-comparable and git-diffable; each record also
  carries the resolved `viewport` and a `summary` of the response).
- **`replay-diff.md`** — a rendered side-by-side: per-view header, a metrics
  table (one column per view), and a plain-language **Deltas** section calling
  out exactly what disagrees.
