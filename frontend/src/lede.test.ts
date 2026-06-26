import { describe, it, expect } from 'vitest';
import {
  craftLede,
  selectLedeCount,
  LEDE_LOADING_PLACEHOLDER,
  type LedeInput,
} from './lede.js';
import type { AggregatedBucket, Observation } from '@bird-watch/shared-types';

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

// #1283: the FILTERED lede counts the VIEWPORT (equals the legend's "in view"
// total + matches the markers); the UNFILTERED lede stays REGIONAL.
describe('selectLedeCount', () => {
  const bucket = (count: number): AggregatedBucket => ({
    lat: 33.4,
    lng: -112.1,
    count,
    speciesCount: 1,
    families: [],
  });
  const obs = (n: number): Observation[] =>
    Array.from({ length: n }, (_, i) => ({
      subId: `S${i}`,
      speciesCode: 'norcar',
      comName: 'Northern Cardinal',
      lat: 33.4,
      lng: -112.1,
      obsDt: '2026-06-01 08:00',
      locId: 'L1',
      locName: null,
      howMany: 1,
      isNotable: false,
      silhouetteId: null,
      familyCode: 'cardinalidae',
    }));

  // Regional totals (whole-scope fetch) vs. viewport-clipped totals.
  const regionalBuckets = [bucket(13_000), bucket(451)]; // 13,451 (the deep-link "national" number)
  const viewportBuckets = [bucket(163)]; // what's actually in view
  const regionalObs = obs(900);
  const viewportObs = obs(42);

  it('aggregated + FILTER active → counts the viewport, not the regional total', () => {
    expect(
      selectLedeCount({
        mode: 'aggregated',
        filterActive: true,
        buckets: regionalBuckets,
        observations: regionalObs,
        viewportBuckets,
        viewportObservations: viewportObs,
      }),
    ).toBe(163);
  });

  it('aggregated + NO filter → keeps the regional total', () => {
    expect(
      selectLedeCount({
        mode: 'aggregated',
        filterActive: false,
        buckets: regionalBuckets,
        observations: regionalObs,
        viewportBuckets,
        viewportObservations: viewportObs,
      }),
    ).toBe(13_451);
  });

  it('observations + FILTER active → counts the viewport-clipped rows', () => {
    expect(
      selectLedeCount({
        mode: 'observations',
        filterActive: true,
        buckets: regionalBuckets,
        observations: regionalObs,
        viewportBuckets,
        viewportObservations: viewportObs,
      }),
    ).toBe(42);
  });

  it('observations + NO filter → counts the full regional rows', () => {
    expect(
      selectLedeCount({
        mode: 'observations',
        filterActive: false,
        buckets: regionalBuckets,
        observations: regionalObs,
        viewportBuckets,
        viewportObservations: viewportObs,
      }),
    ).toBe(900);
  });

  // #1283 follow-up: the helper keys ONLY off the `filterActive` boolean — it is
  // dimension-agnostic. App.tsx widened that boolean to the negation of
  // `noFiltersActive`, so a notable-ONLY or since-ONLY filter (no family/species)
  // now feeds `filterActive: true` here. These assert the viewport count is
  // selected for ANY truthy `filterActive`, locking that a non-family/species
  // filter no longer falls back to the regional total (the legend/markers are
  // already viewport-clipped, so the lede must agree).
  it('aggregated + filter active for a NON-family/species dimension (notable/since) → viewport', () => {
    expect(
      selectLedeCount({
        mode: 'aggregated',
        filterActive: true, // App now sets this true for notable-only / since-only
        buckets: regionalBuckets,
        observations: regionalObs,
        viewportBuckets,
        viewportObservations: viewportObs,
      }),
    ).toBe(163);
  });

  it('observations + filter active for a NON-family/species dimension (notable/since) → viewport rows', () => {
    expect(
      selectLedeCount({
        mode: 'observations',
        filterActive: true, // App now sets this true for notable-only / since-only
        buckets: regionalBuckets,
        observations: regionalObs,
        viewportBuckets,
        viewportObservations: viewportObs,
      }),
    ).toBe(42);
  });
});
