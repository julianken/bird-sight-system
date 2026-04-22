# Manual E2E Test Guide

Step-by-step instructions for a Claude agent to execute the E2E test suite manually
using the Playwright MCP tools. Each flow maps 1:1 to a `happy-path.spec.ts` assertion.

> **Readiness gate:** The `<main id="main-surface">` element flips
> `data-render-complete="true"` once `useBirdData` finishes its initial load.
> All flows that require data must wait for this attribute before asserting.

> **Page Object Model:** Shared selectors live in `frontend/e2e/pages/*.ts`:
> `AppPage` (`goto`, `waitForAppReady`, `getUrlParams`) and `FiltersBar`
> (`toggleNotable`, `selectTimeWindow`, etc.). New specs must use the POM.

---

## Prerequisites

Both servers must be running before starting:

```
# Terminal 1 — read-api on port 8787
DATABASE_URL=postgres://birdwatch:birdwatch@localhost:5433/birdwatch npm run dev --workspace @bird-watch/read-api

# Terminal 2 — Vite dev server on port 5173
npm run dev --workspace @bird-watch/frontend
```

Confirm the API: navigate to `http://localhost:8787/api/observations` — a JSON
array must be returned.
Confirm the frontend: navigate to `http://localhost:5173` — the page loads and
`<main data-render-complete="true">` appears within a few seconds.

---

## Flow 1 — Feed surface loads by default

**What the automated test asserts:** at least one `.feed-row` is visible;
the Feed tab has `aria-selected="true"`.

### Steps

1. Navigate to the app:
   - Tool: `browser_navigate` → `http://localhost:5173`

2. Wait for render completion:
   - Tool: `browser_evaluate`
   - Script: `document.querySelector('main[data-render-complete="true"]') !== null`
   - **Pass:** `true` (retry up to ~10 s)

3. Verify at least one feed row is visible:
   - Tool: `browser_evaluate`
   - Script: `document.querySelectorAll('.feed-row').length`
   - **Pass:** result ≥ 1

4. Verify the Feed tab is selected:
   - Tool: `browser_evaluate`
   - Script: `document.querySelector('[role="tab"][aria-label="Feed view"]')?.getAttribute('aria-selected')`
   - **Pass:** `"true"`

5. Take a screenshot at desktop (1440×900) and mobile (390×844).

---

## Flow 2 — Notable-only filter narrows feed and updates URL

**What the automated test asserts:** after toggling "Notable only", the URL
gains `notable=true` and the row count decreases (or stays equal if all seeded
observations are notable).

### Steps

1. Navigate to `http://localhost:5173` and wait for render completion.

2. Count baseline feed rows:
   - Tool: `browser_evaluate` → `document.querySelectorAll('.feed-row').length`

3. Click the Notable only checkbox:
   - Tool: `browser_click` → `input[aria-label="Notable only"]`

4. Verify URL updated:
   - Tool: `browser_evaluate` → `window.location.href`
   - **Pass:** URL contains `notable=true`

5. Wait for re-render:
   - Tool: `browser_evaluate`
   - Script: `document.querySelector('main[data-render-complete="true"]') !== null`

6. Count rows after filter:
   - Tool: `browser_evaluate` → `document.querySelectorAll('.feed-row').length`
   - **Pass:** count ≤ baseline count

---

## Flow 3 — Species deep link cold-loads to search surface with panel open

**What the automated test asserts:** navigating to `?species=<code>` without
an explicit `?view=` lands on the Species tab and opens the SpeciesPanel.

### Steps

1. Navigate with a species code (use any code seeded in `species_meta`; e.g. `vermfly`):
   - Tool: `browser_navigate` → `http://localhost:5173?species=vermfly`

2. Wait for render completion.

3. Verify the Species tab is selected:
   - Tool: `browser_evaluate`
   - Script: `document.querySelector('[role="tab"][aria-label="Species view"]')?.getAttribute('aria-selected')`
   - **Pass:** `"true"`

4. Verify the SpeciesPanel (`<aside role="complementary">`) is visible:
   - Tool: `browser_evaluate`
   - Script: `document.querySelector('aside[role="complementary"]') !== null`
   - **Pass:** `true`

