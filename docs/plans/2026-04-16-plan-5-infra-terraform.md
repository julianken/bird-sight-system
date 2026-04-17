# Infrastructure & Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provision and deploy the full system on **GCP Cloud Run + Neon Postgres**, with all infrastructure managed by Terraform. Both compute and DB scale to zero. After `terraform apply` and the deploy scripts, the live URL serves the frontend that talks to the Read API on Cloud Run that reads from Neon, with the Ingestor running as a Cloud Run Job triggered by Cloud Scheduler.

**Architecture:** Two Cloud Run targets — a Service (Read API, HTTP, scale-to-zero, behind a CDN) and a Job (Ingestor, invoked by Cloud Scheduler on cron). Both ship as Docker containers in Google Artifact Registry; the same images run unchanged on AWS Fargate, Azure Container Apps, Fly Machines, or any Kubernetes cluster — that's the portability story. Neon Postgres is reached via its built-in pooler URL. The frontend deploys to Cloudflare Pages (free, unlimited bandwidth) with DNS managed by Cloudflare; could be moved to GCP Cloud Storage + Cloud CDN later if you want a single-cloud setup.

**Tech Stack:** Terraform, `hashicorp/google` provider, `kislerdm/neon` provider, `cloudflare/cloudflare` provider (for Pages + DNS), Docker, Google Cloud Run (Service + Job), Google Cloud Scheduler, Google Artifact Registry, Neon serverless Postgres + PostGIS.

**Cost estimate at hobbyist usage:** $0/month indefinitely. Cloud Run always-free tier (2M req/mo, 360k vCPU-sec, 180k GiB-sec) covers our load with several orders of magnitude headroom. Neon free tier (0.5 GB) covers years of AZ data. Cloudflare Pages free tier covers static hosting and DNS. Total monthly bill: $0.

**Depends on:** Plans 1, 2, 3, 4 must all be complete and tested locally.

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
      version = "~> 0.6"
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
cloudflare_account_id = "REPLACE_ME"
cloudflare_api_token  = "REPLACE_ME"
cloudflare_zone_id    = "REPLACE_ME"
ebird_api_key         = "REPLACE_ME"
domain                = "birdwatch.example.com"
```

- [ ] **Step 5: Write `.gitignore`**

```
.terraform/
.terraform.lock.hcl
terraform.tfstate
terraform.tfstate.backup
terraform.tfvars
*.auto.tfvars
```

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

```hcl
resource "neon_project" "birdwatch" {
  name       = "bird-watch"
  region_id  = "aws-us-west-2"  # close to gcp_region
  pg_version = 16
}

resource "neon_branch" "main" {
  project_id = neon_project.birdwatch.id
  name       = "main"
}

resource "neon_database" "main" {
  project_id = neon_project.birdwatch.id
  branch_id  = neon_branch.main.id
  name       = "birdwatch"
  owner_name = neon_project.birdwatch.default_role_name
}

# Endpoint with pooled connection enabled — required for serverless.
resource "neon_endpoint" "main" {
  project_id = neon_project.birdwatch.id
  branch_id  = neon_branch.main.id
  type       = "read_write"
  pooler_enabled = true
}

# Neon inserts "-pooler" after the endpoint id (the first dot-separated
# segment of the host), NOT before ".neon.tech":
#   ep-cool-xxx.us-east-2.aws.neon.tech         (direct)
#   ep-cool-xxx-pooler.us-east-2.aws.neon.tech  (pooled)
locals {
  neon_pooled_host = replace(neon_endpoint.main.host, "/^([^.]+)\\./", "$1-pooler.")
  neon_pooled_url  = "postgres://${neon_project.birdwatch.default_role_name}:${neon_project.birdwatch.default_role_password}@${local.neon_pooled_host}/${neon_database.main.name}?sslmode=require"
}

output "neon_db_url" {
  value     = "postgres://${neon_project.birdwatch.default_role_name}:${neon_project.birdwatch.default_role_password}@${neon_endpoint.main.host}/${neon_database.main.name}?sslmode=require"
  sensitive = true
}

