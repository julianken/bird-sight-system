# 04 Visuals

Static visual references for the redesign. PNG mockups, system poster, before/after deltas. These live alongside the spec because they're cited from `01-spec/` and `02-phases/`.

## Files

| File | Dimensions | What it shows | When to look |
|---|---|---|---|
| `system-poster.png` | 1440×~900 | Full token system (palette, type, components, photo, motion) — light + dark side by side | Onboarding to the system; checking a token's intended use |
| `map-desktop-pair.png` | 1440×700 | Map surface, light + dark | Phase 3 acceptance check; spec architecture reference |
| `detail-desktop-pair.png` | 1440×700 | Species detail modal, light + dark | Phase 4 acceptance check |
| `feed-desktop.png` | 1440×700 | Feed view with newspaper lede + top-notable card-row | Phase 5 acceptance check |
| `mobile-triplet.png` | 1440×820 | Mobile patterns: map (bottom-tab), detail bottom-sheet at half snap, system skeleton loading | Phase 4 + Phase 5 mobile acceptance |
| `v3-full.png` | 1425×3338 | Full v3 mock page (all surfaces, all modes) — primary visual reference | Anytime; the canonical mockup snapshot |
| `v4-full.png` | 1425×~1500 | v3→v4 critique-loop deltas (3 visual changes) | Reviewing the critique-loop output |

## Key visuals (referenced from spec)

### Full mock page — `v3-full.png`

The canonical Sky Atlas mock. All four surfaces (map, detail, feed, mobile triplet) at desktop + mobile, in both light + dark modes, on one page. ~1425×3338. Use when reviewing PRs that touch any surface — provides the visual contract.

### System poster — `system-poster.png`

Token poster: palette (8 tokens per mode), type ramp, component examples (primary/secondary buttons, filter chips, card row), photo treatment, motion tokens. Both modes side by side. Use when implementing or extending the token system.

### v3→v4 critique-loop deltas — `v4-full.png`

Three before/after pairs from the critique loops:

1. Mobile bottom-tab: 4 tabs → 3 tabs + header [Attribution] link
2. Popover CTA: accent → text-body underline
3. Zero-filter mobile state: chip strip hidden, badge omitted

These are the only mock-visible changes from the loops; the other 16 fixes are spec contracts only.

## Origin

These mockups were generated during the brainstorm session with the Superpowers brainstorming skill (visual companion). Originals are in `../05-archive/brainstorm-mocks/` as standalone HTML files — use those if you need to inspect the actual CSS or modify the mock directly.

## Update protocol

When a surface visual changes meaningfully (e.g., Phase 3 ships and the map surface looks different from the v3 mock):

1. Re-capture the screenshot from the implemented surface (Playwright or browser dev tools)
2. Replace the corresponding file here
3. Add a dated note in this README under "Replacements" listing what changed and why

Don't replace the v3-full or v4-full files — those are time-snapshots. Each new major design iteration creates its own dated mock + capture.

## Cross-references from spec

- [`../00-overview/visual-direction.md`](../00-overview/visual-direction.md) cites `system-poster.png`, `map-desktop-pair.png`, `detail-desktop-pair.png`, `feed-desktop.png`, `mobile-triplet.png`
- [`../02-phases/phase-3-map-surface.md`](../02-phases/phase-3-map-surface.md) cites `map-desktop-pair.png`, `mobile-triplet.png`
- [`../02-phases/phase-4-detail-surface.md`](../02-phases/phase-4-detail-surface.md) cites `detail-desktop-pair.png`, `mobile-triplet.png`
- [`../02-phases/phase-5-feed-species.md`](../02-phases/phase-5-feed-species.md) cites `feed-desktop.png`
- [`../03-research/critique-loops-summary.md`](../03-research/critique-loops-summary.md) cites `v4-full.png`
