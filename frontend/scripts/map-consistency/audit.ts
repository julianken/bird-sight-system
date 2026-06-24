// frontend/scripts/map-consistency/audit.ts
import { chromium } from '@playwright/test';
import { openView } from './camera.js';
import { captureView } from './capture.js';

async function probe(url: string): Promise<void> {
  const parsed = new URL(url);
  const scope = parsed.searchParams.get('state') ?? 'us';
  const [zoom, lat, lng] = parsed.hash.replace('#map=', '').split('/').map(Number);
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    const center = { lng, lat };
    const { page, raw } = await openView(context, `${parsed.protocol}//${parsed.host}`, { scope, center, zoom, viewport: 'desktop' });
    console.log(JSON.stringify(await captureView(page, raw, { scope, viewport: 'desktop', zoom, center }), null, 2));
  } finally {
    await browser.close();
  }
}

const argv = process.argv.slice(2);
const i = argv.indexOf('--probe');
if (i >= 0 && argv[i + 1]) {
  probe(argv[i + 1]).catch((e) => { console.error(e); process.exit(1); });
} else {
  console.error('C2: --probe <url>. Full --samples loop lands in C3 (#…).');
  process.exit(1);
}
