# Sky Atlas — Phase 0 Pre-Redesign Engineering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land four pre-redesign engineering changes that resolve the analysis report's structural defects so the Sky Atlas visual redesign can ship on top of a sound foundation: switch the home route to map, fix browser-back for the detail surface (`pushState`), add a global `prefers-reduced-motion` policy, and guard MapLibre camera animations against motion-leak.

**Architecture:** All four changes are frontend-only and orthogonal to each other. The `pushState` change adds one parameter to `writeUrl()` and one branch in the consumer; `DEFAULTS.view='map'` is a one-line change with cascading test updates; `motion.css` is one new file imported once in `main.tsx`; the MapLibre guard is two lines in `MapCanvas.tsx`. Single PR, 4 commits, no migrations, no API contract changes.

**Tech Stack:** TypeScript, React 18, Vitest 4, `@testing-library/react`, MapLibre GL 5. Builds with Vite 8. No new dependencies.

---

## Spec reference

This plan implements Phase 0 of the Sky Atlas redesign (see `docs/design/01-spec/url-state.md`, `docs/design/01-spec/motion.md`, `docs/design/02-phases/phase-0-pre-redesign.md`). The phase doc's acceptance criteria for Phase 0:

- Browser back works from detail → previous surface
- `DEFAULTS.view === 'map'` (URLs without `?view=` load the map)
- Reduced-motion users see no transitions or camera animations
- All existing tests pass (after default-view assertion updates)

This plan is independent of Phases 1–6 (token foundation, primitives, surface redesigns, metadata). Nothing here changes visual styling.

## File structure

| File | Disposition | Responsibility |
|---|---|---|
| `frontend/src/state/url-state.ts` | Modify | Add `push?: boolean` parameter to `writeUrl()`; switch `DEFAULTS.view` to `'map'`; thread `push: true` from `set()` when transitioning to detail. |
| `frontend/src/state/url-state.test.ts` | Modify | Update existing default-view assertions from `'feed'` to `'map'`. Add tests for `pushState` vs `replaceState` semantics. |
| `frontend/src/styles/motion.css` | Create | Global `@media (prefers-reduced-motion: reduce)` rule collapsing all transitions and animations to 0ms. |
| `frontend/src/main.tsx` | Modify | Import `./styles/motion.css` once at app entry, after `./styles.css`. |
| `frontend/src/components/map/MapCanvas.tsx` | Modify | Read `matchMedia('(prefers-reduced-motion: reduce)').matches` once at mount; pass `duration: 0` to `easeTo()` when set. |
| `frontend/src/components/map/MapCanvas.test.tsx` | Modify | Add test asserting `easeTo` receives `duration: 0` under reduced-motion. |

---

## Task 1: Switch `DEFAULTS.view` from `'feed'` to `'map'`

Resolves analysis report stakeholder decision S4 (home route). One source line change; the rest of the work is updating the existing url-state test suite to match the new default.

**Files:**
- Modify: `frontend/src/state/url-state.ts:15-22`
- Modify: `frontend/src/state/url-state.test.ts` (multiple assertion updates)

- [ ] **Step 1: Update existing tests in `url-state.test.ts` that hardcode the old `'feed'` default to expect `'map'` — write them as failing first.**

There are three existing tests that bake in `view: 'feed'` as the default. Update them to expect `'map'`. The changes:

In `frontend/src/state/url-state.test.ts`, find and replace:

```typescript
  it('returns defaults when URL is empty', () => {
    const { result } = renderHook(() => useUrlState());
    expect(result.current.state).toEqual({
      since: '14d', notable: false,
      speciesCode: null, familyCode: null,
      view: 'feed',
      detail: null,
    });
  });
```

with:

```typescript
  it('returns defaults when URL is empty', () => {
    const { result } = renderHook(() => useUrlState());
    expect(result.current.state).toEqual({
      since: '14d', notable: false,
      speciesCode: null, familyCode: null,
      view: 'map',
      detail: null,
    });
  });
```

Then find:

```typescript
  it('default state has view: feed and no regionId property', () => {
    const { result } = renderHook(() => useUrlState());
    expect(result.current.state.view).toBe('feed');
    expect(result.current.state).not.toHaveProperty('regionId');
  });
```

and replace with:

```typescript
  it('default state has view: map and no regionId property', () => {
    const { result } = renderHook(() => useUrlState());
    expect(result.current.state.view).toBe('map');
    expect(result.current.state).not.toHaveProperty('regionId');
  });
```

