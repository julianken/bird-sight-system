# C0 Prototype Learnings — State/ZIP Scope Selector

**Gate:** This note satisfies the CLAUDE.md prototype gate for the
`2026-05-28-state-scope-selector` plan. Per the gate rule, no Stream-C task
body (C2–C9 + C2a) may be authored until this note is committed. Promoting
#735/#736/#737/#738/#740/#741/#742 from `needs-scoping` to `agent-ready`
depends on it.

**Prototype:** `frontend/prototypes/scope-prototype/` — a standalone Vite entry
(own `index.html` + `vite.config.ts`, `root: __dirname`) reusing the frontend
workspace's installed `react-map-gl@8` + `maplibre-gl@5`. It renders the
**chooser-first** flow against `canned-az-scoped.json` (472 observations: 360
inside the Arizona envelope — clearing the ≥344 bar — plus a 112-row CONUS
spread for the whole-US view and ZIP resolution).

**How to run:**
```sh
npx vite frontend/prototypes/scope-prototype --port 5212
# regenerate the fixture (deterministic, seeded): node frontend/prototypes/scope-prototype/gen-canned.mjs
```

## What was driven (Playwright MCP, 390×844 + 1440×900, + all 5 canonical viewports)

| Flow | Result |
|---|---|
| **Bare URL → chooser** | Chooser shown; map render AND canned-data fetch **suppressed** (0 requests for `canned-az-scoped.json`; 0 console errors, 0 warnings) |
| **Pick state (US-AZ)** | Fenced state view: `fitBounds(stateBbox)` frames AZ, `maxBounds` clamps to AZ, data clips to the **360** AZ rows; fetch fires exactly once, AFTER selection |
| **ZIP 85701 → US-AZ** | URL gains `?state=US-AZ` (no `?zip=`); camera `flyTo` lands at lng −110.974 / lat 32.222 / **zoom 10** (= `ZIP_FLYTO_ZOOM`), a point inside Arizona |
| **`?scope=us`** | Whole-US CONUS map: region "USA", all **472** rows (unclipped), `maxBounds = [[-130,20],[-65,52]]` (= production `MAX_BOUNDS`) |
| **In-state switch AZ→CA** | Same maplibre instance + canvas persist (tagged & verified); `maxBounds` re-applied AZ→CA envelope with **no remount**; data re-clips to 38 CA rows |

Console was **zero errors AND zero warnings** at every measured state and at all
five canonical viewports (390×844, 768×1024, 1024×768, 1440×900, 1920×1080) in
both themes.

## The 6 findings

### (a) `maxBounds` reactivity — does react-map-gl 5.x honor a changing prop without remount?

**Yes.** `maxBounds` is a react-map-gl *camera* prop (camera options are
reactive; only "Other options" apply once at construction — see the C1 notes).
Verified empirically: tagging the maplibre instance + canvas, then switching
state AZ→CA via an in-state `<select>`, kept `m.__protoTag === 'az-instance'`
and `canvas.dataset.protoTag === 'az-canvas'` true while `getMaxBounds()`
updated from the AZ envelope to the CA envelope. **Do NOT call
`map.setMaxBounds()` imperatively** — pass the changed prop and let react-map-gl
re-apply it. (C3 implication: derive `MAX_BOUNDS` from the active scope and pass
it as a prop; the controlled-camera path stays single-source.)

### (b) `fitBounds` vs `initialViewState` in the uncontrolled-camera lifecycle

No conflict, *with one ordering caveat*. The prototype uses
`initialViewState={{ bounds, fitBoundsOptions }}` (uncontrolled) for the first
frame, then calls `mapRef.current.fitBounds(...)` imperatively on subsequent
scope changes. The catch: imperative camera calls fired from a `useEffect` on
the **first commit** race the map's GL init — `mapRef.current` is non-null but
the map hasn't fired `load`, so the call is dropped or overridden by
`initialViewState`. **Fix: gate every imperative camera move behind a
`mapReady` flag flipped on the maplibre `load` event** and run the camera-intent
effect only once ready. (See finding (f) — this is the same root cause as the
chooser→map mount jank.)

### (c) Padding that keeps a state framed at both viewports

`padding: 48` (uniform px) on `fitBounds` frames Arizona cleanly at both
390×844 and 1440×900 with `maxZoom: 12` capping the zoom-in for small/dense
states. A single uniform number is sufficient for the prototype; production
(C3) should consider an *asymmetric* top padding equal to the on-map
`ScopeControl` bar height so the framed state isn't occluded by the header
(the prototype's header is a separate flex row above the map, so it doesn't
overlap — but the production on-map control floats over the canvas).

