# Infrastructure & Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provision and deploy the full system on Cloudflare Workers + Cloudflare Pages + Neon Postgres, with all infrastructure managed by Terraform. After `terraform apply` and the deploy scripts, the live URL serves the frontend that talks to the Read API Worker that reads from Neon, with the Ingestor Worker running on a 30-min cron.

**Architecture:** Terraform provisions: Neon Postgres project & branch, Cloudflare Hyperdrive (for pooled DB connections from Workers), the two Worker scripts (ingestor + read-api) with their cron + Hyperdrive bindings, the Pages project for the frontend, and DNS records. Application code is bundled by Wrangler and deployed via `wrangler deploy` (called from a single `scripts/deploy.sh`). Migrations run against the Neon DB via `node-pg-migrate`.

**Tech Stack:** Terraform, `cloudflare/cloudflare` provider, `kislerdm/neon` provider, Cloudflare Workers, Wrangler 3, Cloudflare Pages, Cloudflare Hyperdrive, Neon serverless Postgres.

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
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 4.20"
    }
    neon = {
      source  = "kislerdm/neon"
      version = "~> 0.6"
    }
  }
}
```

- [ ] **Step 2: Write `variables.tf`**

```hcl
variable "cloudflare_account_id" {
  type        = string
  description = "Cloudflare account ID (find at Cloudflare dashboard → Workers → right sidebar)."
}

variable "cloudflare_api_token" {
  type        = string
  sensitive   = true
  description = "Cloudflare API token with Workers + Pages + DNS + Hyperdrive perms."
}

