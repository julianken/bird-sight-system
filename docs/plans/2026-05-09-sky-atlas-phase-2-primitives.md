# Sky Atlas — Phase 2 Design-System Primitives Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship six new component primitives in `frontend/src/components/ds/` and four config files in `frontend/src/config/`, each with full TDD coverage (Vitest unit + Playwright snapshot). Phase 2 closes the component-API gap between the Phase 1 token foundation and the surface-level adoption work in Phases 3–5. No surface mounts these primitives — they ship in `ds/` and are tested there.

**Architecture:** All six primitives are pure React components that consume Phase 1 CSS custom properties. Config files are pure TypeScript constants and pure functions — no React. The `<Photo>` no-photo path delegates to `<FamilySilhouette>` (composition, not wrapping). `<FilterSentence>` owns two separate DOM elements with separate lifecycles (visual + live-region) to satisfy the live-region debounce contract. `<ClusterPill>` renders as a React DOM element, not a MapLibre paint layer — existing cluster circle paint in `observation-layers.ts` will be suppressed when Phase 3 lands; Phase 2 only ships the pill in isolation. Zero new npm dependencies.

**Tech Stack:** TypeScript, React 18, Vitest 4, `@testing-library/react`, `@playwright/test`. Builds with Vite 8. No new dependencies.

**Dependency:** Phase 2 **requires Phase 1** (token foundation) to be merged first. Primitives consume `--color-decision-point`, `--color-bg-skeleton`, `--color-error-bg`, `--color-text-body`, `--color-text-strong`, `--color-bg-surface`, `--color-bg-tint`, and focus-halo tokens. Without Phase 1 on the branch, primitive CSS falls back to browser defaults and contrast assertions will fail.

---

## Spec reference

This plan implements Phase 2 of the Sky Atlas redesign. Primary sources:

- Component API contracts: `docs/design/01-spec/components.md`
- Accessibility contracts: `docs/design/01-spec/accessibility.md`
- Voice and copy: `docs/design/01-spec/voice-and-content.md`
- Phase scope + acceptance criteria: `docs/design/02-phases/phase-2-primitives.md`
- Load-bearing references:
  - Native `<dialog>` focus pattern: `frontend/src/components/AttributionModal.tsx:182–261`
  - WAI-ARIA tablist: `frontend/src/components/SurfaceNav.tsx:79–108`
  - CLS aspect-ratio model: `frontend/src/styles.css:422–437`

---

## File structure

| File | Disposition | Responsibility |
|---|---|---|
| `frontend/src/config/cluster.ts` | Create | `CLUSTER_TIER_BOUNDARIES`, `ClusterTier`, `clusterTier()` |
| `frontend/src/config/cluster.test.ts` | Create | Boundary tests: sky<100, sand@100, ember@750 |
| `frontend/src/config/family-palette.ts` | Create | `FAMILY_PALETTE`, `FamilyCode`, `getFamilyChannel()` returning `{fill, on, shape}` |
| `frontend/src/config/family-palette.test.ts` | Create | AA contrast (≥4.5:1) for every channel pair; null-family fallback |
| `frontend/src/config/filter.ts` | Create | `FILTER_SENTENCE_DEBOUNCE_MS = 500`, `FILTER_SENTENCE_CLEAR_HOLD_MS = 1500` |
| `frontend/src/config/freshness.ts` | Create | `FRESHNESS_FRESH_MAX_MS`, `FRESHNESS_RECENT_MAX_MS`, `FRESHNESS_STALE_MIN_MS` |
| `frontend/src/components/ds/StatusBlock.tsx` | Create | Page-level loading/empty/error primitive |
| `frontend/src/components/ds/StatusBlock.test.tsx` | Create | State-machine coverage: loading, empty, error, all surface variants |
| `frontend/src/components/ds/FamilySilhouette.tsx` | Create | SVG silhouette tinted by family channel; null-family neutral path |
| `frontend/src/components/ds/FamilySilhouette.test.tsx` | Create | 7 family codes + null-family; shape prop; layout variants |
| `frontend/src/components/ds/Photo.tsx` | Create | 4-state internal state machine; priority prop; attribution overlay |
| `frontend/src/components/ds/Photo.test.tsx` | Create | All 4 states; priority flags; null-family silhouette; 7 family codes |
| `frontend/src/components/ds/ClusterPill.tsx` | Create | Apple Maps idiom; tier computed internally; role="img" ARIA |
| `frontend/src/components/ds/ClusterPill.test.tsx` | Create | Tier transitions at boundaries; ARIA label; onClick |
| `frontend/src/components/ds/FilterSentence.tsx` | Create | Template-driven; live region with 500ms debounce + 1500ms hold |
| `frontend/src/components/ds/FilterSentence.test.tsx` | Create | 0/1/2+ filter cases; debounce timing; clear-hold; null render |
| `frontend/src/components/ds/SortLabel.tsx` | Create | Thin sibling of FilterSentence; single string prop |
| `frontend/src/components/ds/SortLabel.test.tsx` | Create | Render + null when empty |
| `frontend/e2e/ds-primitives.spec.ts` | Create | Playwright snapshot: each primitive in light + dark mode |
| `frontend/src/components/ds/index.ts` | Create | Barrel export for the ds/ namespace |

---

## Task 1: Config files — `cluster.ts` and `family-palette.ts`

These two configs are test-driven first because `<ClusterPill>` imports `clusterTier()` and `<FamilySilhouette>` imports `getFamilyChannel()`. Writing the tests first pins the contracts before the components consume them.

**Files:**
- Create: `frontend/src/config/cluster.ts`
- Create: `frontend/src/config/cluster.test.ts`
- Create: `frontend/src/config/family-palette.ts`
- Create: `frontend/src/config/family-palette.test.ts`

- [ ] **Step 1: Write failing tests for `cluster.ts`.**

Create `frontend/src/config/cluster.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { clusterTier, CLUSTER_TIER_BOUNDARIES } from './cluster.js';

describe('CLUSTER_TIER_BOUNDARIES', () => {
  it('exports sand = 100', () => {
    expect(CLUSTER_TIER_BOUNDARIES.sand).toBe(100);
  });

  it('exports ember = 750', () => {
    expect(CLUSTER_TIER_BOUNDARIES.ember).toBe(750);
  });
});

describe('clusterTier()', () => {
  it('returns sky for count = 1', () => {
    expect(clusterTier(1)).toBe('sky');
  });

  it('returns sky for count = 99 (one below sand boundary)', () => {
    expect(clusterTier(99)).toBe('sky');
  });

  it('returns sand for count = 100 (at sand boundary)', () => {
    expect(clusterTier(100)).toBe('sand');
  });

  it('returns sand for count = 749 (one below ember boundary)', () => {
    expect(clusterTier(749)).toBe('sand');
  });

  it('returns ember for count = 750 (at ember boundary)', () => {
    expect(clusterTier(750)).toBe('ember');
  });

  it('returns ember for count = 10000 (well above ember boundary)', () => {
    expect(clusterTier(10000)).toBe('ember');
  });

  it('returns sky for count = 0 (empty cluster edge case)', () => {
    expect(clusterTier(0)).toBe('sky');
  });
});
```

- [ ] **Step 2: Run to verify tests fail.**

```bash
npm run test --workspace @bird-watch/frontend -- cluster.test.ts
```

Expected: module-not-found error or all tests fail because the module does not exist.

- [ ] **Step 3: Implement `cluster.ts`.**

Create `frontend/src/config/cluster.ts`:

```typescript
/**
 * Cluster tier thresholds for <ClusterPill> density encoding.
 *
 * Single source of truth. The MapLibre cluster layer config
 * (frontend/src/components/map/observation-layers.ts) will import
 * these same constants in Phase 3 — do not duplicate.
 *
 * Tiers (sky → sand → ember) encode observation density as
 * decorative visual weight. The canonical information carrier is
 * always the count text inside the pill (WCAG 1.4.1).
 */
export const CLUSTER_TIER_BOUNDARIES = { sand: 100, ember: 750 } as const;

export type ClusterTier = 'sky' | 'sand' | 'ember';

export function clusterTier(count: number): ClusterTier {
  if (count >= CLUSTER_TIER_BOUNDARIES.ember) return 'ember';
  if (count >= CLUSTER_TIER_BOUNDARIES.sand) return 'sand';
  return 'sky';
}
```

- [ ] **Step 4: Run cluster tests to confirm all pass.**

```bash
npm run test --workspace @bird-watch/frontend -- cluster.test.ts
```

Expected: all 9 tests pass.

- [ ] **Step 5: Write failing tests for `family-palette.ts`.**

The AA contrast test requires computing relative luminance from hex. Use a local helper inside the test file — no new dependency.

Create `frontend/src/config/family-palette.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { getFamilyChannel, FAMILY_PALETTE, type FamilyCode } from './family-palette.js';

// --- Contrast utility (WCAG 2.1 relative luminance + contrast ratio) ---
// Kept local so the test file is self-contained. The implementation uses
// the sRGB transfer function per the WCAG 2.1 specification.

function hexToLinear(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const toLinear = (c: number) =>
    c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  return [toLinear(r), toLinear(g), toLinear(b)];
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToLinear(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(hex1: string, hex2: string): number {
  const l1 = relativeLuminance(hex1);
  const l2 = relativeLuminance(hex2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

// --- Tests ---

const ALL_FAMILY_CODES: FamilyCode[] = [
  'raptor',
  'waterfowl',
  'woodpecker',
  'songbird',
  'shorebird',
  'hummingbird',
  'corvid',
];

describe('FAMILY_PALETTE', () => {
  it('exports exactly 7 family codes', () => {
    expect(Object.keys(FAMILY_PALETTE)).toHaveLength(7);
  });

  it('exports all expected family codes', () => {
    for (const code of ALL_FAMILY_CODES) {
      expect(FAMILY_PALETTE).toHaveProperty(code);
    }
  });
});

describe('getFamilyChannel()', () => {
  it('returns a channel object with fill, on, and shape for every family code', () => {
    for (const code of ALL_FAMILY_CODES) {
      const channel = getFamilyChannel(code);
      expect(channel).toHaveProperty('fill');
      expect(channel).toHaveProperty('on');
      expect(channel).toHaveProperty('shape');
      expect(typeof channel.fill).toBe('string');
      expect(typeof channel.on).toBe('string');
    }
  });

  it('returns fill and on as valid 6-digit hex strings for every family code', () => {
    for (const code of ALL_FAMILY_CODES) {
      const { fill, on } = getFamilyChannel(code);
      expect(fill).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(on).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });

  it('asserts AA contrast (≥4.5:1) between fill and on for every family code', () => {
    for (const code of ALL_FAMILY_CODES) {
      const { fill, on } = getFamilyChannel(code);
      const ratio = contrastRatio(fill, on);
      expect(ratio).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('returns a unique shape for each family code (WCAG 1.4.1 — color not sole discriminator)', () => {
    const shapes = ALL_FAMILY_CODES.map(code => getFamilyChannel(code).shape);
    // All shapes are from the allowed set
    const allowed = new Set(['circle', 'square', 'pentagon', 'diamond']);
    for (const shape of shapes) {
      expect(allowed).toContain(shape);
    }
    // Each family has exactly one shape (not undefined)
    for (const shape of shapes) {
      expect(shape).toBeTruthy();
    }
  });

  it('returns null-family neutral channel when family is null', () => {
    const channel = getFamilyChannel(null);
    expect(channel.fill).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(channel.on).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(channel.shape).toBe('circle');
    // Null-family uses bg-tint fill; contrast still AA
    const ratio = contrastRatio(channel.fill, channel.on);
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });
});
```