### (d) Does the bbox-debounce refetch loop fight the `fitBounds` animation?

Not in the prototype's gated-fetch model, and the prototype shows **why the
production model must stay gated**. The fetch fires **once per scope change**
(keyed on the scope, not on viewport `idle`), so there is no
debounce-vs-animation contention during the `fitBounds`/`flyTo` transition.
The risk to avoid in C6: if the production viewport-`idle` → bbox-refetch loop
(the existing `onViewportChange` path) stays live *during* a programmatic
`fitBounds`, every interpolated camera frame that settles could trigger a
refetch mid-animation. **C6 implication: suppress the viewport-refetch while a
scope-change camera move is in flight (or debounce past the animation
duration), and treat the scope change itself as the single refetch trigger.**
The plan's "one refetch per scope change" gate (P3) is the assertion to hold.

### (e) Sprite/SDF / console noise at volume

The prototype deliberately uses **plain circle layers** (clustered + unclustered)
rather than the production SDF-silhouette pipeline — the C0 gate validates
camera + scope mechanics at volume, not the silhouette sprites. No
sprite/missing-image warnings result (there are no sprites to miss).

The real console-noise finding is the **basemap**: the production positron
*vector* basemap (`tiles.openfreemap.org/styles/positron`) emits a known
upstream MapLibre 5.x warning — `"Expected value to be of type number, but
found null instead"` — from data-driven style expressions in its label/POI
layers that hit a null property on some vector-tile features at **zoom ≥ 10**.
The warning is raised inside MapLibre's tile-parsing **web worker**, so it is
**not suppressible from application code** (a main-thread `console.warn` wrapper
never sees it — verified). It is non-actionable (the map renders correctly) and
long-standing (mapbox-gl-js#7097, kibana#38021). Isolation test: hiding *all*
prototype layers still produced the warning at zoom 12, confirming the basemap
worker as the source. The prototype renders against a **warning-free CARTO
Positron raster basemap** so the gate's zero-warning bar measures the scope
code, not upstream basemap noise. **Stream C decision inherited:** keep the
production vector positron and accept/document the upstream zoom-≥10 warning as
a known-tolerated console line, OR evaluate a cleaner vector style. The scope
code itself adds zero warnings either way. (The cluster `step` expressions are
also defensively `to-number`-guarded against the same warning class, though our
`['has','point_count']` filter already excludes the null case.)

### (f) Chooser→map mount/remount jank when gating the map behind the chooser

**This is the load-bearing finding for the chooser-first landing model.**
Because the chooser conditionally renders *instead of* the map (the gate that
suppresses the cold-load fetch), picking a scope **mounts the `<Map>` fresh**.
On that first commit, imperative camera effects (`fitBounds` for the state,
`flyTo` for a ZIP) fire before the GL context is `load`ed and either no-op or
lose to `initialViewState`. The naive two-effect version exhibited this exactly:
a ZIP entry mounted the map, both the state `fitBounds` and the ZIP `flyTo`
ran, and the **whole-state `fitBounds` clobbered the metro-zoom `flyTo`** — the
camera sat at the AZ overview instead of flying to Tucson.

**Fix that survives the mount transition (validated):**
1. Gate every imperative camera move behind a `mapReady` flag flipped on the
   maplibre `load` event (not just on `mapRef.current` being non-null).
2. Use a **single** camera-intent effect keyed on `[mapReady, boundsKey,
   flyTo?.key]` that **prefers `flyTo` over `fitBounds`** when a ZIP move is
   pending — a ZIP is a "point inside state" intent, so it must win over the
   whole-state framing on the same mount.

After this fix the ZIP→Tucson move lands at exactly zoom 10 inside Arizona with
zero jank. **C3/C6 implication:** the chooser-gated mount means scope selection
always remounts the map; the camera-intent effect must be `load`-gated and
flyTo-preferring, and C6 must not assume the map is already mounted when a scope
is first chosen. (An alternative C6 could keep the map *mounted but hidden*
behind the chooser to avoid the remount entirely — at the cost of an eager GL
context; the prototype validates the remount path, which is the simpler model
and is sufficient.)

## Net assessment

The chooser-first scoped-state render approach is **viable at production
volume and real viewports**. The camera contract (reactive `maxBounds` prop,
`load`-gated imperative `fitBounds`/`flyTo`, flyTo-preference on ZIP) is proven;
the cold-load fetch suppression behind the chooser works; and the only console
noise traced was an upstream basemap-worker warning, independent of the scope
code. Stream-C task bodies (C2–C9 + C2a) can be authored.
