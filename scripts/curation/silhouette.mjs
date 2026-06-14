#!/usr/bin/env node
// scripts/curation/silhouette.mjs — admin CLI for the silhouette override admin-api (#502).
//
// Usage:
//   npm run silhouette set <family-code> <path-to-svg>
//   npm run silhouette unset <family-code>
//
// Env:
//   ADMIN_API_URL    — base URL of the admin-api (e.g. https://admin.bird-maps.com)
//   ADMIN_API_TOKEN  — bearer token (rotate via `openssl rand -hex 32`)

import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';

export async function runCli(argv) {
  const [sub, family, file] = argv;
  const base = process.env.ADMIN_API_URL;
  const token = process.env.ADMIN_API_TOKEN;
  if (!base || !token) {
    console.error('ADMIN_API_URL and ADMIN_API_TOKEN must be set in env');
    return 2;
  }
  if (sub !== 'set' && sub !== 'unset') {
    console.error('Usage: npm run silhouette set <family> <file>  |  unset <family>');
    return 2;
  }
  if (!family || !/^[a-z]+$/.test(family)) {
    console.error('Family code must be lowercase letters only');
    return 2;
  }
  const url = `${base.replace(/\/$/, '')}/admin/silhouettes/family/${family}`;

  if (sub === 'set') {
    if (!file) {
      console.error('Usage: npm run silhouette set <family> <file>');
      return 2;
    }
    const body = await readFile(file);
    const fd = new FormData();
    fd.set('file', new Blob([body], { type: 'image/svg+xml' }), basename(file));
    const res = await fetch(url, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}` },
      body: fd,
    });
    if (!res.ok) {
      console.error(`HTTP ${res.status}: ${await res.text()}`);
      return 1;
    }
    const body2 = await res.json();
    console.log(`OK: ${family} → ${body2.url}`);
    return 0;
  }

  // unset
  const res = await fetch(url, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    console.error(`HTTP ${res.status}: ${await res.text()}`);
    return 1;
  }
  console.log(`OK: ${family} reverted to _FALLBACK`);
  return 0;
}

// Run when invoked as a script (not when imported by tests).
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  runCli(process.argv.slice(2)).then(code => process.exit(code));
}
