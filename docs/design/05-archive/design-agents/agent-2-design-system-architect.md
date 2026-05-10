# Design Agent 2: Design System Architect

## Thesis

The bird-maps.com codebase is not missing tokens — it's missing a **primitive layer** between tokens and surfaces. Every surface today recombines raw classes against raw tokens with no shared vocabulary, which is why 14 distinct loading/empty/error pairs exist, why two species inputs visually disagree, and why "two color systems" (CSS chrome + DB family palette) feels like a contradiction instead of a layered architecture. The cleanest move is a **three-tier token contract** (primitive → semantic → component) with semantic tokens that are *mode-neutral by name* and a *role-channel* convention that lets the DB-sourced family palette enter the system as data, not as a competing brand. The single primitive that would change the most: a `<StatusBlock>` (a/k/a `<Surface state="loading|empty|error|idle">`) that absorbs the 14-pair sprawl and becomes the canvas for the map skeleton, the feed empty state, the species detail loader, and the modal error — one component, one tonal voice, one motion budget. Light/dark should be a `[data-theme]` override on `:root` (not `prefers-color-scheme` alone — users need a manual toggle and the map basemap swap forces an explicit signal anyway), and the type system should collapse from 7 hardcoded sizes to a 5-step ramp keyed off a CSS `--type-base` so a webfont swap is a one-token operation.

## Ideas

### Idea 1: Three-tier token contract — `primitive → semantic → component`

Restructure `tokens.ts` + `:root` into three explicit layers. Primitives are the raw scale (`--c-warm-100..900`, `--c-sky-100..900`, `--c-cyan-100..900`); semantics are role-named and mode-aware (`--surface-page`, `--surface-raised`, `--text-primary`, `--accent-action`); component tokens reference semantics (`--feed-row-bg: var(--surface-raised)`). Today's CSS jumps straight from hex literals to component classes — there is no semantic layer. Adding one is what makes light/dark a 1-line override instead of a 20-line override of every component class.

- **Token shape:** `--c-{hue}-{step}` primitives; `--{role}-{intent}` semantics (e.g. `--text-primary`, `--text-secondary`, `--surface-base`, `--accent-action`, `--accent-notable`, `--border-subtle`, `--border-strong`); component tokens prefixed with their owner (`--feed-row-bg`, `--legend-entry-active-bg`).
- **What it replaces or supplements:** the current single-tier `--color-bg-page` / `--color-text-strong` flat namespace in `styles.css:24–62`. Existing names stay as aliases for one release to avoid a flag-day rewrite.
- **Risk / trade-off:** indirection cost — designers reading the CSS need to know that `--feed-row-bg` resolves through `--surface-raised` to `--c-warm-50`. Mitigated by colocating component tokens with their CSS rule and never naming a component token after a hex.

### Idea 2: `<StatusBlock>` — the one primitive that eats 14 patterns

A single React component with three required props (`state`, `title`, `body?`) and three optional ones (`tone`, `action`, `surface`). `state="loading"` paints a skeleton scrim with motion (respecting `prefers-reduced-motion`); `state="empty"` paints muted neutrals with a calm icon; `state="error"` paints `--accent-error` chrome with the body text inheriting `--text-primary` (fixing the inverted severity in `App.tsx:143–150` automatically). It must work in five containers: full-viewport (`.error-screen`), full-list (`.feed-empty`), narrow panel (`.species-detail-loading`), modal section (`.attribution-modal-loading`), and overlay (the 730px map skeleton at `MapSurface.tsx:148–165`).

- **Token shape:** consumes `--surface-raised`, `--text-primary`, `--text-secondary`, `--accent-error`, `--motion-skeleton-duration`. Exposes no new tokens — all variation is via existing semantics.
- **What it replaces or supplements:** `.feed-empty`, `.species-search-empty`, `.species-detail-loading`, `.species-detail-error`, `.attribution-modal-loading`, `.attribution-modal-empty`, `.attribution-modal-error`, `.error-screen`, `.map-loading-skeleton` — all 9 classes collapse into 1 component with state variants.
- **Risk / trade-off:** the map skeleton is *huge* (730px) and a polished motion treatment there could feel out of register with the calm voice. Cap skeleton motion to a 1.6s cycle, 5–10% lightness pulse — never a sweep gradient. Container queries (not viewport media) decide which density the StatusBlock paints in.

