# Species-Sheet Detent Redesign — Mid + Full Directions & Transitions Plan

Decision-ready brief synthesizing two design directions (Editorial, Field-guide) plus a shared
transitions/motion plan for the mobile `SpeciesDetailSheet` detent redesign. Companion to
`diagnosis-report.md` (the root-cause findings) — this document answers "what should mid and full
*look like*, and how does the photo travel between them."

---

## 1. TL;DR — the shared principle

**Size-appropriate content per detent.** The bug today (diagnosis F2) is that all three detents render
*the same body* — a full-bleed hero photo + full prose — and just clip it with `overflow:hidden`. So
the small detent shows a sliver of photo and the mid detent shows "the full view with the bottom cut
off." The fix both directions converge on:

- **Keep the loved small row exactly.** Grab handle + 44px rounded thumbnail + comName + familyName +
  ⌃ cue, ~104px tall. The *only* nudge is a 3px family-color accent on the thumbnail's left edge — a
  visual "thread" seed that grows into the mid plate-frame and the full taxon-rule.
- **Redesign mid into its own layout** — NOT the full body clipped. A small *bounded* square photo
  plate with identity/metadata arranged *around* it. Zero clipped prose: what shows is complete.
- **Redesign full into a designed page** — a structured top-to-bottom reading layout, not "photo slab
  then plain paragraph."
- **One photo DOM node travels across all three detents** (thumbnail → plate → hero), animated in pure
  CSS, so growing the sheet feels like one object zooming rather than three screens swapping.

Both directions share that skeleton. They differ in *editorial voice* (magazine spread) vs *naturalist
voice* (field-guide record card with a taxonomy table). The transitions plan is direction-agnostic and
applies to whichever is chosen.

---

## 2. Direction A — Modern Editorial / Magazine ("the field-guide spread")

**North star:** each detent is a distinct editorial layout — small = the byline, mid = a magazine
"entry card" with a square art-directed plate and metadata set around it, full = a one-column feature
spread with a framed plate, a deck, and rhythm prose. The sheet reads as a *designed page* that gains
depth, not a single body that gets clipped or stretched.

**Small adjustment:** keep the identity row exactly; add a 3px family-color tick on the LEFT edge of
the 44px thumbnail — the same accent that becomes the plate frame at mid and the rule above the deck at
full. Row stays ~104px.

### 2A. Editorial — MID

```
┌────────────────────────────────────────────┐ ← sheet top, --card-radius 12px
│                  ▬▬▬▬                      │  grab handle (centered)
│                                            │
│  ┌──────────────┐   NORTHERN CARDINAL     │
│  │▏             │   ── type-md/semibold    │
│  │▏   136×136   │   Cardinalis cardinalis  │
│  │▏   PLATE     │   ── type-sm italic·subtle
│  │▏  (square,   │                          │
│  │▏  family-    │   CARDINALS & ALLIES     │
│  │▏  framed)    │   ── type-xs·tracked·caps │
│  └──────────────┘   ───────────────────    │ ← 3px family rule
│   ▲3px family tick   no. 17226  ·  taxon    │  type-xs·subtle (omit if null)
│                                            │
│  The northern cardinal is a mid-sized      │ deck: type-base/1.5, 2-line clamp
│  songbird found across eastern North …     │  justified, ends with ellipsis
│                                            │
│  From Wikipedia · CC BY-SA      ⌃ Expand    │ byline type-xs·subtle · affordance
└──────────────────────────────────────────┘
   (map sightings remain visible + tappable below the sheet)
```

**Concept:** a magazine "entry card." The photo is demoted from full-bleed hero to a fixed ~136px
SQUARE plate pinned top-left (12px radius, 3px family-color frame). Identity sets to its RIGHT in a
tight L-shaped column — comName / sci-name / family eyebrow / a thin taxon rule — so the eye reads
name-first, plate-second, like a field-guide index entry. Below the plate+identity zone: a single
justified deck of the description (2 lines, clamped) plus an italic source byline. Map stays visible
behind; nothing full-bleed (honors the transient-surface contract).

