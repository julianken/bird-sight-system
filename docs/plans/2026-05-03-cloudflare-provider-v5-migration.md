# Cloudflare Provider v4 → v5 Migration

**Date:** 2026-05-03
**Author:** Julian (orchestrated via 3-pass scout/route/plan/critic chain)
**Tracking PR:** supersedes #343 (closed); enabled by #390 (merged)
**Live infra:** bird-maps.com (GCP `bird-maps-prod`, Cloudflare account `bcbb962d…`, Neon `org-green-boat-15736536`)

## §1 Scope (post-verification)

After verification the migration's surface is dramatically smaller than #343 implied:

- **Issue #385 resolves to DELETE map-v1.tf**, not import. PR **#390** (`chore/remove-map-v1-tf-drift`) merged 2026-05-03. The live map uses OpenFreeMap; `map-v1.tf` was dead code.
- **Post-#390 surface = 8 resources only**: `cloudflare_pages_project.frontend`, `cloudflare_pages_domain.root`, `cloudflare_record.{root, api, photos}`, `cloudflare_r2_bucket.photos`, `cloudflare_workers_script.photo_server`, `cloudflare_workers_route.photos`. **No inline heredocs, no map_server, no extraction work.**
- **Tooling exists**: Cloudflare ships **`tf-migrate` v1.0.1** (May 1; pin this, not v1.0.0 which lacks the preflight-listing fix #293). It auto-rewrites HCL + generates `moved` blocks.
- **Transitional pin = v4.52.5** (mandatory per upstream upgrade guide; v4.52.7 is terminal but state migrators run at .5).
- **Critical attribute corrections** (verified against context7 v5 schema):
  - `cloudflare_workers_script`: `name` → `script_name`; **typed binding blocks unify into a single `bindings = [{ type = "r2_bucket", ... }]` list** (not `r2_bucket_binding = [...]`; the legacy attribute name disappears entirely)
  - `cloudflare_workers_route`: `script_name` → **`script`** (not `.id`); rhs becomes `cloudflare_workers_script.photo_server.script_name`
  - `cloudflare_record` → `cloudflare_dns_record` (3 records)
  - `cloudflare_pages_project`: name unchanged; **`subdomain` read-only attribute survives** (verified — apex CNAME ref at `frontend.tf:24` is fine)
  - `cloudflare_pages_domain`: name unchanged but **attribute renamed: `domain` → `name`** (confirmed via context7 v5 schema; G2 must verify tf-migrate rewrote it)
- **`prevent_destroy` on `r2_bucket.photos` MUST survive the rewrite.** tf-migrate's lifecycle-block handling is undocumented; verify with grep before commit.

## §2 Preconditions

| | Step | Gate |
|---|---|---|
| P0 | **#390 merged to main.** | DONE — `2f3a394 chore(infra): remove unapplied map-v1 Cloudflare TF (live map uses openfreemap) (#390)` |
| P1 | `terraform state list \| grep cloudflare_` returns exactly the 8 resources above; no `map-v1` artifacts. | If map-v1 entries present, escalate — #385's evidence is wrong. |
| P2 | **Close PR #343** (don't push to dependabot branch — title would be misleading at queue time, and there's a Dependabot rebase race). New branch `feat/cloudflare-v5-migration` off post-#390 main. | `gh pr close 343 --comment "Superseded — HCL migration cannot ride a dependabot branch."` |
| P3 | `gh pr list --state open --json files --jq '.[] \| select((.files // [])[].path \| startswith("infra/terraform"))'` returns empty. | No conflicting infra PRs in flight. |
| P4 | Install `tf-migrate v1.0.1` locally. | `tf-migrate --version` → `1.0.1`. |
| P5 | `terraform state pull > /tmp/tfstate-pre-cf-v5-$(date -u +%Y%m%dT%H%M%SZ).backup` — **record the serial number** for later rollback eligibility. | Backup file non-empty; serial captured. |
| P6 | **Apply-freeze announcement.** Pin a 24–48h "no terraform apply from main" window in `infra/README.md` on commit 1; post in any team channel. Without this, any parallel `apply` from `main` (still on `~> 4.20`) during the PR lifetime can rewrite state schema backward. | README banner committed in C1. |

## §3 Commit sequence

To minimize the wall-clock skew between C1's local apply and the merge of C4, **do C1 → apply → C2 → C3 → apply → C4 → apply → push branch in one session**.

### C1 — `infra(cf): bump provider to v4.52.5 transitional + apply-freeze banner`

- `infra/terraform/versions.tf`: `version = "~> 4.52, >= 4.52.5"`
- `infra/README.md`: apply-freeze banner with date range
- Operator: `terraform init -upgrade && terraform plan && terraform apply`
- **Gate G1**: plan shows zero infra diffs (or computed-attr refreshes only); apply succeeds.

### C2 — `infra(cf): tf-migrate v4 → v5 HCL rewrite + moved blocks`

- Operator: `tf-migrate migrate --source-version v4 --target-version v5 --dry-run > /tmp/migrate.diff` (review), then live run.
- Commit the rewritten `.tf` files + auto-generated `moved.tf` verbatim. Diff stats in commit body (lines added/removed per file).
- **Gate G2** (pre-commit, MUST pass before commit lands):
  - `grep -A2 'resource "cloudflare_r2_bucket" "photos"' infra/terraform/photos.tf | grep prevent_destroy` → hit (lifecycle survived).
  - `grep -rn "MIGRATION WARNING" infra/terraform/` → either empty, or every occurrence addressed in commit body.
  - `tf-migrate migrate --dry-run` → idempotent (zero remaining migrations).
  - `terraform validate` passes.
  - Manual spot-check: `cloudflare_workers_route.photos` rhs reads `cloudflare_workers_script.photo_server.script_name` (not `.id`, not `.name`).
  - **Bindings shape**: `grep -E '^\s*bindings\s*=\s*\[' infra/terraform/photos.tf` → hit; `grep -E 'r2_bucket_binding\s*[={]' infra/terraform/photos.tf` → empty (legacy attribute name fully removed).
  - **Pages domain rename**: `grep -E '^\s*name\s*=\s*var\.domain' infra/terraform/frontend.tf` → hit on the `cloudflare_pages_domain.root` block; `grep -E '^\s*domain\s*=\s*var\.domain' infra/terraform/frontend.tf` → empty.
  - `frontend.tf` `api` record retains `proxied = false` (Cloud Run TLS depends on this).
  - Determine the v5 provider version tf-migrate pinned in `versions.tf`; record it for C3.

### C3 — `infra(cf): pin provider to ~> {tf-migrate-resolved version}`

- `versions.tf` only — set the constraint to whatever tf-migrate resolved in C2 (likely `~> 5.19` or newer; **don't override** tf-migrate's choice or the constraint may conflict with what the lockfile pins).
- Operator: `terraform init -upgrade && terraform plan -out=plan.bin && terraform show plan.bin > plan.txt && tf-migrate verify-drift --file plan.txt`
- **Gate G3** (HARD): `verify-drift` exit code 0; plan shows zero `-/+ replace` on any resource. State upgraders fire automatically. Paste **redacted (address, action) tuples** in commit body — never full plan output (echoes account/zone/bucket identifiers).

### C4 — `infra(cf): apply v5 migration`

- Operator: `terraform apply plan.bin`. Re-plan; expect empty or perpetual-only deltas.
- **Gate G4**: post-apply plan empty/perpetual-only; `terraform state show cloudflare_r2_bucket.photos` shows `prevent_destroy = true`.
- **Gate G5** (live smoke):
  - `curl -I https://photos.bird-maps.com/<known-key>` → 200
  - `curl -I https://api.bird-maps.com/api/regions` → 200
  - `dig +short api.bird-maps.com` → `ghs.googlehosted.com`
  - `openssl s_client -connect api.bird-maps.com:443 -servername api.bird-maps.com </dev/null 2>/dev/null | openssl x509 -noout -issuer` → `Let's Encrypt` (Cloud Run cert chain intact, proxied=false survived)
  - `https://bird-maps.com/` serves React app
- **Do NOT delete `moved.tf` in this PR.** Leave it for ≥1 nightly drift-check cycle (~48h post-merge) — premature deletion risks the nightly proposing destructive replaces if any external operator inits a fresh `.terraform/` against pre-merge state.

### Follow-up PR (~48h after C4 merges) — `infra(cf): remove moved.tf after one clean nightly`

- Triggered by: `terraform-plan-drift-check.yml` nightly fires clean against post-v5 main (workflow is `schedule + workflow_dispatch` only — does NOT run on PR, so the verification window is post-merge).

**No knip rule needed** (no new files added — `photo-server.js` already in ignore set).

## §4 What CI does and doesn't catch

- **Mergify queue gate** (test, lint, build, e2e): trivially passes — no app code changed.
- **`terraform-plan-drift-check.yml`** is `schedule + workflow_dispatch` ONLY — does NOT trigger on the PR. Verification of v5 cleanliness lands at first nightly (~03:00 America/Phoenix post-merge). Subscribe to that workflow's notifications for the post-merge night.
- **There is no `terraform validate` gate yet** — #242's Phase 1 was bundled into the round-1 plan but pulled in round 2 to keep this PR scoped. File as a follow-up: now that v5 has shipped, add `terraform-validate` workflow + branch-protection requirement + `.mergify.yml` gate. Without it, a future v6 bump or HCL typo could re-slip past CI.

## §5 Forward-recovery (not rollback)

Once C4's `apply` runs, state is v5-shaped — there is no real rollback. Per-resource recovery if catastrophe strikes mid-apply:

| Resource | Class | Recovery |
|---|---|---|
| `pages_project.frontend` | Idempotent re-create (~5–15 min real outage if subdomain auto-assigns differently and apex CNAME flips during DNS propagation; **not** the "1 min" round-2 plan claimed). Pre-flight: `terraform plan -target=cloudflare_pages_project.frontend` to assert subdomain stability. | `state rm` + `import <account_id>/<project_name>` |
| `pages_domain.root` | Idempotent | `import <account_id>/<project_name>/<domain>` |
| `dns_record.{root, api, photos}` | Idempotent | `import <zone_id>/<record_id>` |
| `r2_bucket.photos` | Forward-only (`prevent_destroy` blocks destroy — bucket data is safe). | `import <account_id>/<bucket_name>` |
| `workers_script.photo_server` | Idempotent (atomic CF edge cutover, single-digit-second). | `import <account_id>/<script_name>` |
| `workers_route.photos` | Idempotent | `import <zone_id>/<route_id>` |

**Catastrophic path** (C4 apply errors past the first resource), strict order:
1. `terraform state pull` current state → compare serial to P5 backup serial.
2. If serials diverge (someone wrote to state during the window): **escalate, do not force-push** — manual reconciliation in `terraform state` required. STOP.
3. If serials match (no intervening writes): `git revert` C4 → C2 commits locally (HCL back to v4 shape).
4. **Wipe `.terraform/`** (`rm -rf infra/terraform/.terraform infra/terraform/.terraform.lock.hcl`) — without this, the v5 plugin still resident in the working tree will re-trigger state upgraders on the next `init`, defeating the rollback.
5. `terraform init` (re-pins v4.52.5 from the reverted `versions.tf`).
6. `terraform state push -force /tmp/tfstate-pre-cf-v5-*.backup`.
7. `terraform plan` — must be empty against v4.52.5. If any diff appears, rollback failed; escalate.

## §6 Sequencing

1. **#390 merges to main** — DONE 2026-05-03.
2. Close #343 with comment linking to the new branch.
3. Open `feat/cloudflare-v5-migration` off post-#390 main.
4. Operator runs C1–C4 + applies + smoke-tests in one window. Maintain apply-freeze through merge.
5. Push branch. Open PR with each commit's redacted `(address, action)` plan summary in body. Screenshots: N/A (infra-only). Bot review via `pr-workflow` skill.
6. Mergify queues against main's existing `.mergify.yml` (queue config evaluated at default-branch level, not PR head — so we don't modify `.mergify.yml` here).
7. Post-merge: monitor first nightly drift-check.
8. ~48h later, follow-up PR removing `moved.tf`.
9. Separate follow-up: re-attempt #242 (terraform-validate workflow + Mergify gate) now that v5 is the baseline.

