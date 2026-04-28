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
RUN npm run build --workspace @bird-watch/read-api

# Runtime stage — copy only what we need.
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080

COPY --from=build /repo/package.json /repo/package-lock.json ./
COPY --from=build /repo/packages/db-client ./packages/db-client
COPY --from=build /repo/packages/shared-types ./packages/shared-types
COPY --from=build /repo/services/read-api/package.json ./services/read-api/
COPY --from=build /repo/services/read-api/dist ./services/read-api/dist

RUN npm ci --omit=dev --workspaces --include-workspace-root

EXPOSE 8080
CMD ["node", "services/read-api/dist/local.js"]
