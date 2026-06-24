// frontend/scripts/map-consistency/probe.ts
// C2 single-view probe, extracted from audit.ts (#1269) so audit.ts stays small.
import { chromium } from '@playwright/test';
import { openView } from './camera.js';
import { captureView } from './capture.js';

/** Open one view at the camera encoded in `url` and print its ViewSnapshot. */
export async function probe(url: string): Promise<void> {
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
