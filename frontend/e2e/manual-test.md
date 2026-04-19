# Manual E2E Test Guide

Step-by-step instructions for a Claude agent to execute the E2E test suite manually
using the Playwright MCP tools. Each flow maps 1:1 to a `happy-path.spec.ts` assertion.

> **preview-build project:** A second Playwright project (`preview-build`) runs `vite build && vite preview` on port 4173 with `proxy: {}` explicitly set, catching the production routing gap where `/api` is on a different subdomain. Uses `test.fail()` until the baseUrl fix lands.

> **axe-core scans:** `npm run test:e2e --workspace @bird-watch/frontend -- axe.spec.ts` runs three WCAG 2/2.1 A/AA scans (initial load, region expanded, error screen) via @axe-core/playwright. Open a tagged follow-up issue for any rule you disable.

---

## Prerequisites

Before starting, both servers must be running. If they are not, ask the user to start them:

```
# Terminal 1 — read-api on port 8787
DATABASE_URL=postgres://birdwatch:birdwatch@localhost:5433/birdwatch npm run dev --workspace @bird-watch/read-api

# Terminal 2 — Vite dev server on port 5173
cd frontend && npm run dev
```

Verify the API is up by navigating to `http://localhost:8787/api/regions` and confirming
a JSON array is returned. Verify the frontend is up by navigating to `http://localhost:5173`
and confirming the page loads without a network error.

---

## Flow 1 — Initial page load renders all 9 regions

**What the automated test asserts:** `expect(regions).toHaveCount(9)`

### Steps

1. Navigate to the app:
   - Tool: `browser_navigate`
   - URL: `http://localhost:5173`

2. Take a snapshot to see the page structure:
   - Tool: `browser_snapshot`

3. Wait up to 15 seconds for the SVG map to finish loading, then verify exactly
   9 elements with a `data-region-id` attribute are present in the DOM:
   - Tool: `browser_evaluate`
   - Script: `document.querySelectorAll('[data-region-id]').length`
   - **Pass:** result is `9`
   - **Fail:** result is `0` (API unreachable or CORS error) or any number other than 9

4. Verify the map-wrap is no longer in a loading state:
   - Tool: `browser_evaluate`
   - Script: `document.querySelector('.map-wrap')?.getAttribute('aria-busy')`
   - **Pass:** result is `"false"` or `null`

---

## Flow 2 — Keyboard expand of the Santa Ritas region

**What the automated test asserts:** region receives focus → Enter key triggers expansion →
element gets `region-expanded` class → `transform` attribute is non-empty.

### Steps

1. Locate the Santa Ritas region shape and confirm it exists:
   - Tool: `browser_evaluate`
   - Script: `!!document.querySelector('.region-shape[aria-label="Sky Islands — Santa Ritas"]')`
   - **Pass:** `true`

2. Focus the element using its aria-label:
   - Tool: `browser_evaluate`
   - Script: `document.querySelector('.region-shape[aria-label="Sky Islands — Santa Ritas"]').focus()`

3. Press Enter to trigger keyboard activation:
   - Tool: `browser_press_key`
   - Key: `Enter`

4. Take a screenshot to visually confirm the region expanded on the canvas:
   - Tool: `browser_take_screenshot`

---

## Flow 3 — URL updates with region param after expansion

**What the automated test asserts:** `page.url()` contains `region=sky-islands-santa-ritas`

### Steps

1. Immediately after Flow 2 Step 3, read the current URL:
   - Tool: `browser_evaluate`
   - Script: `window.location.href`
   - **Pass:** URL contains `region=sky-islands-santa-ritas`
   - **Fail:** URL does not change (replaceState bug) or contains a different region id

---

## Flow 4 — Expanded region has `region-expanded` class and non-empty transform

**What the automated test asserts:** `toHaveClass(/region-expanded/)` and `transformAttr` is truthy

### Steps

1. Check the class list on the expanded region `<g>`:
   - Tool: `browser_evaluate`
   - Script: `document.querySelector('[data-region-id="sky-islands-santa-ritas"]')?.className`
   - **Pass:** returned string contains `region-expanded`

2. Check the transform attribute (set by `computeExpandTransform`):
   - Tool: `browser_evaluate`
   - Script: `document.querySelector('[data-region-id="sky-islands-santa-ritas"]')?.getAttribute('transform')`
   - **Pass:** result is a non-empty string such as `"translate(123.4, 56.7) scale(2.1)"`
   - **Fail:** result is `null` or `""` (region did not physically expand on the canvas)

---

## Flow 5 — "Notable only" checkbox updates URL

**What the automated test asserts:** checking the Notable only input appends `notable=true`
to the URL.

### Steps

1. Locate the Notable only checkbox and confirm it is currently unchecked:
   - Tool: `browser_evaluate`
   - Script: `document.querySelector('input[aria-label="Notable only"]')?.checked`
   - **Pass:** `false`

2. Click the checkbox to check it:
   - Tool: `browser_click`
   - Use the aria-label selector: `input[aria-label="Notable only"]`

3. Read the URL to confirm it updated:
   - Tool: `browser_evaluate`
   - Script: `window.location.href`
   - **Pass:** URL contains `notable=true`
   - **Fail:** URL unchanged (state is not being persisted)

4. Confirm the checkbox is now visually checked:
   - Tool: `browser_evaluate`
   - Script: `document.querySelector('input[aria-label="Notable only"]')?.checked`
   - **Pass:** `true`

---

