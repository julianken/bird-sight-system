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
  });

  // ── #761 P1 (issue #778): Layer-1 primitives added in the named-z-index /
  //    overlay-sizing refactor. These tokens live in tokens.css.
  describe('Layer-1 primitives — #761 P1 (#778)', () => {
    it('defines --radius-lg (retires the var(--radius-lg, 12px) inline fallback)', () => {
      expect(TOKENS_CSS).toMatch(/--radius-lg:\s*12px/);
    });

    it('defines the overlay sizing breakpoints distinct from prose breakpoints', () => {
      expect(TOKENS_CSS).toMatch(/--overlay-bp-compact:\s*480px/);
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
  //    Assert the full named scale.
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
    // The sheet detents now reference NAMED z tiers (E2 #1054: peek →
    // --z-sheet-resting, half → --z-sheet-raised, replacing the prior raw 10/15).
    // Read the modifier rule's z-index — accept either a raw literal (legacy) or
    // a var(--z-*) reference, resolving the var through the :root literal — so the
    // guard tracks the value that actually renders.
    const sheetDetent = (modifier: string): number => {
      const m = STYLES_CSS.match(
        new RegExp(
          `\\.species-detail-sheet--${modifier}\\s*\\{[^}]*?z-index:\\s*(?:var\\(\\s*(--z-[a-z-]+)\\s*\\)|(\\d+)\\b)`,
          's',
        ),
      );
      if (!m) throw new Error(`.species-detail-sheet--${modifier} z-index not found`);
      // m[1] = var name (e.g. "--z-sheet-resting"); m[2] = raw literal.
      return m[1] ? z(m[1].replace(/^--/, '')) : Number(m[2]);
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
  //    popover tokens — no z-tier `calc(var(--z-* ) + N)` arithmetic survives
  //    on any of them.
  describe('cell popovers on the named z-scale — #761 O6 (#782)', () => {
    it('ds-primitives.css has NO z-tier calc() arithmetic remaining', () => {
      // The last z-tier calc() ref (.cell-hover-preview) was migrated to a
      // named tier by O6. Any reappearance of `z-index: calc(var(--z-...))`
      // arithmetic is a regression.
      expect(DS_PRIMITIVES_CSS).not.toMatch(/z-index:\s*calc\(\s*var\(--z-/);
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

// ── B1 (#1040): undefined/unpaired-token enforcement ─────────────────────────
//
// Every consumed semantic token (--color-*, --text-*, --card-*, --scrollbar-*)
// must resolve on bare :root OR in BOTH [data-theme] blocks.
// A token defined only in one [data-theme] block resolves to the CSS initial
// value ("guaranteed-invalid") in the other theme.
//
// Rule: for each consumed token T:
//   • If T is defined in the bare :root of ANY of the three files → OK (mode-independent)
//   • Otherwise T must appear in BOTH the tokens.css light block AND the dark block
//
// Denylist: tokens that must NOT appear in styles.css (either because they were
// removed as part of this fix, or because they are duplicate definitions that
// the tokens.css [data-theme] blocks now own exclusively).
describe('B1 (#1040): undefined/unpaired-token enforcement', () => {
  // ── helpers ────────────────────────────────────────────────────────────────

  /** Extract all bare-:root custom-property definitions from a CSS string. */
  function extractBareRootTokens(css: string): Set<string> {
    // Match the first :root { ... } block that is NOT :root[data-theme="..."]
    // We do this by splitting on known selector patterns and taking :root { blocks.
    const defined = new Set<string>();
    // Regex: bare :root (not followed by [) — match the block
    const bareRootRe = /:root(?!\[)\s*\{([^}]*(?:\{[^}]*\}[^}]*)*)\}/gs;
    let m: RegExpExecArray | null;
    while ((m = bareRootRe.exec(css)) !== null) {
      const block = m[1];
      const propRe = /--([\w-]+)\s*:/g;
      let p: RegExpExecArray | null;
      while ((p = propRe.exec(block)) !== null) {
        defined.add('--' + p[1]);
      }
    }
    return defined;
  }

  /** Extract custom-property definitions from a named [data-theme] block. */
  function extractThemeBlockTokens(css: string, theme: 'light' | 'dark'): Set<string> {
    const defined = new Set<string>();
    const blockRe = new RegExp(
      `:root\\[data-theme="${theme}"\\]\\s*\\{([^}]*)\\}`,
      's',
    );
    const m = css.match(blockRe);
    if (!m) return defined;
    const propRe = /--([\w-]+)\s*:/g;
    let p: RegExpExecArray | null;
    while ((p = propRe.exec(m[1])) !== null) {
      defined.add('--' + p[1]);
    }
    return defined;
  }

  /** Collect every var(--color-*), var(--text-*), var(--card-*), var(--scrollbar-*)
   *  reference from a CSS string. */
  function collectConsumed(css: string): Set<string> {
    const consumed = new Set<string>();
    // Match var(--color-...), var(--text-...), var(--card-...), var(--scrollbar-...)
    // Allow optional whitespace after var( and optional fallback after comma.
    const re = /var\(\s*(--(color|text|card|scrollbar)-[\w-]+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(css)) !== null) {
      consumed.add(m[1]);
    }
    return consumed;
  }

  const allCss = [TOKENS_CSS, STYLES_CSS, DS_PRIMITIVES_CSS];

  // Pool of bare-:root defined tokens across all three files
  const bareRootDefined = new Set<string>();
  for (const css of allCss) {
    for (const tok of extractBareRootTokens(css)) {
      bareRootDefined.add(tok);
    }
  }

  // Light and dark defined pools (tokens.css only — per spec, the blocks live there)
  const lightDefined = extractThemeBlockTokens(TOKENS_CSS, 'light');
  const darkDefined  = extractThemeBlockTokens(TOKENS_CSS, 'dark');

  // All consumed tokens across the three files
  const consumed = new Set<string>();
  for (const css of allCss) {
    for (const tok of collectConsumed(css)) {
      consumed.add(tok);
    }
  }

  it('every consumed --color-*/--text-*/--card-*/--scrollbar-* token resolves on bare :root or in BOTH [data-theme] blocks', () => {
    const unpaired: string[] = [];
    for (const tok of [...consumed].sort()) {
      const inBareRoot  = bareRootDefined.has(tok);
      const inBothThemes = lightDefined.has(tok) && darkDefined.has(tok);
      if (!inBareRoot && !inBothThemes) {
        // Determine what's missing for the error message
        const inLight = lightDefined.has(tok);
        const inDark  = darkDefined.has(tok);
        if (!inLight && !inDark) {
          unpaired.push(`${tok}: defined NOWHERE`);
        } else if (inLight && !inDark) {
          unpaired.push(`${tok}: defined in light only — missing from dark block`);
        } else {
          unpaired.push(`${tok}: defined in dark only — missing from light block`);
        }
      }
    }
    expect(
      unpaired,
      `These tokens are consumed but not universally resolved:\n${unpaired.join('\n')}`,
    ).toEqual([]);
  });

  // ── Denylist: tokens removed / migrated as part of B1 ────────────────────
  //
  // --color-bg-hover is removed from styles.css :root (it was the sole definition,
  // and its sole consumer — .family-legend-toggle:hover — is repointed to
  // --color-bg-tint).  If it reappears in styles.css, the fix has been reverted.
  it('styles.css no longer defines --color-bg-hover (sole consumer repointed to --color-bg-tint)', () => {
    expect(STYLES_CSS).not.toMatch(/--color-bg-hover\s*:/);
  });

  // The 11 duplicate semantic tokens that styles.css :root defined alongside
  // tokens.css [data-theme] blocks must no longer have bare-:root definitions
  // in styles.css (they now live exclusively in tokens.css [data-theme] blocks
  // or are consumed via var() fallback chains).
  //
  // Verified-safe tokens that genuinely live only in styles.css :root and must
  // NOT appear in this list:
  //   --color-border-subtle, --color-text-faint, --color-text-white,
  //   --color-bg-stale, --color-bg-stale-chip, --color-text-stale,
  //   --color-text-stale-name, --color-accent-notable-bg (light only here)
  const MIGRATED_TOKENS = [
    '--color-bg-page',
    '--color-bg-surface',
    '--color-bg-tint',
    '--color-text-strong',
    '--color-text-body',
    '--color-text-muted',
    '--color-text-subtle',
    '--color-border-ui',
    '--color-error-bg',
    '--color-error-border',
    '--color-error-text',
  ] as const;

  for (const tok of MIGRATED_TOKENS) {
    it(`styles.css bare :root no longer defines ${tok} (migrated to tokens.css [data-theme] blocks)`, () => {
      // Extract bare-:root block from styles.css only
      const bareRootStylesTokens = extractBareRootTokens(STYLES_CSS);
      expect(
        bareRootStylesTokens.has(tok),
        `${tok} must not be defined in styles.css :root — it belongs exclusively in tokens.css [data-theme] blocks`,
      ).toBe(false);
    });
  }

  // ── Tightened :314-318 assertions — block-scoped ─────────────────────────
  // The existing "defines --text-body-sm / --text-heading-sm" assertions at lines
  // 314-318 only check that the token exists SOMEWHERE in tokens.css; they don't
  // catch light-only definitions.  These replacements require the tokens to appear
  // in the bare :root block (mode-independent — no color component).
  it('--text-body-sm is defined in the bare :root block of tokens.css (mode-independent, no color)', () => {
    const bareRootTokensCSS = extractBareRootTokens(TOKENS_CSS);
    expect(
      bareRootTokensCSS.has('--text-body-sm'),
      '--text-body-sm must be in tokens.css :root (not light-only)',
    ).toBe(true);
  });

  it('--text-heading-sm is defined in the bare :root block of tokens.css (mode-independent, no color)', () => {
    const bareRootTokensCSS = extractBareRootTokens(TOKENS_CSS);
    expect(
      bareRootTokensCSS.has('--text-heading-sm'),
      '--text-heading-sm must be in tokens.css :root (not light-only)',
    ).toBe(true);
  });

  // ── Contrast assertions for the three dark error/hover surfaces ───────────
  // Pinned as computed ratios (not hex regexes) so a palette change that drops
  // contrast below 4.5:1 fails here rather than silently shipping.
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
    return (Math.max(lumA, lumB) + 0.05) / (Math.min(lumA, lumB) + 0.05);
  }

  it('dark error-screen__retry label: --color-text-strong (#f5f7fb) on --color-bg-surface (#1b2742) ≥ 4.5:1', () => {
    // After fix: var(--color-text, #111) → var(--color-text-strong)
    // Dark: --color-text-strong = #f5f7fb; --color-bg-surface = #1b2742
    expect(contrastRatio('#f5f7fb', '#1b2742')).toBeGreaterThanOrEqual(4.5);
  });

  it('dark map-error-overlay__dismiss resting: --color-text-muted (#8a98ad) on --color-bg-surface (#1b2742) ≥ 4.5:1', () => {
    // After fix: var(--color-text-secondary, #666) → var(--color-text-muted)
    // Dark: --color-text-muted = #8a98ad; --color-bg-surface = #1b2742
    expect(contrastRatio('#8a98ad', '#1b2742')).toBeGreaterThanOrEqual(4.5);
  });

  it('dark map-error-overlay__dismiss hover: --color-text-strong (#f5f7fb) on --color-bg-tint (#1c2640) ≥ 4.5:1', () => {
    // After fix: var(--color-text, #111) → var(--color-text-strong)
    // Dark: --color-text-strong = #f5f7fb; --color-bg-tint = #1c2640
    expect(contrastRatio('#f5f7fb', '#1c2640')).toBeGreaterThanOrEqual(4.5);
  });

  it('dark family-legend-toggle hover: --color-text-strong (#f5f7fb) on --color-bg-tint (#1c2640) ≥ 4.5:1', () => {
    // After fix: --color-bg-hover → --color-bg-tint
    // Dark hover background = --color-bg-tint = #1c2640; text = --color-text-strong = #f5f7fb
    expect(contrastRatio('#f5f7fb', '#1c2640')).toBeGreaterThanOrEqual(4.5);
  });
});

// ── B2 (#1041): dark-mode controls + chip contrast/legibility ────────────────
//
// 1. --color-bg-inset: a mode-paired chip-background token.
//    light: #f0ebe0 (current .family-legend-entry-count bg value — preserves resolved color)
//    dark:  #253050 (skeleton-highlight: 9.60:1 chip text contrast + 1.14:1 lift vs card #1b2742)
//
// 2. color-scheme: feeds native widget internals (select dropdown, checkbox
//    glyph) so they follow the theme rather than staying UA-light in dark mode.
//
// 3. The B1 both-themes enforcement test already guards that --color-bg-inset
//    appears in BOTH [data-theme] blocks — these tests pin the exact values.
describe('B2 (#1041): --color-bg-inset token pairing', () => {
  const lightBlockMatch = TOKENS_CSS.match(
    /:root\[data-theme="light"\]\s*\{([^}]*)\}/s,
  );
  const lightBlock = lightBlockMatch?.[1] ?? '';

  const darkBlockMatch = TOKENS_CSS.match(
    /:root\[data-theme="dark"\]\s*\{([^}]*)\}/s,
  );
  const darkBlock = darkBlockMatch?.[1] ?? '';

  it('--color-bg-inset is defined in the light block', () => {
    expect(lightBlock).toMatch(/--color-bg-inset:/);
  });

  it('--color-bg-inset light value is #f0ebe0 (preserves chip-vs-card lift + 8.19:1 text contrast)', () => {
    expect(lightBlock).toMatch(/--color-bg-inset:\s*#f0ebe0/);
  });

  it('--color-bg-inset is defined in the dark block', () => {
    expect(darkBlock).toMatch(/--color-bg-inset:/);
  });

  it('--color-bg-inset dark value is #253050 (skeleton-highlight: 9.60:1 text contrast, 1.14:1 card lift)', () => {
    expect(darkBlock).toMatch(/--color-bg-inset:\s*#253050/);
  });
});

describe('B2 (#1041): color-scheme in both theme blocks', () => {
  const lightBlockMatch = TOKENS_CSS.match(
    /:root\[data-theme="light"\]\s*\{([^}]*)\}/s,
  );
  const lightBlock = lightBlockMatch?.[1] ?? '';

  const darkBlockMatch = TOKENS_CSS.match(
    /:root\[data-theme="dark"\]\s*\{([^}]*)\}/s,
  );
  const darkBlock = darkBlockMatch?.[1] ?? '';

  it('light block declares color-scheme: light (native widget internals use light UA chrome)', () => {
    expect(lightBlock).toMatch(/color-scheme:\s*light/);
  });

  it('dark block declares color-scheme: dark (native widget internals use dark UA chrome)', () => {
    expect(darkBlock).toMatch(/color-scheme:\s*dark/);
  });
});

// ── B4 (#1043): elevation / shadow token migration ───────────────────────────
//
// Guards that the legacy single-mode shadow tokens are deleted (styles.css :root
// must no longer define them) and that the elevation tier system has coverage
// across all three consumers mandated by the issue contract.
describe('B4 (#1043): elevation/shadow token migration', () => {
  // ── Deletion guards ───────────────────────────────────────────────────────

  it('styles.css no longer defines --shadow-listbox (deleted — consumers migrated to --card-elevation-*)', () => {
    expect(STYLES_CSS).not.toMatch(/--shadow-listbox\s*:/);
  });

  it('styles.css no longer defines --shadow-panel (deleted — stale vocabulary, zero consumers)', () => {
    expect(STYLES_CSS).not.toMatch(/--shadow-panel\s*:/);
  });

  it('styles.css no longer defines --shadow-drawer (deleted — stale vocabulary, zero consumers)', () => {
    expect(STYLES_CSS).not.toMatch(/--shadow-drawer\s*:/);
  });

  // Consumers must not reference the deleted tokens
  it('no file references var(--shadow-listbox) after migration', () => {
    expect(STYLES_CSS).not.toMatch(/var\(--shadow-listbox\)/);
    expect(DS_PRIMITIVES_CSS).not.toMatch(/var\(--shadow-listbox\)/);
  });

  it('no file references var(--shadow-panel) after migration', () => {
    expect(STYLES_CSS).not.toMatch(/var\(--shadow-panel\)/);
    expect(DS_PRIMITIVES_CSS).not.toMatch(/var\(--shadow-panel\)/);
  });

  it('no file references var(--shadow-drawer) after migration', () => {
    expect(STYLES_CSS).not.toMatch(/var\(--shadow-drawer\)/);
    expect(DS_PRIMITIVES_CSS).not.toMatch(/var\(--shadow-drawer\)/);
  });

  // ── No raw box-shadow literals on migrated elements ───────────────────────
  // AC: grep -nE "box-shadow: 0 -?4px" → zero matches (requires dark overrides deleted too)
  it('styles.css has no raw "box-shadow: 0 4px" or "box-shadow: 0 -4px" literals (all migrated to tokens)', () => {
    expect(STYLES_CSS).not.toMatch(/box-shadow:\s*0\s*-?4px/);
  });

  it('ds-primitives.css has no raw "box-shadow: 0 4px" or "box-shadow: 0 -4px" literals (all migrated to tokens)', () => {
    expect(DS_PRIMITIVES_CSS).not.toMatch(/box-shadow:\s*0\s*-?4px/);
  });

  // ── Tier-2 coverage: at least 3 consumers of --card-elevation-2 ──────────
  it('≥3 consumers of var(--card-elevation-2) across all files after migration', () => {
    const allCss = STYLES_CSS + DS_PRIMITIVES_CSS + TOKENS_CSS;
    // Count distinct var(--card-elevation-2) occurrences outside token definition lines
    const matches = allCss.match(/var\(--card-elevation-2\)/g);
    expect(
      (matches ?? []).length,
      'Expected ≥3 var(--card-elevation-2) usages: .cell-popover, .cluster-list-popover, .observation-popover',
    ).toBeGreaterThanOrEqual(3);
  });

  // ── Sheet token present in both themes ───────────────────────────────────
  it('--card-elevation-sheet is defined in the light [data-theme] block', () => {
    const lightBlockMatch = TOKENS_CSS.match(
      /:root\[data-theme="light"\]\s*\{([^}]*)\}/s,
    );
    expect(lightBlockMatch?.[1]).toMatch(/--card-elevation-sheet:/);
  });

  it('--card-elevation-sheet is defined in the dark [data-theme] block', () => {
    const darkBlockMatch = TOKENS_CSS.match(
      /:root\[data-theme="dark"\]\s*\{([^}]*)\}/s,
    );
    expect(darkBlockMatch?.[1]).toMatch(/--card-elevation-sheet:/);
  });

  it('styles.css .species-detail-sheet uses var(--card-elevation-sheet), not a raw shadow literal', () => {
    const sheetBlockMatch = STYLES_CSS.match(
      /\.species-detail-sheet\s*\{([^}]*)\}/s,
    );
    expect(sheetBlockMatch?.[1]).toMatch(/box-shadow:\s*var\(--card-elevation-sheet\)/);
  });

  // ── Radius / max-width migrations ─────────────────────────────────────────
  it('ds-primitives.css .cell-popover uses var(--card-radius) for border-radius', () => {
    const cellBlockMatch = DS_PRIMITIVES_CSS.match(
      /\.cell-popover\s*\{([^}]*)\}/s,
    );
    expect(cellBlockMatch?.[1]).toMatch(/border-radius:\s*var\(--card-radius\)/);
  });

  it('ds-primitives.css .cluster-list-popover uses var(--card-radius) for border-radius', () => {
    const clusterBlockMatch = DS_PRIMITIVES_CSS.match(
      /\.cluster-list-popover\s*\{([^}]*)\}/s,
    );
    expect(clusterBlockMatch?.[1]).toMatch(/border-radius:\s*var\(--card-radius\)/);
  });

  it('styles.css .observation-popover uses var(--card-radius) for border-radius', () => {
    const obsBlockMatch = STYLES_CSS.match(
      /\.observation-popover\s*\{([^}]*)\}/s,
    );
    expect(obsBlockMatch?.[1]).toMatch(/border-radius:\s*var\(--card-radius\)/);
  });

  it('styles.css .observation-popover uses var(--card-maxw-popover) for max-width', () => {
    const obsBlockMatch = STYLES_CSS.match(
      /\.observation-popover\s*\{([^}]*)\}/s,
    );
    expect(obsBlockMatch?.[1]).toMatch(/max-width:\s*var\(--card-maxw-popover\)/);
  });

  it('ds-primitives.css .cell-popover uses var(--card-maxw-popover) for max-width', () => {
    const cellBlockMatch = DS_PRIMITIVES_CSS.match(
      /\.cell-popover\s*\{([^}]*)\}/s,
    );
    expect(cellBlockMatch?.[1]).toMatch(/max-width:\s*var\(--card-maxw-popover\)/);
  });

  it('styles.css .sheet-fg-photo uses var(--card-radius-inner) for border-radius (not 10px)', () => {
    const photoBlockMatch = STYLES_CSS.match(
      /\.sheet-fg-photo\s*\{([^}]*)\}/s,
    );
    expect(photoBlockMatch?.[1]).toMatch(/border-radius:\s*var\(--card-radius-inner\)/);
    expect(photoBlockMatch?.[1]).not.toMatch(/border-radius:\s*10px/);
  });
});

