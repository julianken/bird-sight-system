#!/usr/bin/env tsx
import { serve } from '@hono/node-server';
import { createPool } from '@bird-watch/db-client';
import { createApp } from './app.js';

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error('DATABASE_URL not set');

  const pool = createPool({ databaseUrl: dbUrl });
  const app = createApp({ pool });
  const port = Number(process.env.PORT ?? 8787);
  serve({ fetch: app.fetch, port });
  console.log(`Read API listening on http://localhost:${port}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
