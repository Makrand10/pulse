# Pulse

**API reliability & incident management platform — "Mini Datadog + PagerDuty for small teams."**

Register an HTTP(S) endpoint → get it health-checked on a durable schedule → automatically open an incident with a root-cause hypothesis when it breaks → track it to resolution → surface uptime history on a public status page.

## Architecture

```
┌─────────────┐      ┌──────────────────┐      ┌─────────────────────┐
│  Next.js     │◄────►│  Express API      │◄────►│  MongoDB (Atlas)     │
│  Frontend    │ HTTPS│  (JWT auth, CRUD) │      │  Users/Teams/APIs/   │
│  (Vercel)    │      │  (Render/Railway) │      │  Incidents/Checks    │
└─────────────┘      └────────┬──────────┘      └─────────────────────┘
                              │ reads/writes
                              ▼
                       ┌──────────────────┐
                       │  Redis (Upstash)  │  current-status cache + rate-limit
                       └──────────────────┘
                              ▲
                              │ signals workflow
                       ┌────────┴──────────┐
                       │  Temporal Worker   │  writes CheckResult,
                       │  healthCheckWorkflow│  triggers Incident Engine
                       │  per registered API │
                       └────────┬──────────┘
                              │ on incident-open
                              ▼
                       ┌──────────────────┐      ┌──────────────────┐
                       │  LangGraph Agent   │────► │  Claude API       │
                       │  (root-cause node) │      │  (grounded prompt)│
                       └──────────────────┘      └──────────────────┘
```

## Monorepo layout

```
pulse/
├── .github/workflows/       # CI/CD pipelines
├── apps/
│   ├── frontend/            # Next.js + TS + Tailwind
│   └── backend/             # Express API + Temporal worker + LangGraph agent
├── packages/
│   └── shared-types/        # Zod schemas + TS types shared FE/BE (prebuilt to dist/)
├── docker-compose.yml       # full-stack deployment: Mongo+Redis+Temporal+backend+frontend
├── .env.example
├── scripts/seed-demo.js     # optional: seeds a public "flappy" demo API
├── package.json             # workspaces root
└── README.md
```

## Getting started (local)

### Prerequisites

- Node.js ≥ 20, npm ≥ 10
- MongoDB, Redis, and a Temporal dev server (see below)

```bash
npm install
# prepare builds packages/shared-types to dist/ automatically.

# copy the env template and fill in at least JWT_SECRET and ENCRYPTION_KEY:
#   Windows:  copy .env.example .env
#   bash:     cp .env.example .env
```

Start infrastructure (MongoDB + Temporal; Redis via the Memurai service):

```powershell
# Windows
powershell -ExecutionPolicy Bypass -File scripts\start-infra.ps1
```

Then run the five processes in separate terminals:

```bash
npm run dev       -w @pulse/backend   # Express API, http://localhost:4000
npm run worker    -w @pulse/backend   # Temporal health-check worker
npm run ai-worker -w @pulse/backend   # AI incident analysis (Groq)
npm run notify    -w @pulse/backend   # email notifications
npm run dev       -w @pulse/frontend  # Next.js dashboard, http://localhost:3000
```

Open http://localhost:3000 — the frontend proxies `/api/*` to the backend, so
no separate API URL or CORS setup is needed.

### Run the tests

```bash
npm run test:unit         # backend unit tests
npm run test:integration  # backend integration tests (Mongo in-memory)
npm run -w @pulse/backend test -- --coverage   # full suite + coverage gate
```

## Deployment (Docker Compose — single host)

The app runs as two containers (`backend`: API + Temporal worker + AI analysis +
notifications under one supervisor; `frontend`: Next.js standalone) plus Mongo,
Redis and Temporal as infrastructure services. All infra ports stay internal —
the browser only talks to the frontend, which proxies `/api/*` to the backend.

1. Install Docker + Compose on your host (any Linux VPS, or locally).
2. Create your secrets file:
   ```bash
   cp .env.example .env
   # set JWT_SECRET and ENCRYPTION_KEY:
   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
   # optionally add GROQ_API_KEY (free AI summaries) and RESEND_API_KEY (email)
   ```
