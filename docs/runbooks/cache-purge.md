# Cache purge — `/api/silhouettes`

## When to run

Run `scripts/purge-silhouettes-cache.sh` after **any** change that mutates
the `family_silhouettes` table reaches production. Common triggers:

- A migration in the epic #251 series (#244, #245, #246, #249) lands on
  `main` and is applied to the production DB.
- An ad-hoc curation pass updates an SVG, color, or attribution row.
- A Phylopic seed-expansion script adds new `family_code` rows.

`/api/silhouettes` is served with `Cache-Control: public, max-age=604800`
(see `services/read-api/src/cache-headers.ts`). Without `immutable`,
browsers re-validate at expiry — but they still serve cached bytes for
up to a week before that. A Cloudflare edge purge invalidates both
the CDN copy *and* (via the next conditional revalidation) the browser
copy, so updated silhouettes reach users on their next request.

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

`CLOUDFLARE_ZONE_ID` and `CLOUDFLARE_API_TOKEN` are not yet wired into a
shared secret store for ops use. **TODO:** add them to GitHub Actions
repository secrets (under Settings → Secrets and variables → Actions)
once the credential plumbing for #251 follow-ups lands. Until then,
operators pull the values from the Cloudflare dashboard:

- Zone ID: dashboard → `bird-maps.com` → Overview → right sidebar.
- API token: dashboard → My Profile → API Tokens → create a token with
  scope `Zone | Cache Purge | bird-maps.com`. Rotate after any
  individual operator rotation.

## Branch-merge ordering (epic #251 → version-one → main)

This runbook ships in the same PR as the `cache-headers.ts` `immutable`
removal (issue #252, base branch `version-one`). Both are
documentation-grade changes — order **into** `version-one` doesn't
matter relative to the DB migrations from #244, #245, #246, and #249.

The constraint is on the *outbound* side: when `version-one` is merged
into `main` for a release that includes any of those migrations, the
`cache-headers.ts` change **must be in the same merge**. Otherwise the
new silhouette rows land in production but get masked by the still-
`immutable` Cache-Control directive for up to seven days.

In practice this means: do not split the epic across two
`version-one → main` merges. Either ship the whole epic together, or
back this PR out of the partial release.
