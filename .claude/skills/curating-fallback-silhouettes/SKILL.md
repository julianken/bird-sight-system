---
name: curating-fallback-silhouettes
description: Use when a family on bird-maps.com renders the `_FALLBACK` shape because Phylopic has no usable CC-licensed art, when the `/api/silhouettes` audit returns families with `svgData == null AND svgUrl == null`, or when the user asks to "hand-curate", "hand-pick", or "source" a silhouette for a specific bird family. Also triggers on "process the remaining null silhouettes", "find a roadrunner silhouette", "fix the cuckoos", or similar requests to add non-Phylopic silhouettes via the silhouette admin-api.
---

# Curating fallback silhouettes (human-in-the-loop)

## What this is

The Phylopic curation pipeline (`scripts/curate-phylopic.mjs`) sweeps every AZ family and picks the best CC-licensed Phylopic silhouette it can find — but a residual cohort of families have no usable Phylopic art (anonymous-creator-only, NC/ND-only, or no node at all). This skill closes that gap: source a silhouette from outside Phylopic (Wikimedia Commons, SVG Repo, OpenClipArt, iNaturalist, etc.), normalize it to the admin-api validator's shape, and upload it via `npm run silhouette set`. The two workflows complement each other — Phylopic for the families it has art for, this skill for the residual cohort.

## When to use

- A family chip in `FamilyLegend` renders the `_FALLBACK` outline (generic bird shape) and the user wants a real silhouette.
- `curl $READ_API_URL/api/silhouettes` returns one or more entries with `svgData == null AND svgUrl == null`.
- The user names a specific family ("fix the cuckoos", "find a roadrunner silhouette") that the Phylopic curator already exhausted.
- Batch request: "process the remaining nulls" or "fill the rest of the family silhouettes".

## When NOT to use

- Species-level silhouette overrides — the `family_silhouettes` schema is keyed by `family_code` only. Species overrides require a schema change first.
- Photo-based markers — the map renders SDF-traced silhouettes, not photos. A photo system would be a separate feature.
- A family that Phylopic *does* have art for but the auto-pick chose poorly — re-run `node scripts/curate-phylopic.mjs --family <code>` with the existing pipeline first; this skill is the fallback when that pipeline has nothing to pick from.
- Reverting a silhouette — use `npm run silhouette unset <family>` (see Rollback).

## Preconditions

