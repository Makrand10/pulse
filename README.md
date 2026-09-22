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
- For HTTPS, put Caddy/Nginx in front of port 3000 and set `APP_BASE_URL`.
- To split the apps across hosts (e.g., frontend on Vercel, backend on Render),
  rebuild the frontend with `--build-arg NEXT_PUBLIC_API_URL=<public backend base>`.
- `docker compose down` stops everything; Mongo data persists in a named volume.

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
| M9 Deployment & docs | `chore/deployment-and-docs` | 🚧 |