# Sky Atlas — Phase 6 Metadata + Brand Voice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close all 19 metadata gaps identified in the analysis funnel; rewrite the one voice string that exposes raw internals (`App.tsx:147`); add JSON-LD structured-data markup; wire the wordmark with `REGION_LABEL`; remove the persistent footer; and update `AttributionModal.tsx`'s compliance comment to reflect the header-resident trigger introduced in Phase 3. Gates the Sky Atlas analysis report's largest single block of deferred decisions.

**Architecture:** All changes are frontend-only. The work splits into three independent buckets: (1) static `<head>` tag insertion + new public assets (no component logic), (2) two React component additions (`SurfaceTitleSync.tsx`, `craftedFromError` mapping in `App.tsx`), and (3) copy/comment updates across existing components. None of these change the visual redesign surfaces shipped in Phases 1–5. All voice strings are verbatim from `docs/design/01-spec/voice-and-content.md` — no deviation allowed.

**Tech Stack:** TypeScript, React 18, Vite 8, `@playwright/test`. New assets: SVG, PNG (designed externally). New dependencies: none.

**Architecture constraints:**
- The G1 PostHog read is Task 1 of this plan; its outcome may narrow the voice-rewrite scope. The plan is written for Position B (the spec's primary path). If G1 returns engaged-birder (≥4 engaged metrics), the scope of Task 8 (voice rewrites) reduces to `App.tsx:147` only — the other 14 strings are already on register and are preserved.
- Dynamic `<title>` uses React 18's first-class `<title>` rendering (no third-party head-management library). `<SurfaceTitleSync>` is a renderless component that renders `<title>` inside React's tree; Vite/React 18 hoists it to `<head>`.
- `craftedFromError` is a pure function (`(error: Error) => string`) colocated in `App.tsx` — it maps error class names and message substrings to friendly copy, with a safe fallback. Not a component.
- `manifest.json` sets `"display": "browser"` (not `"standalone"`) because PWA installability is not a v1 commitment.
- The `og:image` and `apple-touch-icon.png` and `favicon.svg` require external asset creation (documented in Tasks 4 and 5). The plan calls these out as designer handoff steps with concrete specs. The engineering task that inserts the `<link>` and `<meta>` tags is marked blocking on those assets; the rest of the plan can proceed independently.

---

## Spec reference

This plan implements Phase 6 of the Sky Atlas redesign. Authoritative specs:

- `docs/design/02-phases/phase-6-metadata-voice.md` — phase scope, dependencies, acceptance criteria
- `docs/design/01-spec/voice-and-content.md` — Position B voice, lede contract, freshness label, accent discipline, copy register inventory
- `docs/design/01-spec/open-questions.md` — G1 gate (audience profile), G2 gate (region precision)
- `docs/design/03-research/pre-ship-gates/G1-audience.md` — PostHog audit brief and decision rubric
- `docs/design/05-archive/analysis-funnel/phase-1/area-4-brand-voice-content-metadata.md` — 19 enumerated metadata gaps (original source)

Phase 6 requires Phases 1–5 merged and G1 + G2 closed (see Dependencies section).

## File structure

| File | Disposition | Responsibility |
|---|---|---|
| `frontend/index.html` | Modify | Add 19 missing `<head>` tags: description, OG, Twitter, canonical, theme-color, manifest, apple-touch-icon, favicon, JSON-LD, `[data-theme]` script verify |
| `frontend/public/manifest.json` | Create | PWA manifest (display: browser; name, icons, theme_color) |
| `frontend/public/favicon.svg` | Create (designed) | Brand mark — see Task 4 designer spec |
| `frontend/public/apple-touch-icon.png` | Create (designed) | 180×180 home-screen icon — see Task 4 designer spec |
| `frontend/public/og-image.png` | Create (designed) | 1200×630 Open Graph share image — see Task 5 designer spec |
| `frontend/src/components/SurfaceTitleSync.tsx` | Create | Renderless component emitting `<title>` per surface via React 18 |
| `frontend/src/components/SurfaceTitleSync.test.tsx` | Create | Vitest + RTL: asserts `document.title` per surface + species |
| `frontend/e2e/surface-title.spec.ts` | Create | Playwright e2e: navigates to map, feed, species, detail — asserts `<title>` text |
| `frontend/src/App.tsx` | Modify | Add `craftedFromError`; replace raw `error.message` rendering; mount `<SurfaceTitleSync>`; remove `<footer>` |
| `frontend/src/App.test.tsx` | Modify | Add test asserting `<StatusBlock>` renders for error; no raw error.message in DOM |
| `frontend/src/components/AttributionModal.tsx` | Modify | Update compliance comment (lines 4–16) to reflect Phase 3 header trigger |
| `frontend/e2e/axe.spec.ts` | Modify | Confirm no new axe violations from head additions or footer removal |

---

## Dependencies — gates that must close before this plan starts

| Gate | What closes it | Status |
|---|---|---|
| Phase 1 merged | `REGION_LABEL` constant in `frontend/src/config/region.ts` | Required before Tasks 9 and 8 |
| Phase 3 merged | `<AppHeader>` with `[Attribution]` button | Required before Task 10 |
| Phase 4 merged | Detail surface modal/sheet | Required before Task 7 (detail `<title>` test) |
| Phase 5 merged | `<FilterSentence>` mounted on map/feed/species | Required before Task 8 |
| G1 PostHog read | Task 1 of this plan | Required before Task 8 voice scope is confirmed |
| G2 region precision | Task 2 of this plan | Required before lede region claim + `og:description` ship |

---

## Task 1: G1 — PostHog audience-profile read

This is a 15-minute analytical step, not a code change. Its outcome gates the scope of Task 8.

**Files:** none modified. Output: updated `docs/design/01-spec/open-questions.md` G1 row.

- [ ] **Step 1: Open the PostHog dashboard for bird-maps.com production.**

PostHog is confirmed running at `frontend/src/analytics.ts`. Open the dashboard and read the 7 metrics specified in `docs/design/03-research/pre-ship-gates/G1-audience.md`:

| Metric | Engaged-birder signature | Casual-visitor signature |
|---|---|---|
| Bounce rate (first visit, < 30 s) | <30% | >50% |
| Mobile vs desktop split | mobile-heavy 60%+ | balanced or desktop-heavy |
| Return rate (30 d) | ≥40% (users with ≥3 sessions) | <15% |
| Median session duration | >3 min | <90 s |
| Filter usage (URL params) | >25% | <10% |
| Detail-view depth | >40% scroll-to-bottom | <15% |
| Repeat detail opens / session | ≥2 (from session recordings) | 0–1 |

- [ ] **Step 2: Apply the decision rubric.**

Count the number of metrics in the engaged column vs the casual column:

- ≥4 engaged → **Position A++ refinement**: metadata strings ship as written; Task 8 scope reduces to `App.tsx:147` only. Document this.
- ≥4 casual → **Position B as written**: Task 8 ships full voice-pass (error screen only, since the 14 other strings already match register per `voice-and-content.md`).
- Split (3-3 or unclear) → Position B; proceed as written.

- [ ] **Step 3: Update `docs/design/01-spec/open-questions.md`.**

In the G1 row of the status table, change `**Deferred**` to `**Closed YYYY-MM-DD: <signature>**` (use today's date and the signature determined in Step 2).

Also update the detailed section under `### G1` to record the metric values and the decision reached, following the protocol in the gate's own file.

- [ ] **Step 4: If engaged-birder, also update `docs/design/00-overview/decisions.md`.**

Row #3 (voice position) changes from "Position B" to "Position A++ refinement" per the gate brief's instructions.

**No commit for this task** — documentation-only updates are committed with Task 2.

---

## Task 2: G2 — Region precision check

Verify that `REGION_LABEL` ("Arizona") accurately describes actual coverage before lede + metadata strings ship.

**Files:** none modified unless G2 reveals inaccuracy (in which case `frontend/src/config/region.ts` is updated).

- [ ] **Step 1: Query coverage by county or ecoregion.**

The ingestor calls `/data/obs/US-AZ/recent` (confirmed in CLAUDE.md), which covers all of Arizona by design. Verify this is a genuine statewide pull rather than a de facto sub-region pull:

```bash
# Count observations per eBird region code in the DB (run from services/read-api or with a local DB connection)
# Expected: broad distribution across AZ counties (Maricopa, Pima, Cochise, Yavapai, etc.)
psql $DATABASE_URL -c "SELECT region_id, COUNT(*) FROM observations GROUP BY region_id ORDER BY COUNT(*) DESC LIMIT 20;"
```

If coverage is concentrated (<10% of records outside Maricopa + Pima counties), consult with the maintainer before using "Arizona" as the `REGION_LABEL`. If the distribution is genuinely statewide, `REGION_LABEL = 'Arizona'` stands.

- [ ] **Step 2: Update `docs/design/01-spec/open-questions.md` G2 row.**

Mark G2 as `**Closed YYYY-MM-DD: Arizona confirmed statewide**` (or the appropriate conclusion).

- [ ] **Step 3: Commit the G1 + G2 documentation updates.**

```bash
git add docs/design/01-spec/open-questions.md
# Add docs/design/00-overview/decisions.md if G1 was engaged-birder
git commit -m "$(cat <<'EOF'
docs(design): close gates G1 + G2 for Phase 6 voice + metadata

G1 PostHog read: [engaged-birder | casual-visitor | split] signature.
G2 region precision: Arizona confirmed statewide coverage.

Voice scope for Task 8: [full Position B | App.tsx:147 only].

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Static `<head>` metadata tags

Add the 13 static metadata tags (all except favicon/manifest/apple-touch-icon which depend on external assets from Tasks 4–5, and JSON-LD which has its own task). Also verify the `[data-theme]` inline blocking script from Phase 1 is present.

**Files:**
- Modify: `frontend/index.html`

All strings below are verbatim from `docs/design/01-spec/voice-and-content.md` (Position B register). Do not paraphrase.

- [ ] **Step 1: Verify `[data-theme]` inline blocking script from Phase 1 is present.**

Read `frontend/index.html`. Confirm a `<script>` tag that sets `document.documentElement.dataset.theme` is already present in `<head>`. If it is not (Phase 1 not yet merged), stop — this task blocks on Phase 1.

- [ ] **Step 2: Add the 13 static metadata tags.**

In `frontend/index.html`, replace the current `<head>` block:

```html
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>bird-watch — Arizona</title>
  </head>
```

with:

```html
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    <title>Bird Maps · Arizona</title>

    <!-- Description + canonical -->
    <meta name="description" content="Recent Arizona bird sightings, updated in real time from eBird." />
    <link rel="canonical" href="https://bird-maps.com/" />

    <!-- Open Graph -->
    <meta property="og:type" content="website" />
    <meta property="og:url" content="https://bird-maps.com/" />
    <meta property="og:title" content="Bird Maps · Arizona" />
    <meta property="og:description" content="Recent Arizona bird sightings, updated in real time from eBird." />
    <meta property="og:image" content="https://bird-maps.com/og-image.png" />

    <!-- Twitter card -->
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="Bird Maps · Arizona" />
    <meta name="twitter:description" content="Recent Arizona bird sightings, updated in real time from eBird." />
    <meta name="twitter:image" content="https://bird-maps.com/og-image.png" />

    <!-- Theme color (matches --color-surface-base light value from Phase 1 tokens) -->
    <meta name="theme-color" content="#f4f1ea" />

    <!-- Icons and manifest — assets created in Tasks 4–5; links added in Task 4 -->

    <!-- [data-theme] inline blocking script — added in Phase 1; verify present above this comment -->

    <!-- JSON-LD — added in Task 6 -->
  </head>
```

Notes on the above:
- `viewport-fit=cover` was deferred from G6 (iOS safe-area). Phase 6 is the correct landing spot since Phase 4 (bottom-sheet) is already merged. If Phase 4 already added this, the replacement will be a no-op for that attribute — check first.
- `og:image` and `twitter:image` reference `/og-image.png`, which is created in Task 5. The tags are inserted now so Task 5 has a clear target. Social crawlers won't resolve this until the asset is deployed, which is fine — the asset ships in the same PR.
- `#f4f1ea` is the map loading skeleton background color confirmed at `MapSurface.tsx:159`. Phase 1 canonicalizes it as `--color-surface-base`; this literal value is the correct light-theme theme-color.

- [ ] **Step 3: Run the build to confirm Vite accepts the changes.**

```bash
npm run build --workspace @bird-watch/frontend
```

Expected: build succeeds. The new meta tags appear verbatim in `frontend/dist/index.html`.

- [ ] **Step 4: Commit.**

```bash
git add frontend/index.html
git commit -m "$(cat <<'EOF'
feat(meta): add 13 static head tags — description, OG, Twitter, canonical, theme-color (Phase 6)

Closes 10 of the 19 metadata gaps identified in the analysis funnel:
gaps 1–11 (description, OG x5, Twitter x3, canonical, theme-color).
og:image and twitter:image reference /og-image.png (created Task 5).
viewport-fit=cover also added for iOS safe-area (G6 closure).

Spec: docs/design/01-spec/voice-and-content.md §Position B
Gap list: docs/design/05-archive/analysis-funnel/phase-1/area-4-brand-voice-content-metadata.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Favicon, apple-touch-icon, and manifest

This task has a designer handoff step. The engineering portion (inserting `<link>` tags + `manifest.json`) can be done now; the assets themselves require external creation.

### Designer handoff spec — favicon.svg

**File:** `frontend/public/favicon.svg`
**Dimensions:** 32×32 viewBox (scalable); will also display at 16×16 and 48×48.
**Content:** Simple bird silhouette (recommend a perched bird shape, single path) in the site's primary dark color: `#2c2a25` (light-mode text base). Background: transparent.
**Constraint:** Must be legible at 16×16 — no fine detail. Single color, no gradients.
**Format:** SVG with `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">`.

### Designer handoff spec — apple-touch-icon.png

**File:** `frontend/public/apple-touch-icon.png`
**Dimensions:** 180×180 pixels, 72 dpi.
**Content:** Same bird silhouette centered on `#f4f1ea` (surface base / background) — no transparency. iOS applies its own corner rounding; do not pre-round the image.
**Format:** PNG-24. Must pass iOS home-screen add flow (no alpha transparency).

### Engineering steps

- [ ] **Step 1 (designer prerequisite): Obtain `favicon.svg` and `apple-touch-icon.png` per the specs above.**

Place both at `frontend/public/favicon.svg` and `frontend/public/apple-touch-icon.png`. The `frontend/public/` directory must be created if it does not exist:

```bash
mkdir -p frontend/public
```

This step is non-engineering. Until the assets are ready, mark this task as blocked and continue with Tasks 5–10. The `<link>` tags in Step 2 can be committed before the assets exist (Vite will warn but not fail); the browser will simply 404 until the assets are deployed.

- [ ] **Step 2: Create `frontend/public/manifest.json`.**

```json
{
  "name": "Bird Maps Arizona",
  "short_name": "Bird Maps",
  "description": "Recent Arizona bird sightings, updated in real time from eBird.",
  "start_url": "/",
  "display": "browser",
  "background_color": "#f4f1ea",
  "theme_color": "#f4f1ea",
  "icons": [
    {
      "src": "/apple-touch-icon.png",
      "sizes": "180x180",
      "type": "image/png"
    }
  ]
}
```

Note: `"display": "browser"` is intentional. PWA installability is not a v1 commitment. The manifest ships now to close gap 12 (`<link rel="manifest">`) and satisfy the browser's PWA heuristics without making a standalone-mode promise.

- [ ] **Step 3: Add `<link>` tags to `frontend/index.html` within the `<head>` block, after the theme-color tag and before the JSON-LD comment.**

Insert:

```html
    <!-- Icons + manifest -->
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
    <link rel="manifest" href="/manifest.json" />
```

- [ ] **Step 4: Run the build and verify assets are copied.**

```bash
npm run build --workspace @bird-watch/frontend
ls frontend/dist/manifest.json
ls frontend/dist/favicon.svg 2>/dev/null || echo "favicon.svg not yet created — expected if designer step pending"
```

Vite copies everything in `frontend/public/` to `frontend/dist/` as-is. `manifest.json` should be present. `favicon.svg` and `apple-touch-icon.png` will be present only if the designer has delivered them.

- [ ] **Step 5: Commit manifest and link tags (assets may be committed separately when delivered).**

```bash
git add frontend/public/manifest.json frontend/index.html
# Add favicon.svg and apple-touch-icon.png if designer has delivered them
# git add frontend/public/favicon.svg frontend/public/apple-touch-icon.png
git commit -m "$(cat <<'EOF'
feat(meta): add manifest.json, favicon and apple-touch-icon links (Phase 6)

Closes gaps 12–14: <link rel="manifest">, <link rel="apple-touch-icon">,
<link rel="icon">. manifest.json uses display:browser (not standalone) —
PWA installability is not a v1 commitment.

favicon.svg and apple-touch-icon.png are designer-created assets; committed
separately on delivery if not yet available.

Spec: docs/design/02-phases/phase-6-metadata-voice.md
Gap list: docs/design/05-archive/analysis-funnel/phase-1/area-4-brand-voice-content-metadata.md gaps 12–14

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: OG share image

### Designer handoff spec — og-image.png

**File:** `frontend/public/og-image.png`
**Dimensions:** 1200×630 pixels. This is the canonical Open Graph image size; Twitter `summary_large_image` also uses it.
**Content:**
- Background: `#f4f1ea` (light surface base)
- Left or center area: the wordmark "Bird Maps" in a large serif or humanist sans (match the Phase 1 type tokens), "Arizona" in a subdued secondary style below.
- Right or corner area: a single large bird silhouette in `#2c2a25`.
- Bottom third: the Position B description in body type, muted: "Recent Arizona bird sightings, updated in real time from eBird."
- No screenshot of the app UI (screenshots go stale as the app evolves).
- No gradient backgrounds.
**Format:** PNG-24. Must be under 1 MB (ideally under 400 KB). Run through `pngquant` or similar if over limit.
**Testing:** Paste `https://bird-maps.com/og-image.png` into the Twitter Card Validator (`cards-dev.twitter.com/validator`) and the Facebook Sharing Debugger after deployment to confirm it renders.

### Engineering steps

- [ ] **Step 1 (designer prerequisite): Obtain `og-image.png` per the spec above.**

Place at `frontend/public/og-image.png`. Like Task 4, this step is non-engineering. Mark the task blocked until the asset is ready. The `<meta>` tags in Task 3 already reference this path; the social crawlers will 404 until it is deployed.

- [ ] **Step 2: Verify file size.**

```bash
ls -lh frontend/public/og-image.png
# Must be < 1 MB. If over, run: pngquant --quality=65-85 frontend/public/og-image.png
```

- [ ] **Step 3: Commit.**

```bash
git add frontend/public/og-image.png
git commit -m "$(cat <<'EOF'
feat(assets): add og-image.png 1200x630 (Phase 6)

Closes gap 4 (<meta og:image> asset delivery). Referenced in index.html
Tasks 3 and 5. Social unfurl now resolves to a real image on all
platforms (Slack, iMessage, Twitter/X, LinkedIn).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: JSON-LD structured-data markup

Add a `WebPage` + `Dataset` JSON-LD block to `<head>`. This enables Google Rich Results for the observation data and satisfies gap 19 (no structured data).

**Files:**
- Modify: `frontend/index.html`

The JSON-LD type choice: `Dataset` (from schema.org) is the semantically correct type for a collection of observation data sourced from eBird. We combine it with `WebPage` as the `mainEntity` so search engines understand both the page type and the data type.

- [ ] **Step 1: Add the JSON-LD block to `frontend/index.html`.**

In `frontend/index.html`, replace the `<!-- JSON-LD — added in Task 6 -->` comment with:

```html
    <!-- Structured data -->
    <script type="application/ld+json">
    {
      "@context": "https://schema.org",
      "@type": "WebPage",
      "name": "Bird Maps · Arizona",
      "description": "Recent Arizona bird sightings, updated in real time from eBird.",
      "url": "https://bird-maps.com/",
      "inLanguage": "en-US",
      "mainEntity": {
        "@type": "Dataset",
        "name": "Arizona Recent Bird Observations",
        "description": "Recent bird sightings across Arizona, sourced from eBird (Cornell Lab of Ornithology). Updated in real time.",
        "url": "https://bird-maps.com/",
        "license": "https://www.birds.cornell.edu/home/ebird-data-access-terms-of-use/",
        "creator": {
          "@type": "Organization",
          "name": "eBird",
          "url": "https://ebird.org"
        },
        "spatialCoverage": {
          "@type": "Place",
          "name": "Arizona, United States",
          "geo": {
            "@type": "GeoShape",
            "box": "31.332 -114.815 37.004 -109.045"
          }
        },
        "temporalCoverage": "P14D",
        "variableMeasured": "Bird species observations"
      }
    }
    </script>
```

Notes:
- `temporalCoverage: "P14D"` (ISO 8601 duration — last 14 days) matches the default `since=14d` filter. This is accurate for the default state.
- `geo.box` values are Arizona's approximate bounding box (south lat, west lng, north lat, east lng) in WGS84.
- `license` points to the eBird ToU (not a CC license — eBird data is used under API ToU, not an open license). This is correct.

- [ ] **Step 2: Run the build and verify the JSON-LD block is present in `frontend/dist/index.html`.**

```bash
npm run build --workspace @bird-watch/frontend
grep -c "application/ld+json" frontend/dist/index.html
# Expected: 1
```

- [ ] **Step 3: Validate via Google Rich Results Test (manual, post-deploy).**

After the PR is merged and deployed to bird-maps.com, navigate to `https://search.google.com/test/rich-results?url=https://bird-maps.com/` and confirm the tool parses the `Dataset` entity without errors. This is a post-deploy acceptance check, not a CI gate.

- [ ] **Step 4: Commit.**

```bash
git add frontend/index.html
git commit -m "$(cat <<'EOF'
feat(seo): add JSON-LD WebPage+Dataset structured data (Phase 6)

Adds schema.org Dataset markup describing the Arizona bird observation
data. Creator attributed to eBird; license references eBird ToU;
spatialCoverage covers the AZ bounding box; temporalCoverage P14D
matches the 14-day default filter.

Validates via Google Rich Results Test post-deploy.

Spec: docs/design/02-phases/phase-6-metadata-voice.md (acceptance criterion: JSON-LD validates)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Dynamic `<title>` per surface

Adds a renderless `<SurfaceTitleSync>` component that emits a React 18 `<title>` element whose text responds to `useUrlState`. This closes gap 18 (static `<title>`).

**Files:**
- Create: `frontend/src/components/SurfaceTitleSync.tsx`
- Create: `frontend/src/components/SurfaceTitleSync.test.tsx`
- Create: `frontend/e2e/surface-title.spec.ts`
- Modify: `frontend/src/App.tsx` (mount the component)

Title format per surface:

| Surface | `<title>` text |
|---|---|
| Map (default) | `Bird Maps · Arizona` |
| Feed | `Feed — Bird Maps · Arizona` |
| Species search | `Species — Bird Maps · Arizona` |
| Detail (species selected) | `{commonName} — Bird Maps · Arizona` |
| Detail (no species) | `Bird Maps · Arizona` |

`commonName` comes from the read API's species response. `<SurfaceTitleSync>` receives it as a prop.

### Failing tests first

- [ ] **Step 1: Write `frontend/src/components/SurfaceTitleSync.test.tsx` — all tests failing.**

```typescript
import { render } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { SurfaceTitleSync } from './SurfaceTitleSync';

// jsdom allows document.title reads
describe('SurfaceTitleSync', () => {
  beforeEach(() => {
    document.title = '';
  });

  it('sets title to "Bird Maps · Arizona" on map surface', () => {
    render(<SurfaceTitleSync view="map" speciesCommonName={null} />);
    expect(document.title).toBe('Bird Maps · Arizona');
  });

  it('sets title to "Feed — Bird Maps · Arizona" on feed surface', () => {
    render(<SurfaceTitleSync view="feed" speciesCommonName={null} />);
    expect(document.title).toBe('Feed — Bird Maps · Arizona');
  });

  it('sets title to "Species — Bird Maps · Arizona" on species surface', () => {
    render(<SurfaceTitleSync view="species" speciesCommonName={null} />);
    expect(document.title).toBe('Species — Bird Maps · Arizona');
  });

  it('sets title to "{commonName} — Bird Maps · Arizona" on detail surface with species', () => {
    render(<SurfaceTitleSync view="detail" speciesCommonName="Gila Woodpecker" />);
    expect(document.title).toBe('Gila Woodpecker — Bird Maps · Arizona');
  });

  it('falls back to "Bird Maps · Arizona" on detail surface with no species', () => {
    render(<SurfaceTitleSync view="detail" speciesCommonName={null} />);
    expect(document.title).toBe('Bird Maps · Arizona');
  });

  it('updates title when view changes', () => {
    const { rerender } = render(<SurfaceTitleSync view="map" speciesCommonName={null} />);
    expect(document.title).toBe('Bird Maps · Arizona');
    rerender(<SurfaceTitleSync view="feed" speciesCommonName={null} />);
    expect(document.title).toBe('Feed — Bird Maps · Arizona');
  });

  it('updates title when species changes on detail surface', () => {
    const { rerender } = render(
      <SurfaceTitleSync view="detail" speciesCommonName="Gila Woodpecker" />
    );
    expect(document.title).toBe('Gila Woodpecker — Bird Maps · Arizona');
    rerender(<SurfaceTitleSync view="detail" speciesCommonName="Vermilion Flycatcher" />);
    expect(document.title).toBe('Vermilion Flycatcher — Bird Maps · Arizona');
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails.**

```bash
npm run test --workspace @bird-watch/frontend -- SurfaceTitleSync.test.tsx
```

Expected: `Cannot find module './SurfaceTitleSync'` or all 7 tests fail.

- [ ] **Step 3: Create `frontend/src/components/SurfaceTitleSync.tsx`.**

```typescript
import type { UrlState } from '../state/url-state';

interface SurfaceTitleSyncProps {
  view: UrlState['view'];
  speciesCommonName: string | null;
}

const SITE_SUFFIX = 'Bird Maps · Arizona';

function buildTitle(view: UrlState['view'], speciesCommonName: string | null): string {
  switch (view) {
    case 'feed':
      return `Feed — ${SITE_SUFFIX}`;
    case 'species':
      return `Species — ${SITE_SUFFIX}`;
    case 'detail':
      return speciesCommonName ? `${speciesCommonName} — ${SITE_SUFFIX}` : SITE_SUFFIX;
    case 'map':
    default:
      return SITE_SUFFIX;
  }
}

/**
 * SurfaceTitleSync — renderless component that keeps <title> in sync with the
 * current surface and, on the detail surface, the selected species common name.
 *
 * Uses React 18 first-class <title> rendering (hoisted to <head> by React's
 * document metadata API). No third-party head-management library.
 *
 * Mounted once in App.tsx, just inside the top-level return. Receives view
 * from useUrlState() and speciesCommonName from the detail surface's loaded
 * species data (null when detail is loading or no species is selected).
 */
export function SurfaceTitleSync({ view, speciesCommonName }: SurfaceTitleSyncProps) {
  const title = buildTitle(view, speciesCommonName);
  return <title>{title}</title>;
}
```

- [ ] **Step 4: Run the test to confirm all 7 pass.**

```bash
npm run test --workspace @bird-watch/frontend -- SurfaceTitleSync.test.tsx
```

Expected: all 7 tests pass.

- [ ] **Step 5: Write the e2e spec `frontend/e2e/surface-title.spec.ts` — failing first.**

```typescript
import { test, expect } from '@playwright/test';
import { AppPage } from './pages/app.page';

test.describe('dynamic <title> per surface', () => {
  test('map surface shows "Bird Maps · Arizona"', async ({ page }) => {
    const app = new AppPage(page);
    await page.goto('/');
    await app.waitForMapLoad();
    await expect(page).toHaveTitle('Bird Maps · Arizona');
  });

  test('feed surface shows "Feed — Bird Maps · Arizona"', async ({ page }) => {
    await page.goto('/?view=feed');
    await expect(page).toHaveTitle('Feed — Bird Maps · Arizona');
  });

  test('species surface shows "Species — Bird Maps · Arizona"', async ({ page }) => {
    await page.goto('/?view=species');
    await expect(page).toHaveTitle('Species — Bird Maps · Arizona');
  });

  test('detail surface with loaded species shows species name in title', async ({ page }) => {
    // Navigate to a detail view for a species that exists in the seeded DB
    // The speciesCode 'gila1' (Gila Woodpecker) must exist in the test DB.
    // If the seed data uses a different code, update this constant.
    await page.goto('/?view=detail&detail=gilwoo');
    // Wait for the species panel to load
    await page.waitForSelector('[data-testid="species-detail-loaded"]', { timeout: 10000 });
    await expect(page).toHaveTitle(/Gila Woodpecker — Bird Maps · Arizona/);
  });

  test('title updates when navigating between surfaces', async ({ page }) => {
    await page.goto('/?view=feed');
    await expect(page).toHaveTitle('Feed — Bird Maps · Arizona');
    // Navigate to species via SurfaceNav
    await page.getByRole('tab', { name: 'Species view' }).click();
    await expect(page).toHaveTitle('Species — Bird Maps · Arizona');
  });
});
```

- [ ] **Step 6: Mount `<SurfaceTitleSync>` in `frontend/src/App.tsx`.**

Read the existing `return (...)` block in `App.tsx`. Add the import and component mount:

In the imports section, add:
```typescript
import { SurfaceTitleSync } from './components/SurfaceTitleSync';
```

Inside the top-level return, as the first child of the outer wrapper element (before any surface logic), add:
```tsx
<SurfaceTitleSync
  view={state.view}
  speciesCommonName={detailSpeciesCommonName ?? null}
/>
```

Where `detailSpeciesCommonName` is the common name from the loaded species detail (it is already available in App.tsx's data flow if the detail surface passes it up, or can be derived from the read API response cached in state). If this value is not yet threaded through App.tsx (it may not be — Phase 4's detail surface may manage it locally), wire it: add a `useState<string | null>(null)` in App.tsx and pass a setter callback into the detail surface component to report the loaded species name. The setter is called when species data loads; it resets to null on surface change.

- [ ] **Step 7: Run the full unit test suite to confirm no regressions.**

```bash
npm run test --workspace @bird-watch/frontend
```

- [ ] **Step 8: Commit.**

```bash
git add frontend/src/components/SurfaceTitleSync.tsx \
        frontend/src/components/SurfaceTitleSync.test.tsx \
        frontend/e2e/surface-title.spec.ts \
        frontend/src/App.tsx
git commit -m "$(cat <<'EOF'
feat(meta): dynamic <title> per surface via SurfaceTitleSync (Phase 6)

Adds SurfaceTitleSync renderless component using React 18 <title>
rendering. Title updates on surface change and on species load in detail
view. Closes metadata gap 18 (static <title>).

Format: "{species} — Bird Maps · Arizona" on detail; surface name on
feed/species; "Bird Maps · Arizona" on map and default.

7 unit tests + 5 e2e assertions covering all surfaces and navigation.

Spec: docs/design/02-phases/phase-6-metadata-voice.md
Acceptance: "Gila Woodpecker — Bird Maps Arizona" in tab on detail view

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Voice rewrite — error screen

Replace the raw `error.message` rendering in `App.tsx` with crafted copy via `<StatusBlock>`. This closes gap 19 (raw error message in production UI) and is the sole copy change required regardless of G1 outcome.

**Scope note:** Per `docs/design/01-spec/voice-and-content.md` copy register inventory, all 14 other visible strings already match the Position B register ("preserve" disposition). This task therefore applies only to `App.tsx:146–148`. If G1 returned engaged-birder, this is the entirety of Task 8. If G1 returned casual-visitor or split, the same: the 14 preserved strings need no rewrite.

**Files:**
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/App.test.tsx`

### Failing test first

- [ ] **Step 1: Add failing tests to `frontend/src/App.test.tsx`.**

Read the existing App.test.tsx to understand the test setup (how errors are simulated — likely by mocking the read API hook). Then add:

```typescript
describe('App error screen', () => {
  it('renders <StatusBlock> with crafted copy, not raw error.message', async () => {
    // Arrange: force the read-api hook to throw a network-style error
    // The exact mock setup depends on how App.test.tsx is already organized;
    // follow the existing pattern for injecting errors into useObservations or
    // equivalent hook.
    mockApiError(new Error('Failed to fetch: net::ERR_CONNECTION_REFUSED'));

    render(<App />);

    // StatusBlock must be present
    expect(await screen.findByRole('status')).toBeInTheDocument();
    // Crafted title must be present
    expect(screen.getByText("Couldn't load bird data")).toBeInTheDocument();
    // Raw error.message must NOT appear
    expect(screen.queryByText(/net::ERR_CONNECTION_REFUSED/)).toBeNull();
    expect(screen.queryByText(/Failed to fetch/)).toBeNull();
  });

  it('renders a friendly body for a timeout error', async () => {
    mockApiError(new Error('AbortError: signal timed out'));
    render(<App />);
    expect(await screen.findByText(/try refreshing/i)).toBeInTheDocument();
  });

  it('renders a generic friendly body for an unknown error', async () => {
    mockApiError(new Error('some internal error code XYZ-42'));
    render(<App />);
    // Generic fallback must NOT expose the raw message
    expect(await screen.findByRole('status')).toBeInTheDocument();
    expect(screen.queryByText(/XYZ-42/)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail.**

```bash
npm run test --workspace @bird-watch/frontend -- App.test.tsx
```

Expected: the three new tests fail. The existing test may show `net::ERR_CONNECTION_REFUSED` in the DOM.

- [ ] **Step 3: Add `craftedFromError` to `frontend/src/App.tsx`.**

Add this pure function above the `App` component definition:

```typescript
/**
 * Maps an Error to a user-facing body string for the top-level error screen.
 * The title is always "Couldn't load bird data" (unchanged from existing copy).
 * The body replaces the raw error.message with a crafted string that matches
 * the Position B voice register (declarative, no apology language, no
 * exclamation marks).
 *
 * New error classes should be added here with a dated comment.
 * Voice spec: docs/design/01-spec/voice-and-content.md §Copy register inventory
 */
function craftedFromError(error: Error): string {
  const msg = error.message.toLowerCase();

  // Network failure (fetch failed, no connection)
  if (msg.includes('failed to fetch') || msg.includes('networkerror') || msg.includes('err_connection')) {
    return 'The server could not be reached. Check your connection and try refreshing.';
  }

  // Request timeout / abort
  if (msg.includes('aborterror') || msg.includes('timed out') || msg.includes('timeout')) {
    return 'The request took too long. Try refreshing.';
  }

  // HTTP 5xx (server error passed through as a thrown Error)
  if (msg.includes('500') || msg.includes('502') || msg.includes('503') || msg.includes('504')) {
    return 'The data service is temporarily unavailable. Try again in a moment.';
  }

  // Safe fallback — never expose the raw message
  return 'Something went wrong loading the bird data. Try refreshing.';
}
```

- [ ] **Step 4: Replace the raw `error.message` rendering in `App.tsx:143–150`.**

Replace:

```tsx
  if (error) {
    return (
      <div className="error-screen">
        <h2>Couldn't load bird data</h2>
        <p>{error.message}</p>
      </div>
    );
  }
```

with:

```tsx
  if (error) {
    return (
      <StatusBlock
        state="error"
        title="Couldn't load bird data"
        body={craftedFromError(error)}
      />
    );
  }
```

Note: `<StatusBlock>` is a Phase 2 primitive. It must be imported if not already:
```typescript
import { StatusBlock } from './components/StatusBlock';
```

`<StatusBlock state="error">` renders with `role="status"` per the Phase 2 primitive spec, which makes the test's `findByRole('status')` assertion work.

- [ ] **Step 5: Run the tests to confirm they pass.**

```bash
npm run test --workspace @bird-watch/frontend -- App.test.tsx
```

Expected: all three new tests pass. All existing App tests continue passing.

- [ ] **Step 6: Run the full frontend test suite.**

```bash
npm run test --workspace @bird-watch/frontend
```

- [ ] **Step 7: Commit.**

```bash
git add frontend/src/App.tsx frontend/src/App.test.tsx
git commit -m "$(cat <<'EOF'
fix(voice): replace raw error.message with crafted copy in App.tsx (Phase 6)

Closes gap 19: App.tsx:147 previously rendered the raw Error.message in
production UI. craftedFromError() maps error class (network, timeout,
5xx, unknown) to position-B copy — declarative, no apology language.

<StatusBlock state="error"> wraps the output; role="status" is present
so SR users hear the announcement. Raw error strings are never exposed.

3 new unit tests cover network, timeout, and unknown error classes.

Spec: docs/design/01-spec/voice-and-content.md §Copy register inventory
Gap: docs/design/05-archive/analysis-funnel/phase-1/area-4-brand-voice-content-metadata.md gap 19

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Wordmark `aria-label` + `REGION_LABEL` wiring

Adds the brand name as a visible rendered string in `<AppHeader>` and wires the `<span class="brand-region">` to `REGION_LABEL` from Phase 1's config. Closes gap 15 (no rendered brand name).

**Files:**
- Modify: `frontend/src/components/AppHeader.tsx` (Phase 3 component)

This task blocks on Phase 1 (`REGION_LABEL` in `frontend/src/config/region.ts`) and Phase 3 (`<AppHeader>` exists).

- [ ] **Step 1: Read `frontend/src/components/AppHeader.tsx` to locate the wordmark element.**

The Phase 3 `<AppHeader>` already renders the logo/wordmark area. Find the element that is or should become the home link. It may currently be a plain `<div>` or `<span>` with the brand name.

- [ ] **Step 2: Update the wordmark element to the full accessible pattern.**

Replace whatever the current wordmark element is with:

```tsx
import { REGION_LABEL } from '../config/region';

// Inside the AppHeader return:
<a href="/" aria-label={`Bird Maps ${REGION_LABEL} — home`} className="wordmark">
  Bird Maps<span className="brand-region"> {REGION_LABEL}</span>
</a>
```

Notes:
- The `aria-label` overrides the link's text content for screen readers, producing the full "Bird Maps Arizona — home" announcement. Sighted users see "Bird Maps Arizona" in two typographic weights or sizes (the `brand-region` class controls this via Phase 1 tokens).
- `href="/"` navigates to the home/map surface. On a single-page app with `pushState`, this is a hard navigation; if Phase 0's `useUrlState` handles it gracefully (it should, since `/` maps to `DEFAULTS.view = 'map'`), no additional handling is needed.
- If `AppHeader.tsx` already imports `REGION_LABEL` (Phase 1 may have added it), remove the duplicate import.

- [ ] **Step 3: Verify the pattern renders correctly in the build.**

```bash
npm run build --workspace @bird-watch/frontend
```

Expected: build succeeds. The `REGION_LABEL` import resolves from `frontend/src/config/region.ts`.

- [ ] **Step 4: Commit.**

```bash
git add frontend/src/components/AppHeader.tsx
git commit -m "$(cat <<'EOF'
feat(brand): wire wordmark aria-label and REGION_LABEL in AppHeader (Phase 6)

Closes gap 15: "Bird Maps" + region name now rendered as visible text in
<AppHeader> — not just the <title> tag. Wordmark is an accessible home
link with aria-label "Bird Maps Arizona — home". brand-region span
consumes REGION_LABEL from Phase 1 config so region name is a single
source of truth.

Spec: docs/design/02-phases/phase-6-metadata-voice.md
Gap: docs/design/05-archive/analysis-funnel/phase-1/area-4-brand-voice-content-metadata.md gap 15

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Footer removal + `AttributionModal.tsx` comment update

Remove the `<footer role="contentinfo">` from `App.tsx` (the Attribution trigger moved to `<AppHeader>` in Phase 3). Update `AttributionModal.tsx` lines 4–16 to reflect the new trigger location.

**Files:**
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/components/AttributionModal.tsx`

This task blocks on Phase 3 (`<AppHeader>` with `[Attribution]` button merged).

- [ ] **Step 1: Confirm `<AppHeader>` renders the Attribution trigger on every surface.**

Read `frontend/src/components/AppHeader.tsx`. Confirm that the `[Attribution]` / `[Credits]` button is present and wired to open `<AttributionModal>`. If Phase 3 left this incomplete, do not remove the footer until the header trigger is functional — removing the footer without the header trigger would break the compliance requirement (eBird ToU §3, CC BY-SA §4(b/c) require the attribution surface to be reachable from every surface).

- [ ] **Step 2: Remove `<footer role="contentinfo">` from `frontend/src/App.tsx`.**

Read the current `App.tsx` footer block (it will be near the bottom of the main return, after the surface-rendering logic). Remove the entire `<footer role="contentinfo">...</footer>` block including its contents. Do not remove the `<AttributionModal>` component itself — it is mounted elsewhere in the tree (likely controlled by `<AppHeader>`'s state).

If `App.tsx` is the owner of the `isAttributionOpen` state that `<AttributionModal>` reads, verify that the state and the `<AttributionModal>` mount are NOT inside the footer — they should be at the top level of the return, not inside `<footer>`. If they are currently inside `<footer>`, move them out before removing the footer element.

- [ ] **Step 3: Update `AttributionModal.tsx` compliance comment.**

In `frontend/src/components/AttributionModal.tsx:4–16`, the current comment states:

> The trigger lives in App.tsx's persistent `<footer role="contentinfo">` so the prominence requirement is met on every view (`view=map|feed|species|detail`) without abusing SurfaceNav's `role="tablist"` semantics.

Replace lines 14–17 with:

```
 *   - The trigger lives in <AppHeader> (Phase 3) as a persistent header button
 *     so the prominence requirement is met on every view (view=map|feed|species|
 *     detail) without abusing SurfaceNav's role="tablist" semantics. The footer
 *     was removed in Phase 6.
```

The surrounding compliance citations (eBird ToU §3, CC BY 3.0 §4(b/c), ODbL §4.3) are accurate and must be preserved exactly.

- [ ] **Step 4: Run the full unit test suite.**

```bash
npm run test --workspace @bird-watch/frontend
```

If any test asserted on `<footer role="contentinfo">`, update that test to assert on the new header location.

- [ ] **Step 5: Run the e2e axe suite.**

```bash
npm run test:e2e --workspace @bird-watch/frontend -- axe.spec.ts
```

The footer removal should not introduce new axe violations. If the `<footer>` carried `role="contentinfo"` (it did — confirmed in analysis), removing it means there is no `contentinfo` landmark. `<AppHeader>` should carry `role="banner"`. Confirm `axe.spec.ts` passes with these two roles present (`banner` + `main`); `contentinfo` is optional.

- [ ] **Step 6: Commit.**

```bash
git add frontend/src/App.tsx frontend/src/components/AttributionModal.tsx
git commit -m "$(cat <<'EOF'
feat(layout): remove footer; update AttributionModal compliance comment (Phase 6)

Footer removal: <AppHeader> (Phase 3) carries the [Attribution] trigger
on every surface, meeting the eBird ToU §3 and CC BY-SA §4(b/c)
prominence requirement. Footer is redundant and adds visual noise on
desktop.

AttributionModal comment updated to reflect Phase 3 trigger location.
Compliance citations preserved verbatim.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Full validation suite

Before opening the PR, run the full local validation gate — same checks Mergify requires (`test`, `lint`, `build`, `e2e`). Also run the manual social-share verification steps that CI cannot cover.

**Files:** none modified.

- [ ] **Step 1: Run the full unit test suite from repo root.**

```bash
npm test
```

Expected: all tests pass across all workspaces.

- [ ] **Step 2: Run the lint suite.**

```bash
npm run lint
```

Expected: no errors. If any new ESLint rule fires (e.g., `react-hooks/exhaustive-deps` on `craftedFromError`), fix in place — do not silence with `eslint-disable`.

- [ ] **Step 3: Run the frontend build.**

```bash
npm run build --workspace @bird-watch/frontend
```

Expected: build succeeds. Spot-check `frontend/dist/index.html` for all 13 meta tags, the `<link>` tags, and the JSON-LD block.

```bash
grep -c "og:title" frontend/dist/index.html        # expect 1
grep -c "twitter:card" frontend/dist/index.html    # expect 1
grep -c "application/ld+json" frontend/dist/index.html # expect 1
grep -c "manifest.json" frontend/dist/index.html   # expect 1
ls frontend/dist/manifest.json                     # expect file present
```

- [ ] **Step 4: Run the e2e suite.**

```bash
npm run test:e2e --workspace @bird-watch/frontend
```

Expected: all Playwright specs pass, including the new `surface-title.spec.ts`. Of particular interest:
- `axe.spec.ts` — no new axe violations from head additions, footer removal, or wordmark changes.
- `surface-title.spec.ts` — all 5 title assertions pass.

- [ ] **Step 5: Manual social-share verification (post-deploy, not a CI gate).**

After the PR merges and deploys to bird-maps.com, verify each unfurl channel:

- **Slack:** Paste `https://bird-maps.com/` into any channel. Confirm the unfurl card shows: OG image (1200×630), title "Bird Maps · Arizona", description "Recent Arizona bird sightings, updated in real time from eBird." If OG image does not load, wait 60 seconds and try again (Slack caches aggressively; use the "Refresh" option in the link preview).
- **iMessage:** Send `https://bird-maps.com/` in a message to yourself. Confirm the rich preview renders with the OG image and title.
- **Twitter/X:** Post `https://bird-maps.com/` (or use `cards-dev.twitter.com/validator`). Confirm `summary_large_image` card renders.
- **Google Rich Results Test:** `https://search.google.com/test/rich-results?url=https://bird-maps.com/` — confirm `Dataset` entity parses without errors.

Record results in the PR's Screenshots section.

---

## Task 12: Open the PR

Use the PR workflow per `.claude/skills/pr-workflow/SKILL.md`.

**Files:** none modified.

- [ ] **Step 1: Push the branch.**

```bash
git push -u origin feat/sky-atlas-phase-6-metadata-voice
```

- [ ] **Step 2: Open the PR using the project template.**

```bash
gh pr create --title "feat: Sky Atlas Phase 6 — metadata, structured data, brand voice" --body "$(cat <<'EOF'
## Summary
- Closes all 19 metadata gaps from the analysis funnel: adds `<meta name="description">`, Open Graph (5 tags), Twitter card (3 tags), `<link rel="canonical">`, `<meta name="theme-color">`, `<link rel="manifest">`, `<link rel="apple-touch-icon">`, `<link rel="icon">`, JSON-LD `Dataset` + `WebPage` markup, and dynamic `<title>` per surface.
- Replaces raw `error.message` rendering (`App.tsx:147`) with `<StatusBlock state="error">` and crafted Position B copy via `craftedFromError()`.
- Adds `<SurfaceTitleSync>` renderless component for surface-aware `<title>` (React 18 `<title>` rendering).
- Wires wordmark `aria-label` and `<span class="brand-region">` to `REGION_LABEL` from Phase 1 config.
- Removes persistent `<footer role="contentinfo">`; `[Attribution]` trigger already in `<AppHeader>` (Phase 3).
- Updates `AttributionModal.tsx` compliance comment to reflect header trigger location.
- New public assets: `manifest.json`, `favicon.svg`, `apple-touch-icon.png` (180×180), `og-image.png` (1200×630).
- Gates G1 (PostHog audience read) and G2 (region precision) closed before this PR opens.

## Test plan
- [ ] `npm test` — all workspaces pass
- [ ] `npm run lint` — no errors
- [ ] `npm run build` — succeeds; spot-check dist for all 13 meta tags + JSON-LD + manifest
- [ ] `npm run test:e2e` — all specs pass including new `surface-title.spec.ts` (5 assertions) and `axe.spec.ts` (no new violations)
- [ ] 7 unit tests for `SurfaceTitleSync` cover all 5 surfaces + update behavior
- [ ] 3 unit tests for App error screen confirm no raw error.message in DOM
- [ ] Post-deploy: Slack + iMessage + Twitter unfurl verified with OG image
- [ ] Post-deploy: Google Rich Results Test validates `Dataset` entity

## Screenshots
[To be added post-deploy: Slack unfurl, iMessage preview, Twitter card, Google Rich Results screenshot]

## Spec
docs/design/02-phases/phase-6-metadata-voice.md
docs/design/01-spec/voice-and-content.md

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Dispatch the bot review.**

Per project CLAUDE.md PR workflow rules, dispatch through the `julianken-bot` Agent subagent.

- [ ] **Step 4: After bot approval and CI green, post the Mergify queue comment.**

```bash
gh pr comment <PR-number> --body "@Mergifyio queue"
```

Never use `gh pr merge` directly.

---

## Acceptance criteria

This plan is complete when ALL of the following are true (verifiable against `docs/design/02-phases/phase-6-metadata-voice.md` acceptance criteria):

- [ ] Social unfurl on Slack, Twitter/X, and iMessage shows the OG image (1200×630), title "Bird Maps · Arizona", and description "Recent Arizona bird sightings, updated in real time from eBird."
- [ ] `<title>` is dynamic per surface. Viewing a Gila Woodpecker detail shows "Gila Woodpecker — Bird Maps · Arizona" in the browser tab.
- [ ] `App.tsx:147` no longer renders raw `error.message`. The error screen uses `<StatusBlock state="error">` with crafted copy from `craftedFromError()`.
- [ ] `<footer role="contentinfo">` is removed from `App.tsx`. The `[Attribution]` button is visible in the header on every surface.
- [ ] All loading, empty, and error strings match the Position B voice register (declarative-direct, no exclamation marks, no apology language). The 14 strings marked "preserve" are unchanged.
- [ ] JSON-LD `Dataset` markup validates via Google Rich Results Test with no errors.
- [ ] Existing axe coverage continues to pass. No new axe violations from head additions, footer removal, or wordmark changes.
- [ ] Gates G1 and G2 are documented as closed in `docs/design/01-spec/open-questions.md`.
- [ ] All 19 gaps from the analysis funnel are closed. Cross-reference: `docs/design/05-archive/analysis-funnel/phase-1/area-4-brand-voice-content-metadata.md`.

---

## What this plan deliberately does NOT include

To stay scoped per the phase boundaries:

- **No surface visual changes.** Phases 3–5 shipped the map, feed, species, and detail redesigns. Phase 6 adds metadata and copy; it does not move layout elements except the footer removal (which is a direct consequence of Phase 3's header migration, documented and anticipated).
- **No component primitive changes.** Phase 2 shipped `<StatusBlock>`, `<Photo>`, `<ClusterPill>`, `<FilterSentence>`, `<FamilySilhouette>`. Phase 6 uses them; it does not modify them.
- **No new product features.** The lede contract (4 lede templates), freshness label state machine, and filter sentence template ship in Phase 5 (`<FilterSentence>` mounted). Phase 6's "voice pass" confirms those strings are on register and adds only the metadata + error-screen copy described here.
- **No dark-mode meta tags.** G8 (dark basemap) is deferred to v1.1. Phase 6 ships `theme-color` for light mode only. Do not add `prefers-color-scheme` variants to `theme-color` or `og:image` until G8 is resolved.
- **No About or onboarding surface.** Gap 17 (no About surface) is acknowledged in the analysis but is out of v1 scope. The lede in Phase 5 provides first-visit orientation; a dedicated About route is a v1.1 feature.
- **No PWA standalone mode.** `manifest.json` ships with `display: browser`. PWA installability is a v1.1 commitment conditional on UX validation.
- **No per-surface OG tags.** The `og:url`, `og:title`, and `og:description` are static (pointing to `https://bird-maps.com/`). Dynamic OG tags per species detail would require server-side rendering or a dynamic OG image service — out of v1 scope. The static tags are accurate for the canonical URL.