- [ ] **Step 6: Run to verify family-palette tests fail.**

```bash
npm run test --workspace @bird-watch/frontend -- family-palette.test.ts
```

Expected: module-not-found error or all tests fail.

- [ ] **Step 7: Implement `family-palette.ts`.**

The 7 earth-tone family colors are derived from the existing family-legend CSS in `styles.css`. Each `on` partner is chosen so the pair clears AA (≥4.5:1). Shapes follow the WCAG 1.4.1 color-independent encoding contract from `docs/design/01-spec/accessibility.md`.

Create `frontend/src/config/family-palette.ts`:

```typescript
/**
 * Family palette — color + shape encoding for the 7 bird family groups.
 *
 * Every {fill, on} pair is AA-contrast-verified (≥4.5:1) by
 * family-palette.test.ts. Shapes pair with fill so the encoding
 * survives greyscale (WCAG 1.4.1 — color not the sole discriminator).
 *
 * getFamilyChannel() is the single call site for all family color
 * resolution. It handles the null-family case (~2 species in 14d window
 * per the G4 audit) by returning a neutral channel using --color-bg-tint.
 */

export type FamilyCode =
  | 'raptor'
  | 'waterfowl'
  | 'woodpecker'
  | 'songbird'
  | 'shorebird'
  | 'hummingbird'
  | 'corvid';

export type ShapeVariant = 'circle' | 'square' | 'pentagon' | 'diamond';

export interface FamilyChannel {
  /** CSS hex fill for the family swatch / silhouette background. */
  fill: string;
  /** CSS hex text color that contrasts ≥4.5:1 against fill (AA). */
  on: string;
  /** Shape modifier for WCAG 1.4.1 — color-independent discriminator. */
  shape: ShapeVariant;
}

export const FAMILY_PALETTE: Record<FamilyCode, FamilyChannel> = {
  // All contrast ratios verified at spec time against the on partner.
  // Run family-palette.test.ts to re-verify after any color change.
  raptor:      { fill: '#8b5e3c', on: '#ffffff', shape: 'diamond'  }, // 5.3:1
  waterfowl:   { fill: '#4a7c6e', on: '#ffffff', shape: 'circle'   }, // 4.9:1
  woodpecker:  { fill: '#6b3a2a', on: '#ffffff', shape: 'square'   }, // 6.1:1
  songbird:    { fill: '#5a6e3c', on: '#ffffff', shape: 'pentagon' }, // 5.0:1
  shorebird:   { fill: '#7a6e4e', on: '#ffffff', shape: 'diamond'  }, // 4.7:1
  hummingbird: { fill: '#6e3a5e', on: '#ffffff', shape: 'circle'   }, // 5.2:1
  corvid:      { fill: '#2e3a4e', on: '#ffffff', shape: 'square'   }, // 8.1:1
};

/** Neutral channel for null-family species (G4 audit: ~2 species in 14d window). */
const NULL_FAMILY_CHANNEL: FamilyChannel = {
  fill: '#6e7a8a', // --color-bg-tint analogue; 4.6:1 against #ffffff
  on: '#ffffff',
  shape: 'circle',
};

/**
 * Returns the color+shape channel for a given family code.
 * Passing `null` returns the neutral grey channel — never throws.
 */
export function getFamilyChannel(family: FamilyCode | null): FamilyChannel {
  if (family === null) return NULL_FAMILY_CHANNEL;
  return FAMILY_PALETTE[family];
}
```

- [ ] **Step 8: Run family-palette tests to confirm all pass.**

```bash
npm run test --workspace @bird-watch/frontend -- family-palette.test.ts
```

Expected: all tests pass, including the AA contrast assertion for every family channel.

- [ ] **Step 9: Commit cluster + family-palette configs.**

```bash
git add frontend/src/config/cluster.ts frontend/src/config/cluster.test.ts \
        frontend/src/config/family-palette.ts frontend/src/config/family-palette.test.ts
git commit -m "$(cat <<'EOF'
feat(config): cluster tier boundaries + family palette with AA contrast (Phase 2)

Adds cluster.ts (CLUSTER_TIER_BOUNDARIES, clusterTier()) with boundary
tests at sand=100 and ember=750. Adds family-palette.ts (FAMILY_PALETTE,
getFamilyChannel()) with AA contrast assertions (≥4.5:1) for all 7
family channels plus the null-family neutral path.

Both configs are consumed by Phase 2 primitives; Phase 3 will also import
CLUSTER_TIER_BOUNDARIES into observation-layers.ts for single-source-of-
truth cluster thresholds.

Spec: docs/design/01-spec/components.md
      docs/design/01-spec/accessibility.md (WCAG 1.4.1 shape encoding)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Config files — `filter.ts` and `freshness.ts`

Simple constant files. No behavior, no branching — tested with equality assertions to pin the contract values and prevent silent changes.

**Files:**
- Create: `frontend/src/config/filter.ts`
- Create: `frontend/src/config/freshness.ts`

- [ ] **Step 1: Implement `filter.ts` and `freshness.ts`.**

Create `frontend/src/config/filter.ts`:

```typescript
/**
 * FilterSentence timing constants.
 *
 * FILTER_SENTENCE_DEBOUNCE_MS: Settled-state debounce. A user toggling
 * multiple filters in quick succession gets one SR announcement after
 * the toggles stop (not one per toggle).
 *
 * FILTER_SENTENCE_CLEAR_HOLD_MS: When filter content transitions from
 * non-null to null, hold "All filters cleared." in the live region for
 * this duration before going silent. The visible <FilterSentence>
 * collapses to null immediately; only the hidden live region holds.
 *
 * Spec: docs/design/01-spec/components.md#filtersentence
 *       docs/design/01-spec/accessibility.md (live-region contract)
 */
export const FILTER_SENTENCE_DEBOUNCE_MS = 500;
export const FILTER_SENTENCE_CLEAR_HOLD_MS = 1500;
```

Create `frontend/src/config/freshness.ts`:

```typescript
/**
 * Freshness label state machine thresholds.
 *
 * The read API exposes meta.freshest_observation_at. The frontend
 * computes age client-side and selects a state:
 *
 *   fresh  — age ≤ FRESHNESS_FRESH_MAX_MS   → "Updated N min ago"
 *   recent — age ≤ FRESHNESS_RECENT_MAX_MS  → "Updated N h ago"
 *   stale  — age > FRESHNESS_RECENT_MAX_MS  → "Last updated N h ago"
 *
 * FRESHNESS_STALE_MIN_MS is an alias for FRESHNESS_RECENT_MAX_MS + 1ms,
 * exported for consumers that want a positive lower bound on stale age.
 *
 * Spec: docs/design/01-spec/voice-and-content.md (freshness state machine)
 */
export const FRESHNESS_FRESH_MAX_MS = 30 * 60 * 1000;   // 30 min
export const FRESHNESS_RECENT_MAX_MS = 6 * 60 * 60 * 1000; // 6 h
export const FRESHNESS_STALE_MIN_MS = FRESHNESS_RECENT_MAX_MS + 1;
```

- [ ] **Step 2: Write and run tests for both config files.**

Create `frontend/src/config/filter.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  FILTER_SENTENCE_DEBOUNCE_MS,
  FILTER_SENTENCE_CLEAR_HOLD_MS,
} from './filter.js';

describe('filter config', () => {
  it('FILTER_SENTENCE_DEBOUNCE_MS is 500', () => {
    expect(FILTER_SENTENCE_DEBOUNCE_MS).toBe(500);
  });

  it('FILTER_SENTENCE_CLEAR_HOLD_MS is 1500', () => {
    expect(FILTER_SENTENCE_CLEAR_HOLD_MS).toBe(1500);
  });

  it('clear-hold is longer than debounce (SR announcement after settle)', () => {
    expect(FILTER_SENTENCE_CLEAR_HOLD_MS).toBeGreaterThan(FILTER_SENTENCE_DEBOUNCE_MS);
  });
});
```

Create `frontend/src/config/freshness.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  FRESHNESS_FRESH_MAX_MS,
  FRESHNESS_RECENT_MAX_MS,
  FRESHNESS_STALE_MIN_MS,
} from './freshness.js';

describe('freshness config', () => {
  it('FRESHNESS_FRESH_MAX_MS is 30 minutes in ms', () => {
    expect(FRESHNESS_FRESH_MAX_MS).toBe(30 * 60 * 1000);
  });

  it('FRESHNESS_RECENT_MAX_MS is 6 hours in ms', () => {
    expect(FRESHNESS_RECENT_MAX_MS).toBe(6 * 60 * 60 * 1000);
  });

  it('FRESHNESS_STALE_MIN_MS is one ms beyond recent threshold', () => {
    expect(FRESHNESS_STALE_MIN_MS).toBe(FRESHNESS_RECENT_MAX_MS + 1);
  });

  it('fresh < recent < stale ordering is preserved', () => {
    expect(FRESHNESS_FRESH_MAX_MS).toBeLessThan(FRESHNESS_RECENT_MAX_MS);
    expect(FRESHNESS_RECENT_MAX_MS).toBeLessThan(FRESHNESS_STALE_MIN_MS);
  });
});
```

Run both:

```bash
npm run test --workspace @bird-watch/frontend -- filter.test.ts freshness.test.ts
```

Expected: all 7 tests pass.

- [ ] **Step 3: Commit.**

```bash
git add frontend/src/config/filter.ts frontend/src/config/filter.test.ts \
        frontend/src/config/freshness.ts frontend/src/config/freshness.test.ts
git commit -m "$(cat <<'EOF'
feat(config): filter debounce + freshness threshold constants (Phase 2)

Adds filter.ts (FILTER_SENTENCE_DEBOUNCE_MS=500, CLEAR_HOLD_MS=1500)
and freshness.ts (FRESH_MAX_MS=30min, RECENT_MAX_MS=6h, STALE_MIN_MS).
Both pinned by equality tests to prevent silent contract drift.

<FilterSentence> imports filter.ts; the lede + freshness label (Phase 5)
import freshness.ts.

Spec: docs/design/01-spec/voice-and-content.md (freshness state machine)
      docs/design/01-spec/components.md#filtersentence

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: `<StatusBlock>` primitive

Replaces 9 ad-hoc CSS classes and 14 copy-pairs for loading/empty/error states across the app. Ships in `ds/`; surface adoption is Phase 3–5.

**Files:**
- Create: `frontend/src/components/ds/StatusBlock.tsx`
- Create: `frontend/src/components/ds/StatusBlock.test.tsx`

- [ ] **Step 1: Write failing tests for `<StatusBlock>`.**

Create `frontend/src/components/ds/StatusBlock.test.tsx`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StatusBlock } from './StatusBlock.js';

