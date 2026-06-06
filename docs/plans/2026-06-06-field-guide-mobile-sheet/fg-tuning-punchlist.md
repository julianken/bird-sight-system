# Field-Guide Sheet — Tuning Punch-List

Merged + deduped from the design and a11y critiques of the field-guide prototype
(`fg-compact-390.png`, `fg-mid-390.png`, `fg-mid-dark-390.png`, `fg-full-390.png`).
Scoped to the **locked Field-guide direction** (`mid-full-redesign.md` §3 / Recommendation):
keep the small row + 3px family accent thread, 120px mid plate, two-cell record strip,
full-bleed 16/10 masthead, 3-row TAXONOMY table. Items that conflict with that direction
or with `tokens.css` were dropped (see "Dropped" at the bottom).

Severity: **[H]** high · **[M]** medium · **[L]** low. Token/px in the fix.

---

## ALL DETENTS

- [ ] **[H]** Wikipedia source string leaks raw markup / spacing artifacts into the teaser & prose
  (`<p>`/`<b>` tags as literal text on light mid; ` ,` space-before-comma on dark mid) →
  Sanitize once at the source: flatten Wikipedia inline HTML to text (or sanitized inline
  `<b>/<i>`) and collapse "removed-span + punctuation" so a stripped `<b>` leaves no leading
  space. One sanitization path feeds compact teaser, mid teaser, and full About prose.
  *(merges mid-html-leak + mid-dark-comma-artifact + a11y-teaser-clamp-reachability render half)*

- [ ] **[M]** Photoless species render a flat family-color block at every slot →
  Render the family silhouette glyph centered on the family-color ground, tinted to contrast
  per theme, at all three slots (44px thumb / 120px plate / masthead). One fallback component
  sized by the slot so compact/mid/full stay consistent.
  *(cross-detent-photoless-block)*

- [ ] **[M]** Family-color dot is the only encoding of family identity and can drop below 3:1
  (light family hue on cream, any hue on navy) → 1.4.11. Keep the family-name **text**
  co-located with the dot as the canonical signal (already true on the sheet — preserve it),
  and add a 1px contrasting ring (`rgba` border) on the dot at every detent so its boundary is
  perceivable regardless of hue/theme. Audit the full family palette against `#fff` and the
  navy surface at 3:1, not just cardinal-red.
  *(merges a11y-family-color-only-signal + a11y-family-dot-nontext-contrast + family-dot-size-align border half)*

- [ ] **[L]** Family dot is small and sits below the cap-height of the 13px family text →
  Standardize the dot at 8px diameter in a flex row with `align-items:center` and `--space-xs`
  (4–6px) gap (not inline baseline). Identical dot geometry at compact/mid/full.
  *(family-dot-size-align)*

---

## COMPACT

- [ ] **[L]** 44px thumb renders square; text block sits optically high against it →
  Round the thumb to `--card-radius-inner` (8px) to match the plate/family shape language;
  center the two-line text block to the thumb with `align-items:center`. Thumb stays 44px
  (touch-target + identity-row spec).
  *(compact-thumb-radius-center)*

