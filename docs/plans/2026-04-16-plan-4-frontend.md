# Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the React + Vite frontend that renders Arizona as a stylized SVG of 9 ecoregions, places species-stacked badges with bird-silhouette icons inside each region, expands the selected region inline, supports four filters, and syncs everything to the URL for deep-linking.

**Architecture:** Single-page React app. Fetches `/api/regions`, `/api/hotspots`, and `/api/observations` once on mount and re-fetches `/api/observations` when filters change. The Map is one root SVG; each region is an SVG `<g>` whose `transform` animates via CSS to drive the inline-expansion effect. State management is plain React hooks — `useReducer` for filter state, a custom `useUrlState` hook syncs filter + selection to `URLSearchParams`. No global state library, no animation library — CSS transitions on `transform` are sufficient.

**Tech Stack:** React 18, Vite, TypeScript, Vitest, React Testing Library, Playwright, native `fetch`, CSS transitions.

**Depends on:** Plan 3 (Read API) for the running backend during dev / E2E.

---

### Task 1: Scaffold the Vite + React + TS project

**Files:**
- Create: `frontend/package.json`
- Create: `frontend/tsconfig.json`
- Create: `frontend/tsconfig.node.json`
- Create: `frontend/vite.config.ts`
- Create: `frontend/index.html`
- Create: `frontend/src/main.tsx`
- Create: `frontend/src/App.tsx`
- Create: `frontend/src/styles.css`

- [ ] **Step 1: Write `frontend/package.json`**

```json
{
  "name": "@bird-watch/frontend",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "playwright test"
  },
  "dependencies": {
    "@bird-watch/shared-types": "*",
    "react": "^18.2.0",
    "react-dom": "^18.2.0"
  },
  "devDependencies": {
    "@playwright/test": "^1.41.0",
    "@testing-library/jest-dom": "^6.2.0",
    "@testing-library/react": "^14.1.0",
    "@testing-library/user-event": "^14.5.0",
    "@types/react": "^18.2.0",
    "@types/react-dom": "^18.2.0",
    "@vitejs/plugin-react": "^4.2.0",
    "jsdom": "^24.0.0",
    "vite": "^5.0.0",
    "vitest": "^1.2.0"
  }
}
```

- [ ] **Step 2: Write `frontend/tsconfig.json`**

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "rootDir": "src",
    "outDir": "dist",
    "noEmit": true,
    "allowImportingTsExtensions": true,
    "useDefineForClassFields": true
  },
  "include": ["src"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

- [ ] **Step 3: Write `frontend/tsconfig.node.json`**

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "noEmit": true,
    "rootDir": ".",
    "composite": true
  },
  "include": ["vite.config.ts"]
}
```

- [ ] **Step 4: Write `frontend/vite.config.ts`**

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8787',
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    globals: false,
    css: true,
  },
});
```

- [ ] **Step 5: Write `frontend/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>bird-watch — Arizona</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 6: Write `frontend/src/main.tsx`**

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App.js';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

- [ ] **Step 7: Write `frontend/src/App.tsx`**

```tsx
export function App() {
  return <div>bird-watch — coming soon</div>;
}
```

- [ ] **Step 8: Write minimal `frontend/src/styles.css`**

```css
*, *::before, *::after { box-sizing: border-box; }
html, body, #root { height: 100%; margin: 0; }
body {
  font-family: -apple-system, BlinkMacSystemFont, "Helvetica Neue", Helvetica, sans-serif;
  background: #f4f1ea;
  color: #1a1a1a;
}
```

- [ ] **Step 9: Write `frontend/src/test-setup.ts`**

```typescript
import '@testing-library/jest-dom/vitest';
```

- [ ] **Step 10: Install and verify dev server**

```bash
npm install
npm run dev --workspace @bird-watch/frontend
```

Expected: Vite serves at http://localhost:5173 showing "bird-watch — coming soon".

Stop the dev server (`Ctrl-C`).

- [ ] **Step 11: Commit**

```bash
git add frontend
git commit -m "chore(frontend): scaffold Vite + React + TS"
```

---

### Task 2: Typed API client

**Files:**
- Create: `frontend/src/api/client.ts`
- Create: `frontend/src/api/client.test.ts`

- [ ] **Step 1: Write the failing test**

`frontend/src/api/client.test.ts`:
```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ApiClient } from './client.js';

describe('ApiClient', () => {
  beforeEach(() => {
    vi.spyOn(global, 'fetch').mockReset();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('GETs /api/regions and returns the parsed JSON', async () => {
    const data = [{ id: 'colorado-plateau', name: 'Colorado Plateau' }];
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } })
    );
    const client = new ApiClient({ baseUrl: '' });
    const out = await client.getRegions();
    expect(out).toEqual(data);
    expect(fetch).toHaveBeenCalledWith('/api/regions', expect.objectContaining({ method: 'GET' }));
  });

  it('encodes filter query params for /api/observations', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response('[]', { status: 200 }));
    const client = new ApiClient({ baseUrl: '' });
    await client.getObservations({ since: '14d', notable: true, speciesCode: 'vermfly' });
    const call = (fetch as unknown as { mock: { calls: [string, unknown][] } }).mock.calls[0];
    const url = call[0];
    expect(url).toContain('since=14d');
    expect(url).toContain('notable=true');
    expect(url).toContain('species=vermfly');
  });

  it('throws on non-2xx response', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response('boom', { status: 500 }));
    const client = new ApiClient({ baseUrl: '' });
    await expect(client.getRegions()).rejects.toThrow(/500/);
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
npm install
npm test --workspace @bird-watch/frontend -- client
```

Expected: FAIL.

- [ ] **Step 3: Write the implementation**

`frontend/src/api/client.ts`:
```typescript
import type {
  Region, Hotspot, Observation, SpeciesMeta, ObservationFilters,
} from '@bird-watch/shared-types';

export interface ApiClientOptions {
  baseUrl?: string;
}

export class ApiError extends Error {
  constructor(public status: number, public body: string) {
    super(`API error ${status}: ${body}`);
  }
}

export class ApiClient {
  private readonly baseUrl: string;

  constructor(opts: ApiClientOptions = {}) {
    this.baseUrl = opts.baseUrl ?? '';
  }

  getRegions(): Promise<Region[]> {
    return this.get<Region[]>('/api/regions');
  }

  getHotspots(): Promise<Hotspot[]> {
    return this.get<Hotspot[]>('/api/hotspots');
  }