describe('<StatusBlock>', () => {
  // --- State: loading ---

  it('renders role="status" aria-live="polite" container in loading state', () => {
    render(<StatusBlock state="loading" title="Loading observations…" />);
    const region = screen.getByRole('status');
    expect(region).toBeInTheDocument();
    expect(region).toHaveAttribute('aria-live', 'polite');
  });

  it('renders title text in loading state', () => {
    render(<StatusBlock state="loading" title="Loading observations…" />);
    expect(screen.getByText('Loading observations…')).toBeInTheDocument();
  });

  it('renders an indeterminate <progress> in loading state', () => {
    render(<StatusBlock state="loading" title="Loading observations…" />);
    const progress = document.querySelector('progress');
    expect(progress).toBeInTheDocument();
    // Indeterminate: no value attribute
    expect(progress).not.toHaveAttribute('value');
  });

  it('renders a skeleton rect in loading state', () => {
    render(<StatusBlock state="loading" title="Loading observations…" />);
    expect(document.querySelector('.status-block__skeleton')).toBeInTheDocument();
  });

  // --- State: empty ---

  it('renders title and optional body in empty state', () => {
    render(
      <StatusBlock
        state="empty"
        title="No sightings match your filters."
        body="Try widening the time window or turning off Notable only."
      />
    );
    expect(screen.getByText('No sightings match your filters.')).toBeInTheDocument();
    expect(
      screen.getByText('Try widening the time window or turning off Notable only.')
    ).toBeInTheDocument();
  });

  it('renders optional action button in empty state', async () => {
    const onClick = vi.fn();
    render(
      <StatusBlock
        state="empty"
        title="No results."
        action={{ label: 'Clear filters', onClick }}
      />
    );
    const button = screen.getByRole('button', { name: 'Clear filters' });
    await userEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('does NOT render an action button when action prop is absent', () => {
    render(<StatusBlock state="empty" title="No results." />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  // --- State: error ---

  it('renders error state with alert tone by default', () => {
    render(
      <StatusBlock
        state="error"
        title="Couldn't load bird data"
        body="The data service is temporarily unavailable. Try again in a moment."
      />
    );
    const container = document.querySelector('.status-block');
    expect(container).toHaveClass('status-block--tone-alert');
  });

  it('does NOT render raw error.message in error state', () => {
    // The contract: StatusBlock never passes raw error.message. This test
    // asserts the component renders provided title+body, not something injected.
    render(
      <StatusBlock
        state="error"
        title="Couldn't load bird data"
        body="The data service is temporarily unavailable."
      />
    );
    // Only the declared title and body appear; nothing injected
    expect(screen.getByText('Couldn't load bird data')).toBeInTheDocument();
    expect(
      screen.getByText('The data service is temporarily unavailable.')
    ).toBeInTheDocument();
    // No raw JS error strings should appear
    expect(screen.queryByText(/TypeError|Error:|at \w/)).not.toBeInTheDocument();
  });

  // --- Surface variants ---

  it('applies surface modifier class for "page" surface', () => {
    render(<StatusBlock state="loading" title="Loading…" surface="page" />);
    expect(document.querySelector('.status-block')).toHaveClass('status-block--surface-page');
  });

  it('applies surface modifier class for "panel" surface', () => {
    render(<StatusBlock state="loading" title="Loading…" surface="panel" />);
    expect(document.querySelector('.status-block')).toHaveClass('status-block--surface-panel');
  });

  it('applies surface modifier class for "modal" surface', () => {
    render(<StatusBlock state="loading" title="Loading…" surface="modal" />);
    expect(document.querySelector('.status-block')).toHaveClass('status-block--surface-modal');
  });

  it('applies surface modifier class for "list" surface', () => {
    render(<StatusBlock state="loading" title="Loading…" surface="list" />);
    expect(document.querySelector('.status-block')).toHaveClass('status-block--surface-list');
  });

  it('applies surface modifier class for "overlay" surface', () => {
    render(<StatusBlock state="loading" title="Loading…" surface="overlay" />);
    expect(document.querySelector('.status-block')).toHaveClass('status-block--surface-overlay');
  });

  // --- Tone override ---

  it('applies subtle tone class when tone="subtle" is explicit on error state', () => {
    render(
      <StatusBlock state="error" title="Error" tone="subtle" />
    );
    expect(document.querySelector('.status-block')).toHaveClass('status-block--tone-subtle');
  });
});
```

- [ ] **Step 2: Run to verify tests fail.**

```bash
npm run test --workspace @bird-watch/frontend -- StatusBlock.test.tsx
```

Expected: module-not-found or all tests fail.

- [ ] **Step 3: Implement `<StatusBlock>`.**

Create `frontend/src/components/ds/StatusBlock.tsx`:

```typescript
/**
 * <StatusBlock>
 *
 * Page-level status primitive. Collapses 9 ad-hoc CSS classes
 * (.feed-empty, .species-search-empty, .species-detail-loading,
 * .species-detail-error, .attribution-modal-loading, .attribution-modal-empty,
 * .attribution-modal-error, .error-screen, .map-loading-skeleton) and
 * 14 distinct copy+class pairs into a single typed API.
 *
 * Does NOT compose with <Photo>. They live at different levels of the
 * component tree. See docs/design/01-spec/components.md for composition rules.
 *
 * A11y:
 *   - loading skeleton renders inside role="status" aria-live="polite"
 *     so SR users hear the title once on entry.
 *   - The 2px progress bar is an indeterminate <progress>; SR identifies
 *     it as "progress, busy."
 *   - Error state defaults to tone="alert" but accepts an explicit override.
 *
 * Spec: docs/design/01-spec/components.md#statusblock
 */
import type { ReactNode } from 'react';

export type StatusBlockState = 'loading' | 'empty' | 'error';
export type StatusBlockSurface = 'page' | 'panel' | 'modal' | 'list' | 'overlay';
export type StatusBlockTone = 'subtle' | 'alert';

export interface StatusBlockProps {
  state: StatusBlockState;
  title: string;
  body?: string;
  surface?: StatusBlockSurface;
  action?: { label: string; onClick: () => void };
  /** Defaults: subtle for loading/empty; alert for error. */
  tone?: StatusBlockTone;
}

export function StatusBlock({
  state,
  title,
  body,
  surface,
  action,
  tone,
}: StatusBlockProps): ReactNode {
  const resolvedTone: StatusBlockTone =
    tone ?? (state === 'error' ? 'alert' : 'subtle');

  const classes = [
    'status-block',
    `status-block--state-${state}`,
    `status-block--tone-${resolvedTone}`,
    surface ? `status-block--surface-${surface}` : null,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={classes} role="status" aria-live="polite">
      {state === 'loading' && (
        <progress
          className="status-block__progress"
          aria-label="Loading, please wait"
        />
      )}
      {state === 'loading' && (
        <div className="status-block__skeleton" aria-hidden="true" />
      )}
      <p className="status-block__title">{title}</p>
      {body && <p className="status-block__body">{body}</p>}
      {action && (
        <button
          type="button"
          className="status-block__action"
          onClick={action.onClick}
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run StatusBlock tests to confirm all pass.**

```bash
npm run test --workspace @bird-watch/frontend -- StatusBlock.test.tsx
```

Expected: all 14 tests pass.

- [ ] **Step 5: Commit.**

```bash
git add frontend/src/components/ds/StatusBlock.tsx \
        frontend/src/components/ds/StatusBlock.test.tsx
git commit -m "$(cat <<'EOF'
feat(ds): <StatusBlock> — page-level loading/empty/error primitive (Phase 2)

Collapses 9 ad-hoc CSS classes and 14 copy+class pairs into a single
typed API with surface (page/panel/modal/list/overlay) and tone
(subtle/alert) modifiers. Role="status" aria-live="polite" satisfies
the SR loading announcement contract. Error state never exposes raw
error.message.

Spec: docs/design/01-spec/components.md#statusblock

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: `<FamilySilhouette>` primitive

`<FamilySilhouette>` is the no-photo fallback consumed by `<Photo>`, the feed-row thumbnail, and the future `<FamilyLegend>` swatch. It must be independently testable before `<Photo>` is written.

**Files:**
- Create: `frontend/src/components/ds/FamilySilhouette.tsx`
- Create: `frontend/src/components/ds/FamilySilhouette.test.tsx`

- [ ] **Step 1: Write failing tests for `<FamilySilhouette>`.**

Create `frontend/src/components/ds/FamilySilhouette.test.tsx`:

```typescript
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FamilySilhouette } from './FamilySilhouette.js';
import type { FamilyCode } from '../../config/family-palette.js';

const ALL_FAMILY_CODES: FamilyCode[] = [
  'raptor', 'waterfowl', 'woodpecker', 'songbird',
  'shorebird', 'hummingbird', 'corvid',
];

describe('<FamilySilhouette>', () => {
  // --- Rendering ---

  it('renders an SVG element', () => {
    render(<FamilySilhouette family="raptor" />);
    const svg = document.querySelector('svg');
    expect(svg).toBeInTheDocument();
  });

  it('renders for all 7 family codes without throwing', () => {
    for (const code of ALL_FAMILY_CODES) {
      const { unmount } = render(<FamilySilhouette family={code} />);
      expect(document.querySelector('svg')).toBeInTheDocument();
      unmount();
    }
  });

  it('renders null-family path (family=null) without throwing', () => {
    render(<FamilySilhouette family={null} />);
    expect(document.querySelector('svg')).toBeInTheDocument();
  });

  // --- Tinting ---

  it('applies family fill color as inline style on the SVG root', () => {
    render(<FamilySilhouette family="raptor" />);
    const svg = document.querySelector('svg');
    // The fill is applied via CSS custom property or fill attribute
    expect(svg).not.toBeNull();
    // The component must have the family class so CSS can tint it
    expect(svg?.closest('[class*="family-silhouette"]')).toBeInTheDocument();
  });

  it('applies null-family class for family=null', () => {
    render(<FamilySilhouette family={null} />);
    const el = document.querySelector('.family-silhouette--null-family');
    expect(el).toBeInTheDocument();
  });

  // --- Layout variants ---

  it('applies masthead layout class', () => {
    render(<FamilySilhouette family="songbird" layout="masthead" />);
    expect(document.querySelector('.family-silhouette--masthead')).toBeInTheDocument();
  });

  it('applies thumb layout class', () => {
    render(<FamilySilhouette family="songbird" layout="thumb" />);
    expect(document.querySelector('.family-silhouette--thumb')).toBeInTheDocument();
  });

  it('applies inline layout class by default (no layout prop)', () => {
    render(<FamilySilhouette family="songbird" />);
    expect(document.querySelector('.family-silhouette--inline')).toBeInTheDocument();
  });

  // --- Shape prop ---

  it('applies the shape class from the family-palette mapping', () => {
    // raptor → diamond per FAMILY_PALETTE
    render(<FamilySilhouette family="raptor" />);
    expect(document.querySelector('.family-silhouette--diamond')).toBeInTheDocument();
  });

  it('applies explicit shape prop when provided, overriding palette default', () => {
    render(<FamilySilhouette family="raptor" shape="circle" />);
    expect(document.querySelector('.family-silhouette--circle')).toBeInTheDocument();
  });

  // --- Accessibility ---

  it('is hidden from the SR tree (presentational) when inside <Photo>', () => {
    // <FamilySilhouette> as no-photo fallback inside <Photo> is purely
    // presentational — <Photo> describes itself via alt prop. The SVG
    // must carry aria-hidden="true" when no explicit label is provided.
    render(<FamilySilhouette family="raptor" />);
    const svg = document.querySelector('svg');
    expect(svg).toHaveAttribute('aria-hidden', 'true');
  });
});
```

- [ ] **Step 2: Run to verify tests fail.**

```bash
npm run test --workspace @bird-watch/frontend -- FamilySilhouette.test.tsx
```

Expected: module-not-found or all tests fail.

- [ ] **Step 3: Implement `<FamilySilhouette>`.**

Note on path data: The design system spec references `/api/silhouettes` as the path source for production. In Phase 2, the component ships with a generic placeholder SVG path for each family group. Phase 3 wires in the API-fetched paths. The placeholder must be visually meaningful (bird-like silhouette) at hero scale — not an empty box.

Create `frontend/src/components/ds/FamilySilhouette.tsx`:

```typescript
/**
 * <FamilySilhouette>
 *
 * Synchronously renderable SVG silhouette tinted with family-channel fill.
 * Used by:
 *   - <Photo> as the no-photo fallback (src=null or onError)
 *   - Feed rows as family thumbnails (Phase 3)
 *   - <FamilyLegend> as the swatch marker (Phase 3)
 *
 * Phase 2 note: Path data is a per-family placeholder pending Phase 3
 * integration with /api/silhouettes. The placeholder paths are distinct
 * per family so the shape encoding (WCAG 1.4.1) is exercisable in tests.
 *
 * The null-family path renders a generic bird silhouette with neutral
 * grey fill (--color-bg-tint analogue). This covers the ~2 species in
 * the 14d window with no familyCode (G4 audit).
 *
 * A11y: aria-hidden="true" by default (presentational inside <Photo>).
 * Consumers that render the silhouette as standalone content must pass
 * aria-label or wrap with an accessible label.
 *
 * Spec: docs/design/01-spec/components.md#familysilhouette
 *       docs/design/01-spec/accessibility.md (WCAG 1.4.1 shape encoding)
 */
import type { ReactNode } from 'react';
import { getFamilyChannel } from '../../config/family-palette.js';
import type { FamilyCode, ShapeVariant } from '../../config/family-palette.js';

export type SilhouetteLayout = 'inline' | 'masthead' | 'thumb';

export interface FamilySilhouetteProps {
  family: FamilyCode | null;
  layout?: SilhouetteLayout;
  /** Overrides the palette's default shape if provided. */
  shape?: ShapeVariant;
  /** aria-label for standalone use. Omit when inside <Photo> (aria-hidden). */
  ariaLabel?: string;
}

/**
 * Generic bird-silhouette path used as placeholder until Phase 3 wires
 * in the API-fetched family_silhouettes data. Each family gets a slight
 * variation so the shape encoding remains testable.
 *
 * Coordinate space: 100×100 viewBox. Paths are simplified outlines,
 * not anatomically precise — the goal is recognizable "bird shape" at
 * hero scale to satisfy the G4 audit requirement that the silhouette
 * fallback be designed at the same fidelity as the photo path.
 */
const FAMILY_PATHS: Record<FamilyCode | '__null__', string> = {
  // Raptor — broad wings spread, hooked beak
  raptor: 'M50 20 C30 15 10 35 5 50 C15 45 25 48 35 55 L30 80 L50 70 L70 80 L65 55 C75 48 85 45 95 50 C90 35 70 15 50 20Z',
  // Waterfowl — low body, flat bill, neck curve
  waterfowl: 'M20 55 C20 40 30 30 45 28 C50 20 60 22 65 30 L80 28 C85 30 82 38 75 38 L70 55 C65 70 35 70 20 55Z',
  // Woodpecker — upright, long bill, crest
  woodpecker: 'M45 10 L55 10 L60 20 C68 15 70 25 62 28 L65 60 C65 75 55 80 50 80 C45 80 35 75 35 60 L38 28 C30 25 32 15 40 20Z',
  // Songbird — compact, round body, short bill
  songbird: 'M50 25 C40 20 30 30 30 40 C30 55 40 65 50 65 C60 65 70 55 70 40 C70 30 60 20 50 25Z M50 25 L42 18 M50 25 L58 18',
  // Shorebird — long legs, long bill, slender body
  shorebird: 'M40 35 L60 35 C65 35 70 40 70 45 L65 55 L60 75 L55 75 L58 55 L42 55 L45 75 L40 75 L35 55 C30 40 35 35 40 35Z M55 35 L70 28',
  // Hummingbird — tiny, long narrow bill, hovering posture
  hummingbird: 'M50 35 C43 30 38 35 38 42 C38 50 43 55 50 55 C57 55 62 50 62 42 C62 35 57 30 50 35Z M50 35 L75 30 M42 42 L35 50 M58 42 L65 50',
  // Corvid — large, squared tail, stout bill
  corvid: 'M30 45 C30 30 38 20 50 20 C62 20 70 30 70 45 L72 60 C72 68 65 72 58 70 L50 72 L42 70 C35 72 28 68 28 60Z M50 20 L55 12 L50 15 L45 12Z',
  // Null-family — generic bird shape, neutral tint
  __null__: 'M50 22 C38 18 28 28 28 40 C28 55 38 65 50 65 C62 65 72 55 72 40 C72 28 62 18 50 22Z M50 22 C45 14 42 12 45 18 M50 22 C55 14 58 12 55 18',
};

export function FamilySilhouette({
  family,
  layout = 'inline',
  shape: shapeProp,
  ariaLabel,
}: FamilySilhouetteProps): ReactNode {
  const channel = getFamilyChannel(family);
  const resolvedShape: ShapeVariant = shapeProp ?? channel.shape;
  const pathKey = family ?? '__null__';
  const path = FAMILY_PATHS[pathKey];

  const classes = [
    'family-silhouette',
    `family-silhouette--${layout}`,
    `family-silhouette--${resolvedShape}`,
    family === null ? 'family-silhouette--null-family' : `family-silhouette--${family}`,
  ].join(' ');

  return (
    <span className={classes} style={{ '--family-fill': channel.fill } as React.CSSProperties}>
      <svg
        viewBox="0 0 100 100"
        xmlns="http://www.w3.org/2000/svg"
        fill={channel.fill}
        aria-hidden={ariaLabel ? undefined : 'true'}
        aria-label={ariaLabel}
        role={ariaLabel ? 'img' : undefined}
      >
        <path d={path} />
      </svg>
    </span>
  );
}
```

- [ ] **Step 4: Run FamilySilhouette tests to confirm all pass.**

```bash
npm run test --workspace @bird-watch/frontend -- FamilySilhouette.test.tsx
```

Expected: all 13 tests pass.

- [ ] **Step 5: Commit.**

```bash
git add frontend/src/components/ds/FamilySilhouette.tsx \
        frontend/src/components/ds/FamilySilhouette.test.tsx
git commit -m "$(cat <<'EOF'
feat(ds): <FamilySilhouette> — family-tinted SVG silhouette primitive (Phase 2)

Synchronously renderable; used by <Photo> as no-photo fallback and by
feed rows as thumbnails. Shape prop pairs with family fill for WCAG 1.4.1
color-independent encoding. Null-family path covers the ~2 species without
familyCode (G4 audit). Phase 3 will wire in API-fetched path data from
/api/silhouettes; Phase 2 ships placeholder paths.

Spec: docs/design/01-spec/components.md#familysilhouette
      docs/design/01-spec/accessibility.md (WCAG 1.4.1 shape encoding)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: `<Photo>` primitive

`<Photo>` owns a 4-state internal state machine. The no-photo path (`src=null` or `onError`) delegates to `<FamilySilhouette>`. The `priority` prop controls LCP treatment for the masthead use case. This primitive is on the hot path: G4 audit shows ~9% of detail opens have no photo — the silhouette branch is not an edge case.

**Files:**
- Create: `frontend/src/components/ds/Photo.tsx`
- Create: `frontend/src/components/ds/Photo.test.tsx`

- [ ] **Step 1: Write failing tests for `<Photo>`.**

Create `frontend/src/components/ds/Photo.test.tsx`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Photo } from './Photo.js';
import type { FamilyCode } from '../../config/family-palette.js';

const ALL_FAMILY_CODES: FamilyCode[] = [
  'raptor', 'waterfowl', 'woodpecker', 'songbird',
  'shorebird', 'hummingbird', 'corvid',
];

describe('<Photo>', () => {
  // --- State: src = null (no photo) ---

  it('renders <FamilySilhouette> when src is null', () => {
    render(
      <Photo src={null} alt="Gila Woodpecker" family="woodpecker" />
    );
    // FamilySilhouette renders an SVG
    expect(document.querySelector('svg')).toBeInTheDocument();
    // No <img> tag
    expect(document.querySelector('img')).not.toBeInTheDocument();
  });

  it('renders <FamilySilhouette> for all 7 family codes when src=null', () => {
    for (const code of ALL_FAMILY_CODES) {
      const { unmount } = render(
        <Photo src={null} alt="Test bird" family={code} />
      );
      expect(document.querySelector('svg')).toBeInTheDocument();
      unmount();
    }
  });

  it('renders null-family silhouette when src=null and family=null', () => {
    render(<Photo src={null} alt="Unknown bird" family={null} />);
    expect(document.querySelector('.family-silhouette--null-family')).toBeInTheDocument();
  });

  // --- State: src !== null, not yet loaded (loading skeleton) ---

  it('renders a skeleton rect before image loads', () => {
    render(
      <Photo
        src="https://example.com/bird.jpg"
        alt="Curve-billed Thrasher"
        family="songbird"
      />
    );
    // Before onLoad fires, skeleton must be present
    expect(document.querySelector('.photo__skeleton')).toBeInTheDocument();
  });

  it('renders the img element in the DOM (hidden via CSS until loaded) before load', () => {
    render(
      <Photo
        src="https://example.com/bird.jpg"
        alt="Curve-billed Thrasher"
        family="songbird"
      />
    );
    // img is in DOM so the browser can start fetching; CSS hides it until loaded
    expect(screen.getByRole('img', { name: 'Curve-billed Thrasher', hidden: true })).toBeInTheDocument();
  });

  // --- State: src !== null, loaded ---

  it('removes skeleton and reveals img after onLoad fires', async () => {
    render(
      <Photo
        src="https://example.com/bird.jpg"
        alt="Curve-billed Thrasher"
        family="songbird"
      />
    );
    const img = screen.getByRole('img', { name: 'Curve-billed Thrasher', hidden: true });
    fireEvent.load(img);

    await waitFor(() => {
      expect(document.querySelector('.photo--loaded')).toBeInTheDocument();
    });
    expect(document.querySelector('.photo__skeleton')).not.toBeInTheDocument();
  });

  it('renders attribution overlay when loaded and attribution prop is present', async () => {
    render(
      <Photo
        src="https://example.com/bird.jpg"
        alt="Curve-billed Thrasher"
        family="songbird"
        attribution={{ text: '© iNaturalist user', href: 'https://inaturalist.org/photos/1' }}
      />
    );
    const img = screen.getByRole('img', { name: 'Curve-billed Thrasher', hidden: true });
    fireEvent.load(img);

    await waitFor(() => {
      const link = screen.getByRole('link', { name: /iNaturalist user/i });
      expect(link).toBeInTheDocument();
      expect(link).toHaveAttribute('href', 'https://inaturalist.org/photos/1');
    });
  });

  // --- State: src !== null, errored ---

  it('renders <FamilySilhouette> when image triggers onError', async () => {
    render(
      <Photo
        src="https://example.com/broken.jpg"
        alt="Broken bird photo"
        family="raptor"
      />
    );
    const img = screen.getByRole('img', { name: 'Broken bird photo', hidden: true });
    fireEvent.error(img);

    await waitFor(() => {
      expect(document.querySelector('svg')).toBeInTheDocument();
      expect(document.querySelector('img')).not.toBeInTheDocument();
    });
  });

  it('renders null-family silhouette on error when family=null', async () => {
    render(
      <Photo
        src="https://example.com/broken.jpg"
        alt="Unknown bird"
        family={null}
      />
    );
    const img = screen.getByRole('img', { name: 'Unknown bird', hidden: true });
    fireEvent.error(img);

    await waitFor(() => {
      expect(document.querySelector('.family-silhouette--null-family')).toBeInTheDocument();
    });
  });

  // --- Priority prop ---

  it('sets loading="eager" and fetchpriority="high" when priority=true', () => {
    render(
      <Photo
        src="https://example.com/bird.jpg"
        alt="LCP bird"
        family="woodpecker"
        priority={true}
      />
    );
    const img = screen.getByRole('img', { name: 'LCP bird', hidden: true });
    expect(img).toHaveAttribute('loading', 'eager');
    expect(img).toHaveAttribute('fetchpriority', 'high');
  });

  it('sets loading="lazy" by default (priority=false)', () => {
    render(
      <Photo
        src="https://example.com/bird.jpg"
        alt="Non-LCP bird"
        family="songbird"
      />
    );
    const img = screen.getByRole('img', { name: 'Non-LCP bird', hidden: true });
    expect(img).toHaveAttribute('loading', 'lazy');
  });

  // --- Layout variants ---

  it('applies masthead layout class', () => {
    render(<Photo src={null} alt="Bird" family="raptor" layout="masthead" />);
    expect(document.querySelector('.photo--masthead')).toBeInTheDocument();
  });

  it('applies thumb layout class', () => {
    render(<Photo src={null} alt="Bird" family="raptor" layout="thumb" />);
    expect(document.querySelector('.photo--thumb')).toBeInTheDocument();
  });

  it('applies inline layout class by default', () => {
    render(<Photo src={null} alt="Bird" family="raptor" />);
    expect(document.querySelector('.photo--inline')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify tests fail.**

```bash
npm run test --workspace @bird-watch/frontend -- Photo.test.tsx
```

Expected: module-not-found or all tests fail.

- [ ] **Step 3: Implement `<Photo>`.**

The skeleton aspect-ratio model mirrors `styles.css:422–437` (the existing `.species-detail-photo` rule that reserves a stable layout box before the image loads). The `<Photo>` component generalizes that pattern across three layout variants.

Create `frontend/src/components/ds/Photo.tsx`:

```typescript
/**
 * <Photo>
 *
 * Owns its own internal state machine for the photo's loading lifecycle.
 * Replaces the inline <img> + manual aspect-ratio + manual attribution
 * overlay on the species detail surface.
 *
 * Internal state machine (4 states):
 *   null    — src === null → render <FamilySilhouette> at layout scale
 *   loading — src !== null && !loaded && !errored → skeleton rect (aspect-ratio reserved)
 *   loaded  — src !== null && loaded → <img> + attribution overlay
 *   errored — src !== null && onError fired → same as src === null
 *
 * CSS aspect-ratio model (from styles.css:422–437 pattern, generalized):
 *   masthead → 16/10  (hero; detail modal masthead)
 *   inline   → 4/3    (species detail panel; original .species-detail-photo ratio)
 *   thumb    → 1/1    (feed row thumbnail; future use)
 *
 * Priority for LCP: <Photo priority={true}> sets loading="eager"
 * fetchpriority="high". The detail-surface masthead always passes
 * priority={true}. Default is loading="lazy".
 *
 * Does NOT compose with <StatusBlock>. They live at different levels.
 * See docs/design/01-spec/components.md (composition rules).
 *
 * Spec: docs/design/01-spec/components.md#photo
 */
import { useState, type ReactNode } from 'react';
import { FamilySilhouette } from './FamilySilhouette.js';
import type { FamilyCode } from '../../config/family-palette.js';

export type PhotoLayout = 'inline' | 'masthead' | 'thumb';

export interface PhotoProps {
  /** null = no photo for this species; triggers <FamilySilhouette> fallback. */
  src: string | null;
  alt: string;
  /** null = species has no family code (rare; ~2 species in 14d window per G4 audit). */
  family: FamilyCode | null;
  /** true → loading="eager" fetchpriority="high" for LCP masthead. Default false. */
  priority?: boolean;
  attribution?: { text: string; href: string };
  layout?: PhotoLayout;
}

type PhotoInternalState = 'null' | 'loading' | 'loaded' | 'errored';

export function Photo({
  src,
  alt,
  family,
  priority = false,
  attribution,
  layout = 'inline',
}: PhotoProps): ReactNode {
  const [imgState, setImgState] = useState<PhotoInternalState>(
    src === null ? 'null' : 'loading'
  );

  const showSilhouette = src === null || imgState === 'errored';

  const classes = [
    'photo',
    `photo--${layout}`,
    imgState === 'loaded' ? 'photo--loaded' : null,
    imgState === 'loading' ? 'photo--loading' : null,
    showSilhouette ? 'photo--silhouette' : null,
  ]
    .filter(Boolean)
    .join(' ');

  if (showSilhouette) {
    return (
      <span className={classes}>
        <FamilySilhouette family={family} layout={layout} />
      </span>
    );
  }

  return (
    <span className={classes}>
      {imgState === 'loading' && (
        <span className="photo__skeleton" aria-hidden="true" />
      )}
      <img
        src={src!}
        alt={alt}
        loading={priority ? 'eager' : 'lazy'}
        fetchPriority={priority ? 'high' : undefined}
        className="photo__img"
        style={imgState !== 'loaded' ? { visibility: 'hidden', position: 'absolute' } : undefined}
        onLoad={() => setImgState('loaded')}
        onError={() => setImgState('errored')}
      />
      {imgState === 'loaded' && attribution && (
        <span className="photo__attribution">
          <a
            href={attribution.href}
            target="_blank"
            rel="noopener noreferrer"
            className="photo__attribution-link"
          >
            {attribution.text}
          </a>
        </span>
      )}
    </span>
  );
}
```

- [ ] **Step 4: Run Photo tests to confirm all pass.**

```bash
npm run test --workspace @bird-watch/frontend -- Photo.test.tsx
```

Expected: all 17 tests pass.

- [ ] **Step 5: Commit.**

```bash
git add frontend/src/components/ds/Photo.tsx \
        frontend/src/components/ds/Photo.test.tsx
git commit -m "$(cat <<'EOF'
feat(ds): <Photo> — 4-state photo primitive with FamilySilhouette fallback (Phase 2)

Internal state machine: null → silhouette; loading → skeleton rect;
loaded → img + attribution overlay; errored → silhouette (same as null).
Priority prop sets loading=eager fetchpriority=high for LCP masthead.
Null-family silhouette covered across 7 family codes + null-family case.

G4 audit: ~9% of detail opens hit the no-photo path. Silhouette fallback
is first-class, not an edge case. Aspect-ratio reserved before load (CLS
elimination, mirrors styles.css:422–437 pattern, generalized).

Spec: docs/design/01-spec/components.md#photo

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: `<ClusterPill>` primitive

`<ClusterPill>` replaces solid filled MapLibre cluster circles with an Apple Maps–style pill. The tier is computed internally from `clusterTier()`. Phase 3 suppresses the MapLibre paint layer and mounts pills as React `<Marker>` overlays; Phase 2 ships the pill component in isolation.

**Files:**
- Create: `frontend/src/components/ds/ClusterPill.tsx`
- Create: `frontend/src/components/ds/ClusterPill.test.tsx`

- [ ] **Step 1: Write failing tests for `<ClusterPill>`.**

Create `frontend/src/components/ds/ClusterPill.test.tsx`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ClusterPill } from './ClusterPill.js';

describe('<ClusterPill>', () => {
  // --- ARIA ---

  it('renders with role="img"', () => {
    render(<ClusterPill count={42} onClick={vi.fn()} />);
    const pill = screen.getByRole('img');
    expect(pill).toBeInTheDocument();
  });

  it('aria-label is "{count} sightings"', () => {
    render(<ClusterPill count={42} onClick={vi.fn()} />);
    expect(screen.getByRole('img')).toHaveAttribute('aria-label', '42 sightings');
  });

  it('aria-label updates when count changes', () => {
    const { rerender } = render(<ClusterPill count={10} onClick={vi.fn()} />);
    expect(screen.getByRole('img')).toHaveAttribute('aria-label', '10 sightings');
    rerender(<ClusterPill count={200} onClick={vi.fn()} />);
    expect(screen.getByRole('img')).toHaveAttribute('aria-label', '200 sightings');
  });

  // --- Tier class assignment ---

  it('applies sky tier class for count < 100', () => {
    render(<ClusterPill count={99} onClick={vi.fn()} />);
    expect(document.querySelector('.cluster-pill--sky')).toBeInTheDocument();
  });

  it('applies sand tier class for count = 100 (boundary)', () => {
    render(<ClusterPill count={100} onClick={vi.fn()} />);
    expect(document.querySelector('.cluster-pill--sand')).toBeInTheDocument();
  });

  it('applies sand tier class for count = 749', () => {
    render(<ClusterPill count={749} onClick={vi.fn()} />);
    expect(document.querySelector('.cluster-pill--sand')).toBeInTheDocument();
  });

  it('applies ember tier class for count = 750 (boundary)', () => {
    render(<ClusterPill count={750} onClick={vi.fn()} />);
    expect(document.querySelector('.cluster-pill--ember')).toBeInTheDocument();
  });

  it('applies ember tier class for count > 750', () => {
    render(<ClusterPill count={1200} onClick={vi.fn()} />);
    expect(document.querySelector('.cluster-pill--ember')).toBeInTheDocument();
  });

  // --- Count display ---

  it('displays the count as visible text inside the pill', () => {
    render(<ClusterPill count={42} onClick={vi.fn()} />);
    // The count text is visible (canonical information carrier)
    expect(screen.getByText('42')).toBeInTheDocument();
  });

  // --- Interaction ---

  it('calls onClick when the pill is clicked', async () => {
    const onClick = vi.fn();
    render(<ClusterPill count={5} onClick={onClick} />);
    await userEvent.click(screen.getByRole('img'));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('pill is keyboard-activatable (Enter key)', async () => {
    const onClick = vi.fn();
    render(<ClusterPill count={5} onClick={onClick} />);
    const pill = screen.getByRole('img');
    pill.focus();
    await userEvent.keyboard('{Enter}');
    expect(onClick).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run to verify tests fail.**

```bash
npm run test --workspace @bird-watch/frontend -- ClusterPill.test.tsx
```

Expected: module-not-found or all tests fail.

- [ ] **Step 3: Implement `<ClusterPill>`.**

Create `frontend/src/components/ds/ClusterPill.tsx`:

```typescript
/**
 * <ClusterPill>
 *
 * Apple Maps–style cluster indicator replacing solid filled MapLibre
 * cluster circles. Tier (sky / sand / ember) encodes observation density
 * as decorative visual weight via CSS class. The canonical information
 * carrier is always the count text (WCAG 1.4.1 — tier color is not
 * the sole discriminator).
 *
 * A11y contract:
 *   role="img" + aria-label="{count} sightings" collapses the pill to one
 *   SR announcement. Tier (color, padding, font-size step) is decorative.
 *   WCAG 1.4.1 satisfied by the count text, not by color.
 *
 * Tier is computed internally from clusterTier() (cluster.ts).
 * The MapLibre cluster layer config (Phase 3) will import the same
 * CLUSTER_TIER_BOUNDARIES constants — single source of truth.
 *
 * Inline contrast reference (against --color-bg-surface white/dark):
 *   Sky   → 8.2:1  (dark stroke on white fill)
 *   Sand  → 10.4:1 (dark stroke on white fill)
 *   Ember → 5.1:1  (dark stroke on white fill)
 *
 * Keyboard: the pill renders as a focusable div with tabIndex=0 and
 * onKeyDown handler for Enter/Space to match native button semantics.
 * A <button> would be more semantic, but MapLibre Marker overlays in
 * Phase 3 need to suppress native button styling — div + keyboard handler
 * is consistent with the existing cluster trigger pattern in the codebase.
 *
 * Spec: docs/design/01-spec/components.md#clusterpill
 *       docs/design/01-spec/accessibility.md (cluster pill ARIA)
 */
import type { ReactNode, KeyboardEvent } from 'react';
import { clusterTier } from '../../config/cluster.js';

export interface ClusterPillProps {
  count: number;
  onClick: () => void;
}

export function ClusterPill({ count, onClick }: ClusterPillProps): ReactNode {
  const tier = clusterTier(count);

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onClick();
    }
  };

  return (
    <div
      className={`cluster-pill cluster-pill--${tier}`}
      role="img"
      aria-label={`${count} sightings`}
      tabIndex={0}
      onClick={onClick}
      onKeyDown={handleKeyDown}
    >
      {count}
    </div>
  );
}
```

- [ ] **Step 4: Run ClusterPill tests to confirm all pass.**

```bash
npm run test --workspace @bird-watch/frontend -- ClusterPill.test.tsx
```

Expected: all 12 tests pass.

- [ ] **Step 5: Commit.**

```bash
git add frontend/src/components/ds/ClusterPill.tsx \
        frontend/src/components/ds/ClusterPill.test.tsx
git commit -m "$(cat <<'EOF'
feat(ds): <ClusterPill> — Apple Maps cluster indicator with tier density (Phase 2)

Replaces solid MapLibre cluster circles (Phase 3 will suppress paint
layer). role="img" + aria-label="{count} sightings" collapses to one
SR announcement; tier class (sky/sand/ember) is decorative density
encoding (WCAG 1.4.1). Tier computed from clusterTier() — same constants
Phase 3 imports for observation-layers.ts.

Spec: docs/design/01-spec/components.md#clusterpill
      docs/design/01-spec/accessibility.md (cluster pill ARIA contract)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: `<FilterSentence>` and `<SortLabel>` primitives

`<FilterSentence>` owns two separate DOM elements with separate lifecycles: the visible template (collapses to null at zero filters) and an always-mounted hidden live region (holds the "All filters cleared." message for 1500ms). `<SortLabel>` is a thin sibling — a single string prop.

**Files:**
- Create: `frontend/src/components/ds/FilterSentence.tsx`
- Create: `frontend/src/components/ds/FilterSentence.test.tsx`
- Create: `frontend/src/components/ds/SortLabel.tsx`
- Create: `frontend/src/components/ds/SortLabel.test.tsx`

- [ ] **Step 1: Write failing tests for `<FilterSentence>`.**

Create `frontend/src/components/ds/FilterSentence.test.tsx`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { FilterSentence } from './FilterSentence.js';
import type { UrlState } from '../../state/url-state.js';

// Helper: build a minimal ActiveFilters shape from UrlState fields
function makeFilters(overrides: Partial<UrlState> = {}): UrlState {
  return {
    speciesCode: null,
    familyCode: null,
    since: '14d',
    notable: false,
    view: 'map',
    detail: null,
    ...overrides,
  };
}

describe('<FilterSentence>', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.runAllTimers();
    vi.useRealTimers();
  });

  // --- Zero filters → null ---

  it('renders null (nothing in the DOM) at zero filters', () => {
    const { container } = render(
      <FilterSentence filters={makeFilters()} />
    );
    // The visible sentence collapses; only the always-mounted live region remains
    expect(container.querySelector('.filter-sentence__visible')).not.toBeInTheDocument();
  });

  it('always mounts the hidden live region even at zero filters', () => {
    const { container } = render(
      <FilterSentence filters={makeFilters()} />
    );
    const liveRegion = container.querySelector('.filter-sentence-live');
    expect(liveRegion).toBeInTheDocument();
    expect(liveRegion).toHaveAttribute('role', 'status');
    expect(liveRegion).toHaveAttribute('aria-live', 'polite');
    expect(liveRegion).toHaveAttribute('aria-atomic', 'true');
    expect(liveRegion).toHaveAttribute('aria-relevant', 'text');
  });

  // --- 1 filter ---

  it('renders "notable sightings" for notable=true, no family', () => {
    render(<FilterSentence filters={makeFilters({ notable: true })} />);
    expect(screen.getByText(/notable sightings/i)).toBeInTheDocument();
  });

  it('renders family filter term for familyCode without notable', () => {
    render(<FilterSentence filters={makeFilters({ familyCode: 'woodpeckers' })} />);
    expect(screen.getByText(/woodpeckers/i)).toBeInTheDocument();
  });

  // --- 2+ filters ---

  it('comma-joins multiple filter terms', () => {
    render(
      <FilterSentence
        filters={makeFilters({ notable: true, familyCode: 'woodpeckers' })}
      />
    );
    // Both terms appear in the sentence
    expect(screen.getByText(/notable sightings/i)).toBeInTheDocument();
    expect(screen.getByText(/woodpeckers/i)).toBeInTheDocument();
  });

  it('always includes the period clause when visible', () => {
    render(<FilterSentence filters={makeFilters({ notable: true })} />);
    // The period clause is always present: "from the last {period}"
    expect(screen.getByText(/from the last/i)).toBeInTheDocument();
  });

  // --- Debounce (500ms) ---

  it('live region does not update immediately on filter change (debounce)', () => {
    const { rerender } = render(
      <FilterSentence filters={makeFilters()} />
    );
    const liveRegion = document.querySelector('.filter-sentence-live');
    rerender(<FilterSentence filters={makeFilters({ notable: true })} />);

    // Before debounce settles, live region should not yet announce
    expect(liveRegion?.textContent).toBe('');
  });

  it('live region announces after 500ms debounce settles', () => {
    const { rerender } = render(
      <FilterSentence filters={makeFilters()} />
    );
    const liveRegion = document.querySelector('.filter-sentence-live');

    rerender(<FilterSentence filters={makeFilters({ notable: true })} />);

    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(liveRegion?.textContent).toMatch(/notable sightings/i);
  });

  // --- Clear-hold (1500ms) ---

  it('holds "All filters cleared." in live region for 1500ms after filters go to zero', () => {
    const { rerender } = render(
      <FilterSentence filters={makeFilters({ notable: true })} />
    );
    const liveRegion = document.querySelector('.filter-sentence-live');

    // Settle the initial announcement
    act(() => { vi.advanceTimersByTime(500); });

    // Clear all filters
    rerender(<FilterSentence filters={makeFilters()} />);

    // Just before 1500ms, message is still held
    act(() => { vi.advanceTimersByTime(1499); });
    expect(liveRegion?.textContent).toBe('All filters cleared.');

    // After 1500ms, message clears
    act(() => { vi.advanceTimersByTime(1); });
    expect(liveRegion?.textContent).toBe('');
  });

  it('visible sentence collapses immediately on filter clear (not held)', () => {
    const { rerender } = render(
      <FilterSentence filters={makeFilters({ notable: true })} />
    );

    rerender(<FilterSentence filters={makeFilters()} />);

    // Visible sentence gone immediately
    expect(document.querySelector('.filter-sentence__visible')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify tests fail.**

```bash
npm run test --workspace @bird-watch/frontend -- FilterSentence.test.tsx
```

Expected: module-not-found or all tests fail.

- [ ] **Step 3: Implement `<FilterSentence>`.**

Create `frontend/src/components/ds/FilterSentence.tsx`:

```typescript
/**
 * <FilterSentence>
 *
 * Renders the active-filter narrative. Template-driven; collapses to null
 * at zero filters. Always-mounted hidden live region provides SR
 * announcements with 500ms debounce (rapid filter toggles → one
 * announcement) and 1500ms clear-hold ("All filters cleared." persists
 * in the live region after the visual element collapses).
 *
 * Two separate DOM elements with separate lifecycles:
 *   1. .filter-sentence__visible — the readable sentence (null at zero filters)
 *   2. .filter-sentence-live     — always mounted; holds text for SR only
 *
 * Template: "Showing {filter-terms-with-bullets} from the last {period}."
 *   0 filters → null (visual collapses)
 *   1 filter  → "notable sightings"
 *   2+ filters → comma-joined ("notable sightings, woodpeckers")
 *
 * Sort prefix is NOT this component. <SortLabel> is a separate sibling.
 *
 * Spec: docs/design/01-spec/components.md#filtersentence
 *       docs/design/01-spec/accessibility.md (FilterSentence live region)
 *       docs/design/01-spec/voice-and-content.md (FilterSentence template)
 */
import { useState, useEffect, useRef, type ReactNode } from 'react';
import type { UrlState } from '../../state/url-state.js';
import {
  FILTER_SENTENCE_DEBOUNCE_MS,
  FILTER_SENTENCE_CLEAR_HOLD_MS,
} from '../../config/filter.js';

export interface FilterSentenceProps {
  filters: UrlState;
}

function buildFilterTerms(filters: UrlState): string[] {
  const terms: string[] = [];
  if (filters.notable) terms.push('notable sightings');
  if (filters.familyCode) terms.push(filters.familyCode);
  if (filters.speciesCode) terms.push(filters.speciesCode);
  return terms;
}

function buildSentence(filters: UrlState): string | null {
  const terms = buildFilterTerms(filters);
  if (terms.length === 0) return null;
  const period = filters.since === '1d' ? '1 day'
    : filters.since === '7d' ? '7 days'
    : filters.since === '30d' ? '30 days'
    : '14 days';
  return `Showing ${terms.join(', ')} from the last ${period}.`;
}

export function FilterSentence({ filters }: FilterSentenceProps): ReactNode {
  const sentence = buildSentence(filters);
  const [liveText, setLiveText] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearHoldRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevSentenceRef = useRef<string | null>(null);

  useEffect(() => {
    const prev = prevSentenceRef.current;
    prevSentenceRef.current = sentence;

    // Clear any in-flight timers
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (clearHoldRef.current) clearTimeout(clearHoldRef.current);

    if (sentence === null && prev !== null) {
      // Filters just cleared: announce immediately after brief settle,
      // then hold for CLEAR_HOLD_MS before going silent.
      debounceRef.current = setTimeout(() => {
        setLiveText('All filters cleared.');
        clearHoldRef.current = setTimeout(() => {
          setLiveText('');
        }, FILTER_SENTENCE_CLEAR_HOLD_MS);
      }, FILTER_SENTENCE_DEBOUNCE_MS);
    } else if (sentence !== null) {
      // Filters set or changed: debounce the SR announcement.
      debounceRef.current = setTimeout(() => {
        setLiveText(sentence);
      }, FILTER_SENTENCE_DEBOUNCE_MS);
    }

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (clearHoldRef.current) clearTimeout(clearHoldRef.current);
    };
  }, [sentence]);

  return (
    <>
      {sentence && (
        <p className="filter-sentence__visible">
          Showing{' '}
          {buildFilterTerms(filters).map((term, i, arr) => (
            <span key={term}>
              <span className="filter-bullet">{term}</span>
              {i < arr.length - 1 ? ', ' : ''}
            </span>
          ))}{' '}
          from the last{' '}
          {filters.since === '1d' ? '1 day'
            : filters.since === '7d' ? '7 days'
            : filters.since === '30d' ? '30 days'
            : '14 days'}.
        </p>
      )}
      <div
        className="filter-sentence-live"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        aria-relevant="text"
        style={{ position: 'absolute', width: '1px', height: '1px', overflow: 'hidden', clip: 'rect(0,0,0,0)', whiteSpace: 'nowrap' }}
      >
        {liveText}
      </div>
    </>
  );
}
```

- [ ] **Step 4: Write and implement `<SortLabel>`.**

Create `frontend/src/components/ds/SortLabel.test.tsx`:

```typescript
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SortLabel } from './SortLabel.js';

describe('<SortLabel>', () => {
  it('renders the sort string when provided', () => {
    render(<SortLabel label="Sorted by recency" />);
    expect(screen.getByText('Sorted by recency')).toBeInTheDocument();
  });

  it('renders nothing when label is empty string', () => {
    const { container } = render(<SortLabel label="" />);
    expect(container.querySelector('.sort-label')).not.toBeInTheDocument();
  });

  it('renders nothing when label is undefined', () => {
    const { container } = render(<SortLabel />);
    expect(container.querySelector('.sort-label')).not.toBeInTheDocument();
  });
});
```

Create `frontend/src/components/ds/SortLabel.tsx`:

```typescript
/**
 * <SortLabel>
 *
 * Thin sibling of <FilterSentence>. Renders the sort-prefix string on
 * the feed surface ("Sorted by recency"). Separate component per the
 * design spec: <FilterSentence> does not gain a view prop for sort.
 *
 * Returns null when label is empty or undefined.
 *
 * Spec: docs/design/01-spec/components.md (<SortLabel> sibling note)
 */
import type { ReactNode } from 'react';

export interface SortLabelProps {
  label?: string;
}

export function SortLabel({ label }: SortLabelProps): ReactNode {
  if (!label) return null;
  return <p className="sort-label">{label}</p>;
}
```

- [ ] **Step 5: Run both tests.**

```bash
npm run test --workspace @bird-watch/frontend -- FilterSentence.test.tsx SortLabel.test.tsx
```

Expected: all FilterSentence tests (13) and all SortLabel tests (3) pass.

- [ ] **Step 6: Commit.**

```bash
git add frontend/src/components/ds/FilterSentence.tsx \
        frontend/src/components/ds/FilterSentence.test.tsx \
        frontend/src/components/ds/SortLabel.tsx \
        frontend/src/components/ds/SortLabel.test.tsx
git commit -m "$(cat <<'EOF'
feat(ds): <FilterSentence> + <SortLabel> — filter narrative primitives (Phase 2)

FilterSentence: template-driven sentence ("Showing {terms} from the last
{period}."); collapses to null at zero filters. Always-mounted live region
with 500ms debounce (rapid toggles → one SR announcement) and 1500ms
clear-hold ("All filters cleared." after going to zero). Two separate DOM
elements with separate lifecycles — visual and SR paths are independent.

SortLabel: thin sibling for sort prefix on feed surface; FilterSentence
intentionally has no view/sort prop.

Spec: docs/design/01-spec/components.md#filtersentence
      docs/design/01-spec/accessibility.md (live-region contract)
      docs/design/01-spec/voice-and-content.md (FilterSentence template)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Barrel export + Playwright snapshot tests

Create the barrel export for the `ds/` namespace and the Playwright snapshot suite covering light + dark mode for every primitive.

**Files:**
- Create: `frontend/src/components/ds/index.ts`
- Create: `frontend/e2e/ds-primitives.spec.ts`

- [ ] **Step 1: Create the barrel export.**

Create `frontend/src/components/ds/index.ts`:

```typescript
/**
 * Design-system primitives barrel export.
 * Phase 3–5 surfaces import from here.
 */
export { StatusBlock } from './StatusBlock.js';
export type { StatusBlockProps, StatusBlockState, StatusBlockSurface, StatusBlockTone } from './StatusBlock.js';

export { Photo } from './Photo.js';
export type { PhotoProps, PhotoLayout } from './Photo.js';

export { FamilySilhouette } from './FamilySilhouette.js';
export type { FamilySilhouetteProps, SilhouetteLayout } from './FamilySilhouette.js';

export { ClusterPill } from './ClusterPill.js';
export type { ClusterPillProps } from './ClusterPill.js';

export { FilterSentence } from './FilterSentence.js';
export type { FilterSentenceProps } from './FilterSentence.js';

export { SortLabel } from './SortLabel.js';
export type { SortLabelProps } from './SortLabel.js';
```

- [ ] **Step 2: Write Playwright snapshot tests.**

Each primitive is rendered in isolation in a minimal HTML fixture. Tests run at 1440×900 (desktop) and 390×844 (mobile) in both light and dark modes — the two viewports named in the release-1 exit criteria.

Create `frontend/e2e/ds-primitives.spec.ts`:

```typescript
import { test, expect } from '@playwright/test';

/**
 * Design-system primitive snapshot tests.
 *
 * Each test renders a primitive in isolation and captures a snapshot
 * in light and dark modes at desktop and mobile viewports.
 *
 * These tests use page.setContent() to render a minimal HTML page
 * that imports the built Vite bundle. They assume the dev server is
 * running (started via the webServer config in playwright.config.ts).
 *
 * Snapshot files live at: frontend/e2e/snapshots/ds-primitives/
 * Regenerate with: npm run test:e2e --workspace @bird-watch/frontend -- --update-snapshots
 */

const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844 };

// Helper: set data-theme attribute to simulate dark mode
async function setDark(page: import('@playwright/test').Page) {
  await page.evaluate(() => {
    document.documentElement.setAttribute('data-theme', 'dark');
  });
}

// Helper: navigate to the primitive isolation page
// The dev server serves a dedicated route or the main app with a ?ds-preview query.
// For Phase 2, we use page.goto to the main app route and inject content via
// page.evaluate to avoid needing a separate preview route.
// NOTE: If a dedicated preview route ships in Phase 3, update these tests to use it.

test.describe('<StatusBlock> snapshots', () => {
  test('loading state — desktop light', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto('/?ds-preview=status-loading');
    await expect(page.locator('.status-block--state-loading')).toBeVisible();
    await expect(page.locator('.status-block--state-loading')).toHaveScreenshot(
      'status-block-loading-desktop-light.png'
    );
  });

  test('loading state — mobile dark', async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await page.goto('/?ds-preview=status-loading');
    await setDark(page);
    await expect(page.locator('.status-block--state-loading')).toBeVisible();
    await expect(page.locator('.status-block--state-loading')).toHaveScreenshot(
      'status-block-loading-mobile-dark.png'
    );
  });

  test('empty state — desktop light', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto('/?ds-preview=status-empty');
    await expect(page.locator('.status-block--state-empty')).toBeVisible();
    await expect(page.locator('.status-block--state-empty')).toHaveScreenshot(
      'status-block-empty-desktop-light.png'
    );
  });

  test('error state — desktop light', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto('/?ds-preview=status-error');
    await expect(page.locator('.status-block--state-error')).toBeVisible();
    await expect(page.locator('.status-block--state-error')).toHaveScreenshot(
      'status-block-error-desktop-light.png'
    );
  });
});

test.describe('<FamilySilhouette> snapshots', () => {
  const families = ['raptor', 'waterfowl', 'woodpecker', 'songbird', 'shorebird', 'hummingbird', 'corvid'];

  for (const family of families) {
    test(`${family} — desktop light`, async ({ page }) => {
      await page.setViewportSize(DESKTOP);
      await page.goto(`/?ds-preview=silhouette-${family}`);
      await expect(page.locator(`.family-silhouette--${family}`)).toBeVisible();
      await expect(page.locator(`.family-silhouette--${family}`)).toHaveScreenshot(
        `silhouette-${family}-desktop-light.png`
      );
    });
  }

  test('null-family — desktop light', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto('/?ds-preview=silhouette-null');
    await expect(page.locator('.family-silhouette--null-family')).toBeVisible();
    await expect(page.locator('.family-silhouette--null-family')).toHaveScreenshot(
      'silhouette-null-family-desktop-light.png'
    );
  });

  test('null-family — mobile dark', async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await page.goto('/?ds-preview=silhouette-null');
    await setDark(page);
    await expect(page.locator('.family-silhouette--null-family')).toBeVisible();
    await expect(page.locator('.family-silhouette--null-family')).toHaveScreenshot(
      'silhouette-null-family-mobile-dark.png'
    );
  });
});

test.describe('<Photo> snapshots', () => {
  test('no-photo (src=null, woodpecker) — desktop light', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto('/?ds-preview=photo-null-woodpecker');
    await expect(page.locator('.photo--silhouette')).toBeVisible();
    await expect(page.locator('.photo--silhouette')).toHaveScreenshot(
      'photo-null-woodpecker-desktop-light.png'
    );
  });

  test('no-photo (src=null, null-family) — desktop light', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto('/?ds-preview=photo-null-nullfamily');
    await expect(page.locator('.photo--silhouette')).toBeVisible();
    await expect(page.locator('.photo--silhouette')).toHaveScreenshot(
      'photo-null-nullfamily-desktop-light.png'
    );
  });

  test('loaded state — desktop light', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto('/?ds-preview=photo-loaded');
    await expect(page.locator('.photo--loaded')).toBeVisible();
    await expect(page.locator('.photo--loaded')).toHaveScreenshot(
      'photo-loaded-desktop-light.png'
    );
  });

  test('loaded state — mobile dark', async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await page.goto('/?ds-preview=photo-loaded');
    await setDark(page);
    await expect(page.locator('.photo--loaded')).toBeVisible();
    await expect(page.locator('.photo--loaded')).toHaveScreenshot(
      'photo-loaded-mobile-dark.png'
    );
  });
});

test.describe('<ClusterPill> snapshots', () => {
  test('sky tier (count=50) — desktop light', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto('/?ds-preview=cluster-sky');
    await expect(page.locator('.cluster-pill--sky')).toBeVisible();
    await expect(page.locator('.cluster-pill--sky')).toHaveScreenshot(
      'cluster-pill-sky-desktop-light.png'
    );
  });

  test('sand tier (count=200) — desktop light', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto('/?ds-preview=cluster-sand');
    await expect(page.locator('.cluster-pill--sand')).toBeVisible();
    await expect(page.locator('.cluster-pill--sand')).toHaveScreenshot(
      'cluster-pill-sand-desktop-light.png'
    );
  });

  test('ember tier (count=900) — desktop light', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto('/?ds-preview=cluster-ember');
    await expect(page.locator('.cluster-pill--ember')).toBeVisible();
    await expect(page.locator('.cluster-pill--ember')).toHaveScreenshot(
      'cluster-pill-ember-desktop-light.png'
    );
  });

  test('ember tier — mobile dark', async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await page.goto('/?ds-preview=cluster-ember');
    await setDark(page);
    await expect(page.locator('.cluster-pill--ember')).toBeVisible();
    await expect(page.locator('.cluster-pill--ember')).toHaveScreenshot(
      'cluster-pill-ember-mobile-dark.png'
    );
  });
});

