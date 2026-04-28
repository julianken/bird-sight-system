# Infrastructure

Terraform configuration for the bird-watch system, managing GCP (Cloud Run,
Artifact Registry, Secret Manager, Cloud Scheduler), Neon (Postgres), and
Cloudflare (Pages, DNS).

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

## Map-v1 tile pipeline (Cloudflare R2 + Workers)

The basemap tile infrastructure added in PR #164 is managed by
`infra/terraform/map-v1.tf`. It consists of four Cloudflare resources:

| Terraform resource | Description |
|---|---|
| `cloudflare_r2_bucket.pmtiles` | R2 bucket `birdwatch-pmtiles` — stores the AZ `.pmtiles` archive |
| `cloudflare_workers_script.map_server` | Workers script `birdwatch-map-server` — serves tiles from R2 with CORS headers |
| `cloudflare_workers_route.map_tiles` | Workers route binding `tiles.bird-maps.com/*` to the script |
| `cloudflare_record.tiles` | DNS CNAME `tiles.bird-maps.com` (proxied) — required for the Worker route to fire |

### Terraform import required before apply

These four resources were created manually (outside Terraform) when PR #164
shipped. They exist in Cloudflare but are absent from Terraform state, which
means a bare `terraform apply` would attempt to create duplicates and fail.

Run `terraform import` for each resource before applying changes to
`map-v1.tf`. Tracked in issue #235 (allowlist expires 2026-05-08); see
issue #298 for current status.

```bash
cd infra/terraform

terraform import cloudflare_r2_bucket.pmtiles <account_id>/birdwatch-pmtiles
terraform import cloudflare_workers_script.map_server <account_id>/birdwatch-map-server
terraform import cloudflare_workers_route.map_tiles <zone_id>/<route_id>
terraform import cloudflare_record.tiles <zone_id>/<record_id>
```

Until the import is complete, these resources are suppressed in the nightly
drift-check via `.github/drift-allowlist.yml`.

## Migrating from local state

If you previously ran `terraform apply` with local state, migrate it to GCS:

```bash
cd infra/terraform
terraform init -migrate-state
```

Terraform will prompt you to confirm moving the state to the GCS backend.
After migration, delete the local `terraform.tfstate` and
`terraform.tfstate.backup` files.
