# Sky Atlas — Phase 5 Feed + Species Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the Sky Atlas visual treatment to the feed and species surfaces. Feed gets the newspaper lede (4-template state machine), a top-notable elevated `<FeedCard>`, flat list rows via `<FeedRow>` with `<FamilySilhouette>` thumbs replacing emoji, and a `<SortLabel>` sibling above `<FilterSentence>`. Species surface sharpens visual contrast between the hero autocomplete (navigates) and the chip-shaped header filter control (narrows in place). `<FilterSentence>` mounts on Feed and Species surfaces (Map surface is a no-op here — Phase 3 already handled it).

**Architecture:** Frontend-only. Six new/refactored files under `frontend/src/components/`. No API contract changes. No new dependencies. The existing `<SpeciesAutocomplete>` (354-line WAI-ARIA 1.2 combobox — `frontend/src/components/SpeciesAutocomplete.tsx`) is preserved intact; only `<SpeciesSearchSurface>` changes its visual shell. The `<ObservationFeedRow>` module is refactored into `<FeedRow>` + `<FeedCard>` but the old export is kept as a re-export alias so existing tests compile without change.

**Tech Stack:** TypeScript, React 18, Vitest 4, `@testing-library/react`, Playwright MCP for UI verification. Vite 8. No new npm packages.

**Dependencies required before this plan runs:**
- Phase 2 merged: `<FilterSentence>`, `<FamilySilhouette>`, `<SortLabel>` exist in `frontend/src/components/ds/`
- Phase 3 merged: surface chrome pattern (lede strip) established on `<MapSurface>`

---

## Spec reference

- Phase scope: `docs/design/02-phases/phase-5-feed-species.md`
- Components: `docs/design/01-spec/components.md` (`<FilterSentence>`, `<FamilySilhouette>`, `<SortLabel>`)
- Voice / lede contract: `docs/design/01-spec/voice-and-content.md`
- Accessibility: `docs/design/01-spec/accessibility.md` (FilterSentence live region, 500ms debounce, 1500ms clear hold)

## File structure

| File | Disposition | Responsibility |
|---|---|---|
| `frontend/src/components/FeedRow.tsx` | Create (refactored from `ObservationFeedRow.tsx`) | Flat list row; `<FamilySilhouette>` thumb; preserves existing ARIA contract |
| `frontend/src/components/FeedRow.test.tsx` | Create | TDD tests for `<FeedRow>`; extended from `ObservationFeedRow.test.tsx` contract |
| `frontend/src/components/FeedCard.tsx` | Create | Elevated card treatment for the top-notable row |
| `frontend/src/components/FeedCard.test.tsx` | Create | TDD tests for `<FeedCard>` |
| `frontend/src/components/FeedSurface.tsx` | Modify | Lede, `<SortLabel>`, `<FilterSentence>`, top-notable `<FeedCard>`, flat `<FeedRow>` list |
| `frontend/src/components/FeedSurface.test.tsx` | Modify | Add lede, SortLabel, FeedCard, FilterSentence contract tests |
| `frontend/src/components/ObservationFeedRow.tsx` | Modify (thin re-export) | Keep existing export as alias to `<FeedRow>` so downstream consumers don't break |
| `frontend/src/components/SpeciesSearchSurface.tsx` | Modify | Hero autocomplete visual sharpening; mount `<FilterSentence>` |
| `frontend/src/components/SpeciesSearchSurface.test.tsx` | Modify | Assert visual-contrast classes, FilterSentence mount |
| `frontend/src/config/filter.ts` | Verify (Phase 2 ships) | `FILTER_SENTENCE_DEBOUNCE_MS = 500`, `FILTER_SENTENCE_CLEAR_HOLD_MS = 1500` |
| `frontend/src/config/freshness.ts` | Verify (Phase 2 ships) | `FRESHNESS_FRESH_MAX_MS`, `FRESHNESS_RECENT_MAX_MS` thresholds |

---

## Task 1: Verify Phase 2 shipped `frontend/src/config/filter.ts` and `frontend/src/config/freshness.ts`

These constants are imported by `<FilterSentence>` and `<FeedSurface>` for debounce behaviour and lede state. **Phase 2 (`docs/plans/2026-05-09-sky-atlas-phase-2-primitives.md`) creates both files** as part of the `<FilterSentence>` primitive landing — see Phase 2 file structure and Task 2. This phase only verifies the value contracts hold; if the verification fails, fix Phase 2's plan, do not patch over it here.

**Files (read-only):**
- Verify exists: `frontend/src/config/filter.ts`
- Verify exists: `frontend/src/config/freshness.ts`

- [ ] **Step 1: Confirm files exist on the branch base.**

```bash
test -f frontend/src/config/filter.ts && \
test -f frontend/src/config/freshness.ts && \
echo OK
```

Expected: `OK`. If either file is missing, Phase 2 has not merged — STOP and resolve the dependency (do not create the files in this phase).

- [ ] **Step 2: Confirm the four value contracts via Phase 2's tests.**

Phase 2 ships `frontend/src/config/filter.test.ts` and `frontend/src/config/freshness.test.ts` alongside the source modules. Re-run those tests through the existing Vitest toolchain (no separate runtime needed — the frontend workspace is TypeScript-only with `noEmit: true`, so direct `node` import of `.js` paths would fail):

```bash
npm run test --workspace @bird-watch/frontend -- \
  frontend/src/config/filter.test.ts \
  frontend/src/config/freshness.test.ts
```

Expected: all 5 assertions pass — `FILTER_SENTENCE_DEBOUNCE_MS === 500`, `FILTER_SENTENCE_CLEAR_HOLD_MS === 1500`, `FRESHNESS_FRESH_MAX_MS === 30 * 60 * 1000`, `FRESHNESS_RECENT_MAX_MS === 6 * 60 * 60 * 1000`, `FRESHNESS_FRESH_MAX_MS < FRESHNESS_RECENT_MAX_MS`. The four numeric values are accessibility/content contracts spec'd in `docs/design/01-spec/accessibility.md` §FilterSentence live region and `docs/design/01-spec/voice-and-content.md` §Lede contract. If any assertion fails, the bug is in Phase 2's implementation — open an issue against Phase 2, do not edit those files here.

- [ ] **Step 3: No commit.**

This task is verification-only and produces no diff. Proceed to Task 2.

---

## Task 2: Create `<FeedRow>` — refactor `<ObservationFeedRow>` to consume `<FamilySilhouette>` thumb

`<ObservationFeedRow>` currently renders a "!" glyph badge for notable rows and no thumbnail. Phase 5 replaces the emoji/glyph approach with a `<FamilySilhouette layout="thumb">` in the leading slot and moves the notable signal to a text meta-label on `<FeedCard>` only. The flat list row (`<FeedRow>`) always renders the silhouette thumb; the notable badge on flat rows becomes a compact visual class modifier, not a separate glyph, so the ARIA label contract is preserved unchanged.

**Files:**
- Create: `frontend/src/components/FeedRow.tsx`
- Create: `frontend/src/components/FeedRow.test.tsx`
- Modify: `frontend/src/components/ObservationFeedRow.tsx` (thin re-export alias)

**Prerequisite:** Phase 2's `<FamilySilhouette>` exists at `frontend/src/components/ds/FamilySilhouette.tsx` with the prop contract from `docs/design/01-spec/components.md`:
```typescript
type FamilySilhouetteProps = {
  family: string | null;   // FamilyCode | null
  layout?: 'inline' | 'masthead' | 'thumb';
  shape?: 'circle' | 'square' | 'pentagon' | 'diamond';
};
```

- [ ] **Step 1: Write failing tests for `<FeedRow>`.**

Create `frontend/src/components/FeedRow.test.tsx`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Observation } from '@bird-watch/shared-types';
import { FeedRow } from './FeedRow.js';

const NOW = new Date(2026, 3, 15, 15, 0, 0, 0);

const BASE_OBS: Observation = {
  subId: 'S001',
  speciesCode: 'vermfly',
  comName: 'Vermilion Flycatcher',
  lat: 32.2,
  lng: -110.9,
  obsDt: new Date(NOW.getTime() - 15 * 60_000).toISOString(),
  locId: 'L001',
  locName: 'Sabino Canyon',
  howMany: 1,
  isNotable: false,
  regionId: null,
  silhouetteId: null,
  familyCode: 'tyrannidae',
};