3. Build & start:
   ```bash
   docker compose up -d --build
   docker compose ps        # wait until backend reports "healthy"
   ```
4. Open `http://<host>:3000`, sign up an admin, add an API, flip it public,
   and share `http://<host>:3000/status/<teamSlug>/<apiSlug>`.
5. Optional — seed a public flappy demo API:
   ```bash
   PULSE_ADMIN_EMAIL=you@example.com PULSE_ADMIN_PASSWORD=yourpass node scripts/seed-demo.js
   ```

Notes:
- `PULSE_FRONTEND_PORT` / `PULSE_API_PORT` remap the exposure (default 3000/4000).
- Sanity checks: `curl http://localhost:4000/healthz` (API up) and
  `curl http://localhost:4000/readyz` (Mongo + Redis checks, returns 200 only when
  `services_healthy` is satisfied).
- The backend image bundles the AI root-cause prompt from `prompts/root-cause-v1.md`
  (`COPY prompts ./prompts`) so the ai-worker can load it inside the container.
- For HTTPS, put Caddy/Nginx in front of port 3000 and set `APP_BASE_URL`.
- To split the apps across hosts (e.g., frontend on Vercel, backend on Render),
  rebuild the frontend with `--build-arg NEXT_PUBLIC_API_URL=<public backend base>`
  and set `BACKEND_INTERNAL_URL=<public backend base>`.
- `docker compose down` stops everything; Mongo data persists in a named volume.

### Render Free Demo (no card, no paid services)

Two Render **Free** web services, plus the free tiers of Neon (Postgres),
MongoDB Atlas and Upstash (Redis). The frontend goes on Vercel.

```
browser ──HTTPS──> Vercel (Next.js) ──HTTPS──> pulse-backend  (Render Free, API + AI + notifications)
                                                        │
                                          TEMPORAL_TRANSPORT=rest (HTTPS + bearer token)
                                                        ▼
                                          pulse-temporal-demo (Render Free, ONE container)
                                          ├─ Temporal Server      gRPC 127.0.0.1:7233
                                          ├─ Pulse Temporal worker (task queue health-checks)
                                          ├─ REST-to-gRPC proxy   127.0.0.1:10000  (official render-examples)
                                          └─ health front door    $PORT (the only public entry)
                                                └─ Postgres: Neon (temporal + temporal_visibility)
```