  getObservations(f: ObservationFilters = {}): Promise<Observation[]> {
    const url = new URL('/api/observations', 'http://x');
    if (f.since) url.searchParams.set('since', f.since);
    if (f.notable === true) url.searchParams.set('notable', 'true');
    if (f.speciesCode) url.searchParams.set('species', f.speciesCode);
    if (f.familyCode) url.searchParams.set('family', f.familyCode);
    return this.get<Observation[]>(url.pathname + url.search);
  }

  getSpecies(code: string): Promise<SpeciesMeta> {
    return this.get<SpeciesMeta>(`/api/species/${encodeURIComponent(code)}`);
  }

  private async get<T>(path: string): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const res = await fetch(url, { method: 'GET' });
    if (!res.ok) {
      throw new ApiError(res.status, await res.text());
    }
    return (await res.json()) as T;
  }
}
```

- [ ] **Step 4: Run the tests**

```bash
npm test --workspace @bird-watch/frontend -- client
```

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api
git commit -m "feat(frontend): typed API client"
```

---

### Task 3: URL state hook (`useUrlState`)

**Files:**
- Create: `frontend/src/state/url-state.ts`
- Create: `frontend/src/state/url-state.test.ts`

The single source of truth for `region`, `species`, `since`, `notable`, `species` filter, `family` filter is the URL. The hook reads from `URLSearchParams` and returns a setter that mutates history.

- [ ] **Step 1: Write the failing test**

`frontend/src/state/url-state.test.ts`:
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useUrlState } from './url-state.js';

describe('useUrlState', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/');
  });

  it('returns defaults when URL is empty', () => {
    const { result } = renderHook(() => useUrlState());
    expect(result.current.state).toEqual({
      since: '14d', notable: false,
      regionId: null, speciesCode: null, familyCode: null,
    });
  });

  it('parses values from the URL', () => {
    window.history.replaceState({}, '', '/?region=sky-islands-santa-ritas&since=7d&notable=true&species=vermfly');
    const { result } = renderHook(() => useUrlState());
    expect(result.current.state.regionId).toBe('sky-islands-santa-ritas');
    expect(result.current.state.since).toBe('7d');
    expect(result.current.state.notable).toBe(true);
    expect(result.current.state.speciesCode).toBe('vermfly');
  });

  it('updates URL when set is called', () => {
    const { result } = renderHook(() => useUrlState());
    act(() => result.current.set({ regionId: 'sonoran-tucson', since: '1d' }));
    expect(window.location.search).toContain('region=sonoran-tucson');
    expect(window.location.search).toContain('since=1d');
    expect(result.current.state.regionId).toBe('sonoran-tucson');
  });

  it('removes a key when set to null', () => {
    window.history.replaceState({}, '', '/?region=sonoran-tucson');
    const { result } = renderHook(() => useUrlState());
    act(() => result.current.set({ regionId: null }));
    expect(window.location.search).not.toContain('region=');
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
npm test --workspace @bird-watch/frontend -- url-state
```

Expected: FAIL.

- [ ] **Step 3: Write the implementation**

`frontend/src/state/url-state.ts`:
```typescript
import { useCallback, useEffect, useState } from 'react';

export type Since = '1d' | '7d' | '14d' | '30d';

export interface UrlState {
  regionId: string | null;
  speciesCode: string | null;
  familyCode: string | null;
  since: Since;
  notable: boolean;
}

const DEFAULTS: UrlState = {
  regionId: null,
  speciesCode: null,
  familyCode: null,
  since: '14d',
  notable: false,
};

const VALID_SINCE: ReadonlySet<string> = new Set(['1d', '7d', '14d', '30d']);

function readUrl(): UrlState {
  const p = new URLSearchParams(window.location.search);
  const since = p.get('since');
  return {
    regionId: p.get('region'),
    speciesCode: p.get('species'),
    familyCode: p.get('family'),
    since: since && VALID_SINCE.has(since) ? (since as Since) : DEFAULTS.since,
    notable: p.get('notable') === 'true',
  };
}

function writeUrl(state: UrlState): void {
  const p = new URLSearchParams();
  if (state.regionId) p.set('region', state.regionId);
  if (state.speciesCode) p.set('species', state.speciesCode);
  if (state.familyCode) p.set('family', state.familyCode);
  if (state.since !== DEFAULTS.since) p.set('since', state.since);
  if (state.notable) p.set('notable', 'true');
  const q = p.toString();
  const newUrl = q ? `${window.location.pathname}?${q}` : window.location.pathname;
  if (newUrl !== window.location.pathname + window.location.search) {
    window.history.replaceState({}, '', newUrl);
  }
}

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
      writeUrl(next);
      return next;
    });
  }, []);

  return { state, set };
}
```

- [ ] **Step 4: Run the test**

```bash
npm test --workspace @bird-watch/frontend -- url-state
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/state
git commit -m "feat(frontend): useUrlState hook for URL-as-state"
```

---

### Task 4: Region-level data layer (`useBirdData`)

**Files:**
- Create: `frontend/src/data/use-bird-data.ts`
- Create: `frontend/src/data/use-bird-data.test.tsx`

A custom hook that fetches `regions`, `hotspots`, and `observations` and exposes loading/error states. Re-fetches `observations` when the filters change.

- [ ] **Step 1: Write the failing test**

`frontend/src/data/use-bird-data.test.tsx`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useBirdData } from './use-bird-data.js';
import { ApiClient } from '../api/client.js';

function makeClient(overrides: Partial<ApiClient>): ApiClient {
  return Object.assign(new ApiClient(), overrides);
}

describe('useBirdData', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('loads regions, hotspots, and observations on mount', async () => {
    const client = makeClient({
      getRegions: vi.fn().mockResolvedValue([{ id: 'r1' }]),
      getHotspots: vi.fn().mockResolvedValue([{ locId: 'h1' }]),
      getObservations: vi.fn().mockResolvedValue([{ subId: 's1' }]),
    } as unknown as Partial<ApiClient>);

    const { result } = renderHook(() => useBirdData(client, { since: '14d', notable: false }));
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.regions).toHaveLength(1);
    expect(result.current.hotspots).toHaveLength(1);
    expect(result.current.observations).toHaveLength(1);
    expect(result.current.error).toBeNull();
  });

  it('refetches observations when filters change', async () => {
    const getObservations = vi.fn().mockResolvedValue([]);
    const client = makeClient({
      getRegions: vi.fn().mockResolvedValue([]),
      getHotspots: vi.fn().mockResolvedValue([]),
      getObservations,
    } as unknown as Partial<ApiClient>);

    const { rerender } = renderHook(
      ({ filters }: { filters: { since: '1d' | '7d' | '14d' | '30d'; notable: boolean } }) =>
        useBirdData(client, filters),
      { initialProps: { filters: { since: '14d', notable: false } } }
    );
    await waitFor(() => expect(getObservations).toHaveBeenCalledTimes(1));
    rerender({ filters: { since: '7d', notable: true } });
    await waitFor(() => expect(getObservations).toHaveBeenCalledTimes(2));
    expect(getObservations.mock.calls[1][0]).toMatchObject({ since: '7d', notable: true });
  });

  it('exposes error state when a fetch fails', async () => {
    const client = makeClient({
      getRegions: vi.fn().mockRejectedValue(new Error('boom')),
      getHotspots: vi.fn().mockResolvedValue([]),
      getObservations: vi.fn().mockResolvedValue([]),
    } as unknown as Partial<ApiClient>);

    const { result } = renderHook(() => useBirdData(client, { since: '14d', notable: false }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
npm test --workspace @bird-watch/frontend -- use-bird-data
```

