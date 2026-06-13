/**
 * D3 — visible-state polish CSS conformance (#1051, epic #1048)
 *
 * String-based assertions over styles.css (same pattern as
 * styles/tokens.css.test.ts) pinning the three CSS-only fixes in D3:
 *
 *   - C80: a visible in-flight affordance keyed off the existing
 *     `#map-layer[aria-busy="true"]` state. No `[aria-busy]` rule existed
 *     before this change, so the non-blocking refetch was invisible to
 *     sighted users. `#map-layer` stays the sole aria-busy node — the rule
 *     dims the stale `.maplibregl-marker` overlay only (NOT the basemap
 *     canvas), so the map reads as "refreshing" without going blank.
 *   - C83: hover/active states on the two dark-fill landing CTAs
 *     (`.zip-input__submit`, `.scope-chooser__btn`), light + dark. Hexes
 *     are the issue-Contract values, each ≥4.5:1 AA in both themes
 *     (verified in the contrast block below).
 *   - V25: the trailing `border-bottom` on `.filters-bar` is gone — inside
 *     the floating `.filters-panel` it rendered as a hairline above an
 *     empty strip (a phantom cut-off footer).
 *
 * Issue: #1051. Part of #1048 (D3).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { contrastRatio } from './utils/wcag-contrast.js';

const STYLES_CSS = readFileSync(
  join(import.meta.dirname, 'styles.css'),
  'utf8',
);

/** Pull the body of the FIRST `selector { ... }` block (no nested braces). */
function ruleBody(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, 's');
  const m = css.match(re);
  return m?.[1] ?? '';
}

describe('D3 state polish — styles.css conformance', () => {
  describe('C80 — visible refetch busy affordance', () => {
    it('defines a rule scoped to #map-layer[aria-busy="true"]', () => {
      expect(STYLES_CSS).toMatch(/#map-layer\[aria-busy="true"\]/);
    });

    it('dims the marker overlay (.maplibregl-marker), not the basemap canvas', () => {
      // The rule targets the marker layer so the stale markers fade during a
      // refetch; the basemap (.maplibregl-canvas) must NOT be matched, else the
      // whole map blinks.
      const busyBlock = ruleBody(
        STYLES_CSS,
        '#map-layer[aria-busy="true"] .maplibregl-marker',
      );
      expect(busyBlock).not.toBe('');
      // The affordance is an opacity dim.
      expect(busyBlock).toMatch(/opacity:/);
      // Never dim the basemap canvas directly.
      expect(STYLES_CSS).not.toMatch(
        /#map-layer\[aria-busy="true"\]\s+\.maplibregl-canvas\s*\{/,
      );
    });

    it('transitions opacity so the dim is not an instant flash', () => {
      const busyBlock = ruleBody(
        STYLES_CSS,
        '#map-layer[aria-busy="true"] .maplibregl-marker',
      );
      expect(busyBlock).toMatch(/transition:/);
    });
  });

  describe('C83 — landing CTA hover/active states', () => {
    for (const sel of ['.zip-input__submit', '.scope-chooser__btn']) {
      const escaped = sel.replace('.', '\\.');
      // The chooser button qualifies hover/active with :not(:disabled) so the
      // muted disabled state stays inert; allow any pseudo-class chain between
      // the base selector and :hover/:active.
      it(`${sel} defines a :hover rule`, () => {
        expect(STYLES_CSS).toMatch(new RegExp(`${escaped}(:[a-z-]+(\\([^)]*\\))?)*:hover`));
      });
      it(`${sel} defines an :active rule`, () => {
        expect(STYLES_CSS).toMatch(new RegExp(`${escaped}(:[a-z-]+(\\([^)]*\\))?)*:active`));
      });
    }

    it('uses the Contract light-theme hover/active fills (#333333, #000000)', () => {
      const hover = ruleBody(STYLES_CSS, '.zip-input__submit:hover');
      const active = ruleBody(STYLES_CSS, '.zip-input__submit:active');
      expect(hover).toMatch(/#333333/i);
      expect(active).toMatch(/#000000|#000\b/i);
    });

    it('uses the Contract dark-theme hover/active fills (#e4e8f0, #ffffff)', () => {
      // Dark-mode overrides live under [data-theme="dark"] selectors.
      expect(STYLES_CSS).toMatch(
        /\[data-theme="dark"\][^{]*\.zip-input__submit:hover/,
      );
      expect(STYLES_CSS).toMatch(/#e4e8f0/i);
      expect(STYLES_CSS).toMatch(
        /\[data-theme="dark"\][^{]*\.zip-input__submit:active/,
      );
    });

    it('every state label/fill pair clears the 4.5:1 AA floor in BOTH themes', () => {
      // Light: label = #fff (--color-text-white). Dark: label = #1b2742
      // (--color-bg-surface, the dark-mode flip).
      const LIGHT_LABEL = '#ffffff';
      const DARK_LABEL = '#1b2742';
      // Light fills: base #1a1a1a, hover #333333, active #000000.
      for (const fill of ['#1a1a1a', '#333333', '#000000']) {
        expect(contrastRatio(fill, LIGHT_LABEL)).toBeGreaterThanOrEqual(4.5);
      }
      // Dark fills: base #f5f7fb, hover #e4e8f0, active #ffffff.
      for (const fill of ['#f5f7fb', '#e4e8f0', '#ffffff']) {
        expect(contrastRatio(fill, DARK_LABEL)).toBeGreaterThanOrEqual(4.5);
      }
    });

    it(':disabled stays inert (no hover/active fill-shift overriding it)', () => {
      // The chooser button keeps its muted :disabled rule. Hover/active must
      // not clobber the disabled state — guard the source by asserting the
      // :disabled rule still sets the muted color.
      const disabled = ruleBody(STYLES_CSS, '.scope-chooser__btn:disabled');
      expect(disabled).toMatch(/--color-text-muted/);
    });
  });

  describe('V25 — filters panel trailing hairline removed', () => {
    it('.filters-bar no longer carries a border-bottom', () => {
      const bar = ruleBody(STYLES_CSS, '.filters-bar');
      expect(bar).not.toBe('');
      expect(bar).not.toMatch(/border-bottom:/);
    });
  });
});
