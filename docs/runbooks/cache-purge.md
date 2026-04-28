# Cache purge — `/api/silhouettes`

## When to run

Run `scripts/purge-silhouettes-cache.sh` after **any** change that mutates
the `family_silhouettes` table reaches production. Common triggers:

- A migration in the epic #251 series (#244, #245, #246, #249) lands on
  `main` and is applied to the production DB.
- An ad-hoc curation pass updates an SVG, color, or attribution row.
- A Phylopic seed-expansion script adds new `family_code` rows.

## What the purge does (and does not) invalidate

There are two caches between the database and the user's screen. The
script only touches one of them.

| Tier              | What it is                                            | TTL                        | Touched by `purge-silhouettes-cache.sh`? |
| ----------------- | ----------------------------------------------------- | -------------------------- | ---------------------------------------- |
| **Cloudflare CDN** | Edge copy at the colo nearest the requesting user     | Honors `Cache-Control`     | **Yes** — purged within ~30s             |
| **User browser**   | Per-user copy in each visitor's HTTP cache            | `max-age=604800` (7 days)  | **No** — held until that user's clock ticks |

`/api/silhouettes` is served with `Cache-Control: public, max-age=604800`
(see `services/read-api/src/cache-headers.ts`). Notably, that header
**no longer carries `immutable`** — issue #252 removed it precisely so
browsers will revalidate when their per-user `max-age` clock expires
instead of holding the response untouchably for the full week.

The cause-effect chain for a curation update is therefore:

1. The migration lands; the API now returns the new SVG/color/attribution.
2. The operator runs `purge-silhouettes-cache.sh`. Within ~30s the
   Cloudflare edge copy is gone.
3. The next time a user's browser actually goes to the network for
   `/api/silhouettes` (either a cold fetch or a conditional revalidation
   after `max-age` expiry), the request reaches the API and gets the
   fresh bytes. Without the purge, the edge would still hand back the
   stale copy until its own TTL ticked.
4. **Browser caches turn over per response `max-age` regardless of the
   purge.** Most users see fresh data within hours (whenever their
   browser's TTL next ticks); a worst-case user who fetched right before
   the migration holds stale bytes for up to 7 days from their last
   request, then revalidates and picks up the new copy.

If you need a hard guarantee that every user sees the new data
immediately, neither the CDN purge nor the existing `max-age` window can
provide it — that would require a versioned URL (e.g. `/api/silhouettes?v=2`)
which we deliberately do not use.

## How to run

The script is a one-liner around the Cloudflare zone-purge API:

```bash
CLOUDFLARE_ZONE_ID=... CLOUDFLARE_API_TOKEN=... \
  ./scripts/purge-silhouettes-cache.sh
```

Optional override for staging or alternate hosts:

```bash
API_HOST=staging-api.bird-maps.com ./scripts/purge-silhouettes-cache.sh
```

Use `--dry-run` to confirm the request shape without calling the API
(this is the path CI exercises so the script can't rot silently):

```bash
CLOUDFLARE_ZONE_ID=... CLOUDFLARE_API_TOKEN=... \
  ./scripts/purge-silhouettes-cache.sh --dry-run
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
