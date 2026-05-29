import { describe, it, expect } from 'vitest';
import {
  ZIP_FLYTO_ZOOM,
  zipResolutionToScope,
  type ScopeResolution,
  type ZipResolution,
} from './scope-types.js';

describe('scope-types', () => {
  it('ZIP_FLYTO_ZOOM is the single shared metro-framing constant (10, inside MAX_BOUNDS, >= 6)', () => {
    expect(ZIP_FLYTO_ZOOM).toBe(10);
    expect(ZIP_FLYTO_ZOOM).toBeGreaterThanOrEqual(6);
  });

  describe('zipResolutionToScope', () => {
    it('maps a ZipResolution to a ScopeResolution with zoom = ZIP_FLYTO_ZOOM and center/stateCode passthrough', () => {
      const zip: ZipResolution = {
        zip: '85701',
        center: [-110.971, 32.21696],
        stateCode: 'US-AZ',
      };

      const scope: ScopeResolution = zipResolutionToScope(zip);

      expect(scope.stateCode).toBe('US-AZ');
      expect(scope.center).toEqual([-110.971, 32.21696]);
      expect(scope.zoom).toBe(ZIP_FLYTO_ZOOM);
    });

    it('center is preserved in [lng, lat] (MapLibre) order — does not swap the tuple', () => {
      const zip: ZipResolution = {
        zip: '10001',
        center: [-73.99718, 40.75064],
        stateCode: 'US-NY',
      };

      const scope = zipResolutionToScope(zip);

      // Longitude (first element) is negative for CONUS — a swap would surface it as positive.
      expect(scope.center[0]).toBeLessThan(0);
      expect(scope.center[0]).toBe(-73.99718);
      expect(scope.center[1]).toBe(40.75064);
    });
  });
});
