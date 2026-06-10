import { openDb } from '../db.js';
import { createServer } from './index.js';

export interface ServeOptions { dbPath: string; port: number }

export function startServer(opts: ServeOptions): { close: () => void } {
  const db = openDb(opts.dbPath);   // Slice 4's opener; opens ./review.sqlite by default
  const app = createServer(db);
  const server = app.listen(opts.port, () => {
    // eslint-disable-next-line no-console
    console.log(`review server on http://localhost:${opts.port}  (db: ${opts.dbPath})`);
  });
  return { close: () => { server.close(); db.close(); } };
}
