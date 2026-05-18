import { serve } from '@hono/node-server';
import { createPool } from '@bird-watch/db-client';
import { createApp } from './app.js';
import { createStorage } from './storage.js';

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error('DATABASE_URL not set');
  const token = process.env.ADMIN_API_TOKEN;
  if (!token) throw new Error('ADMIN_API_TOKEN not set');

  const pool = createPool({ databaseUrl: dbUrl });

  const app = createApp({ pool, storage: createStorage(), token });
  const port = Number(process.env.PORT ?? 8788);
  serve({ fetch: app.fetch, port });
  console.log(`Admin API listening on http://localhost:${port}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
