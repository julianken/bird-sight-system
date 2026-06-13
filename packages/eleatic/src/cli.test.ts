import { describe, it, expect } from 'vitest';
import { buildProgram } from './cli.js';

/**
 * Pure-unit CLI tests: build the commander program with an injected fake
 * `startServer`, parse argv, and inspect the parsed options + the args handed to
 * startServer. We NEVER bind a real port — the fake captures the call instead of
 * `app.listen`-ing.
 */
describe('eleatic CLI', () => {
  it('registers a `serve` command with required --db and --port defaulting to 8788', () => {
    const program = buildProgram(() => ({ close: () => {} }));
    const serve = program.commands.find((c) => c.name() === 'serve');
    expect(serve).toBeDefined();
    expect(program.name()).toBe('eleatic');

    const opts = serve!.options;
    const db = opts.find((o) => o.long === '--db');
    const port = opts.find((o) => o.long === '--port');
    const config = opts.find((o) => o.long === '--config');
    // commander: `mandatory` = the option itself must be present (requiredOption);
    // `required` = the option's *value* is required (`<value>` vs `[value]`).
    expect(db?.mandatory).toBe(true); // --db is a requiredOption
    expect(port?.defaultValue).toBe('8788');
    expect(config).toBeDefined();
    expect(config?.mandatory).toBe(false); // --config is optional
  });

  it('passes parsed --db/--port through to startServer (port coerced to Number)', () => {
    let captured: { dbPath: string; port: number; configPath?: string } | undefined;
    const program = buildProgram((o) => {
      captured = o;
      return { close: () => {} };
    });
    program.parse(['node', 'eleatic', 'serve', '--db', '/tmp/eval.sqlite', '--port', '9001']);
    expect(captured).toEqual({ dbPath: '/tmp/eval.sqlite', port: 9001 });
  });

  it('omits configPath entirely when --config is absent (exactOptionalPropertyTypes)', () => {
    let captured: { dbPath: string; port: number; configPath?: string } | undefined;
    const program = buildProgram((o) => { captured = o; return { close: () => {} }; });
    program.parse(['node', 'eleatic', 'serve', '--db', '/tmp/eval.sqlite']);
    expect(captured).toBeDefined();
    expect('configPath' in captured!).toBe(false); // key absent, not undefined
    expect(captured!.port).toBe(8788); // default
  });

  it('sets configPath only when --config is passed', () => {
    let captured: { dbPath: string; port: number; configPath?: string } | undefined;
    const program = buildProgram((o) => { captured = o; return { close: () => {} }; });
    program.parse(['node', 'eleatic', 'serve', '--db', '/tmp/eval.sqlite', '--config', '/tmp/cfg.json']);
    expect(captured!.configPath).toBe('/tmp/cfg.json');
  });
});
