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

COPY --from=build /repo/package.json /repo/package-lock.json ./
COPY --from=build /repo/packages/db-client ./packages/db-client
COPY --from=build /repo/packages/shared-types ./packages/shared-types
COPY --from=build /repo/services/ingestor/package.json ./services/ingestor/
COPY --from=build /repo/services/ingestor/dist ./services/ingestor/dist

RUN npm ci --omit=dev --workspaces --include-workspace-root

# Drop root — alpine images ship a built-in 'node' user (uid 1000).
# No HEALTHCHECK: ingestor is a Cloud Run Job (run-to-completion), not a service.
USER node

# The Cloud Run Job invokes this entrypoint with the kind as $1.
ENTRYPOINT ["node", "services/ingestor/dist/cli.js"]