**Why a proxy?** Render's public edge only speaks HTTP/1.1 + HTTPS, so the
Temporal SDK's gRPC connection from a *different* service cannot be exposed or
reached. The official [`render-examples/temporal-rest-proxy`](https://github.com/render-examples/temporal-rest-proxy)
re-exposes the workflow service as REST (`/api/v1/namespaces/...`) so the backend
can start, inspect and terminate **the same workflows** over HTTPS — the worker
still polls its task queue natively on loopback gRPC. Pulse only uses endpoints
the proxy supports: `start` (with `cronSchedule`, `requestId` and `input`),
`describe`, `workflows/open` (to resolve a runId before terminating) and
`terminate`.

#### Service 1 — `pulse-backend` (existing service)

- Root Directory `/`, Dockerfile `./apps/backend/Dockerfile` (unchanged).
- Environment: the normal app config (Mongo, Redis, JWT, encryption, Groq, …)
  plus:

  | Variable | Value |
  | --- | --- |
  | `PULSE_PROCESSES` | `api,ai-worker,notifications` (the Temporal worker runs in service 2) |
  | `TEMPORAL_TRANSPORT` | `rest` |
  | `TEMPORAL_REST_URL` | `https://<pulse-temporal-demo>.onrender.com` |
  | `TEMPORAL_AUTH_TOKEN` | same secret as `AUTH_TOKEN` in service 2 |

  `TEMPORAL_ADDRESS`/`TEMPORAL_TLS` are **not** used in REST mode.
- Health check path: `/healthz`.

#### Service 2 — `pulse-temporal-demo` (new)

- Root Directory `/`, Dockerfile Path `./infra/temporal-demo/Dockerfile`.
- Health check path `/healthz` (answered by the front door: 200 only when
  Temporal's gRPC port is accepting connections).
- Environment:

  | Variable | Value |
  | --- | --- |
  | `PORT` | `8080` — **must be set explicitly**, see the port note below |
  | `AUTH_TOKEN` | shared secret; backend sends it as a bearer token |
  | `DB` | `postgres12` |
  | `DB_PORT` | `5432` |
  | `DBNAME` / `VISIBILITY_DBNAME` | `temporal` / `temporal_visibility` |
  | `POSTGRES_SEEDS` / `POSTGRES_USER` / `POSTGRES_PWD` | Neon host + credentials |
  | `POSTGRES_TLS_ENABLED` | `true` |
  | `POSTGRES_TLS_DISABLE_HOST_VERIFICATION` | `false` |
  | `POSTGRES_TLS_SERVER_NAME` | Neon host |
  | `SQL_TLS_ENABLED` | `true` (server-side TLS to Neon, used by the rendered config) |
  | `ENABLE_ES` | `false` |
  | `BIND_ON_IP` | `0.0.0.0` |
  | `TEMPORAL_NAMESPACE` | `default` |
  | `TEMPORAL_CLUSTER_HOST` | `127.0.0.1` |
  | `MONGO_URI`, `REDIS_URL`, `JWT_SECRET`, `ENCRYPTION_KEY`, `GROQ_API_KEY`, `AI_*` | same values as the backend — the worker needs them |

  `JWT_SECRET` is easy to miss: `worker.ts` imports `config/index.ts`, which calls
  `requiredEnv` for `MONGO_URI`, `REDIS_URL`, `JWT_SECRET` and `ENCRYPTION_KEY`
  before the worker connects to anything, so a missing value kills the worker at
  boot — and takes the container down with it.

  **Ports: `PORT` must be set to 8080.** The official proxy hardcodes its
  listener on `:10000` and offers no flag or environment variable to change it
  (`rest-proxy/main.go` calls `http.ListenAndServe(":10000", nil)`). The health
  front door binds `0.0.0.0:$PORT`, and `0.0.0.0:10000` collides with the proxy's
  `127.0.0.1:10000`. Render injects `PORT` itself and defaults it to `10000`, so
  set `PORT=8080` in the service's environment or the deploy fails.
  `entrypoint.sh` checks this before starting anything and exits with an
  explicit message instead of dying later on a bare `EADDRINUSE`.

  The supplied PostgreSQL host **must** be reachable from Render. The temporal
  service is built from the official `temporalio/auto-setup` image, and the
  supplied host must therefore be a publicly resolvable host (a Render private
  hostname will not resolve outside the Render network). If Neon is reached
  through a proxy/socket, set `POSTGRES_SEEDS` to that host instead.
- Deploy order: create service 2 first, wait for `https://<service>/healthz` to
  return `{"status":"ok"}`, then add `TEMPORAL_REST_URL` to service 1 and deploy
  it.
- The startup script exits non-zero (failing the deploy loudly) if the database
  setup fails, if the cluster/namespace is not healthy within
  `TEMPORAL_START_TIMEOUT_SECONDS`, or if the worker or proxy cannot start. If any
  child dies later the container exits so Render restarts it.
- The proxy is built from the upstream repository at `REST_PROXY_REF` (default
  `main`); set it to a commit SHA in Render for a fully pinned build.

#### Free tier limits (demo only)

512 MB RAM per service, spin-down after ~15 min without inbound traffic, and
750 instance hours/month per workspace. Two always-on free services ≈ 720
hours/month. Keep monitors low-frequency; if the temporal service is OOM-killed,
lower monitor concurrency rather than upgrading.

#### Troubleshooting

| Symptom | Cause |
| --- | --- |
| `401` from the proxy | `AUTH_TOKEN` (service 2) ≠ `TEMPORAL_AUTH_TOKEN` (service 1) |
| `/healthz` → `degraded` | Temporal gRPC not up yet; check the deploy logs for the startup step that failed |
| `502` from the backend | front door up but proxy not listening — `REST_PROXY_PORT` mismatch |
| `PORT (10000) must not equal REST_PROXY_PORT` | Render defaulted `PORT` to 10000, which the proxy already owns — set `PORT=8080` |
| `Missing required environment variable: JWT_SECRET` | `JWT_SECRET` is not set on the temporal service; the worker imports config at boot |
| workflow start `500` | namespace not registered or database setup failed at boot |

Local development is unchanged: `TEMPORAL_TRANSPORT` defaults to `grpc`, and
`docker compose up` still runs the Temporal worker inside the backend container.

### Oracle Cloud Always Free (permanent free host)

The only mainstream *always-on* "free forever" host big enough for Temporal.
2 ARM OCPUs / 12 GB RAM, 200 GB storage, never expires (halved from 4/24 in
June 2026). A credit/debit card is required for *identity verification only*
(a ~$1 temporary hold, refunded) — nothing is charged on the Always Free tier.

1. Sign up at <https://signup.oraclecloud.com> → **Create account** (choose home
   region carefully; ARM capacity is tight in some regions — retry if allocation
   errors).
2. Console → **Compute → Instances → Create instance**: Name `pulse`, *Image =
   Ubuntu 22.04*, *Shape = Ampere (ARM) 2 OCPU/12 GB*, enable the default VCN.
   Save the SSH key pair — you'll need the private key to log in.
3. **Security list** (VCN → Security Lists → Default): add an *Ingress* rule for
   `TCP 80` (HTTP) and `TCP 22` (SSH), source `0.0.0.0/0`. Add `443` only if you
   later add a domain + TLS.
4. From your local machine:
   ```bash
   ssh -i ~/.ssh/pulse-key ubuntu@<VM_PUBLIC_IP>
   git clone https://github.com/Makrand10/pulse.git
   cd pulse
   sudo bash scripts/deploy/deploy.sh      # installs Docker, generates .env, deploys
   ```
5. Open `http://<VM_PUBLIC_IP>` — sign up an admin, add monitors, go.

Notes:
- The overlay `docker-compose.prod.yml` persists Temporal's Postgres (workflow
  history survives reboots). `deploy.sh` writes a production `.env`
  (`PULSE_FRONTEND_PORT=80`, `BACKEND_HOST_IP=127.0.0.1`) so the app is served
  at `http://<ip>` with no port and the backend API is bound to localhost only —
  the browser always goes through the frontend, which proxies `/api/*`.
