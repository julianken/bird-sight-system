# Cache purge — `/api/silhouettes`

## When to run

Run `scripts/cache/purge-silhouettes-cache.sh` after **any** change that mutates
the `family_silhouettes` table reaches production. Common triggers:

- A migration in the epic #251 series (#244, #245, #246, #249) lands on
  `main` and is applied to the production DB.
- An ad-hoc curation pass updates an SVG, color, or attribution row.
- A Phylopic seed-expansion script adds new `family_code` rows.

## What the purge does (and does not) invalidate

There are two caches between the database and the user's screen. The
header `/api/silhouettes` emits now scopes staleness almost entirely to
the CDN, and the script touches exactly that tier.

| Tier              | What it is                                            | TTL                                          | Touched by `purge-silhouettes-cache.sh`? |
| ----------------- | ----------------------------------------------------- | -------------------------------------------- | ---------------------------------------- |
| **Cloudflare CDN** | Edge copy at the colo nearest the requesting user     | `s-maxage=3600` (1h) + `stale-while-revalidate=7200` (2h grace) | **Yes** — purged within ~30s             |
| **User browser**   | Per-user copy in each visitor's HTTP cache            | None — `s-maxage` is CDN-only; a reload always hits the CDN | **No** — but there is effectively nothing to hold |

`/api/silhouettes` is served with
`Cache-Control: public, s-maxage=3600, stale-while-revalidate=7200`
(see `services/read-api/src/cache-headers.ts`). This is the #586 hot-path
treatment: `s-maxage` is a **CDN-only** directive — it does not apply to
private (browser) caches — so browsers are intentionally NOT asked to hold
stale copies. The CDN serves a cached object for up to 1h, then a further
2h of `stale-while-revalidate` grace while it refreshes from origin in the
background. (This supersedes the old `max-age=604800` / 7-day browser-hold
header this runbook was originally written against; issue #586 migrated the
hot read endpoints to `s-maxage` and #252's `immutable` discussion no longer
applies here.)

The cause-effect chain for a curation update is therefore:

1. The migration lands; the API now returns the new SVG/color/attribution.
2. The operator runs `purge-silhouettes-cache.sh`. Within ~30s the
   Cloudflare edge copy is gone.
3. The next request for `/api/silhouettes` reaches origin and the CDN
   caches the fresh bytes. Because browsers don't hold a private copy
   (no `max-age`), users pick up the new data on their next fetch — a hard
   reload always reaches the (now-fresh) CDN.
4. **Even without a purge, edge staleness self-heals within ~1h** (the
   `s-maxage` window), with up to 2h of SWR grace during which the edge
   serves the old copy while revalidating. The purge just collapses that
   ~1–3h tail to ~30s.

If you need a hard guarantee that every user sees the new data immediately,
the CDN purge is the lever — it drops the only meaningful cache tier in ~30s.
(There is no per-user browser `max-age` window left to wait out; a versioned
URL like `/api/silhouettes?v=2` remains a deliberate non-goal.)

## How to run

The script is a one-liner around the Cloudflare zone-purge API:

```bash
CLOUDFLARE_ZONE_ID=... CLOUDFLARE_API_TOKEN=... \
  ./scripts/cache/purge-silhouettes-cache.sh
```

Optional override for staging or alternate hosts:

```bash
API_HOST=staging-api.bird-maps.com ./scripts/cache/purge-silhouettes-cache.sh
```

Use `--dry-run` to confirm the request shape without calling the API
(this is the path CI exercises so the script can't rot silently):

```bash
CLOUDFLARE_ZONE_ID=... CLOUDFLARE_API_TOKEN=... \
  ./scripts/cache/purge-silhouettes-cache.sh --dry-run
```

## Where the secrets live

`CLOUDFLARE_ZONE_ID`, `CLOUDFLARE_API_TOKEN`, and `CLOUDFLARE_ACCOUNT_ID`
are wired as GitHub Actions repository secrets (verified 2026-04-27). For
ad-hoc local runs, pull the values from the Cloudflare dashboard.

## Branch-merge ordering (epic #251 → version-one → main)

This runbook ships in the same PR as the `cache-headers.ts` `immutable`
removal (issue #252, base branch `version-one`). Both are
documentation-grade changes — order **into** `version-one` doesn't
matter relative to the DB migrations from #244, #245, #246, and #249.

The constraint is on the *outbound* side: when `version-one` is merged
into `main` for a release that includes any of those migrations, the
`cache-headers.ts` change **must be in the same merge**. Otherwise the
new silhouette rows land in production but get masked by the still-
`immutable` Cache-Control directive for up to seven days — and at that
point the CDN purge wouldn't help, because `immutable` instructs
browsers to skip even the conditional revalidation that the purge
relies on.

In practice this means: do not split the epic across two
`version-one → main` merges. Either ship the whole epic together, or
back this PR out of the partial release.
