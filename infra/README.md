# Infrastructure

Terraform configuration for the bird-watch system, managing GCP (Cloud Run
services + scheduled jobs, Cloud SQL for Postgres 16, Artifact Registry,
Secret Manager, Cloud Scheduler, Cloud Monitoring, GCS observations-archive,
BigQuery, Billing Budget) and Cloudflare (Pages, DNS, R2, Workers, cache &
rate-limit rulesets, Smart Tiered Cache). The Cloud Run footprint is two
services (`bird-read-api`, `bird-admin-api`) plus the ingestor and digest
jobs; Neon is decommissioned (no Neon provider in `versions.tf`).

## Remote state

Terraform state is stored in a GCS bucket to keep sensitive values (DB
passwords, API tokens) off local disk and to enable state locking for safe
concurrent operations.

| Property | Value |
|---|---|
| Bucket | `gs://bird-maps-tfstate` |
| Prefix | `terraform/state` |
| Location | `us-central1` |
| Versioning | Enabled |
| Public access | Prevented (uniform bucket-level access) |

## Getting started

### 1. Authenticate with GCP

```bash
gcloud auth application-default login
```

This writes Application Default Credentials that both `gcloud` and the
Terraform GCS backend use automatically. You must have at least
`roles/storage.objectUser` on the `bird-maps-tfstate` bucket.

### 2. Initialize Terraform

```bash
cd infra/terraform
terraform init
```

This downloads providers and connects to the remote GCS backend. No local
`terraform.tfstate` file is created.

### 3. Create a `terraform.tfvars` file

Copy the example and fill in real values:

```bash
cp terraform.tfvars.example terraform.tfvars
```

`terraform.tfvars` is gitignored (contains secrets). See `variables.tf` for
descriptions of each variable.

### 4. Plan and apply

```bash
terraform plan   # review changes
terraform apply  # apply (requires confirmation)
```

Local `apply` is the break-glass path. Day-to-day, infra changes reach prod via
CI — see **Deployment (CI)** below.

## Deployment (CI)

Infra deploys via `.github/workflows/deploy-infra.yml` (#825): every merge to
`main` that touches `infra/terraform/**` runs `terraform plan`, then pauses on
the `infra-prod` GitHub Actions environment for a required-reviewer approval
click before it runs `terraform apply` on the saved plan. Apply-time errors
surface within minutes of merge instead of accumulating silently. `workflow_dispatch`
runs the same gated plan→apply on demand.

The nightly `.github/workflows/terraform-plan-drift-check.yml` remains as the
read-only safety net: it catches out-of-band (console) drift that no merge would
produce, opening a `drift:automated` issue on novel drift.

The two coexist without fighting over the GCS state lock:

- **deploy-infra**: `concurrency` group `deploy-infra-${{ github.ref }}` with
  `cancel-in-progress: false` (never cancel a running apply — it can orphan the
  lock and half-apply the plan) + `-lock-timeout=120s`.
- **drift-check**: its own `concurrency` group + `-lock-timeout=60s`.

Because each holds the lock only briefly and waits (rather than erroring) if the
other holds it, a nightly plan that overlaps an apply queues behind it.

> **First-apply ordering (one-time):** the deploy SA needs
> `roles/storage.objectAdmin` on `gs://bird-maps-tfstate` (state writes), and the
> two known config bugs (`monitoring.tf` metric type, `cloudflare_tiered_cache`
> token scope — tracked separately) must be fixed before the first real apply, or
> it will fail on those resources. The `infra-prod` reviewer gate means even the
> first auto-fire waits for a human who can see the (still-dirty) plan and decline.

## Basemap tiles

The frontend basemap loads vector tiles from `tiles.openfreemap.org`
(MapLibre `positron` style) — see `frontend/src/components/map/basemap-style.ts`.
There is no Cloudflare-hosted tile pipeline. An earlier `map-v1.tf`
declaration of a self-hosted PMTiles + Worker pipeline was removed in #385
(declared but never applied; live map served exclusively from
OpenFreeMap since shipping 2026-04-19).

## Migrating from local state

If you previously ran `terraform apply` with local state, migrate it to GCS:

```bash
cd infra/terraform
terraform init -migrate-state
```

Terraform will prompt you to confirm moving the state to the GCS backend.
After migration, delete the local `terraform.tfstate` and
`terraform.tfstate.backup` files.
