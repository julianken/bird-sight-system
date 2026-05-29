import type {
  SpeciesMeta,
  ObservationsResponse,
  Observation,
  StateCode,
  ObservationFilters,
  StateSummary,
} from './index.js';
import { CONUS_STATE_CODES } from './index.js';

// Compile-time-only tests for the optional photo projection fields added
// to SpeciesMeta in issue #327, task-3. These fields are derived at read
// time via JOIN to species_photos and are NEVER stored on species_meta
// itself. The package-level "test" script runs `tsc -p tsconfig.test.json`
// — passing means the type-level expectations below all hold.
//
// No runtime assertions live here: the file is intentionally a "type
// laboratory" and exists only to fail compilation if SpeciesMeta drifts
// off-spec. The package has no runtime, so a runtime test runner would add
// only ceremony.

// Case 1: photo fields are optional — a SpeciesMeta literal can omit them.
const _noPhoto: SpeciesMeta = {
  speciesCode: 'vermfly',
  comName: 'Vermilion Flycatcher',
  sciName: 'Pyrocephalus rubinus',
  familyCode: 'tyrann1',
  familyName: 'Tyrant Flycatchers',
  taxonOrder: 12345,
};
void _noPhoto;

// Case 2: when set, photo fields accept strings.
const _withPhoto: SpeciesMeta = {
  speciesCode: 'vermfly',
  comName: 'Vermilion Flycatcher',
  sciName: 'Pyrocephalus rubinus',
  familyCode: 'tyrann1',
  familyName: 'Tyrant Flycatchers',
  taxonOrder: 12345,
  photoUrl: 'https://photos.bird-maps.com/vermfly.jpg',
  photoAttribution: '(c) photographer, some rights reserved (CC BY)',
  photoLicense: 'CC BY 4.0',
};
void _withPhoto;

// Case 3: photo field accessors carry `string | undefined`. The narrow
// re-assignments below would fail to compile if the fields were typed as
// anything other than optional strings.
const _photoUrl: string | undefined = _withPhoto.photoUrl;
const _photoAttribution: string | undefined = _withPhoto.photoAttribution;
const _photoLicense: string | undefined = _withPhoto.photoLicense;
void _photoUrl;
void _photoAttribution;
void _photoLicense;

// Case 4: non-string values are rejected. The @ts-expect-error directives
// are load-bearing — if any of the fields stops rejecting non-strings,
// tsc will flag the directive as "unused" and fail the test build.
const _bad1: SpeciesMeta = {
  speciesCode: 'x', comName: 'x', sciName: 'x',
  familyCode: 'x', familyName: 'x', taxonOrder: null,
  // @ts-expect-error — photoUrl must be a string when set
  photoUrl: 42,
};
const _bad2: SpeciesMeta = {
  speciesCode: 'x', comName: 'x', sciName: 'x',
  familyCode: 'x', familyName: 'x', taxonOrder: null,
  // @ts-expect-error — photoAttribution must be a string when set
  photoAttribution: false,
};
const _bad3: SpeciesMeta = {
  speciesCode: 'x', comName: 'x', sciName: 'x',
  familyCode: 'x', familyName: 'x', taxonOrder: null,
  // @ts-expect-error — photoLicense must be a string when set
  photoLicense: { label: 'CC BY 4.0' },
};
void _bad1; void _bad2; void _bad3;

// ── ObservationsResponse type-level tests (#456 W3-A) ──────────────────────

// Case 5: well-formed envelope with a timestamp
const _obs: Observation = {
  subId: 'S1', speciesCode: 'vermfly', comName: 'Vermilion Flycatcher',
  lat: 31.72, lng: -110.88, obsDt: '2026-05-11T10:00:00.000Z',
  locId: 'L1', locName: null, howMany: 1, isNotable: false,
  silhouetteId: null, familyCode: 'tyrannidae',
};
const _freshResponse: ObservationsResponse = {
  mode: 'observations',
  data: [_obs],
  meta: { freshestObservationAt: '2026-05-11T10:00:00.000Z' },
};
void _freshResponse;

// Case 6: null freshestObservationAt (empty table)
const _emptyResponse: ObservationsResponse = {
  mode: 'observations',
  data: [],
  meta: { freshestObservationAt: null },
};
void _emptyResponse;

// Case 7: freshestObservationAt narrows to string | null
const _ts: string | null = _freshResponse.meta.freshestObservationAt;
void _ts;

// Case 8: non-null meta.freshestObservationAt must be string
const _badEnvelope: ObservationsResponse = {
  mode: 'observations',
  data: [],
  // @ts-expect-error — freshestObservationAt must be string | null, not number
  meta: { freshestObservationAt: 12345 },
};
void _badEnvelope;

// Case 9 (#627): aggregated branch
const _aggregated: ObservationsResponse = {
  mode: 'aggregated',
  buckets: [
    { lat: 34.0, lng: -111.0, count: 42, speciesCount: 7, families: ['tyrannidae'] },
  ],
  meta: { freshestObservationAt: '2026-05-17T00:00:00.000Z' },
};
void _aggregated;