### Idea 3: Family palette as a **role-channel**, not a brand color

Stop treating the DB-sourced family palette as if it competes with the chrome accent. It's *data encoding*, not brand. Promote it to a named channel: `--channel-family-fill` and `--channel-family-stroke`, set per-element via inline style from the DB value, with a documented contract that family colors are tested against *two* surfaces (light tile + dark tile) and `--text-primary` overlay text. The chrome accent (`--accent-action`, e.g. Sky Atlas's `#f5853b`) lives in a separate role and never paints a family. This dissolves the "two color systems" problem: there is one system with one chrome-accent role and one data-encoding channel — they're allowed to coexist because they answer different questions.

- **Token shape:** `--channel-family-fill: <hex>` set inline on `[data-family]` elements; matched with computed `--channel-family-on: <#1a1a1a|#fff>` (auto-picked for AA per family) so silhouettes and labels always have a contrast partner.
- **What it replaces or supplements:** the DB→SVG-fill direct path in `family-color.ts` and the `readToken()` MapLibre bridge in `observation-layers.ts:136–141`. The bridge stays; it just resolves named channels instead of bare custom properties.
- **Risk / trade-off:** requires a per-family contrast audit (8 families × 2 modes × 2 basemaps = 32 cells). Worth doing once and storing in a `family-color-meta.json` next to the migration; cheaper than re-litigating it every redesign.

### Idea 4: Five-step type ramp keyed off `--type-base`

Replace the 35+ hardcoded font-size literals with a five-step ramp on a 1.20 (minor third) modular scale: `--type-xs` (11), `--type-sm` (12.8 ≈ 13), `--type-base` (14), `--type-md` (17, currently absent — collapses 15+18), `--type-lg` (20, currently used only at species detail common name). Five is right because the existing range is 11→20 and every literal slots cleanly. Line-height pairs with each step (`--lh-xs..lg`) so the four explicit `line-height` declarations become five tokens. Webfont swap becomes a one-token operation (`--font-stack`) — and the *whole reason* a webfont is hard today is that there's no scale to redistribute against system metrics.

- **Token shape:** `--type-{xs,sm,base,md,lg}`, `--lh-{xs,sm,base,md,lg}`, `--font-weight-{regular,medium,semibold,bold}` (collapses 600/700 sprawl), `--font-stack`. Four steps would feel cramped given existing usage; six over-resolves the design intent.
- **What it replaces or supplements:** all `font-size:` and `font-weight:` literals in `styles.css`. The scale numbers stay numerically identical to today's literals so visual output doesn't shift in step 1.
- **Risk / trade-off:** the consolidation from 7 sizes to 5 forces a decision on the 15px species-autocomplete input (`styles.css:293`) and the 18px modal heading (`styles.css:649`) — they stop being unique. Either acceptable (modal heading becomes `--type-md` = 17, autocomplete input becomes `--type-base` = 14) or the ramp expands to 6.

### Idea 5: `[data-theme]` override + `prefers-color-scheme` fallback — the dual-track theming mechanic

Light/dark should be controlled by `[data-theme="light|dark"]` on `<html>`, persisted in localStorage, with `prefers-color-scheme: dark` only as the *initial* default. The reason: the map basemap itself swaps (positron light → dark-matter or carto-dark), and that's a *user-visible* change that demands a manual toggle, not a passive OS query. Implementation: declare both palettes in `:root[data-theme="light"]` and `:root[data-theme="dark"]`; an inline blocking `<script>` in `index.html` sets the attribute before paint to avoid FOUC. The `<StatusBlock>` and every other component reads only semantic tokens — no `@media (prefers-color-scheme)` queries inside component CSS, ever.