Expected: FAIL.

- [ ] **Step 3: Write the implementation**

`frontend/src/data/use-bird-data.ts`:
```typescript
import { useEffect, useState } from 'react';
import type { ApiClient } from '../api/client.js';
import type {
  Region, Hotspot, Observation, ObservationFilters,
} from '@bird-watch/shared-types';

export interface BirdDataState {
  loading: boolean;
  error: Error | null;
  regions: Region[];
  hotspots: Hotspot[];
  observations: Observation[];
}

export function useBirdData(
  client: ApiClient,
  filters: ObservationFilters
): BirdDataState {
  const [regions, setRegions] = useState<Region[]>([]);
  const [hotspots, setHotspots] = useState<Hotspot[]>([]);
  const [observations, setObservations] = useState<Observation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  // One-time loads
  useEffect(() => {
    let cancelled = false;
    Promise.all([client.getRegions(), client.getHotspots()])
      .then(([r, h]) => {
        if (cancelled) return;
        setRegions(r);
        setHotspots(h);
      })
      .catch(err => { if (!cancelled) setError(err as Error); });
    return () => { cancelled = true; };
  }, [client]);

  // Observation refetch on filter change
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    client.getObservations(filters)
      .then(o => { if (!cancelled) setObservations(o); })
      .catch(err => { if (!cancelled) setError(err as Error); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [client, filters.since, filters.notable, filters.speciesCode, filters.familyCode]);

  return { loading, error, regions, hotspots, observations };
}
```

- [ ] **Step 4: Run the test**

```bash
npm test --workspace @bird-watch/frontend -- use-bird-data
```

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/data
git commit -m "feat(frontend): useBirdData hook"
```

---

### Task 5: `Badge` component (one species)

**Files:**
- Create: `frontend/src/components/Badge.tsx`
- Create: `frontend/src/components/Badge.test.tsx`

- [ ] **Step 1: Write the failing test**

`frontend/src/components/Badge.test.tsx`:
```typescript
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Badge } from './Badge.js';

