/**
 * CSS token conformance tests — W1 dark-mode revert
 *
 * These tests read tokens.css as a string and assert that the three
 * regressions introduced in PR #415 are not present:
 *   1. --color-accent-notable-fg must NOT be the olive hex #b8860b in light.
 *   2. The dark block must contain all 14 spec-mandated token overrides.
 *   3. styles.css must not use a hardcoded hex for .feed-card-meta color.
 *   4. styles.css .app-header-tab.is-active must not use background:
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
    // NEW-1 hotfix: these were absent from the dark block, causing .feed-row-notable
    // to resolve to the light-mode #fff8e1 (pale cream) on a dark navy page.
    // Contrast verified: #f5f7fb (--color-text-strong dark) on #2a2620 → ~16.7:1 (AAA).
    it('overrides --color-accent-notable-bg (hotfix NEW-1: dark warm-amber, not light cream)', () => {
      expect(darkBlock).toMatch(/--color-accent-notable-bg:/);
    });
    it('pins --color-accent-notable-bg to #2a2620 (deep amber-shadow, 16.7:1 vs #f5f7fb)', () => {
      expect(darkBlock).toMatch(/--color-accent-notable-bg:\s*#2a2620/);
    });
    it('overrides --color-accent-notable-bg-hover', () => {
      expect(darkBlock).toMatch(/--color-accent-notable-bg-hover:/);
    });
    it('pins --color-accent-notable-bg-hover to #332e26 (lifted amber-shadow hover)', () => {
      expect(darkBlock).toMatch(/--color-accent-notable-bg-hover:\s*#332e26/);
    });
  });
});

describe('styles.css — W1 conformance', () => {
  describe('.feed-card-meta color — no hardcoded hex', () => {
    it('does not use #7a6010 hardcode for .feed-card-meta color', () => {
      // The walkback shipped: color: #7a6010 at styles.css:491
      // Fix: use var(--color-accent-notable-fg)
      expect(STYLES_CSS).not.toMatch(/\.feed-card-meta\s*\{[^}]*color:\s*#7a6010/s);
    });

    it('.feed-card-meta uses var(--color-accent-notable-fg) for color', () => {
      expect(STYLES_CSS).toMatch(
        /\.feed-card-meta\s*\{[^}]*color:\s*var\(--color-accent-notable-fg\)/s,
      );
    });
  });

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
});
