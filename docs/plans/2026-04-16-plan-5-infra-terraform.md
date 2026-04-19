# Infrastructure & Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provision and deploy the full system on **GCP Cloud Run + Neon Postgres**, with all infrastructure managed by Terraform. Both compute and DB scale to zero. After `terraform apply` and the deploy scripts, the live URL serves the frontend that talks to the Read API on Cloud Run that reads from Neon, with the Ingestor running as a Cloud Run Job triggered by Cloud Scheduler.

**Architecture:** Two Cloud Run targets — a Service (Read API, HTTP, scale-to-zero, behind a CDN) and a Job (Ingestor, invoked by Cloud Scheduler on cron). Both ship as Docker containers in Google Artifact Registry; the same images run unchanged on AWS Fargate, Azure Container Apps, Fly Machines, or any Kubernetes cluster — that's the portability story. Neon Postgres is reached via its built-in pooler URL. The frontend deploys to Cloudflare Pages (free, unlimited bandwidth) with DNS managed by Cloudflare; could be moved to GCP Cloud Storage + Cloud CDN later if you want a single-cloud setup.

**Tech Stack:** Terraform, `hashicorp/google` provider, `kislerdm/neon` provider, `cloudflare/cloudflare` provider (for Pages + DNS), Docker, Google Cloud Run (Service + Job), Google Cloud Scheduler, Google Artifact Registry, Neon serverless Postgres + PostGIS.

**Cost estimate at hobbyist usage:** $0/month indefinitely. Cloud Run always-free tier (2M req/mo, 360k vCPU-sec, 180k GiB-sec) covers our load with several orders of magnitude headroom. Neon free tier (0.5 GB) covers years of AZ data. Cloudflare Pages free tier covers static hosting and DNS. Total monthly bill: $0.

**Depends on:** Plans 1, 2, 3, 4 must all be complete and tested locally.

---

## Prerequisites (one-time manual steps, NOT automatable)

These two steps must be completed out-of-band **before** the first `terraform apply`; otherwise the relevant Terraform resources will fail in ways that aren't obvious from the error message.