- [ ] **[L]** Common name (17px) and family line sit with near-zero gap; family competes for
  emphasis → Add 2px between name and family; set family line to `--color-text-muted` (#555)
  at `--type-sm` (13). Keep name at `--type-md` (17) / 600.
  *(compact-name-family-rhythm)*

---

## MID

- [ ] **[H]** "Read account" expand control is distinguished by cardinal-red color alone, has
  no button affordance, fails 1.4.1, and (dark) the red fails AA contrast on navy → Render it
  as a real `<button aria-expanded aria-controls="account-body">` with a **persistent underline**
  (`text-decoration: underline`), labeled "Read account", colored with `--color-text-link`
  (= `--color-decision-point`: orange on light, cyan on dark — both theme-tuned). Do NOT mark
  interactivity with the per-family accent. Reflect clamp state in `aria-expanded`; on expand,
  move focus into / reveal the full account so truncated content is keyboard- & AT-reachable.
  *(merges a11y-read-account-link-color-only + a11y-read-account-dark-contrast + a11y-teaser-clamp-reachability + dark-mid-accent-balance link half)*

- [ ] **[H]** Two-cell record strip ("FAMILY · EBIRD TAXONOMIC ORDER") is built as visual-only
  cells → no programmatic label/value tie (1.3.1) → Build as a real `<dl>` with `<dt>`/`<dd>`
  pairs (name/value data, not cross-reference). CSS `text-transform:uppercase` on the label is
  fine; keep source text normal-case so AT doesn't spell it out.
  *(a11y-taxonomy-table-semantics, mid half)*

- [ ] **[M]** "Read account" chevron points up while collapsed (up = collapse, but tapping
  expands) → Use a down-chevron (⌄) in the collapsed/teaser state to mean "expand"; reserve the
  up-chevron for a collapse affordance if one exists at full. (Matches §3A spec glyph.)
  *(mid-readaccount-chevron)*

- [ ] **[M]** 120px plate has a large empty gutter before the name stack; 17px name reads
  under-scaled against plate mass; stack is top-aligned → Set plate→text gap to `--space-md`
  (12px); bump the name to `--type-lg` (22px) / 600 to match plate mass (per §3A locked spec);
  vertically center the name/sci/family stack against the plate.
  *(mid-plate-name-gap — option b only; option a "drop plate to 96px" dropped, conflicts with §3A 120px + type-lg)*

- [ ] **[M]** Name / sci-name / family read as one undifferentiated block →
  Add 2px `margin-top` to the sci-name and `--space-xs` (4px) above the family line;
  name line-height ~1.15, sci-name ~1.2.
  *(mid-sci-name-spacing)*

- [ ] **[M]** 3px accent rule runs full sheet width and stacks ~12px above the record strip's
  own top border → two heavy stacked dividers → De-double: either inset the accent rule to start
  at plate-right + 12px (reads as a name underline) OR keep full-width and remove/lighten the
  record-strip top border. Then tighten accent-rule→strip gap to `--space-sm` (8px). In dark,
  optionally drop the accent rule to 2px against the lifted navy surface.
  *(merges accent-rule-fullbleed + dark-mid-accent-balance rule-weight half)*

- [ ] **[M]** Record strip reads as a heavy table: tall padding, hard center divider, large
  label→value gap → Tighten cells to `--space-sm` (8px) vertical / `--space-md` (12px)
  horizontal; label→value gap 2px; replace the 1px center rule with a 12px inter-cell gap.
  Labels `--type-xs` (11) caps muted; values `--type-sm` (13) / 500.
  *(mid-record-strip-density)*

- [ ] **[M]** Expand control + chevron hit area ~13–17px, below the 24×24 WCAG 2.5.8 floor →
  Give the control a padded block hit area ≥44×44px (min-height + vertical padding, or wrap
  text+chevron in a block-level button spanning the teaser width). Ensure padding doesn't
  overlap the record strip. (Plate/thumb already meet target.)
  *(a11y-touch-target-read-account)*

- [ ] **[L]** Record-strip labels at `--type-xs` (11) uppercase: confirm contrast in both
  themes; dark muted-gray on navy must be re-verified → Confirm every label token ≥4.5:1 at
  11px in light AND dark; consider `--type-sm` (13) or heavier weight for low-vision legibility.
  Ensure values use the strong-contrast text token, not muted.
  *(a11y-record-strip-label-contrast)*

---

## FULL

- [ ] **[H]** 3-row TAXONOMY block built as divs → six unlinked fragments for AT (1.3.1) →
  Build as a real `<dl>` with `<dt>`/`<dd>` pairs. CSS uppercasing of labels is fine; keep
  source text normal-case.
  *(a11y-taxonomy-table-semantics, full half)*

- [ ] **[H]** Hero species name shows a stray rectangular focus/outline box (reads as a
  selection box; off-brand; low-contrast blue on navy) on a non-interactive heading →
  Remove the outline/box from the name element. If the sheet moves focus on open for AT context,
  put it on the dialog container (or a visually-hidden heading) and use `:focus-visible`, not
  `:focus`, so pointer/programmatic focus paints no ring on the title. Define a tokenized focus
  ring (2px solid + 2px offset, neutral high-contrast color ≥3:1 on BOTH cream and navy — not
  the variable family accent).
  *(merges full-name-focus-artifact + a11y-focus-visibility-accent)*

- [ ] **[M]** TAXONOMY rows have inconsistent heights and an arbitrary label-column width →
  Fixed label-column width (~38% / ~120px); top-align label and value per row
  (`align-items:start`); uniform `--space-sm` (8px) vertical padding per row. Labels
  `--type-xs` (11) caps muted; values `--type-sm` (13) / 500. Clean key/value grid.
  *(full-taxonomy-table-align)*

- [ ] **[M]** Heading outline: promoting the species name to a global `h1` collides with the
  map's "Bird Maps - Arizona" identity → two h1s / broken outline (2.4.6) → Scope headings to
  the dialog: species name = highest heading **inside** the dialog (h2 if map identity is h1),
  "About" the next level (h3); mark "ABOUT" as a real heading element, not a styled `<span>`.
  Give the sheet `role="dialog"` + `aria-labelledby` pointing at the species-name heading.
  *(a11y-heading-order)*

- [ ] **[M]** Masthead photo / 120px plate / 44px thumb alt text unspecified → either redundant
  with the adjacent name or discards plumage info; risks triple-announce → Give the image
  informative, non-redundant alt where metadata exists (e.g. "Male northern cardinal perched
  on a branch"); fall back to `alt=""` (decorative) when the name already precedes it and no
  descriptive metadata exists. Only one instance shows per detent, so decide per-detent and keep
  it consistent. Put photographer/source credit in visible text, not only in alt.
  *(a11y-masthead-alt-text)*

- [ ] **[L]** Masthead crops the subject low with empty branch up top and no seam treatment
  where the name meets the photo → Add a bottom-edge gradient scrim (transparent → ~12% black
  over the lower ~64px); set `object-position: center 35%` to lift the subject. Keep the
  `min(62.5vw,300px)` masthead height; verify the name clears it by `--space-md` (12px).
  *(full-masthead-crop)*

- [ ] **[L]** "ABOUT" eyebrow has equal space above/below → doesn't bond to the prose it heads
  → Increase space above to `--space-lg` (16px), reduce below to `--space-xs` (4px). Eyebrow
  `--type-xs` (11) caps, letter-spacing 0.06em, `--color-text-muted`.
  *(full-about-eyebrow-rhythm)*

- [ ] **[L]** "From Wikipedia, CC BY-SA" credit blends into the last prose line; license
  attribution must read as separate and be programmatically tied to its prose (1.3.1) →
  Set the credit on its own line, `--type-xs` (11), at a token clearing 4.5:1 in both themes,
  with `--space-sm` (8px) top margin; keep it inside the scrollable About block, associated with
  the prose by same-section proximity (or `aria-describedby`). Keep the CC BY-SA / Wikipedia
  link keyboard-focusable with the same underline + contrast treatment as other links.
  *(merges full-credit-placement + a11y-eyebrow-decorative-eom)*

---

## Dropped (conflict with locked direction or tokens, or pure dup)

- `mid-plate-name-gap` **option (a)** "drop plate to ~96px" — conflicts with §3A's locked 120px
  plate + `--type-lg` name; kept option (b) only.
- `mid-readaccount-chevron` clause "keep it in cardinal accent" — conflicts with the a11y
  contrast finding and `--color-text-link`; resolved toward the link token (orange/cyan).
- `full-credit-placement` `--color-text-subtle` (#5c5c5c) suggestion — superseded by the a11y
  requirement that license text clears 4.5:1 in both themes; use a confirmed-AA token instead.
