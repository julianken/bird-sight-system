# URL state

Two changes in Phase 0 — both in `frontend/src/state/url-state.ts`. Together they resolve the analysis report's largest IA defect (broken browser back) and home-route ambiguity.

## Change 1: `DEFAULTS.view: 'feed'` → `'map'`

One-line constant change at `frontend/src/state/url-state.ts:15–22`. Bare `bird-maps.com/` URLs now load the map surface; explicit `?view=feed` continues to work as a deep-link.

This resolves analysis stakeholder decision S4 (home route).

```ts
const DEFAULTS: UrlState = {
  speciesCode: null,
  familyCode: null,
  since: '14d',
  notable: false,
  view: 'map',           // was 'feed'
  detail: null,
};
```

The existing `writeUrl` logic at line 81 continues to work unchanged — when `state.view === DEFAULTS.view` and no `?species=` / `?detail=` is set, the `view` param is omitted from the URL. With map as the default, **the cleanest URL** (`bird-maps.com/`) renders the map.

## Change 2: `pushState` for detail-surface entry

Adds a `push?: boolean` parameter to `writeUrl`; the consumer in `useUrlState.set` passes `push: true` only when transitioning *into* the detail surface (or between two species details). All other writes — filter changes, surface switches, leaving detail — keep using `replaceState`.

This resolves analysis Theme 2 finding 2.4 — browser back from a detail surface returns to the previously-active surface (`feed` / `map` / `species`) rather than exiting the app.

### When `push: true` fires

```ts
const push =
  // Entering detail from a non-detail surface
  (next.view === 'detail' && prev.view !== 'detail') ||
  // Switching between two species on the detail surface
  (next.view === 'detail' && prev.view === 'detail' && next.detail !== prev.detail);
```

Two cases. Everything else stays `replaceState`:

- Filter changes (`since`, `notable`, `family`, `species`) → `replaceState`
- Surface switch between `feed`, `map`, `species` → `replaceState`
- Leaving detail (any next.view !== 'detail') → `replaceState`

### History stack growth

Each entry into detail (or species-switch on detail) pushes one history entry. A user who opens 10 species details and presses back 10 times traverses all of them before exiting the site. This is expected browser behavior; document it in the spec but don't try to suppress it.

### Consumer-side change

```ts
const set = useCallback((partial: Partial<UrlState>) => {
  setState(prev => {
    const next = { ...prev, ...partial };
    const push =
      (next.view === 'detail' && prev.view !== 'detail') ||
      (next.view === 'detail' && prev.view === 'detail' && next.detail !== prev.detail);
    writeUrl(next, push);
    return next;
  });
}, []);
```

`writeUrl(state, push)` either calls `pushState` or `replaceState` based on the flag.

## URL parameter contract — preserved

The redesign does NOT change the URL parameter shape. All existing query params behave identically:

- `?view=feed|map|species|detail` — surface
- `?since=1d|7d|14d|30d` — time window (default `14d` omitted from URL)
- `?notable=true` — notable filter (false omitted)
- `?species=<code>` — species filter
- `?family=<code>` — family filter
- `?detail=<code>` — detail surface species code
- `?view=hotspots` → silent redirect to `?view=map` (compatibility shim, preserved)

Existing bookmarks all continue to work. The only behavioral change for bookmarked URLs:

- `bird-maps.com/` now loads `view=map` instead of `view=feed`
- Bookmark `bird-maps.com/?view=feed` still works as a deep-link

## What this does NOT change

- The `popstate` listener at `url-state.ts:97–101` is unchanged. It already uses `readUrl()` to refresh state on `popstate`; with `pushState` now in play, that listener fires meaningfully on browser back from detail.
- The view-resolution logic in `readUrl` at lines 41–59 is unchanged. The sniff rules (`?species=` → `view=species`, `?detail=` → `view=detail`) preserve.
- The `?view=hotspots` redirect at lines 42–50 is unchanged.
- The `writeUrl` default-omit behavior at line 81–83 is unchanged. With `DEFAULTS.view = 'map'` flipped, the omit condition automatically picks up — no separate code path.

## Existing test impact

Several tests in `frontend/src/state/url-state.test.ts` hardcode `view: 'feed'` as the default. These get updated as part of Phase 0:

- `'returns defaults when URL is empty'` — assert `view: 'map'`
- `'default state has view: feed and no regionId property'` — rename + assert `view: 'map'`
- `'never serialises the default view to the URL'` — invert the test (set `view: 'map'`, assert no `view=` in URL)
- `'round-trips all three view values'` — invert which value is the default-omitted one

Plus 6 new tests for `pushState` semantics:

1. Detail entry uses `pushState` (`history.length` grows by 1)
2. Leaving detail uses `replaceState` (`history.length` does not grow)
3. Filter changes use `replaceState`
4. Surface switch (feed→map) uses `replaceState`
5. Browser back from detail returns to the prior URL
6. Detail → detail (different species) uses `pushState`

Phase 0 plan covers all of these: [`docs/plans/2026-05-09-sky-atlas-phase-0-pre-redesign.md`](../../plans/2026-05-09-sky-atlas-phase-0-pre-redesign.md).

## Phase that ships this

[Phase 0](../02-phases/phase-0-pre-redesign.md). Independent of the visual redesign — ships as a separate code-only PR before any v3 component work.

## Cross-references

- Phase 0 plan (Tasks 1 & 2): `docs/plans/2026-05-09-sky-atlas-phase-0-pre-redesign.md`
- Architecture surface system: [`architecture.md`](./architecture.md)
- Analysis report Theme 2 finding 2.4 (broken browser back): [`../03-research/analysis-funnel-summary.md`](../03-research/analysis-funnel-summary.md)
