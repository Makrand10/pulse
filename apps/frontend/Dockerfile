# ---- frontend: Next.js standalone build ----
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
COPY apps/frontend/next.config.js apps/frontend/next.config.js
COPY apps/frontend/tsconfig.json apps/frontend/tsconfig.json
COPY apps/frontend/public apps/frontend/public
COPY apps/frontend/src apps/frontend/src
# next.config.js rewrites are evaluated at BUILD time, so the proxy target must
# be baked now, not passed as runtime env. Compose passes http://backend:4000.
ARG BACKEND_INTERNAL_URL='http://localhost:4000'
ENV BACKEND_INTERNAL_URL=$BACKEND_INTERNAL_URL
RUN npm run build -w @pulse/frontend

FROM node:20-slim AS runtime
ENV NODE_ENV=production
# URL where the browser reaches the API. Leave empty for the same-origin rewrite
# in next.config.js (proxy via BACKEND_INTERNAL_URL); set it to a public backend
# base URL to split frontend/backend onto different hosts.
ARG NEXT_PUBLIC_API_URL=''
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
WORKDIR /app
COPY --from=build /pulse/apps/frontend/.next/standalone ./
COPY --from=build /pulse/apps/frontend/.next/static ./apps/frontend/.next/static
EXPOSE 3000
ENV PORT=3000
CMD ["node", "apps/frontend/server.js"]