- **Token shape:** `:root[data-theme="light"] { --surface-page: ...; }` and `:root[data-theme="dark"] { --surface-page: ...; }`. Component CSS references only `var(--surface-page)`.
- **What it replaces or supplements:** the absent dark-mode scaffolding (area-1 Finding 7). Today there is zero dark-mode infrastructure.
- **Risk / trade-off:** cookieless persistence via localStorage means the first paint on a returning user can briefly mismatch the OS preference; the inline script resolves this. A second risk: the `readToken()` runtime bridge in `observation-layers.ts` must re-read tokens on theme change — needs an event hook (`window.dispatchEvent(new Event('theme-change'))` after the attribute swap).

### Idea 6: Photo as a primitive — `<Photo>` with built-in attribution slot

The species-detail iNat photo is the only image on the site, but its treatment (aspect-ratio 4:3, max-width 480px, 4px radius — `styles.css:422–437`) is a future template for any image surface. Promote it to a `<Photo src caption attribution>` primitive with three layout modes: `inline` (in detail body), `masthead` (hero on a future modal-detail variant — area-1 surfaces mockup shows this), `thumb` (44px in feed rows — currently absent, but a clear future need). Attribution overlays the photo bottom-right with a translucent scrim; `loading="lazy"` and `srcset` are baked in so they cannot be forgotten.

- **Token shape:** `--photo-radius`, `--photo-aspect-default: 4/3`, `--photo-attribution-bg: rgba(0,0,0,0.55)`. The aspect tokens are themable per layout mode.
- **What it replaces or supplements:** the 7-line aspect-ratio CLS mitigation in `styles.css:422–437` (the *model* of a good fix per the analysis report). Generalizes the model. Also closes the missing `loading="lazy"`/`srcset` gap (Theme 5 Finding 5.3).
- **Risk / trade-off:** a `thumb` variant in the feed row implies feed rows get heavier visually — a deliberate density change. Should ship behind a layout toggle, not as a default.

### Idea 7: Cluster-bubble palette as a documented `--channel-density-{lo,md,hi}` triad

Rather than choosing "warm-orange/warm-gold/cyan" (Sky Atlas) vs the existing `#51bbd6/#f1f075/#f28cb1`, name the *role* and let the values be themable per mode. The cluster bubbles encode density, not identity — they should be one named role (`--channel-density-lo/md/hi`) with values that hold AA contrast against `--text-on-density` (always `#1a1a1a` in light, always `#f5f7fb` in dark) and don't collide perceptually with the family-fill channel. The Sky Atlas warm trio risks colliding with `--accent-notable` (amber) and the family palette (earth tones). A safer trio in light: `#d4e4ec` / `#7faecf` / `#1d3b5b` (a sky-blue ramp, monochromatic — density reads naturally because lightness is the only variable). Dark mode inverts to `#1c2640` / `#5a8aad` / `#a8d4ec`.

- **Token shape:** `--channel-density-{lo,md,hi}`, `--text-on-density`. Consumed by `observation-layers.ts` via `readToken()`.
- **What it replaces or supplements:** the hardcoded `#51bbd6/#f1f075/#f28cb1` in `observation-layers.ts:170–237`. Today's contrast measurements (≈7.7:1/12.4:1/8.5:1) are coincidental; explicit tokens make the contract enforceable.
- **Risk / trade-off:** the monochromatic ramp loses the "rainbow heat" affordance of the existing palette — some users may read three distinct hues as more legible than three lightness steps. Worth A/B prototyping per the CLAUDE.md prototype-gate. If the rainbow wins, the tokens still hold; only the values move.

## One bold direction (optional)

**Ship a `@bird-watch/ds` workspace package.** Today the frontend has no design-system primitives. A new workspace at `packages/ds/` exporting four primitives (`<StatusBlock>`, `<Photo>`, `<Surface>`, `<Stack>`) plus the three-tier token contract as `tokens.css` would be ~600 lines and would flip the architecture from "every surface improvises" to "every surface composes." The package would have its own Storybook (lightweight — Vite-based, not a separate deploy), exhaustive snapshot tests across `[data-theme]`, and a single contrast-audit script that validates every semantic token against its declared on-token. This is *the* move that would let the redesign land surface-by-surface without re-litigating tokens each time. Cost: 2–3 days of scaffolding before any visual work begins. Payoff: every plan from then on writes against primitives, not against `styles.css:1–945`.
