/**
 * Standardized local dev-data seed.
 *
 * There is no observation seed shipped with the repo — migrations seed only
 * static reference data (family_silhouettes, state_boundaries, a small
 * species_meta set), and every sighting otherwise arrives from a live eBird
 * ingest. That means a contributor without an eBird API key gets an empty map.
 * This module fills that gap: it writes a deterministic, realistic spread of
 * observations so `npm run dev` shows a populated map with zero external
 * dependencies.
 *
 * Run it via `npm run db:seed` (reads DATABASE_URL). It is idempotent:
 * re-running upserts the same fixed rows and rebuilds the precompute grid.
 *
 * INVARIANTS this seed respects (all verified against the read path):
 *   - species_meta is written BEFORE observations (the #484 invariant — every
 *     observation's species_code must already have a species_meta row).
 *   - every family_code used is a REAL value from family_silhouettes, so the
 *     legend join and silhouette stamping resolve (invented species_code is
 *     fine; an invented family_code would break the legend).
 *   - obs_dt is computed relative to now() so every row lands inside the 14-day
 *     recency window the whole stack filters on (`obs_dt >= now() - 14 days`).
 *   - geom is NOT set here — it is a GENERATED column.
 *   - refreshGridAgg() runs last, so the default low-zoom map/lede/legend (which
 *     read the observation_grid_agg precompute table) are non-empty.
 *
 * Determinism: a fixed-seed PRNG (mulberry32) drives the variety (how_many, the
 * per-observation family/species/state walk). No Math.random / Date.now in the
 * data shape — only the obs_dt offset is taken from now() so the rows stay in
 * the 14-day window on any run.
 */
import { createPool, closePool, type Pool } from './pool.js';
import { upsertSpeciesMeta } from './species.js';
import { upsertObservations, refreshGridAgg, type ObservationInput } from './observations.js';
import type { SpeciesMeta } from '@bird-watch/shared-types';

/** Deterministic 32-bit PRNG — same sequence every run, no global seeding. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A real city per state with a coordinate comfortably inside the state polygon
 * (so the PostGIS ST_Intersects state clip resolves). 18 CONUS states spanning
 * the country so the national rollup and several state scopes are all populated.
 */
const STATE_CITIES: ReadonlyArray<{ state: string; loc: string; lat: number; lng: number }> = [
  { state: 'US-AZ', loc: 'Phoenix, AZ', lat: 33.45, lng: -112.07 },
  { state: 'US-CA', loc: 'Los Angeles, CA', lat: 34.05, lng: -118.24 },
  { state: 'US-CA', loc: 'San Francisco, CA', lat: 37.77, lng: -122.42 },
  { state: 'US-TX', loc: 'Austin, TX', lat: 30.27, lng: -97.74 },
  { state: 'US-FL', loc: 'Orlando, FL', lat: 28.54, lng: -81.38 },
  { state: 'US-NY', loc: 'New York, NY', lat: 40.71, lng: -73.99 },
  { state: 'US-WA', loc: 'Seattle, WA', lat: 47.61, lng: -122.33 },
  { state: 'US-CO', loc: 'Denver, CO', lat: 39.74, lng: -104.99 },
  { state: 'US-IL', loc: 'Chicago, IL', lat: 41.85, lng: -87.65 },
  { state: 'US-MA', loc: 'Boston, MA', lat: 42.36, lng: -71.06 },
  { state: 'US-GA', loc: 'Atlanta, GA', lat: 33.75, lng: -84.39 },
  { state: 'US-MN', loc: 'Minneapolis, MN', lat: 44.98, lng: -93.27 },
  { state: 'US-NM', loc: 'Albuquerque, NM', lat: 35.08, lng: -106.65 },
  { state: 'US-OR', loc: 'Portland, OR', lat: 45.52, lng: -122.68 },
  { state: 'US-NC', loc: 'Raleigh, NC', lat: 35.78, lng: -78.64 },
  { state: 'US-MI', loc: 'Detroit, MI', lat: 42.33, lng: -83.05 },
  { state: 'US-UT', loc: 'Salt Lake City, UT', lat: 40.76, lng: -111.89 },
  { state: 'US-PA', loc: 'Philadelphia, PA', lat: 39.95, lng: -75.17 },
  { state: 'US-MO', loc: 'St. Louis, MO', lat: 38.63, lng: -90.2 },
  { state: 'US-NV', loc: 'Las Vegas, NV', lat: 36.17, lng: -115.14 },
];

/**
 * Species seeded per family. Every `family` here MUST be a real family_code
 * from family_silhouettes (checked by the test). species_code / com_name /
 * sci_name are plausible but synthetic — invented species codes are allowed;
 * invented family codes are not.
 */
