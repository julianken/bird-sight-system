# Build stage — uses the monorepo root context.
FROM node:24-alpine AS build
WORKDIR /repo

COPY package.json package-lock.json ./
COPY tsconfig.base.json ./
COPY packages ./packages
COPY services/admin-api ./services/admin-api

RUN npm ci --workspaces --include-workspace-root --include=dev
RUN npm run build --workspace @bird-watch/shared-types
RUN npm run build --workspace @bird-watch/db-client
RUN npm run build --workspace @bird-watch/admin-api

# Runtime stage.
FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080

COPY --from=build /repo/package.json /repo/package-lock.json ./
COPY --from=build /repo/packages/db-client ./packages/db-client
COPY --from=build /repo/packages/shared-types ./packages/shared-types
COPY --from=build /repo/services/admin-api/package.json ./services/admin-api/
COPY --from=build /repo/services/admin-api/dist ./services/admin-api/dist

RUN npm ci --omit=dev --workspaces --include-workspace-root

USER node

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q --spider http://localhost:8080/health || exit 1
CMD ["node", "services/admin-api/dist/local.js"]
