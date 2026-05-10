# Phase 6 — Metadata + brand voice

**Status:** Not yet planned. Gates G1 (audience profile) close before this phase begins.

**Plan:** to be written via `superpowers:writing-plans` — output to `docs/plans/2026-XX-XX-sky-atlas-phase-6-metadata-voice.md`.

## Goal

Close the 19 metadata gaps; rewrite voice strings in Position B register; add structured-data markup; finalize the wordmark. Gates the analysis funnel report's largest single block of deferred decisions.

## What ships

| Change | File |
|---|---|
| `<meta name="description">`, OG tags, Twitter card, theme-color, canonical | `frontend/index.html` |
| Favicon + apple-touch-icon + manifest.json | `frontend/public/favicon.svg`, `apple-touch-icon.png`, `manifest.json` (new) |
| OG share image (1200×630 PNG) | `frontend/public/og-image.png` (new — designed asset) |
| JSON-LD `Dataset` or `WebPage` markup | `frontend/index.html` `<script type="application/ld+json">` |
| Dynamic `<title>` per surface (e.g., "Vermilion Flycatcher — Bird Maps Arizona") | `frontend/src/components/SurfaceTitleSync.tsx` (new) or via React 18 `<title>` rendering |
| Voice rewrites for Position B (or Position A++ if G1 returns engaged-birder) | All surfaces; primary updates in `App.tsx` error screen + lede strings |
| Wordmark `<a href="/" aria-label="Bird Maps Arizona — home">` with separated `<span class="brand-region">` consuming `REGION_LABEL` from config | `<AppHeader>` or `App.tsx` |
| Footer removal — `<AttributionModal>` trigger moves to header completely | `App.tsx`, `AttributionModal.tsx` comment update |

## Dependencies

- **Requires G1** (audience profile) closure before voice strings ship. Resolution path:
  - G1 returns engaged-birder → Position A++ refinement (fill metadata with neutral factual claims; in-app voice unchanged)
  - G1 returns casual-visitor → Position B as written
  - G1 returns split → Position B; reconsider only if onboarding analytics post-ship show casual confusion
- **Requires G2** (region precision) closure before lede region claim ships.
- **Requires Phase 1** (`REGION_LABEL` config) — wordmark + lede source from same constant.
- **Requires Phases 3, 4, 5** (all surfaces ship) — voice work is meaningful only when the surfaces it speaks for exist.

## Acceptance criteria

- Social unfurl on Slack / Twitter / iMessage shows OG image + description + title — verified by sharing the production URL in each platform.
- `<title>` is dynamic per surface; viewing Gila Woodpecker detail shows "Gila Woodpecker — Bird Maps Arizona" in the browser tab.
- `App.tsx:147` no longer renders raw `error.message` — `<StatusBlock state="error">` with crafted copy.
- Footer removed from desktop; header `[Attribution]` button visible on every surface.
- All loading / empty / error strings match voice register (calm, declarative-direct, no exclamation marks).
- JSON-LD validates via Google Rich Results Test.
- Existing axe coverage continues to pass; no new axe violations introduced by metadata or voice changes.

## What this phase does NOT include

- Surface visual changes (Phases 3–5 already shipped)
- Component primitive changes (Phase 2 already shipped)
- New product features (out of v1 scope)

## Implementation order (within phase)

1. G1 PostHog read — confirms voice direction (Position A++ vs B)
2. G2 region precision check — confirms `REGION_LABEL` accuracy
3. Metadata `<head>` strings (description, OG, Twitter, canonical, theme-color)
4. Favicon + apple-touch-icon + manifest assets
5. OG share image — designed asset
6. JSON-LD markup
7. Dynamic `<title>` per surface
8. Voice rewrites: error screen, lede templates, freshness label state copy, filter sentence template
9. Wordmark `aria-label` + region-config wiring
10. Footer removal; `AttributionModal` location-comment update

## Cross-references

- Spec: [`../01-spec/voice-and-content.md`](../01-spec/voice-and-content.md), [`../01-spec/open-questions.md`](../01-spec/open-questions.md)
- G1 brief: [`../03-research/pre-ship-gates/G1-audience.md`](../03-research/pre-ship-gates/G1-audience.md)
- Analysis report finding: 19 metadata gaps enumerated in `../03-research/analysis-funnel-summary.md` (and original full enumeration in `../05-archive/analysis-funnel/phase-1/area-4-brand-voice-content-metadata.md`)