describe('FeedRow', () => {
  it('renders a <FamilySilhouette> thumb in the leading slot', () => {
    render(
      <FeedRow
        observation={BASE_OBS}
        now={NOW}
        onSelectSpecies={() => {}}
      />
    );
    // Phase 2's <FamilySilhouette layout="thumb"> renders with
    // data-testid="family-silhouette" and data-family="tyrannidae"
    const thumb = screen.getByTestId('family-silhouette');
    expect(thumb).toBeInTheDocument();
    expect(thumb).toHaveAttribute('data-family', 'tyrannidae');
    expect(thumb).toHaveAttribute('data-layout', 'thumb');
  });

  it('renders the null-family neutral path when familyCode is null', () => {
    render(
      <FeedRow
        observation={{ ...BASE_OBS, familyCode: null }}
        now={NOW}
        onSelectSpecies={() => {}}
      />
    );
    const thumb = screen.getByTestId('family-silhouette');
    expect(thumb).toHaveAttribute('data-family', 'null');
  });

  it('renders comName, locName, and relative time', () => {
    render(
      <FeedRow observation={BASE_OBS} now={NOW} onSelectSpecies={() => {}} />
    );
    expect(screen.getByText('Vermilion Flycatcher')).toBeInTheDocument();
    expect(screen.getByText('Sabino Canyon')).toBeInTheDocument();
    expect(screen.getByText('15 min ago')).toBeInTheDocument();
  });

  it('renders a count chip "×N" when howMany > 1', () => {
    render(
      <FeedRow
        observation={{ ...BASE_OBS, howMany: 5 }}
        now={NOW}
        onSelectSpecies={() => {}}
      />
    );
    expect(screen.getByText('×5')).toBeInTheDocument();
  });

  it('renders "—" when howMany is null', () => {
    render(
      <FeedRow
        observation={{ ...BASE_OBS, howMany: null }}
        now={NOW}
        onSelectSpecies={() => {}}
      />
    );
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('omits count chip when howMany is 1 (solo sighting)', () => {
    render(
      <FeedRow
        observation={{ ...BASE_OBS, howMany: 1 }}
        now={NOW}
        onSelectSpecies={() => {}}
      />
    );
    expect(screen.queryByText(/×\d/)).toBeNull();
  });

  it('applies feed-row-notable class modifier when isNotable is true', () => {
    render(
      <FeedRow
        observation={{ ...BASE_OBS, isNotable: true }}
        now={NOW}
        onSelectSpecies={() => {}}
      />
    );
    // Flat row notable is a class modifier only — no separate glyph badge.
    // The ARIA label still carries the Notable signal in the accessible name.
    const btn = screen.getByRole('button');
    expect(btn).toHaveClass('feed-row-notable');
  });

  it('preserves the five-slot ARIA accessible name contract', () => {
    render(
      <FeedRow
        observation={{ ...BASE_OBS, isNotable: true, howMany: 7 }}
        now={NOW}
        onSelectSpecies={() => {}}
      />
    );
    expect(screen.getByRole('button')).toHaveAccessibleName(
      'Notable sighting, Vermilion Flycatcher, 7 birds, at Sabino Canyon, 15 min ago',
    );
  });

  it('omits notable prefix, count, and location when absent', () => {
    render(
      <FeedRow
        observation={{ ...BASE_OBS, isNotable: false, howMany: 1, locName: null }}
        now={NOW}
        onSelectSpecies={() => {}}
      />
    );
    expect(screen.getByRole('button')).toHaveAccessibleName(
      'Vermilion Flycatcher, 15 min ago',
    );
  });

  it('announces "count unknown" when howMany is null', () => {
    render(
      <FeedRow
        observation={{ ...BASE_OBS, howMany: null, locName: null }}
        now={NOW}
        onSelectSpecies={() => {}}
      />
    );
    expect(screen.getByRole('button')).toHaveAccessibleName(
      'Vermilion Flycatcher, count unknown, 15 min ago',
    );
  });

  it('fires onSelectSpecies with the species code on click', async () => {
    const onSelectSpecies = vi.fn();
    const user = userEvent.setup();
    render(
      <FeedRow
        observation={BASE_OBS}
        now={NOW}
        onSelectSpecies={onSelectSpecies}
      />
    );
    await user.click(screen.getByRole('button'));
    expect(onSelectSpecies).toHaveBeenCalledWith('vermfly');
  });

  it('fires onSelectSpecies on Enter keypress', async () => {
    const onSelectSpecies = vi.fn();
    const user = userEvent.setup();
    render(
      <FeedRow observation={BASE_OBS} now={NOW} onSelectSpecies={onSelectSpecies} />
    );
    screen.getByRole('button').focus();
    await user.keyboard('{Enter}');
    expect(onSelectSpecies).toHaveBeenCalledWith('vermfly');
  });

  it('is a React.memo component', () => {
    const MemoSymbol = Symbol.for('react.memo');
    expect(
      (FeedRow as unknown as { $$typeof: symbol }).$$typeof
    ).toBe(MemoSymbol);
  });

  it('renders inside an <li> so it composes correctly inside <ol>', () => {
    const { container } = render(
      <FeedRow observation={BASE_OBS} now={NOW} onSelectSpecies={() => {}} />
    );
    expect(container.firstChild?.nodeName).toBe('LI');
  });
});
```

- [ ] **Step 2: Run to confirm failures.**

```bash
npm run test --workspace @bird-watch/frontend -- FeedRow.test.tsx
```

Expected: module-not-found error. All tests fail.

- [ ] **Step 3: Create `frontend/src/components/FeedRow.tsx`.**

```typescript
import { memo } from 'react';
import type { Observation } from '@bird-watch/shared-types';
import { formatRelativeTime } from '../utils/format-time.js';
import { FamilySilhouette } from './ds/FamilySilhouette.js';

export interface FeedRowProps {
  observation: Observation;
  now: Date;
  onSelectSpecies: (speciesCode: string) => void;
}

/**
 * Flat feed list row. Replaces the emoji/glyph approach of the v3 mock with
 * a `<FamilySilhouette layout="thumb">` in the leading slot. The silhouette
 * is always present: null familyCode renders the neutral grey generic-bird
 * path (see docs/design/01-spec/components.md §<FamilySilhouette>).
 *
 * DOM structure:
 *   <li .feed-row-item>
 *     <button .feed-row [.feed-row-notable]>
 *       <FamilySilhouette layout="thumb" />   ← leading silhouette thumb
 *       <span .feed-row-name>comName</span>
 *       [<span .feed-row-count>×N</span>]     ← omitted when howMany === 1
 *       [<span .feed-row-count-unknown>—</span>]  ← when howMany === null
 *       [<span .feed-row-loc>locName</span>]
 *       <span .feed-row-time>relative time</span>
 *     </button>
 *   </li>
 *
 * ARIA contract (preserved from ObservationFeedRow, issue #117):
 *   Single aria-label on the button combines all five slots in fixed order:
 *   notable flag → comName → count → locName → relative time.
 *   All child spans are aria-hidden. The button receives focus; Enter/Space
 *   activate natively. The <li> keeps the list structure intact per WCAG
 *   (aria-required-children on <ol> expects listitem, not button directly).
 *
 * Notable on flat rows: class modifier `.feed-row-notable` only.
 *   No separate "!" glyph badge (that lives on <FeedCard> for the elevated
 *   card treatment). Color alone is not the signal — the class adds a left
 *   border accent per the accent-discipline rules (colour + structural
 *   discriminator). The ARIA label prefix "Notable sighting" is preserved.
 *
 * Memoised for the same reason as ObservationFeedRow: a 300+ row feed must
 * not re-render every row on filter toggle or tab focus. Requires
 * identity-stable onSelectSpecies (useCallback in parent).
 */
function FeedRowImpl(props: FeedRowProps) {
  const { observation, now, onSelectSpecies } = props;

  function activate() {
    onSelectSpecies(observation.speciesCode);
  }

  const countContent: { chip: string | null; dash: boolean } =
    observation.howMany === null
      ? { chip: null, dash: true }
      : observation.howMany > 1
      ? { chip: `×${observation.howMany}`, dash: false }
      : { chip: null, dash: false };

  const countSlot =
    observation.howMany === null
      ? 'count unknown'
      : observation.howMany > 1
      ? `${observation.howMany} birds`
      : null;

  const ariaLabel = [
    observation.isNotable ? 'Notable sighting' : null,
    observation.comName,
    countSlot,
    observation.locName ? `at ${observation.locName}` : null,
    formatRelativeTime(observation.obsDt, now),
  ]
    .filter((s): s is string => s !== null)
    .join(', ');

  return (
    <li className="feed-row-item">
      <button
        type="button"
        className={`feed-row${observation.isNotable ? ' feed-row-notable' : ''}`}
        aria-label={ariaLabel}
        onClick={activate}
      >
        <FamilySilhouette
          family={observation.familyCode}
          layout="thumb"
        />
        <span className="feed-row-name" aria-hidden="true">{observation.comName}</span>
        {countContent.chip !== null && (
          <span className="feed-row-count" aria-hidden="true">
            {countContent.chip}
          </span>
        )}
        {countContent.dash && (
          <span className="feed-row-count feed-row-count-unknown" aria-hidden="true">—</span>
        )}
        {observation.locName !== null && (
          <span className="feed-row-loc" aria-hidden="true">{observation.locName}</span>
        )}
        <span className="feed-row-time" aria-hidden="true">
          {formatRelativeTime(observation.obsDt, now)}
        </span>
      </button>
    </li>
  );
}

export const FeedRow = memo(FeedRowImpl);
```

- [ ] **Step 4: Update `ObservationFeedRow.tsx` to re-export `FeedRow` as the existing named export.**

This keeps every consumer that imports `ObservationFeedRow` compiling without change. The existing test file (`ObservationFeedRow.test.tsx`) continues to pass because the component contract is identical.

Replace the content of `frontend/src/components/ObservationFeedRow.tsx` with:

```typescript
/**
 * Compatibility re-export shim — Sky Atlas Phase 5.
 *
 * ObservationFeedRow has been refactored into FeedRow (which adds the
 * <FamilySilhouette> thumb) and FeedCard (elevated notable treatment).
 * This shim preserves the existing named export so callers that haven't
 * migrated continue to compile and render correctly.
 *
 * Callers should migrate to importing from FeedRow.tsx directly. This
 * shim will be removed in Phase 6 cleanup.
 */
export { FeedRow as ObservationFeedRow } from './FeedRow.js';
export type { FeedRowProps as ObservationFeedRowProps } from './FeedRow.js';
```

- [ ] **Step 5: Run FeedRow tests and the full existing ObservationFeedRow test suite.**

```bash
npm run test --workspace @bird-watch/frontend -- FeedRow.test.tsx ObservationFeedRow.test.tsx
```

Expected: all FeedRow tests pass. ObservationFeedRow tests continue to pass (shim preserves the contract — the test imports `ObservationFeedRow` which now resolves to `FeedRow`; the accessible name contract, memo contract, count chip contract are all preserved). Note: the existing `ObservationFeedRow.test.tsx` test for the "!" badge `title="Notable sighting"` will need updating — `<FeedRow>` no longer renders the separate glyph span. Update that assertion to check `aria-label` instead:

In `ObservationFeedRow.test.tsx`, find:
```typescript
    expect(screen.getByTitle('Notable sighting')).toHaveAttribute('aria-hidden', 'true');
```
and replace with:
```typescript
    // FeedRow encodes notable in the button aria-label; no separate glyph span.
    expect(screen.getByRole('button')).toHaveAccessibleName(
      expect.stringContaining('Notable sighting'),
    );
```

Rerun to confirm both test files pass.

- [ ] **Step 6: Run the full frontend test suite.**

```bash
npm run test --workspace @bird-watch/frontend
```

Expected: all tests pass. No other file imports `ObservationFeedRow` in a way that breaks (the re-export shim is transparent).

- [ ] **Step 7: Commit.**

```bash
git add frontend/src/components/FeedRow.tsx frontend/src/components/FeedRow.test.tsx \
        frontend/src/components/ObservationFeedRow.tsx \
        frontend/src/components/ObservationFeedRow.test.tsx
git commit -m "$(cat <<'EOF'
feat(feed): add <FeedRow> with <FamilySilhouette> thumb (Sky Atlas Phase 5)

Refactors ObservationFeedRow into FeedRow, which adds a <FamilySilhouette
layout="thumb"> in the leading slot, replacing the v3 emoji/glyph approach.
The null-family neutral path (grey generic bird) handles ~2% of observations
where familyCode is null. The five-slot ARIA label contract is preserved
verbatim. ObservationFeedRow.tsx becomes a compatibility shim.

Spec: docs/design/02-phases/phase-5-feed-species.md
      docs/design/01-spec/components.md §<FamilySilhouette>

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Create `<FeedCard>` — elevated notable treatment

The top-notable card-row is the first item in the feed when any `isNotable` observation exists. It renders at elevated visual weight: larger silhouette, NOTABLE meta-label using `--color-accent-notable-fg` (not `--color-decision-point` — distinct tokens per accent discipline), and a brief location + time line below the species name.

**Files:**
- Create: `frontend/src/components/FeedCard.tsx`
- Create: `frontend/src/components/FeedCard.test.tsx`

- [ ] **Step 1: Write failing tests for `<FeedCard>`.**

Create `frontend/src/components/FeedCard.test.tsx`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Observation } from '@bird-watch/shared-types';
import { FeedCard } from './FeedCard.js';

const NOW = new Date(2026, 3, 15, 15, 0, 0, 0);

const NOTABLE_OBS: Observation = {
  subId: 'S001',
  speciesCode: 'vermfly',
  comName: 'Vermilion Flycatcher',
  lat: 32.2,
  lng: -110.9,
  obsDt: new Date(NOW.getTime() - 10 * 60_000).toISOString(),
  locId: 'L001',
  locName: 'Sabino Canyon',
  howMany: 3,
  isNotable: true,
  regionId: null,
  silhouetteId: null,
  familyCode: 'tyrannidae',
};

describe('FeedCard', () => {
  it('renders the NOTABLE meta-label', () => {
    render(
      <FeedCard observation={NOTABLE_OBS} now={NOW} onSelectSpecies={() => {}} />
    );
    // Text label "NOTABLE" must be present — notable token is amplification,
    // not sole signal per docs/design/01-spec/accessibility.md §color-independent.
    expect(screen.getByText('NOTABLE')).toBeInTheDocument();
  });

  it('applies the feed-card-meta class to the NOTABLE label (not decision-point)', () => {
    render(
      <FeedCard observation={NOTABLE_OBS} now={NOW} onSelectSpecies={() => {}} />
    );
    const label = screen.getByText('NOTABLE');
    // Must use .feed-card-meta which maps to --color-accent-notable-fg,
    // never --color-decision-point. Verified structurally here; visual
    // token separation is enforced by the stylelint guard in package.json.
    expect(label).toHaveClass('feed-card-meta');
  });

  it('renders a <FamilySilhouette layout="inline"> at elevated scale', () => {
    render(
      <FeedCard observation={NOTABLE_OBS} now={NOW} onSelectSpecies={() => {}} />
    );
    const silhouette = screen.getByTestId('family-silhouette');
    // Card uses inline layout (larger than thumb) for the elevated treatment.
    expect(silhouette).toHaveAttribute('data-layout', 'inline');
    expect(silhouette).toHaveAttribute('data-family', 'tyrannidae');
  });

  it('renders comName as the card heading', () => {
    render(
      <FeedCard observation={NOTABLE_OBS} now={NOW} onSelectSpecies={() => {}} />
    );
    expect(screen.getByRole('heading', { name: /Vermilion Flycatcher/i })).toBeInTheDocument();
  });

  it('renders location and relative time in the card meta line', () => {
    render(
      <FeedCard observation={NOTABLE_OBS} now={NOW} onSelectSpecies={() => {}} />
    );
    expect(screen.getByText(/Sabino Canyon/)).toBeInTheDocument();
    expect(screen.getByText('10 min ago')).toBeInTheDocument();
  });

  it('renders count chip when howMany > 1', () => {
    render(
      <FeedCard observation={NOTABLE_OBS} now={NOW} onSelectSpecies={() => {}} />
    );
    // NOTABLE_OBS has howMany: 3
    expect(screen.getByText('×3')).toBeInTheDocument();
  });

  it('carries a comprehensive accessible name on the interactive region', () => {
    render(
      <FeedCard observation={NOTABLE_OBS} now={NOW} onSelectSpecies={() => {}} />
    );
    // Card is a button for keyboard navigation; accessible name mirrors
    // the FeedRow five-slot contract so SR experience is consistent.
    expect(screen.getByRole('button')).toHaveAccessibleName(
      'Notable sighting, Vermilion Flycatcher, 3 birds, at Sabino Canyon, 10 min ago',
    );
  });

  it('fires onSelectSpecies with the species code on click', async () => {
    const onSelectSpecies = vi.fn();
    const user = userEvent.setup();
    render(
      <FeedCard observation={NOTABLE_OBS} now={NOW} onSelectSpecies={onSelectSpecies} />
    );
    await user.click(screen.getByRole('button'));
    expect(onSelectSpecies).toHaveBeenCalledWith('vermfly');
  });

  it('renders inside an <li> with class feed-card-item', () => {
    const { container } = render(
      <FeedCard observation={NOTABLE_OBS} now={NOW} onSelectSpecies={() => {}} />
    );
    expect(container.firstChild?.nodeName).toBe('LI');
    expect(container.firstChild).toHaveClass('feed-card-item');
  });

  it('handles null familyCode with the neutral silhouette path', () => {
    render(
      <FeedCard
        observation={{ ...NOTABLE_OBS, familyCode: null }}
        now={NOW}
        onSelectSpecies={() => {}}
      />
    );
    expect(screen.getByTestId('family-silhouette')).toHaveAttribute('data-family', 'null');
  });
});
```

- [ ] **Step 2: Run to confirm failures.**

```bash
npm run test --workspace @bird-watch/frontend -- FeedCard.test.tsx
```

Expected: module-not-found. All tests fail.

- [ ] **Step 3: Create `frontend/src/components/FeedCard.tsx`.**

```typescript
import type { Observation } from '@bird-watch/shared-types';
import { formatRelativeTime } from '../utils/format-time.js';
import { FamilySilhouette } from './ds/FamilySilhouette.js';

export interface FeedCardProps {
  observation: Observation;
  now: Date;
  onSelectSpecies: (speciesCode: string) => void;
}

/**
 * Elevated card treatment for the top-notable observation in the feed.
 *
 * Used by FeedSurface for the single most-recent notable observation. The
 * card renders at higher visual weight than <FeedRow>:
 *   - <FamilySilhouette layout="inline"> (larger than "thumb")
 *   - Species name as a heading element
 *   - NOTABLE meta-label using .feed-card-meta → --color-accent-notable-fg
 *   - Location + time on a second line
 *
 * Accent discipline: the NOTABLE label MUST reference .feed-card-meta which
 * maps to --color-accent-notable-fg. Never use --color-decision-point here.
 * The stylelint guard in package.json enforces this at CI time:
 *   grep -rE 'var\(--color-decision-point\).*notable' frontend/src/
 *
 * ARIA contract: single button wraps the entire card for keyboard nav.
 * The button's aria-label mirrors the FeedRow five-slot contract so SR
 * experience is consistent across card and row treatments:
 *   "Notable sighting, {comName}, [{N} birds,] [at {locName},] {relative time}"
 * The internal heading + meta text are aria-hidden (subsumed by aria-label).
 *
 * DOM:
 *   <li .feed-card-item>
 *     <button .feed-card [aria-label]>
 *       <FamilySilhouette layout="inline" />
 *       <div .feed-card-body>
 *         <span .feed-card-meta>NOTABLE</span>
 *         [<span .feed-card-count>×N</span>]
 *         <h2 .feed-card-name aria-hidden>comName</h2>
 *         <p .feed-card-detail aria-hidden>locName · relative time</p>
 *       </div>
 *     </button>
 *   </li>
 */
export function FeedCard(props: FeedCardProps) {
  const { observation, now, onSelectSpecies } = props;

  const countSlot =
    observation.howMany === null
      ? 'count unknown'
      : observation.howMany > 1
      ? `${observation.howMany} birds`
      : null;

  const ariaLabel = [
    'Notable sighting',
    observation.comName,
    countSlot,
    observation.locName ? `at ${observation.locName}` : null,
    formatRelativeTime(observation.obsDt, now),
  ]
    .filter((s): s is string => s !== null)
    .join(', ');

  const countChip =
    observation.howMany !== null && observation.howMany > 1
      ? `×${observation.howMany}`
      : null;

  return (
    <li className="feed-card-item">
      <button
        type="button"
        className="feed-card"
        aria-label={ariaLabel}
        onClick={() => onSelectSpecies(observation.speciesCode)}
      >
        <FamilySilhouette
          family={observation.familyCode}
          layout="inline"
        />
        <div className="feed-card-body" aria-hidden="true">
          <span className="feed-card-meta">NOTABLE</span>
          {countChip !== null && (
            <span className="feed-card-count">{countChip}</span>
          )}
          <h2 className="feed-card-name">{observation.comName}</h2>
          <p className="feed-card-detail">
            {observation.locName && <span>{observation.locName}</span>}
            <span>{formatRelativeTime(observation.obsDt, now)}</span>
          </p>
        </div>
      </button>
    </li>
  );
}
```

- [ ] **Step 4: Run FeedCard tests.**

```bash
npm run test --workspace @bird-watch/frontend -- FeedCard.test.tsx
```

Expected: all tests pass.

- [ ] **Step 5: Run the full frontend test suite (no regressions).**

```bash
npm run test --workspace @bird-watch/frontend
```

Expected: all tests pass.

- [ ] **Step 6: Commit.**

```bash
git add frontend/src/components/FeedCard.tsx frontend/src/components/FeedCard.test.tsx
git commit -m "$(cat <<'EOF'
feat(feed): add <FeedCard> elevated notable treatment (Sky Atlas Phase 5)

FeedCard renders the top-notable observation at elevated visual weight:
inline-layout FamilySilhouette, species name as h2, NOTABLE meta-label via
.feed-card-meta → --color-accent-notable-fg (distinct from --color-decision-
point per accent discipline). Single button wraps the card for keyboard nav;
five-slot ARIA label matches FeedRow contract for consistent SR experience.

Spec: docs/design/02-phases/phase-5-feed-species.md
      docs/design/01-spec/voice-and-content.md §Accent discipline

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Rewrite `<FeedSurface>` — lede, `<SortLabel>`, `<FilterSentence>`, card-row + flat list

This task integrates all Phase 5 feed components into `<FeedSurface>`. The lede implements the 4-template state machine from `docs/design/01-spec/voice-and-content.md`. `<SortLabel>` sits as a sibling ABOVE `<FilterSentence>` in the context strip. The top-notable `<FeedCard>` precedes the flat `<FeedRow>` list. Both share the same `<ol>` element so the list semantics are unified.

**Prerequisite:** Phase 2's `<FilterSentence>` and `<SortLabel>` exist at `frontend/src/components/ds/`.

**Files:**
- Modify: `frontend/src/components/FeedSurface.tsx`
- Modify: `frontend/src/components/FeedSurface.test.tsx`

- [ ] **Step 1: Write new failing tests for lede, SortLabel, FilterSentence, and FeedCard mount.**

Append these tests to `frontend/src/components/FeedSurface.test.tsx` inside the existing `describe('FeedSurface', ...)` block, before the closing `});`:

```typescript
  // --- Phase 5: lede, SortLabel, FilterSentence, FeedCard ---

  describe('lede state machine (4 templates)', () => {
    it('renders Priority 4 lede (default, no filters) with observation count', () => {
      const items = [
        obs({ subId: 'S1', speciesCode: 'vermfly' }),
        obs({ subId: 'S2', speciesCode: 'cacwre', comName: 'Cactus Wren' }),
      ];
      render(
        <FeedSurface
          loading={false}
          observations={items}
          now={NOW}
          filters={{ notable: false, since: '14d' }}
          onSelectSpecies={() => {}}
          observationCount={2}
          regionLabel="Arizona"
          period="14 days"
        />
      );
      // Template: "{N} species seen across {REGION_LABEL} in the last {period}."
      // Count is unique species, not observation rows.
      expect(screen.getByText(/species seen across Arizona/i)).toBeInTheDocument();
    });

    it('renders Priority 1 lede when observationCount is 0', () => {
      render(
        <FeedSurface
          loading={false}
          observations={[]}
          now={NOW}
          filters={{ notable: false, since: '14d' }}
          onSelectSpecies={() => {}}
          observationCount={0}
          regionLabel="Arizona"
          period="14 days"
        />
      );
      expect(screen.getByText(/No sightings match your current filters/i)).toBeInTheDocument();
    });

    it('renders Priority 2 lede when speciesCode filter is set', () => {
      const items = [obs({ subId: 'S1', speciesCode: 'vermfly', comName: 'Vermilion Flycatcher' })];
      render(
        <FeedSurface
          loading={false}
          observations={items}
          now={NOW}
          filters={{ notable: false, since: '14d' }}
          onSelectSpecies={() => {}}
          observationCount={1}
          regionLabel="Arizona"
          period="14 days"
          speciesName="Vermilion Flycatcher"
        />
      );
      // Template: "{N} sightings of {commonName} in {REGION_LABEL} in the last {period}."
      expect(screen.getByText(/sightings of Vermilion Flycatcher in Arizona/i)).toBeInTheDocument();
    });

    it('renders Priority 3 lede when familyCode filter is set', () => {
      const items = [obs({ subId: 'S1', speciesCode: 'vermfly', familyCode: 'tyrannidae' })];
      render(
        <FeedSurface
          loading={false}
          observations={items}
          now={NOW}
          filters={{ notable: false, since: '14d' }}
          onSelectSpecies={() => {}}
          observationCount={1}
          regionLabel="Arizona"
          period="14 days"
          familyName="Tyrant Flycatchers"
        />
      );
      // Template: "{N} species of {familyName} seen across {REGION_LABEL} in the last {period}."
      expect(screen.getByText(/species of Tyrant Flycatchers seen across Arizona/i)).toBeInTheDocument();
    });
  });

  describe('<SortLabel> sibling', () => {
    it('renders <SortLabel> showing "Sorted by recency" when sortMode is recent', () => {
      render(
        <FeedSurface
          loading={false}
          observations={[obs({ subId: 'S1' })]}
          now={NOW}
          filters={{ notable: false, since: '14d' }}
          onSelectSpecies={() => {}}
          observationCount={1}
          regionLabel="Arizona"
          period="14 days"
        />
      );
      // SortLabel renders its text; not coupled to FilterSentence.
      expect(screen.getByText(/Sorted by recency/i)).toBeInTheDocument();
    });

    it('SortLabel is a separate sibling from FilterSentence — not inside it', () => {
      render(
        <FeedSurface
          loading={false}
          observations={[obs({ subId: 'S1' })]}
          now={NOW}
          filters={{ notable: true, since: '14d' }}
          onSelectSpecies={() => {}}
          observationCount={1}
          regionLabel="Arizona"
          period="14 days"
        />
      );
      const sortLabel = screen.getByText(/Sorted by recency/i);
      const filterSentence = screen.getByText(/notable sightings/i);
      // Neither element contains the other.
      expect(sortLabel.contains(filterSentence)).toBe(false);
      expect(filterSentence.contains(sortLabel)).toBe(false);
    });
  });

  describe('<FilterSentence> mount', () => {
    it('mounts the always-on live region even when zero filters are active', () => {
      render(
        <FeedSurface
          loading={false}
          observations={[obs({ subId: 'S1' })]}
          now={NOW}
          filters={{ notable: false, since: '14d' }}
          onSelectSpecies={() => {}}
          observationCount={1}
          regionLabel="Arizona"
          period="14 days"
        />
      );
      // The hidden live region is always mounted per the FilterSentence spec;
      // it carries role="status" aria-live="polite".
      const liveRegion = document.querySelector('.filter-sentence-live');
      expect(liveRegion).toBeInTheDocument();
      expect(liveRegion).toHaveAttribute('aria-live', 'polite');
    });

    it('renders the visible FilterSentence when notable filter is active', () => {
      render(
        <FeedSurface
          loading={false}
          observations={[obs({ subId: 'S1', isNotable: true })]}
          now={NOW}
          filters={{ notable: true, since: '14d' }}
          onSelectSpecies={() => {}}
          observationCount={1}
          regionLabel="Arizona"
          period="14 days"
        />
      );
      // FilterSentence visible template: "Showing {filter-terms} from the last {period}."
      expect(screen.getByText(/notable sightings/i)).toBeInTheDocument();
    });

    it('FilterSentence collapses to null visually when zero filters are active', () => {
      render(
        <FeedSurface
          loading={false}
          observations={[obs({ subId: 'S1' })]}
          now={NOW}
          filters={{ notable: false, since: '14d' }}
          onSelectSpecies={() => {}}
          observationCount={1}
          regionLabel="Arizona"
          period="14 days"
        />
      );
      // At zero filters, the visible sentence element is absent from the DOM.
      // The hidden live region remains.
      expect(document.querySelector('.filter-sentence-visible')).toBeNull();
    });
  });

  describe('<FeedCard> top-notable mount', () => {
    it('renders the top-notable observation as an elevated FeedCard', () => {
      const items = [
        obs({ subId: 'S1', speciesCode: 'vermfly', comName: 'Vermilion Flycatcher', isNotable: true }),
        obs({ subId: 'S2', speciesCode: 'cacwre', comName: 'Cactus Wren', isNotable: false }),
      ];
      render(
        <FeedSurface
          loading={false}
          observations={items}
          now={NOW}
          filters={{ notable: false, since: '14d' }}
          onSelectSpecies={() => {}}
          observationCount={2}
          regionLabel="Arizona"
          period="14 days"
        />
      );
      // The NOTABLE label is the FeedCard discriminator.
      expect(screen.getByText('NOTABLE')).toBeInTheDocument();
    });

    it('does not render a FeedCard when no observations are notable', () => {
      const items = [
        obs({ subId: 'S1', isNotable: false }),
        obs({ subId: 'S2', speciesCode: 'cacwre', comName: 'Cactus Wren', isNotable: false }),
      ];
      render(
        <FeedSurface
          loading={false}
          observations={items}
          now={NOW}
          filters={{ notable: false, since: '14d' }}
          onSelectSpecies={() => {}}
          observationCount={2}
          regionLabel="Arizona"
          period="14 days"
        />
      );
      expect(screen.queryByText('NOTABLE')).toBeNull();
    });

    it('renders the top-notable card as the first item in the list', () => {
      const items = [
        obs({ subId: 'S1', speciesCode: 'cacwre', comName: 'Cactus Wren', isNotable: false }),
        obs({ subId: 'S2', speciesCode: 'vermfly', comName: 'Vermilion Flycatcher', isNotable: true }),
        obs({ subId: 'S3', speciesCode: 'annhum', comName: "Anna's Hummingbird", isNotable: false }),
      ];
      render(
        <FeedSurface
          loading={false}
          observations={items}
          now={NOW}
          filters={{ notable: false, since: '14d' }}
          onSelectSpecies={() => {}}
          observationCount={3}
          regionLabel="Arizona"
          period="14 days"
        />
      );
      const buttons = screen.getAllByRole('button');
      // First button is the FeedCard for the notable observation.
      expect(buttons[0]).toHaveAccessibleName(expect.stringContaining('Notable sighting'));
      expect(buttons[0]).toHaveAccessibleName(expect.stringContaining('Vermilion Flycatcher'));
    });

    it('clicking the FeedCard fires onSelectSpecies', async () => {
      const onSelectSpecies = vi.fn();
      const user = userEvent.setup();
      render(
        <FeedSurface
          loading={false}
          observations={[obs({ subId: 'S1', speciesCode: 'vermfly', isNotable: true })]}
          now={NOW}
          filters={{ notable: false, since: '14d' }}
          onSelectSpecies={onSelectSpecies}
          observationCount={1}
          regionLabel="Arizona"
          period="14 days"
        />
      );
      await user.click(screen.getByRole('button', { name: /Notable sighting/i }));
      expect(onSelectSpecies).toHaveBeenCalledWith('vermfly');
    });
  });
```

- [ ] **Step 2: Run to confirm failures.**

```bash
npm run test --workspace @bird-watch/frontend -- FeedSurface.test.tsx
```

Expected: new tests fail (new props not yet on the component). Existing tests should still pass (backward-compatible: new props are optional with defaults).

- [ ] **Step 3: Rewrite `frontend/src/components/FeedSurface.tsx`.**

```typescript
import { useMemo, useState } from 'react';
import type { Observation } from '@bird-watch/shared-types';
import type { Since } from '../state/url-state.js';
import type { SpeciesOption } from './FiltersBar.js';
import { FeedCard } from './FeedCard.js';
import { FeedRow } from './FeedRow.js';
import { FilterSentence } from './ds/FilterSentence.js';
import { SortLabel } from './ds/SortLabel.js';

export interface FeedSurfaceFilters {
  notable: boolean;
  since: Since;
}

export type FeedSortMode = 'recent' | 'taxonomic';

export interface FeedSurfaceProps {
  loading: boolean;
  observations: Observation[];
  now: Date;
  filters: FeedSurfaceFilters;
  onSelectSpecies: (speciesCode: string) => void;
  speciesIndex?: SpeciesOption[];
  /**
   * Total unique-species count for the lede template (Priority 4).
   * When absent, FeedSurface derives it from observations.length as a
   * rough fallback (may overcount if multiple obs share a species code).
   */
  observationCount?: number;
  /** Human-readable region label for the lede ("Arizona"). */
  regionLabel?: string;
  /** Human-readable period for the lede ("14 days"). */
  period?: string;
  /**
   * Common name of the selected species — present when speciesCode filter
   * is active. Triggers the Priority 2 lede template.
   */
  speciesName?: string;
  /**
   * Common name of the selected family — present when familyCode filter is
   * active. Triggers the Priority 3 lede template.
   */
  familyName?: string;
}

/**
 * Feed surface — Sky Atlas Phase 5.
 *
 * Lede templates (evaluated in priority order, from
 * docs/design/01-spec/voice-and-content.md §Lede contract):
 *   1. Zero results → "No sightings match your current filters."
 *   2. speciesName set → "{N} sightings of {name} in {region} in the last {period}."
 *   3. familyName set → "{N} species of {family} seen across {region} in the last {period}."
 *   4. Default → "{N} species seen across {region} in the last {period}."
 *
 * <SortLabel> is a separate sibling ABOVE <FilterSentence> in the context
 * strip. These are independent components that must NOT be composed together
 * (docs/design/01-spec/components.md §<FilterSentence>: "Sort prefix is NOT
 * this component").
 *
 * The top-notable observation (first isNotable=true in the observations array)
 * renders as an elevated <FeedCard>. Remaining observations render as flat
 * <FeedRow> items. Both are children of the same <ol> to preserve list semantics.
 *
 * Sort contract (unchanged from existing implementation):
 *   - "Recent" (default): server order preserved. No client re-sort.
 *   - "Taxonomic": taxonOrder ASC, nulls last, ties by comName.
 */
export function FeedSurface(props: FeedSurfaceProps) {
  const {
    loading,
    observations,
    now,
    filters,
    onSelectSpecies,
    speciesIndex,
    observationCount,
    regionLabel = 'Arizona',
    period = '14 days',
    speciesName,
    familyName,
  } = props;

  const [sortMode, setSortMode] = useState<FeedSortMode>('recent');

  const taxonMap = useMemo(() => {
    const map = new Map<string, number | null>();
    if (speciesIndex) {
      for (const s of speciesIndex) map.set(s.code, s.taxonOrder ?? null);
    }
    return map;
  }, [speciesIndex]);

  const visibleObservations = useMemo(() => {
    if (sortMode === 'recent') return observations;
    return observations.slice().sort((a, b) => {
      const ta = taxonMap.get(a.speciesCode) ?? null;
      const tb = taxonMap.get(b.speciesCode) ?? null;
      if (ta === null && tb === null) return a.comName.localeCompare(b.comName);
      if (ta === null) return 1;
      if (tb === null) return -1;
      if (ta === tb) return a.comName.localeCompare(b.comName);
      return ta - tb;
    });
  }, [observations, sortMode, taxonMap]);

  // Derive the lede string using the 4-template priority state machine.
  // Templates are explicit branches — no string-template engine.
  // (docs/design/01-spec/voice-and-content.md §Templates are explicit)
  const effectiveCount = observationCount ?? observations.length;
  const lede: string = useMemo(() => {
    if (effectiveCount === 0) {
      return 'No sightings match your current filters.';
    }
    if (speciesName) {
      return `${effectiveCount} sightings of ${speciesName} in ${regionLabel} in the last ${period}.`;
    }
    if (familyName) {
      return `${effectiveCount} species of ${familyName} seen across ${regionLabel} in the last ${period}.`;
    }
    return `${effectiveCount} species seen across ${regionLabel} in the last ${period}.`;
  }, [effectiveCount, speciesName, familyName, regionLabel, period]);

  // Build the ActiveFilters shape expected by <FilterSentence>.
  // Phase 5 maps the existing FeedSurfaceFilters onto it.
  const activeFilters = useMemo(() => ({
    notable: filters.notable,
    since: filters.since,
    speciesCode: null as string | null,
    familyCode: null as string | null,
  }), [filters]);

  if (loading) {
    return (
      <div className="feed-empty" role="status" aria-live="polite">
        Loading observations…
      </div>
    );
  }

  if (observations.length === 0) {
    let hint: string;
    if (filters.notable) {
      hint = 'No notable sightings in this window. Try widening the time window or turning off Notable only.';
    } else if (filters.since === '1d') {
      hint = 'No observations reported today. Try expanding the time window.';
    } else {
      hint = 'No observations to show.';
    }
    return (
      <div className="feed-surface">
        <p className="feed-lede">{lede}</p>
        <div className="feed-empty" role="status">
          {hint}
        </div>
      </div>
    );
  }

  // Find the first notable observation for the elevated card treatment.
  // "First" respects the current sort order.
  const topNotableIndex = visibleObservations.findIndex(o => o.isNotable);
  const topNotable: Observation | null =
    topNotableIndex >= 0 ? visibleObservations[topNotableIndex] : null;

  // All other observations (non-card rows): if a notable is elevated,
  // exclude it from the flat list so it doesn't appear twice.
  const flatObservations: Observation[] = topNotable
    ? visibleObservations.filter(o => o !== topNotable)
    : visibleObservations;

  return (
    <div className="feed-surface">
      {/* Lede — runtime truth claim, Priority 1–4 state machine */}
      <p className="feed-lede">{lede}</p>

      {/* Context strip: SortLabel sibling ABOVE FilterSentence.
          These are independent; do not compose or merge them. */}
      <SortLabel mode={sortMode} />
      <FilterSentence filters={activeFilters} />

      {/* Sort toggle — radio group for native keyboard arrow-key traversal */}
      <div
        className="feed-sort"
        role="radiogroup"
        aria-label="Sort observations"
      >
        <label className="feed-sort-option">
          <input
            type="radio"
            name="feed-sort"
            value="recent"
            checked={sortMode === 'recent'}
            onChange={() => setSortMode('recent')}
          />
          <span>Recent</span>
        </label>
        <label className="feed-sort-option">
          <input
            type="radio"
            name="feed-sort"
            value="taxonomic"
            checked={sortMode === 'taxonomic'}
            onChange={() => setSortMode('taxonomic')}
          />
          <span>Taxonomic</span>
        </label>
      </div>

      {/* Unified observation list: top-notable card-row first, then flat rows */}
      <ol className="feed" aria-label="Observations">
        {topNotable && (
          <FeedCard
            key={`card:${topNotable.subId}:${topNotable.speciesCode}`}
            observation={topNotable}
            now={now}
            onSelectSpecies={onSelectSpecies}
          />
        )}
        {flatObservations.map(o => (
          <FeedRow
            key={`${o.subId}:${o.speciesCode}`}
            observation={o}
            now={now}
            onSelectSpecies={onSelectSpecies}
          />
        ))}
      </ol>
    </div>
  );
}
```

- [ ] **Step 4: Run all FeedSurface tests.**

```bash
npm run test --workspace @bird-watch/frontend -- FeedSurface.test.tsx
```

Expected: all new tests pass. Existing tests pass (backward-compatible: new props have defaults; existing render paths are preserved). The `loading` branch and empty-state branches still match existing assertions (`Loading observations…`, `No observations…`, notable/since hints).

- [ ] **Step 5: Run the full frontend test suite.**

```bash
npm run test --workspace @bird-watch/frontend
```

Expected: all tests pass.

- [ ] **Step 6: Commit.**

```bash
git add frontend/src/components/FeedSurface.tsx frontend/src/components/FeedSurface.test.tsx
git commit -m "$(cat <<'EOF'
feat(feed): rewrite FeedSurface with lede, SortLabel, FilterSentence, FeedCard (Sky Atlas Phase 5)

Adds the 4-template lede state machine (no-results → species → family →
default). Mounts <SortLabel> as a separate sibling above <FilterSentence>
per the spec's explicit "sort prefix is NOT this component" constraint.
Elevates the first notable observation as <FeedCard>; remaining rows use
<FeedRow> with FamilySilhouette thumbs. All new props are optional with
defaults so existing callers compile without change.

Spec: docs/design/02-phases/phase-5-feed-species.md
      docs/design/01-spec/voice-and-content.md §Lede contract

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Mount `<FilterSentence>` on `<SpeciesSearchSurface>` and sharpen visual contrast

`<SpeciesSearchSurface>` gets two changes: (1) `<FilterSentence>` mounts below the autocomplete in the context strip, and (2) the autocomplete's visual shell is revised to read as a hero-sized input with a search icon — sharper distinction from the chip-shaped `<FiltersBar>` header control.

The `<SpeciesAutocomplete>` combobox internals (`frontend/src/components/SpeciesAutocomplete.tsx:141–354`) are **not touched**. The WAI-ARIA 1.2 combobox contract (role="combobox", aria-autocomplete="list", aria-expanded, aria-controls, aria-activedescendant, flat-sentinel group headers, ArrowDown/Up/Enter/Escape key handling) is preserved exactly. Only the wrapper's CSS class changes.

**Files:**
- Modify: `frontend/src/components/SpeciesSearchSurface.tsx`
- Modify: `frontend/src/components/SpeciesSearchSurface.test.tsx`

- [ ] **Step 1: Write failing tests for the new visual-contrast and FilterSentence assertions.**

Append to `frontend/src/components/SpeciesSearchSurface.test.tsx` inside the existing `describe`:

```typescript
  // --- Phase 5: hero autocomplete visual contrast + FilterSentence ---

  describe('visual contrast — hero autocomplete vs header filter', () => {
    it('autocomplete wrapper carries species-search-hero class', () => {
      const { container } = render(
        <SpeciesSearchSurface
          loading={false}
          speciesCode={null}
          observations={[]}
          speciesIndex={SPECIES_INDEX}
          now={NOW}
          onSelectSpecies={() => {}}
          onClearSpecies={() => {}}
        />
      );
      // The hero class distinguishes the surface autocomplete (navigates)
      // from the chip-shaped FiltersBar input (narrows). CSS maps this
      // class to larger input height, search icon, and full-width layout.
      expect(container.querySelector('.species-search-hero')).toBeInTheDocument();
    });

    it('search icon element is present inside the hero wrapper', () => {
      const { container } = render(
        <SpeciesSearchSurface
          loading={false}
          speciesCode={null}
          observations={[]}
          speciesIndex={SPECIES_INDEX}
          now={NOW}
          onSelectSpecies={() => {}}
          onClearSpecies={() => {}}
        />
      );
      // Icon is aria-hidden; its presence is tested structurally.
      const icon = container.querySelector('.species-search-hero-icon');
      expect(icon).toBeInTheDocument();
      expect(icon).toHaveAttribute('aria-hidden', 'true');
    });

    it('autocomplete combobox input is still accessible by role after hero wrapper added', () => {
      render(
        <SpeciesSearchSurface
          loading={false}
          speciesCode={null}
          observations={[]}
          speciesIndex={SPECIES_INDEX}
          now={NOW}
          onSelectSpecies={() => {}}
          onClearSpecies={() => {}}
        />
      );
      // SpeciesAutocomplete's ARIA contract must survive the wrapper change.
      const input = screen.getByRole('combobox', { name: /search species/i });
      expect(input).toBeInTheDocument();
      expect(input).toHaveAttribute('aria-autocomplete', 'list');
    });
  });

  describe('<FilterSentence> on SpeciesSearchSurface', () => {
    it('mounts the always-on live region', () => {
      render(
        <SpeciesSearchSurface
          loading={false}
          speciesCode={null}
          observations={[]}
          speciesIndex={SPECIES_INDEX}
          now={NOW}
          onSelectSpecies={() => {}}
          onClearSpecies={() => {}}
        />
      );
      const liveRegion = document.querySelector('.filter-sentence-live');
      expect(liveRegion).toBeInTheDocument();
      expect(liveRegion).toHaveAttribute('aria-live', 'polite');
    });

    it('renders visible FilterSentence when filters prop is active', () => {
      render(
        <SpeciesSearchSurface
          loading={false}
          speciesCode={null}
          observations={[]}
          speciesIndex={SPECIES_INDEX}
          now={NOW}
          onSelectSpecies={() => {}}
          onClearSpecies={() => {}}
          activeFilters={{ notable: true, since: '14d', speciesCode: null, familyCode: null }}
        />
      );
      expect(screen.getByText(/notable sightings/i)).toBeInTheDocument();
    });
  });
```

- [ ] **Step 2: Run to confirm the new tests fail.**

```bash
npm run test --workspace @bird-watch/frontend -- SpeciesSearchSurface.test.tsx
```

Expected: the new visual-contrast and FilterSentence tests fail. All existing tests still pass.

- [ ] **Step 3: Rewrite `frontend/src/components/SpeciesSearchSurface.tsx`.**

```typescript
import type { Observation } from '@bird-watch/shared-types';
import { FeedRow } from './FeedRow.js';
import { SpeciesAutocomplete } from './SpeciesAutocomplete.js';
import { FilterSentence } from './ds/FilterSentence.js';
import type { SpeciesOption } from './FiltersBar.js';

export interface ActiveFilters {
  notable: boolean;
  since: string;
  speciesCode: string | null;
  familyCode: string | null;
}

export interface SpeciesSearchSurfaceProps {
  loading: boolean;
  speciesCode: string | null;
  observations: Observation[];
  speciesIndex: SpeciesOption[];
  now: Date;
  onSelectSpecies: (speciesCode: string) => void;
  onClearSpecies: () => void;
  /**
   * Active filter state for the <FilterSentence> context strip.
   * Optional: when absent, FilterSentence receives zero-filter state
   * (live region still mounts; visible sentence is null).
   */
  activeFilters?: ActiveFilters;
}

/** Stable module-level no-op for the recent-sightings row list. */
const ROW_NOOP: (speciesCode: string) => void = () => {};

const DEFAULT_FILTERS: ActiveFilters = {
  notable: false,
  since: '14d',
  speciesCode: null,
  familyCode: null,
};

/**
 * Species-first surface — Sky Atlas Phase 5.
 *
 * Visual distinction between the two species inputs:
 *   - <FiltersBar> species input (in the header): chip-shaped, narrow,
 *     class="filters-bar-species-input". It NARROWS the observation set.
 *   - <SpeciesAutocomplete> here: hero-sized, full-width, search icon,
 *     wrapped in .species-search-hero. It NAVIGATES to the detail surface.
 *
 * The hero wrapper and icon are purely visual. <SpeciesAutocomplete>'s
 * ARIA contract (role="combobox", aria-autocomplete="list", aria-expanded,
 * aria-controls, aria-activedescendant, flat-sentinel group headers,
 * ArrowDown/Up/Enter/Escape) is preserved verbatim — do NOT pass additional
 * ARIA attributes via the wrapper.
 *
 * <FilterSentence> mounts in the context strip below the hero autocomplete.
 * The live region is always present (even at zero filters); the visible
 * sentence renders only when filters are active.
 *
 * Recent-sightings row list uses <FeedRow> (not <ObservationFeedRow>).
 * Rows receive ROW_NOOP for onSelectSpecies — clicking a row when the panel
 * is already open for the same species is a no-op by design.
 */
export function SpeciesSearchSurface(props: SpeciesSearchSurfaceProps) {
  const {
    loading,
    speciesCode,
    observations,
    speciesIndex,
    now,
    onSelectSpecies,
    activeFilters = DEFAULT_FILTERS,
  } = props;

  const filtered = speciesCode
    ? observations.filter(o => o.speciesCode === speciesCode)
    : [];

  return (
    <div className="species-search-surface">
      {/* Hero autocomplete — navigates to detail surface.
          The wrapper class establishes visual distinction from the header filter chip. */}
      <div className="species-search-hero">
        <span className="species-search-hero-icon" aria-hidden="true">
          {/* SVG search icon — rendered as inline SVG so it inherits currentColor
              and is not a separate network request. The icon slot is purely decorative;
              aria-hidden prevents SR double-announcement (combobox label already conveys
              the search affordance). */}
          <svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <circle cx="8.5" cy="8.5" r="5.75" stroke="currentColor" strokeWidth="1.5" />
            <path d="M13.25 13.25L17 17" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </span>
        <SpeciesAutocomplete
          speciesIndex={speciesIndex}
          onSelectSpecies={onSelectSpecies}
        />
      </div>

      {/* Context strip: FilterSentence (always-mounted live region) */}
      <FilterSentence filters={activeFilters} />

      {speciesCode === null && (
        <p className="species-search-prompt" role="status">
          Start typing a species name to explore its recent sightings.
        </p>
      )}

      {speciesCode !== null && loading && (
        <p className="species-search-empty" role="status" aria-live="polite">
          Loading observations…
        </p>
      )}

      {speciesCode !== null && !loading && filtered.length === 0 && (
        <p className="species-search-empty" role="status">
          No recent sightings for this species in the current window.
        </p>
      )}

      {speciesCode !== null && !loading && filtered.length > 0 && (
        <ol className="feed" aria-label="Recent sightings">
          {filtered.map(o => (
            <FeedRow
              key={`${o.subId}:${o.speciesCode}`}
              observation={o}
              now={now}
              onSelectSpecies={ROW_NOOP}
            />
          ))}
        </ol>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run all SpeciesSearchSurface tests.**

```bash
npm run test --workspace @bird-watch/frontend -- SpeciesSearchSurface.test.tsx
```

Expected: all tests pass, including both new test groups.

- [ ] **Step 5: Run the full frontend test suite.**

```bash
npm run test --workspace @bird-watch/frontend
```

Expected: all tests pass.

- [ ] **Step 6: Commit.**

```bash
git add frontend/src/components/SpeciesSearchSurface.tsx \
        frontend/src/components/SpeciesSearchSurface.test.tsx
git commit -m "$(cat <<'EOF'
feat(species): hero autocomplete visual sharpening + FilterSentence (Sky Atlas Phase 5)

Wraps SpeciesAutocomplete in .species-search-hero (larger input, search icon)
to visually distinguish the surface-level navigation input from the chip-shaped
FiltersBar header control. SpeciesAutocomplete's 354-line WAI-ARIA 1.2 combobox
internals are untouched. Mounts <FilterSentence> in the context strip; live
region always present, visible sentence conditional on active filters.

Spec: docs/design/02-phases/phase-5-feed-species.md §SpeciesSearchSurface

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Manual VoiceOver pass on filter changes

This task is not automated — axe checks structure at a point in time, not behaviour over time. The `<FilterSentence>` live-region contract (500ms debounce, 1500ms cleared hold) must be manually verified on macOS VoiceOver.

**Files:** none modified.

- [ ] **Step 1: Start the dev server.**

```bash
npm run dev --workspace @bird-watch/frontend
```

- [ ] **Step 2: Open the feed surface in Safari (VoiceOver requires Safari on macOS).**

Navigate to `http://localhost:5173/?view=feed` (or wherever the Vite dev server binds).

- [ ] **Step 3: Enable VoiceOver.**

`Cmd + F5`. Confirm VoiceOver is reading page structure.

- [ ] **Step 4: Test rapid filter toggles (debounce contract).**

Using the Filters panel: rapidly toggle the "Notable only" checkbox on and off 4–5 times within 2 seconds.

Expected: VoiceOver announces exactly **one** settled-state sentence after the toggles stop, not one per toggle. The 500ms debounce in `<FilterSentence>` gates SR announcements. If you hear multiple announcements per toggle, the debounce is not wired correctly.

- [ ] **Step 5: Test the filter-cleared hold (1500ms).**

With a filter active (Notable or a family selected), clear all filters.

Expected: VoiceOver announces "All filters cleared." exactly once, then goes silent after approximately 1.5 seconds. The visible filter sentence disappears immediately; the live region holds the cleared message separately for 1500ms per `FILTER_SENTENCE_CLEAR_HOLD_MS`.

- [ ] **Step 6: Test species surface filter sentence.**

Navigate to `?view=species`. With a filter active in the header, confirm the FilterSentence live region on the species surface also debounces correctly.

- [ ] **Step 7: Record the result.**

Check the acceptance criterion box below. If any VoiceOver behaviour does not match expectations, investigate `<FilterSentence>` debounce wiring before opening the PR. Do NOT open the PR with a failing VoiceOver pass.

- [ ] **Step 8: Disable VoiceOver.**

`Cmd + F5`.

---

## Task 7: Full validation suite + PR

Before opening the PR, run the full local validation gate — the same checks Mergify requires: test, lint, build, e2e.

**Files:** none modified.

- [ ] **Step 1: Run the full unit test suite.**

```bash
npm test
```

Expected: all unit tests pass across all workspaces.

- [ ] **Step 2: Run lint.**

```bash
npm run lint
```

Expected: zero errors. Fix any ESLint or TypeScript errors in place — do not silence with disable comments.

- [ ] **Step 3: Verify the stylelint notable-token guard.**

```bash
grep -rE 'var\(--color-decision-point\).*notable' frontend/src/
```

Expected: 0 matches. If any match is found, the accent discipline is violated — `<FeedCard>` or another component is using `--color-decision-point` for the NOTABLE label. Fix to use `--color-accent-notable-fg`.

- [ ] **Step 4: Run the frontend build.**

```bash
npm run build --workspace @bird-watch/frontend
```

Expected: build succeeds. Inspect the output for any TypeScript errors emitted by `tsc` during build.

- [ ] **Step 5: Run the e2e suite.**

```bash
npm run test:e2e --workspace @bird-watch/frontend
```

Expected: all Playwright specs pass. In particular:
- `axe.spec.ts` — "Feed view" combination must remain axe-clean after the `<FeedRow>` / `<FeedCard>` change (new DOM structure).
- "Species view + autocomplete OPEN" — must remain axe-clean after the hero wrapper change.

If axe fires on `<FeedCard>` (e.g., `aria-required-children` on the `<ol>` because the card renders a `<h2>` inside the `<li>`), verify that `<FeedCard>` still wraps content in an `<li>` (it does — see `FeedCard.tsx`). If axe fires on the hero wrapper interfering with the combobox ARIA tree, check that no ARIA role was accidentally added to `.species-search-hero`.

- [ ] **Step 6: Drive the feed surface live with Playwright MCP.**

Per `CLAUDE.md §UI verification`, any PR modifying visible UI under `frontend/**` must be driven through Playwright MCP by the implementer before opening.

```
mcp__plugin_playwright_playwright__browser_navigate to http://localhost:5173/?view=feed
mcp__plugin_playwright_playwright__browser_resize to 390×844 (mobile)
→ interact: verify FeedCard renders, FamilySilhouette thumbs visible in rows, lede text present
→ browser_console_messages — expect zero errors and zero warnings

mcp__plugin_playwright_playwright__browser_resize to 1440×900 (desktop)
→ same interactions
→ browser_console_messages — expect zero errors and zero warnings

mcp__plugin_playwright_playwright__browser_navigate to http://localhost:5173/?view=species
mcp__plugin_playwright_playwright__browser_resize to 390×844
→ interact: type in hero autocomplete, confirm listbox opens, select a species
→ browser_console_messages — zero errors, zero warnings

mcp__plugin_playwright_playwright__browser_resize to 1440×900
→ same
```

Capture screenshots per viewport per surface. Use `pr-screenshots-via-user-attachments` skill (paste-flow → `user-attachments/assets/<uuid>` URLs). Do NOT commit PNGs to the repo.

- [ ] **Step 7: Open the PR.**

```bash
git push -u origin feat/sky-atlas-phase-5-feed-species

gh pr create --title "feat: Sky Atlas Phase 5 — feed + species surfaces" --body "$(cat <<'EOF'
## Summary
- Add `<FeedRow>` (refactored from `ObservationFeedRow`) with `<FamilySilhouette layout="thumb">` in the leading slot, replacing the v3 emoji/glyph approach. `<ObservationFeedRow>` becomes a compatibility shim.
- Add `<FeedCard>` for the elevated top-notable observation: inline-layout silhouette, NOTABLE meta-label via `--color-accent-notable-fg`, species name as `<h2>`.
- Rewrite `<FeedSurface>` with the 4-template lede state machine, `<SortLabel>` sibling above `<FilterSentence>`, and unified `<ol>` containing the card-row + flat rows.
- `<SpeciesSearchSurface>` hero autocomplete visual sharpening: `.species-search-hero` wrapper + search icon distinguish the navigation input from the chip-shaped `<FiltersBar>` header control. `<FilterSentence>` mounts in the context strip.
- Config constants: `filter.ts` (500ms debounce, 1500ms clear-hold), `freshness.ts` (30 min / 6 h thresholds).

## Test plan
- [x] `<FeedRow>` unit tests: silhouette thumb, null-family neutral path, all five ARIA slots, memo contract, li wrapper.
- [x] `<FeedCard>` unit tests: NOTABLE label, `.feed-card-meta` class (not decision-point), inline-layout silhouette, card heading, five-slot accessible name.
- [x] `<FeedSurface>` unit tests: 4-template lede state machine, SortLabel sibling, FilterSentence mount (live region always present), FeedCard elevation for first notable.
- [x] `<SpeciesSearchSurface>` unit tests: `.species-search-hero` wrapper, icon element aria-hidden, combobox ARIA contract preserved, FilterSentence live region.
- [x] `npm test` — all workspaces pass.
- [x] `npm run lint` — zero errors; stylelint notable-token guard passes (0 matches for `--color-decision-point.*notable`).
- [x] `npm run build` — succeeds.
- [x] `npm run test:e2e` — axe-clean on feed and species views.
- [x] Playwright MCP — feed surface at 390×844 and 1440×900; species surface at both viewports; zero console errors/warnings.
- [x] Manual VoiceOver: filter changes announce settled state once (500ms debounce); "All filters cleared." holds 1500ms.

## Screenshots
[Paste `user-attachments` URLs here per pr-screenshots-via-user-attachments skill]

## Spec
docs/design/02-phases/phase-5-feed-species.md
docs/design/01-spec/components.md §<FilterSentence>, §<FamilySilhouette>
docs/design/01-spec/voice-and-content.md §Lede contract, §Accent discipline
docs/design/01-spec/accessibility.md §FilterSentence live region

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 8: Dispatch the bot review.**

Bot review dispatches through the `julianken-bot` Agent subagent — never via `gh pr review` from the main session. Per `CLAUDE.md §PR workflow`.

- [ ] **Step 9: After bot review approves and CI green, post the Mergify queue comment.**

```bash
gh pr comment <PR-number> --body "@Mergifyio queue"
```

The comment body is exactly `@Mergifyio queue` — no prose. Never `gh pr merge`.

---

## Acceptance criteria

This plan is complete when ALL of the following are true:

- [ ] Top notable feed observation renders as elevated `<FeedCard>`; remaining rows render as flat `<FeedRow>` with `<FamilySilhouette layout="thumb">`.
- [ ] `<FamilySilhouette>` thumbs render correctly for all 7 families and the null-family neutral path (no throw, no blank space).
- [ ] `<FilterSentence>` debounces 500ms before SR announcement; cleared transition holds "All filters cleared." for 1500ms.
- [ ] Manual VoiceOver confirms filter changes announce settled state exactly once per settled batch (no announce-storm on rapid toggles).
- [ ] Two species inputs are visually distinguishable: header `<FiltersBar>` species input is chip-shaped and narrow; `<SpeciesSearchSurface>` autocomplete is hero-sized with search icon.
- [ ] `<SortLabel>` renders "Sorted by recency" as a separate sibling ABOVE `<FilterSentence>`; neither element contains the other.
- [ ] Detail navigation from feed row click uses `pushState` (per Phase 0 — already wired; no regression).
- [ ] `ObservationFeedRow` re-export shim compiles; existing `ObservationFeedRow.test.tsx` passes without deletion.
- [ ] Stylelint notable-token guard passes: `grep -rE 'var\(--color-decision-point\).*notable' frontend/src/` returns 0 matches.
- [ ] `axe.spec.ts` — feed view and species view remain axe-clean at desktop and mobile viewports.
- [ ] `npm test`, `npm run lint`, `npm run build`, `npm run test:e2e` all pass.
- [ ] PR opens with 5-section body per template, real screenshots (not placeholders), CI green; Mergify queues it.

---

## What this plan deliberately does NOT include

To stay scoped per Phase 5 boundaries:

- **Map surface** — Phase 3 is already done. Phase 5 does not touch `<MapSurface>`.
- **Detail surface** — Phase 4 is already done.
- **Voice / metadata pass** — Phase 6. Lede _templates_ ship here; the Phase 6 voice pass refines all 14 copy strings and adds `<meta>` tags.
- **Feed list virtualization** — only if Lighthouse flags perf at 344+ rows. The Phase 0 plan's prototype gate (see CLAUDE.md §Prototype gate) establishes that 344 rows at both viewports is the performance threshold. If the Phase 5 build passes Lighthouse at that data volume without virtualization, skip it and cite the prototype gate explicitly in the PR body.
- **`<FiltersBar>` changes** — the header filter chip-shaped control is not modified. Phase 5 only adds the `.species-search-hero` wrapper to the surface autocomplete for contrast.
- **`[data-theme]` dark-mode scaffold** — Phase 1.
- **Freshness label UI** — the `freshness.ts` constants ship here; the visible "Updated N min ago" label below the lede ships in Phase 6 (voice + metadata).
- **`<Photo>` component** — Phase 2 primitive; not used by feed rows (silhouettes only at feed scale).
- **`<StatusBlock>` migration** — Phase 2's `<StatusBlock>` could replace the ad-hoc `feed-empty` divs; that cleanup is deferred to Phase 6's voice pass (preserves the existing copy strings as required).
- **Pagination / infinite scroll** — out of scope unless flagged by perf tests. See Phase 0's prototype gate requirement.