**Content SHOWN:**
- 44px→136px square plate (photoUrl, or family silhouette in family color if absent)
- comName (type-md / semibold)
- sciName italic (type-sm)
- familyName as tracked all-caps eyebrow (type-xs)
- family-color hairline rule + taxonOrder line (type-xs, hidden when taxonOrder is null)
- first ~2 clamped lines of descriptionBody as a justified deck (type-base)
- compact source byline: descriptionLicense + attribution (type-xs) + an "Expand" chevron affordance

**Content DEFERRED:**
- the full multi-paragraph descriptionBody
- photo attribution/license (photoAttribution, photoLicense) — held for the full plate caption
- the larger framed feature plate and its breathing room
- any future secondary metadata

**Creative hook:** it is an L-shaped index entry, not a shrunk hero — the photo never spans the width;
it's a fixed square plate with type wrapping to its right. That single move makes mid feel like a
magazine entry card rather than the full view with the bottom cut off. The family-color frame on the
plate is the same accent that was a tick on the small thumbnail, so growing the sheet feels like the
same object zooming, not a new screen.

### 2B. Editorial — FULL

```
┌──────────────────────────────────────────┐ ← full, modal (scrim behind)
│                  ▬▬▬▬                  ✕   │ grab handle · close
│                                            │
│  CARDINALS & ALLIES                        │ eyebrow type-xs·tracked·caps·subtle
│  Northern Cardinal                         │ HEADLINE type-hero/bold (34)
│  Cardinalis cardinalis                     │ subhead type-lg italic·muted
│  ──────────────────                        │ 3px family-color rule (the thread)
│                                            │
│  ┌────────────────────────────────────┐   │
│  │▏                                    │   │ framed feature plate
│  │▏        ~3:2  FEATURE  PLATE        │   │  content-width, 3px family frame
│  │▏     (photo, or family silhouette  │   │
│  │▏      filling frame in family hue) │   │
│  └────────────────────────────────────┘   │
│  Photo: M. Smith · Macaulay Library/CC     │ figure caption type-xs italic·subtle
│                                            │
│  A mid-sized songbird, the cardinal is     │ DECK / standfirst type-md/1.45·strong
│  among the most recognizable in the East.  │  (first sentence, pulled out)
│                                            │
│  The northern cardinal is found across     │ body type-base/1.6 justified
│  eastern North America from Maine south …  │  full descriptionBody, scrolls
│  …woodlands, gardens, and shrublands. It   │
│  was introduced to Hawaii in 1929 and …    │
│                                            │
│  ─────────                                 │ thin divider
│  FROM WIKIPEDIA · CC BY-SA  ↗              │ source small-caps type-xs·subtle·link
└──────────────────────────────────────────┘
```

**Concept:** a one-column feature spread. The plate is RE-COMPOSED, not just enlarged — it becomes a
framed, captioned figure (full content-width, ~3:2, 3px family frame) with photo attribution set as an
italic caption beneath it. Above it sits a masthead block: tracked all-caps family eyebrow → comName as
a true display heading (type-hero) → italic sci-name subhead. A family-color rule separates masthead
from a DECK — the first sentence pulled out at type-md as a standfirst — which flows into full
justified body prose. A small-caps source line closes the column. Map is masked behind a modal scrim.
Reads top-to-bottom as designed: eyebrow → headline → subhead → plate+caption → deck → body → credit.

**Content SHOWN:**
- family eyebrow (tracked all-caps, type-xs)
- comName as display headline (type-hero)
- sciName italic subhead (type-lg)
- 3px family-color rule under the masthead
- framed ~3:2 feature plate (photoUrl, or family silhouette filling the frame in family color)
- photo caption: photoAttribution + photoLicense (italic, type-xs) — shown only when present
- deck/standfirst: first sentence of descriptionBody pulled out at type-md
- full descriptionBody body prose (type-base, scrolls within the sheet)
- taxonOrder as an optional metadata line under the eyebrow when present
- source credit: descriptionLicense + descriptionAttributionUrl as a small-caps link with ↗

**Creative hook:** the reorder *is* the idea — eyebrow → headline → sci-name → rule → captioned plate →
pulled deck → body. The photo is a captioned FIGURE inside the article (credit as its caption), not a
banner the text hangs off. That single inversion makes it read "designed magazine spread" instead of
"image header + paragraph." The family-color rule under the headline is the grown-up version of the mid
plate-frame and the small thumbnail tick — closing the three-detent continuity.

