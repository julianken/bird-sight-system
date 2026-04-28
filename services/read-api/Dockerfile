# Build stage — uses the monorepo root context.
FROM node:24-alpine AS build
WORKDIR /repo

# Copy package manifests first for cached install.
COPY package.json package-lock.json ./
COPY tsconfig.base.json ./
COPY packages ./packages
COPY services/read-api ./services/read-api

RUN npm ci --workspaces --include-workspace-root --include=dev
RUN npm run build --workspace @bird-watch/shared-types
RUN npm run build --workspace @bird-watch/db-client
RUN npm run build --workspace @bird-watch/read-api

# Runtime stage — copy only what we need.
FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080

COPY --from=build /repo/package.json /repo/package-lock.json ./
COPY --from=build /repo/packages ./packages
COPY --from=build /repo/services/read-api/package.json ./services/read-api/
COPY --from=build /repo/services/read-api/dist ./services/read-api/dist

RUN npm ci --omit=dev --workspaces --include-workspace-root

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q --spider http://localhost:8080/health || exit 1
CMD ["node", "services/read-api/dist/local.js"]
