---
name: FinDesk architecture & serving
description: How FinDesk's frontend and API are served, and the workflow gotcha
---

# FinDesk Architecture

Two artifacts, standard Replit path-routing:
- `artifacts/findesk` (kind=web): serves the React frontend at `/`. Dev workflow runs `node serve-static.cjs` (a zero-dependency Node static server reading from `dist/public`), localPort 3000.
- `artifacts/api-server` (kind=api): serves the API at `/api` only, localPort 8080. Express + Drizzle + Postgres, mock data generator.

The frontend calls `/api/*` through the shared proxy.

## The workflow gotcha (resolved)

During INITIAL artifact creation, the `findesk: web` workflow failed port detection because the first-run Nix environment rebuild exceeded the workflow port-check window. This led to a temporary hack where api-server served the static frontend too. **That hack is removed.** Once the Nix env is built, `node serve-static.cjs` binds its port fast and the findesk workflow runs normally.

**Both workflows must be running** for the app to work end-to-end. If the preview shows "Your app is not running", restart both `artifacts/findesk: web` and `artifacts/api-server: API Server`. The preview is bound to findesk (previewPath `/`).

## Dev rebuild flow

`serve-static.cjs` serves pre-built files, so frontend code changes require a rebuild:
`pnpm --filter @workspace/findesk run build`, then restart the findesk workflow.

## Stale lib declarations gotcha

If api-server typecheck reports `@workspace/db has no exported member 'reportsTable'/'watchlistTable'` but the server runs fine at runtime, the lib declarations are stale. Run `pnpm run typecheck:libs` (rebuilds composite lib `.d.ts`) before the leaf typecheck.