describe('Badge', () => {
  it('renders the species count', () => {
    render(
      <svg viewBox="0 0 100 100">
        <Badge x={50} y={50} count={3} silhouettePath="M0 0 L 10 10" color="#FF0808" comName="Vermilion Flycatcher" />
      </svg>
    );
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('uses the family color', () => {
    const { container } = render(
      <svg viewBox="0 0 100 100">
        <Badge x={50} y={50} count={1} silhouettePath="M0 0" color="#7B2D8E" comName="Anna's Hummingbird" />
      </svg>
    );
    const circle = container.querySelector('circle.badge-circle');
    expect(circle?.getAttribute('fill')).toBe('#7B2D8E');
  });

  it('does not render the count chip when count is 1', () => {
    render(
      <svg viewBox="0 0 100 100">
        <Badge x={50} y={50} count={1} silhouettePath="M0 0" color="#000" comName="X" />
      </svg>
    );
    expect(screen.queryByText('1')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
npm test --workspace @bird-watch/frontend -- Badge
```

Expected: FAIL.

- [ ] **Step 3: Write the implementation**

`frontend/src/components/Badge.tsx`:
```tsx
export interface BadgeProps {
  x: number;
  y: number;
  count: number;
  silhouettePath: string;
  color: string;
  comName: string;
  selected?: boolean;
  onClick?: () => void;
}

const RADIUS = 14;
const CHIP_RADIUS = 7;

export function Badge(props: BadgeProps) {
  const cursor = props.onClick ? 'pointer' : 'default';
  return (
    <g
      className={`badge${props.selected ? ' badge-selected' : ''}`}
      transform={`translate(${props.x},${props.y})`}
      onClick={props.onClick}
      role={props.onClick ? 'button' : undefined}
      tabIndex={props.onClick ? 0 : undefined}
      aria-label={`${props.comName}${props.count > 1 ? ` (${props.count} sightings)` : ''}`}
      style={{ cursor }}
    >
      <circle
        className="badge-circle"
        r={RADIUS}
        fill={props.color}
        stroke="#fff"
        strokeWidth={2}
      />
      <g transform={`translate(-${RADIUS},-${RADIUS}) scale(${(RADIUS * 2) / 24})`}>
        <path d={props.silhouettePath} fill="#fff" />
      </g>
      {props.count > 1 && (
        <g transform={`translate(${RADIUS - 2},${-RADIUS + 2})`}>
          <circle r={CHIP_RADIUS} fill="#1a1a1a" />
          <text
            textAnchor="middle"
            dominantBaseline="central"
            fill="#fff"
            fontSize={9}
            fontWeight="bold"
            fontFamily="-apple-system, sans-serif"
          >
            {props.count}
          </text>
        </g>
      )}
    </g>
  );
}
```

- [ ] **Step 4: Run the test**

```bash
npm test --workspace @bird-watch/frontend -- Badge
```

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/Badge.tsx frontend/src/components/Badge.test.tsx
git commit -m "feat(frontend): Badge component with species-stack count chip"
```

---

### Task 6: `BadgeStack` — group observations by species and lay out badges

**Files:**
- Create: `frontend/src/components/BadgeStack.tsx`
- Create: `frontend/src/components/BadgeStack.test.tsx`

- [ ] **Step 1: Write the failing test**

`frontend/src/components/BadgeStack.test.tsx`:
```typescript
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BadgeStack, layoutBadges } from './BadgeStack.js';
import type { Observation } from '@bird-watch/shared-types';

const O = (i: number, sp: string, sil: string): Observation => ({
  subId: `S${i}`, speciesCode: sp, comName: sp, lat: 32, lng: -111,
  obsDt: '2026-04-15T08:00:00Z', locId: 'L1', locName: 'X',
  howMany: 1, isNotable: false, regionId: 'r', silhouetteId: sil,
});

describe('layoutBadges', () => {
  it('groups by speciesCode with counts', () => {
    const obs = [O(1, 'vermfly', 'tyrannidae'), O(2, 'vermfly', 'tyrannidae'), O(3, 'annhum', 'trochilidae')];
    const groups = layoutBadges(obs);
    expect(groups).toHaveLength(2);
    expect(groups.find(g => g.speciesCode === 'vermfly')?.count).toBe(2);
    expect(groups.find(g => g.speciesCode === 'annhum')?.count).toBe(1);
  });
});

describe('BadgeStack', () => {
  it('renders one Badge per species', () => {
    const obs = [O(1, 'vermfly', 'tyrannidae'), O(2, 'annhum', 'trochilidae')];
    render(
      <svg viewBox="0 0 200 200">
        <BadgeStack
          observations={obs}
          x={0} y={0} width={200} height={200}
          silhouetteFor={() => 'M0 0'}
          colorFor={() => '#000'}
        />
      </svg>
    );
    expect(screen.getByLabelText(/Vermilion/)).toBeTruthy();
    expect(screen.getByLabelText(/Anna's/)).toBeTruthy();
  });
});
```

(Adjust `comName` in the second test to match what the test asserts. For now the helper sets `comName = speciesCode` so the test labels look like "vermfly". Replace the `aria-label` matchers accordingly:)

```typescript
expect(screen.getByLabelText(/vermfly/)).toBeTruthy();
expect(screen.getByLabelText(/annhum/)).toBeTruthy();
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
npm test --workspace @bird-watch/frontend -- BadgeStack
```

Expected: FAIL.

- [ ] **Step 3: Write the implementation**

`frontend/src/components/BadgeStack.tsx`:
```tsx
import type { Observation } from '@bird-watch/shared-types';
import { Badge } from './Badge.js';

export interface BadgeGroup {
  speciesCode: string;
  comName: string;
  silhouetteId: string | null;
  count: number;
}

export function layoutBadges(observations: Observation[]): BadgeGroup[] {
  const map = new Map<string, BadgeGroup>();
  for (const o of observations) {
    const existing = map.get(o.speciesCode);
    if (existing) {
      existing.count += 1;
    } else {
      map.set(o.speciesCode, {
        speciesCode: o.speciesCode,
        comName: o.comName,
        silhouetteId: o.silhouetteId,
        count: 1,
      });
    }
  }
  return Array.from(map.values()).sort((a, b) => b.count - a.count);
}

export interface BadgeStackProps {
  observations: Observation[];
  x: number;
  y: number;
  width: number;
  height: number;
  silhouetteFor: (silhouetteId: string | null) => string;
  colorFor: (silhouetteId: string | null) => string;
  onSelectSpecies?: (speciesCode: string) => void;
  selectedSpeciesCode?: string | null;
}

const BADGE_DIAMETER = 30;
const PADDING = 4;

export function BadgeStack(props: BadgeStackProps) {
  const groups = layoutBadges(props.observations);
  const cols = Math.max(1, Math.floor(props.width / (BADGE_DIAMETER + PADDING)));

  return (
    <g className="badge-stack">
      {groups.map((g, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const cx = props.x + (col + 0.5) * (BADGE_DIAMETER + PADDING);
        const cy = props.y + (row + 0.5) * (BADGE_DIAMETER + PADDING);
        return (
          <Badge
            key={g.speciesCode}
            x={cx}
            y={cy}
            count={g.count}
            silhouettePath={props.silhouetteFor(g.silhouetteId)}
            color={props.colorFor(g.silhouetteId)}
            comName={g.comName}
            selected={props.selectedSpeciesCode === g.speciesCode}
            onClick={
              props.onSelectSpecies
                ? () => props.onSelectSpecies!(g.speciesCode)
                : undefined
            }
          />
        );
      })}
    </g>
  );
}
```

- [ ] **Step 4: Run the test**

```bash
npm test --workspace @bird-watch/frontend -- BadgeStack
```

Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/BadgeStack.tsx frontend/src/components/BadgeStack.test.tsx
git commit -m "feat(frontend): BadgeStack groups observations by species"
```

---

### Task 7: `HotspotDot` component

**Files:**
- Create: `frontend/src/components/HotspotDot.tsx`
- Create: `frontend/src/components/HotspotDot.test.tsx`

- [ ] **Step 1: Write the failing test**

`frontend/src/components/HotspotDot.test.tsx`:
```typescript
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { HotspotDot } from './HotspotDot.js';

describe('HotspotDot', () => {
  it('scales radius by activity', () => {
    const { container, rerender } = render(
      <svg viewBox="0 0 100 100">
        <HotspotDot x={10} y={10} numSpeciesAlltime={50} locName="A" />
      </svg>
    );
    const small = container.querySelector('circle.hotspot-dot');
    const smallR = parseFloat(small!.getAttribute('r')!);

    rerender(
      <svg viewBox="0 0 100 100">
        <HotspotDot x={10} y={10} numSpeciesAlltime={500} locName="A" />
      </svg>
    );
    const big = container.querySelector('circle.hotspot-dot');
    const bigR = parseFloat(big!.getAttribute('r')!);
    expect(bigR).toBeGreaterThan(smallR);
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
npm test --workspace @bird-watch/frontend -- HotspotDot
```

- [ ] **Step 3: Write the implementation**

`frontend/src/components/HotspotDot.tsx`:
```tsx
export interface HotspotDotProps {
  x: number;
  y: number;
  numSpeciesAlltime: number | null;
  locName: string;
}

const MIN_R = 3;
const MAX_R = 11;

function radiusFor(species: number | null): number {
  if (!species || species <= 0) return MIN_R;
  // log scale: 50 species ≈ MIN_R+1, 500 species ≈ MAX_R
  const r = MIN_R + Math.log10(species) * 3;
  return Math.min(MAX_R, Math.max(MIN_R, r));
}

export function HotspotDot(props: HotspotDotProps) {
  return (
    <circle
      className="hotspot-dot"
      cx={props.x}
      cy={props.y}
      r={radiusFor(props.numSpeciesAlltime)}
      fill="#00A6F3"
      stroke="#fff"
      strokeWidth={1.5}
    >
      <title>{props.locName}</title>
    </circle>
  );
}
```

- [ ] **Step 4: Run the test**

```bash
npm test --workspace @bird-watch/frontend -- HotspotDot
```

Expected: 1 test passes.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/HotspotDot.tsx frontend/src/components/HotspotDot.test.tsx
git commit -m "feat(frontend): HotspotDot with log-scaled radius"
```

---

### Task 8: `Region` component (polygon + badges + click handler)

**Files:**
- Create: `frontend/src/components/Region.tsx`
- Create: `frontend/src/components/Region.test.tsx`

`Region` renders a single ecoregion's stylized polygon and the BadgeStack inside it. Clicking the polygon calls `onSelect`. When `expanded === true`, the region renders larger and the badges are bigger.

- [ ] **Step 1: Write the failing test**

`frontend/src/components/Region.test.tsx`:
```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Region } from './Region.js';
import type { Region as RegionT, Observation } from '@bird-watch/shared-types';

const region: RegionT = {
  id: 'sky-islands-santa-ritas',
  name: 'Santa Ritas',
  parentId: null,
  displayColor: '#FF0808',
  svgPath: 'M 200 170 L 340 170 L 340 215 L 200 215 Z',
};

const obs: Observation[] = [{
  subId: 'S1', speciesCode: 'vermfly', comName: 'Vermilion Flycatcher',
  lat: 31.7, lng: -110.9, obsDt: '2026-04-15T08:00:00Z', locId: 'L1',
  locName: 'X', howMany: 1, isNotable: false,
  regionId: 'sky-islands-santa-ritas', silhouetteId: 'tyrannidae',
}];

describe('Region', () => {
  it('renders the polygon with the display color', () => {
    const { container } = render(
      <svg viewBox="0 0 360 380">
        <Region
          region={region}
          observations={obs}
          expanded={false}
          onSelect={() => {}}
          silhouetteFor={() => 'M0 0'}
          colorFor={() => '#000'}
        />
      </svg>
    );
    const path = container.querySelector('path.region-shape');
    expect(path?.getAttribute('fill')).toBe('#FF0808');
  });

  it('calls onSelect when clicked', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(
      <svg viewBox="0 0 360 380">
        <Region
          region={region}
          observations={obs}
          expanded={false}
          onSelect={onSelect}
          silhouetteFor={() => 'M0 0'}
          colorFor={() => '#000'}
        />
      </svg>
    );
    await user.click(screen.getByRole('button', { name: /Santa Ritas/ }));
    expect(onSelect).toHaveBeenCalledWith('sky-islands-santa-ritas');
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
npm test --workspace @bird-watch/frontend -- Region
```

Expected: FAIL.

- [ ] **Step 3: Write the implementation**

`frontend/src/components/Region.tsx`:
```tsx
import type { Region as RegionT, Observation } from '@bird-watch/shared-types';
import { BadgeStack } from './BadgeStack.js';
import { boundingBoxOfPath } from '../geo/path.js';

export interface RegionProps {
  region: RegionT;
  observations: Observation[];
  expanded: boolean;
  selectedSpeciesCode?: string | null;
  onSelect: (regionId: string) => void;
  onSelectSpecies?: (speciesCode: string) => void;
  silhouetteFor: (silhouetteId: string | null) => string;
  colorFor: (silhouetteId: string | null) => string;
}

export function Region(props: RegionProps) {
  const bbox = boundingBoxOfPath(props.region.svgPath);
  const padding = 8;
  const stackX = bbox.x + padding;
  const stackY = bbox.y + padding;
  const stackW = bbox.width - padding * 2;
  const stackH = bbox.height - padding * 2;

  return (
    <g
      className={`region${props.expanded ? ' region-expanded' : ''}`}
      data-region-id={props.region.id}
    >
      <path
        className="region-shape"
        d={props.region.svgPath}
        fill={props.region.displayColor}
        stroke="#fff"
        strokeWidth={3}
        role="button"
        tabIndex={0}
        aria-label={props.region.name}
        onClick={() => props.onSelect(props.region.id)}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            props.onSelect(props.region.id);
          }
        }}
        style={{ cursor: 'pointer' }}
      />
      <BadgeStack
        observations={props.observations}
        x={stackX}
        y={stackY}
        width={stackW}
        height={stackH}
        silhouetteFor={props.silhouetteFor}
        colorFor={props.colorFor}
        onSelectSpecies={props.onSelectSpecies}
        selectedSpeciesCode={props.selectedSpeciesCode}
      />
    </g>
  );
}
```

- [ ] **Step 4: Write `frontend/src/geo/path.ts` (helper used by Region)**

```typescript
export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Parse a flat M/L/Z SVG path (no curves) and return its bounding box.
 * The seed paths in the DB are all of this form.
 */
export function boundingBoxOfPath(d: string): BoundingBox {
  const tokens = d.split(/[\s,]+/).filter(Boolean);
  let i = 0;
  let xs: number[] = [];
  let ys: number[] = [];
  while (i < tokens.length) {
    const t = tokens[i]!;
    if (t === 'M' || t === 'L') {
      const x = parseFloat(tokens[i + 1]!);
      const y = parseFloat(tokens[i + 2]!);
      xs.push(x); ys.push(y);
      i += 3;
    } else if (t === 'Z' || t === 'z') {
      i += 1;
    } else {
      i += 1;
    }
  }
  if (xs.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}
```

- [ ] **Step 5: Run the test**

```bash
npm test --workspace @bird-watch/frontend -- Region
```

Expected: 2 tests pass.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/Region.tsx frontend/src/components/Region.test.tsx frontend/src/geo
git commit -m "feat(frontend): Region component with polygon + badges + click"
```

---

### Task 9: `Map` component with inline expansion

**Files:**
- Create: `frontend/src/components/Map.tsx`
- Create: `frontend/src/components/Map.test.tsx`

The Map renders all regions inside a viewBox-stable SVG. When a region is expanded, the SVG `<g>` for non-selected regions gets `opacity: 0.2`, and the selected region gets a `transform` that scales it toward the canvas centroid via CSS transitions.

- [ ] **Step 1: Write the failing test**

`frontend/src/components/Map.test.tsx`:
```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Map } from './Map.js';
import type { Region, Observation, Hotspot } from '@bird-watch/shared-types';

const regions: Region[] = [
  { id: 'r1', name: 'R1', parentId: null, displayColor: '#FF0808', svgPath: 'M 0 0 L 100 0 L 100 100 L 0 100 Z' },
  { id: 'r2', name: 'R2', parentId: null, displayColor: '#00A6F3', svgPath: 'M 200 0 L 300 0 L 300 100 L 200 100 Z' },
];
const observations: Observation[] = [];
const hotspots: Hotspot[] = [];

describe('Map', () => {
  it('renders one region per region prop', () => {
    render(
      <Map
        regions={regions}
        observations={observations}
        hotspots={hotspots}
        expandedRegionId={null}
        selectedSpeciesCode={null}
        onSelectRegion={() => {}}
        silhouetteFor={() => 'M0 0'}
        colorFor={() => '#000'}
      />
    );
    expect(screen.getByRole('button', { name: 'R1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'R2' })).toBeInTheDocument();
  });

  it('marks the expanded region with the region-expanded class', () => {
    const { container } = render(
      <Map
        regions={regions}
        observations={observations}
        hotspots={hotspots}
        expandedRegionId="r1"
        selectedSpeciesCode={null}
        onSelectRegion={() => {}}
        silhouetteFor={() => 'M0 0'}
        colorFor={() => '#000'}
      />
    );
    const expanded = container.querySelector('[data-region-id="r1"]');
    expect(expanded?.classList.contains('region-expanded')).toBe(true);
    const other = container.querySelector('[data-region-id="r2"]');
    expect(other?.classList.contains('region-expanded')).toBe(false);
  });

  it('calls onSelectRegion when a region is clicked', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(
      <Map
        regions={regions}
        observations={observations}
        hotspots={hotspots}
        expandedRegionId={null}
        selectedSpeciesCode={null}
        onSelectRegion={onSelect}
        silhouetteFor={() => 'M0 0'}
        colorFor={() => '#000'}
      />
    );
    await user.click(screen.getByRole('button', { name: 'R1' }));
    expect(onSelect).toHaveBeenCalledWith('r1');
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
npm test --workspace @bird-watch/frontend -- Map
```

Expected: FAIL.

- [ ] **Step 3: Write the implementation**

`frontend/src/components/Map.tsx`:
```tsx
import type { Region as RegionT, Observation, Hotspot } from '@bird-watch/shared-types';
import { Region } from './Region.js';
import { HotspotDot } from './HotspotDot.js';

export interface MapProps {
  regions: RegionT[];
  observations: Observation[];
  hotspots: Hotspot[];
  expandedRegionId: string | null;
  selectedSpeciesCode: string | null;
  onSelectRegion: (id: string | null) => void;
  onSelectSpecies?: (code: string | null) => void;
  silhouetteFor: (silhouetteId: string | null) => string;
  colorFor: (silhouetteId: string | null) => string;
}

const VIEWBOX_W = 360;
const VIEWBOX_H = 380;
// Approx geographic bounding box for AZ used to project hotspot lat/lng → SVG units
const GEO_MIN_LNG = -114.85, GEO_MAX_LNG = -109.05;
const GEO_MIN_LAT = 31.30,  GEO_MAX_LAT = 37.00;

function project(lat: number, lng: number): { x: number; y: number } {
  const x = ((lng - GEO_MIN_LNG) / (GEO_MAX_LNG - GEO_MIN_LNG)) * VIEWBOX_W;
  const y = ((GEO_MAX_LAT - lat) / (GEO_MAX_LAT - GEO_MIN_LAT)) * VIEWBOX_H;
  return { x, y };
}

export function Map(props: MapProps) {
  const observationsByRegion = groupBy(props.observations, o => o.regionId ?? 'unknown');

  return (
    <svg
      className="bird-map"
      viewBox={`0 0 ${VIEWBOX_W} ${VIEWBOX_H}`}
      role="application"
      aria-label="Arizona ecoregions map"
      onClick={e => {
        if (e.target === e.currentTarget) props.onSelectRegion(null);
      }}
    >
      {props.regions.map(r => {
        const isExpanded = props.expandedRegionId === r.id;
        const isDimmed = props.expandedRegionId !== null && !isExpanded;
        return (
          <g
            key={r.id}
            style={{
              opacity: isDimmed ? 0.2 : 1,
              transition: 'opacity 250ms ease, transform 350ms ease',
            }}
          >
            <Region
              region={r}
              observations={observationsByRegion.get(r.id) ?? []}
              expanded={isExpanded}
              selectedSpeciesCode={props.selectedSpeciesCode}
              onSelect={() => props.onSelectRegion(isExpanded ? null : r.id)}
              onSelectSpecies={props.onSelectSpecies}
              silhouetteFor={props.silhouetteFor}
              colorFor={props.colorFor}
            />
          </g>
        );
      })}

      {props.expandedRegionId === null && props.hotspots.map(h => {
        const { x, y } = project(h.lat, h.lng);
        return (
          <HotspotDot
            key={h.locId}
            x={x}
            y={y}
            numSpeciesAlltime={h.numSpeciesAlltime}
            locName={h.locName}
          />
        );
      })}
    </svg>
  );
}

function groupBy<T, K>(arr: T[], key: (t: T) => K): Map<K, T[]> {
  const m = new Map<K, T[]>();
  for (const v of arr) {
    const k = key(v);
    const list = m.get(k);
    if (list) list.push(v); else m.set(k, [v]);
  }
  return m;
}
```

- [ ] **Step 4: Add inline-expansion CSS**

Append to `frontend/src/styles.css`:
```css
.bird-map { width: 100%; height: 100%; display: block; }
.region { transition: transform 350ms ease; transform-origin: center; }
.region-expanded .region-shape { filter: drop-shadow(0 4px 16px rgba(0,0,0,0.3)); }
.region-expanded .badge-stack { transform: scale(1.5); transform-origin: center; }
.badge { transition: transform 200ms ease; }
.badge-selected .badge-circle { stroke: #1a1a1a; stroke-width: 4; }
```

- [ ] **Step 5: Run the test**

```bash
npm test --workspace @bird-watch/frontend -- Map
```

Expected: 3 tests pass.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/Map.tsx frontend/src/components/Map.test.tsx frontend/src/styles.css
git commit -m "feat(frontend): Map component with inline expansion"
```

---

### Task 10: `FiltersBar` component

**Files:**
- Create: `frontend/src/components/FiltersBar.tsx`
- Create: `frontend/src/components/FiltersBar.test.tsx`

- [ ] **Step 1: Write the failing test**

`frontend/src/components/FiltersBar.test.tsx`:
```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FiltersBar } from './FiltersBar.js';

describe('FiltersBar', () => {
  it('shows current values', () => {
    render(
      <FiltersBar
        since="14d"
        notable={false}
        speciesCode={null}
        familyCode={null}
        families={[]}
        speciesIndex={[]}
        onChange={() => {}}
      />
    );
    const sinceSelect = screen.getByLabelText('Time window') as HTMLSelectElement;
    expect(sinceSelect.value).toBe('14d');
  });

  it('calls onChange when time window changes', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <FiltersBar
        since="14d"
        notable={false}
        speciesCode={null}
        familyCode={null}
        families={[]}
        speciesIndex={[]}
        onChange={onChange}
      />
    );
    await user.selectOptions(screen.getByLabelText('Time window'), '7d');
    expect(onChange).toHaveBeenCalledWith({ since: '7d' });
  });

  it('calls onChange when notable toggle changes', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <FiltersBar
        since="14d"
        notable={false}
        speciesCode={null}
        familyCode={null}
        families={[]}
        speciesIndex={[]}
        onChange={onChange}
      />
    );
    await user.click(screen.getByRole('checkbox', { name: /Notable/ }));
    expect(onChange).toHaveBeenCalledWith({ notable: true });
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
npm test --workspace @bird-watch/frontend -- FiltersBar
```

Expected: FAIL.

- [ ] **Step 3: Write the implementation**

`frontend/src/components/FiltersBar.tsx`:
```tsx
import type { Since } from '../state/url-state.js';

export interface FamilyOption { code: string; name: string; }
export interface SpeciesOption { code: string; comName: string; }

export interface FiltersBarProps {
  since: Since;
  notable: boolean;
  speciesCode: string | null;
  familyCode: string | null;
  families: FamilyOption[];
  speciesIndex: SpeciesOption[];
  onChange: (partial: Partial<{
    since: Since; notable: boolean;
    speciesCode: string | null; familyCode: string | null;
  }>) => void;
}

export function FiltersBar(props: FiltersBarProps) {
  return (
    <div className="filters-bar" role="region" aria-label="Filters">
      <label>
        Time window
        <select
          value={props.since}
          onChange={e => props.onChange({ since: e.target.value as Since })}
        >
          <option value="1d">Today</option>
          <option value="7d">7 days</option>
          <option value="14d">14 days</option>
          <option value="30d">30 days</option>
        </select>
      </label>
      <label>
        <input
          type="checkbox"
          checked={props.notable}
          onChange={e => props.onChange({ notable: e.target.checked })}
        />
        Notable only
      </label>
      <label>
        Family
        <select
          value={props.familyCode ?? ''}
          onChange={e => props.onChange({ familyCode: e.target.value || null })}
        >
          <option value="">All families</option>
          {props.families.map(f =>
            <option key={f.code} value={f.code}>{f.name}</option>
          )}
        </select>
      </label>
      <label>
        Species
        <input
          type="search"
          list="species-options"
          placeholder="Common name"
          value={props.speciesIndex.find(s => s.code === props.speciesCode)?.comName ?? ''}
          onChange={e => {
            const v = e.target.value;
            const match = props.speciesIndex.find(s =>
              s.comName.toLowerCase() === v.toLowerCase()
            );
            props.onChange({ speciesCode: match?.code ?? null });
          }}
        />
        <datalist id="species-options">
          {props.speciesIndex.map(s =>
            <option key={s.code} value={s.comName} />
          )}
        </datalist>
      </label>
    </div>
  );
}
```

- [ ] **Step 4: Add styles**

Append to `frontend/src/styles.css`:
```css
.filters-bar {
  display: flex;
  gap: 16px;
  padding: 12px 16px;
  background: #fff;
  border-bottom: 1px solid #d8d3c3;
  align-items: center;
  flex-wrap: wrap;
}
.filters-bar label { display: flex; gap: 6px; align-items: center; font-size: 13px; }
.filters-bar select, .filters-bar input { padding: 4px 8px; }
```

- [ ] **Step 5: Run the test**

```bash
npm test --workspace @bird-watch/frontend -- FiltersBar
```

Expected: 3 tests pass.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/FiltersBar.tsx frontend/src/components/FiltersBar.test.tsx frontend/src/styles.css
git commit -m "feat(frontend): FiltersBar (time, notable, family, species)"
```

---

### Task 11: `App` composition

**Files:**
- Modify: `frontend/src/App.tsx`
- Create: `frontend/src/derived.ts`

`derived.ts` derives the family list and species index from the loaded observations (no separate API call needed for MVP).

- [ ] **Step 1: Write `frontend/src/derived.ts`**

```typescript
import type { Observation } from '@bird-watch/shared-types';
import type { FamilyOption, SpeciesOption } from './components/FiltersBar.js';

export function deriveFamilies(observations: Observation[]): FamilyOption[] {
  const set = new Map<string, string>();
  for (const o of observations) {
    if (o.silhouetteId) set.set(o.silhouetteId, o.silhouetteId);
  }
  return Array.from(set.entries())
    .map(([code, name]) => ({ code, name: prettyFamily(name) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function deriveSpeciesIndex(observations: Observation[]): SpeciesOption[] {
  const set = new Map<string, string>();
  for (const o of observations) {
    if (!set.has(o.speciesCode)) set.set(o.speciesCode, o.comName);
  }
  return Array.from(set.entries())
    .map(([code, comName]) => ({ code, comName }))
    .sort((a, b) => a.comName.localeCompare(b.comName));
}

function prettyFamily(code: string): string {
  return code.charAt(0).toUpperCase() + code.slice(1);
}
```

- [ ] **Step 2: Rewrite `frontend/src/App.tsx`**

```tsx
import { useMemo } from 'react';
import { ApiClient } from './api/client.js';
import { useUrlState } from './state/url-state.js';
import { useBirdData } from './data/use-bird-data.js';
import { Map } from './components/Map.js';
import { FiltersBar } from './components/FiltersBar.js';
import { deriveFamilies, deriveSpeciesIndex } from './derived.js';
import { silhouetteForFamily, colorForFamily } from '@bird-watch/family-mapping';

const apiClient = new ApiClient({ baseUrl: '' });

export function App() {
  const { state, set } = useUrlState();
  const { loading, error, regions, observations, hotspots } = useBirdData(apiClient, {
    since: state.since,
    notable: state.notable,
    ...(state.speciesCode ? { speciesCode: state.speciesCode } : {}),
    ...(state.familyCode ? { familyCode: state.familyCode } : {}),
  });

  const families = useMemo(() => deriveFamilies(observations), [observations]);
  const speciesIndex = useMemo(() => deriveSpeciesIndex(observations), [observations]);

  if (error) {
    return (
      <div className="error-screen">
        <h2>Couldn't load map data</h2>
        <p>{error.message}</p>
      </div>
    );
  }

  return (
    <div className="app">
      <FiltersBar
        since={state.since}
        notable={state.notable}
        speciesCode={state.speciesCode}
        familyCode={state.familyCode}
        families={families}
        speciesIndex={speciesIndex}
        onChange={set}
      />
      <div className="map-wrap" aria-busy={loading}>
        <Map
          regions={regions}
          observations={observations}
          hotspots={hotspots}
          expandedRegionId={state.regionId}
          selectedSpeciesCode={state.speciesCode}
          onSelectRegion={id => set({ regionId: id, speciesCode: null })}
          onSelectSpecies={code => set({ speciesCode: code })}
          silhouetteFor={silhouetteId =>
            buildSilhouettePath(silhouetteForFamily(silhouetteId ?? ''))
          }
          colorFor={silhouetteId => colorForFamily(silhouetteId ?? '')}
        />
      </div>
    </div>
  );
}

/** Look up the SVG path for a silhouette id by querying a static map (loaded from family-silhouettes seed). */
function buildSilhouettePath(silhouetteId: string): string {
  // For MVP we use the inline placeholder svg path that matches family-mapping's seed.
  // The DB also returns svg_data, but for the simplest MVP we just hardcode.
  // TODO when we wire the /api/silhouettes endpoint (post-MVP), fetch from there.
  // For now, return a generic songbird shape.
  return 'M5 14 C5 9 9 7 13 8 L17 6 L17 9 L15 10 L15 14 L13 16 L8 16 L5 14 Z';
}
```

(Note: the comment on `buildSilhouettePath` describes a real follow-up; for MVP we display the same shape for every family but distinguish by color. That's an honest MVP limitation.)

- [ ] **Step 3: Add styles for the app shell**

Append to `frontend/src/styles.css`:
```css
.app {
  display: flex;
  flex-direction: column;
  height: 100vh;
}
.map-wrap {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
}
.error-screen {
  padding: 32px;
  max-width: 500px;
  margin: 0 auto;
}
```

- [ ] **Step 4: Add `@bird-watch/family-mapping` to frontend deps**

Edit `frontend/package.json` to add under `dependencies`:
```json
"@bird-watch/family-mapping": "*"
```

Then:
```bash
npm install
```

- [ ] **Step 5: Verify the dev server runs end-to-end**

In one terminal:
```bash
cd /Users/j/repos/bird-watch
docker-compose up -d db
set -a; source .env; set +a
npm run db:migrate
npm run dev --workspace @bird-watch/read-api
```

In another:
```bash
cd /Users/j/repos/bird-watch
npm run dev --workspace @bird-watch/frontend
```

Visit http://localhost:5173. Expected: map renders with 9 regions even before any observations exist.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/App.tsx frontend/src/derived.ts frontend/src/styles.css frontend/package.json package-lock.json
git commit -m "feat(frontend): App composition + derived family/species index"
```

---

### Task 12: Playwright E2E setup + happy path

**Files:**
- Create: `frontend/playwright.config.ts`
- Create: `frontend/e2e/happy-path.spec.ts`

- [ ] **Step 1: Install Playwright browsers**

```bash
cd frontend
npx playwright install --with-deps chromium
```

- [ ] **Step 2: Write `playwright.config.ts`**

```typescript
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  use: {
    baseURL: 'http://localhost:5173',
    headless: true,
  },
  webServer: {
    command: 'npm run dev',
    port: 5173,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
```

- [ ] **Step 3: Write the E2E test**

`frontend/e2e/happy-path.spec.ts`:
```typescript
import { test, expect } from '@playwright/test';

test.describe('happy path', () => {
  test('loads map, expands a region, syncs URL, and toggles a filter', async ({ page }) => {
    await page.goto('/');

    // Wait for the map to render (9 regions visible).
    const regions = page.locator('[data-region-id]');
    await expect(regions).toHaveCount(9);

    // Click the Santa Ritas region.
    await page.getByRole('button', { name: 'Santa Ritas' }).click();

    // URL contains region.
    await expect.poll(() => page.url()).toContain('region=sky-islands-santa-ritas');

    // Region is marked expanded.
    await expect(page.locator('[data-region-id="sky-islands-santa-ritas"]'))
      .toHaveClass(/region-expanded/);

    // Toggle "Notable only".
    await page.getByLabel(/Notable only/).check();
    await expect.poll(() => page.url()).toContain('notable=true');

    // Refresh and confirm state survives.
    await page.reload();
    await expect(page.locator('[data-region-id="sky-islands-santa-ritas"]'))
      .toHaveClass(/region-expanded/);
    await expect(page.getByLabel(/Notable only/)).toBeChecked();
  });
});
```

- [ ] **Step 4: Run the E2E test**

Make sure the read-api dev server is running on port 8787 (with seeded DB). Then:
```bash
cd frontend
npm run test:e2e
```

Expected: 1 test passes.

- [ ] **Step 5: Commit**

```bash
git add frontend/playwright.config.ts frontend/e2e
git commit -m "test(frontend): Playwright E2E happy path"
```

---

### Task 13: Build the frontend bundle

**Files:** none (verification step)

- [ ] **Step 1: Build**

```bash
npm run build --workspace @bird-watch/frontend
```

Expected: `frontend/dist/` contains `index.html`, hashed JS + CSS bundles.

- [ ] **Step 2: Smoke-test the built bundle**

```bash
npm run preview --workspace @bird-watch/frontend
# visit http://localhost:4173
```

- [ ] **Step 3: Commit (if anything generated changed)**

```bash
git status
git add -A && git commit -m "chore(frontend): final build sweep" || echo "nothing to commit"
```

---

## Self-review checklist (run before declaring Plan 4 done)

- [ ] All Vitest component tests pass (≥18 tests across all components/hooks)
- [ ] Playwright E2E happy path passes
- [ ] `npm run build --workspace @bird-watch/frontend` succeeds
- [ ] Loading the app with no DB data renders the 9 region polygons (empty badges OK)
- [ ] Clicking a region expands it AND updates the URL
- [ ] Refreshing with `?region=...&notable=true` restores the same view
- [ ] Filters change observation list visibly (when seeded data exists)

When all checked: Plan 4 is done. Move on to Plan 5.
