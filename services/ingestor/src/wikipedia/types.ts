// Public type contract for the Wikipedia REST summary client. Consumers
// (child #371's `run-descriptions.ts` writer + sanitization step) depend
// only on this shape — nothing about the raw REST response leaks across the
// module boundary.

/**
 * Wikipedia REST summary endpoint payload, projected to the fields the
 * descriptions writer cares about plus the conditional-GET ETag.
 *
 * Discriminated union on `notModified`:
 * - `{ notModified: false, ... }` — the page was fetched fresh; the writer
 *   sanitizes `extractHtml` via DOMPurify and persists.
 * - `{ notModified: true, etag }` — the page is unchanged since `priorEtag`;
 *   the writer skips DOMPurify and the DB write entirely.
 *
 * The 404 case (deleted/renamed page) is signaled by `null` from
 * `fetchWikipediaSummary`, not by a third union arm — that keeps the
 * `if (result === null) skip; else use(result)` shape clean and avoids a
 * three-way switch at every call site.
 */
export type WikipediaSummary =
  | {
      notModified: false;
      /** Wikipedia's `extract_html` — sanitize via DOMPurify before persisting (child #371). */
      extractHtml: string;
      /** Wikipedia's `revision` (string id of the revision the extract came from). */
      revisionId: string;
      /** All Wikipedia text extracts ship under CC-BY-SA-4.0 (https://en.wikipedia.org/wiki/Wikipedia:Copyrights). */
      license: 'CC-BY-SA-4.0';
      /**
       * `ETag` response header value, used as `priorEtag` on the next refresh.
       * `null` when the upstream omits the header (rare, but defended against
       * so consumers don't silently store `'null'` in a NOT NULL column).
       */
      etag: string | null;
    }
  | {
      notModified: true;
      /**
       * On 304, this is `res.headers.get('etag') ?? opts.priorEtag`. Reaching
       * the 304 arm requires having sent `If-None-Match`, which requires
       * `opts.priorEtag` — so by construction `etag` is always a defined
       * string here. Typed as `string` (not `string | null`) so the writer
       * can use it without a non-null assertion.
       */
      etag: string;
    };