- `bird-admin-api` Cloud Run service deployed (issue #502 landed it; see `docs/runbooks/silhouette-override.md` for the deploy bootstrap).
- `npm run silhouette` alias present in root `package.json` (it forwards to `scripts/silhouette.mjs`).
- Env loaded:
  ```bash
  export ADMIN_API_URL="$(gcloud run services describe bird-admin-api \
    --region=us-west1 --project=bird-maps-prod --format='value(status.url)')"
  export ADMIN_API_TOKEN="$(gcloud secrets versions access latest \
    --secret=bird-watch-admin-api-token --project=bird-maps-prod)"
  ```
- `gcloud auth login` on `bird-maps-prod` (the secret read above will 403 otherwise).
- Read API base URL for the audit step: `export READ_API_URL="https://api.bird-maps.com"`.

## Workflow

### 1. Detect gaps

```bash
curl -s "$READ_API_URL/api/silhouettes" \
  | jq -r '.silhouettes[] | select(.svgData == null and .svgUrl == null) | .familyCode'
```

Each line is a family that currently renders the `_FALLBACK` outline. If the list is empty, there's nothing to do. Keep the list — step 2 picks from it.

### 2. Pick a target family

Either the user names one explicitly, or pop the next family from step 1's list. For each family, identify the iconic AZ species — the one a regional birder pictures when they hear the family name. Squint test at 24-28px decides whether a silhouette is recognizable; pick the most distinctive species.

| Family code | Iconic AZ species | Why |
|---|---|---|
| `cuculidae` | Greater Roadrunner | Unmistakable terrestrial silhouette; Arizona icon |
| `gaviidae` | Common Loon | Heavy body, dagger bill, low waterline pose |
| `icteriidae` | Yellow-breasted Chat | Only species in the family; thrush-like profile |
| `tytonidae` | Barn Owl | Heart-shaped face — diagnostic at small sizes |
| `numididae` | Helmeted Guineafowl | Rare in AZ but the only family member — helmet-and-wattle shape |
| `peucedramidae` | Olive Warbler | Monotypic; warbler profile with longer tail |
| `phasianidae` | Gambel's Quail | Topknot makes the AZ species pickable at any size |

When in doubt: pick the species the family is colloquially named after, or the most-reported species in AZ eBird data for that family.

### 3. Auto-source candidates

For the chosen species, sweep 4–6 CC-licensed sources. Construct queries from the binomial (e.g. `Geococcyx californianus`) and the common name. Always check the license string on each result before adding to the picker — see the License gate below.

| Source | Query URL pattern | Notes |
|---|---|---|
| Wikimedia Commons | `https://commons.wikimedia.org/wiki/Category:<Scientific_name>` | Best yield. Especially `Audubon's Birds of America` plates (PD-old), `Bird-Lore` and `Birds and Nature` lithographs (PD-old). Look for line drawings, not color photos. |
| SVG Repo | `https://www.svgrepo.com/search/?q=<species>` | Filter by license = CC0 in the sidebar. Many results are stylized but trace cleanly. |
| OpenClipArt | `https://openclipart.org/search/?query=<species>` | All CC0 by site policy. Coverage is patchy. |
| Phylopic (relaxed) | `https://api.phylopic.org/images?build=537&filter_name=<scientific-name>&page=0` | `filter_name` is **case-sensitive on the URL** — always lowercase the slug. Useful at genus/species level when the family-level call already failed. |
| iNaturalist CC0 photos | `https://www.inaturalist.org/observations?taxon_name=<species>&license=cc0` | Last resort: trace a photo via `potrace` (`brew install potrace`). Profile shots with high contrast work; busy backgrounds don't. |
| The Noun Project | `https://thenounproject.com/search/icons/?q=<species>` | CC-BY icons. Attribution required. Often the cleanest geometry but stylized. |

Capture for each candidate: download URL of the asset, license id, creator name (or "Unknown, <year>" for PD-old plates), source-page URL.

### 4. Build the picker

Render `templates/picker.html.template` (in this skill folder) into `/tmp/silhouette-picker/<family>/index.html`, substituting `{{FAMILY}}` and `{{CANDIDATES}}`. The template is self-contained (inline CSS, no JS frameworks) and shows each candidate as a numbered card with the original asset thumbnail, license badge, creator, and source link.

Ordering rule (best tracing-fit first, so the eye lands on the most likely winner):

1. CC0-1.0 SVGs (no attribution friction, vector source)
2. PD-old illustrations (line drawings trace cleanly)
3. CC-BY-* SVGs (attribution propagates but ships fine)
4. CC-BY-SA-* (share-alike propagation — flag with a badge)
5. CC-BY-NC-*, CC-BY-ND-*, PD-mark (reference only — include with a "cannot ship" warning so the user knows why a tempting result is excluded)

A quick substitution (multi-line `sed` form — portable across macOS BSD
`sed` and GNU `sed`; the single-line `{r file; d}` shape that GNU `sed`
accepts fails on BSD `sed` with `extra characters at the end of d
command`):

```bash
FAMILY=cuculidae
DIR="/tmp/silhouette-picker/$FAMILY"
mkdir -p "$DIR"
# Build /tmp/candidates.html (one <article class="card">…</article> per
# candidate; see the picker template header for the card shape), then:
sed -e "s/{{FAMILY}}/$FAMILY/g" \
    -e "/{{CANDIDATES}}/{
          r /tmp/candidates.html
          d
        }" \
    .claude/skills/curating-fallback-silhouettes/templates/picker.html.template \
  > "$DIR/index.html"
cd "$DIR" && python3 -m http.server 8765 &
open "http://localhost:8765/"
```

Wait for the user to name the winning number. If none of the candidates work, return to step 3 with broadened queries (genus level, related species, alternate common names).

### 5. Normalize the chosen SVG

Admin-api validator requires:

- Single `<svg>` root with exactly one `<path>` child
- `viewBox="0 0 24 24"` (or absent)
- Body ≤ 64 KB
- path-d charset: digits, the SVG command letters, space, dash, dot, comma
- No `<g>`, `<defs>`, `<use>`, `<style>`, `<script>`, event handlers, or `xlink:*`

Operator hint (not enforced by the validator): paths under ~20 commands
tend to render as unrecognizable blobs at 24–28px legend scale. The
automated Phylopic sourcing pipeline (`extractPathD` in
`scripts/curate-phylopic.mjs`) applies a ≥20-command floor at curation
time as a quality heuristic, but the admin-api validator
(`services/admin-api/src/validate.ts`) does not — a hand-curated
silhouette below 20 commands will upload fine but may not read at small
sizes. Squint-test before shipping.

If the chosen file violates any rule, reduce it. The algorithm to apply:

1. Parse the SVG, locate the first `<path d="...">`.
2. If a `<g transform="translate(...) scale(...)">` wraps it, flatten the transform into the path coordinates (potrace's translate-then-scale shape is what `parseGTransform` / `transformPathD` in `scripts/curate-phylopic.mjs` handle).
3. Multi-path SVGs: concatenate `d` attributes (`M ... Z M ... Z`) — the validator accepts a single `<path>` whose `d` contains multiple sub-paths.
4. Normalize coordinates so the bounding box maps to 0..24. The `normalizePath` helper in `scripts/curate-phylopic.mjs` does this in two passes (read bounds, scale uniformly).
5. Re-emit as `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="..."/></svg>` with no other attributes.

The cleanest path is to call the existing helpers directly. A minimal wrapper:

```js
// scripts/normalize-foreign-svg.mjs (write ad-hoc; don't commit unless useful)
import { readFileSync } from 'node:fs';
// `extractPathD` is not exported by curate-phylopic.mjs today — either
// re-export it for this use, or hand-port the ~60 lines (parseGTransform +
// transformPathD + normalizePath + extractPathD) into the wrapper.
const svg = readFileSync(process.argv[2], 'utf8');
const result = extractPathD(svg);
if (!result.ok) { console.error(result.reason); process.exit(1); }
process.stdout.write(
  `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="${result.d}"/></svg>\n`
);
```

If flattening fails (gradients, masks, non-reducible transforms, multi-style fills), the file is not tractable — either hand-edit in Inkscape (Path → Object to Path, then Path → Combine) and re-run, or fall back to a different candidate from step 3.

### 6. Upload and verify

```bash
npm run silhouette set <family> ./cleaned.svg
```

Expected: HTTP 200, JSON `{ familyCode, svgUrl, etag, ... }`. A 400 names the failing validator rule — fix and retry.

Then confirm end-to-end:

```bash
# 1. Cache freshens within ~30s. Read API echoes the new payload.
curl -s "$READ_API_URL/api/silhouettes" \
  | jq ".silhouettes[] | select(.familyCode == \"<family>\")"
# Expect both svgData (inline path-d) and svgUrl (R2 URL) populated.

# 2. R2 URL serves the SVG directly.
curl -sI "$(curl -s "$READ_API_URL/api/silhouettes" \
  | jq -r ".silhouettes[] | select(.familyCode == \"<family>\") | .svgUrl")"
# Expect HTTP/2 200, content-type: image/svg+xml.

# 3. Hard-refresh https://bird-maps.com — the FamilyLegend chip for <family>
#    renders the new silhouette and the map cluster mosaic picks it up on
#    next render (SDF re-bake is automatic).
```

### 7. Cleanup

```bash
rm -rf "/tmp/silhouette-picker/<family>"
# Kill the http.server background job:
kill %1 2>/dev/null || true
```

## Batch mode

For "process the remaining nulls", loop steps 2–7 per family. Suggested driver shape:

```bash
NULLS=$(curl -s "$READ_API_URL/api/silhouettes" \
  | jq -r '.silhouettes[] | select(.svgData == null and .svgUrl == null) | .familyCode')
for family in $NULLS; do
  echo "=== $family ==="
  # steps 2-7, with the user confirming each pick before upload
done
```

Don't auto-pick across the loop — the human is the discriminator. The loop just saves typing.

## Sourcing playbook by family type

| Family shape | Primary sources | Secondary | Notes |
|---|---|---|---|
| Cuckoos / roadrunners | Wikimedia (Audubon plates) | SVG Repo CC0 | Long-tailed terrestrial profile traces well |
| Loons | Wikimedia (Bird-Lore plates) | Phylopic genus-level | Heavy body + dagger bill — needs profile pose |
| Game birds (quail, guineafowl) | Phylopic species-level | Wikimedia | Body shape is family-diagnostic; pick the AZ species |
| Small passerines (chats, warblers) | Wikimedia | iNaturalist CC0 traced | Family shapes blur at 24px — pick a pose with tail extended |
| Owls | Phylopic species-level | NPS / USFWS public-domain SVGs | Heart-face for Tyto, round-face for Strix |
| Hummingbirds | SVG Repo CC0 | Wikimedia | Hover pose with extended bill reads at small sizes |

## License gate

Apply this on every candidate before adding it to the picker.

| License | Ship? | Notes |
|---|---|---|
| CC0-1.0 | YES | No attribution required. First choice. |
| CC-BY-3.0 / 4.0 | YES | Attribution required — add to `AttributionModal` via the curation migration or follow-up |
| CC-BY-SA-3.0 / 4.0 | CAUTION | Share-alike propagates. The site's silhouette pipeline arguably qualifies as a derivative work; flag with a badge in the picker and confirm with Julian before shipping |
| PD-old (pre-1928 publications) | YES | No attribution but include the "Publication, year" in commit message for traceability |
| PD-USGov (NPS, USFWS, USGS) | YES | Federal-government works are public domain by 17 U.S.C. § 105 |
| PD-mark | NO | Indicates "no known restrictions" but isn't a license — too ambiguous to ship |
| CC-BY-NC-* | NO | Non-commercial restriction; bird-maps.com isn't strictly commercial but the line is fuzzy enough to skip |
| CC-BY-ND-* | NO | No-derivatives forbids the SDF trace and the viewBox renormalization, both of which are derivative acts |

## Common gotchas

- **Phylopic `filter_name` is case-sensitive on the URL.** Always `.toLowerCase()` the slug or the API returns an empty list. The `nodeBySlug` helper in `scripts/curate-phylopic.mjs` learned this the hard way.
- **"Unknown" creator on Wikimedia.** Plates labeled "Unknown, <year>" by Wikimedia editors are usually well-known publications (Audubon, Bird-Lore, Birds and Nature). Substitute the publication name + year as the creator string before upload — anonymous credit is rejected by the audit downstream.
- **CSS `mask-image` requires CORS on the silhouette URL.** The Worker that serves R2 silhouette URLs sets `access-control-allow-origin: *`. If the Worker is ever modified, preserve that header — without it the `mask-image` pipeline degrades to inline-SVG fallback and the SDF clustering breaks.
- **One iconic species per family.** Squint-test at 24–28px before committing. A "technically correct but unrecognizable at small sizes" silhouette is worse than the `_FALLBACK` shape because the user assumes it's information.
- **Phylopic curation pipeline's ≥20-command floor (issue #500) is a sourcing filter, not a validator rule.** It fires inside `extractPathD` in `scripts/curate-phylopic.mjs` and gates which Phylopic results the automated pipeline accepts. The admin-api validator (`services/admin-api/src/validate.ts`) does NOT enforce a path-command floor, so a hand-curated silhouette below 20 commands will upload successfully. Pre-#500 silhouettes ship at a median of 16 commands. Treat ~20 as a squint-test rule of thumb for legibility at 24–28px; if a hand-curated silhouette is otherwise good but reads as a blob, add a few smoothing curves before retrying — but don't drop the candidate just because it trips the heuristic.

## Rollback

```bash
npm run silhouette unset <family>
```

Reverts that row's `svg_data` + `svg_url` to NULL. The frontend renders the `_FALLBACK` shape again within ~30s of cache refresh. There is no soft-delete; if a curated silhouette ever ships and is later unset, the upload step has to repeat from step 4 onward to restore it.
