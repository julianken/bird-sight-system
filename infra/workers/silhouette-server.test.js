// Smoke tests for the silhouette-server Worker's pure helpers (#502).
//
// We can't run the full Worker fetch handler here without miniflare/wrangler,
// but the Content-Type lookup is a pure function — exporting and testing it
// independently catches the most common bugs (typos in the extension table,
// case-sensitivity slips, default fallback regressions). Mirrors
// photo-server.test.js.
//
// Run with:  node --test infra/workers/silhouette-server.test.js
// Node 20+'s built-in test runner is sufficient here; no devDeps needed.
// `infra/` is not an npm workspace, so vitest is not on the PATH at this
// level.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { contentTypeFor } from './silhouette-server.js';

describe('contentTypeFor (silhouette-server)', () => {
  it('returns image/svg+xml for .svg', () => {
    assert.equal(contentTypeFor('family/cuculidae.deadbeef.svg'), 'image/svg+xml');
  });

  it('returns application/octet-stream for unknown extensions', () => {
    assert.equal(contentTypeFor('family/cuculidae.png'), 'application/octet-stream');
    assert.equal(contentTypeFor('family/cuculidae.jpg'), 'application/octet-stream');
    assert.equal(contentTypeFor('no-extension'), 'application/octet-stream');
    assert.equal(contentTypeFor(''), 'application/octet-stream');
  });

  it('is case-insensitive on the extension', () => {
    // R2 keys are case-sensitive, but a key like `cuculidae.SVG` should still
    // get the right Content-Type if it ever lands.
    assert.equal(contentTypeFor('family/cuculidae.SVG'), 'image/svg+xml');
    assert.equal(contentTypeFor('family/cuculidae.Svg'), 'image/svg+xml');
  });
});
