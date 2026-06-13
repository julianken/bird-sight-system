import { describe, it, expect } from 'vitest';
import { resolveConfig, clientConfigSlice, type EleaticConfig } from './config.js';

describe('resolveConfig', () => {
  it('returns a zero-config default when no path is given', () => {
    const cfg = resolveConfig();
    // Defaults: a non-empty verdict vocabulary, an any-https image allowlist, a
    // namespaced theme key, no gate, no named metrics, no formatters.
    expect(cfg.verdictVocabulary.length).toBeGreaterThan(0);
    expect(cfg.imageHostAllowlist).toEqual(['https://*']);
    expect(cfg.themeKey).toBe('eleatic-theme');
    expect(cfg.gate).toBeUndefined();
    expect(cfg.metricFormatters).toEqual({});
  });

  it('reads + merges a config JSON file over the defaults', () => {
    const cfg = resolveConfig(
      new URL('./__fixtures__/config.sample.json', import.meta.url).pathname,
    );
    expect(cfg.verdictVocabulary).toEqual(['keep', 'replace', 'uncertain']);
    expect(cfg.gate).toEqual({ metric: 'agreement', op: 'gte', threshold: 0.9 });
    expect(cfg.metricFormatters.agreement).toBe('percent');
    // A field absent from the file falls back to the default.
    expect(cfg.themeKey).toBe('eleatic-theme');
  });
});

describe('clientConfigSlice', () => {
  const full: EleaticConfig = {
    verdictVocabulary: ['keep', 'replace'],
    imageHostAllowlist: ['https://*'],
    themeKey: 'eleatic-theme',
    metricFormatters: { agreement: 'percent' },
    gate: { metric: 'agreement', op: 'gte', threshold: 0.9 },
    // a server-only field that must NOT leak to the browser
    dbPath: '/secret/eval.sqlite',
  };

  it('projects only client-safe fields', () => {
    const slice = clientConfigSlice(full);
    expect(slice).toEqual({
      verdictVocabulary: ['keep', 'replace'],
      imageHostAllowlist: ['https://*'],
      themeKey: 'eleatic-theme',
      metricFormatters: { agreement: 'percent' },
      gate: { metric: 'agreement', op: 'gte', threshold: 0.9 },
    });
  });

  it('omits server-only fields entirely (no dbPath key)', () => {
    const slice = clientConfigSlice(full);
    expect('dbPath' in slice).toBe(false);
  });

  it('omits an absent gate rather than emitting undefined', () => {
    const noGate = resolveConfig();
    const slice = clientConfigSlice(noGate);
    expect('gate' in slice).toBe(false);
  });
});
