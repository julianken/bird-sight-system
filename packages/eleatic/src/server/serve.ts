/**
 * `startServer` — boot the eleatic explorer. Opens `eval.sqlite` via E1's
 * `openStore`, resolves the config (zero-config default when `--config` omitted),
 * builds the app via `createApp`, listens, and returns `{ close }` that shuts
 * down both the HTTP server and the db. Modelled on
 * `tools/photo-curation/src/server/serve.ts`.
 */

import { openStore } from '../store.js';
import { resolveConfig } from '../config.js';
import { createApp } from './app.js';

export interface ServeOptions {
  dbPath: string;
  port: number;
  /** Optional eleatic config JSON; omitted -> zero-config default. */
  configPath?: string;
}

export function startServer(opts: ServeOptions): { close: () => void } {
  const store = openStore(opts.dbPath); // opens eval.sqlite (WAL, IF NOT EXISTS — E1)
  const cfg = resolveConfig(opts.configPath); // zero-config default when omitted
  const app = createApp(store, cfg);
  const server = app.listen(opts.port, () => {
    console.log(`eleatic on http://localhost:${opts.port}  (db: ${opts.dbPath})`);
  });
  return {
    close: () => {
      server.close();
      store.close();
    },
  };
}