interface SeedSpecies {
  family: string;
  familyName: string;
  species: ReadonlyArray<{ code: string; com: string; sci: string }>;
}

const SEED_SPECIES: ReadonlyArray<SeedSpecies> = [
  { family: 'tyrannidae', familyName: 'Tyrant Flycatchers', species: [
    { code: 'devseed-vermfly', com: 'Vermilion Flycatcher', sci: 'Pyrocephalus rubinus' },
    { code: 'devseed-easkin', com: 'Eastern Kingbird', sci: 'Tyrannus tyrannus' },
    { code: 'devseed-blkpho', com: 'Black Phoebe', sci: 'Sayornis nigricans' },
  ] },
  { family: 'trochilidae', familyName: 'Hummingbirds', species: [
    { code: 'devseed-annhum', com: "Anna's Hummingbird", sci: 'Calypte anna' },
    { code: 'devseed-ruthum', com: 'Ruby-throated Hummingbird', sci: 'Archilochus colubris' },
  ] },
  { family: 'icteridae', familyName: 'Blackbirds', species: [
    { code: 'devseed-rewbla', com: 'Red-winged Blackbird', sci: 'Agelaius phoeniceus' },
    { code: 'devseed-baltor', com: 'Baltimore Oriole', sci: 'Icterus galbula' },
    { code: 'devseed-comgra', com: 'Common Grackle', sci: 'Quiscalus quiscula' },
  ] },
  { family: 'cardinalidae', familyName: 'Cardinals & Allies', species: [
    { code: 'devseed-norcar', com: 'Northern Cardinal', sci: 'Cardinalis cardinalis' },
    { code: 'devseed-indbun', com: 'Indigo Bunting', sci: 'Passerina cyanea' },
  ] },
  { family: 'corvidae', familyName: 'Crows, Jays & Magpies', species: [
    { code: 'devseed-blujay', com: 'Blue Jay', sci: 'Cyanocitta cristata' },
    { code: 'devseed-amecro', com: 'American Crow', sci: 'Corvus brachyrhynchos' },
    { code: 'devseed-stejay', com: "Steller's Jay", sci: 'Cyanocitta stelleri' },
  ] },
  { family: 'parulidae', familyName: 'New World Warblers', species: [
    { code: 'devseed-yelwar', com: 'Yellow Warbler', sci: 'Setophaga petechia' },
    { code: 'devseed-comyel', com: 'Common Yellowthroat', sci: 'Geothlypis trichas' },
    { code: 'devseed-yerwar', com: 'Yellow-rumped Warbler', sci: 'Setophaga coronata' },
  ] },
  { family: 'anatidae', familyName: 'Ducks, Geese & Swans', species: [
    { code: 'devseed-mallar', com: 'Mallard', sci: 'Anas platyrhynchos' },
    { code: 'devseed-cangoo', com: 'Canada Goose', sci: 'Branta canadensis' },
    { code: 'devseed-wooduc', com: 'Wood Duck', sci: 'Aix sponsa' },
  ] },
  { family: 'picidae', familyName: 'Woodpeckers', species: [
    { code: 'devseed-dowwoo', com: 'Downy Woodpecker', sci: 'Dryobates pubescens' },
    { code: 'devseed-norfli', com: 'Northern Flicker', sci: 'Colaptes auratus' },
  ] },
  { family: 'turdidae', familyName: 'Thrushes', species: [
    { code: 'devseed-amerob', com: 'American Robin', sci: 'Turdus migratorius' },
    { code: 'devseed-easblu', com: 'Eastern Bluebird', sci: 'Sialia sialis' },
  ] },
  { family: 'fringillidae', familyName: 'Finches', species: [
    { code: 'devseed-amegfi', com: 'American Goldfinch', sci: 'Spinus tristis' },
    { code: 'devseed-houfin', com: 'House Finch', sci: 'Haemorhous mexicanus' },
  ] },
  { family: 'passerellidae', familyName: 'New World Sparrows', species: [
    { code: 'devseed-sonspa', com: 'Song Sparrow', sci: 'Melospiza melodia' },
    { code: 'devseed-whtspa', com: 'White-throated Sparrow', sci: 'Zonotrichia albicollis' },
    { code: 'devseed-darjun', com: 'Dark-eyed Junco', sci: 'Junco hyemalis' },
  ] },
  { family: 'accipitridae', familyName: 'Hawks, Eagles & Kites', species: [
    { code: 'devseed-rethaw', com: 'Red-tailed Hawk', sci: 'Buteo jamaicensis' },
    { code: 'devseed-baleag', com: 'Bald Eagle', sci: 'Haliaeetus leucocephalus' },
  ] },
  { family: 'ardeidae', familyName: 'Herons & Egrets', species: [
    { code: 'devseed-grbher', com: 'Great Blue Heron', sci: 'Ardea herodias' },
    { code: 'devseed-greegr', com: 'Great Egret', sci: 'Ardea alba' },
  ] },
  { family: 'columbidae', familyName: 'Pigeons & Doves', species: [
    { code: 'devseed-moudov', com: 'Mourning Dove', sci: 'Zenaida macroura' },
    { code: 'devseed-rocpig', com: 'Rock Pigeon', sci: 'Columba livia' },
  ] },
  { family: 'laridae', familyName: 'Gulls & Terns', species: [
    { code: 'devseed-rinbgu', com: 'Ring-billed Gull', sci: 'Larus delawarensis' },
    { code: 'devseed-hergul', com: 'Herring Gull', sci: 'Larus argentatus' },
  ] },
  { family: 'troglodytidae', familyName: 'Wrens', species: [
    { code: 'devseed-houwre', com: 'House Wren', sci: 'Troglodytes aedon' },
    { code: 'devseed-carwre', com: 'Carolina Wren', sci: 'Thryothorus ludovicianus' },
  ] },
  { family: 'paridae', familyName: 'Chickadees & Titmice', species: [
    { code: 'devseed-bkcchi', com: 'Black-capped Chickadee', sci: 'Poecile atricapillus' },
    { code: 'devseed-tuftit', com: 'Tufted Titmouse', sci: 'Baeolophus bicolor' },
  ] },
  { family: 'hirundinidae', familyName: 'Swallows', species: [
    { code: 'devseed-barswa', com: 'Barn Swallow', sci: 'Hirundo rustica' },
    { code: 'devseed-treswa', com: 'Tree Swallow', sci: 'Tachycineta bicolor' },
  ] },
  { family: 'mimidae', familyName: 'Mockingbirds & Thrashers', species: [
    { code: 'devseed-normoc', com: 'Northern Mockingbird', sci: 'Mimus polyglottos' },
    { code: 'devseed-grycat', com: 'Gray Catbird', sci: 'Dumetella carolinensis' },
  ] },
  { family: 'thraupidae', familyName: 'Tanagers & Allies', species: [
    { code: 'devseed-westan', com: 'Western Tanager', sci: 'Piranga ludoviciana' },
    { code: 'devseed-scatan', com: 'Scarlet Tanager', sci: 'Piranga olivacea' },
  ] },
  { family: 'cathartidae', familyName: 'New World Vultures', species: [
    { code: 'devseed-turvul', com: 'Turkey Vulture', sci: 'Cathartes aura' },
    { code: 'devseed-blkvul', com: 'Black Vulture', sci: 'Coragyps atratus' },
  ] },
  { family: 'strigidae', familyName: 'Owls', species: [
    { code: 'devseed-grhowl', com: 'Great Horned Owl', sci: 'Bubo virginianus' },
    { code: 'devseed-burowl', com: 'Burrowing Owl', sci: 'Athene cunicularia' },
  ] },
  { family: 'sittidae', familyName: 'Nuthatches', species: [
    { code: 'devseed-whbnut', com: 'White-breasted Nuthatch', sci: 'Sitta carolinensis' },
    { code: 'devseed-rebnut', com: 'Red-breasted Nuthatch', sci: 'Sitta canadensis' },
  ] },
  { family: 'scolopacidae', familyName: 'Sandpipers & Allies', species: [
    { code: 'devseed-spospa', com: 'Spotted Sandpiper', sci: 'Actitis macularius' },
    { code: 'devseed-killde', com: 'Killdeer', sci: 'Charadrius vociferus' },
  ] },
];

