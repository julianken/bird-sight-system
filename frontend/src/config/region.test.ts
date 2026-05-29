import { describe, it, expect } from 'vitest';
import type { StateSummary } from '@bird-watch/shared-types';
import { regionLabelFor, REGION_CODE } from './region.js';
import type { Scope } from '../state/url-state.js';

// #738 (C5) — `regionLabelFor(scope, states)` replaces the build-time
// `REGION_LABEL` constant. The label is now runtime, derived from the active
// scope (#735) and the `/api/states` name table (#732). Three cases:
//   - unscoped → no region claim (null) — the chooser is shown, not a region.
//   - `?scope=us` → "USA" (whole-US escape hatch).
//   - state → the resolved `StateSummary.name` (e.g. "Arizona"), falling back
//     to the bare `stateCode` for an unknown code (mirrors the prototype's
//     `stateByCode(stateCode)?.name ?? stateCode`).
const STATES: StateSummary[] = [
  { stateCode: 'US-AZ', name: 'Arizona', bbox: [-114.815, 31.332, -109.045, 37.004] },
  { stateCode: 'US-NY', name: 'New York', bbox: [-79.763, 40.477, -71.856, 45.016] },
];

describe('regionLabelFor', () => {
  it('unscoped → null (no region claim — the chooser is shown)', () => {
    const scope: Scope = { kind: 'unscoped' };
    expect(regionLabelFor(scope, STATES)).toBeNull();
  });

  it('?scope=us → "USA"', () => {
    const scope: Scope = { kind: 'us' };
    expect(regionLabelFor(scope, STATES)).toBe('USA');
  });

  it('state → resolved StateSummary.name', () => {
    const scope: Scope = { kind: 'state', stateCode: 'US-AZ' };
    expect(regionLabelFor(scope, STATES)).toBe('Arizona');
  });

  it('state → another resolved name from the table', () => {
    const scope: Scope = { kind: 'state', stateCode: 'US-NY' };
    expect(regionLabelFor(scope, STATES)).toBe('New York');
  });

  it('state with an unknown code → falls back to the bare stateCode', () => {
    // The state table hasn't loaded yet (or is missing a row): the runtime
    // function must not throw and must not render a blank region — it falls
    // back to the code, matching the prototype's `?? scope.stateCode`.
    const scope: Scope = { kind: 'state', stateCode: 'US-WY' };
    expect(regionLabelFor(scope, STATES)).toBe('US-WY');
  });

  it('state with an empty/absent state table → falls back to the code', () => {
    const scope: Scope = { kind: 'state', stateCode: 'US-AZ' };
    expect(regionLabelFor(scope, [])).toBe('US-AZ');
    expect(regionLabelFor(scope)).toBe('US-AZ');
  });
});

describe('REGION_CODE', () => {
  it('defaults to "US-AZ" when VITE_REGION_CODE is unset (test env)', () => {
    // REGION_CODE remains a build-time constant — it is still the seed for the
    // ingest region and the AZ default deploy. Only the user-facing label moved
    // to runtime (regionLabelFor); this guards the build-time default.
    expect(REGION_CODE).toBe('US-AZ');
  });
});
