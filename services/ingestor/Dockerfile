FROM node:24-alpine AS build
WORKDIR /repo

COPY package.json package-lock.json ./
COPY tsconfig.base.json ./
COPY packages ./packages
COPY services/ingestor ./services/ingestor

# --ignore-scripts: the monorepo install pulls EVERY workspace's deps, including
# packages/eleatic's `better-sqlite3` (the local eval store). better-sqlite3 ships
# no musl prebuilt, so on this alpine (musl) image its install falls back to
# `node-gyp rebuild`, which needs Python + a C toolchain the build image lacks —
# failing the whole image build (and thus every ingestor deploy since eleatic
# landed, #1153). The ingestor uses NO native modules (its deps — @aws-sdk/*,
# @google-cloud/storage, parquetjs-lite, isomorphic-dompurify, pg via db-client,
# @bird-watch/* — are pure JS), so skipping install lifecycle scripts is safe:
# better-sqlite3 is fetched but never compiled or loaded. The explicit
# `npm run build` steps below are NOT install lifecycle scripts and still run.
# Mirrors the read-api Dockerfile fix (#1180).
RUN npm ci --workspaces --include-workspace-root --include=dev --ignore-scripts
RUN npm run build --workspace @bird-watch/shared-types
RUN npm run build --workspace @bird-watch/db-client
RUN npm run build --workspace @bird-watch/ingestor

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /repo/package.json /repo/package-lock.json ./
COPY --from=build /repo/packages/db-client ./packages/db-client
COPY --from=build /repo/packages/shared-types ./packages/shared-types
# #866 — @bird-watch/geo is source-only (no dist build): its exports.default
# points at src/index.ts, which Node strips-and-runs natively (node:24-alpine).
# The runtime image must carry the geo source so the cache-warmer's
# `import '@bird-watch/geo'` resolves at runtime AND the workspace install below
# can link it.
COPY --from=build /repo/packages/geo ./packages/geo
COPY --from=build /repo/services/ingestor/package.json ./services/ingestor/
COPY --from=build /repo/services/ingestor/dist ./services/ingestor/dist

# --ignore-scripts: same reason as the build stage — skip the native build of the
# unused better-sqlite3 (musl, no prebuilt) so the runtime install doesn't fail.
RUN npm ci --omit=dev --workspaces --include-workspace-root --ignore-scripts

# Drop root — alpine images ship a built-in 'node' user (uid 1000).
# No HEALTHCHECK: ingestor is a Cloud Run Job (run-to-completion), not a service.
USER node

# The Cloud Run Job invokes this entrypoint with the kind as $1.
ENTRYPOINT ["node", "services/ingestor/dist/cli.js"]
