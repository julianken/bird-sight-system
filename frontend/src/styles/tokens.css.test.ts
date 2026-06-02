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

    it('.cell-popover consumes --z-cell-popover and .cluster-list-popover consumes --z-cluster-popover', () => {
      expect(DS_PRIMITIVES_CSS).toMatch(
        /\.cell-popover\s*\{[^}]*z-index:\s*var\(--z-cell-popover\)/s,
      );
      expect(DS_PRIMITIVES_CSS).toMatch(
        /\.cluster-list-popover\s*\{[^}]*z-index:\s*var\(--z-cluster-popover\)/s,
      );
    });
  });
});