/** Target observation count — enough to populate the national grid + states. */
export const TARGET_OBSERVATIONS = 400;

/** Fraction of observations flagged is_notable. */
const NOTABLE_FRACTION = 0.08;

/** Recency window the whole stack filters on; obs spread across it. */
const RECENCY_WINDOW_DAYS = 14;

export interface SeedResult {
  speciesMetaUpserted: number;
  observationsUpserted: number;
  gridRows: number;
  families: number;
  states: number;
}

/** All species_meta rows the seed needs, flattened from SEED_SPECIES. */
function buildSpeciesMeta(): SpeciesMeta[] {
  const out: SpeciesMeta[] = [];
  let taxon = 100000;
  for (const fam of SEED_SPECIES) {
    for (const sp of fam.species) {
      out.push({
        speciesCode: sp.code,
        comName: sp.com,
        sciName: sp.sci,
        familyCode: fam.family,
        familyName: fam.familyName,
        taxonOrder: taxon++,
      });
    }
  }
  return out;
}

/**
 * Build the deterministic observation set. Each observation jitters its base
 * city coordinate by a small fixed-PRNG offset so markers don't perfectly
 * overlap (still well inside the state polygon). obs_dt is `now` minus a
 * PRNG-chosen number of seconds within the 14-day window.
 */