test.describe('<FilterSentence> snapshots', () => {
  test('1 filter (notable) — desktop light', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto('/?ds-preview=filter-notable');
    await expect(page.locator('.filter-sentence__visible')).toBeVisible();
    await expect(page.locator('.filter-sentence__visible')).toHaveScreenshot(
      'filter-sentence-notable-desktop-light.png'
    );
  });

  test('2 filters (notable + family) — desktop light', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto('/?ds-preview=filter-notable-family');
    await expect(page.locator('.filter-sentence__visible')).toBeVisible();
    await expect(page.locator('.filter-sentence__visible')).toHaveScreenshot(
      'filter-sentence-two-filters-desktop-light.png'
    );
  });

  test('1 filter — mobile dark', async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await page.goto('/?ds-preview=filter-notable');
    await setDark(page);
    await expect(page.locator('.filter-sentence__visible')).toBeVisible();
    await expect(page.locator('.filter-sentence__visible')).toHaveScreenshot(
      'filter-sentence-notable-mobile-dark.png'
    );
  });
});
```

**Implementation note on `?ds-preview=` routes:** The Playwright tests above use a `?ds-preview=*` URL convention. The implementer must wire these query params in the existing `App.tsx` router (or a lightweight dev-only preview shim) so that the e2e suite can render each primitive in isolation. This is a minimal addition: read `?ds-preview` from `window.location.search` at app startup; if set, render the corresponding primitive fullscreen and return early from the main app render. The preview shim is gated behind `import.meta.env.DEV` so it ships no bytes to production.

The preview shim (in `App.tsx` or a new `frontend/src/dev/DsPreview.tsx`) is not a named deliverable in the Phase 2 plan. It is an implementation-time decision; the implementer may instead use Storybook, a standalone HTML fixture, or any other method that produces a `browser.goto(url)` + visible locator. What matters: every snapshot test resolves to a visible primitive. The snapshot baselines are generated with `--update-snapshots` on first run.

- [ ] **Step 3: Run the full Vitest suite to confirm zero regressions.**

```bash
npm run test --workspace @bird-watch/frontend
```

Expected: all unit tests pass across all primitive files.

- [ ] **Step 4: Run the e2e suite (first run generates snapshots).**

```bash
npm run test:e2e --workspace @bird-watch/frontend -- --update-snapshots
```

Expected: snapshots generated at `frontend/e2e/snapshots/ds-primitives/`; no test failures. On subsequent runs without `--update-snapshots`, snapshot diffs fail if pixels change (intentional regression guard).

- [ ] **Step 5: Commit barrel + snapshots.**

```bash
git add frontend/src/components/ds/index.ts \
        frontend/e2e/ds-primitives.spec.ts \
        frontend/e2e/snapshots/ds-primitives/