Also find the test at lines 88–93:

```typescript
  it('never serialises the default view to the URL', () => {
    window.history.replaceState({}, '', '/?view=map');
    const { result } = renderHook(() => useUrlState());
    act(() => result.current.set({ view: 'feed' }));
    expect(window.location.search).not.toContain('view=');
  });
```

This test name and body are now inverted — the new default is `map`, so setting `view: 'map'` should produce no `view=` in the URL, and setting `view: 'feed'` should produce `view=feed`. Replace with:

```typescript
  it('never serialises the default view (map) to the URL', () => {
    window.history.replaceState({}, '', '/?view=feed');
    const { result } = renderHook(() => useUrlState());
    act(() => result.current.set({ view: 'map' }));
    expect(window.location.search).not.toContain('view=');
  });
```

Also find the round-trip test at lines 95–108:

```typescript
  it('round-trips all three view values', () => {
    const { result } = renderHook(() => useUrlState());
    act(() => result.current.set({ view: 'species' }));
    expect(result.current.state.view).toBe('species');
    expect(window.location.search).toContain('view=species');

    act(() => result.current.set({ view: 'map' }));
    expect(result.current.state.view).toBe('map');
    expect(window.location.search).toContain('view=map');

    act(() => result.current.set({ view: 'feed' }));
    expect(result.current.state.view).toBe('feed');
    expect(window.location.search).not.toContain('view=');
  });
```

Replace with (default flips, so feed becomes the explicitly-emitted one and map becomes the omitted one):

```typescript
  it('round-trips all three view values', () => {
    const { result } = renderHook(() => useUrlState());
    act(() => result.current.set({ view: 'species' }));
    expect(result.current.state.view).toBe('species');
    expect(window.location.search).toContain('view=species');

    act(() => result.current.set({ view: 'feed' }));
    expect(result.current.state.view).toBe('feed');
    expect(window.location.search).toContain('view=feed');

    act(() => result.current.set({ view: 'map' }));
    expect(result.current.state.view).toBe('map');
    expect(window.location.search).not.toContain('view=');
  });
```

Also add one new test that pins the new behavior explicitly. Add immediately after the `default state` test (around line 147):

```typescript
  it('bare URL (/) lands on map (post-Sky-Atlas Phase 0)', () => {
    window.history.replaceState({}, '', '/');
    const { result } = renderHook(() => useUrlState());
    expect(result.current.state.view).toBe('map');
    expect(window.location.search).toBe('');
  });

  it('explicit ?view=feed still works for shared/bookmarked feed URLs', () => {
    window.history.replaceState({}, '', '/?view=feed');
    const { result } = renderHook(() => useUrlState());
    expect(result.current.state.view).toBe('feed');
  });
```

- [ ] **Step 2: Run tests to verify all four updated/new tests fail.**

Run: `npm run test --workspace @bird-watch/frontend -- url-state.test.ts`

Expected: 4+ failures with messages like `expected 'feed' to be 'map'`. Specifically:
- `returns defaults when URL is empty` — fails on `view: 'feed'` vs `view: 'map'`
- `default state has view: map …` — fails on view value
- `never serialises the default view …` — fails because `view=feed` ends up in URL
- `round-trips all three view values` — fails on assertion sequence
- `bare URL (/) lands on map …` — new test, fails because `result.current.state.view === 'feed'`

The `explicit ?view=feed still works …` test should pass even before the implementation change because the URL has an explicit value — confirms the implementation change doesn't break the bookmark path.

- [ ] **Step 3: Change `DEFAULTS.view` to `'map'`.**

In `frontend/src/state/url-state.ts:15–22`, replace:

```typescript
const DEFAULTS: UrlState = {
  speciesCode: null,
  familyCode: null,
  since: '14d',
  notable: false,
  view: 'feed',
  detail: null,
};
```

with:

```typescript
const DEFAULTS: UrlState = {
  speciesCode: null,
  familyCode: null,
  since: '14d',
  notable: false,
  view: 'map',
  detail: null,
};
```

- [ ] **Step 4: Run tests to verify all pass.**

Run: `npm run test --workspace @bird-watch/frontend -- url-state.test.ts`

Expected: all tests in `url-state.test.ts` pass, including the previously-failing four and the two new ones. No other test file should fail from this change (the old default was a constant; nothing else hardcoded it).

