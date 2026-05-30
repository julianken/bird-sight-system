import { describe, it, expect } from 'vitest';
import { iconSize, zIndex, opacity, spacing, duration, color } from './tokens.js';

describe('tokens', () => {
  describe('iconSize', () => {
    it('hotspot-dot radii are monotonic', () => {
      expect(iconSize.hotspotDotMinR).toBeLessThan(iconSize.hotspotDotMaxR);
    });
    it('hotspot-dot ref-species is a positive saturation anchor', () => {
      expect(iconSize.hotspotDotRefSpecies).toBeGreaterThan(0);
    });
    it('badge diameters are monotonic', () => {
      expect(iconSize.badgeDiameterMin).toBeLessThan(iconSize.badgeDiameterMax);
    });
    it('badge default radius fits inside the min diameter (diameter >= 2·radius)', () => {
      // Guards the unit-confusion booby-trap: `badgeDiameterMin` is a
      // diameter (14), `badgeRadiusDefault` is a radius (14). A future edit
      // that accidentally sets `badgeRadiusDefault` to a diameter-sized
      // value (e.g. 28) would fail this assertion and force the author to
      // pick the correct unit.
      expect(2 * iconSize.badgeRadiusDefault).toBeGreaterThanOrEqual(
        iconSize.badgeDiameterMin,
      );
      expect(2 * iconSize.badgeRadiusDefault).toBeLessThanOrEqual(
        iconSize.badgeDiameterMax,
      );
    });
    it('silhouette bbox is square and non-zero', () => {
      expect(iconSize.silhouetteBbox.w).toBeGreaterThan(0);
      expect(iconSize.silhouetteBbox.w).toEqual(iconSize.silhouetteBbox.h);
    });
  });

  describe('zIndex', () => {
    // Named-tier chain — EXCLUDES the deprecated `panel` alias (it ties with
    // `overlay` by design, so it cannot live in a strict-monotonic array).
    // The chain preserves the pre-refactor visible stack order EXACTLY,
    // including the rail-below-popovers relation (#761 P1, issue #778).
    it('named-tier chain is strictly monotonic', () => {
      const ranks = [
        zIndex.map,
        zIndex.overlay,
        zIndex.popover,
        zIndex.chrome,
        zIndex.rail,
        zIndex.cellPopover,
        zIndex.clusterPopover,
        zIndex.modal,
        zIndex.skip,
      ];
      ranks.forEach((v, i) => {
        if (i > 0) expect(v).toBeGreaterThan(ranks[i - 1]!);
      });
    });
    it('panel is a deprecated alias of overlay (same rank)', () => {
      expect(zIndex.panel).toBe(zIndex.overlay);
    });
    it('rail stays BELOW both popovers (preserves rail < cell < cluster)', () => {
      // Guards the #778 rail-above-popover regression at the unit level: a
      // future scheme that lifts the rail to/above a popover tier fails HERE,
      // not just in the map-cell-popover e2e.
      expect(zIndex.rail).toBeLessThan(zIndex.cellPopover);
      expect(zIndex.cellPopover).toBeLessThan(zIndex.clusterPopover);
    });
    it('floating header chrome sits below the detail rail', () => {
      // #761 focus-order intent (AppHeader → … → detail rail/sheet),
      // token-enforced rather than DOM-order-dependent.
      expect(zIndex.chrome).toBeLessThan(zIndex.rail);
    });
  });

  describe('opacity', () => {
    it('scale is monotonic', () => {
      expect(opacity.subtle).toBeLessThan(opacity.dimmed);
      expect(opacity.dimmed).toBeLessThan(opacity.hover);
      expect(opacity.hover).toBeLessThan(opacity.full);
    });
    it('all values are in [0, 1]', () => {
      Object.values(opacity).forEach(v => {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      });
    });
  });

  describe('spacing', () => {
    it('scale is monotonic', () => {
      const ranks = [spacing.xs, spacing.sm, spacing.md, spacing.lg, spacing.xl];
      ranks.forEach((v, i) => {
        if (i > 0) expect(v).toBeGreaterThan(ranks[i - 1]!);
      });
    });
    it('values are multiples of 4px', () => {
      Object.values(spacing).forEach(v => expect(v % 4).toBe(0));
    });
  });

  describe('duration', () => {
    it('scale is monotonic', () => {
      expect(duration.fast).toBeLessThan(duration.base);
      expect(duration.base).toBeLessThan(duration.slow);
    });
  });

  describe('color.palette', () => {
    it('sky-islands is no longer pure red #FF0808', () => {
      expect(color.palette.skyIslands.toUpperCase()).not.toBe('#FF0808');
    });
    it('every palette entry is a 7-char hex string', () => {
      Object.values(color.palette).forEach(c =>
        expect(c).toMatch(/^#[0-9A-Fa-f]{6}$/)
      );
    });
  });
});