- First build takes a few minutes (compiles backend + Next.js standalone inside
  the VM). Later deploys are incremental.
- For HTTPS with a real domain: point a domain at the VM, then either front it
  with a Caddy/Nginx container or use the `cloudflared` tunnel — add a
  `caddy` service with `domain:xxx` and set `APP_BASE_URL=https://xxx`. Without
  a domain, stay on plain HTTP (no TLS).
- Uptime: Oracle reclaims *idle* Always Free instances only if they sit unused
  for weeks; activity like health checks keeps it alive. Add a cron
  `curl http://127.0.0.1:4000/healthz` every minute if you ever pause traffic.

## Roadmap

See [PRD](API-Reliability-Platform-PRD-v2.pdf) — exec plan in §9 (M0–M9).

| Milestone | Branch prefix | Status |
|-----------|---------------|--------|
| M0 Repo bootstrap | `chore/repo-scaffold` | ✅ |
| M1 Auth & Teams | `feat/auth-teams` | ✅ |
| M2 API registration | `feat/api-registration` | ✅ |
| M3 Temporal health checks | `feat/temporal-health-checks` | ✅ |
| M4 Incident engine | `feat/incident-engine` | ✅ |
| M5 Notifications | `feat/notifications` | ✅ |
| M6 AI root-cause | `feat/ai-incident-analysis` | ✅ |
| M7 Dashboard | `feat/dashboard` | ✅ |
| M8 Public status page | `feat/public-status-and-alerts` | ✅ |
| M9 Deployment & docs | `chore/deployment-and-docs` | ✅ |