---

## 3. Direction B — Field-Guide / Naturalist ("the plate, the taxon line, the family accent")

**North star:** treat the sheet like a field-guide plate — each detent is a self-complete taxonomic
record at its own scale. The photo, the silhouette-in-family-color, and the taxon line do the
identifying work — never a hero photo with prose clipped off below.

**Small adjustment:** identical to Editorial — keep the row exactly; add a 3px family-accent left edge
to the thumbnail (the same accent that becomes the taxon rule and family chip dot at mid/full). On
silhouette fallback the thumb already tints to family color, so the edge reads as a deliberate spine.
~104px, same type, same ⌃.

### 3A. Field-guide — MID

```
┌───────────────────────────────────────┐
│                 ▭▭▭▭                    │  grab handle
│                                         │
│  ┌──────────┐   Northern Cardinal       │  plate 120²
│  │▞▞▞▞▞▞▞▞▞▞│   Cardinalis cardinalis   │  + accent
│  │▞ photo  ▞│   ◤ italic sci name       │  inner frame
│  │▞ plate  ▞│                            │
│  │▞▞▞▞▞▞▞▞▞▞│   ●▲ Cardinals & Allies   │  family chip
│  └──────────┘      accent-dot + sil.    │  (dot=accent)
│ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  │  accent rule
│  ┌─────────────────┬──────────────────┐ │
│  │ FAMILY          │ TAXONOMIC ORDER  │ │  field record
│  │ Cardinalidae    │ #17 of order     │ │  2 labeled cells
│  └─────────────────┴──────────────────┘ │
│                                         │
│  The northern cardinal is a mid-sized   │  2-line teaser
│  songbird found across eastern North…   │  fade-to-surface
│  ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄ Read account ⌄ │  defer-to-full
└───────────────────────────────────────┘
```

**Concept:** a "plate card" — the seed idea made literal. The photo shrinks to a ~120px SQUARE plate
pinned top-left (framed specimen plate, 1px accent inner-frame), with taxonomic identity wrapping to
its right: common name, italic scientific name, a family chip carrying a tiny silhouette glyph + accent
dot. Below the plate row, a labeled two-cell "field record" strip (FAMILY / ORDER) using the real
taxonOrder field — never rendered before — gives the layout taxonomic weight without inventing data. A
2-line description teaser with a soft fade-to-surface sits at the bottom with a "Read full account"
affordance. Structurally a record card, not a truncated full view.

**Content SHOWN:**
- Square photo PLATE (~120px) with 1px family-accent inner frame; silhouette-in-family-color if absent
- comName at --type-lg 22 semibold
- sciName italic at --type-base 15 in --color-text-muted
- Family chip: tiny family silhouette glyph + accent dot + familyName at --type-sm 13
- Family-accent horizontal rule (the taxon line) separating identity from record
- "Field record" two-cell strip: FAMILY (familyName) + TAXONOMIC ORDER (taxonOrder), --type-xs 11 caps labels
- 2-line description teaser with fade mask + "Read account ⌄" control that flicks to full

**Content DEFERRED:**
- Full descriptionBody prose (only 2 lines shown, rest masked)
- Photo attribution + license (photoAttribution / photoLicense)
- Description attribution/license footer (descriptionAttributionUrl / descriptionLicense)
- Large-format photo — the plate stays small and bounded at mid by design

**Creative hook:** the "field record" meta strip surfaces taxonOrder — a real SpeciesMeta field the UI
has never shown — turning dead data into the naturalist signal that makes mid feel like a guide entry.
The plate's accent inner-frame + the accent taxon rule + the family-chip dot are the SAME family color
in three roles (frame / rule / dot). Crucially the photo is small and square here — the opposite of the
current clipped full-bleed.

### 3B. Field-guide — FULL

