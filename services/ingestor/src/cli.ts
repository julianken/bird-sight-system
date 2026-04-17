#!/usr/bin/env tsx
import { createPool, closePool } from '@bird-watch/db-client';
import { runIngest } from './run-ingest.js';
import { runHotspotIngest } from './run-hotspots.js';
import { runBackfill } from './run-backfill.js';

const KIND = process.argv[2] ?? 'recent';

async function main() {
  const apiKey = process.env.EBIRD_API_KEY;
  const dbUrl = process.env.DATABASE_URL;
  if (!apiKey) throw new Error('EBIRD_API_KEY not set');
  if (!dbUrl) throw new Error('DATABASE_URL not set');

  const pool = createPool({ databaseUrl: dbUrl });
  try {
    let summary: unknown;
    if (KIND === 'recent') {
      summary = await runIngest({ pool, apiKey, regionCode: 'US-AZ' });
    } else if (KIND === 'hotspots') {
      summary = await runHotspotIngest({ pool, apiKey, regionCode: 'US-AZ' });
    } else if (KIND === 'backfill') {
      summary = await runBackfill({ pool, apiKey, regionCode: 'US-AZ', days: 30 });
    } else {
      throw new Error(`Unknown kind: ${KIND}. Try recent | hotspots | backfill`);
    }
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await closePool(pool);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
