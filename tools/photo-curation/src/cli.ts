#!/usr/bin/env node
import { Command } from 'commander';
import { openDb, DEFAULT_DB_PATH } from './db.js';
import { sync } from './sources.js';
import { startServer } from './server/serve.js';

const API_BASE = process.env.READ_API_BASE ?? 'https://api.bird-maps.com';

const program = new Command();
program.name('photo-curate').description('Local bird-photo quality curation tool');

program
  .command('sync')
  .description('Snapshot live photos from prod read-api into photo_current (reviewed=0). Cheap, NO tokens — re-run to scan new photos.')
  .option('--species <code>', 'sync a single species code instead of the whole dictionary')
  .action(async (opts: { species?: string }) => {
    const db = openDb(DEFAULT_DB_PATH);
    let codes: string[];
    if (opts.species) {
      codes = [opts.species];
    } else {
      const res = await fetch(`${API_BASE}/api/species`, { headers: { accept: 'application/json' } });
      if (!res.ok) throw new Error(`read-api ${res.status} for /api/species`);
      const dict = (await res.json()) as Array<{ code: string }>;
      codes = dict.map(d => d.code);
    }
    const summary = await sync(db, codes, { apiBase: API_BASE });
    console.log(`[sync] ${JSON.stringify(summary, null, 2)}`);
    console.log('[sync] Next: run the score-current workflow to AI-score the reviewed=0 rows (default 10, --limit up to 100).');
    db.close();
  });

program
  .command('serve')
  .description('Start the local review server (default http://localhost:5180)')
  .option('--port <port>', 'port to bind', '5180')
  .option('--db <path>', 'review store path', DEFAULT_DB_PATH)
  .action((opts: { port: string; db: string }) => {
    // startServer opens the store via openDb and starts Express; the http server
    // holds the event loop open, so the process stays alive until Ctrl-C.
    startServer({ dbPath: opts.db, port: Number(opts.port) });
  });

program
  .command('apply-swaps')
  .description('Push approved photo_decision rows to the admin endpoint')
  .action(() => {
    console.error('[apply-swaps] not implemented in Slice 4 — the batched apply ships in Slice 8.');
    process.exit(0);
  });

program.parseAsync(process.argv);