```
┌───────────────────────────────────────┐
│                 ▭▭▭▭                    │  handle
│ ╔═════════════════════════════════════╗ │
│ ║                                     ║ │
│ ║      full-bleed masthead photo      ║ │  16/10 hero
│ ║                          eBird ↗    ║ │  attribution
│ ╚═════════════════════════════════════╝ │
│                                         │
│  Northern Cardinal                      │  --type-hero 34
│ ━━━━━━━━━━  accent taxon rule           │
│  Cardinalis cardinalis  · Cardinals &…  │  sci · family
│                                         │
│  ┌─ TAXONOMY ──────────────────────────┐│
│  │ Scientific  Cardinalis cardinalis   ││  labeled table
│  │ Family      Cardinals and Allies ●▲ ││  accent+silh.
│  │ Order       #17 in taxonomic order  ││  taxonOrder
│  └─────────────────────────────────────┘│
│                                         │
│  ABOUT                                   │  section eyebrow
│  The northern cardinal, also called the │
│  redbird, is a mid-sized songbird of    │  full prose,
│  the genus Cardinalis. It is found from  │  readable measure
│  the eastern United States south to…    │
│  …(full descriptionBody continues)      │
│                                         │
│ ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄ │
│  Text: Wikipedia, CC BY-SA · Photo ↗    │  license footer
└───────────────────────────────────────┘
```

**Concept:** the rich field-guide entry. The plate photo expands back to a full-bleed 16/10 masthead
(shared element grows up), but the entry below is structured like a printed guide page: an accent taxon
rule under the name, a proper 3-row TAXONOMY table (Scientific name / Family / Order), then full
descriptionBody at a readable measure, closed by a licensed attribution footer. On silhouette fallback
the masthead becomes a family-color tinted ground with the large silhouette centered — a deliberate
"no specimen photographed" plate, not a grey box.

**Content SHOWN:**
- Full-bleed 16/10 masthead photo with bottom-right photo attribution chip (photoAttribution + ↗)
- comName at --type-hero 34
- Family-accent taxon rule directly under the name
- sciName italic + familyName as a single "sci · family" subline
- TAXONOMY table: Scientific name, Family (with accent dot + silhouette glyph), Order (taxonOrder) — labeled rows
- "ABOUT" section eyebrow + full descriptionBody prose at readable measure
- License footer: descriptionLicense + descriptionAttributionUrl, and photo license — all credits land here
- On photoUrl absent: masthead becomes family-color tinted ground with large centered silhouette

**Creative hook:** the taxonomy table promotes taxonOrder and family to first-class, labeled rows — the
thing a real field guide leads with and that bird-maps has been hiding. The accent taxon rule under the
hero name is the grown-up sibling of the small row's accent edge and the mid plate frame: one family
color threads peek→mid→full as edge → frame/rule → hero rule. The silhouette-fallback masthead is
designed as an intentional plate, so a photo-less species still looks like a guide entry.

---

## 4. Photo continuity + morph / transition plan

This plan is direction-agnostic — it applies to whichever direction wins. It is the single
highest-leverage fix for the "hard pop" between detents.

### 4.1 The shared-element photo verdict — FEASIBLE in pure CSS

**Today there are TWO photo DOM nodes**, toggled by `display:none`: the 44px `<img class='sheet-compact-thumb'>`
inside `.sheet-compact`, and a separate `<Photo layout='masthead'>` inside `.sheet-scroll`. They are
different elements, so there is *zero* continuity — the thumbnail blinks out and the hero blinks in.

**Approach (recommended):** render ONE `<Photo>` as a direct child of `.species-detail-sheet`, OUTSIDE
both `.sheet-compact` and `.sheet-scroll`, so it is never `display:none`'d and never remounts
(preserving the decoded bitmap — no reload flash, no LCP re-fire). The detent class drives only its
frame geometry:

