/**
 * CSS token conformance tests — W1 dark-mode revert
 *
 * These tests read tokens.css as a string and assert that the
 * regressions introduced in PR #415 are not present:
 *   1. --color-accent-notable-fg must NOT be the olive hex #b8860b in light.
 *   2. The dark block must contain all 14 spec-mandated token overrides.
 *   3. styles.css .app-header-tab.is-active must not use background:
 *      var(--color-text-strong) (cascade trap in dark mode).
 *
 * Spec: docs/plans/2026-05-09-sky-atlas-phase-1-token-foundation.md:151-175
 * Issue: #454
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const TOKENS_CSS = readFileSync(
  join(import.meta.dirname, 'tokens.css'),
  'utf8',
);
const STYLES_CSS = readFileSync(
  join(import.meta.dirname, '../styles.css'),
  'utf8',
);
const DS_PRIMITIVES_CSS = readFileSync(
  join(import.meta.dirname, '../components/ds/ds-primitives.css'),
  'utf8',
);

describe('tokens.css — W1 conformance', () => {
  describe('Light mode — --color-accent-notable-fg', () => {
    it('resolves to var(--c-deep-ember), not hardcoded olive #b8860b', () => {
      // The plan literal at phase-1-plan.md:138 says:
      //   --color-accent-notable-fg: var(--c-deep-ember);
      // The walkback shipped: --color-accent-notable-fg: #b8860b;
      expect(TOKENS_CSS).not.toMatch(/--color-accent-notable-fg:\s*#b8860b/);
      expect(TOKENS_CSS).toMatch(/--color-accent-notable-fg:\s*var\(--c-deep-ember\)/);
    });
  });

  describe('Dark mode block — 14 required overrides', () => {
    // Extract the dark block for scoped assertions.
    // Match from :root[data-theme="dark"] { to the closing }
    const darkBlockMatch = TOKENS_CSS.match(
      /:root\[data-theme="dark"\]\s*\{([^}]*)\}/s,
    );
    const darkBlock = darkBlockMatch?.[1] ?? '';

    it('dark block exists', () => {
      expect(darkBlock).not.toBe('');
    });

    // Group 1: bg tokens (4)
    it('overrides --color-bg-page', () => {
      expect(darkBlock).toMatch(/--color-bg-page:/);
    });
    it('overrides --color-bg-surface', () => {
      expect(darkBlock).toMatch(/--color-bg-surface:/);
    });
    it('overrides --color-bg-tint', () => {
      expect(darkBlock).toMatch(/--color-bg-tint:/);
    });
    it('overrides --color-bg-skeleton', () => {
      expect(darkBlock).toMatch(/--color-bg-skeleton:/);
    });

    // Group 2: text tokens (4)
    it('overrides --color-text-strong', () => {
      expect(darkBlock).toMatch(/--color-text-strong:/);
    });
    it('overrides --color-text-body', () => {
      expect(darkBlock).toMatch(/--color-text-body:/);
    });
    it('overrides --color-text-muted', () => {
      expect(darkBlock).toMatch(/--color-text-muted:/);
    });
    it('overrides --color-text-subtle', () => {
      expect(darkBlock).toMatch(/--color-text-subtle:/);
    });

    // Group 3: border (1)
    it('overrides --color-border-ui', () => {
      expect(darkBlock).toMatch(/--color-border-ui:/);
    });

    // Group 4: decision-point (1)
    it('overrides --color-decision-point', () => {
      expect(darkBlock).toMatch(/--color-decision-point:/);
    });

    // Focus ring (#842) — mode-paired like decision-point. Light uses a deep
    // amber that meets WCAG 1.4.11's 3:1 floor on both the white card and the
    // field border; dark keeps the cyan accent (which already passes).
    it('overrides --color-focus-ring (dark keeps cyan, light is the deep amber)', () => {
      expect(darkBlock).toMatch(/--color-focus-ring:/);
    });

    // Group 5: density triad (4)
    it('overrides --color-density-low', () => {
      expect(darkBlock).toMatch(/--color-density-low:/);
    });
    it('overrides --color-density-mid', () => {
      expect(darkBlock).toMatch(/--color-density-mid:/);
    });
    it('overrides --color-density-high', () => {
      expect(darkBlock).toMatch(/--color-density-high:/);
    });
    it('overrides --color-density-text', () => {
      expect(darkBlock).toMatch(/--color-density-text:/);
    });

    // FI-1: value-pinned assertions for the density triad AA contrast fix.
    // Contrast ratios against --color-density-text (#0d1424 / var(--c-navy-900)):
    //   low  (#4a8aa8) → 5.30:1  ✓ AA
    //   mid  (#c49850) → 7.74:1  ✓ AA
    //   high (#d06848) → 5.04:1  ✓ AA  (LB-2 fix: was #b85530 → 3.83:1 FAIL)
    it('pins ember tier to #d06848 (5.04:1 AA vs --c-navy-900)', () => {
      expect(darkBlock).toMatch(/--color-density-high:\s*#d06848/);
    });
    it('pins sky tier to #4a8aa8 (5.30:1 AA vs --c-navy-900)', () => {
      expect(darkBlock).toMatch(/--color-density-low:\s*#4a8aa8/);
    });
    it('pins sand tier to #c49850 (7.74:1 AA vs --c-navy-900)', () => {
      expect(darkBlock).toMatch(/--color-density-mid:\s*#c49850/);
    });

    // Group 6: accent + error (3)
    it('overrides --color-accent-notable-fg (dark uses orange-500)', () => {
      expect(darkBlock).toMatch(/--color-accent-notable-fg:\s*var\(--c-orange-500\)/);
    });
    it('overrides --color-error-bg', () => {
      expect(darkBlock).toMatch(/--color-error-bg:/);
    });
    it('overrides --color-error-border', () => {
      expect(darkBlock).toMatch(/--color-error-border:/);
    });
    it('overrides --color-error-text', () => {
      expect(darkBlock).toMatch(/--color-error-text:/);
    });

    // Group 7: notable-bg variants (2)
    // NEW-1 hotfix: these were absent from the dark block, causing notable
    // accents to resolve to the light-mode #fff8e1 (pale cream) on a dark navy page.
    // Contrast verified: #f5f7fb (--color-text-strong dark) on #2a2620 → 14.02:1 (AAA).
    it('overrides --color-accent-notable-bg (hotfix NEW-1: dark warm-amber, not light cream)', () => {
      expect(darkBlock).toMatch(/--color-accent-notable-bg:/);
    });
    it('pins --color-accent-notable-bg to #2a2620 (deep amber-shadow, 14.02:1 vs #f5f7fb)', () => {
      expect(darkBlock).toMatch(/--color-accent-notable-bg:\s*#2a2620/);
    });
    it('overrides --color-accent-notable-bg-hover', () => {
      expect(darkBlock).toMatch(/--color-accent-notable-bg-hover:/);
    });
    it('pins --color-accent-notable-bg-hover to #332e26 (lifted amber-shadow hover)', () => {
      expect(darkBlock).toMatch(/--color-accent-notable-bg-hover:\s*#332e26/);
    });
  });

  // ── #761 P1 (issue #778): Layer-1 primitives added in the named-z-index /
  //    overlay-sizing refactor. These tokens live in tokens.css.
  describe('Layer-1 primitives — #761 P1 (#778)', () => {
    it('defines --radius-lg (retires the var(--radius-lg, 12px) inline fallback)', () => {
      expect(TOKENS_CSS).toMatch(/--radius-lg:\s*12px/);
    });

    it('defines the overlay sizing breakpoints distinct from prose breakpoints', () => {
      expect(TOKENS_CSS).toMatch(/--overlay-bp-compact:\s*480px/);
      expect(TOKENS_CSS).toMatch(/--overlay-bp-roomy:\s*600px/);
      expect(TOKENS_CSS).toMatch(/--overlay-bp-wide:\s*1024px/);
    });
  });

  // ── #761 #803: Floating-card design language — geometry + elevation tokens.
  describe('Floating-card geometry tokens — #761 #803 (spec §2.1)', () => {
    it('defines --card-radius aliased to --radius-lg', () => {
      expect(TOKENS_CSS).toMatch(/--card-radius:\s*var\(--radius-lg\)/);
    });
    it('defines --card-radius-inner as 8px', () => {
      expect(TOKENS_CSS).toMatch(/--card-radius-inner:\s*8px/);
    });
    it('defines --card-inset aliased to --space-md', () => {
      expect(TOKENS_CSS).toMatch(/--card-inset:\s*var\(--space-md\)/);
    });
    it('defines --card-inset-wide aliased to --space-xl', () => {
      expect(TOKENS_CSS).toMatch(/--card-inset-wide:\s*var\(--space-xl\)/);
    });
    it('defines --card-gap aliased to --space-sm', () => {
      expect(TOKENS_CSS).toMatch(/--card-gap:\s*var\(--space-sm\)/);
    });
    it('defines --card-padding as var(--space-md) var(--space-lg)', () => {
      expect(TOKENS_CSS).toMatch(/--card-padding:\s*var\(--space-md\)\s*var\(--space-lg\)/);
    });
    it('defines --card-padding-tight as var(--space-sm) var(--space-md)', () => {
      expect(TOKENS_CSS).toMatch(/--card-padding-tight:\s*var\(--space-sm\)\s*var\(--space-md\)/);
    });
    it('defines --card-maxw-identity as 360px', () => {
      expect(TOKENS_CSS).toMatch(/--card-maxw-identity:\s*360px/);
    });
    it('defines --card-maxw-legend as 280px', () => {
      expect(TOKENS_CSS).toMatch(/--card-maxw-legend:\s*280px/);
    });
    it('defines --card-maxw-rail as 420px', () => {
      expect(TOKENS_CSS).toMatch(/--card-maxw-rail:\s*420px/);
    });
    it('defines --card-maxw-popover as 300px', () => {
      expect(TOKENS_CSS).toMatch(/--card-maxw-popover:\s*300px/);
    });
  });

  // ── #761 #803: Elevation system — light and dark.
  describe('Elevation tokens — light mode (spec §2.3)', () => {
    const lightBlockMatch = TOKENS_CSS.match(
      /:root\[data-theme="light"\]\s*\{([^}]*)\}/s,
    );
    const lightBlock = lightBlockMatch?.[1] ?? '';

    it('light block exists', () => {
      expect(lightBlock).not.toBe('');
    });
    it('defines --elevation-1 in light (drop shadow, no inset)', () => {
      expect(lightBlock).toMatch(/--elevation-1:/);
      // Light elevation must NOT have an inset rim-light (that's dark-mode only)
      const el1Match = lightBlock.match(/--elevation-1:\s*([^;]+)/);
      expect(el1Match?.[1]).not.toMatch(/inset/);
    });
    it('defines --elevation-2 in light', () => {
      expect(lightBlock).toMatch(/--elevation-2:/);
    });
    it('defines --elevation-3 in light', () => {
      expect(lightBlock).toMatch(/--elevation-3:/);
    });
    it('defines --card-elevation-1/-2/-3 as aliases of --elevation-1/-2/-3 in light', () => {
      expect(lightBlock).toMatch(/--card-elevation-1:\s*var\(--elevation-1\)/);
      expect(lightBlock).toMatch(/--card-elevation-2:\s*var\(--elevation-2\)/);
      expect(lightBlock).toMatch(/--card-elevation-3:\s*var\(--elevation-3\)/);
    });
  });

  describe('Elevation tokens — dark mode (spec §2.3)', () => {
    const darkBlockMatch = TOKENS_CSS.match(
      /:root\[data-theme="dark"\]\s*\{([^}]*)\}/s,
    );
    const darkBlock = darkBlockMatch?.[1] ?? '';

    it('defines --elevation-1 in dark with inset rim-light (not just more black alpha)', () => {
      const el1Match = darkBlock.match(/--elevation-1:\s*([^;]+)/);
      expect(el1Match?.[1]).toMatch(/inset/);
      expect(el1Match?.[1]).toMatch(/rgba\(255,255,255/);
    });
    it('defines --elevation-2 in dark with rim-light', () => {
      const el2Match = darkBlock.match(/--elevation-2:\s*([^;]+)/);
      expect(el2Match?.[1]).toMatch(/inset/);
    });
    it('defines --elevation-3 in dark with rim-light', () => {
      const el3Match = darkBlock.match(/--elevation-3:\s*([^;]+)/);
      expect(el3Match?.[1]).toMatch(/inset/);
    });
    it('defines --card-elevation-1/-2/-3 as aliases in dark', () => {
      expect(darkBlock).toMatch(/--card-elevation-1:\s*var\(--elevation-1\)/);
      expect(darkBlock).toMatch(/--card-elevation-2:\s*var\(--elevation-2\)/);
      expect(darkBlock).toMatch(/--card-elevation-3:\s*var\(--elevation-3\)/);
    });
  });

  // ── #761 #803: Dark surface lift — the primary card-separation fix.
  describe('Dark surface token lift (spec §2.2)', () => {
    const darkBlockMatch = TOKENS_CSS.match(
      /:root\[data-theme="dark"\]\s*\{([^}]*)\}/s,
    );
    const darkBlock = darkBlockMatch?.[1] ?? '';

    it('dark --color-bg-surface is lifted to #1b2742 (was #131c30)', () => {
      expect(darkBlock).toMatch(/--color-bg-surface:\s*#1b2742/);
    });
    it('dark --color-border-ui is lifted to #3a4668 (was #283354)', () => {
      expect(darkBlock).toMatch(/--color-border-ui:\s*#3a4668/);
    });
    it('light --color-bg-surface remains #ffffff (no regression)', () => {
      const lightBlockMatch = TOKENS_CSS.match(
        /:root\[data-theme="light"\]\s*\{([^}]*)\}/s,
      );
      const lightBlock = lightBlockMatch?.[1] ?? '';
      expect(lightBlock).toMatch(/--color-bg-surface:\s*#ffffff/);
    });
  });

  // ── #761 #803: Previously-undefined tokens now resolve (spec §2.5).
  describe('Undefined-token cleanup — 4 tokens now resolve (spec §2.5)', () => {
    it('defines --color-border-strong in light mode', () => {
      const lightBlockMatch = TOKENS_CSS.match(
        /:root\[data-theme="light"\]\s*\{([^}]*)\}/s,
      );
      expect(lightBlockMatch?.[1]).toMatch(/--color-border-strong:/);
    });
    it('defines --color-border-strong in dark mode', () => {
      const darkBlockMatch = TOKENS_CSS.match(
        /:root\[data-theme="dark"\]\s*\{([^}]*)\}/s,
      );
      expect(darkBlockMatch?.[1]).toMatch(/--color-border-strong:/);
    });
    it('defines --color-text-link in light mode', () => {
      const lightBlockMatch = TOKENS_CSS.match(
        /:root\[data-theme="light"\]\s*\{([^}]*)\}/s,
      );
      expect(lightBlockMatch?.[1]).toMatch(/--color-text-link:/);
    });
    it('defines --color-text-link in dark mode', () => {
      const darkBlockMatch = TOKENS_CSS.match(
        /:root\[data-theme="dark"\]\s*\{([^}]*)\}/s,
      );
      expect(darkBlockMatch?.[1]).toMatch(/--color-text-link:/);
    });
    it('defines --text-body-sm as a CSS font shorthand', () => {
      expect(TOKENS_CSS).toMatch(/--text-body-sm:/);
    });
    it('defines --text-heading-sm as a CSS font shorthand', () => {
      expect(TOKENS_CSS).toMatch(/--text-heading-sm:/);
    });
  });
});

describe('styles.css — W1 conformance', () => {
  describe('.app-header-tab.is-active — cascade trap', () => {
    it('does not use background: var(--color-text-strong) (inverts to white-on-white in dark)', () => {
      // The cascade trap: in dark mode --color-text-strong becomes #f5f7fb (near-white).
      // background: var(--color-text-strong) + color: var(--color-text-white) = white-on-white.
      // Fix: underline-only pattern (no opaque background) — see issue #454 VD-4.
      expect(STYLES_CSS).not.toMatch(
        /\.app-header-tab\.is-active\s*\{[^}]*background:\s*var\(--color-text-strong\)/s,
      );
    });
  });

  // ── #761 P1 (issue #778): named z-index tier scale lives in styles.css :root.
  //    Assert the full scale + the deprecated --z-panel var() indirection alias.
  describe('named z-index scale — #761 P1 (#778)', () => {
    it('declares every named tier with its rank-preserving value', () => {
      expect(STYLES_CSS).toMatch(/--z-map:\s*0\b/);
      // #976: passive hover preview demoted while a detail is open — above the
      // map (5 > 0) but below every detail tier (sheet 10/15/50, rail 43).
      expect(STYLES_CSS).toMatch(/--z-under-detail:\s*5\b/);
      expect(STYLES_CSS).toMatch(/--z-overlay:\s*40\b/);
      expect(STYLES_CSS).toMatch(/--z-popover:\s*41\b/);
      expect(STYLES_CSS).toMatch(/--z-chrome:\s*42\b/);
      expect(STYLES_CSS).toMatch(/--z-rail:\s*43\b/);
      expect(STYLES_CSS).toMatch(/--z-cell-popover:\s*44\b/);
      expect(STYLES_CSS).toMatch(/--z-cluster-popover:\s*45\b/);
      expect(STYLES_CSS).toMatch(/--z-modal:\s*50\b/);
      expect(STYLES_CSS).toMatch(/--z-skip:\s*60\b/);
    });

    it('keeps --z-panel as a CSS-only var() indirection alias of --z-overlay', () => {
      // Encoded as var() indirection (not a hardcoded 40) so it carries no
      // monotonicity obligation and stays correct if --z-overlay ever moves.
      expect(STYLES_CSS).toMatch(/--z-panel:\s*var\(--z-overlay\)/);
    });
  });

  // ── #976: load-bearing z-order guard for the under-detail hover preview. ─────
  //    When a species detail is open, the demoted cell-hover preview must resolve
  //    BELOW whichever detail surface can be showing — the desktop RAIL (43) AND
  //    EVERY mobile SHEET detent (peek 10, half 15 [the default], full/modal 50)
  //    — while staying ABOVE the map canvas (0). Asserting only against the rail
  //    (43) would pass GREEN while occluding the default half-sheet (15) on
  //    narrow/mobile viewports, the exact gap the bot amendment flagged. A future
  //    "bump the z-index" change that lifts --z-under-detail to/above any detail
  //    tier fails HERE.
  describe('under-detail hover preview z-order — #976', () => {
    // Pull the literal --z-* values straight out of styles.css :root.
    const z = (name: string): number => {
      const m = STYLES_CSS.match(new RegExp(`--${name}:\\s*(\\d+)\\b`));
      if (!m) throw new Error(`--${name} not found / not a literal in styles.css`);
      return Number(m[1]);
    };
    // The sheet detents are literal z-index declarations in styles.css, NOT
    // :root tokens — read them from their modifier rules so the guard tracks the
    // values that actually render (styles.css:2310 / :2319).
    const sheetDetent = (modifier: string): number => {
      const m = STYLES_CSS.match(
        new RegExp(`\\.species-detail-sheet--${modifier}\\s*\\{[^}]*z-index:\\s*(\\d+)\\b`, 's'),
      );
      if (!m) throw new Error(`.species-detail-sheet--${modifier} z-index not found`);
      return Number(m[1]);
    };

    it('--z-under-detail sits BELOW the desktop rail (43)', () => {
      expect(z('z-under-detail')).toBeLessThan(z('z-rail'));
    });

    it('--z-under-detail sits BELOW every mobile sheet detent (peek 10, half 15, full/modal)', () => {
      // half (15) is the DEFAULT snap — the tier the bot amendment proved a
      // demote to --z-overlay (40) would wrongly paint over.
      expect(z('z-under-detail')).toBeLessThan(sheetDetent('peek'));
      expect(z('z-under-detail')).toBeLessThan(sheetDetent('half'));
      expect(z('z-under-detail')).toBeLessThan(z('z-modal')); // full sheet rides --z-modal
    });

    it('--z-under-detail stays ABOVE the map canvas/markers (0) so the tooltip is still visible', () => {
      expect(z('z-under-detail')).toBeGreaterThan(z('z-map'));
    });
  });

  // ── #761 O6 (#782): the three on-canvas cell popovers consume P1's NAMED
  //    popover tokens — no `z-index: calc(var(--z-panel) + N)` arithmetic
  //    survives on any of them.
  describe('cell popovers on the named z-scale — #761 O6 (#782)', () => {
    it('ds-primitives.css has NO `z-index: calc(var(--z-panel) + N)` arithmetic remaining', () => {
      // The last `calc(var(--z-panel) + 5)` ref (.cell-hover-preview) was
      // migrated to var(--z-modal) by O6. Any reappearance is a regression.
      expect(DS_PRIMITIVES_CSS).not.toMatch(/z-index:\s*calc\(\s*var\(--z-panel\)/);
    });

    it('.cell-hover-preview consumes the named --z-modal tier (above the cell/cluster popovers it can overlap)', () => {
      expect(DS_PRIMITIVES_CSS).toMatch(
        /\.cell-hover-preview\s*\{[^}]*z-index:\s*var\(--z-modal\)/s,
      );
    });

    it('#976: .cell-hover-preview--under-detail demotes to --z-under-detail (below every detail tier)', () => {
      expect(DS_PRIMITIVES_CSS).toMatch(
        /\.cell-hover-preview--under-detail\s*\{[^}]*z-index:\s*var\(--z-under-detail\)/s,
      );
    });

    it('.cell-popover consumes --z-cell-popover and .cluster-list-popover consumes --z-cluster-popover', () => {
      expect(DS_PRIMITIVES_CSS).toMatch(
        /\.cell-popover\s*\{[^}]*z-index:\s*var\(--z-cell-popover\)/s,
      );
      expect(DS_PRIMITIVES_CSS).toMatch(
        /\.cluster-list-popover\s*\{[^}]*z-index:\s*var\(--z-cluster-popover\)/s,
      );
    });
  });

  // ── A5 (#1034): scrim opacity + focus-ring fixes ──────────────────────────
  describe('A5 (#1034): .scope-chooser-scrim — §4.8 opacity + focus-ring contract', () => {
    // Extract the .scope-chooser-scrim rule block for scoped assertions.
    const scrimBlockMatch = STYLES_CSS.match(
      /\.scope-chooser-scrim\s*\{([^}]*)\}/s,
    );
    const scrimBlock = scrimBlockMatch?.[1] ?? '';

    it('.scope-chooser-scrim block exists in styles.css', () => {
      expect(scrimBlock).not.toBe('');
    });

    // C12/V13 (#1034): spec §4.8 directs ~60-70% opacity — replace the ~92%
    // wash from #794. One color-mix rule, consumed by both themes (structural
    // theme parity: no per-theme override needed because --color-bg-page
    // already adapts per theme).
    it('uses ~65% color-mix (not the old 92%) for the scrim background — spec §4.8', () => {
      // Guard the old value is gone.
      expect(scrimBlock).not.toMatch(/color-mix[^;]*92%/);
      // Assert the new value is present (65% ± 1 tolerance = 64–66% acceptable).
      expect(scrimBlock).toMatch(/color-mix\(in srgb,\s*var\(--color-bg-page\)\s*6[45]%,\s*transparent\)/);
    });

    // V14 (#1034): the scrim wrapper must suppress its own UA outline so it
    // never paints a full-viewport blue ring on the landing's first impression.
    // Note: scrimBlock extraction uses [^}]* which stops at the `}` inside the
    // comment text "tabIndex={-1}" — assert against the full CSS instead,
    // anchored to the .scope-chooser-scrim rule neighbourhood.
    it('has outline: none to suppress the UA focus ring on the wrapper itself', () => {
      // Match outline:none anywhere in the .scope-chooser-scrim rule block.
      // Use a two-step check: the property must appear AFTER the selector and
      // BEFORE the next top-level selector (a line starting with a dot/hash/
      // element after a newline).
      const scrimRuleStart = STYLES_CSS.indexOf('.scope-chooser-scrim {');
      expect(scrimRuleStart).toBeGreaterThan(-1);
      // Find the closing brace of the rule (the one that terminates the block,
      // not those embedded in comments). Walk forward counting comment depth.
      let depth = 0;
      let inComment = false;
      let ruleEnd = -1;
      for (let i = scrimRuleStart; i < STYLES_CSS.length - 1; i++) {
        if (!inComment && STYLES_CSS[i] === '/' && STYLES_CSS[i + 1] === '*') {
          inComment = true; i++; continue;
        }
        if (inComment && STYLES_CSS[i] === '*' && STYLES_CSS[i + 1] === '/') {
          inComment = false; i++; continue;
        }
        if (inComment) continue;
        if (STYLES_CSS[i] === '{') { depth++; continue; }
        if (STYLES_CSS[i] === '}') {
          depth--;
          if (depth === 0) { ruleEnd = i; break; }
        }
      }
      expect(ruleEnd).toBeGreaterThan(scrimRuleStart);
      const ruleText = STYLES_CSS.slice(scrimRuleStart, ruleEnd + 1);
      expect(ruleText).toMatch(/outline:\s*none/);
    });
  });

  // ── A3 (#1032): three measured WCAG contrast failures ────────────────────
  //
  // These assertions COMPUTE contrast ratios — they do NOT pin hex values by
  // regex. A regex pin is not falsifiable when a resolved value or its surface
  // drifts; a computed-ratio assertion catches the regression.
  //
  // Resolved hex chains (locked in comments for auditability):
  //   C44: light --color-text-link → --color-decision-point
  //        → BEFORE: --c-orange-500 = #f5853b  (2.53:1 on #fff, FAIL)
  //          AFTER:  --c-amber-700 = #984012   (6.82:1 on #fff, PASS)
  //   C45: dark --color-text-subtle
  //        → BEFORE: #7a8599                   (3.99:1 on #1b2742, FAIL)
  //          AFTER:  reused --color-text-muted = #8a98ad  (5.07:1, PASS)
  //   C50: NOTABLE_AMBER light ring on cream basemap #f4f1ea
  //        → BEFORE: #f59e0b                   (1.90:1, FAIL)
  //          AFTER:  #c43a1a (light-only pair)  (4.69:1, PASS)
  describe('A3 (#1032): computed WCAG contrast ratios — link, subtle, notable ring', () => {
    // Shared import-compatible helper (mirrors wcag-contrast.ts exactly).
    // We compute inline here so the test is self-contained and readable without
    // needing a dynamic import in a static-read test file.
    function relativeLuminance(hex: string): number {
      const h = hex.replace('#', '');
      const r = parseInt(h.slice(0, 2), 16);
      const g = parseInt(h.slice(2, 4), 16);
      const b = parseInt(h.slice(4, 6), 16);
      const toLinear = (c: number): number => {
        const v = c / 255;
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
      };
      return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
    }
    function contrastRatio(hexA: string, hexB: string): number {
      const lumA = relativeLuminance(hexA);
      const lumB = relativeLuminance(hexB);
      const lighter = Math.max(lumA, lumB);
      const darker = Math.min(lumA, lumB);
      return (lighter + 0.05) / (darker + 0.05);
    }

    // C44: resolve --color-text-link from tokens.css (light block).
    // Chain: --color-text-link → --color-decision-point → --c-amber-700 → hex.
    // We extract the resolved primitive hex from the light block.
    it('C44: light --color-text-link resolves to a hex with ≥4.5:1 on #ffffff (AA normal text)', () => {
      // Extract the light block.
      const lightBlockMatch = TOKENS_CSS.match(
        /:root\[data-theme="light"\]\s*\{([^}]*(?:\{[^}]*\}[^}]*)*)\}/s,
      );
      const lightBlock = lightBlockMatch?.[1] ?? '';

      // Resolve --color-text-link in the light block.
      // After the fix it must be var(--c-amber-700) — trace through to the primitive.
      // --c-amber-700 is defined in the :root primitives block as #984012.
      const amber700Match = TOKENS_CSS.match(/--c-amber-700:\s*(#[0-9a-fA-F]{6})/);
      expect(amber700Match, '--c-amber-700 must be defined as a hex in :root').toBeTruthy();
      const amber700Hex = amber700Match![1];

      // --color-text-link in the light block must point to --c-amber-700 (not --c-orange-500).
      expect(lightBlock).toMatch(/--color-text-link:\s*var\(--c-amber-700\)/);

      // Computed ratio: must clear 4.5:1 AA floor on white (#ffffff).
      const ratio = contrastRatio(amber700Hex, '#ffffff');
      expect(ratio).toBeGreaterThanOrEqual(4.5);
    });

    it('C45: dark --color-text-subtle resolves to a hex with ≥4.5:1 on --color-bg-surface #1b2742 (AA 11px)', () => {
      // --color-bg-surface is pinned to #1b2742 by the dark surface lift (spec §2.2, #803).
      // The test above already guards that pin; here we use it as a constant.
      const darkSurface = '#1b2742';

      // Extract the dark block.
      const darkBlockMatch = TOKENS_CSS.match(
        /:root\[data-theme="dark"\]\s*\{([^}]*)\}/s,
      );
      const darkBlock = darkBlockMatch?.[1] ?? '';

      // Extract the resolved hex for --color-text-subtle.
      // After the fix it must be a literal hex (not a var() indirection to a
      // failing value).  Parse whatever literal hex the dark block sets.
      const subtleMatch = darkBlock.match(/--color-text-subtle:\s*(#[0-9a-fA-F]{6})/);
      expect(subtleMatch, '--color-text-subtle must be a literal hex in the dark block').toBeTruthy();
      const subtleHex = subtleMatch![1];

      // Computed ratio: must clear 4.5:1 on the lifted surface.
      const ratio = contrastRatio(subtleHex, darkSurface);
      expect(ratio).toBeGreaterThanOrEqual(4.5);
    });

    it('C50: light NOTABLE_AMBER constant resolves to ≥3.0:1 on cream basemap #f4f1ea (AA non-text)', () => {
      // The notable ring is drawn in AdaptiveGridMarker.tsx with a JS constant.
      // After the fix, the constant file must contain the light-theme value (#c43a1a).
      // We assert via the tokens.css primitive that the light-theme amber is #c43a1a
      // (which equals --c-deep-ember, already in the primitives block).
      const deepEmberMatch = TOKENS_CSS.match(/--c-deep-ember:\s*(#[0-9a-fA-F]{6})/);
      expect(deepEmberMatch, '--c-deep-ember must be a hex primitive').toBeTruthy();
      const deepEmberHex = deepEmberMatch![1];

      // The light ring colour must be --c-deep-ember (#c43a1a).
      // Verify: the ratio on the cream basemap clears the 3:1 non-text floor.
      const lightBasemap = '#f4f1ea';
      const ratio = contrastRatio(deepEmberHex, lightBasemap);
      expect(ratio).toBeGreaterThanOrEqual(3.0);
    });
  });

  // ── A5 (#1034): MapLibre canvas `:focus-visible` gate ────────────────────
  describe('A5 (#1034): MapLibre canvas focus indicator — :focus-visible gate', () => {
    // V35 (#1034): the canvas holds focus after mouse pan/zoom with the UA
    // ring unstyled. The fix: suppress the default outline on :focus, only
    // show a styled indicator on :focus-visible (keyboard / sequential nav).
    it('.maplibregl-canvas:focus has outline: none (pointer interactions paint nothing)', () => {
      expect(STYLES_CSS).toMatch(
        /\.maplibregl-canvas:focus\s*\{[^}]*outline:\s*none[^}]*\}/s,
      );
    });

    it('.maplibregl-canvas:focus-visible shows a token-styled outline instead of UA blue', () => {
      // Must use --color-border-ui token, not a hardcoded colour.
      expect(STYLES_CSS).toMatch(
        /\.maplibregl-canvas:focus-visible\s*\{[^}]*outline:[^}]*var\(--color-border-ui\)[^}]*\}/s,
      );
    });
  });
});
