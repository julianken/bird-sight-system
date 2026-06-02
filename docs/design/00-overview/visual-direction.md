# Visual direction — Sky Atlas

The redesign's chosen visual identity. One page. For palette/type/component detail see [`../01-spec/tokens.md`](../01-spec/tokens.md) and [`../01-spec/components.md`](../01-spec/components.md). For visual reference see [`../04-visuals/`](../04-visuals/).

## Identity in one sentence

Editorial, photo-led, atmospheric. The mode metaphor is sky at different times of day — light is "Day" (cream + sunrise orange), dark is "Night" (deep navy + moon cyan). A single dramatic accent appears only at decision points; the rest of the chrome stays restrained.

## Palette

| Role | Light "Day" | Dark "Night" |
|---|---|---|
| Background page | `#fafaf6` (warm cream) | `#0d1424` (deep navy) |
| Background surface | `#ffffff` | `#131c30` |
| Background tint | `#f0ece4` | `#1c2640` |
| Text strong | `#1a1a1a` | `#f5f7fb` |
| Text muted | `#5a5a5a` | `#8a98ad` |
| Accent (decision-point) | `#f5853b` (sunrise orange) | `#6db8d4` (moon cyan) |
| Notable (NOT accent — distinct token) | `#c43a1a` (deep ember) | `#f5853b` (warm orange) |
| Border | `#e6e0d4` | `#283354` |
| Density triad — Sky / Sand / Ember | `#6ec5d9` / `#e8c060` / `#e87a4a` | `#4a8aa8` / `#c49850` / `#c46038` |

The accent appears at exactly 8 sites — see [`../01-spec/voice-and-content.md`](../01-spec/voice-and-content.md). The notable token is **distinct** from accent even when its dark-mode value shares hue with light-mode accent — they must not be aliased in production CSS.

## Type

System-font stack: `-apple-system, BlinkMacSystemFont, "Segoe UI Variable", "Helvetica Neue", "Inter", sans-serif`. No webfont. The stack reads as the user's native typeface on every platform — this is a feature, not a fallback.

6-step ramp:

| Token | Size | Use |
|---|---|---|
| `--type-xs` | 11px | Meta labels, captions |
| `--type-sm` | 13px | Body small, secondary |
| `--type-base` | 15px | Body |
| `--type-md` | 17px | Species name in row, modal headings |
| `--type-lg` | 22px | Surface section titles |
| `--type-hero` | 34px | Lede, detail-surface species name |
| `--lede-size` | 26px | Documented exception between `--type-lg` and `--type-hero` |

`font-feature-settings: "tnum"` applies to all numeric content (counts, timestamps).

## Mood

The redesign should feel like a place — Sonoran desert at dawn (light) or under a clear desert night sky (dark) — not a tool. The map *is* the front door (resolves S4). The detail surface leads with the photo as anchor. Loading states are flat skeletons with a 2px sunrise progress bar at the top, not shimmering rectangles.

The voice register is **declarative-direct, never editorialized**. The lede is a count-only truth claim the runtime defends through enumerated templates (zero-results / single-species / family-filter / default / sparse-region) — e.g. "331 species" for the default case; the region rides in the wordmark headline and the time-window dropped (#828). See [`../01-spec/voice-and-content.md`](../01-spec/voice-and-content.md).

## What this direction is NOT

- **Not magazine-grade** in the sense of long-form editorial layouts; it's editorial in the sense of confidence and restraint.
- **Not opinion-led** — the voice is opinionated about what the site IS (recency, Arizona, eBird), not about how the user should feel about birds.
- **Not photo-required** — 9% of species have no photo; the no-photo `<FamilySilhouette>` rendering at hero scale is a first-class fallback, designed and tested at the same fidelity as the photo path.
- **Not playful** — voice register is "functional-reassuring" (calm, declarative, no exclamation marks, no apology language). New copy must match.
- **Not high-motion** — zero CSS motion exists today; the redesign introduces it conservatively, always behind a `prefers-reduced-motion: reduce` guard.

## Visual reference

Open [`../04-visuals/system-poster.png`](../04-visuals/system-poster.png) for the full token poster (palette + type + components + photo treatment, both modes side by side).

For surface mockups see:

- [`../04-visuals/map-desktop-pair.png`](../04-visuals/map-desktop-pair.png) — map surface, light + dark
- [`../04-visuals/detail-desktop-pair.png`](../04-visuals/detail-desktop-pair.png) — species detail modal, both modes
- [`../04-visuals/feed-desktop.png`](../04-visuals/feed-desktop.png) — feed view with newspaper lede
- [`../04-visuals/mobile-triplet.png`](../04-visuals/mobile-triplet.png) — mobile patterns

## Inspirational references (not commitments)

The agents that contributed to this direction cited specific products as references — recorded here for designers and reviewers who want to see the gravitational field:

- BirdCast (`birdcast.info`) — narrow-scope opinionated utility; the structural peer
- Apple Maps — pill-shaped cluster idiom; large-title pattern
- Apple Photos — photo-as-anchor with overlay text in lower-left
- NYT Upshot — newspaper lede style at the top of a list
- Linear — token system + restrained accent discipline

These influenced the direction but bird-maps.com is none of them. The visual identity is its own.
