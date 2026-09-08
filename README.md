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
│   └── shared-types/        # Zod schemas + TS types shared FE/BE
├── docker-compose.yml       # local Mongo + Redis + Temporal dev stack
├── .env.example
├── package.json             # workspaces root
└── README.md
```

## Local setup

### Prerequisites

- Node.js ≥ 20
- npm ≥ 10
- Docker + Docker Compose

### Steps

```bash
npm install
npm run dev          # start local Mongo + Redis + Temporal stack
# copy .env.example to .env and fill in values
```

## Roadmap

See [PRD](API-Reliability-Platform-PRD-v2.pdf) — exec plan in §9 (M0–M9).

| Milestone | Branch prefix | Status |
|-----------|---------------|--------|
| M0 Repo bootstrap | `chore/repo-scaffold` | ✅ |
| M1 Auth & Teams | `feat/auth-teams` | ⏳ |
| M2 API registration | `feat/api-registration` | ⏳ |
| M3 Temporal health checks | `feat/temporal-health-checks` | ⏳ |
| M4 Incident engine | `feat/incident-engine` | ⏳ |
| M5 Notifications | `feat/notifications` | ⏳ |
| M6 AI root-cause | `feat/ai-incident-analysis` | ⏳ |
| M7 Dashboard | `feat/dashboard` | ⏳ |
| M8 Public status page | `feat/public-status-and-alerts` | ⏳ |
| M9 Deployment & docs | `chore/deployment-and-docs` | ⏳ |