variable "neon_api_key" {
  type        = string
  sensitive   = true
  description = "Neon API key (Neon dashboard → Settings → API keys)."
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

variable "zone_id" {
  type        = string
  description = "Cloudflare zone ID for `domain`."
}
```

- [ ] **Step 3: Write `main.tf`**

```hcl
provider "cloudflare" {
  api_token = var.cloudflare_api_token
}

provider "neon" {
  api_key = var.neon_api_key
}
```

- [ ] **Step 4: Write `terraform.tfvars.example`**

```hcl
cloudflare_account_id = "REPLACE_ME"
cloudflare_api_token  = "REPLACE_ME"
neon_api_key          = "REPLACE_ME"
ebird_api_key         = "REPLACE_ME"
domain                = "birdwatch.example.com"
zone_id               = "REPLACE_ME"
```

- [ ] **Step 5: Write `infra/terraform/.gitignore`**

```
.terraform/
.terraform.lock.hcl
terraform.tfstate
terraform.tfstate.backup
terraform.tfvars
*.auto.tfvars
```

- [ ] **Step 6: Initialize Terraform**

```bash
cd infra/terraform
cp terraform.tfvars.example terraform.tfvars  # then fill in real values out-of-band
terraform init
```

Expected: `Terraform has been successfully initialized!`

- [ ] **Step 7: Commit**

```bash
git add infra/terraform/{main.tf,variables.tf,versions.tf,terraform.tfvars.example,.gitignore}
git commit -m "infra: scaffold Terraform with Cloudflare + Neon providers"
```

---

### Task 2: Provision Neon Postgres

**Files:**
- Create: `infra/terraform/db.tf`

- [ ] **Step 1: Write `db.tf`**

```hcl
resource "neon_project" "birdwatch" {
  name      = "bird-watch"
  region_id = "aws-us-west-2"  # close to AZ; pick another if you prefer
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

# A role + endpoint give us a connection string.
resource "neon_endpoint" "main" {
  project_id = neon_project.birdwatch.id
  branch_id  = neon_branch.main.id
  type       = "read_write"
}

output "neon_db_url" {
  value     = "postgres://${neon_project.birdwatch.default_role_name}:${neon_project.birdwatch.default_role_password}@${neon_endpoint.main.host}/${neon_database.main.name}?sslmode=require"
  sensitive = true
}

output "neon_pgbouncer_url" {
  value     = "postgres://${neon_project.birdwatch.default_role_name}:${neon_project.birdwatch.default_role_password}@${neon_endpoint.main.host}-pooler/${neon_database.main.name}?sslmode=require"
  sensitive = true
}
```

- [ ] **Step 2: Apply**

```bash
terraform plan
terraform apply
```

Expected: a Neon project, branch, database, and endpoint exist in the Neon dashboard.

- [ ] **Step 3: Verify connectivity**

```bash
DB_URL=$(terraform output -raw neon_db_url)
psql "$DB_URL" -c "SELECT version();"
```

Expected: prints Postgres 16 version string.

- [ ] **Step 4: Commit**

```bash
git add infra/terraform/db.tf
git commit -m "infra: provision Neon Postgres + database"
```

---

### Task 3: Apply migrations against Neon

**Files:**
- Create: `scripts/migrate-deploy.sh`

- [ ] **Step 1: Write the script**

`scripts/migrate-deploy.sh`:
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

- [ ] **Step 2: Make it executable and run**

```bash
chmod +x scripts/migrate-deploy.sh
export DATABASE_URL=$(cd infra/terraform && terraform output -raw neon_db_url)
./scripts/migrate-deploy.sh
```

Expected: PostGIS extension enabled; all migrations applied; 9 regions + 15 silhouettes seeded.

- [ ] **Step 3: Verify**

```bash
psql "$DATABASE_URL" -c "SELECT count(*) FROM regions;"
psql "$DATABASE_URL" -c "SELECT count(*) FROM family_silhouettes;"
```

Expected: `9` and `15`.

- [ ] **Step 4: Commit**

```bash
git add scripts/migrate-deploy.sh
git commit -m "infra: migration runner for Neon"
```

---

### Task 4: Provision Cloudflare Hyperdrive (DB connection pooling for Workers)

**Files:**
- Create: `infra/terraform/hyperdrive.tf`

- [ ] **Step 1: Write `hyperdrive.tf`**

```hcl
resource "cloudflare_hyperdrive_config" "birdwatch" {
  account_id = var.cloudflare_account_id
  name       = "birdwatch-pg"

  origin = {
    database = neon_database.main.name
    host     = neon_endpoint.main.host
    port     = 5432
    user     = neon_project.birdwatch.default_role_name
    password = neon_project.birdwatch.default_role_password
    scheme   = "postgres"
  }

  caching = {
    disabled = false
  }
}

output "hyperdrive_id" {
  value = cloudflare_hyperdrive_config.birdwatch.id
}
```

- [ ] **Step 2: Apply**

```bash
terraform apply
```

Expected: `cloudflare_hyperdrive_config.birdwatch: Creation complete`.

- [ ] **Step 3: Capture the ID**

```bash
terraform output hyperdrive_id
```

Expected: a hex string. Save it for the Worker bindings (next tasks reference it via Terraform output).

- [ ] **Step 4: Commit**

```bash
git add infra/terraform/hyperdrive.tf
git commit -m "infra: Cloudflare Hyperdrive for Neon connection pooling"
```

---

### Task 5: Cloudflare wrapper for the Ingestor Worker

**Files:**
- Create: `services/ingestor/src/worker.ts`
- Create: `services/ingestor/wrangler.toml`
- Create: `services/ingestor/tsconfig.worker.json`

- [ ] **Step 1: Write the Worker entrypoint**

`services/ingestor/src/worker.ts`:
```typescript
import { handleScheduled, type ScheduledKind } from './handler.js';

export interface Env {
  HYPERDRIVE: { connectionString: string };
  EBIRD_API_KEY: string;
}

export default {
  async scheduled(event: ScheduledController, env: Env, _ctx: ExecutionContext) {
    const kind = mapCronToKind(event.cron);
    const result = await handleScheduled(kind, {
      DATABASE_URL: env.HYPERDRIVE.connectionString,
      EBIRD_API_KEY: env.EBIRD_API_KEY,
    });
    console.log(JSON.stringify({ event: 'ingest_done', kind, result }));
  },
} satisfies ExportedHandler<Env>;

function mapCronToKind(cron: string): ScheduledKind {
  // Match the cron strings declared in wrangler.toml
  if (cron === '*/30 * * * *') return 'recent';
  if (cron === '0 4 * * *') return 'backfill';
  if (cron === '0 5 * * 0') return 'hotspots';
  return 'recent';
}

interface ScheduledController { cron: string; scheduledTime: number; }
interface ExecutionContext { waitUntil(promise: Promise<unknown>): void; }
type ExportedHandler<E> = { scheduled(e: ScheduledController, env: E, ctx: ExecutionContext): Promise<void>; };
```

- [ ] **Step 2: Write `wrangler.toml`**

```toml
name = "birdwatch-ingestor"
main = "src/worker.ts"
compatibility_date = "2026-04-01"
compatibility_flags = ["nodejs_compat"]

[[hyperdrive]]
binding = "HYPERDRIVE"
id = "REPLACE_WITH_HYPERDRIVE_ID"

[[triggers.crons]]
cron = "*/30 * * * *"

[[triggers.crons]]
cron = "0 4 * * *"

[[triggers.crons]]
cron = "0 5 * * 0"

[vars]
# EBIRD_API_KEY is set via `wrangler secret put EBIRD_API_KEY`
```

- [ ] **Step 3: Write `tsconfig.worker.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2022"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "types": ["@cloudflare/workers-types"]
  },
  "include": ["src/worker.ts", "src/handler.ts", "src/run-ingest.ts", "src/run-hotspots.ts", "src/run-backfill.ts", "src/transform.ts", "src/ebird"]
}
```

- [ ] **Step 4: Add `@cloudflare/workers-types` and `wrangler` as devDependencies**

Edit `services/ingestor/package.json`, add:
```json
"devDependencies": {
  "@cloudflare/workers-types": "^4.20240117.0",
  "wrangler": "^3.25.0",
  ...
}
```

Then:
```bash
npm install
```

- [ ] **Step 5: Deploy after filling Hyperdrive ID**

```bash
HYPERDRIVE_ID=$(cd ../../infra/terraform && terraform output -raw hyperdrive_id)
sed -i.bak "s/REPLACE_WITH_HYPERDRIVE_ID/$HYPERDRIVE_ID/" wrangler.toml
rm wrangler.toml.bak