function buildObservations(nowMs: number): ObservationInput[] {
  const rand = mulberry32(0x5eed_1234);
  const species = SEED_SPECIES.flatMap(fam =>
    fam.species.map(sp => ({ code: sp.code, com: sp.com })),
  );
  const windowMs = RECENCY_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  // Leave a margin so rounding/clock skew never pushes a row past the 14d edge.
  const maxAgeMs = windowMs - 6 * 60 * 60 * 1000;

  const out: ObservationInput[] = [];
  for (let i = 0; i < TARGET_OBSERVATIONS; i++) {
    const city = STATE_CITIES[Math.floor(rand() * STATE_CITIES.length)]!;
    const sp = species[Math.floor(rand() * species.length)]!;

    // ±~0.18° jitter (~12–20 km) around the city — keeps points inside the
    // state while spreading markers so a zoomed-in view isn't a single stack.
    const lat = city.lat + (rand() - 0.5) * 0.36;
    const lng = city.lng + (rand() - 0.5) * 0.36;

    const ageMs = Math.floor(rand() * maxAgeMs);
    const obsDt = new Date(nowMs - ageMs).toISOString();

    // how_many: mostly 1–4, occasionally a flock.
    const r = rand();
    const howMany = r < 0.6 ? 1 + Math.floor(rand() * 3) : r < 0.9 ? 4 + Math.floor(rand() * 8) : 15 + Math.floor(rand() * 40);

    const isNotable = rand() < NOTABLE_FRACTION;

    out.push({
      subId: `devseed-S${String(i).padStart(4, '0')}`,
      speciesCode: sp.code,
      comName: sp.com,
      lat: Number(lat.toFixed(5)),
      lng: Number(lng.toFixed(5)),
      obsDt,
      locId: `devseed-${city.state}-${i % 7}`,
      locName: city.loc,
      howMany,
      isNotable,
    });
  }
  return out;
}

/**
 * Seed the database with deterministic dev observations. Idempotent: the fixed
 * sub_ids/species_codes mean a re-run upserts the same rows. Writes species_meta
 * first (the #484 invariant), then observations, then rebuilds the precompute
 * grid so the default low-zoom map is non-empty.
 */
export async function seedDevData(pool: Pool, nowMs: number = Date.now()): Promise<SeedResult> {
  const meta = buildSpeciesMeta();
  const speciesMetaUpserted = await upsertSpeciesMeta(pool, meta);

  const observations = buildObservations(nowMs);
  const observationsUpserted = await upsertObservations(pool, observations);

  const gridRows = await refreshGridAgg(pool);

  const families = new Set(meta.map(m => m.familyCode)).size;
  const states = new Set(STATE_CITIES.map(c => c.state)).size;

  return { speciesMetaUpserted, observationsUpserted, gridRows, families, states };
}

/** CLI entry: reads DATABASE_URL (defaults to the local docker-compose DB), seeds, prints a coverage summary. */
async function main(): Promise<void> {
  const url = process.env.DATABASE_URL ?? 'postgres://birdwatch:birdwatch@localhost:5432/birdwatch';
  console.log(`Seeding: ${url}`);

  const pool = createPool({ databaseUrl: url });
  try {
    const result = await seedDevData(pool);
    const { rows: [obsRow] } = await pool.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM observations',
    );
    const { rows: [orphan] } = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM observations o
        WHERE NOT EXISTS (SELECT 1 FROM species_meta sm WHERE sm.species_code = o.species_code)`,
    );
    console.log('Dev seed complete.');
    console.log(`  species_meta upserted : ${result.speciesMetaUpserted}`);
    console.log(`  observations upserted : ${result.observationsUpserted}`);
    console.log(`  observations in table : ${obsRow?.n ?? '?'}`);
    console.log(`  observation_grid_agg  : ${result.gridRows} rows`);
    console.log(`  families covered      : ${result.families}`);
    console.log(`  states covered        : ${result.states}`);
    console.log(`  orphan species_code   : ${orphan?.n ?? '?'} (must be 0)`);
  } finally {
    await closePool(pool);
  }
}

// Run main() only when invoked directly (tsx packages/db-client/src/dev-seed.ts),
// never on import (the seed module is also imported by its test).
const invokedPath = process.argv[1] ?? '';
if (invokedPath.endsWith('dev-seed.ts') || invokedPath.endsWith('dev-seed.js')) {
  main().catch((err: unknown) => {
    console.error('Dev seed failed:', err);
    process.exit(1);
  });
}
