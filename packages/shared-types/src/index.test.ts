import type { SpeciesMeta } from './index.js';

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
