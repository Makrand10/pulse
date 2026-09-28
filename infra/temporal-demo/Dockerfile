# Combined Temporal demo service for Render Free.
#
# One container runs:
#   1. Temporal Server                    (temporalio/auto-setup, loopback gRPC)
#   2. Pulse Temporal worker              (native gRPC on 127.0.0.1:7233)
#   3. Temporal REST-to-gRPC proxy        (official render-examples repo)
#   4. Health front door                  (HTTP on $PORT, what Render routes to)
#
# Render can only serve one public HTTP port, and gRPC does not survive the
# public HTTPS edge. The official proxy re-exposes the workflow service as REST
# so the Pulse backend - which runs on a different Render service - can start
# and terminate the very same workflows over HTTPS.
#
# Build from the REPOSITORY ROOT (Render: Root Directory = "/", Dockerfile
# Path = ./infra/temporal-demo/Dockerfile), because the worker build needs the
# workspace layout.

# syntax=docker/dockerfile:1

ARG NODE_IMAGE=node:20-alpine3.19
ARG TEMPORAL_IMAGE=temporalio/auto-setup:1.25.2
ARG REST_PROXY_REF=main

# ---------------------------------------------------------------------------
# 1. Official Render REST-to-gRPC proxy (Go). Built from source because the
#    project does not publish a binary or image. Pin REST_PROXY_REF to a commit
#    sha for reproducible builds.
# ---------------------------------------------------------------------------
FROM golang:1.24-bookworm AS rest-proxy

ARG REST_PROXY_REF
RUN git clone --depth 1 --branch "${REST_PROXY_REF}" \
      https://github.com/render-examples/temporal-rest-proxy.git /src
WORKDIR /src
# CGO_ENABLED=0 is required: the builder is glibc (bookworm) but the runtime
# image is Alpine/musl, which has no /lib64/ld-linux-x86-64.so.2. A CGO build
# is dynamically linked against glibc and dies with "not found" (exit 127) on
# Alpine. A static binary runs on musl unchanged.
RUN CGO_ENABLED=0 go build -trimpath -ldflags "-s -w" -o /out/temporal-rest-proxy ./rest-proxy

# ---------------------------------------------------------------------------
# 2. Pulse worker dependencies + build (mirrors apps/backend/Dockerfile).
# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS deps
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

# ---------------------------------------------------------------------------
# 3. Runtime: Temporal image + Node 20 (Alpine 3.19 build, musl-compatible).
# ---------------------------------------------------------------------------
FROM ${TEMPORAL_IMAGE}

USER root

# Node's official Alpine build links against libstdc++/libgcc that the temporal
# image does not ship. Both are Alpine 3.19, so the loader stays compatible; the
# libs are staged in a writable dir because /usr/lib is read-only for us.
COPY --from=deps /usr/local/bin/node /usr/local/bin/node
COPY --from=deps /usr/lib/libstdc++.so.6.0.32 /opt/node-libs/libstdc++.so.6
COPY --from=deps /usr/lib/libgcc_s.so.1 /opt/node-libs/libgcc_s.so.1
ENV LD_LIBRARY_PATH=/opt/node-libs

# REST-to-gRPC proxy: the upstream binary hardcodes its :10000 listener (see
# rest-proxy/main.go) and offers no flag or env var for it, so REST_PROXY_PORT
# below is documentation of that fixed value, not a knob. TEMPORAL_CLUSTER_HOST
# + AUTH_TOKEN are configurable.
COPY --from=rest-proxy /out/temporal-rest-proxy /usr/local/bin/temporal-rest-proxy

# PORT is the public port Render routes to the health front door. It must not be
# 10000: the proxy owns that port inside this container and 0.0.0.0:10000 would
# collide with 127.0.0.1:10000. entrypoint.sh refuses to start if they match.
ENV NODE_ENV=production \
    PORT=8080 \
    BIND_ON_IP=0.0.0.0 \
    TEMPORAL_ADDRESS=127.0.0.1:7233 \
    TEMPORAL_NAMESPACE=default \
    TEMPORAL_TLS=false \
    TEMPORAL_CLUSTER_HOST=127.0.0.1 \
    REST_PROXY_PORT=10000

# Pulse worker runtime (same layout as the backend image, no API server).
# WORKDIR must stay /etc/temporal (the base image's): `temporal-server --env docker
# start` loads ./config/docker.yaml relative to the working directory and exits with
# "config file corrupted" from anywhere else. Paths below are absolute so the app
# tree stays at /pulse whatever WORKDIR is.
WORKDIR /etc/temporal
COPY --from=deps /pulse/node_modules /pulse/node_modules
COPY --from=deps /pulse/package.json /pulse/package.json
COPY --from=deps /pulse/apps/backend/package.json /pulse/apps/backend/package.json
COPY --from=build /pulse/packages/shared-types /pulse/packages/shared-types
COPY --from=build /pulse/apps/backend/dist /pulse/apps/backend/dist
COPY infra/temporal-demo/entrypoint.sh /pulse/infra/temporal-demo/entrypoint.sh
COPY infra/temporal-demo/health-proxy.mjs /pulse/infra/temporal-demo/health-proxy.mjs
RUN chmod +x /pulse/infra/temporal-demo/entrypoint.sh

# Render routes its public URL to $PORT (the health front door). gRPC stays on
# loopback and is deliberately not exposed.
EXPOSE 8080

ENTRYPOINT ["/pulse/infra/temporal-demo/entrypoint.sh"]
