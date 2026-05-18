import { serve } from '@hono/node-server';
import { createPool } from '@bird-watch/db-client';
import { createApp, type AppPool } from './app.js';
import { createStorage } from './storage.js';
import { createDualWritePool } from './dual-pool.js';

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error('DATABASE_URL not set');
  const token = process.env.ADMIN_API_TOKEN;
  if (!token) throw new Error('ADMIN_API_TOKEN not set');

  const primary = createPool({ databaseUrl: dbUrl });

  // Neon → Cloud SQL migration: when SECONDARY_DATABASE_URL is set, every
  // write goes to both pools. When unset, behaviour is identical to the
  // pre-migration single-pool path.
  const secondaryUrl = process.env.SECONDARY_DATABASE_URL;
  let pool: AppPool;
  if (secondaryUrl) {
    const secondary = createPool({ databaseUrl: secondaryUrl });
    pool = createDualWritePool({ primary, secondary, surface: 'silhouette' });
    console.log('Admin API: dual-write enabled (primary + secondary)');
  } else {
    pool = primary;
  }

  const app = createApp({ pool, storage: createStorage(), token });
  const port = Number(process.env.PORT ?? 8788);
  serve({ fetch: app.fetch, port });
  console.log(`Admin API listening on http://localhost:${port}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