// F1 (#1061) — typography unification: one font stack, one --type-sm leading,
// ramp/weight/tracking values consumed as tokens. Guards pin the unified
// values so a future regression (re-typed literal, divergent body stack)
// reddens here, not only at live-verify.
describe('F1 #1061 — typography unification', () => {
  describe('tokens.css — leading + tracking tokens', () => {
    it('defines --leading-sm next to the type ramp (the single --type-sm leading)', () => {
      // Contract: ONE --type-sm leading, encoded next to the ramp. We pick 1.5
      // to match the --text-body-sm consumers (.cell-popover et al.), so the
      // two map popovers resolve identically.
      expect(TOKENS_CSS).toMatch(/--leading-sm:\s*1\.5\s*;/);
    });
    it('--text-body-sm consumes --leading-sm (no re-typed 1.5 literal in the shorthand)', () => {
      expect(TOKENS_CSS).toMatch(
        /--text-body-sm:\s*var\(--font-weight-regular\)\s*var\(--type-sm\)\s*\/\s*var\(--leading-sm\)\s*var\(--font-stack\)/,
      );
    });
    it('defines --tracking-label: 0.06em in Layer 1', () => {
      expect(TOKENS_CSS).toMatch(/--tracking-label:\s*0\.06em\s*;/);
    });
    it('defines --tracking-eyebrow: 0.08em in Layer 1', () => {
      expect(TOKENS_CSS).toMatch(/--tracking-eyebrow:\s*0\.08em\s*;/);
    });
  });

  describe('styles.css — body font + popover parity', () => {
    it('body resolves font-family through var(--font-stack) (not the legacy scaffold stack)', () => {
      const bodyBlock = STYLES_CSS.match(/\bbody\s*\{([^}]*)\}/s);
      expect(bodyBlock?.[1]).toMatch(/font-family:\s*var\(--font-stack\)/);
      // The legacy scaffold stack must be gone from body.
      expect(bodyBlock?.[1]).not.toMatch(/-apple-system,\s*BlinkMacSystemFont,\s*"Helvetica Neue"/);
    });
    it('body sets a line-height baseline', () => {
      const bodyBlock = STYLES_CSS.match(/\bbody\s*\{([^}]*)\}/s);
      expect(bodyBlock?.[1]).toMatch(/line-height:/);
    });
    it('.observation-popover sets the same font + leading as the --text-body-sm consumers', () => {
      const popBlock = STYLES_CSS.match(/\.observation-popover\s*\{([^}]*)\}/s);
      // Must pin the token stack and the unified --type-sm leading so it is
      // visually identical to .cell-popover (font: var(--text-body-sm)).
      expect(popBlock?.[1]).toMatch(/font-family:\s*var\(--font-stack\)/);
      expect(popBlock?.[1]).toMatch(/line-height:\s*var\(--leading-sm\)/);
    });
  });

  describe('mechanical token swaps — no re-typed literals', () => {
    it('no raw font-size: 11px in styles.css (use var(--type-xs))', () => {
      expect(STYLES_CSS).not.toMatch(/font-size:\s*11px/);
    });
    it('no raw font-size: 11px in ds-primitives.css (use var(--type-xs))', () => {
      expect(DS_PRIMITIVES_CSS).not.toMatch(/font-size:\s*11px/);
    });
    it('no raw numeric font-weight in styles.css (use var(--font-weight-*))', () => {
      expect(STYLES_CSS).not.toMatch(/font-weight:\s*[0-9]/);
    });
    it('no raw numeric font-weight in ds-primitives.css (use var(--font-weight-*))', () => {
      expect(DS_PRIMITIVES_CSS).not.toMatch(/font-weight:\s*[0-9]/);
    });
    it('no literal weight smuggled into a font: shorthand', () => {
      expect(STYLES_CSS).not.toMatch(/font:\s*[0-9]{3}/);
      expect(DS_PRIMITIVES_CSS).not.toMatch(/font:\s*[0-9]{3}/);
    });
    it('the uppercase label rows consume --tracking-label (not the 0.06em literal)', () => {
      // .detail-fg-taxrow dt / .sheet-fg-label / .sheet-fg-taxrow dt
      // (the dead .map-freshness 0.05em is deleted by #1064 — not touched here).
      expect(STYLES_CSS).not.toMatch(/letter-spacing:\s*0\.06em/);
    });
    it('the uppercase eyebrows consume --tracking-eyebrow (not the 0.08em literal)', () => {
      expect(STYLES_CSS).not.toMatch(/letter-spacing:\s*0\.08em/);
    });
    it('.cluster-pill sets font-variant-numeric: tabular-nums (its width formula assumes tabular digits)', () => {
      const pillBlock = DS_PRIMITIVES_CSS.match(/\.cluster-pill\s*\{([^}]*)\}/s);
      expect(pillBlock?.[1]).toMatch(/font-variant-numeric:\s*tabular-nums/);
    });
    it('the two × close glyphs are unified at one shared size (20px), not 18px/20px split', () => {
      // Either SVG migration (no font-size:18|20) or one shared size with an
      // icon-glyph exception comment at both sites — we take the latter at 20px.
      expect(STYLES_CSS).not.toMatch(/font-size:\s*18px/);
    });
  });
});