5. Verify `?species=vermfly` is still in the URL (mount effect must not strip it):
   - Tool: `browser_evaluate` → `new URLSearchParams(window.location.search).get('species')`
   - **Pass:** `"vermfly"`

---

## Flow 4 — SpeciesPanel opens as drawer on mobile; tap overlay dismisses

**What the automated test asserts:** at 390×844, the panel has
`data-layout="drawer"` and a `.species-panel-overlay` sibling; clicking the
overlay dismisses the panel and strips `?species=` from the URL.

### Steps

1. Resize viewport to 390×844:
   - Tool: `browser_resize` → `{ width: 390, height: 844 }`

2. Navigate to `http://localhost:5173?species=vermfly` and wait for render completion.

3. Verify the panel has `data-layout="drawer"`:
   - Tool: `browser_evaluate`
   - Script: `document.querySelector('aside[role="complementary"]')?.getAttribute('data-layout')`
   - **Pass:** `"drawer"`

4. Verify the overlay is present:
   - Tool: `browser_evaluate`
   - Script: `document.querySelector('.species-panel-overlay') !== null`
   - **Pass:** `true`

5. Click the overlay to dismiss:
   - Tool: `browser_click` → `.species-panel-overlay`

6. Verify the panel is gone:
   - Tool: `browser_evaluate`
   - Script: `document.querySelector('aside[role="complementary"]') === null || getComputedStyle(document.querySelector('aside[role="complementary"]')).display === 'none'`
   - **Pass:** `true`

7. Verify `?species=` was stripped from the URL:
   - Tool: `browser_evaluate` → `new URLSearchParams(window.location.search).get('species')`
   - **Pass:** `null`

---

## Flow 5 — SpeciesPanel opens as sidebar on desktop; ESC dismisses

**What the automated test asserts:** at 1440×900, the panel has
`data-layout="sidebar"` (no overlay); pressing ESC dismisses and strips
`?species=`.

### Steps

1. Resize viewport to 1440×900:
   - Tool: `browser_resize` → `{ width: 1440, height: 900 }`

2. Navigate to `http://localhost:5173?species=vermfly` and wait for render completion.

3. Verify `data-layout="sidebar"`:
   - Tool: `browser_evaluate`
   - Script: `document.querySelector('aside[role="complementary"]')?.getAttribute('data-layout')`
   - **Pass:** `"sidebar"`

4. Verify no overlay is present:
   - Tool: `browser_evaluate`
   - Script: `document.querySelectorAll('.species-panel-overlay').length`
   - **Pass:** `0`

5. Press ESC to dismiss:
   - Tool: `browser_press_key` → `Escape`

6. Verify the panel is gone and `?species=` stripped (same checks as Flow 4, Steps 6–7).

---

## Additional flows (supplementary, not covered by automated specs)

### Flow 6 — Time window filter changes URL param

1. Navigate to `http://localhost:5173` and wait for render completion.
2. Change the Time window select to "Today":
   - Tool: `browser_select_option` → `select[aria-label="Time window"]`, value `1d`
3. Verify URL contains `since=1d`.
4. Change back to "14 days" (the default):
   - Tool: `browser_select_option` → value `14d`
5. Verify `since` param is absent from URL (default is omitted).

### Flow 7 — Error screen renders when API is unreachable

1. Stop the read-api server, then navigate to `http://localhost:5173`.
2. Wait a few seconds and check:
   - Tool: `browser_evaluate`
   - Script: `document.querySelector('.error-screen h2')?.textContent`
   - **Pass:** `"Couldn't load bird data"`

---

## Reporting results

After completing all flows, summarise findings:

```
Flow 1 — Feed surface default load:           PASS / FAIL
Flow 2 — Notable filter narrows + URL:        PASS / FAIL
Flow 3 — Species deep link → search surface:  PASS / FAIL
Flow 4 — Mobile drawer + overlay dismiss:     PASS / FAIL
Flow 5 — Desktop sidebar + ESC dismiss:       PASS / FAIL
Flow 6 — Time window param (optional):        PASS / FAIL
Flow 7 — Error screen (optional):             PASS / FAIL
```

Any FAIL should include the evaluate script result and a screenshot.