// Case 10: discriminator narrows the union — accessing `data` on the
// aggregated branch is a type error.
if (_aggregated.mode === 'aggregated') {
  const _buckets = _aggregated.buckets;
  void _buckets;
  // @ts-expect-error — `data` does not exist on the aggregated branch
  void _aggregated.data;
}

// ── State scope type-level tests (#727 / plan tasks B1 + A3) ───────────────

// Case 11: CONUS_STATE_CODES is the single-source 49-code allowlist (48
// contiguous states + DC, excluding US-AK and US-HI). It must be a runtime
// value (imported above as a value, not a type) so parseState/the ZIP
// contract/the selector can build a Set from it.
const _codeCount: number = CONUS_STATE_CODES.length;
if (_codeCount !== 49) {
  throw new Error(`CONUS_STATE_CODES must have 49 entries, got ${_codeCount}`);
}
// Alaska + Hawaii are deliberately absent (out of the CONUS scope).
if (
  (CONUS_STATE_CODES as readonly string[]).includes('US-AK') ||
  (CONUS_STATE_CODES as readonly string[]).includes('US-HI')
) {
  throw new Error('CONUS_STATE_CODES must exclude US-AK and US-HI');
}
// DC and a representative state are present.
if (
  !(CONUS_STATE_CODES as readonly string[]).includes('US-DC') ||
  !(CONUS_STATE_CODES as readonly string[]).includes('US-AZ')
) {
  throw new Error('CONUS_STATE_CODES must include US-DC and US-AZ');
}

// Case 12: StateCode is the union of the literal members of CONUS_STATE_CODES.
// A member literal assigns; an off-list literal does not.
const _okState: StateCode = 'US-AZ';
void _okState;
const _dc: StateCode = 'US-DC';
void _dc;
// @ts-expect-error — US-AK is not a CONUS code
const _ak: StateCode = 'US-AK';
void _ak;
// @ts-expect-error — bare 'AZ' is not a StateCode (codes are eBird 'US-XX')
const _bare: StateCode = 'AZ';
void _bare;

// Case 13: StateCode flows back through the const-array element type.
const _firstCode: StateCode = CONUS_STATE_CODES[0];
void _firstCode;

// Case 14: ObservationFilters.stateCode is an optional string — a hard
// server-side data boundary that ANDs with bbox. Omitting it = whole-US.
const _noScope: ObservationFilters = { since: '7d' };
void _noScope;
const _scoped: ObservationFilters = { stateCode: 'US-AZ', bbox: [-111, 31.5, -110.85, 31.9] };
void _scoped;
const _scopeAccess: string | undefined = _scoped.stateCode;
void _scopeAccess;
const _badScope: ObservationFilters = {
  // @ts-expect-error — stateCode must be a string when set
  stateCode: 123,
};
void _badScope;

// Case 15: meta.truncated is OPTIONAL on the per-observation branch (stale
// CDN bodies predating the field deserialize cleanly). Both present and
// omitted are well-formed.
const _truncated: ObservationsResponse = {
  mode: 'observations',
  data: [_obs],
  meta: { freshestObservationAt: '2026-05-28T00:00:00.000Z', truncated: true },
};
void _truncated;
const _notTruncated: ObservationsResponse = {
  mode: 'observations',
  data: [_obs],
  // truncated omitted — must still compile
  meta: { freshestObservationAt: '2026-05-28T00:00:00.000Z' },
};
void _notTruncated;
if (_truncated.mode === 'observations') {
  const _t: boolean | undefined = _truncated.meta.truncated;
  void _t;
}
const _badTruncated: ObservationsResponse = {
  mode: 'observations',
  data: [],
  // @ts-expect-error — truncated must be a boolean when set
  meta: { freshestObservationAt: null, truncated: 'yes' },
};
void _badTruncated;

// Case 16: meta.truncated is OPTIONAL on the aggregated branch too (the
// aggregated path omits it; the field must still be accepted for parity).
const _aggTruncated: ObservationsResponse = {
  mode: 'aggregated',
  buckets: [],
  meta: { freshestObservationAt: null, truncated: true },
};
void _aggTruncated;
if (_aggTruncated.mode === 'aggregated') {
  const _t: boolean | undefined = _aggTruncated.meta.truncated;
  void _t;
}

// Case 17: StateSummary — { stateCode; name; bbox:[w,s,e,n] }. The bbox is a
// 4-number tuple in the same [west,south,east,north] order as
// ObservationFilters.bbox. `geom` never appears (it stays server-side).
const _summary: StateSummary = {
  stateCode: 'US-AZ',
  name: 'Arizona',
  bbox: [-114.82, 31.33, -109.05, 37.0],
};
void _summary;
const _summaryBbox: [number, number, number, number] = _summary.bbox;
void _summaryBbox;
const _badSummary: StateSummary = {
  stateCode: 'US-AZ',
  name: 'Arizona',
  // @ts-expect-error — bbox must be a 4-tuple of numbers
  bbox: [-114.82, 31.33, -109.05],
};
void _badSummary;
