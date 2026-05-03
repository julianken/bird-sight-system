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