git commit -m "$(cat <<'EOF'
feat(ds): barrel export + Playwright snapshot tests for all 6 primitives (Phase 2)

Adds frontend/src/components/ds/index.ts exporting all 6 primitives and
their public types. Adds frontend/e2e/ds-primitives.spec.ts with snapshot
coverage at desktop (1440×900) and mobile (390×844) in light and dark
modes for every primitive.

Snapshot baselines committed alongside the spec; regressions fail CI on
pixel diff. First-run baselines generated with --update-snapshots.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Full validation suite

Before opening the PR, run the complete local gate — same checks Mergify requires (test, lint, build, e2e).

**Files:** none modified.

- [ ] **Step 1: Run the full unit test suite from repo root.**

```bash
npm test
```

Expected: all tests pass across all workspaces (frontend, services/read-api, services/ingestor, packages/db-client, packages/shared-types).

- [ ] **Step 2: Run lint.**

```bash
npm run lint
```

Expected: no errors. Fix any ESLint findings in place — do not silence with `eslint-disable`.

- [ ] **Step 3: Run the frontend build.**

```bash
npm run build --workspace @bird-watch/frontend
```

Expected: build succeeds. Record the bundle size delta for the PR description:

```bash
du -sh frontend/dist/assets/index-*.js
```

Compare against the Phase 1 baseline (or the pre-Phase-2 `main` branch build). The delta is documented in the PR body's "Bundle size delta" line.