- **peek/compact:** 44px square pinned left in the identity row (text flows beside it); radius ~9px.
- **mid:** larger inset "quarter"/plate card; radius 12px; small top margin; square-ish framing.
- **full:** full-bleed hero — negative-gutter margin to span edge-to-edge; radius 0 (top corners
  rounded by the sheet's own overflow clip); ~16/10 framing.

**Why object-fit makes it work:** `object-fit:cover` is already on `.photo__img`. Cover means the CROP
recomputes as the frame resizes — a square 44px crop grows into a hero crop with the subject staying
covered, no letterboxing, no distortion. Transition the frame size (explicit height/width + margin) +
border-radius with the SAME card-resize ease/dur as the container.

**Silhouette fallback** rides the same single element: `FamilySilhouette` centered via flex/grid inside
`.photo--silhouette`; sizing the glyph as a % of the frame scales it with the morph. No special-casing.

**Fallback if single-element proves too invasive / flaky on Safari:** repurpose recipe 14
(skeleton-reveal) as a photo cross-fade — stack thumbnail and hero as two absolutely-positioned layers
in the same slot, cross-fade opacity + 2px blur on the threshold crossing. Loses true positional
continuity (reads as a soft dissolve, not a morph) and pays a brief double-decode. **Recommend the
single-element morph; fall back only if grid-area continuity is flaky.**

### 4.2 Morph table — transitions-dev recipes per detent boundary

| Boundary | Container | Content reveal | Photo | Recipes |
|---|---|---|---|---|
| **small ↔ mid** | Keep existing card-resize height tween EXACTLY (recipe 01: `transition: height var(--sheet-settle-dur) var(--sheet-settle-ease)`; 300ms cubic-bezier(0.22,1,0.36,1); gated OFF during drag via `[data-dragging='true']{transition:none}` so height tracks the finger 1:1). The drag IS the morph driver — no competing container animation. | Replace the binary `display:none` cut. sci-name + 2–3 line description clamp REVEAL via texts-reveal (recipe 18): wrap in a `.t-stagger` block, add `.is-shown` when the mid threshold is crossed during the up-drag (driven by live height), `.is-hiding` on the down-drag back below. The name+family SPINE stays mounted the whole time (never `display:none`'d; only restyles size). | Shared-element frame resize (object-fit:cover, explicit height/margin/radius transition). | **01-card-resize** + **18-texts-reveal** + shared-element photo resize |
| **mid ↔ full** | Same single card-resize height tween — no second mechanism. The role/inert flip to `dialog` at full is orthogonal to motion (already sequenced in goToSnap/settleTo — keep untouched). Do NOT raise `--sheet-settle-dur`; 300ms reads well across the full 104→836px range. | Mid is a genuinely DIFFERENT layout (quarter/plate photo + clamped description + fade-mask), then full-only extras reveal on the crossing via panel-reveal (recipe 07): `.description-rest` block, `data-open` flips true at `[data-content='full']`, translateY(~24px) + opacity + 2px cross-blur. The line-clamp fade-mask animates away (mask-image transition) so the cut-off gradient lifts as full prose arrives. | Shared-element frame morphs quarter→hero full-bleed (margin un-insets to negative gutter, radius→0, hero crop). | **01-card-resize** + **07-panel-reveal** + shared-element photo quarter→hero |

### 4.3 Content-swap strategy — 3-state, live-height driven

Replace today's binary `display:none` cut (`showCompact = height < PEEK_PX+60`, toggling
`.sheet-compact` vs `.sheet-scroll`) with a THREE-state `data-content` ('compact' | 'mid' | 'full')
computed from `liveHeight ?? heightFor(snap)` on *every* render — so content blooms DURING the drag,
not snapping at one boundary. Two thresholds (e.g. `height < PEEK_PX+60 ⇒ compact`; `< ~HALF*1.15 ⇒
mid`; else `full`).

**Stop using `display:none` to gate content.** ALWAYS render the body; clip with the sheet's existing
`overflow:hidden` at small detents. What changes per detent is which lines are *visible-via-opacity*,
not which are in the DOM. Tier into reveal groups:

- **SPINE** (name + family): never hidden, always opacity 1 — the continuity anchor. Font-size
  transitions on the card-resize ease.
- **MID-TIER** (sci-name + clamped description): `.t-stagger` (recipe 18). `.is-shown` at
  `[data-content='mid']` or `'full'`; `.is-hiding` (quiet fade, no Y-return) on the way back down.
- **FULL-TIER** (rest of the long prose + attribution): `.t-panel-slide` (recipe 07). `data-open` at
  `[data-content='full']`.

Because container height is finger-tracked (transition gated off during drag) while reveal channels
(opacity/translateY/blur) run their own 600ms/400ms timing, new content fades/rises in OVER the growing
sheet — no frame where empty space suddenly fills with a hard block of text. **Not recipe 14 for text:**
skeleton-reveal implies loading→loaded; using it for detent→detent would falsely signal "was a
placeholder." texts-reveal + panel-reveal match the semantics (existing content entering view).

### 4.4 Reduced-motion

**Fully covered by `motion.css`'s global rule** (`transition-duration:0ms !important` on
`*,::before,::after`). The height tween, the `.t-stagger` line transitions, the `.t-panel-slide` prose,
the mask-image release, and the photo-frame transition all collapse to instant — and **every channel's
0ms end state is the correct resting state** (`.is-shown` → opacity:1/translateY(0)/blur(0); container
→ detent height; photo → detent frame; mask → removed). **Add NO per-element guards.**

