import { describe, it, expect } from 'vitest';
import { craftLede, LEDE_LOADING_PLACEHOLDER, type LedeInput } from './lede.js';

// Minimal valid base — a settled, scoped, no-filter, multi-species view.
const base: LedeInput = {
  region: 'Arizona',
  observationCount: 100,
  speciesCount: 12,
  observationsLoading: false,
  noFiltersActive: true,
  activeSpeciesName: null,
  singleObservedSpeciesName: null,
  familyName: null,
};

describe('craftLede', () => {
  it('returns null when unscoped (region === null)', () => {
    expect(craftLede({ ...base, region: null })).toBeNull();
  });

  it('returns null on cold load (loading + zero count + zero species)', () => {
    expect(craftLede({
      ...base, observationsLoading: true, observationCount: 0, speciesCount: 0,
    })).toBeNull();
  });

  it('returns the loading placeholder during an in-flight refetch with a stale count', () => {
    // #872: a state->state refetch keeps the prior count nonzero while loading.
    expect(craftLede({
      ...base, observationsLoading: true, observationCount: 50, speciesCount: 3,
    })).toBe(LEDE_LOADING_PLACEHOLDER);
  });

  it('reads "No recent sightings" for an empty unfiltered result', () => {
    expect(craftLede({
      ...base, observationCount: 0, speciesCount: 0, noFiltersActive: true,
    })).toBe('No recent sightings');
  });

  it('reads "No matches for these filters" for an empty filtered result', () => {
    expect(craftLede({
      ...base, observationCount: 0, speciesCount: 0, noFiltersActive: false,
    })).toBe('No matches for these filters');
  });

  // THE BUG (#1175): aggregated mode has NO per-observation rows, so
  // `speciesCount` is 0 and `singleObservedSpeciesName` is null — but an active
  // species filter must still be named, resolved from the dictionary.
  it('names the active species filter in aggregated mode (speciesCount 0, no per-obs rows)', () => {
    expect(craftLede({
      ...base,
      observationCount: 1823,
      speciesCount: 0,
      noFiltersActive: false,
      activeSpeciesName: 'Northern Cardinal',
      singleObservedSpeciesName: null,
    })).toBe('1,823 sightings of Northern Cardinal');
  });

  it('keeps naming a coincidental single species in per-observation mode (no active filter)', () => {
    expect(craftLede({
      ...base,
      observationCount: 43,
      speciesCount: 1,
      noFiltersActive: true,
      activeSpeciesName: null,
      singleObservedSpeciesName: 'Verdin',
    })).toBe('43 sightings of Verdin');
  });

  it('prefers the active filter name over the coincidental per-obs name', () => {
    expect(craftLede({
      ...base,
      observationCount: 43,
      speciesCount: 1,
      noFiltersActive: false,
      activeSpeciesName: 'Northern Cardinal',
      singleObservedSpeciesName: 'Verdin',
    })).toBe('43 sightings of Northern Cardinal');
  });

  it('names the family for a family-only filter', () => {
    expect(craftLede({
      ...base,
      observationCount: 300,
      speciesCount: 0,
      noFiltersActive: false,
      familyName: 'Tyrant Flycatchers',
    })).toBe('300 sightings of Tyrant Flycatchers');
  });

  it('falls back to the bare count for a multi-species unfiltered view', () => {
    expect(craftLede({ ...base, observationCount: 6901, speciesCount: 200 }))
      .toBe('6,901 sightings');
  });

  it('degrades to the bare count when the dictionary is cold (active filter, no resolved name)', () => {
    // Aggregated + active species but the dictionary has not resolved the name
    // yet → activeSpeciesName null → bare count, never a crash or "of null".
    expect(craftLede({
      ...base,
      observationCount: 1823,
      speciesCount: 0,
      noFiltersActive: false,
      activeSpeciesName: null,
      singleObservedSpeciesName: null,
    })).toBe('1,823 sightings');
  });
});
