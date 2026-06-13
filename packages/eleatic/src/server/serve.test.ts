import { describe, it, expect } from 'vitest';
import { startServer } from './serve.js';

/**
 * serve.ts is thin glue: open the store (E1) -> resolve config -> build the app
 * (createApp) -> listen -> return { close }. The route behaviour is covered
 * exhaustively by app.test.ts's supertest contracts; here we only prove the glue
 * boots and tears down cleanly. We bind the OS-assigned ephemeral port (0) on
 * loopback — no fixed port (no collision with a running dev server), no network —
 * and close immediately. `:memory:` keeps it off disk.
 */
describe('startServer', () => {
  it('opens an in-memory store, listens, and returns a working close()', () => {
    const handle = startServer({ dbPath: ':memory:', port: 0 });
    expect(typeof handle.close).toBe('function');
    // close() releases the listener + db without throwing.
    expect(() => handle.close()).not.toThrow();
  });

  it('boots with the zero-config default when configPath is omitted', () => {
    // configPath omitted entirely (exactOptionalPropertyTypes) — resolveConfig()
    // returns the default and startServer does not throw.
    const handle = startServer({ dbPath: ':memory:', port: 0 });
    expect(() => handle.close()).not.toThrow();
  });
});