### 4.5 Transition risks (call out in the plan)

1. **aspect-ratio does not tween smoothly on all engines** — animating it directly STEPS. Drive an
   explicit height transition (or width + %-padding box) and let object-fit:cover recompute the crop;
   reserve aspect-ratio for the static per-detent resting frame only.
2. **flex-direction cannot animate** — peek is inline (photo beside text), mid/full stacks. A
   flex-row→column switch hard-jumps. Use **CSS Grid template-area transitions** (animatable track
   sizes) so the photo track grows and text reflows below without a discrete switch.
3. **Continuity vs remount** — if the single `<Photo>` is conditionally rendered or its key changes,
   React remounts the `<img>`, the bitmap re-decodes (flash) and LCP/eager-fetch can re-fire. Render
   exactly one stable sibling; only className/grid placement changes.
4. **Live-height threshold thrash** — a per-frame 3-state can flip-flop at a boundary, retriggering
   reveals → flicker. Add **hysteresis** (different up vs down thresholds / dead-band) or debounce.
5. **overflow-x during the un-inset** — as the photo goes inset→negative-gutter, a mid-morph frame can
   momentarily exceed content width → horizontal scrollbar. Keep `.sheet-scroll overflow-x:clip` and
   clip x on the sheet root.
6. **line-clamp + mask-image release** — `-webkit-line-clamp` is non-standard and mask-image transition
   support is uneven; a botched release snaps a hard gradient edge. Test on Safari; fall back to a
   simple opacity fade on a gradient overlay element if flaky.
7. **Reveal timing trailing the settle** — 600ms/400ms reveals trailing the 300ms settle on a fast
   flick reads as content lagging. Acceptable; if loose, shorten reveal durations toward settle dur for
   flick-initiated transitions. Verify the feel live.
8. **Scope creep beyond a motion PR** — making mid a new layout + the single-element photo refactor
   touches `SpeciesDetailSurface` structure, not just CSS. The repo's frontend-plan CSS sub-task gate
   and live Playwright verification at all canonical viewports apply. Guard against an under-scoped PR
   that ships motion without the mid redesign and still feels like a clipped full view.

---

## 5. Comparison — Editorial vs Field-guide