cd services/ingestor
npx wrangler secret put EBIRD_API_KEY  # paste your eBird key
npx wrangler deploy
```

Expected: `Deployed birdwatch-ingestor`. The cron triggers are registered.

- [ ] **Step 6: Trigger a test invocation**

```bash
npx wrangler tail birdwatch-ingestor &
# In Cloudflare dashboard → Workers → birdwatch-ingestor → "Schedule" → "Test schedule" → cron "*/30 * * * *"
```

Expected: a log line `{"event":"ingest_done","kind":"recent","result":{"status":"success",...}}`.

- [ ] **Step 7: Verify rows in Neon**

```bash
psql "$DATABASE_URL" -c "SELECT count(*) FROM observations;"
```

Expected: a non-zero count (real eBird data for AZ in the last 14 days).

- [ ] **Step 8: Commit**

```bash
git add services/ingestor/src/worker.ts services/ingestor/wrangler.toml services/ingestor/tsconfig.worker.json services/ingestor/package.json package-lock.json
git commit -m "infra: deploy ingestor as Cloudflare Worker with cron + Hyperdrive"
```

---

### Task 6: Cloudflare wrapper for the Read API Worker

**Files:**
- Create: `services/read-api/src/worker.ts`
- Create: `services/read-api/wrangler.toml`
- Create: `services/read-api/tsconfig.worker.json`

- [ ] **Step 1: Write the Worker entrypoint**

`services/read-api/src/worker.ts`:
```typescript
import { createApp } from './app.js';
import { createPool } from '@bird-watch/db-client';