# Pooled URL — what Cloud Run uses. Each connection is multiplexed via PgBouncer.
output "neon_pooled_url" {
  value     = local.neon_pooled_url
  sensitive = true
}
```

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
psql "$DATABASE_URL" -c "CREATE EXTENSION IF NOT EXISTS postgis;"

echo "Running migrations..."
npx node-pg-migrate up -m migrations -d "$DATABASE_URL"

echo "Done."
```

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

# Subdomain "api" → CNAME to the Cloud Run service URL (proxied through Cloudflare for caching).
resource "cloudflare_record" "api" {
  zone_id = var.cloudflare_zone_id
  name    = "api"
  type    = "CNAME"
  # Strip protocol; CF wants just the host
  value   = trimprefix(google_cloud_run_v2_service.read_api.uri, "https://")
  proxied = true
  ttl     = 1
}

output "api_url"       { value = "https://api.${var.domain}" }
output "frontend_url"  { value = "https://${var.domain}" }
output "root_domain"   { value = var.domain }
```

- [ ] **Step 2: Apply**

```bash
terraform apply
```

- [ ] **Step 3: Build + deploy frontend**

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
- Neon account (Neon dashboard → Settings → API keys)
- Cloudflare account with a zone you control (used for Pages + DNS only)
- eBird API key (free at ebird.org/api/keygen)
- Terraform ≥ 1.6
- Docker + `docker buildx` for multi-arch builds
- `psql` on `$PATH`

### One-time setup

1. `cp infra/terraform/terraform.tfvars.example infra/terraform/terraform.tfvars` and fill in:
   - `gcp_project_id`, `gcp_region`
   - `neon_api_key`
   - `cloudflare_account_id`, `cloudflare_api_token`, `cloudflare_zone_id`, `domain`
   - `ebird_api_key`
2. `gcloud auth login && gcloud auth application-default login`
3. `cd infra/terraform && terraform init`
4. `./scripts/deploy.sh` — provisions infra, builds + pushes images, deploys frontend
5. `./scripts/smoke-test.sh`

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
- [ ] `terraform apply` provisions: APIs enabled, Neon project + DB + pooled endpoint, Artifact Registry, Read API Cloud Run service, Ingestor Cloud Run Job, 3 Cloud Scheduler triggers, Cloudflare Pages project + custom domain, DNS CNAME for API
- [ ] `./scripts/deploy.sh` runs end-to-end without errors
- [ ] `./scripts/smoke-test.sh` passes
- [ ] Browsing `https://<domain>` renders the live map with real eBird data
- [ ] After 30 min, a fresh ingest run is visible in `ingest_runs` table and Cloud Logging
- [ ] Cloud Run Read API revision shows `min_instance_count=0` (verify in console — confirms scale-to-zero)
- [ ] Monthly bill remains $0 in GCP billing dashboard after a week of normal usage
- [ ] No secret values committed to git: `git log -p | grep -iE 'api_key|password|secret' | grep -v '\.example'` returns nothing

When all checked: Plan 5 is done. The system is live, truly serverless, scale-to-zero, $0/month.

---

## Migration paths (when you outgrow free tier or want to leave GCP)

| Move | What changes | What stays |
|---|---|---|
| **GCP → AWS** | Push Dockerfiles to ECR; deploy to App Runner or Fargate; replace Cloud Scheduler with EventBridge Rules; replace Secret Manager with AWS Secrets Manager | Application code, Neon DB, frontend |
| **GCP → Azure** | Push Dockerfiles to ACR; deploy to Azure Container Apps; replace Cloud Scheduler with Azure Logic Apps or Functions Timer; replace Secret Manager with Key Vault | Application code, Neon DB, frontend |
| **GCP → Fly.io** | Push Dockerfiles to Fly registry; `fly deploy` for the API service; `fly machines run --schedule` for the cron jobs | Application code, frontend (could move to Fly too) |
| **Neon → another Postgres** | `pg_dump` from Neon → restore to RDS / Cloud SQL / Azure DB / self-hosted; update `DATABASE_URL` secret | Compute layer, all application code |

The Docker container is the portable artifact. The cloud is just one host for it.