| Dimension | A · Editorial (magazine) | B · Field-guide (naturalist) |
|---|---|---|
| **Mid concept** | L-shaped "entry card": 136px square plate top-left + name/sci/eyebrow/rule to the right + 2-line justified deck + source byline | "Plate card": 120px square plate + name/sci + family chip (silhouette+dot) + **labeled FAMILY/ORDER field-record strip** + 2-line teaser w/ fade |
| **Full concept** | One-column feature spread: eyebrow → headline → sci subhead → rule → **captioned framed ~3:2 figure** → pulled deck/standfirst → justified body → small-caps source | Field-guide entry: **full-bleed 16/10 masthead** → name + taxon rule → sci·family subline → **3-row TAXONOMY table** → ABOUT prose → license footer |
| **Info density** | Medium. Editorial restraint — deck + body, metadata kept light (one taxon line). Prose-forward. | Higher. Surfaces taxonOrder twice (mid strip + full table) as labeled data. Data/record-forward. |
| **Build complexity** | Moderate. Deck = "first sentence" parsing (naive — needs ~160-char clamp + fallback). Justify+hyphens risk at 390px. Captioned-figure full is a clean re-flow. | Moderate–higher. Two-cell strip + 3-row table = more layout primitives (grid cells, labels, em-dash null states). taxonOrder nullable handling in two places. Full keeps the existing full-bleed masthead (less photo-morph re-composition than Editorial's figure). |
| **Photo at full** | Re-composed: framed ~3:2 **figure** with caption (bigger morph delta from mid plate). | Full-bleed 16/10 **masthead** (matches today's full; the 1/1→16/10 aspect change is the one real morph discontinuity). |
| **Fit with the loved small row** | Excellent — both keep the row verbatim + the 3px family tick seed. | Excellent — identical small-row treatment. |
| **New data surfaced** | taxonOrder as one optional line. | taxonOrder + family promoted to **first-class labeled rows** (the "dead data → naturalist signal" story). |
| **Voice** | Designed editorial page; reads like a magazine feature. | Printed field guide; reads like a specimen record. |
| **Risk hotspots** | Justified rivers at 390px (mitigate: hyphens:auto or left-align <768px); naive sentence parse for the deck. | Field-record strip crowding at 390px with long family names (wrap to 2 lines); 1/1→16/10 masthead aspect cross-fade is the trickiest single transition. |

### Recommendation

**Lead with Field-guide (Direction B), borrowing Editorial's captioned-figure discipline at full.**

Rationale:
- **It is the most on-brand for bird-maps** — a field-guide/naturalist voice fits a bird-sighting map
  better than a lifestyle-magazine voice, and it does the one genuinely new thing: promoting
  `taxonOrder` + family to labeled, first-class data (the "we've been hiding real data" win). That is a
  product improvement, not just a re-skin.
- **Its full state keeps the existing full-bleed masthead**, so the *structural* delta from today's
  full is smaller (re-order + add a taxonomy table) — lower-risk than Editorial's figure re-composition,
  even though it pays the one 1/1→16/10 aspect morph.
- **One caveat to carry over from Editorial:** at full, treat the photo attribution as a *caption-style*
  credit and consider Editorial's captioned-figure framing if user-testing finds the bare masthead +
  attribution chip reads as "header + dump." The two directions are not mutually exclusive at the
  component level — the shared photo-element + 3-state reveal plumbing is identical.

Both directions share the exact same small row, the same shared-element photo morph, and the same
3-state content-swap motion plan — so **the transitions work is committed regardless of which visual
direction wins.** That plumbing (single `<Photo>` node + `data-content` 3-state + recipe 01/07/18) is
the safe thing to build first; the visual direction can be chosen in parallel.

---

## 6. Open questions for the user

1. **Direction:** Field-guide (recommended), Editorial, or a hybrid (Field-guide structure + Editorial's
   captioned-figure full)? This is the one decision that unblocks the visual layer.
2. **Mid layout sizing:** Editorial mid is ~136px plate + L-column; Field-guide mid is ~120px plate +
   field-record strip + teaser, landing around ~506px tall. Does the field-record strip earn its
   vertical cost at the `half` detent, or should mid stay leaner (defer the strip to full)?
3. **taxonOrder presentation:** "#17 of order" / "#17 in taxonomic order" is a raw eBird sort index, not
   a human-meaningful rank. Show it verbatim, relabel it ("eBird taxonomic order"), or drop the numeric
   and keep only Family? (It is nullable — both directions already collapse the cell when absent.)
4. **Deck/standfirst (Editorial only):** the "first sentence pulled out" parse is naive. Accept the
   ~160-char clamp + body-lead fallback, or skip the standfirst entirely and go straight masthead→body?
5. **Justify at 390px (Editorial only):** justify-with-hyphens, or left-align on mobile and treat
   justify as a ≥768px enhancement?
6. **Photo morph vs cross-fade:** commit to the single-element geometric morph (recommended), or
   pre-approve the recipe-14 cross-fade fallback if Safari grid-area continuity proves flaky during
   implementation?
7. **Scope of the first PR:** ship the transitions plumbing (single `<Photo>` + 3-state reveal) and the
   mid redesign together (recommended — motion-only would still feel like a clipped full view), or split
   into a motion PR then a layout PR? Note the repo's frontend CSS sub-task gate + canonical-viewport
   Playwright verification apply either way.
8. **Modal contract at full:** the redesign assumes the diagnosis's separate a11y fixes (focus trap /
   `aria-modal` — F8/F9/F10) land alongside or before this. Confirm they are in scope or explicitly
   sequenced first.