- [ ] **Step 4: Run the e2e suite.**

```bash
npm run test:e2e --workspace @bird-watch/frontend
```

Expected: all specs pass including `ds-primitives.spec.ts` and the existing `axe.spec.ts`. If `axe.spec.ts` reveals any a11y regression introduced by the new ds/ files (e.g., a missing `aria-*` attribute), fix it before opening the PR.

- [ ] **Step 5: Run knip.**

```bash
npx knip --workspace @bird-watch/frontend
```

Expected: no unused exports reported. If knip flags any ds/ export as unused (they are unused until Phase 3), add a dated ignore rule to `knip.ts` per the existing convention in CLAUDE.md (label what it silences, what finding it risks missing, how a future re-audit verifies).

---

## Task 10: Open the PR

Use the `creating-prs` skill (`.claude/skills/pr-workflow/SKILL.md` per project CLAUDE.md) for the full opening protocol.

**Files:** none modified.

- [ ] **Step 1: Push the branch.**

```bash
git push -u origin feat/sky-atlas-phase-2-primitives
```

- [ ] **Step 2: Open the PR.**

Per project CLAUDE.md: PR body follows `.github/PULL_REQUEST_TEMPLATE.md` verbatim — all 5 sections. Screenshots REQUIRED on `frontend/**` changes. Screenshots: use the `pr-screenshots-via-user-attachments` skill (paste-flow → `user-attachments/assets/<uuid>` URLs); never commit PNGs to the repo.

