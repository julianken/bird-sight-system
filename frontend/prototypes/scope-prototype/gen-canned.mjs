/**
 * One-shot generator for `canned-az-scoped.json` — the prototype fixture.
 *
 * Produces a deterministic (seeded PRNG) set of observations matching the
 * production `Observation` shape from @bird-watch/shared-types. The bulk are
 * clipped inside the Arizona bounding box (so the AZ scope view renders ≥344
 * rows at production volume); a sparse CONUS spread (NY/FL/CA/TX/CO/WA) backs
 * the `?scope=us` whole-US view and the ZIP→state resolution prototype.
 *
 * Run once with `node gen-canned.mjs`; the JSON is committed, this script is
 * not part of any build pipeline (knip-ignored — see knip.ts).
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Mulberry32 — tiny deterministic PRNG so the fixture is byte-stable across
// regenerations (no flaky diffs).
function mulberry32(seed) {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(0x5eed);

// Representative species pool with family codes (a real subset of eBird codes).
const SPECIES = [
  ['vermfly', 'Vermilion Flycatcher', 'tyrannidae'],
  ['gambel', "Gambel's Quail", 'odontophoridae'],
  ['cacwre', 'Cactus Wren', 'troglodytidae'],
  ['gilwoo', 'Gila Woodpecker', 'picidae'],
  ['curtho', 'Curve-billed Thrasher', 'mimidae'],
  ['phaino', 'Phainopepla', 'ptiliogonatidae'],
  ['blkpho', 'Black Phoebe', 'tyrannidae'],
  ['annhum', "Anna's Hummingbird", 'trochilidae'],
  ['gretow', 'Greater Roadrunner', 'cuculidae'],
  ['houfin', 'House Finch', 'fringillidae'],
  ['mouqua', 'Mourning Dove', 'columbidae'],
  ['rethaw', 'Red-tailed Hawk', 'accipitridae'],
  ['turvul', 'Turkey Vulture', 'cathartidae'],
  ['comrav', 'Common Raven', 'corvidae'],
  ['vergin', 'Verdin', 'remizidae'],
  ['cantow', 'Canyon Towhee', 'passerellidae'],
];

// City clusters (lng, lat, weight) inside Arizona so the data forms realistic
// dense knots — Phoenix, Tucson, Flagstaff, Yuma, Sedona, Sierra Vista.
const AZ_CLUSTERS = [
  [-112.074, 33.448, 0.40], // Phoenix
  [-110.974, 32.222, 0.28], // Tucson
  [-111.651, 35.198, 0.10], // Flagstaff
  [-114.624, 32.692, 0.08], // Yuma
  [-111.788, 34.87, 0.07], // Sedona
  [-110.297, 31.554, 0.07], // Sierra Vista
];

// AZ envelope (matches the structured-data box in frontend/index.html):
// south 31.332, west -114.815, north 37.004, east -109.045.
const AZ_BBOX = { w: -114.815, s: 31.332, e: -109.045, n: 37.004 };

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function round5(v) {
  return Math.round(v * 1e5) / 1e5;
}

// CONUS spread for the whole-US view + ZIP resolution targets.
const CONUS_SPREAD = [
  [-73.99, 40.74, 'New York, NY'], // 10001 → US-NY
  [-81.7, 27.8, 'Lakeland, FL'], // → US-FL
  [-118.24, 34.05, 'Los Angeles, CA'], // → US-CA
  [-97.74, 30.27, 'Austin, TX'], // → US-TX
  [-104.99, 39.74, 'Denver, CO'], // → US-CO
  [-122.33, 47.61, 'Seattle, WA'], // → US-WA
  [-87.63, 41.88, 'Chicago, IL'], // → US-IL
  [-71.06, 42.36, 'Boston, MA'], // → US-MA
];

let n = 0;
const observations = [];

function pushObs(lng, lat, locName, notableBias = 0.04) {
  const [speciesCode, comName, familyCode] = SPECIES[Math.floor(rand() * SPECIES.length)];
  const daysAgo = Math.floor(rand() * 14);
  const obsDt = new Date(Date.UTC(2026, 4, 28 - daysAgo, 6 + Math.floor(rand() * 12), Math.floor(rand() * 60)))
    .toISOString()
    .slice(0, 16)
    .replace('T', ' ');
  observations.push({
    subId: `S${(100000 + n).toString()}`,
    speciesCode,
    comName,
    lat: round5(lat),
    lng: round5(lng),
    obsDt,
    locId: `L${(900000 + n).toString()}`,
    locName,
    howMany: rand() < 0.2 ? null : 1 + Math.floor(rand() * 8),
    isNotable: rand() < notableBias,
    silhouetteId: familyCode,
    familyCode,
    taxonOrder: 10000 + Math.floor(rand() * 20000),
  });
  n += 1;
}

// 360 AZ rows distributed across the city clusters with gaussian-ish scatter.
const AZ_COUNT = 360;
for (let i = 0; i < AZ_COUNT; i++) {
  // pick a cluster by weight
  let r = rand();
  let chosen = AZ_CLUSTERS[0];
  for (const c of AZ_CLUSTERS) {
    if (r < c[2]) {
      chosen = c;
      break;
    }
    r -= c[2];
  }
  // box-muller-ish scatter (~0.25 deg sigma), clamped to the AZ envelope
  const spread = 0.18 + rand() * 0.22;
  const dx = (rand() - 0.5) * 2 * spread;
  const dy = (rand() - 0.5) * 2 * spread;
  const lng = clamp(chosen[0] + dx, AZ_BBOX.w + 0.02, AZ_BBOX.e - 0.02);
  const lat = clamp(chosen[1] + dy, AZ_BBOX.s + 0.02, AZ_BBOX.n - 0.02);
  pushObs(lng, lat, `AZ site ${i + 1}`);
}

// CONUS spread: ~14 rows per city so the whole-US view has visible knots.
for (const [clng, clat, name] of CONUS_SPREAD) {
  for (let i = 0; i < 14; i++) {
    const dx = (rand() - 0.5) * 0.6;
    const dy = (rand() - 0.5) * 0.6;
    pushObs(clng + dx, clat + dy, name);
  }
}

const out = {
  // Mirrors the production GET /api/observations `mode:'observations'` body.
  mode: 'observations',
  data: observations,
  meta: { freshestObservationAt: '2026-05-28T18:30:00.000Z' },
};

writeFileSync(join(__dirname, 'canned-az-scoped.json'), JSON.stringify(out, null, 0) + '\n');
console.log(`wrote ${observations.length} observations (${AZ_COUNT} AZ + ${CONUS_SPREAD.length * 14} CONUS)`);
