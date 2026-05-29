# maplibre-gl / react-map-gl 5.x Camera Notes (Task C1)

**Purpose:** CLAUDE.md flags `maplibre-gl` as drift-prone (at 5.x since PR #199)
and requires fresh docs before writing camera code. These notes feed C3
(controllable `MapCanvas` camera: scope-change `fitBounds` + dynamic
`MAX_BOUNDS`).

**Versions in this repo:** `maplibre-gl@^5.24.0`, `react-map-gl@^8.1.1`
(react-map-gl v8 wraps maplibre-gl 5.x; the "5.x" in the issue title refers to
the underlying maplibre-gl, not react-map-gl).

**Sourcing note (honest):** context7's monthly quota was exhausted at the time
of authoring (`resolve-library-id` returned "Monthly quota exceeded"), so the
facts below were pulled from the **official MapLibre GL JS API reference** and
the **official react-map-gl docs** (the authoritative upstream sources
context7 itself indexes) plus **empirical verification in the C0 prototype**.
Every claim marked ✅ was confirmed by driving the running prototype via
Playwright MCP. Re-pull via context7 when quota resets if a fresh failure
surfaces.

Sources:
- MapLibre GL JS — `Map` class, `fitBounds`, `setMaxBounds`, `easeTo`/`flyTo`:
  https://maplibre.org/maplibre-gl-js/docs/API/classes/Map/
- MapLibre GL JS — `FitBoundsOptions`:
  https://maplibre.org/maplibre-gl-js/docs/API/type-aliases/FitBoundsOptions/
- react-map-gl — Map component / camera options / `MapRef`:
  https://visgl.github.io/react-map-gl/docs/api-reference/maplibre/map
- react-map-gl — State management (controlled vs uncontrolled, native methods):
  https://visgl.github.io/react-map-gl/docs/get-started/state-management

---

## 1. Is `maxBounds` reactive on `<Map>` post-mount, or does it need imperative `setMaxBounds()`?

**Reactive — pass the prop, do NOT call `setMaxBounds()` imperatively.** ✅

- react-map-gl splits props into **camera/constraint options** (reactive — the
  wrapper re-applies them when they change) and **"Other options"** (applied
  **once** at construction). The docs state explicitly that "Other options …
  are not reactive. They are only used once when the Map instance is
  constructed." `maxBounds`, `minZoom`, `maxZoom`, `maxPitch` are listed as
  camera/constraint options — i.e. **reactive**.
- The docs further warn that calling a native method (e.g.
  `map.setMaxBounds()` / `map.setMaxZoom()`) makes the map's internal state
  **deviate from its props** and is "discouraged if the same thing can be
  achieved through the React interface."
- **C0 empirical confirmation:** switching scope AZ→CA while the `<Map>` stayed
  mounted updated `getMaxBounds()` from the AZ envelope to the CA envelope with
  **no remount** (same maplibre instance + canvas, verified via a tag). ✅

**C3 guidance:** compute the active `MAX_BOUNDS` from the chosen scope
(state envelope, or CONUS `[[-130,20],[-65,52]]` for `?scope=us`) and pass it as
the `maxBounds` prop. The bounds change re-clamps without remounting. The raw
MapLibre signature, if ever needed: `map.setMaxBounds(bounds: LngLatBoundsLike): this`.

## 2. `getMap().fitBounds(bounds, options)` signature in 5.x

**Signature (MapLibre 5.x):**
```ts
fitBounds(bounds: LngLatBoundsLike, options?: FitBoundsOptions, eventData?: any): this
```
`LngLatBoundsLike` accepts `[[west, south], [east, north]]` (the form the
prototype + `STATES.bbox→bboxToBounds` produce).

**`FitBoundsOptions`** = `FlyToOptions & { … }`, and `FlyToOptions` extends
`AnimationOptions`, so the full accepted set is:

- `padding` — **number OR an object** `{ top, bottom, left, right }` (px). A
  bare number pads all sides equally. ✅ (prototype uses `padding: 48`.)
- `maxZoom` — `number`. Caps the zoom-in for small/dense bounds (prototype:
  `maxZoom: 12` for a tight state).
- `linear` — `boolean` (default `false`). `true` → transition via `easeTo`;
  `false` → via `flyTo`.
- `offset` — `PointLike` (default `[0,0]`). Center displacement in px.
- *(inherited from `AnimationOptions`)* `duration` — `number` ms;
  `easing` — `(t:number)=>number`; `animate` — `boolean`;
  **`essential` — `boolean`** (see §4).

**Calling convention:** call it on the maplibre instance via
`mapRef.current.getMap().fitBounds(...)`, OR directly on the `MapRef` — react-map-gl
re-exposes the camera methods that "are safe to call without breaking the React
bindings" on the ref itself. The prototype calls `mapRef.current.fitBounds(...)`
directly (the ref proxies it). ✅

## 3. Reduced-motion bypass — `essential: true` (load-bearing)

**This is the detail most likely to be gotten wrong.** From the MapLibre docs
for `easeTo`/`flyTo` (and inherited by `fitBounds`):

> "The transition will happen instantly if the user has enabled the `reduced
> motion` accessibility feature … unless `options` includes `essential: true`."

So:
- Under `prefers-reduced-motion: reduce`, MapLibre makes camera animations
  **instant** *by default* (it does not cancel them — it completes them with
  zero duration).
- Passing **`essential: true` forces the animation to run normally** even under
  reduced motion.

**C3 guidance (matches the prototype):** the scope-change camera move is a
*functional* reframe (it changes what data the user sees), not decorative
motion, so it should still *land* under reduced motion. The prototype passes
**`essential: true` AND `duration: reduced ? 0 : 600`** — i.e. it makes the
"instant under reduced motion" behavior explicit and deterministic (duration 0)
while using `essential` so the move is never silently dropped. The plan's
"reduced-motion `duration:0`" gate (P3: "fitBounds spy duration 0 under
reduced-motion") is satisfied by reading `matchMedia('(prefers-reduced-motion:
reduce)')` once at mount and passing `duration: 0` when set. ✅

Raw MapLibre `easeTo`/`flyTo` signatures (for the ZIP `flyTo`):
```ts
flyTo(options: FlyToOptions & { center?: LngLatLike; zoom?: number; … }, eventData?): this
easeTo(options: EaseToOptions, eventData?): this
```
The prototype's ZIP move: `map.flyTo({ center, zoom: ZIP_FLYTO_ZOOM,
duration: reduced ? 0 : 800, essential: true })`. ✅

## 4. `initialViewState` (uncontrolled) vs post-mount imperative `fitBounds`

- The docs: "If specified, `longitude`, `latitude`, `zoom` etc. in props are
  ignored when constructing the map. Only specify `initialViewState` if `Map`
  is being used as an **uncontrolled component**." `initialViewState` also
  accepts `{ bounds, fitBoundsOptions }` to frame the first paint.
- After mount, imperative methods (`fitBounds`, `flyTo`) via the ref work
  normally **against the uncontrolled camera** — react-map-gl does not fight
  them (the map owns its camera in uncontrolled mode). The docs note that mixing
  *controlled* view-state props with imperative calls "could be unpredictable" —
  so **pick one camera model**. The prototype uses **uncontrolled
  `initialViewState` + imperative `fitBounds`/`flyTo`**, which is clean. ✅
- **Mount-timing caveat (cross-ref C0 finding f):** an imperative camera call
  fired from a `useEffect` on the **first commit** races GL init —
  `mapRef.current` is non-null but the map hasn't fired `load`, so the call is
  dropped or overridden by `initialViewState`. **Gate imperative camera moves
  behind a `mapReady` flag flipped on the maplibre `load` event.** This matters
  specifically because the chooser-first model remounts the map on every scope
  selection (C0 finding f).

## 5. `MapRef` API

- `mapRef.current.getMap()` → the native MapLibre `Map` instance. ✅
- The `MapRef` also re-exposes the camera methods that are "safe to call without
  breaking the React bindings" directly (so `mapRef.current.fitBounds(...)`
  works without `getMap()`). Reach for `getMap()` only when you need a method
  the ref doesn't proxy (e.g. `queryRenderedFeatures`, `addImage`,
  `getMaxBounds` for assertions). The prototype's inspection hook uses
  `mapRef.current.getMap()` to expose the instance for Playwright. ✅

---

## C3 checklist distilled from these notes

- [ ] Pass `maxBounds` as a **prop** derived from the active scope (reactive; no
      `setMaxBounds()` imperative call). CONUS = `[[-130,20],[-65,52]]`.
- [ ] Use **uncontrolled** `initialViewState` (with `{bounds, fitBoundsOptions}`)
      + imperative `fitBounds`/`flyTo` via the ref. Don't mix in controlled
      view-state props.
- [ ] **Gate imperative camera moves on the `load` event** (`mapReady`), not on
      `mapRef.current` alone — required because the chooser remounts the map.
- [ ] On scope change: `fitBounds(stateBounds, { padding: 48, maxZoom: 12,
      essential: true, duration: prefersReducedMotion ? 0 : 600 })`.
- [ ] On ZIP: `flyTo({ center, zoom: ZIP_FLYTO_ZOOM, essential: true,
      duration: prefersReducedMotion ? 0 : 800 })`, and **prefer flyTo over
      fitBounds** when both are pending on the same mount.
