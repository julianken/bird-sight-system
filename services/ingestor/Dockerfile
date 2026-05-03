FROM node:24-alpine AS build
WORKDIR /repo

COPY package.json package-lock.json ./
COPY tsconfig.base.json ./
COPY packages ./packages
COPY services/ingestor ./services/ingestor

RUN npm ci --workspaces --include-workspace-root --include=dev
RUN npm run build --workspace @bird-watch/shared-types
RUN npm run build --workspace @bird-watch/db-client
RUN npm run build --workspace @bird-watch/ingestor

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production

# scripts/purge-species-cache.sh shells out to curl + jq; alpine ships neither.
# Pinned via --no-cache to keep the layer small (no /var/cache/apk).
RUN apk add --no-cache bash curl jq

COPY --from=build /repo/package.json /repo/package-lock.json ./
COPY --from=build /repo/packages/db-client ./packages/db-client
COPY --from=build /repo/packages/shared-types ./packages/shared-types
COPY --from=build /repo/services/ingestor/package.json ./services/ingestor/
COPY --from=build /repo/services/ingestor/dist ./services/ingestor/dist

# run-descriptions.ts shells out to ./scripts/purge-species-cache.sh on the
# daily Cloud Run Job; without this COPY the daily cron logs ENOENT (#379).
# The script is mode 100755 in the git index, so COPY preserves the +x bit
# without an explicit chmod.
COPY scripts/purge-species-cache.sh ./scripts/

RUN npm ci --omit=dev --workspaces --include-workspace-root

# Drop root — alpine images ship a built-in 'node' user (uid 1000).
# No HEALTHCHECK: ingestor is a Cloud Run Job (run-to-completion), not a service.
USER node

# The Cloud Run Job invokes this entrypoint with the kind as $1.
ENTRYPOINT ["node", "services/ingestor/dist/cli.js"]
