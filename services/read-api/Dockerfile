# Build stage — uses the monorepo root context.
FROM node:24-alpine AS build
WORKDIR /repo

# Copy package manifests first for cached install.
COPY package.json package-lock.json ./
COPY tsconfig.base.json ./
COPY packages ./packages
COPY services/read-api ./services/read-api

# --ignore-scripts: the monorepo install pulls EVERY workspace's deps, including
# tools/photo-curation's `better-sqlite3` (the local eval store, also pulled
# transitively by the `eleatic` git dependency). better-sqlite3 ships
# no musl prebuilt, so on this alpine (musl) image its install falls back to
# `node-gyp rebuild`, which needs Python + a C toolchain the build image lacks —
# failing the whole image build (and thus every read-api deploy since eleatic
# landed, #1153). The read-api uses NO native modules (hono, pg, @bird-watch/* are
# pure JS), so skipping install lifecycle scripts is safe: better-sqlite3 is
# fetched but never compiled or loaded. The explicit `npm run build` steps below
# are NOT install lifecycle scripts and still run.
RUN npm ci --workspaces --include-workspace-root --include=dev --ignore-scripts
RUN npm run build --workspace @bird-watch/shared-types
RUN npm run build --workspace @bird-watch/db-client
RUN npm run build --workspace @bird-watch/read-api

# Runtime stage — copy only what we need.
FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080

COPY --from=build /repo/package.json /repo/package-lock.json ./
COPY --from=build /repo/packages/db-client ./packages/db-client
COPY --from=build /repo/packages/shared-types ./packages/shared-types
COPY --from=build /repo/services/read-api/package.json ./services/read-api/
COPY --from=build /repo/services/read-api/dist ./services/read-api/dist

# --ignore-scripts: same reason as the build stage — skip the native build of the
# unused better-sqlite3 (musl, no prebuilt) so the runtime install doesn't fail.
RUN npm ci --omit=dev --workspaces --include-workspace-root --ignore-scripts

# Drop root — alpine images ship a built-in 'node' user (uid 1000).
USER node

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q --spider http://localhost:8080/health || exit 1
CMD ["node", "services/read-api/dist/local.js"]
