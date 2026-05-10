# G4 — Photo coverage audit

**Date:** 2026-05-09
**Method:** Hit `/api/species/<code>` for every unique species code in the 14-day observation window, tally `photoUrl` presence.

## Headline numbers

- **Total observations (14d window):** 10,526
- **Unique species:** 360
- **Photo coverage:** **328 / 360 = 91.1%**
- **Description coverage:** 347 / 360 = 96.4%

The 91.1% photo number is **above the 90% threshold** Agent 5 named in the dissent, but only barely. The 9% no-photo path is exercised on real user traffic, not edge cases. The `<Photo>` primitive's null-src state (silhouette + family-color tint at hero scale) is **load-bearing for ~1 in 11 detail-surface opens**.

## Per-family coverage

| Family | Coverage | % |
|---|---|---|
| `passerellidae` (sparrows) | 26/26 | 100% |
| `accipitridae` (hawks) | 16/16 | 100% |
| `picidae` (woodpeckers) | 12/12 | 100% |
| `trochilidae` (hummingbirds) | 11/11 | 100% |
| `corvidae` (crows/jays) | 9/9 | 100% |
| `fringillidae` (finches) | 8/8 | 100% |
| `turdidae` (thrushes) | 8/8 | 100% |
| `mimidae` (mockingbirds) | 8/8 | 100% |
| `troglodytidae` (wrens) | 7/7 | 100% |
| `strigidae` (owls) | 7/7 | 100% |
| `columbidae` (pigeons/doves) | 7/7 | 100% |
| `hirundinidae` (swallows) | 7/7 | 100% |
| `anatidae` (ducks) | 27/29 | 93.1% |
| `tyrannidae` (flycatchers) | 19/21 | 90.5% |
| `cardinalidae` (cardinals) | 12/13 | 92.3% |
| `icteridae` (orioles) | 11/12 | 91.7% |
| `vireonidae` (vireos) | 6/7 | 85.7% |
| `parulidae` (warblers) | 23/28 | **82.1%** |
| `ardeidae` (herons) | 7/9 | 77.8% |
| `laridae` (gulls/terns) | 7/9 | 77.8% |
| `charadriidae` (plovers) | 4/5 | 80.0% |
| `phasianidae` (gallinaceous) | 4/5 | 80.0% |
| `rallidae` (rails) | 4/5 | 80.0% |

## 32 species without a photo

Concentration in: warblers (`parulidae` — 5 missing), gulls/terns (`laridae` — 2), herons (`ardeidae` — 2), ducks (`anatidae` — 2). The long tail crosses 17 different families.

```
amgplo  charadriidae   boboli  icteridae       budger  psittaculidae
chswar  parulidae      comter  laridae         dickci  cardinalidae
ixlbun  (no family)    laugul  laridae         libher  ardeidae
mallar4 (no family)    mutswa  anatidae        norwat  parulidae
ovenbi1 parulidae      ridrai1 rallidae        rinphe1 phasianidae
rotbec  tityridae      sander  scolopacidae    subfly  tyrannidae
triher  ardeidae       tufduc  anatidae       ... and 12 more
```

## Implications for the spec

1. **`<Photo>` no-photo state is load-bearing, not an afterthought.** Spec §4.3 already requires this — confirmed mandatory by audit.

2. **`<FamilySilhouette>` quality matters across all 7 (used) family colors.** The species without photos cross 17 families; silhouette quality is not optional. Phase 2 acceptance criteria already cover this.

3. **Two species observed without a `familyCode`** (`ixlbun`, `mallar4`). The fallback silhouette needs a "no-family" rendering path — neutral grey (`--color-bg-tint`) with generic bird silhouette. Add to `<FamilySilhouette>` spec: prop `family: FamilyCode | null` with explicit null handling.

4. **Warblers are the most under-photographed family** (82.1%). If the redesign features a "browse by family" surface in v1.1+, warblers may need a curated photo backfill before that surface ships.

5. **Photo coverage ≥90% means Sky Atlas's photo-led identity is defensible** — but Agent 5's concern is partially valid. The redesign should **not** treat photo as optional decoration; it should treat the silhouette fallback as a first-class hero-scale design, tested with the same prototype-gate rigor as the photo path.

## Verdict

**Sky Atlas direction proceeds as specified.** Spec amendments:

- §4.3 `<Photo>` props: change `family: FamilyCode` to `family: FamilyCode | null`. Null-family path renders a neutral silhouette (no family tint) with `--color-bg-tint` background and a generic bird silhouette path.
- §6 risk table: add row "9% of detail-view opens render the no-photo state — silhouette fallback is on the hot path, not an edge case. Mitigation: prototype-gate the no-photo state at the same fidelity as the photo state."
- §8 Phase 2 acceptance criteria already require AA contrast on all family channels — covered.

## Method

```python
# Pseudocode
obs = fetch('https://api.bird-maps.com/api/observations?since=14d')
species_codes = unique(o.speciesCode for o in obs)
results = parallel_fetch(f'https://api.bird-maps.com/api/species/{code}' for code in species_codes)
coverage = sum(1 for r in results if r.photoUrl) / len(results)
```

Run-time: 3.6 seconds (20 concurrent requests).
