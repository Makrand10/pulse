#!/usr/bin/env bash
# Combined Temporal demo service (Render Free, single container):
#
#   Temporal Server  (gRPC on 127.0.0.1:7233, never needs to be public)
#   Pulse Temporal worker          (task queue: health-checks)
#   Temporal REST-to-gRPC proxy    (official render-examples/temporal-rest-proxy)
#   Health front door              (HTTP on $PORT, what Render talks to)
#
# The container fails loudly and exits non-zero if the database cannot be set
# up, if Temporal never becomes healthy, or if the worker / proxy cannot start.
# If any child dies later the whole container goes down so Render restarts it
# instead of leaving a half-dead service serving traffic.

set -euo pipefail

log() { echo "[temporal-demo] $*"; }
die() { echo "[temporal-demo] FATAL: $*" >&2; exit 1; }

require_env() {
  local name="$1"
  if [ -z "${!name:-}" ]; then
    die "$name is required (see README -> 'Render Free Demo Deployment')"
  fi
}

# ---- configuration -------------------------------------------------------
PORT="${PORT:-8080}"
REST_PROXY_PORT="${REST_PROXY_PORT:-10000}"
TEMPORAL_START_TIMEOUT_SECONDS="${TEMPORAL_START_TIMEOUT_SECONDS:-180}"
WORKER_START_GRACE_SECONDS="${WORKER_START_GRACE_SECONDS:-8}"

# Temporal itself only ever talks to itself over loopback.
export BIND_ON_IP="${BIND_ON_IP:-0.0.0.0}"
export TEMPORAL_ADDRESS="${TEMPORAL_ADDRESS:-127.0.0.1:7233}"
export TEMPORAL_CLUSTER_HOST="${TEMPORAL_CLUSTER_HOST:-127.0.0.1}"
export TEMPORAL_NAMESPACE="${TEMPORAL_NAMESPACE:-default}"
export TEMPORAL_CLI_ADDRESS="${TEMPORAL_CLI_ADDRESS:-$TEMPORAL_ADDRESS}"
export ENABLE_ES="${ENABLE_ES:-false}"

# The Pulse worker talks to the local Temporal server over plaintext gRPC.
export TEMPORAL_TLS=false

CHILD_PIDS=""
add_child() { CHILD_PIDS="$CHILD_PIDS $1"; }

stop_children() {
  log "stopping child processes"
  for pid in $CHILD_PIDS; do kill -TERM "$pid" 2>/dev/null || true; done
  local waited=0
  while [ "$waited" -lt 10 ]; do
    local alive=0
    for pid in $CHILD_PIDS; do kill -0 "$pid" 2>/dev/null && alive=1; done
    if [ "$alive" -eq 0 ]; then return 0; fi
    sleep 1
    waited=$((waited + 1))
  done
  for pid in $CHILD_PIDS; do kill -KILL "$pid" 2>/dev/null || true; done
}

on_signal() {
  trap - TERM INT
  log "shutdown signal received"
  stop_children
  exit 0
}
trap on_signal TERM INT

# ---- preflight -----------------------------------------------------------
command -v temporal-rest-proxy >/dev/null 2>&1 || die "REST-to-gRPC proxy binary missing from image"
[ -f /pulse/apps/backend/dist/temporal/worker.js ] || die "Pulse worker build missing from image"
require_env AUTH_TOKEN

if [ "${SKIP_DB_SETUP:-false}" != "true" ]; then
  for name in DB DB_PORT POSTGRES_SEEDS POSTGRES_USER POSTGRES_PWD DBNAME; do
    require_env "$name"
  done
  log "temporal database: ${DB} at ${POSTGRES_SEEDS}:${DB_PORT} (db ${DBNAME})"
fi

# The official proxy hardcodes its listener on :10000 and cannot be reconfigured,
# so the public front door must not be given the same port: binding 0.0.0.0:10000
# collides with the proxy's 127.0.0.1:10000. Render assigns PORT for us, so this
# is a real deploy-time failure mode (Render's default is 10000) - fail loudly
# with the fix rather than dying with a bare EADDRINUSE later.
if [ "$PORT" = "$REST_PROXY_PORT" ]; then
  die "PORT ($PORT) must not equal REST_PROXY_PORT ($REST_PROXY_PORT): the official REST-to-gRPC proxy always listens on :$REST_PROXY_PORT. Set PORT to another port (e.g. 8080) in the service's environment."
fi
log "public port ${PORT}, internal REST proxy port ${REST_PROXY_PORT}"