## §7 Honest open items

- **tf-migrate's lifecycle-block preservation is undocumented** — G2 grep is the only safety net. If tf-migrate strips it, manually re-add and document.
- **Apply-freeze depends on team discipline** — there's no automated lock. If the team grows or someone misses the banner, racing applies are a real risk. Long-term fix: GCS object-versioning on the state bucket + Terraform state locking via DynamoDB-equivalent (Cloud Storage's built-in lock).
- **No automated `terraform validate` gate post-merge** — the original sin that let #343 reach review still exists. File as immediate follow-up.
- **Compatibility_date on `photo_server`** — v5 may surface as `MIGRATION WARNING`. G2 grep catches it; address in C2 if surfaced, defer if not.

## Methodology

This plan was produced by a 3-pass investigation chain:

1. **Scout pass** — single agent inventoried Cloudflare resources, read bot's BLOCKER findings on PR #343, cross-checked against the v5 upgrade guide, identified 3 routing domains.
2. **Routing pass** — 3 parallel investigation agents, one per domain (DNS records; Workers + bindings + routes; Pages + CI gate). Each produced copy-pasteable HCL + open questions.
3. **Plan ↔ critic ×2** — round-1 planner synthesized the 3 reports; round-1 critic surfaced 3 BLOCKERs + 6 IMPORTANTs (notably: presupposed #385 resolution, unverified compatibility_date schema, rollback-theater for schema mutations). Round-2 planner did its own verification (discovered #390 already exists, `tf-migrate` exists, terminal v4 is .7-but-transitional-is-.5) and produced this plan. Round-2 critic caught one hallucination (`workers_route.script` rhs is `script_name` not `.id`) plus a real provider-skew window during PR lifetime — both fixed in §1 and §2.P6 / §3 above.
