# ---- backend: Pulse API + workers ----
FROM node:20-slim AS deps
WORKDIR /pulse
COPY package.json package-lock.json ./
COPY apps/backend/package.json apps/backend/package.json
COPY apps/frontend/package.json apps/frontend/package.json
COPY packages/shared-types/package.json packages/shared-types/package.json
COPY tsconfig.base.json ./
COPY packages/shared-types/tsconfig.json packages/shared-types/tsconfig.json
COPY packages/shared-types/src packages/shared-types/src
RUN npm ci

FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/shared-types/tsconfig.json packages/shared-types/tsconfig.json
COPY packages/shared-types/src packages/shared-types/src
COPY apps/backend/tsconfig.json apps/backend/tsconfig.json
COPY apps/backend/src apps/backend/src
RUN npm run build -w @pulse/backend

FROM node:20-slim AS runtime
ENV NODE_ENV=production
WORKDIR /pulse
COPY --from=deps /pulse/node_modules ./node_modules
COPY --from=deps /pulse/package.json ./
COPY --from=deps /pulse/apps/backend/package.json ./apps/backend/package.json
COPY --from=build /pulse/packages/shared-types ./packages/shared-types
COPY --from=build /pulse/apps/backend/dist ./apps/backend/dist
COPY apps/backend/docker-entrypoint.js ./apps/backend/docker-entrypoint.js
COPY prompts ./prompts
WORKDIR /pulse/apps/backend
EXPOSE 4000
CMD ["node", "docker-entrypoint.js"]