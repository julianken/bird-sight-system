import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startTestDb, type TestDb } from './test-helpers.js';
import { getSilhouettes } from './silhouettes.js';

let db: TestDb;
beforeAll(async () => { db = await startTestDb(); }, 90_000);
afterAll(async () => { await db?.stop(); });

describe('getSilhouettes', () => {
  it('returns all 96 seeded families (95 real + _FALLBACK)', async () => {
    // 15 from migration 9000 + 10 AZ-family expansion from migration 15000
    // (#244) + the `_FALLBACK` row from migration 18000 (#246) + icteridae
    // from migration 33000 (#482) + 38 observed-family backfill from
    // migration 34000 (#495) + 32 national-coverage rows from migration
    // 48000 (Phase 3a US-wide flip) − 1 spelling-variant dedupe from
    // migration 52000 (#922, inverted-spelling fix: dropped the no-`i` orphan
    // `ptilogonatidae`, kept eBird-canonical `ptiliogonatidae`). The _FALLBACK
    // row backs the SDF symbol
    // layer's fallback rendering for observations whose family has no
    // usable Phylopic silhouette.
    const rows = await getSilhouettes(db.pool);
    expect(rows).toHaveLength(96);
    // _FALLBACK row exists with sentinel family_code.
    const fallback = rows.find(r => r.familyCode === '_FALLBACK');
    expect(fallback).toBeDefined();
    expect(fallback!.color).toBe('#626262');
    expect(fallback!.colorDark).toBe('#626262');
    expect(typeof fallback!.svgData).toBe('string');
    expect(fallback!.source).toBeNull();
    expect(fallback!.license).toBeNull();
    expect(fallback!.creator).toBeNull();
    expect(fallback!.commonName).toBe('Unknown family');
    // svgUrl (issue #502) is null for every seeded row — admin-api uploads
    // are the only writer, and no overrides have landed yet.
    expect(fallback!.svgUrl).toBeNull();
  });

  it('projects svgUrl as null for every seeded row (issue #502)', async () => {
    // Every row in the post-migration baseline must surface svgUrl: null
    // (column added by migration 1700000037000; admin-api PUT is the
    // only writer, and no uploads have landed yet).
    const rows = await getSilhouettes(db.pool);
    const nonNull = rows.filter(r => r.svgUrl !== null);
    expect(nonNull).toEqual([]);
  });

  it('projects each row with familyCode, color, svgData, source, license, commonName, creator', async () => {
    const rows = await getSilhouettes(db.pool);
    const accipitridae = rows.find(r => r.familyCode === 'accipitridae');
    expect(accipitridae).toBeDefined();
    expect(accipitridae!.color).toMatch(/^#[0-9A-F]{6}$/i);
    // svgData is nullable on the type. After migration 17000 seeds Phylopic
    // SVGs for families with usable candidates, this row holds a real
    // path-d string; for families flagged "no usable Phylopic SVG" the
    // value is NULL. Accipitridae has many CC0 candidates so it's a string.
    expect(typeof accipitridae!.svgData).toBe('string');
    // source and license are TEXT NULL in the schema. The post-curation
    // seed (migration 17000, issue #245) writes the Phylopic image-page
    // URL into source and a short license identifier into license.
    expect(accipitridae).toHaveProperty('source');
    expect(accipitridae).toHaveProperty('license');
    // commonName added in migration 1700000019000 + seeded in
    // 1700000019500 (issue #249). The seeded row is non-null.
    expect(accipitridae).toHaveProperty('commonName');
    expect(typeof accipitridae!.commonName).toBe('string');
    // creator added in migration 1700000016000 + populated by 1700000017000
    // (issue #245). The Phylopic seed writes a creator name where one is
    // available; rows for families without a usable Phylopic SVG land NULL.
    expect(accipitridae).toHaveProperty('creator');
  });

  it('returns rows in stable familyCode order (PostgreSQL locale collation)', async () => {
    // The query is `ORDER BY family_code` with no explicit COLLATE, so the
    // ordering reflects PostgreSQL's locale-aware default collation
    // (typically en_US.UTF-8 in the postgis/postgis:16-3.4 testcontainer
    // image). Under that collation, the leading underscore in `_FALLBACK`
    // is skipped at primary weight (treated as punctuation), so the row
    // sorts as if it were `FALLBACK` — landing between `cuculidae` and
    // `fringillidae`, NOT first as a JS String.prototype.sort() would
    // place it. The choice (option 2 in the issue body) is to assert the
    // *actual* DB order rather than normalize the SELECT to COLLATE "C".
    // Deliberate trade-off: the consumer doesn't depend on _FALLBACK
    // being first, and `COLLATE "C"` would reshuffle every row
    // alphabetically and force a parity-snapshot rewrite.
    const rows = await getSilhouettes(db.pool);
    const codes = rows.map(r => r.familyCode);
    // The relative order must be stable across runs — any two adjacent
    // codes must agree with PostgreSQL's locale comparator. Use an
    // Intl.Collator with the same UCA-based primary weight to mirror
    // libc's en_US.UTF-8 closely enough that the underscore drops out.
    const collator = new Intl.Collator('en-US', { usage: 'sort', sensitivity: 'variant' });
    const sortedExpected = [...codes].sort((a, b) => {
      // Strip leading underscore (primary-weight skip) before comparing.
      const ka = a.replace(/^_+/, '').toLowerCase();
      const kb = b.replace(/^_+/, '').toLowerCase();
      return collator.compare(ka, kb);
    });
    expect(codes).toEqual(sortedExpected);
    // Spot-check: `_FALLBACK` sorts in the locale position, not first.
    const fallbackIdx = codes.indexOf('_FALLBACK');
    expect(fallbackIdx).toBeGreaterThan(0);
    // Adjacent neighbour above must compare ≤ FALLBACK at primary weight.
    const above = codes[fallbackIdx - 1]!;
    expect(collator.compare(above.toLowerCase(), 'fallback')).toBeLessThanOrEqual(0);
  });

  it('colors match the legacy FAMILY_TO_COLOR snapshot (parity with deleted hardcoded map)', async () => {
    // This snapshot covers four cohorts of seeded family colors:
    //   (i) the 15 #55 option-(a) rows from migration 9000 (the original
    //       FAMILY_TO_COLOR parity snapshot — required so that the DB
    //       continues to report the same 15 colors that shipped on
    //       2026-04-19 after the hardcoded map was deleted),
    //   (ii) the 10 expansion rows added by migration 15000 (issue #244)
    //        so ingest stamping no longer NULLs silhouette_id for the most
    //        common AZ families,
    //   (iii) the `_FALLBACK` row added by migration 18000 (issue #246) —
    //        the sentinel sprite the SDF symbol layer falls back to for
    //        observations whose family has no usable Phylopic silhouette,
    //        and
    //   (iv) the 32 national-coverage rows from migration 48000 (Phase 3a
    //        US-wide flip) — dual-palette `{color, color_dark}` per
    //        NATIONAL_COLOR_BY_FAMILY in scripts/curate-phylopic.mjs.
    // If a future seed migration edits a color, update BOTH this snapshot
    // and the migration in the same PR.
    const rows = await getSilhouettes(db.pool);
    const byFamily = Object.fromEntries(rows.map(r => [r.familyCode, r.color]));
    // Colors reflect migration 1700000046000 (adaptive-grid contrast Phase 1, #570).
    // 24 light-failing families had their `color` darkened; 22 dark-failing families
    // had their `color` lightened. The 19 passing families are unchanged.
    expect(byFamily).toEqual({
      // --- migration 9000 (#55 option-(a)) — dark-failing group (lightened by 1700000046000) ---
      accipitridae: '#626262',  // was #222222
      anatidae: '#3A6B8E',      // unchanged (passes both)
      ardeidae: '#5A6B2A',      // unchanged (passes both)
      cathartidae: '#606060',   // was #444444
      corvidae: '#5858ac',      // was #222244
      cuculidae: '#795f29',     // was #5E4A20
      odontophoridae: '#86582c', // was #7A5028
      passerellidae: '#bc7d29', // was #D4923A (light-failing, darkened)
      picidae: '#FF0808',       // unchanged (passes both)
      scolopacidae: '#9B7B3A', // unchanged (passes both)
      strigidae: '#725e35',     // was #5A4A2A
      trochilidae: '#9637ad',   // was #7B2D8E
      troglodytidae: '#86582c', // was #7A5028
      trogonidae: '#FF0808',    // unchanged (passes both)
      tyrannidae: '#c3772d',    // was #C77A2E (light-failing, darkened)
      // --- migration 15000 (issue #244 expansion) ---
      caprimulgidae: '#6c52a3', // was #3D2E5C
      cardinalidae: '#b9251b',  // was #B0231A
      columbidae: '#99876b',    // was #A89880 (light-failing, darkened)
      fringillidae: '#b1821a',  // was #E0A82E (light-failing, darkened)
      mimidae: '#8E7B5A',       // unchanged (passes both)
      paridae: '#4A6FA5',       // unchanged (passes both)
      parulidae: '#958b23',     // was #D4C84A (light-failing, darkened)
      remizidae: '#789166',     // was #9AAE8C (light-failing, darkened)
      threskiornithidae: '#C56B9D', // unchanged (passes both)
      // --- migration 18000 (issue #246 fallback) ---
      _FALLBACK: '#626262',     // was #555555
      // --- migration 33000 (issue #482 icteridae fill) ---
      icteridae: '#b28300',     // was #F4B400 (light-failing, darkened)
      // --- migration 34000 (issue #495 backfill) ---
      aegithalidae: '#a28662',  // was #C2B098 (light-failing, darkened)
      alaudidae: '#ac814d',     // was #B89060 (light-failing, darkened)
      alcedinidae: '#5481A0',   // unchanged (passes both)
      apodidae: '#686058',      // was #36322E
      bombycillidae: '#ab8144', // was #C9A878 (light-failing, darkened)
      calcariidae: '#b78129',   // was #E5C28A (light-failing, darkened)
      certhiidae: '#805939',    // was #6B4A30
      charadriidae: '#a58455',  // was #BFA682 (light-failing, darkened)
      cinclidae: '#6E7378',     // unchanged (passes both)
      falconidae: '#546272',    // was #475360
      gaviidae: '#4c637a',      // was #2B3845
      gruidae: '#8A8470',       // unchanged (passes both)
      hirundinidae: '#4693b6',  // was #5BA0C0 (light-failing, darkened)
      icteriidae: '#998809',    // was #F4E04D (light-failing, darkened)
      laniidae: '#7E848A',      // unchanged (passes both)
      laridae: '#708fa1',       // was #8FA7B5 (light-failing, darkened)
      motacillidae: '#7E6440',  // unchanged (passes both)
      numididae: '#5A6878',     // unchanged (passes both)
      pandionidae: '#7c5936',   // was #4A3520
      passeridae: '#8E5B3A',    // unchanged (passes both)
      pelecanidae: '#b3813a',   // was #E8D4B8 (light-failing, darkened)
      peucedramidae: '#8A8C66', // unchanged (passes both)
      phalacrocoracidae: '#51665e', // was #26302C
      phasianidae: '#6E7A48',   // unchanged (passes both)
      podicipedidae: '#406a65', // was #2F4D4A
      polioptilidae: '#788ca0', // was #A8B5C2 (light-failing, darkened)
      psittacidae: '#3b9d4b',   // was #3FA850 (light-failing, darkened)
      psittaculidae: '#3d9790', // was #4FB8B0 (light-failing, darkened)
      // ptiliogonatidae is the silky-flycatcher survivor of migration 52000
      // (#922 dedupe, inverted-spelling fix): the no-`i` `ptilogonatidae`
      // orphan was deleted and its #5b5b9c palette transferred onto this row.
      ptiliogonatidae: '#5b5b9c',
      rallidae: '#63605a',      // was #403E3A
      recurvirostridae: '#c47484', // was #E1B8C0 (light-failing, darkened)
      regulidae: '#68964b',     // was #6FA050 (light-failing, darkened)
      sittidae: '#6B7A8E',      // unchanged (passes both)
      sturnidae: '#6b5885',     // was #2D2538
      tityridae: '#a18199',     // was #A88AA0 (light-failing, darkened)
      turdidae: '#A05A3A',      // unchanged (passes both)
      tytonidae: '#aa8434',     // was #D6B878 (light-failing, darkened)
      vireonidae: '#769156',    // was #7E9B5C (light-failing, darkened)
      // --- migration 48000 (Phase 3a national-coverage flip) ---
      // 32 new families: 17 INSERTed with svg_data, 15 INSERTed with NULL
      // svg_data. Colors are dual-palette (color paired with light basemap;
      // color_dark paired with dark basemap, see migration 46000 contract).
      acrocephalidae: '#7b6a3c',
      alcidae: '#1d2b3a',
      anhingidae: '#2b231d',
      aramidae: '#5a3c2a',
      bucerotidae: '#3a2515',
      cacatuidae: '#a48928',
      casuariidae: '#4a2333',
      cettiidae: '#9c7a4a',
      ciconiidae: '#978860',
      cracidae: '#382a1c',
      diomedeidae: '#7f8b96',
      estrildidae: '#c25a4a',
      fregatidae: '#171a1f',
      haematopodidae: '#e84a30',
      hydrobatidae: '#3d3a36',
      leiothrichidae: '#6f6045',
      monarchidae: '#4a5d6e',
      muscicapidae: '#695a4d',
      oceanitidae: '#2c2926',
      paradoxornithidae: '#8d6e4a',
      phaethontidae: '#b4823e',
      phoenicopteridae: '#e9547d',
      ploceidae: '#ac841a',
      procellariidae: '#5e6a76',
      pteroclidae: '#a38457',
      pycnonotidae: '#544038',
      ramphastidae: '#dc6c00',
      stercorariidae: '#3f342a',
      sulidae: '#9d895c',
      thraupidae: '#cf2b3a',
      viduidae: '#1a1414',
      zosteropidae: '#7d9156',
    });
  });

  it('every seeded family has a non-null commonName (issue #249 seed migration)', async () => {
    // The 1700000019500 data migration populates English common names for
    // every family code that exists in the seed. Production callers
    // (FamilyLegend) fall back to `prettyFamily(familyCode)` when this
    // field is NULL — that fallback is purely defensive for unseeded
    // families landing post-deploy. For the seeded baseline, the
    // expectation is zero NULL rows.
    const rows = await getSilhouettes(db.pool);
    const nullCommon = rows.filter(r => r.commonName === null);
    expect(nullCommon).toEqual([]);
  });

  it('common-name snapshot for all 96 seeded families (incl. _FALLBACK)', async () => {
    // Curated English common names per migration 1700000019500 (original 27
    // families) plus migration 1700000034000 (38 backfill families per
    // issue #495) plus migration 1700000048000 (32 national-coverage
    // families, Phase 3a US-wide flip) minus migration 1700000052000 (#922:
    // dropped the spelling-variant `ptiliogonatidae`). Update both sides
    // together if the seed text changes.
    const rows = await getSilhouettes(db.pool);
    const byFamily = Object.fromEntries(rows.map(r => [r.familyCode, r.commonName]));
    expect(byFamily).toEqual({
      // baseline (migration 9000)
      accipitridae: 'Hawks, Eagles & Kites',
      anatidae: 'Ducks, Geese & Swans',
      ardeidae: 'Herons & Egrets',
      cathartidae: 'New World Vultures',
      corvidae: 'Crows, Jays & Magpies',
      cuculidae: 'Cuckoos & Roadrunners',
      odontophoridae: 'New World Quail',
      passerellidae: 'New World Sparrows',
      picidae: 'Woodpeckers',
      scolopacidae: 'Sandpipers',
      strigidae: 'Owls',
      trochilidae: 'Hummingbirds',
      troglodytidae: 'Wrens',
      trogonidae: 'Trogons',
      tyrannidae: 'Tyrant Flycatchers',
      // AZ expansion (migration 15000, issue #244)
      cardinalidae: 'Cardinals & Allies',
      mimidae: 'Mockingbirds & Thrashers',
      columbidae: 'Pigeons & Doves',
      parulidae: 'New World Warblers',
      paridae: 'Tits, Chickadees & Titmice',
      fringillidae: 'Finches',
      caprimulgidae: 'Nightjars',
      remizidae: 'Verdins',
      threskiornithidae: 'Ibises & Spoonbills',
      // _FALLBACK row from migration 18000 (issue #246) — back-stops the
      // map's symbol layer when a family has no usable Phylopic SVG.
      _FALLBACK: 'Unknown family',
      // icteridae row from migration 33000 (issue #482) — was missing from
      // the original Phylopic curation, hiding every blackbird/oriole/grackle
      // from the legend until this migration backfilled it.
      icteridae: 'Blackbirds, Orioles & Allies',
      // --- migration 34000 (issue #495 backfill) ---
      aegithalidae: 'Bushtits',
      alaudidae: 'Larks',
      alcedinidae: 'Kingfishers',
      apodidae: 'Swifts',
      bombycillidae: 'Waxwings',
      calcariidae: 'Longspurs & Snow Buntings',
      certhiidae: 'Treecreepers',
      charadriidae: 'Plovers & Lapwings',
      cinclidae: 'Dippers',
      falconidae: 'Falcons & Caracaras',
      gaviidae: 'Loons',
      gruidae: 'Cranes',
      hirundinidae: 'Swallows',
      icteriidae: 'Yellow-breasted Chat',
      laniidae: 'Shrikes',
      laridae: 'Gulls, Terns & Skimmers',
      motacillidae: 'Wagtails & Pipits',
      numididae: 'Guineafowl',
      pandionidae: 'Ospreys',
      passeridae: 'Old World Sparrows',
      pelecanidae: 'Pelicans',
      peucedramidae: 'Olive Warbler',
      phalacrocoracidae: 'Cormorants & Shags',
      phasianidae: 'Pheasants, Grouse & Allies',
      podicipedidae: 'Grebes',
      polioptilidae: 'Gnatcatchers',
      psittacidae: 'African & New World Parrots',
      psittaculidae: 'Old World Parrots',
      // ptiliogonatidae is the silky-flycatcher survivor of migration 52000
      // (#922 dedupe, inverted-spelling fix); the no-`i` `ptilogonatidae`
      // orphan was deleted and its title-case common_name transferred here.
      ptiliogonatidae: 'Silky-Flycatchers',
      rallidae: 'Rails, Gallinules & Coots',
      recurvirostridae: 'Stilts & Avocets',
      regulidae: 'Kinglets',
      sittidae: 'Nuthatches',
      sturnidae: 'Starlings & Mynas',
      tityridae: 'Tityras & Allies',
      turdidae: 'Thrushes',
      tytonidae: 'Barn-Owls',
      vireonidae: 'Vireos',
      // --- migration 48000 (Phase 3a national-coverage flip) ---
      acrocephalidae: 'Reed-Warblers & Allies',
      alcidae: 'Auks, Murres & Puffins',
      anhingidae: 'Anhingas',
      aramidae: 'Limpkin',
      bucerotidae: 'Hornbills',
      cacatuidae: 'Cockatoos',
      casuariidae: 'Cassowaries',
      cettiidae: 'Bush Warblers & Allies',
      ciconiidae: 'Storks',
      cracidae: 'Guans, Chachalacas & Curassows',
      diomedeidae: 'Albatrosses',
      estrildidae: 'Waxbills & Allies',
      fregatidae: 'Frigatebirds',
      haematopodidae: 'Oystercatchers',
      hydrobatidae: 'Northern Storm-Petrels',
      leiothrichidae: 'Laughingthrushes & Allies',
      monarchidae: 'Monarch Flycatchers',
      muscicapidae: 'Old World Flycatchers',
      oceanitidae: 'Southern Storm-Petrels',
      paradoxornithidae: 'Parrotbills & Allies',
      phaethontidae: 'Tropicbirds',
      phoenicopteridae: 'Flamingos',
      ploceidae: 'Weavers & Allies',
      procellariidae: 'Shearwaters & Petrels',
      pteroclidae: 'Sandgrouse',
      pycnonotidae: 'Bulbuls',
      ramphastidae: 'Toucans',
      stercorariidae: 'Skuas & Jaegers',
      sulidae: 'Boobies & Gannets',
      thraupidae: 'Tanagers & Allies',
      viduidae: 'Indigobirds & Whydahs',
      zosteropidae: 'White-eyes & Yuhinas',
    });
  });
});