- [ ] **Step 5: Run the full frontend test suite to catch any other tests that hardcoded the old default.**

Run: `npm run test --workspace @bird-watch/frontend`

Expected: all tests pass. If any test outside `url-state.test.ts` fails because it asserted `view: 'feed'` as the default, update it the same way. Do not skip a failure.

- [ ] **Step 6: Commit.**

```bash
git add frontend/src/state/url-state.ts frontend/src/state/url-state.test.ts
git commit -m "$(cat <<'EOF'
feat(state): switch DEFAULTS.view from feed to map (Sky Atlas S4)

Resolves the home-route stakeholder decision (S4) from the redesign
analysis. Bare bird-maps.com/ URLs now load the map surface; ?view=feed
remains a valid bookmark path.

Spec: docs/design/01-spec/url-state.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Add `pushState` for detail-surface navigation

Resolves analysis Theme 2 finding 2.4. Adds a `push?: boolean` parameter to `writeUrl()` (default `false` = current `replaceState` behavior). The hook's `set()` decides when to push: only on transitions where the next view is `'detail'` AND the previous view was not `'detail'`. All other writes (filter changes, tab switches between feed/species/map, leaving detail) keep using `replaceState`.

**Files:**
- Modify: `frontend/src/state/url-state.ts:71–112`
- Modify: `frontend/src/state/url-state.test.ts`

- [ ] **Step 1: Add new failing tests for `pushState` semantics.**

Append these tests to `frontend/src/state/url-state.test.ts` after the existing tests (before the closing `});` of the outermost `describe`):

```typescript
  // --- Phase 0: pushState for detail-surface navigation ---

  describe('pushState semantics for detail navigation', () => {
    it('navigating to detail uses pushState (history grows by 1)', () => {
      window.history.replaceState({}, '', '/');
      const startLen = window.history.length;
      const { result } = renderHook(() => useUrlState());

      act(() => result.current.set({ view: 'detail', detail: 'vermfly' }));

      expect(window.history.length).toBe(startLen + 1);
      expect(window.location.search).toContain('detail=vermfly');
      expect(window.location.search).toContain('view=detail');
    });

    it('navigating away FROM detail uses replaceState (history does not grow)', () => {
      window.history.replaceState({}, '', '/?detail=vermfly&view=detail');
      const { result } = renderHook(() => useUrlState());
      const startLen = window.history.length;

      act(() => result.current.set({ view: 'feed', detail: null }));

      expect(window.history.length).toBe(startLen);
      expect(window.location.search).toContain('view=feed');
      expect(window.location.search).not.toContain('detail=');
    });

    it('filter changes use replaceState (history does not grow)', () => {
      window.history.replaceState({}, '', '/');
      const { result } = renderHook(() => useUrlState());
      const startLen = window.history.length;

      act(() => result.current.set({ since: '7d' }));
      act(() => result.current.set({ notable: true }));

      expect(window.history.length).toBe(startLen);
    });

    it('surface switch (feed → map) uses replaceState (history does not grow)', () => {
      window.history.replaceState({}, '', '/?view=feed');
      const { result } = renderHook(() => useUrlState());
      const startLen = window.history.length;

      act(() => result.current.set({ view: 'map' }));

      expect(window.history.length).toBe(startLen);
    });

    it('opening detail from a non-default surface preserves the prior URL in history', () => {
      window.history.replaceState({}, '', '/?view=feed&since=7d');
      const { result } = renderHook(() => useUrlState());

      act(() => result.current.set({ view: 'detail', detail: 'gilwoo' }));

      // Walk history: simulate browser-back
      window.history.back();
      // Wait for popstate to fire (it's synchronous in jsdom)
      // Note: popstate is dispatched but the listener uses readUrl which
      // reads window.location, so we need to assert on location, not state.
      expect(window.location.search).toContain('view=feed');
      expect(window.location.search).toContain('since=7d');
      expect(window.location.search).not.toContain('detail=');
    });

    it('detail → detail navigation (different species) uses pushState (history grows)', () => {
      window.history.replaceState({}, '', '/?detail=vermfly&view=detail');
      const { result } = renderHook(() => useUrlState());
      const startLen = window.history.length;

      act(() => result.current.set({ detail: 'gilwoo' }));

      // Already on detail, only changing species code: still pushState
      // because each species detail is a distinct user-meaningful navigation
      // step (matches Wikipedia article-to-article navigation).
      expect(window.history.length).toBe(startLen + 1);
      expect(window.location.search).toContain('detail=gilwoo');
    });
  });