# ---- 1. render config + database schema/namespace setup ------------------
log "rendering temporal config"
dockerize -template /etc/temporal/config/config_template.yaml:/etc/temporal/config/docker.yaml ||
  die "failed to render /etc/temporal/config/docker.yaml"

if [ "${SKIP_DB_SETUP:-false}" != "true" ]; then
  # auto-setup.sh creates the schema, registers the default namespace and adds
  # the custom search attributes. A non-zero exit means the DB is unusable.
  log "running auto-setup against the database"
  /etc/temporal/auto-setup.sh ||
    die "Temporal database setup failed (check DB, DB_PORT, POSTGRES_SEEDS/USER/PWD, DBNAME and the Neon TLS settings)"
  log "database ready"
fi

# ---- 2. Temporal server --------------------------------------------------
log "starting temporal server (gRPC ${TEMPORAL_ADDRESS})"
/etc/temporal/start-temporal.sh &
TEMPORAL_PID=$!
add_child "$TEMPORAL_PID"

wait_for_temporal() {
  local deadline=$((SECONDS + TEMPORAL_START_TIMEOUT_SECONDS))
  local healthy=0
  while [ "$SECONDS" -lt "$deadline" ]; do
    if ! kill -0 "$TEMPORAL_PID" 2>/dev/null; then
      die "temporal server exited during startup (see logs above)"
    fi
    if nc -z 127.0.0.1 7233 2>/dev/null && temporal operator cluster health 2>/dev/null | grep -q SERVING; then
      healthy=1
      break
    fi
    sleep 2
  done
  [ "$healthy" -eq 1 ] || die "temporal cluster not healthy within ${TEMPORAL_START_TIMEOUT_SECONDS}s"

  # The worker binds to a namespace, so wait for its registration too.
  local ns_deadline=$((SECONDS + TEMPORAL_START_TIMEOUT_SECONDS))
  while [ "$SECONDS" -lt "$ns_deadline" ]; do
    if temporal operator namespace describe "$TEMPORAL_NAMESPACE" >/dev/null 2>&1; then
      log "temporal cluster healthy, namespace '${TEMPORAL_NAMESPACE}' registered"
      return 0
    fi
    sleep 2
  done
  die "namespace ${TEMPORAL_NAMESPACE} was not registered in time"
}
wait_for_temporal

# ---- 3. Pulse Temporal worker -------------------------------------------
log "starting pulse temporal worker (native gRPC on ${TEMPORAL_ADDRESS})"
cd /pulse/apps/backend
node dist/temporal/worker.js &
WORKER_PID=$!
add_child "$WORKER_PID"

sleep "$WORKER_START_GRACE_SECONDS"
if ! kill -0 "$WORKER_PID" 2>/dev/null; then
  wait "$WORKER_PID" 2>/dev/null || true
  die "pulse temporal worker failed to start (see worker logs above)"
fi
log "pulse temporal worker is up"

# ---- 4. official REST-to-gRPC proxy --------------------------------------
log "starting temporal REST-to-gRPC proxy on 127.0.0.1:${REST_PROXY_PORT}"
temporal-rest-proxy &
PROXY_PID=$!
add_child "$PROXY_PID"

proxy_deadline=$((SECONDS + 30))
proxy_up=0
while [ "$SECONDS" -lt "$proxy_deadline" ]; do
  if nc -z 127.0.0.1 "$REST_PROXY_PORT" 2>/dev/null; then
    proxy_up=1
    break
  fi
  if ! kill -0 "$PROXY_PID" 2>/dev/null; then
    wait "$PROXY_PID" 2>/dev/null || true
    die "REST-to-gRPC proxy exited during startup (see logs above)"
  fi
  sleep 1
done
[ "$proxy_up" -eq 1 ] || die "REST-to-gRPC proxy not listening on ${REST_PROXY_PORT} in time"
log "REST-to-gRPC proxy is up"

# ---- 5. health front door (the only thing Render talks to) ---------------
log "starting health front door on 0.0.0.0:${PORT}"
node /pulse/infra/temporal-demo/health-proxy.mjs &
HEALTH_PID=$!
add_child "$HEALTH_PID"

# ---- 6. supervise --------------------------------------------------------
log "temporal demo service ready"
set +e
# Returns as soon as any child exits; a dead child takes the container down.
wait -n
status=$?
set -e
log "a child process exited (status ${status}); bringing the container down"
stop_children
exit 1