export interface Env {
  HYPERDRIVE: { connectionString: string };
}

let cachedPool: ReturnType<typeof createPool> | null = null;

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (!cachedPool) {
      cachedPool = createPool({
        databaseUrl: env.HYPERDRIVE.connectionString,
        key: 'worker-pool',
        max: 4,
      });
    }
    const app = createApp({ pool: cachedPool });
    return app.fetch(req);
  },
} satisfies ExportedHandler<Env>;

type ExportedHandler<E> = { fetch(req: Request, env: E): Promise<Response>; };
```

- [ ] **Step 2: Write `services/read-api/wrangler.toml`**

```toml
name = "birdwatch-read-api"
main = "src/worker.ts"
compatibility_date = "2026-04-01"
compatibility_flags = ["nodejs_compat"]

[[hyperdrive]]
binding = "HYPERDRIVE"
id = "REPLACE_WITH_HYPERDRIVE_ID"

[[routes]]
pattern = "api.${DOMAIN}/*"
zone_name = "${DOMAIN}"
```

(`${DOMAIN}` is illustrative — wrangler doesn't expand env vars in TOML by default. We'll patch it from a deploy script.)

- [ ] **Step 3: Write `tsconfig.worker.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2022"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "types": ["@cloudflare/workers-types"]
  },
  "include": ["src/worker.ts", "src/app.ts", "src/cache-headers.ts"]
}
```

- [ ] **Step 4: Add Workers types + wrangler to dev deps**

Edit `services/read-api/package.json`, add to devDependencies:
```json
"@cloudflare/workers-types": "^4.20240117.0",
"wrangler": "^3.25.0"
```

Run `npm install`.

- [ ] **Step 5: Deploy**

```bash
cd services/read-api
HYPERDRIVE_ID=$(cd ../../infra/terraform && terraform output -raw hyperdrive_id)
DOMAIN=$(cd ../../infra/terraform && terraform output -raw root_domain 2>/dev/null || echo "your.domain")
sed -i.bak "s/REPLACE_WITH_HYPERDRIVE_ID/$HYPERDRIVE_ID/; s|\${DOMAIN}|$DOMAIN|g" wrangler.toml
rm wrangler.toml.bak
npx wrangler deploy
```

Expected: `Deployed birdwatch-read-api` + a route `api.<your-domain>/*`.

- [ ] **Step 6: Smoke-test**

```bash
curl -i "https://api.${DOMAIN}/health"
curl -i "https://api.${DOMAIN}/api/regions"
```

Expected: 200 OK with JSON; `Cache-Control` header set per spec.

- [ ] **Step 7: Commit**

```bash
git add services/read-api/src/worker.ts services/read-api/wrangler.toml services/read-api/tsconfig.worker.json services/read-api/package.json package-lock.json
git commit -m "infra: deploy read-api as Cloudflare Worker"
```

---

### Task 7: DNS records via Terraform

**Files:**
- Create: `infra/terraform/dns.tf`

- [ ] **Step 1: Write `dns.tf`**

```hcl
# A worker.dev route is created automatically; this adds a CNAME
# from your custom api subdomain to the Worker for nicer URLs.
resource "cloudflare_record" "api" {
  zone_id = var.zone_id
  name    = "api"
  type    = "AAAA"
  value   = "100::"  # placeholder; Cloudflare proxy handles the actual routing
  proxied = true
  ttl     = 1
}

# The Pages project below issues its own custom domain config.
output "api_url" {
  value = "https://api.${var.domain}"
}

output "root_domain" {
  value = var.domain
}
```

- [ ] **Step 2: Apply**

```bash
cd infra/terraform
terraform apply
```

Expected: a CNAME-style AAAA record for `api.<your-domain>` pointing through Cloudflare's proxy.

- [ ] **Step 3: Commit**

```bash
git add infra/terraform/dns.tf
git commit -m "infra: DNS record for api subdomain"
```

---

### Task 8: Cloudflare Pages for the frontend

**Files:**
- Create: `infra/terraform/pages.tf`
- Create: `frontend/.env.production`

- [ ] **Step 1: Write `pages.tf`**

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

output "pages_subdomain" {
  value = cloudflare_pages_project.frontend.subdomain
}

output "frontend_url" {
  value = "https://${var.domain}"
}
```

- [ ] **Step 2: Apply**

```bash
terraform apply
```

- [ ] **Step 3: Tell the frontend the API base URL**

`frontend/.env.production`:
```
VITE_API_BASE_URL=https://api.<your-domain-here>
```

(Replace at deploy time with a `sed` invocation, or set in Cloudflare Pages env vars.)

Modify `frontend/src/api/client.ts` constructor default:
```typescript
constructor(opts: ApiClientOptions = {}) {
  this.baseUrl = opts.baseUrl ?? import.meta.env.VITE_API_BASE_URL ?? '';
}
```

- [ ] **Step 4: Build + deploy**

```bash
cd frontend
npm run build
npx wrangler pages deploy dist --project-name=birdwatch --branch=main
```

Expected: a deploy URL like `https://abcd1234.birdwatch.pages.dev`. After DNS propagates, also reachable at your custom domain.

- [ ] **Step 5: Smoke-test**

Visit `https://<your-domain>`. Expected: map renders, observations load (DB has data from ingestor's first run).

- [ ] **Step 6: Commit**

```bash
git add infra/terraform/pages.tf frontend/.env.production frontend/src/api/client.ts
git commit -m "infra: Cloudflare Pages for frontend with API base URL"
```

---

### Task 9: One-shot deploy script

**Files:**
- Create: `scripts/deploy.sh`

- [ ] **Step 1: Write the script**

`scripts/deploy.sh`:
```bash
#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

echo "[1/6] terraform apply..."
(cd infra/terraform && terraform apply -auto-approve)

echo "[2/6] resolve outputs..."
HYPERDRIVE_ID=$(cd infra/terraform && terraform output -raw hyperdrive_id)
DB_URL=$(cd infra/terraform && terraform output -raw neon_db_url)
DOMAIN=$(cd infra/terraform && terraform output -raw root_domain)

echo "[3/6] migrations..."
DATABASE_URL="$DB_URL" ./scripts/migrate-deploy.sh

echo "[4/6] deploy ingestor..."
(cd services/ingestor
 sed -i.bak "s/REPLACE_WITH_HYPERDRIVE_ID/$HYPERDRIVE_ID/" wrangler.toml || true
 rm -f wrangler.toml.bak
 npx wrangler deploy)

echo "[5/6] deploy read-api..."
(cd services/read-api
 sed -i.bak "s/REPLACE_WITH_HYPERDRIVE_ID/$HYPERDRIVE_ID/; s|\${DOMAIN}|$DOMAIN|g" wrangler.toml || true
 rm -f wrangler.toml.bak
 npx wrangler deploy)

echo "[6/6] build + deploy frontend..."
echo "VITE_API_BASE_URL=https://api.$DOMAIN" > frontend/.env.production
(cd frontend
 npm run build
 npx wrangler pages deploy dist --project-name=birdwatch --branch=main)

echo
echo "Deployed."
echo "  Frontend:  https://$DOMAIN"
echo "  API:       https://api.$DOMAIN"
echo "  Ingestor:  birdwatch-ingestor (cron-driven)"
```

- [ ] **Step 2: Make executable**

```bash
chmod +x scripts/deploy.sh
```

- [ ] **Step 3: Run end-to-end**

```bash
./scripts/deploy.sh
```

Expected: every step prints "complete"; final URLs printed.

- [ ] **Step 4: Commit**

```bash
git add scripts/deploy.sh
git commit -m "infra: one-shot deploy script"
```

---

### Task 10: Post-deploy smoke test

**Files:**
- Create: `scripts/smoke-test.sh`

- [ ] **Step 1: Write the script**

`scripts/smoke-test.sh`:
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

Expected: every check prints success; final line `All smoke checks passed.`

- [ ] **Step 3: Commit**

```bash
git add scripts/smoke-test.sh
git commit -m "infra: post-deploy smoke test"
```

---

### Task 11: Update root README with deploy instructions

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Append a "Deployment" section to `README.md`**

```markdown
## Deployment

This project deploys to Cloudflare Workers + Cloudflare Pages + Neon Postgres.

### Prerequisites

- Cloudflare account with a zone you control
- Neon account
- eBird API key (free at ebird.org/api/keygen)
- Terraform ≥ 1.6
- `psql` on `$PATH` (for migrations)

### One-time setup

1. Copy `infra/terraform/terraform.tfvars.example` to `infra/terraform/terraform.tfvars` and fill in:
   - `cloudflare_account_id`, `cloudflare_api_token`, `zone_id`, `domain`
   - `neon_api_key`
   - `ebird_api_key`
2. Initialize Terraform:
   ```bash
   cd infra/terraform && terraform init
   ```
3. Run the full deploy:
   ```bash
   ./scripts/deploy.sh
   ```
4. Smoke-test:
   ```bash
   ./scripts/smoke-test.sh
   ```

### Subsequent deploys

After code changes:
- Frontend / Worker code only: `./scripts/deploy.sh` (Terraform sees no diff and skips infra changes)
- Schema changes: add a migration file under `migrations/`, then `./scripts/deploy.sh`
- Infra changes: edit `infra/terraform/*.tf`, then `./scripts/deploy.sh`
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: deployment instructions"
```

---

### Task 12: Record outputs for documentation

**Files:**
- Create: `infra/terraform/outputs.tf` (consolidated)

- [ ] **Step 1: Write a consolidated outputs file (the others can stay as inline outputs; this is a summary)**

```hcl
output "summary" {
  value = {
    frontend_url = "https://${var.domain}"
    api_url      = "https://api.${var.domain}"
    db_host      = neon_endpoint.main.host
    hyperdrive   = cloudflare_hyperdrive_config.birdwatch.id
  }
}
```

- [ ] **Step 2: Apply (no resource changes — output added)**

```bash
cd infra/terraform
terraform apply
terraform output summary
```

Expected: a single block printing all four URLs/IDs.

- [ ] **Step 3: Commit**

```bash
git add infra/terraform/outputs.tf
git commit -m "infra: consolidated summary output"
```

---

## Self-review checklist (run before declaring Plan 5 done)

- [ ] `terraform init` and `terraform validate` succeed in `infra/terraform/`
- [ ] `terraform apply` provisions all resources (Neon project + branch + DB + endpoint, Hyperdrive, Pages project + domain, DNS, no Worker scripts in TF — those are deployed by Wrangler)
- [ ] `./scripts/deploy.sh` runs end-to-end without errors
- [ ] `./scripts/smoke-test.sh` passes
- [ ] Browsing `https://<domain>` renders the live map with real eBird data
- [ ] After 30 min, a fresh ingest run is visible in `ingest_runs` table
- [ ] No secret values are committed to git (verified by `git log -p | grep -iE 'api_key|password|secret'` returning no matches)

When all checked: Plan 5 is done. The system is live.

---

## What the live system looks like

- **Web:** `https://<your-domain>` — React app loads, fetches `/api/observations`, `/api/regions`, `/api/hotspots`, renders map.
- **API:** `https://api.<your-domain>/api/*` — Cloudflare Worker, Hyperdrive-pooled DB, CDN cache per spec TTLs.
- **Ingestor:** `birdwatch-ingestor` Worker, `*/30` cron pulls eBird, `0 4 * * *` does the daily back-fill, `0 5 * * 0` refreshes hotspot list weekly.
- **DB:** Neon Postgres with PostGIS, ~240 MB/year growth, queryable from any BI tool via `terraform output -raw neon_db_url`.

Everything reproducible from `git clone` + `./scripts/deploy.sh` (with secrets in `terraform.tfvars`).