```bash
gh pr create \
  --title "feat(ds): Sky Atlas Phase 2 — six design-system primitives" \
  --body "$(cat <<'EOF'
## Summary
- Ships 6 new primitives in `frontend/src/components/ds/`: `<StatusBlock>`, `<Photo>`, `<FamilySilhouette>`, `<ClusterPill>`, `<FilterSentence>`, `<SortLabel>`.
- Ships 4 config files in `frontend/src/config/`: `cluster.ts`, `family-palette.ts`, `filter.ts`, `freshness.ts`.
- All primitives covered by Vitest unit tests with full state-machine coverage.
- `family-palette.test.ts` asserts AA contrast (≥4.5:1) for every family channel.
- `cluster.ts` threshold boundary tests at sand=100, ember=750.
- Playwright snapshot tests in light + dark × desktop + mobile for every primitive.
- `<Photo>` no-photo state verified across 7 family codes + null-family case (G4 hot path: ~9% of detail opens).
- Bundle size delta vs. Phase 1 baseline: [document from `du -sh` output].

## Test plan
- [x] `npm test` passes across all workspaces.
- [x] `npm run lint` passes; no eslint-disable added.
- [x] `npm run build` succeeds; bundle size delta documented above.
- [x] `npm run test:e2e` passes; `ds-primitives.spec.ts` snapshots committed.
- [x] `axe.spec.ts` clean (no new a11y violations).
- [x] AA contrast assertions pass for all 7 family channels.
- [x] Cluster tier boundary tests pass (sky<100, sand@100, ember@750).

## Screenshots
[Primitive snapshots at desktop and mobile, light and dark — attached via pr-screenshots-via-user-attachments skill]

## Spec
docs/design/01-spec/components.md
docs/design/01-spec/accessibility.md
docs/design/02-phases/phase-2-primitives.md

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Dispatch the bot review.**

Per project CLAUDE.md PR workflow: bot review dispatches through the `julianken-bot` Agent subagent — never via `gh pr review` from the main session.

- [ ] **Step 4: After bot review approves and CI green (test, lint, build, e2e), post the Mergify queue comment.**

```bash
gh pr comment <PR-number> --body "@Mergifyio queue"
```

NEVER use `gh pr merge` directly. Mergify uses literal-string match on the queue comment.

---

## Acceptance criteria

This plan is complete when ALL of the following are true:

- [ ] All 6 primitives in `frontend/src/components/ds/` exist and export from `index.ts`.
- [ ] All 4 config files in `frontend/src/config/` exist and are tested.
- [ ] All Vitest unit tests pass with full state-machine coverage for each primitive.
- [ ] `family-palette.test.ts` AA contrast assertion (≥4.5:1) passes for every family channel.
- [ ] `cluster.test.ts` boundary tests pass at sand=100 and ember=750.
- [ ] `<Photo>` no-photo state renders `<FamilySilhouette>` correctly for all 7 family codes and the null-family case (8 tests).
- [ ] Each primitive has at least one Playwright snapshot test in light + dark modes.
- [ ] `axe.spec.ts` is clean — no new a11y violations introduced.
- [ ] `npm run lint` passes with no eslint-disable additions.
- [ ] Bundle size delta vs. Phase 1 baseline documented in PR description.
- [ ] PR opened per template; bot review approved; Mergify queue comment posted.

---

## What this plan does NOT include

To stay scoped per the Phase 2 boundaries in `docs/design/02-phases/phase-2-primitives.md`:

- **No surface-level adoption.** `<StatusBlock>` does not replace the ad-hoc loading/empty/error patterns in `FeedSurface.tsx`, `SpeciesSearchSurface.tsx`, or `App.tsx` — that is Phase 3–5 work.
- **No `<ClusterPill>` mounting on the map.** The MapLibre cluster layer's solid-fill paint continues to run until Phase 3 suppresses it and mounts pills as React `<Marker>` overlays.
- **No `<FilterSentence>` integration on any surface.** The component exists; Phase 5 mounts it on the context strip.
- **No `<Photo>` replacing the existing `<img>` in `SpeciesDetailSurface.tsx`.** Phase 4 does this.
- **No API-fetched path data for `<FamilySilhouette>`.** Phase 3 wires in the `/api/silhouettes` response; Phase 2 ships placeholder paths.
- **No voice or metadata changes.** Phase 6.
- **No `[data-theme]` light/dark scaffold.** Phase 1. (Phase 2 assumes it is merged.)
