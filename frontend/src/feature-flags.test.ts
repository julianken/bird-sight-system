import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('feature-flags', () => {
  beforeEach(() => {
    vi.resetModules(); // re-import so the top-level env read re-runs.
  });

  it('isCellPopoverEnabled() returns true when VITE_FF_CELL_POPOVER === "true"', async () => {
    vi.stubEnv('VITE_FF_CELL_POPOVER', 'true');
    const { isCellPopoverEnabled } = await import('./feature-flags.js');
    expect(isCellPopoverEnabled()).toBe(true);
  });

  it('isCellPopoverEnabled() returns false when VITE_FF_CELL_POPOVER === "false"', async () => {
    vi.stubEnv('VITE_FF_CELL_POPOVER', 'false');
    const { isCellPopoverEnabled } = await import('./feature-flags.js');
    expect(isCellPopoverEnabled()).toBe(false);
  });

  it('isCellPopoverEnabled() returns false when VITE_FF_CELL_POPOVER is undefined', async () => {
    vi.stubEnv('VITE_FF_CELL_POPOVER', undefined as unknown as string);
    const { isCellPopoverEnabled } = await import('./feature-flags.js');
    expect(isCellPopoverEnabled()).toBe(false);
  });

  it('isCellPopoverEnabled() returns false for non-canonical truthy values', async () => {
    // Defensive: only the literal string "true" enables. "1", "yes",
    // "TRUE" (case-different), etc. all DISABLE — strict matching keeps
    // the build/runtime contract simple.
    vi.stubEnv('VITE_FF_CELL_POPOVER', 'TRUE');
    const { isCellPopoverEnabled } = await import('./feature-flags.js');
    expect(isCellPopoverEnabled()).toBe(false);
  });
});
