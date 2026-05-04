# Cloudflare provider v4 → v5 — operator apply checklist

This is the operator-side bridge for `feat/cloudflare-v5-migration`. The
HCL was authored on the branch (commits C1–C3) but **no `terraform apply`
was run by the implementer** — production at bird-maps.com is live.
Julian runs the steps below by hand, in order, between bot review and
queue-merge.

Plan reference:
`docs/plans/2026-05-03-cloudflare-provider-v5-migration.md` (§3 commit
gates, §5 forward-recovery).

## Pre-flight

### P5 — back up state and record the serial number

Plan §2 P5. Run from `infra/terraform/`:

```bash
terraform state pull > /tmp/tfstate-pre-cf-v5-$(date -u +%Y%m%dT%H%M%SZ).backup
ls -lh /tmp/tfstate-pre-cf-v5-*.backup     # confirm non-empty
jq '.serial' /tmp/tfstate-pre-cf-v5-*.backup
```

**Record the serial number** (paste it into your operator notes).
It is the only signal that decides whether catastrophic rollback
(plan §5) is safe versus requires escalation.

### P1 — confirm clean v4 surface

```bash
terraform state list | grep cloudflare_
```

Expected: exactly 8 resources (`cloudflare_pages_project.frontend`,
`cloudflare_pages_domain.root`, `cloudflare_record.{root, api, photos}`,
`cloudflare_r2_bucket.photos`, `cloudflare_workers_script.photo_server`,
`cloudflare_workers_route.photos`). No `map-v1` artifacts. If extras
appear, escalate before applying.

## Per-commit apply

### After C1 (provider bumped to `~> 4.52, >= 4.52.5`)

```bash
cd infra/terraform
terraform init -upgrade
terraform plan
terraform apply
```

**Gate G1** (plan §3): plan shows zero infra diffs (computed-attribute
refreshes only). Apply succeeds. If a real diff appears at this stage,
STOP — investigate before proceeding to C2.

### C2 lands as-authored on the branch (no apply needed)

C2 only rewrites HCL + adds `moved` blocks. Nothing is applied between
C2 and C3 — the v4 provider does not understand the v5 attribute names,
so any plan attempt here will error. Move on to C3.

### After C3 (provider pinned to `~> 5.19`)

```bash
cd infra/terraform
terraform init -upgrade
terraform plan -out=plan.bin
terraform show plan.bin > plan.txt
```

**Gate G3** (HARD, plan §3): plan shows zero `-/+ replace` on any
resource. State upgraders fire automatically; `moved` blocks re-key
the renamed resources in state without forcing recreation.

When pasting the plan summary into the PR or operator notes, paste only
**redacted (address, action) tuples** — never the full plan output, which
echoes account/zone/bucket identifiers.

If `tf-migrate verify-drift` is installed locally, run:

```bash
tf-migrate verify-drift --file plan.txt
```

(Exit code 0 expected. If `tf-migrate` is not installed, the manual gate
above is sufficient.)

### Apply

```bash
terraform apply plan.bin
terraform plan      # re-plan; expect empty or perpetual-only deltas
```

**Gate G4** (plan §3):

```bash
terraform state show cloudflare_r2_bucket.photos | grep prevent_destroy
# Expected: prevent_destroy = true
```

## Live smoke tests

**Gate G5** (plan §3 — run after the apply):

```bash
# Photos worker still serves objects from R2
curl -I https://photos.bird-maps.com/<known-key>           # → 200

# Cloud Run API still resolves through the unproxied CNAME
curl -I https://api.bird-maps.com/api/regions              # → 200

# DNS chain intact for api.*
dig +short api.bird-maps.com                               # → ghs.googlehosted.com

# Cloud Run's Let's Encrypt cert serves directly (proxied=false survived)
openssl s_client -connect api.bird-maps.com:443 \
  -servername api.bird-maps.com </dev/null 2>/dev/null \
  | openssl x509 -noout -issuer
# → issuer= /C=US/O=Let's Encrypt/CN=...

# Pages frontend still serves the React app at the apex
curl -sI https://bird-maps.com/ | head -5                  # → 200
```

If any of the five fail, see plan §5 (forward-recovery / catastrophic
path).

## Forward-recovery references

There is no real "rollback" once C3's apply runs — state is v5-shaped.
Per-resource recovery (`state rm` + `import`) is documented in plan §5
table. The catastrophic path (C3 apply errors past the first resource)
is the strict 7-step procedure in plan §5 — read it before invoking,
and **do not force-push** if the state serial diverged from the P5
backup.

## Mergify queue

Once Gates G1, G3, G4, G5 are all green, the PR is ready for the bot
review (`pr-workflow` skill → `julianken-bot` subagent). After bot
approval, queue with `@Mergifyio queue` (per `pr-workflow` SKILL.md).

## Post-merge follow-up

**Do NOT delete `moved.tf` blocks (or the inline `moved {}` blocks added
in C2) in this PR.** Wait ≥48h post-merge for one clean nightly
`terraform-plan-drift-check.yml` run against post-v5 main. Premature
deletion risks the nightly proposing destructive replaces if any
external operator inits a fresh `.terraform/` against pre-merge state.

After one clean nightly, file a follow-up PR (`infra(cf): remove moved
blocks after one clean nightly`) per plan §3 / §6 step 8.
