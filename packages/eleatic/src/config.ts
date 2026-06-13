/**
 * eleatic configuration — resolved server config and the client-safe slice.
 *
 * All configurability is OPTIONAL: `resolveConfig()` with no path returns a
 * zero-config default that works out of the box (the "zero-config works" resolved
 * default from the plan). A `--config <path>` JSON file shallow-overrides those
 * defaults. The package invents no domain mapping: the verdict vocabulary, named
 * metrics, gate, and image-host allowlist all come from config (or the generic
 * defaults), never from a hard-coded bird/photo assumption.
 *
 * `clientConfigSlice(cfg)` projects ONLY the browser-safe subset that the UI's
 * `/config.js` import needs. Server-only fields (e.g. the on-disk db path) never
 * appear in the emitted module. Under `exactOptionalPropertyTypes` every omittable
 * field is declared `?:` and is set on the projected object only when present, so
 * an absent key is genuinely absent (never `undefined`) in the emitted JSON.
 */

import { readFileSync } from 'node:fs';

/** A declarative pass/fail gate over one run-level metric. */
export interface EleaticGate {
  metric: string;
  op: 'eq' | 'ne' | 'lt' | 'lte' | 'gt' | 'gte';
  threshold: number;
}

/** The client-visible config slice the UI imports via `/config.js`. */
export interface ClientConfig {
  /** Allowed verdict strings for the adjudication dropdown. */
  verdictVocabulary: string[];
  /** Image-host allowlist for the gallery (default: any https). */
  imageHostAllowlist: string[];
  /** Namespaced localStorage key for the UI theme. */
  themeKey: string;
  /** Per-metric display formatter hints, e.g. `{ agreement: 'percent' }`. */
  metricFormatters: Record<string, string>;
  /** Declarative run gate, if configured. */
  gate?: EleaticGate;
}

/**
 * The fully-resolved server config. Extends the client slice with server-only
 * fields that must NOT leak to the browser (e.g. the db path, carried for
 * provenance / logging). Server-only keys are added here and explicitly NOT
 * copied by `clientConfigSlice`.
 */
export interface EleaticConfig extends ClientConfig {
  /** Server-only: the resolved store path (never emitted to the client). */
  dbPath?: string;
}

const DEFAULT_VERDICTS = ['keep', 'replace', 'uncertain'];

/** The zero-config baseline applied before any `--config` file overrides. */
function defaults(): EleaticConfig {
  return {
    verdictVocabulary: [...DEFAULT_VERDICTS],
    imageHostAllowlist: ['https://*'],
    themeKey: 'eleatic-theme',
    metricFormatters: {},
  };
}

/** Shape of the optional on-disk config JSON (every field optional). */
interface ConfigFile {
  verdictVocabulary?: string[];
  imageHostAllowlist?: string[];
  themeKey?: string;
  metricFormatters?: Record<string, string>;
  gate?: EleaticGate;
}

/**
 * Resolve the eleatic config. With no `path`, returns the zero-config default.
 * With a `path`, shallow-merges the JSON file over the defaults; only the keys
 * present in the file override, the rest fall back. Optional keys are assigned
 * only when present (exactOptionalPropertyTypes).
 */
export function resolveConfig(path?: string): EleaticConfig {
  const cfg = defaults();
  if (path === undefined) return cfg;
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as ConfigFile;
  if (parsed.verdictVocabulary !== undefined) cfg.verdictVocabulary = parsed.verdictVocabulary;
  if (parsed.imageHostAllowlist !== undefined) cfg.imageHostAllowlist = parsed.imageHostAllowlist;
  if (parsed.themeKey !== undefined) cfg.themeKey = parsed.themeKey;
  if (parsed.metricFormatters !== undefined) cfg.metricFormatters = parsed.metricFormatters;
  if (parsed.gate !== undefined) cfg.gate = parsed.gate;
  return cfg;
}

/**
 * Project the client-safe subset for the `/config.js` emitter. Server-only
 * fields (dbPath) are intentionally dropped. An absent `gate` is omitted (the
 * key never appears) rather than serialized as `undefined`.
 */
export function clientConfigSlice(cfg: EleaticConfig): ClientConfig {
  const slice: ClientConfig = {
    verdictVocabulary: cfg.verdictVocabulary,
    imageHostAllowlist: cfg.imageHostAllowlist,
    themeKey: cfg.themeKey,
    metricFormatters: cfg.metricFormatters,
  };
  if (cfg.gate !== undefined) slice.gate = cfg.gate;
  return slice;
}
