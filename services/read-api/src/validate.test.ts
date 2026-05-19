import { describe, it, expect } from 'vitest';
import {
  parseSince,
  parseNotable,
  parseSpecies,
  parseFamily,
  assertBboxAreaCap,
  assertBboxOrSpecies,
} from './validate.js';

describe('parseSince', () => {
  it('passes through 1d / 7d / 14d', () => {
    for (const v of ['1d', '7d', '14d'] as const) {
      const r = parseSince(v);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value).toBe(v);
    }
  });

  it('accepts 30d but flags as deprecated and coerces to 14d', () => {
    const r = parseSince('30d');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toBe('14d');
      // Discriminated extra field carrying the soft-deprecation signal.
      expect(r.deprecated).toBe(true);
    }
  });

  it('treats absent as undefined (no filter)', () => {
    const r = parseSince(undefined);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBeUndefined();
  });

  it('rejects garbage with a structured log payload', () => {
    const r = parseSince('banana');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe('invalid since');
      expect(r.log.param).toBe('since');
      expect(r.log.reason).toBe('not_in_allowlist');
      expect(r.log.received_hash).toMatch(/^[a-f0-9]{8}$/);
    }
  });
});

describe('parseNotable', () => {
  it('accepts exactly "true" and "false"', () => {
    const t = parseNotable('true');
    const f = parseNotable('false');
    expect(t.ok && t.value).toBe(true);
    expect(f.ok && f.value).toBe(false);
  });

  it('treats absent as undefined', () => {
    const r = parseNotable(undefined);
    expect(r.ok && r.value === undefined).toBe(true);
  });

  it.each(['banana', 'TRUE', 'False', '1', '0', ''])(
    'rejects %p',
    (v) => {
      const r = parseNotable(v);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.error).toBe('invalid notable');
        expect(r.log.param).toBe('notable');
      }
    },
  );
});

describe('parseSpecies', () => {
  // Real eBird codes — must all pass.
  it.each(['accipi1', 'tyrann1', 'x00013', 'gamqua', 'cardin1', 'annhum', 'vermfly'])(
    'accepts real code %p',
    (v) => {
      const r = parseSpecies(v);
      expect(r.ok, `expected ${v} to pass`).toBe(true);
      if (r.ok) expect(r.value).toBe(v);
    },
  );

  it('treats absent as undefined', () => {
    expect(parseSpecies(undefined).ok).toBe(true);
  });

  it.each([
    '',
    '%',
    "' OR 1=1 --",
    'GAMQUA',
    'gam qua',
    'ab',           // too short
    'toolongcode1', // too long (12 chars)
    '1annhum',      // starts with digit
  ])('rejects %p', (v) => {
    const r = parseSpecies(v);
    expect(r.ok, `expected ${JSON.stringify(v)} to fail`).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe('invalid species');
      expect(r.log.reason).toBe('regex_mismatch');
    }
  });
});

describe('parseFamily', () => {
  it.each(['tyrannidae', 'trochilidae', 'icteridae', 'fam1'])(
    'accepts %p',
    (v) => {
      const r = parseFamily(v);
      expect(r.ok, `expected ${v} to pass`).toBe(true);
    },
  );

  it.each(['', '%', "' OR 1=1 --", 'TYRANNIDAE', 'tyr', 'thisfamilyistoolong'])(
    'rejects %p',
    (v) => {
      const r = parseFamily(v);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.log.param).toBe('family');
    },
  );
});

describe('assertBboxAreaCap', () => {
  it('passes for any bbox at zoom < 6 (aggregated mode covers it)', () => {
    const r = assertBboxAreaCap([-180, -90, 180, 90], 4);
    expect(r.ok).toBe(true);
  });

  it('passes for a within-cap bbox at zoom >= 6', () => {
    const r = assertBboxAreaCap([-115, 32, -109, 37], 8); // 6° × 5°
    expect(r.ok).toBe(true);
  });

  it('passes for natural 1920x1080 viewport at z=6 (~42.2° × 23.7°)', () => {
    // Largest canonical viewport at the per-obs zoom boundary. The cap is
    // sized to allow this exact case — if you bump 1920×1080 out of the
    // canonical set, you can shrink the cap.
    const r = assertBboxAreaCap([-119.7, 27.9, -77.5, 51.6], 6);
    expect(r.ok).toBe(true);
  });

  it('rejects too-wide lng span at zoom >= 6', () => {
    const r = assertBboxAreaCap([-140, 30, -90, 40], 6); // 50° × 10° — lng > 45
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.body.error).toBe('bbox too large');
      expect(r.body.maxLngSpan).toBe(45);
      expect(r.log.reason).toBe('too_large');
    }
  });

  it('rejects too-tall lat span at zoom >= 6', () => {
    const r = assertBboxAreaCap([-115, 15, -105, 45], 7); // 10° × 30° — lat > 25
    expect(r.ok).toBe(false);
  });

  it('passes when zoom is undefined (no zoom hint → treat as aggregated permissive)', () => {
    const r = assertBboxAreaCap([-180, -90, 180, 90], undefined);
    expect(r.ok).toBe(true);
  });
});

describe('assertBboxOrSpecies', () => {
  it('passes when bbox is present', () => {
    expect(assertBboxOrSpecies({
      bbox: [-115, 32, -109, 37],
      speciesCode: undefined,
    }).ok).toBe(true);
  });

  it('passes when species is present (no bbox needed for species-deep-link)', () => {
    expect(assertBboxOrSpecies({
      bbox: undefined,
      speciesCode: 'annhum',
    }).ok).toBe(true);
  });

  it('rejects when neither bbox nor species is present', () => {
    const r = assertBboxOrSpecies({ bbox: undefined, speciesCode: undefined });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe('specify bbox or species');
      expect(r.log.param).toBe('bbox_required');
      expect(r.log.reason).toBe('missing_required');
    }
  });
});