1. **Obtain `neon_org_id`.** The `kislerdm/neon` provider v0.7+ requires an organization ID on every `neon_project` — there is no default-org inference. Sign in to [console.neon.tech](https://console.neon.tech) and grab the org id from the URL (e.g. `org-green-boat-15736536`). Put it in `terraform.tfvars` as `neon_org_id`. Without this, `terraform apply` on a fresh Neon free-tier account fails with an opaque API error on the `neon_project` create step — see PR #68 (commit `6b92790`) for the full diagnosis.

2. **Verify `var.domain` in Google Search Console.** The `google_cloud_run_domain_mapping` resource in Task 9 will fail to apply unless Google has verified you own the domain. Go to [search.google.com/search-console](https://search.google.com/search-console), add `var.domain` as a property, and add the TXT record Google shows you to the zone at your DNS provider (Cloudflare, in our case). Wait for Search Console to confirm verification (usually <1 min after the record propagates). Only then run `terraform apply`. See PR #69 (commit `c01924e`).

Both of these are genuinely one-time (per-account, per-domain). They live here because subagents re-executing this plan verbatim will otherwise hit a wall at Task 2 and Task 9 respectively.

---

### Task 1: Scaffold the `infra/` directory + provider config

**Files:**
- Create: `infra/terraform/main.tf`
- Create: `infra/terraform/variables.tf`
- Create: `infra/terraform/versions.tf`
- Create: `infra/terraform/.gitignore`
- Create: `infra/terraform/terraform.tfvars.example`

- [ ] **Step 1: Write `versions.tf`**

```hcl
terraform {
  required_version = ">= 1.6.0"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.20"
    }
    neon = {
      source  = "kislerdm/neon"
      # 0.7+ is required: it exposes `database_host` / `database_host_pooler`
      # attributes on `neon_project` (so we don't need a regex to derive the
      # pooled host) and adds the now-mandatory `org_id` argument. See Task 2
      # and PR #68 (commit 6b92790).
      version = "~> 0.7"
    }
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 4.20"
    }
    docker = {
      source  = "kreuzwerker/docker"
      version = "~> 3.0"
    }
  }
}
```

- [ ] **Step 2: Write `variables.tf`**

```hcl
variable "gcp_project_id" {
  type        = string
  description = "GCP project ID (create one at console.cloud.google.com)."
}

variable "gcp_region" {
  type        = string
  default     = "us-west1"
  description = "Cloud Run + Artifact Registry region. us-west1 keeps latency to AZ users low."
}

variable "neon_api_key" {
  type        = string
  sensitive   = true
  description = "Neon API key (Neon dashboard → Settings → API keys)."
}

variable "neon_org_id" {
  type        = string
  description = "Neon organization ID (visible in console URL after sign-in, e.g. org-green-boat-15736536). Required by kislerdm/neon v0.7+; there is no default-org inference."
}

variable "cloudflare_account_id" {
  type        = string
  description = "Cloudflare account ID (used for Pages + DNS only)."
}

variable "cloudflare_api_token" {
  type        = string
  sensitive   = true
  description = "Cloudflare API token with Pages + DNS perms."
}

variable "cloudflare_zone_id" {
  type        = string
  description = "Cloudflare zone ID for `domain`."
}

variable "ebird_api_key" {
  type        = string
  sensitive   = true
  description = "eBird API key (ebird.org/api/keygen)."
}

variable "domain" {
  type        = string
  description = "Domain you control on Cloudflare, e.g. birdwatch.example.com"
}
```

- [ ] **Step 3: Write `main.tf`**

```hcl
provider "google" {
  project = var.gcp_project_id
  region  = var.gcp_region
}

provider "neon" {
  api_key = var.neon_api_key
}

provider "cloudflare" {
  api_token = var.cloudflare_api_token
}

# Enable required GCP APIs once
resource "google_project_service" "run" {
  service = "run.googleapis.com"
  disable_on_destroy = false
}
resource "google_project_service" "scheduler" {
  service = "cloudscheduler.googleapis.com"
  disable_on_destroy = false
}
resource "google_project_service" "artifactregistry" {
  service = "artifactregistry.googleapis.com"
  disable_on_destroy = false
}
resource "google_project_service" "secretmanager" {
  service = "secretmanager.googleapis.com"
  disable_on_destroy = false
}
```

- [ ] **Step 4: Write `terraform.tfvars.example`**

```hcl
gcp_project_id        = "REPLACE_ME"
gcp_region            = "us-west1"
neon_api_key          = "REPLACE_ME"
neon_org_id           = "REPLACE_ME"
cloudflare_account_id = "REPLACE_ME"
cloudflare_api_token  = "REPLACE_ME"
cloudflare_zone_id    = "REPLACE_ME"
ebird_api_key         = "REPLACE_ME"
domain                = "birdwatch.example.com"
```

- [ ] **Step 5: Write `.gitignore`**

`infra/terraform/.gitignore` (local to the Terraform dir):

```
.terraform/
.terraform.lock.hcl
terraform.tfstate
terraform.tfstate.backup
terraform.tfvars
*.auto.tfvars
```

ALSO append the following to the **repo-root** `.gitignore`. These patterns exist because actively hazardous files leaked into the working tree during the 2026-04-19 live deploy, and subsequent runs will re-create them. Source of truth: PR #61 (commit `86ca45d`).

```
# Playwright MCP runtime artifacts — may contain page snapshots of credential
# flows (API key creation, OAuth callbacks). Never commit.
.playwright-mcp/
cf-*.png
page-*.png
gcp-*.png

# Terraform state (contains DB passwords + API tokens). Use remote state
# instead; local tfstate should never be committed.
terraform.tfstate
terraform.tfstate.backup

# Per-user Claude Code workspace
.claude/
```

Why this matters: `terraform.tfstate` contains the Neon DB password and Cloudflare API token in plaintext. `.playwright-mcp/*.yml` snapshots capture DOM of whatever tab is open — including credential-entry flows. The `cf-*.png` / `gcp-*.png` / `page-*.png` patterns block the onboarding screenshots Playwright MCP saves at repo root during CF and GCP setup (22 files during the 2026-04-19 onboarding).

- [ ] **Step 6: Authenticate gcloud and Terraform**

```bash
gcloud auth login
gcloud auth application-default login
gcloud config set project <YOUR_PROJECT_ID>

cd infra/terraform
cp terraform.tfvars.example terraform.tfvars  # fill in real values
terraform init
terraform apply -target=google_project_service.run \
                -target=google_project_service.scheduler \
                -target=google_project_service.artifactregistry \
                -target=google_project_service.secretmanager
```

Expected: APIs enabled. Subsequent `terraform apply` calls won't re-prompt for these.

- [ ] **Step 7: Commit**

```bash
git add infra/terraform/{main.tf,variables.tf,versions.tf,terraform.tfvars.example,.gitignore}
git commit -m "infra: scaffold Terraform with GCP + Neon + Cloudflare providers"
```

---

### Task 2: Provision Neon Postgres

**Files:**
- Create: `infra/terraform/db.tf`

- [ ] **Step 1: Write `db.tf`**

Source of truth: shipped in PR #68 (commit `6b92790`). Three Neon-free-tier landmines are cleared in this version — each is commented inline below. Do not simplify these away without verifying against the current Neon plan limits at https://neon.tech/docs/introduction/plans.

```hcl
resource "neon_project" "birdwatch" {
  org_id     = var.neon_org_id
  name       = "bird-watch"
  region_id  = "aws-us-west-2" # close to gcp_region
  pg_version = 16

  # Neon Free tier caps history retention at 6h (21600s). Exceeding this
  # causes the Neon API to reject the project-create request.
  # See: https://neon.tech/docs/introduction/plans
  history_retention_seconds = 21600
}

resource "neon_database" "main" {
  project_id = neon_project.birdwatch.id
  branch_id  = neon_project.birdwatch.default_branch_id
  name       = "birdwatch"
  owner_name = neon_project.birdwatch.database_user
}

# Neon Free tier permits ONE read_write endpoint per branch; the project's
# auto-created default endpoint occupies that slot. Defining a second
# `neon_endpoint` of type `read_write` here would cause Neon to reject the
# apply. We rely on the default endpoint exposed via `database_host` /
# `database_host_pooler` on the project resource (added in kislerdm/neon
# v0.7.0), so no separate endpoint resource is needed.

locals {
  neon_pooled_url = "postgres://${neon_project.birdwatch.database_user}:${neon_project.birdwatch.database_password}@${neon_project.birdwatch.database_host_pooler}/${neon_database.main.name}?sslmode=require"
}

output "neon_db_url" {
  value     = "postgres://${neon_project.birdwatch.database_user}:${neon_project.birdwatch.database_password}@${neon_project.birdwatch.database_host}/${neon_database.main.name}?sslmode=require"
  sensitive = true
}

# Pooled URL — what Cloud Run uses. Each connection is multiplexed via PgBouncer.
output "neon_pooled_url" {
  value     = local.neon_pooled_url
  sensitive = true
}
```

Three hidden landmines for anyone skimming this:

1. **`org_id` is mandatory.** The Neon API requires it as of 2026-04; no default-org inference. Captured in `var.neon_org_id` (see Prerequisites). Previous plan drafts omitted this and failed at `terraform apply` time.
2. **Do not add a `neon_branch` resource.** Free tier allows one branch; the project auto-creates it. Reference it via `neon_project.birdwatch.default_branch_id`.
3. **Do not add a `neon_endpoint` resource.** Free tier allows one read_write endpoint per branch; the project's default endpoint already occupies that slot. Using the `database_host_pooler` / `database_host` project attributes replaces the old regex-based pooled-host derivation entirely.

- [ ] **Step 2: Apply**

```bash
terraform apply
```

Expected: Neon project + DB + pooled endpoint exist.

- [ ] **Step 3: Verify connectivity**

```bash
DB_URL=$(terraform output -raw neon_db_url)
psql "$DB_URL" -c "SELECT version();"
```

- [ ] **Step 4: Commit**

```bash
git add infra/terraform/db.tf
git commit -m "infra: provision Neon Postgres with pooled endpoint"
```

---

### Task 3: Apply migrations against Neon

**Files:**
- Create: `scripts/migrate-deploy.sh`

- [ ] **Step 1: Write the script**

```bash
#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL not set" >&2
  echo "Hint: export DATABASE_URL=\$(cd infra/terraform && terraform output -raw neon_db_url)" >&2
  exit 1
fi

echo "Enabling PostGIS on Neon..."
psql -v ON_ERROR_STOP=1 "$DATABASE_URL" -c "CREATE EXTENSION IF NOT EXISTS postgis;"

echo "Running migrations..."
npx node-pg-migrate up -m migrations -d "$DATABASE_URL"

echo "Done."
```

> Note (#52 follow-up): `node-pg-migrate`'s `-d` flag takes the **connection string itself**, not the name of an env var — a subtle but important distinction vs. the older `-d DATABASE_URL` usage (which would look up `process.env.DATABASE_URL`). Both happen to work in practice because the env var is also set, but the explicit pass is canonical. The CD workflow that runs this script on every push (issue #65, Wave 1.5 — not yet shipped) is what bundles issue #52's scripted variant. Until then, run locally from a trusted workstation.

- [ ] **Step 2: Make executable + run**

```bash
chmod +x scripts/migrate-deploy.sh
export DATABASE_URL=$(cd infra/terraform && terraform output -raw neon_db_url)
./scripts/migrate-deploy.sh
psql "$DATABASE_URL" -c "SELECT count(*) FROM regions;"
```

Expected: `9` regions, `15` silhouettes.

- [ ] **Step 3: Commit**

```bash
git add scripts/migrate-deploy.sh
git commit -m "infra: migration runner for Neon"
```

---

### Task 4: Google Artifact Registry for Docker images

**Files:**
- Create: `infra/terraform/registry.tf`

- [ ] **Step 1: Write `registry.tf`**

```hcl
resource "google_artifact_registry_repository" "birdwatch" {
  repository_id = "birdwatch"
  location      = var.gcp_region
  format        = "DOCKER"
  description   = "Container images for bird-watch services"

  depends_on = [google_project_service.artifactregistry]
}

output "artifact_registry_url" {
  value = "${var.gcp_region}-docker.pkg.dev/${var.gcp_project_id}/${google_artifact_registry_repository.birdwatch.repository_id}"
}
```

- [ ] **Step 2: Apply**

```bash
terraform apply
gcloud auth configure-docker $(terraform output -raw artifact_registry_url | cut -d/ -f1)
```

Expected: Registry exists; `docker push` to the registry URL is now authenticated.

- [ ] **Step 3: Commit**

```bash
git add infra/terraform/registry.tf
git commit -m "infra: Artifact Registry for Docker images"
```

---

### Task 5: Dockerize the Read API

**Files:**
- Create: `services/read-api/Dockerfile`
- Create: `services/read-api/.dockerignore`

- [ ] **Step 1: Write `services/read-api/Dockerfile`**

```dockerfile
# Build stage — uses the monorepo root context.
FROM node:20-alpine AS build
WORKDIR /repo

# Copy package manifests first for cached install.
COPY package.json package-lock.json ./
COPY tsconfig.base.json ./
COPY packages ./packages
COPY services/read-api ./services/read-api

RUN npm ci --workspaces --include-workspace-root --include=dev
RUN npm run build --workspace @bird-watch/shared-types
RUN npm run build --workspace @bird-watch/db-client
RUN npm run build --workspace @bird-watch/family-mapping
RUN npm run build --workspace @bird-watch/read-api

# Runtime stage — copy only what we need.
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080

COPY --from=build /repo/package.json /repo/package-lock.json ./
COPY --from=build /repo/packages ./packages
COPY --from=build /repo/services/read-api/package.json ./services/read-api/
COPY --from=build /repo/services/read-api/dist ./services/read-api/dist

RUN npm ci --omit=dev --workspaces --include-workspace-root

EXPOSE 8080
CMD ["node", "services/read-api/dist/local.js"]
```

- [ ] **Step 2: Write `services/read-api/.dockerignore`**

```
node_modules
dist
*.log
.env
.env.local
src/**/*.test.ts
```

- [ ] **Step 3: Build the image locally to confirm**

```bash
cd /Users/j/repos/bird-watch
docker build -f services/read-api/Dockerfile -t bird-read-api:local .
docker run --rm -p 8080:8080 -e DATABASE_URL="$DATABASE_URL" bird-read-api:local &
sleep 3
curl -i http://localhost:8080/health
docker kill $(docker ps -q --filter ancestor=bird-read-api:local)
```

Expected: `{"ok":true}`.

- [ ] **Step 4: Commit**

```bash
git add services/read-api/Dockerfile services/read-api/.dockerignore
git commit -m "feat(read-api): Dockerfile for Cloud Run"
```

---

### Task 6: Push Read API image + provision Cloud Run Service

**Files:**
- Create: `infra/terraform/read-api.tf`
- Create: `scripts/build-push.sh`

> **CORS middleware is baked into the Read API as of PR #67 (commit `ce309b0`).** `services/read-api/src/app.ts` registers `hono/cors` before all route handlers — preflight OPTIONS requests would 404 otherwise. The allowlist is driven by the `FRONTEND_ORIGINS` env var (see Step 3 below); defaults to prod + vite dev/preview origins. This is a Plan 3 concern but is mentioned here because the Cloud Run env config has to set `FRONTEND_ORIGINS` correctly for CORS to work in prod. `Vary: Origin` means CDN caches key per-origin; trivial at 3 origins.

- [ ] **Step 1: Write `scripts/build-push.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

REGISTRY=$(cd infra/terraform && terraform output -raw artifact_registry_url)
SERVICE="${1:?usage: build-push.sh <service> (read-api | ingestor)}"
TAG="${2:-latest}"

echo "Building $SERVICE → $REGISTRY/$SERVICE:$TAG ..."
docker buildx build --platform linux/amd64 \
  -f "services/$SERVICE/Dockerfile" \
  -t "$REGISTRY/$SERVICE:$TAG" \
  --push .

echo "Pushed $REGISTRY/$SERVICE:$TAG"
```

- [ ] **Step 2: Make executable + push**

```bash
chmod +x scripts/build-push.sh
./scripts/build-push.sh read-api latest
```

- [ ] **Step 3: Write `infra/terraform/read-api.tf`**

```hcl
# Store the Neon pooled URL in Secret Manager so we don't ship it in plain env.
resource "google_secret_manager_secret" "db_url" {
  secret_id = "bird-watch-db-url"
  replication { auto {} }
  depends_on = [google_project_service.secretmanager]
}

resource "google_secret_manager_secret_version" "db_url" {
  secret      = google_secret_manager_secret.db_url.id
  secret_data = local.neon_pooled_url
}

# Service account the Read API runs as.
resource "google_service_account" "read_api" {
  account_id   = "bird-read-api"
  display_name = "bird-watch Read API"
}

resource "google_secret_manager_secret_iam_member" "read_api_db" {
  secret_id = google_secret_manager_secret.db_url.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.read_api.email}"
}

resource "google_cloud_run_v2_service" "read_api" {
  name     = "bird-read-api"
  location = var.gcp_region

  template {
    service_account = google_service_account.read_api.email

    scaling {
      min_instance_count = 0   # true scale-to-zero
      max_instance_count = 5
    }

    containers {
      image = "${google_artifact_registry_repository.birdwatch.location}-docker.pkg.dev/${var.gcp_project_id}/${google_artifact_registry_repository.birdwatch.repository_id}/read-api:latest"

      ports { container_port = 8080 }

      resources {
        limits = { cpu = "1", memory = "256Mi" }
        cpu_idle = true                 # CPU only allocated during requests (cheaper)
        startup_cpu_boost = true        # quicker cold starts
      }

      env {
        name = "DATABASE_URL"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.db_url.secret_id
            version = "latest"
          }
        }
      }

      # CORS allowlist. The Read API's Hono app (services/read-api/src/app.ts,
      # shipped in PR #67 / commit ce309b0) installs `hono/cors` and reads this
      # env var as a comma-separated list, whitespace-trimmed. The default in
      # app.ts covers prod + vite dev/preview; override here only if you want
      # to lock it down further. Without CORS the browser blocks every request
      # from bird-maps.com → api.bird-maps.com and the map never loads.
      env {
        name  = "FRONTEND_ORIGINS"
        value = "https://${var.domain},https://www.${var.domain}"
      }
    }
  }

  traffic {
    type    = "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST"
    percent = 100
  }

  depends_on = [
    google_project_service.run,
    google_secret_manager_secret_iam_member.read_api_db,
  ]
}

# Allow public access (CDN sits in front).
resource "google_cloud_run_v2_service_iam_member" "read_api_public" {
  name     = google_cloud_run_v2_service.read_api.name
  location = google_cloud_run_v2_service.read_api.location
  role     = "roles/run.invoker"
  member   = "allUsers"
}

output "read_api_url" {
  value = google_cloud_run_v2_service.read_api.uri
}
```

- [ ] **Step 4: Apply**

```bash
terraform apply
```

Expected: a Cloud Run service URL, e.g. `https://bird-read-api-abcd1234-uw.a.run.app`.

- [ ] **Step 5: Smoke-test**

```bash
URL=$(terraform output -raw read_api_url)
curl -fsS "$URL/health"
curl -fsS "$URL/api/regions" | head -c 200
```

Expected: `{"ok":true}` and a JSON array of 9 regions.

- [ ] **Step 6: Commit**

```bash
git add scripts/build-push.sh infra/terraform/read-api.tf
git commit -m "infra: deploy read-api as Cloud Run service with secret-managed DB URL"
```

---

### Task 7: Dockerize the Ingestor

**Files:**
- Create: `services/ingestor/Dockerfile`
- Create: `services/ingestor/.dockerignore`

- [ ] **Step 1: Write `services/ingestor/Dockerfile`**

```dockerfile
FROM node:20-alpine AS build
WORKDIR /repo

COPY package.json package-lock.json ./
COPY tsconfig.base.json ./
COPY packages ./packages
COPY services/ingestor ./services/ingestor

RUN npm ci --workspaces --include-workspace-root --include=dev
RUN npm run build --workspace @bird-watch/shared-types
RUN npm run build --workspace @bird-watch/db-client
RUN npm run build --workspace @bird-watch/family-mapping
RUN npm run build --workspace @bird-watch/ingestor

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /repo/package.json /repo/package-lock.json ./
COPY --from=build /repo/packages ./packages
COPY --from=build /repo/services/ingestor/package.json ./services/ingestor/
COPY --from=build /repo/services/ingestor/dist ./services/ingestor/dist

RUN npm ci --omit=dev --workspaces --include-workspace-root

# The Cloud Run Job invokes this entrypoint with the kind as $1.
ENTRYPOINT ["node", "services/ingestor/dist/cli.js"]
```

- [ ] **Step 2: Write `.dockerignore`** (same content as Task 5)

- [ ] **Step 3: Push the image**

```bash
./scripts/build-push.sh ingestor latest
```

- [ ] **Step 4: Commit**

```bash
git add services/ingestor/Dockerfile services/ingestor/.dockerignore
git commit -m "feat(ingestor): Dockerfile for Cloud Run Job"
```

---

### Task 8: Cloud Run Job + Cloud Scheduler triggers for Ingestor

**Files:**
- Create: `infra/terraform/ingestor.tf`

- [ ] **Step 1: Write `infra/terraform/ingestor.tf`**

```hcl
resource "google_service_account" "ingestor" {
  account_id   = "bird-ingestor"
  display_name = "bird-watch Ingestor"
}

resource "google_secret_manager_secret_iam_member" "ingestor_db" {
  secret_id = google_secret_manager_secret.db_url.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.ingestor.email}"
}

resource "google_secret_manager_secret" "ebird_key" {
  secret_id = "bird-watch-ebird-key"
  replication { auto {} }
  depends_on = [google_project_service.secretmanager]
}

resource "google_secret_manager_secret_version" "ebird_key" {
  secret      = google_secret_manager_secret.ebird_key.id
  secret_data = var.ebird_api_key
}

resource "google_secret_manager_secret_iam_member" "ingestor_ebird" {
  secret_id = google_secret_manager_secret.ebird_key.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.ingestor.email}"
}

resource "google_cloud_run_v2_job" "ingestor" {
  name     = "bird-ingestor"
  location = var.gcp_region

  template {
    template {
      service_account = google_service_account.ingestor.email
      timeout         = "300s"
      max_retries     = 1

      containers {
        image = "${google_artifact_registry_repository.birdwatch.location}-docker.pkg.dev/${var.gcp_project_id}/${google_artifact_registry_repository.birdwatch.repository_id}/ingestor:latest"

        # Args are appended to ENTRYPOINT. CLI takes "recent" | "hotspots" | "backfill".
        args = ["recent"]

        resources {
          limits = { cpu = "1", memory = "512Mi" }
        }

        env {
          name = "DATABASE_URL"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.db_url.secret_id
              version = "latest"
            }
          }
        }
        env {
          name = "EBIRD_API_KEY"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.ebird_key.secret_id
              version = "latest"
            }
          }
        }
      }
    }
  }

  depends_on = [
    google_project_service.run,
    google_secret_manager_secret_iam_member.ingestor_db,
    google_secret_manager_secret_iam_member.ingestor_ebird,
  ]
}

# Service account that Scheduler uses to invoke the Job.
resource "google_service_account" "scheduler" {
  account_id   = "bird-scheduler"
  display_name = "bird-watch Cloud Scheduler invoker"
}

resource "google_cloud_run_v2_job_iam_member" "scheduler_invoke" {
  name     = google_cloud_run_v2_job.ingestor.name
  location = google_cloud_run_v2_job.ingestor.location
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.scheduler.email}"
}

locals {
  job_run_url = "https://${var.gcp_region}-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/${var.gcp_project_id}/jobs/${google_cloud_run_v2_job.ingestor.name}:run"
}

# Three crons matching the spec: every 30 min, daily 4am UTC, weekly Sun 5am UTC.
resource "google_cloud_scheduler_job" "ingest_recent" {
  name      = "bird-ingest-recent"
  region    = var.gcp_region
  schedule  = "*/30 * * * *"
  time_zone = "Etc/UTC"

  http_target {
    uri         = local.job_run_url
    http_method = "POST"
    headers     = { "Content-Type" = "application/json" }
    body = base64encode(jsonencode({
      overrides = {
        containerOverrides = [{ args = ["recent"] }]
      }
    }))
    oauth_token {
      service_account_email = google_service_account.scheduler.email
    }
  }

  depends_on = [google_project_service.scheduler]
}

resource "google_cloud_scheduler_job" "ingest_backfill" {
  name      = "bird-ingest-backfill"
  region    = var.gcp_region
  schedule  = "0 4 * * *"
  time_zone = "Etc/UTC"

  http_target {
    uri         = local.job_run_url
    http_method = "POST"
    headers     = { "Content-Type" = "application/json" }
    body = base64encode(jsonencode({
      overrides = {
        containerOverrides = [{ args = ["backfill"] }]
      }
    }))
    oauth_token {
      service_account_email = google_service_account.scheduler.email
    }
  }
}

resource "google_cloud_scheduler_job" "ingest_hotspots" {
  name      = "bird-ingest-hotspots"
  region    = var.gcp_region
  schedule  = "0 5 * * 0"
  time_zone = "Etc/UTC"

  http_target {
    uri         = local.job_run_url
    http_method = "POST"
    headers     = { "Content-Type" = "application/json" }
    body = base64encode(jsonencode({
      overrides = {
        containerOverrides = [{ args = ["hotspots"] }]
      }
    }))
    oauth_token {
      service_account_email = google_service_account.scheduler.email
    }
  }
}
```

- [ ] **Step 2: Apply**

```bash
terraform apply
```

Expected: 1 Job + 3 Scheduler jobs created.

- [ ] **Step 3: Trigger one ingest run manually**

```bash
gcloud run jobs execute bird-ingestor --region=$(terraform output -raw gcp_region 2>/dev/null || echo us-west1) --args=recent
gcloud logging read 'resource.type="cloud_run_job" AND resource.labels.job_name="bird-ingestor"' --limit=20
```

Expected: log lines from the ingestor; `psql "$DATABASE_URL" -c "SELECT count(*) FROM observations;"` returns a non-zero count.

- [ ] **Step 4: Commit**

```bash
git add infra/terraform/ingestor.tf
git commit -m "infra: deploy ingestor as Cloud Run Job + 3 Scheduler triggers"
```

---

### Task 9: Frontend on Cloudflare Pages + DNS

**Files:**
- Create: `infra/terraform/frontend.tf`
- Create: `frontend/.env.production`

- [ ] **Step 1: Write `infra/terraform/frontend.tf`**

Source of truth: shipped in PR #69 (commit `c01924e`). Two independent DNS bugs in the pre-ship draft are fixed here — read the inline comments before simplifying anything.

```hcl
resource "cloudflare_pages_project" "frontend" {
  account_id        = var.cloudflare_account_id
  name              = "birdwatch"
  production_branch = "main"
}

resource "cloudflare_pages_domain" "root" {
  account_id   = var.cloudflare_account_id
  project_name = cloudflare_pages_project.frontend.name
  domain       = var.domain
}

# Apex "@" → CNAME to the Pages project's auto-assigned pages.dev subdomain.
# cloudflare_pages_domain binds the domain on the Pages side but does NOT
# create the DNS record; without this resource the zone serves NXDOMAIN for
# the apex. Reference the provider-exposed `subdomain` attribute rather than
# hardcoding "birdwatch-1xe.pages.dev" — if the project is ever recreated,
# Cloudflare may assign a different pages.dev suffix. proxied=true lets CF
# auto-flatten the apex CNAME.
#
# KNOWN FRAGILE: the pages.dev hostname returned by the provider is not
# guaranteed stable across project re-creates. If the Pages project is ever
# deleted-and-recreated, this record will update to the new pages.dev host
# on the next apply — but any manual links to the old pages.dev URL will
# break. The apex itself (via var.domain) is stable.
resource "cloudflare_record" "root" {
  zone_id = var.cloudflare_zone_id
  name    = "@"
  type    = "CNAME"
  content = cloudflare_pages_project.frontend.subdomain
  proxied = true
  ttl     = 1
}

# Subdomain "api" → CNAME to Cloud Run's documented CNAME target.
# Cloud Run rejects requests whose Host header is not a registered domain
# mapping, so pointing straight at the run.app URL returns 404. The canonical
# path is a CNAME to ghs.googlehosted.com plus a google_cloud_run_domain_mapping
# below; proxied MUST be false so Cloud Run's own Let's Encrypt cert serves
# (proxying through Cloudflare breaks the SSL handshake).
resource "cloudflare_record" "api" {
  zone_id = var.cloudflare_zone_id
  name    = "api"
  type    = "CNAME"
  content = "ghs.googlehosted.com"
  proxied = false
  ttl     = 1
}

# NOTE: google_cloud_run_domain_mapping is the v1-Knative resource. The rest
# of the infra uses google_cloud_run_v2_service, but the v2 provider does
# not yet expose a domain-mapping resource; the v1 resource is the canonical
# path and the v1/v2 mix is intentional here. Prerequisite: the operator
# must verify `var.domain` in Google Search Console (one-time out-of-band
# TXT record) before `terraform apply` — otherwise this resource fails.
# See the top-level "Prerequisites" section of this plan.
resource "google_cloud_run_domain_mapping" "api" {
  location = var.gcp_region
  name     = "api.${var.domain}"

  metadata {
    namespace = var.gcp_project_id
  }

  spec {
    route_name = google_cloud_run_v2_service.read_api.name
  }
}

output "api_url"       { value = "https://api.${var.domain}" }
output "frontend_url"  { value = "https://${var.domain}" }
output "root_domain"   { value = var.domain }
```

Three gotchas that cost real hours on 2026-04-19:

1. **`cloudflare_pages_domain` does not create DNS.** It binds the domain on the Pages side only. Without `cloudflare_record.root`, the zone serves NXDOMAIN for the apex. This is not documented prominently anywhere.
2. **`proxied = true` on `api.*` breaks Cloud Run SSL.** Cloud Run serves its own Let's Encrypt cert; routing through Cloudflare's proxy layer breaks the handshake. The apex CAN be proxied (Cloudflare manages the cert for it via Pages); the api subdomain cannot.
3. **`ghs.googlehosted.com`, not the run.app URL.** Cloud Run matches the `Host:` header against registered domain mappings — pointing DNS at the raw run.app URL returns 404 even though DNS resolves fine. Must CNAME to `ghs.googlehosted.com` AND register the mapping via `google_cloud_run_domain_mapping`.

- [ ] **Step 2: Apply**

```bash
terraform apply
```

- [ ] **Step 3: Build + deploy frontend**

`frontend/.env.production` should be checked in with the live production domain as its value (NOT a REPLACE_WITH_DOMAIN placeholder — the pre-ship draft had that, which produced a broken bundle where the frontend fetched from `api.REPLACE_WITH_DOMAIN`). The deploy script overwrites this file per-deploy so the checked-in value is mostly documentation, but keep it accurate. Example committed value (PR #66 / commit `cc6641c`):

```
VITE_API_BASE_URL=https://api.bird-maps.com
```

`frontend/src/App.tsx` reads this at build time via `import.meta.env.VITE_API_BASE_URL`; falls back to `''` so the Vite dev-server proxy at `/api` continues to work. `frontend/src/vite-env.d.ts` declares the type (see PR #66).

```bash
DOMAIN=$(terraform output -raw root_domain)
echo "VITE_API_BASE_URL=https://api.$DOMAIN" > frontend/.env.production
cd frontend
npm run build
npx wrangler pages deploy dist --project-name=birdwatch --branch=main
```

Expected: a deploy URL like `https://abcd.birdwatch.pages.dev`. Custom domain reachable after DNS propagates (~1 min).

- [ ] **Step 4: Smoke-test**

```bash
curl -fsS "https://api.$DOMAIN/health"
curl -fsS "https://$DOMAIN" | grep -q '<title>bird-watch'
```

- [ ] **Step 5: Commit**

```bash
git add infra/terraform/frontend.tf frontend/.env.production
git commit -m "infra: Cloudflare Pages for frontend + CNAME for API"
```

---

### Task 10: One-shot deploy script

**Files:**
- Create: `scripts/deploy.sh`

- [ ] **Step 1: Write the script**

```bash
#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

echo "[1/6] terraform apply..."
(cd infra/terraform && terraform apply -auto-approve)

echo "[2/6] migrations..."
DB_URL=$(cd infra/terraform && terraform output -raw neon_db_url)
DATABASE_URL="$DB_URL" ./scripts/migrate-deploy.sh

echo "[3/6] build + push read-api image..."
./scripts/build-push.sh read-api latest

echo "[4/6] build + push ingestor image..."
./scripts/build-push.sh ingestor latest

echo "[5/6] roll Cloud Run to new revisions..."
REGION=$(cd infra/terraform && terraform output -raw gcp_region 2>/dev/null || echo us-west1)
gcloud run services update bird-read-api --region="$REGION" --image="$(cd infra/terraform && terraform output -raw artifact_registry_url)/read-api:latest"
gcloud run jobs update bird-ingestor --region="$REGION" --image="$(cd infra/terraform && terraform output -raw artifact_registry_url)/ingestor:latest"

echo "[6/6] build + deploy frontend..."
DOMAIN=$(cd infra/terraform && terraform output -raw root_domain)
echo "VITE_API_BASE_URL=https://api.$DOMAIN" > frontend/.env.production
(cd frontend && npm run build && npx wrangler pages deploy dist --project-name=birdwatch --branch=main)

echo
echo "Deployed."
echo "  Frontend:  https://$DOMAIN"
echo "  API:       https://api.$DOMAIN"
echo "  Ingestor:  bird-ingestor (cron-driven via Cloud Scheduler)"
```

- [ ] **Step 2: Make executable + run**

```bash
chmod +x scripts/deploy.sh
./scripts/deploy.sh
```

- [ ] **Step 3: Commit**

```bash
git add scripts/deploy.sh
git commit -m "infra: one-shot deploy script (terraform + images + frontend)"
```

---

### Task 11: Post-deploy smoke test

**Files:**
- Create: `scripts/smoke-test.sh`

- [ ] **Step 1: Write the script**

```bash
#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

DOMAIN=$(cd infra/terraform && terraform output -raw root_domain)
API="https://api.$DOMAIN"
WEB="https://$DOMAIN"

echo "Checking $API/health..."
curl -fsS "$API/health" | tee /dev/stderr | grep -q '"ok":true'

echo
echo "Checking $API/api/regions returns 9 regions..."
COUNT=$(curl -fsS "$API/api/regions" | jq 'length')
test "$COUNT" -eq 9

echo
echo "Checking $API/api/observations is reachable..."
curl -fsS "$API/api/observations?since=14d" > /dev/null

echo
echo "Checking Cache-Control header on /api/regions..."
curl -fsSI "$API/api/regions" | grep -i 'cache-control: public, max-age=604800'

echo
echo "Checking frontend HTML..."
curl -fsS "$WEB" | grep -q '<title>bird-watch'

echo
echo "All smoke checks passed."
```

- [ ] **Step 2: Make executable + run**

```bash
chmod +x scripts/smoke-test.sh
./scripts/smoke-test.sh
```

- [ ] **Step 3: Commit**

```bash
git add scripts/smoke-test.sh
git commit -m "infra: post-deploy smoke test"
```

---

### Task 12: Update root README with deploy instructions

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Append a "Deployment" section**

```markdown
## Deployment

This project deploys to **GCP Cloud Run + Neon Postgres + Cloudflare Pages** — true serverless, scale-to-zero, hobbyist free tier.

### Prerequisites

- GCP account with a project, `gcloud` CLI authenticated, billing enabled (free tier covers our usage)
- Neon account (Neon dashboard → Settings → API keys) — also grab your `org_id` from the console URL
- Cloudflare account with a zone you control (used for Pages + DNS only)
- eBird API key (free at ebird.org/api/keygen)
- Terraform ≥ 1.6
- Docker + `docker buildx` for multi-arch builds
- `psql` on `$PATH`
- Your domain verified in [Google Search Console](https://search.google.com/search-console) (one-time TXT record) — required before `google_cloud_run_domain_mapping` can apply

### One-time setup

1. `cp infra/terraform/terraform.tfvars.example infra/terraform/terraform.tfvars` and fill in:
   - `gcp_project_id`, `gcp_region`
   - `neon_api_key`, `neon_org_id`
   - `cloudflare_account_id`, `cloudflare_api_token`, `cloudflare_zone_id`, `domain`
   - `ebird_api_key`
2. `gcloud auth login && gcloud auth application-default login`
3. Verify `domain` in Google Search Console, add the TXT record to Cloudflare, wait for confirmation
4. `cd infra/terraform && terraform init`
5. `./scripts/deploy.sh` — provisions infra, builds + pushes images, deploys frontend
6. `./scripts/smoke-test.sh`

### Subsequent deploys

After code changes: `./scripts/deploy.sh` rebuilds and rolls Cloud Run to the new image. Terraform sees no diff and skips infra.

### Portability

The compute is plain Docker. To migrate to AWS / Azure / Fly:
- Same Dockerfiles → push to ECR / ACR / Fly registry
- AWS App Runner / ECS Fargate / Azure Container Apps / Fly Machines all run the same image
- Neon is portable Postgres — `pg_dump` and restore to RDS / Cloud SQL / Azure DB / self-hosted
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: deployment instructions for GCP Cloud Run"
```

---

## Self-review checklist (run before declaring Plan 5 done)

- [ ] `terraform init` and `terraform validate` succeed
- [ ] `terraform apply` on a fresh account with only the `terraform.tfvars` variables reaches a working deploy with **no manual Terraform edits** (this is the acid test for the Prerequisites section — if you had to hand-tweak `db.tf`, `frontend.tf`, or any other Terraform file during apply, the plan is still wrong)
- [ ] `terraform apply` provisions: APIs enabled, Neon project + default endpoint (free tier — no separate `neon_branch` or `neon_endpoint` resources), Artifact Registry, Read API Cloud Run service with `FRONTEND_ORIGINS` env var, Ingestor Cloud Run Job, 3 Cloud Scheduler triggers, Cloudflare Pages project + custom domain, DNS records for apex (`@` → pages.dev, proxied) and `api` (→ `ghs.googlehosted.com`, NOT proxied), `google_cloud_run_domain_mapping.api`
- [ ] `./scripts/deploy.sh` runs end-to-end without errors
- [ ] `./scripts/smoke-test.sh` passes
- [ ] Browsing `https://<domain>` renders the live map with real eBird data (confirms: apex DNS correct, Pages deploy reachable, CORS headers present, `api.<domain>` reaches Cloud Run with correct Host header)
- [ ] After 30 min, a fresh ingest run is visible in `ingest_runs` table and Cloud Logging
- [ ] Cloud Run Read API revision shows `min_instance_count=0` (verify in console — confirms scale-to-zero)
- [ ] Monthly bill remains $0 in GCP billing dashboard after a week of normal usage
- [ ] No secret values committed to git: `git log -p | grep -iE 'api_key|password|secret' | grep -v '\.example'` returns nothing
- [ ] `terraform.tfstate`, `.playwright-mcp/`, `.claude/`, and `cf-*/gcp-*/page-*.png` are gitignored at repo root (PR #61 patterns)

When all checked: Plan 5 is done. The system is live, truly serverless, scale-to-zero, $0/month.

---

## CD workflows (Wave 1.5, issues #62–#65 — not yet shipped)

This plan describes the **manual `./scripts/deploy.sh` flow**, which is what landed first (shipped live 2026-04-19). Wave 1.5 will replace most of it with GitHub Actions:

| Issue | Workflow | Replaces |
|---|---|---|
| #62 | CD: build + push Read API on `main` | Manual `./scripts/build-push.sh read-api` |
| #63 | CD: build + push Ingestor on `main` | Manual `./scripts/build-push.sh ingestor` |
| #64 | CD: deploy frontend to Pages on `main` | Manual `wrangler pages deploy` |
| #65 | CD: run migrations on `main` (bundles #52's scripted `migrate-deploy.sh`) | Manual `./scripts/migrate-deploy.sh` from a workstation |

Once Wave 1.5 merges, `./scripts/deploy.sh` becomes a break-glass tool rather than the happy path. Terraform stays manual (infra changes are rare and deserve a human in the loop); everything downstream of Terraform automates on push.

---

## Migration paths (when you outgrow free tier or want to leave GCP)

| Move | What changes | What stays |
|---|---|---|
| **GCP → AWS** | Push Dockerfiles to ECR; deploy to App Runner or Fargate; replace Cloud Scheduler with EventBridge Rules; replace Secret Manager with AWS Secrets Manager | Application code, Neon DB, frontend |
| **GCP → Azure** | Push Dockerfiles to ACR; deploy to Azure Container Apps; replace Cloud Scheduler with Azure Logic Apps or Functions Timer; replace Secret Manager with Key Vault | Application code, Neon DB, frontend |
| **GCP → Fly.io** | Push Dockerfiles to Fly registry; `fly deploy` for the API service; `fly machines run --schedule` for the cron jobs | Application code, frontend (could move to Fly too) |
| **Neon → another Postgres** | `pg_dump` from Neon → restore to RDS / Cloud SQL / Azure DB / self-hosted; update `DATABASE_URL` secret | Compute layer, all application code |

The Docker container is the portable artifact. The cloud is just one host for it.