## Flow 6 — Deep-link restore: reload recovers expanded region and filter state

**What the automated test asserts:** after `page.reload()`, the region is still expanded
and the Notable only checkbox is still checked — proving URL state is read on mount.

### Steps

1. Note the URL before reloading (should contain both `region=sky-islands-santa-ritas`
   and `notable=true` from previous flows):
   - Tool: `browser_evaluate`
   - Script: `window.location.search`

2. Navigate to the same URL (simulates a reload / deep link):
   - Tool: `browser_navigate`
   - URL: `http://localhost:5173` + the query string from Step 1
     (e.g. `http://localhost:5173?region=sky-islands-santa-ritas&notable=true`)

3. Wait for the map to finish loading (9 regions present, aria-busy false):
   - Tool: `browser_evaluate`
   - Script: `document.querySelectorAll('[data-region-id]').length`
   - **Pass:** `9` (wait and retry if still `0`)

4. Confirm the Santa Ritas region is expanded without any user interaction:
   - Tool: `browser_evaluate`
   - Script: `document.querySelector('[data-region-id="sky-islands-santa-ritas"]')?.className`
   - **Pass:** contains `region-expanded`
   - **Fail:** no `region-expanded` class (URL state is not being read on mount)

5. Confirm the Notable only checkbox is checked without any user interaction:
   - Tool: `browser_evaluate`
   - Script: `document.querySelector('input[aria-label="Notable only"]')?.checked`
   - **Pass:** `true`
   - **Fail:** `false` (filter state is not restored from URL on mount)

6. Take a screenshot to document the restored state:
   - Tool: `browser_take_screenshot`

---

## Additional flows (not covered by current automated tests)

These cover UI surfaces present in the codebase that `happy-path.spec.ts` does not exercise.
Run them when those areas change.

### Flow 7 — Time window filter changes URL param

1. Navigate to `http://localhost:5173`
2. Wait for 9 regions.
3. Change the Time window select to "Today":
   - Tool: `browser_select_option`
   - Selector: `select[aria-label="Time window"]`
   - Value: `1d`
4. Verify URL contains `since=1d`:
   - Tool: `browser_evaluate` → `window.location.href`
   - **Pass:** contains `since=1d`
5. Change back to "14 days" (the default):
   - Tool: `browser_select_option` → value `14d`
6. Verify `since` param is removed from URL (default is omitted):
   - Tool: `browser_evaluate` → `window.location.href`
   - **Pass:** URL does NOT contain `since=`

### Flow 8 — Family filter updates URL param

1. Navigate to `http://localhost:5173`
2. Wait for 9 regions.
3. Open the Family select and check whether any options besides "All families" are present:
   - Tool: `browser_evaluate`
   - Script: `document.querySelector('select[aria-label="Family"]')?.options.length`
   - **Note:** if result is `1`, `species_meta` is empty (known issue) — log and skip to Step 6.
4. Select the first non-"All families" option:
   - Tool: `browser_evaluate`
   - Script: `document.querySelector('select[aria-label="Family"] option:nth-child(2)')?.value`
   - Then: `browser_select_option` with that value.
5. Verify URL contains `family=<code>`:
   - Tool: `browser_evaluate` → `window.location.href`
   - **Pass:** URL contains `family=`
6. Reset to "All families":
   - Tool: `browser_select_option` → value `""`
   - Verify `family` param removed from URL.

### Flow 9 — Species text input commits on blur

1. Navigate to `http://localhost:5173`
2. Wait for 9 regions.
3. Focus the Species input:
   - Tool: `browser_evaluate` → `document.querySelector('input[aria-label="Species"]').focus()`
4. Type a species common name (type something and check the datalist — or use a known value):
   - Tool: `browser_type`
   - Selector: `input[aria-label="Species"]`
   - Text: partial name (e.g. `"Vermilion"`)
5. Take a snapshot to see datalist suggestions.
6. Press Tab to blur the input (which triggers `onBlur → commitSpeciesDraft`):
   - Tool: `browser_press_key` → `Tab`
7. Verify URL contains `species=<code>` if an exact match was found, or no `species=` param
   if no match:
   - Tool: `browser_evaluate` → `window.location.href`

### Flow 10 — Error screen renders when API is unreachable

1. Navigate to a URL that forces an API failure:
   - Tool: `browser_navigate`
   - URL: `http://localhost:5173` with no read-api running (stop the read-api server first,
     or navigate directly to the app while the API is down).
2. Wait a few seconds, then check for the error screen:
   - Tool: `browser_evaluate`
   - Script: `document.querySelector('.error-screen h2')?.textContent`
   - **Pass:** `"Couldn't load map data"`
   - **Fail:** page hangs with `aria-busy=true` indefinitely

---

## Reporting results

After completing all flows, summarise findings in this format:

```
Flow 1 — Initial load:        PASS / FAIL
Flow 2 — Keyboard expand:     PASS / FAIL
Flow 3 — URL on expand:       PASS / FAIL
Flow 4 — Class + transform:   PASS / FAIL
Flow 5 — Notable filter URL:  PASS / FAIL
Flow 6 — Deep-link restore:   PASS / FAIL
Flow 7 — Time window param:   PASS / FAIL (optional)
Flow 8 — Family param:        PASS / FAIL / SKIP (species_meta empty)
Flow 9 — Species input blur:  PASS / FAIL (optional)
Flow 10 — Error screen:       PASS / FAIL (optional)
```

Any FAIL should include the evaluate script result and a screenshot.