```

- [ ] **Step 2: Run tests to verify the new tests fail.**

Run: `npm run test --workspace @bird-watch/frontend -- url-state.test.ts`

Expected: all 6 new tests fail. The first four fail because `writeUrl` only calls `replaceState`; `window.history.length` never grows. The fifth fails for the same reason — back-button has nothing to navigate to. The sixth fails for the same reason.

- [ ] **Step 3: Implement `push?: boolean` parameter on `writeUrl`.**

In `frontend/src/state/url-state.ts`, replace lines 71–89 (the entire `writeUrl` function):

```typescript
function writeUrl(state: UrlState, push: boolean = false): void {
  const p = new URLSearchParams();
  if (state.speciesCode) p.set('species', state.speciesCode);
  if (state.familyCode) p.set('family', state.familyCode);
  if (state.since !== DEFAULTS.since) p.set('since', state.since);
  if (state.notable) p.set('notable', 'true');
  if (state.detail) p.set('detail', state.detail);
  // Emit ?view= when non-default, OR when ?species= or ?detail= is set and
  // view is the default — otherwise the sniff in readUrl silently reverts the
  // user's explicit default-view choice back to 'species'/'detail' on
  // reload/popstate.
  if (state.view !== DEFAULTS.view || state.speciesCode || state.detail) {
    p.set('view', state.view);
  }
  const q = p.toString();
  const newUrl = q ? `${window.location.pathname}?${q}` : window.location.pathname;
  if (newUrl !== window.location.pathname + window.location.search) {
    if (push) {
      // Detail-surface entry: push so browser-back returns to the prior
      // surface. All other navigations replace (filter changes, tab switches,
      // leaving detail).
      window.history.pushState({}, '', newUrl);
    } else {
      window.history.replaceState({}, '', newUrl);
    }
  }
}
```

Also update the consumer at `useUrlState` to compute `push` based on the next state. Replace lines 91–112 of the original file:

```typescript
export function useUrlState(): {
  state: UrlState;
  set: (partial: Partial<UrlState>) => void;
} {
  const [state, setState] = useState<UrlState>(readUrl);

  useEffect(() => {
    const onPop = () => setState(readUrl());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const set = useCallback((partial: Partial<UrlState>) => {
    setState(prev => {
      const next = { ...prev, ...partial };
      // Push (vs replace) when the user is navigating INTO the detail
      // surface, OR navigating between two different species details.
      // Both cases are user-meaningful "I clicked into a thing" moves
      // that the browser back button should undo. Filter changes and
      // surface switches (feed/species/map) keep replaceState so the
      // history stack doesn't grow on every chip toggle.
      const push =
        // Entering detail from a non-detail surface
        (next.view === 'detail' && prev.view !== 'detail') ||
        // Switching between two species on the detail surface
        (next.view === 'detail' && prev.view === 'detail' && next.detail !== prev.detail);
      writeUrl(next, push);
      return next;
    });
  }, []);

  return { state, set };
}
```

- [ ] **Step 4: Run url-state tests to verify they pass.**

Run: `npm run test --workspace @bird-watch/frontend -- url-state.test.ts`

Expected: all tests pass, including the 6 new pushState tests.

- [ ] **Step 5: Run the full frontend test suite (no regressions).**

Run: `npm run test --workspace @bird-watch/frontend`

Expected: all tests pass. The pushState change is a strict superset of the prior behavior; nothing that previously worked should fail.

- [ ] **Step 6: Commit.**

```bash
git add frontend/src/state/url-state.ts frontend/src/state/url-state.test.ts
git commit -m "$(cat <<'EOF'
fix(state): pushState on detail-surface entry (Sky Atlas Phase 0)

Adds a `push?: boolean` parameter to writeUrl(); useUrlState passes
push: true when the next view is 'detail' (entering or species-switching).
All other writes (filter changes, surface switches, leaving detail)
keep using replaceState. Resolves analysis Theme 2 finding 2.4 — browser
back now returns to the prior surface from a detail view.

Spec: docs/design/01-spec/url-state.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Global `motion.css` rule for `prefers-reduced-motion`

Resolves analysis Theme 5 finding 5.6 (zero `prefers-reduced-motion` queries today). Single global rule collapses all CSS transitions and animations to 0ms when the user has expressed a reduced-motion preference. Becomes the single source of truth — no per-component reduced-motion queries thereafter (with one exception: MapLibre, see Task 4).

**Files:**
- Create: `frontend/src/styles/motion.css`
- Modify: `frontend/src/main.tsx:8-9`

- [ ] **Step 1: Create the new file.**

Create `frontend/src/styles/motion.css`:

```css
/*
 * Global reduced-motion policy.
 *
 * When the user has expressed a reduced-motion preference (system
 * accessibility setting), collapse all CSS transitions and animations
 * to 0ms. This is the single source of truth for reduced-motion in
 * the application — components MUST NOT add their own
 * `prefers-reduced-motion` queries unless they need a per-element
 * override (e.g., suppressing a transform entirely rather than just
 * its interpolation).
 *
 * One exception: MapLibre camera animations are JavaScript-driven
 * (map.easeTo / map.flyTo) and are not under the CSS cascade. They
 * are guarded separately in MapCanvas.tsx by reading
 * matchMedia('(prefers-reduced-motion: reduce)').matches.
 *
 * Per spec:
 *   docs/design/01-spec/motion.md (Motion policy)
 */
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

- [ ] **Step 2: Import the new file from `main.tsx`.**

In `frontend/src/main.tsx`, replace lines 8–9:

```typescript
import './analytics.js';
import './styles.css';
```

with:

```typescript
import './analytics.js';
import './styles.css';
import './styles/motion.css';
```

The order matters: `motion.css` must be imported AFTER `styles.css` so its `!important` rules override any transition durations declared in component CSS rules above.

- [ ] **Step 3: Run the full test suite.**

Run: `npm run test --workspace @bird-watch/frontend`

Expected: all tests pass. There are no behavioral assertions tied to motion.css; jsdom does not honor `@media` queries in unit tests, so this file has no test-suite impact.

- [ ] **Step 4: Run the build to confirm Vite picks up the new CSS file.**

Run: `npm run build --workspace @bird-watch/frontend`

Expected: build succeeds; `motion.css` content appears in the built CSS bundle (Vite concatenates imported CSS). Inspect the dist if curious: `grep -c "prefers-reduced-motion" frontend/dist/assets/index-*.css` should return at least 1.

- [ ] **Step 5: Manual verification — load the site under reduced-motion.**

Run: `npm run dev --workspace @bird-watch/frontend` (in a separate terminal).

In Chrome DevTools:
1. Open DevTools → Cmd-Shift-P → "Show Rendering"
2. Find the "Emulate CSS media feature prefers-reduced-motion" dropdown
3. Set to "reduce"
4. Reload the dev server URL
5. In Elements panel, inspect any element with a known transition (e.g., a hover state on a button); confirm the computed `transition-duration` is `0s`

This is a smoke test, not a CI assertion — jsdom can't run it. Cleared once visually confirmed.

- [ ] **Step 6: Commit.**

```bash
git add frontend/src/styles/motion.css frontend/src/main.tsx
git commit -m "$(cat <<'EOF'
feat(styles): global motion.css for prefers-reduced-motion (Sky Atlas Phase 0)

Adds a single global CSS rule that collapses all transitions and
animations to 0ms under prefers-reduced-motion: reduce. Becomes the
single source of truth — no per-component reduced-motion queries
required thereafter (MapLibre being the one JS-side exception, guarded
separately).

Resolves analysis Theme 5 finding 5.6 (zero prefers-reduced-motion
queries today).

Spec: docs/design/01-spec/motion.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: MapLibre `easeTo` reduced-motion guard

Resolves analysis Theme 5 finding 5.6 (suspected MapLibre motion-leak at `MapCanvas.tsx:729`). MapLibre camera animations are JavaScript-driven and not under the CSS cascade, so the global `motion.css` rule from Task 3 doesn't reach them. Read the preference once at component mount; pass `duration: 0` to `easeTo` when set.

**Files:**
- Modify: `frontend/src/components/map/MapCanvas.tsx`
- Modify: `frontend/src/components/map/MapCanvas.test.tsx`

- [ ] **Step 1: Add a failing test for the reduced-motion guard.**

Read the existing test setup in `frontend/src/components/map/MapCanvas.test.tsx` to find the cluster-click test that asserts `easeTo` is called (around line 569: `'mosaic click at zoom < CLUSTER_MAX_ZOOM calls easeTo …'`). The existing setup already has `easeTo: vi.fn()` on the fake map (line 111).

Add a new test immediately after that existing test. The test sets `matchMedia('(prefers-reduced-motion: reduce)')` to return `true` (using the existing `setMatchMedia` helper from `test-setup.ts`), simulates a cluster click, and asserts `easeTo` was called with `duration: 0`.

If `setMatchMedia` is not exported from `test-setup.ts` or is named differently, locate the test-side matchMedia control by reading `frontend/src/test-setup.ts` (already read in plan preparation — the file exports a controlled mock with a `resetMatchMedia` helper). The exact API shape may differ; in that case, use `window.matchMedia = vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })` directly within the test before rendering.

Add this test:

```typescript
  it('mosaic click under prefers-reduced-motion calls easeTo with duration: 0', async () => {
    // Simulate a user with reduced-motion preference enabled
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query === '(prefers-reduced-motion: reduce)',
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    try {
      // Same setup as 'mosaic click at zoom < CLUSTER_MAX_ZOOM calls easeTo …'
      // (line ~569). Use the same fake map, observations array, and zoom value
      // so the only meaningful difference is the matchMedia override.

      const fakeMap = makeFakeMap({ getZoom: () => 12 });
      const obs = [makeObs({ subId: 's1', lng: -110, lat: 32 })];

      render(
        <MapCanvas
          observations={obs}
          silhouettes={null}
          familyCode={null}
          onFamilyToggle={vi.fn()}
          onSelectSpecies={vi.fn()}
          onViewportChange={vi.fn()}
          mapRef={{ current: fakeMap }}
        />
      );

      // Trigger a mosaic click — same as the existing test
      const marker = await screen.findByTestId(/mosaic-marker-/);
      await userEvent.click(marker);

      // Wait for the getClusterExpansionZoom promise to resolve
      await waitFor(() => {
        expect(fakeMap.easeTo).toHaveBeenCalled();
      });

      // The new contract: easeTo must include duration: 0 under reduced-motion
      expect(fakeMap.easeTo).toHaveBeenCalledWith(
        expect.objectContaining({ duration: 0 })
      );
    } finally {
      window.matchMedia = originalMatchMedia;
    }
  });
```

If `makeFakeMap` and `makeObs` are not the actual helper names in this test file, locate them by reading the existing tests at lines ~569–610 and use whatever helpers are already in scope. The test should mirror the structure of the existing `mosaic click at zoom < CLUSTER_MAX_ZOOM calls easeTo …` test exactly, with the matchMedia override added.

- [ ] **Step 2: Run the test to verify it fails.**

Run: `npm run test --workspace @bird-watch/frontend -- MapCanvas.test.tsx`

Expected: the new test fails. The current `MapCanvas.tsx:729` calls `map.easeTo({ center, zoom })` with no `duration` field, so the assertion `expect.objectContaining({ duration: 0 })` does not match.

- [ ] **Step 3: Add the reduced-motion check at component mount.**

In `frontend/src/components/map/MapCanvas.tsx`, find the component's hook section (near the top of the function body). Add a `useMemo` that captures the reduced-motion preference once at mount. Place it near the other top-level memoizations (look for the first `useMemo` or `useState` call in the component body):

```typescript
const prefersReducedMotion = useMemo(
  () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  []
);
```

The `useMemo` with an empty dep array reads the value once on mount and never re-checks. This is intentional: re-running on prefs change adds complexity for a low-value case (the user must reload to fully apply some other reduced-motion changes anyway).

If `useMemo` is not already imported from `react`, add it to the import at the top of the file. Look for the existing `react` import (likely `import { useCallback, useEffect, useState, ... } from 'react';`) and add `useMemo` to the list.

- [ ] **Step 4: Pass `duration: prefersReducedMotion ? 0 : undefined` to `easeTo`.**

In `frontend/src/components/map/MapCanvas.tsx:729-732`, replace:

```typescript
            map.easeTo({
              center,
              zoom: Math.min(targetZoom, CLUSTER_MAX_ZOOM),
            });
```

with:

```typescript
            map.easeTo({
              center,
              zoom: Math.min(targetZoom, CLUSTER_MAX_ZOOM),
              ...(prefersReducedMotion ? { duration: 0 } : {}),
            });
```

The spread-of-conditional-object pattern is used (rather than `duration: prefersReducedMotion ? 0 : undefined`) so that under non-reduced-motion the call shape is byte-identical to the prior behavior — preserving the existing test's assertion that `easeTo` was called with `{ center, zoom }` and nothing else.

Also: the `easeTo` call in `MapCanvas.tsx` is inside a `useCallback`. If `prefersReducedMotion` is captured in the closure, add it to that callback's dependency array — search for the surrounding `useCallback`. The existing dep array near line 740 is `[]` (empty); change it to `[prefersReducedMotion]`.

If `MapCanvas.tsx` has additional `easeTo` or `flyTo` calls beyond line 729, apply the same `...(prefersReducedMotion ? { duration: 0 } : {})` spread to each one. Run `grep -n 'easeTo\|flyTo' frontend/src/components/map/MapCanvas.tsx` to enumerate all call sites; the only known one at plan-write time is line 729, but the file may have grown.

- [ ] **Step 5: Run the test to verify it passes.**

Run: `npm run test --workspace @bird-watch/frontend -- MapCanvas.test.tsx`

Expected: the new reduced-motion test passes. All existing easeTo-related tests should also continue passing — the spread-of-empty-object adds nothing under non-reduced-motion, so non-reduced-motion easeTo calls remain shape-identical.

- [ ] **Step 6: Run the full frontend test suite.**

Run: `npm run test --workspace @bird-watch/frontend`

Expected: all tests pass.

- [ ] **Step 7: Commit.**

```bash
git add frontend/src/components/map/MapCanvas.tsx frontend/src/components/map/MapCanvas.test.tsx
git commit -m "$(cat <<'EOF'
fix(map): guard easeTo with prefers-reduced-motion (Sky Atlas Phase 0)

MapLibre camera animations are JS-driven and not under the CSS cascade,
so motion.css's global rule does not reach them. Read the preference
once at component mount; pass duration: 0 to easeTo when set, leaving
the call shape byte-identical otherwise.

Resolves analysis Theme 5 finding 5.6 (suspected motion-leak at
MapCanvas.tsx:729).

Spec: docs/design/01-spec/motion.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Run the full validation suite end-to-end

Before opening the PR, run the full local validation gate — same checks Mergify will require (test, lint, build, e2e).

**Files:** none modified.

- [ ] **Step 1: Run the full unit test suite from repo root.**

Run: `npm test`

Expected: all unit tests pass across all workspaces (frontend, services/read-api, services/ingestor, packages/db-client, packages/shared-types).

- [ ] **Step 2: Run the lint suite.**

Run: `npm run lint`

Expected: no errors. If any new ESLint rule fires on the changes (e.g., `prefer-const`, `react-hooks/exhaustive-deps`), fix in place — do not silence with `eslint-disable`.

- [ ] **Step 3: Run the frontend build.**

Run: `npm run build --workspace @bird-watch/frontend`

Expected: build succeeds. Vite emits the bundled `dist/`. The `motion.css` rule should appear in the bundled CSS (verify with `grep -c "prefers-reduced-motion" frontend/dist/assets/index-*.css` — expect ≥ 1).

- [ ] **Step 4: Run the e2e suite.**

Run: `npm run test:e2e --workspace @bird-watch/frontend`

Expected: all Playwright specs pass. Of particular interest:
- `axe.spec.ts` — no axe violations introduced
- The default-route assertions in any spec that loads `/` without `?view=` — these may need updating. If `frontend/e2e/*.spec.ts` has any `await page.goto('/')` followed by an assertion that the feed view is rendered, those specs need their landing-page assertions updated to expect the map view. Update them in place; commit as part of the same task.

- [ ] **Step 5: If e2e changes were needed, commit them as a separate commit.**

Only run this step if step 4 surfaced any e2e spec updates.

```bash
git add frontend/e2e/
git commit -m "$(cat <<'EOF'
test(e2e): update default-route assertions for map home (Sky Atlas Phase 0)

The bare URL ('/') now loads the map surface (DEFAULTS.view='map').
Update e2e specs that asserted feed rendering on '/' to assert map
rendering instead.

Spec: docs/design/01-spec/url-state.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Open the PR

Use the `creating-prs` skill (`.claude/skills/pr-workflow/SKILL.md` per project CLAUDE.md) for the full opening protocol.

**Files:** none modified.

- [ ] **Step 1: Push the branch.**

```bash
git push -u origin <branch-name>
```

(Branch name will be set by the implementer's superpowers:finishing-a-development-branch flow — typically `feat/sky-atlas-phase-0-pre-redesign`.)

- [ ] **Step 2: Open the PR using the project template.**

Per `frontend/CLAUDE.md` PR workflow rules, the PR body MUST follow `.github/PULL_REQUEST_TEMPLATE.md` verbatim — all 5 sections including Screenshots (which is `N/A — not UI` for this PR since none of the four changes are visible UI; Phase 0 is plumbing).

```bash
gh pr create --title "feat: Sky Atlas Phase 0 — pre-redesign engineering" --body "$(cat <<'EOF'
## Summary
- Switch DEFAULTS.view from 'feed' to 'map' (resolves analysis S4: home route).
- Add pushState for detail-surface navigation; preserve replaceState everywhere else (resolves analysis Theme 2 finding 2.4: browser back works from detail).
- Global motion.css rule for prefers-reduced-motion: reduce (resolves analysis Theme 5 finding 5.6).
- MapLibre easeTo guard for reduced-motion (closes the suspected motion-leak at MapCanvas.tsx:729).

## Test plan
- [x] All existing unit tests pass; default-view assertions updated.
- [x] 6 new url-state tests covering pushState semantics for detail entry, detail-to-detail, exit-from-detail, filter changes, surface switches.
- [x] 1 new MapCanvas test asserting easeTo receives duration: 0 under prefers-reduced-motion.
- [x] `npm run build` succeeds; motion.css present in bundled CSS.
- [x] `npm run test:e2e` passes; e2e default-route assertions updated for map home.
- [x] Manual smoke: DevTools "prefers-reduced-motion: reduce" emulation collapses all transitions to 0s.

## Screenshots
N/A — not UI. Phase 0 is plumbing for the Sky Atlas redesign; no visible UI surfaces change. Surface-level visual changes ship in Phases 3–6.

## Spec
docs/design/01-spec/motion.md + docs/design/01-spec/url-state.md (Motion policy + URL state pushState fix)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Dispatch the bot review.**

Per project CLAUDE.md PR workflow rules, bot review dispatches through the `julianken-bot` Agent subagent — never via `gh pr review` from the main session. Use the existing skill / agent dispatch convention from this repo. The bot review applies the 12-rule anti-slop rubric to the PR.

- [ ] **Step 4: After bot review approves and CI green (test, lint, build, e2e), post the Mergify queue comment.**

The comment body MUST be exactly `@Mergifyio queue` — no prose, no preamble, no explanation. Mergify uses literal-string match.

```bash
gh pr comment <PR-number> --body "@Mergifyio queue"
```

Per project CLAUDE.md PR workflow: NEVER use `gh pr merge` directly.

---

## Acceptance criteria

This plan is complete when ALL of the following are true (verifiable against the spec's Phase 0 acceptance criteria in §8):

- [x] Browser back works from a detail surface to the previously-active surface (verified by url-state.test.ts pushState tests).
- [x] `DEFAULTS.view === 'map'` (verified by url-state.test.ts default tests).
- [x] CSS-driven transitions and animations collapse to 0ms under `prefers-reduced-motion: reduce` (verified manually + present in bundled CSS).
- [x] MapLibre camera animations pass `duration: 0` under reduced-motion (verified by MapCanvas.test.tsx).
- [x] All existing tests pass (verified by `npm test` end-to-end).
- [x] PR opens with the standard 5-section body and CI green; Mergify queues it.

## What this plan deliberately does NOT include

To stay scoped per the spec's Phase 0 boundaries:

- No changes to `tokens.ts`, `styles.css`, or any visual styling. (Phase 1.)
- No new design-system primitives — `<StatusBlock>`, `<Photo>`, `<ClusterPill>`, `<FilterSentence>`, `<FamilySilhouette>` all ship in Phase 2.
- No surface-level redesign — the map, feed, species-search, and detail surfaces look identical post-Phase-0. (Phases 3–5.)
- No metadata, voice, or brand changes. (Phase 6.)
- No `[data-theme]` light/dark scaffold. (Phase 1.)
- No `frontend/src/config/` module. (Phase 1.)

If during implementation you find yourself touching any of those surfaces, stop and confirm — that work belongs in a later phase's plan, not here.
