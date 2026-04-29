// Smoke tests for the photo-server Worker's pure helpers.
//
// We can't run the full Worker fetch handler here without miniflare/wrangler,
// but the Content-Type lookup is a pure function — exporting and testing it
// independently catches the most common bugs (typos in the extension table,
// case-sensitivity slips, default fallback regressions).
//
// Run with:  node --test infra/workers/photo-server.test.js
// Node 20+'s built-in test runner is sufficient here; no devDeps needed.
// `infra/` is not an npm workspace, so vitest is not on the PATH at this
// level.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { contentTypeFor } from './photo-server.js';

describe('contentTypeFor', () => {
  it('returns image/jpeg for .jpg', () => {
    assert.equal(contentTypeFor('vermfly.jpg'), 'image/jpeg');
  });

  it('returns image/jpeg for .jpeg', () => {
    assert.equal(contentTypeFor('vermfly.jpeg'), 'image/jpeg');
  });

  it('returns image/png for .png', () => {
    assert.equal(contentTypeFor('vermfly.png'), 'image/png');
  });

  it('returns image/webp for .webp', () => {
    assert.equal(contentTypeFor('vermfly.webp'), 'image/webp');
  });

  it('returns application/octet-stream for unknown extensions', () => {
    assert.equal(contentTypeFor('vermfly.gif'), 'application/octet-stream');
    assert.equal(contentTypeFor('vermfly.tiff'), 'application/octet-stream');
    assert.equal(contentTypeFor('no-extension'), 'application/octet-stream');
    assert.equal(contentTypeFor(''), 'application/octet-stream');
  });

  it('is case-insensitive on the extension', () => {
    // R2 keys are case-sensitive, but a key like `Vermfly.JPG` should still
    // get the right Content-Type if it ever lands.
    assert.equal(contentTypeFor('vermfly.JPG'), 'image/jpeg');
    assert.equal(contentTypeFor('vermfly.PNG'), 'image/png');
    assert.equal(contentTypeFor('vermfly.WebP'), 'image/webp');
  });
});
