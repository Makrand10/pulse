# Repository Guidelines

## Project Structure

Pulse is an npm workspaces monorepo. `apps/frontend` contains the Next.js and React UI, with routes and shared UI under `src/app` and `src/components`. `apps/backend` contains the Express API, Temporal workers, and feature modules under `src`; its Vitest suites live in `test/unit`, `test/integration`, and other focused test folders. `packages/shared-types/src` holds Zod schemas and TypeScript types shared by both apps. Deployment files are in `infra` and the repository root; helper scripts are in `scripts`.

## Build, Test, and Development

Use Node.js 20 or newer and npm. Run `npm ci` to install dependencies. Copy `.env.example` to `.env` and configure the required services before running the stack. Useful commands from the repository root:

- `npm run dev` starts each workspace's development command.
- `npm run build` builds the workspaces, including shared types.
- `npm run lint` and `npm run typecheck` run workspace linting and TypeScript checks.
- `npm run test:unit` runs backend unit tests; `npm run test:integration` runs backend integration tests.
- `npm run dev -w @pulse/frontend` or `npm run dev -w @pulse/backend` starts one app.

The backend tests use Vitest. Integration tests may require local infrastructure; see `README.md` and `scripts/start-infra.ps1` for setup.

## Coding Style

Follow the existing TypeScript patterns and keep changes within the relevant workspace. Prettier uses two spaces, single quotes, semicolons, trailing commas, and a 100-character print width. ESLint is shared at the root; unused variables and arguments should be removed or prefixed with `_` when intentionally unused. Use PascalCase for React components and model types, and camelCase for functions, variables, and utilities.

## Tests

Name Vitest files `*.test.ts` and place them in the appropriate `apps/backend/test` area. Add or update tests for behavior changes, especially API routes, incident transitions, and background workers. Run the focused test file during development, then the relevant root test command before submitting.

## Commits and Pull Requests

Recent history uses concise, imperative subjects and often Conventional Commit prefixes such as `fix:` and `feat:`. Keep each commit focused. A pull request should explain the user-visible or operational change, note configuration or migration needs, link related issues, and include screenshots for frontend changes. Record the checks you ran and any infrastructure-dependent tests you could not run.

## Configuration and Security

Keep credentials in local environment files; never commit secrets. Use `.env.example` to document new settings, and validate external input at service boundaries. Be especially careful with endpoint URL validation and authentication changes.
