---
name: FinDesk static file serving
description: How the FinDesk frontend is served in the dev environment
---

# FinDesk Static File Serving

The `artifacts/findesk: web` workflow consistently fails to start on Replit because the new-artifact Nix environment rebuild takes longer than the workflow system's port check timeout (~60–120s). The environment rebuilds successfully (confirmed by logs showing the server starts), but the port check window expires before the process binds.

**Solution implemented:** The Express API server (port 8080, `artifacts/api-server`) serves the pre-built React frontend as static files.

## Key files changed

- `artifacts/api-server/src/app.ts`: added `express.static(STATIC_DIR)` and `app.get("/{*path}", ...)` SPA fallback after the `/api` router
- `artifacts/api-server/.replit-artifact/artifact.toml`: `paths = ["/api", "/"]` so the proxy routes root to port 8080
- `artifacts/findesk/.replit-artifact/artifact.toml`: `paths = ["/__findesk__"]` (placeholder, no longer claims "/") 
- `artifacts/findesk/vite.config.ts`: removed `throw` on missing PORT/BASE_PATH, now uses defaults (5173/"/")
- `artifacts/findesk/serve-static.cjs`: lightweight Node.js static server (zero npm deps) for the findesk workflow if it ever needs to serve independently

## Path calculation

STATIC_DIR in app.ts:
```
path.resolve(__dirname, "..", "..", "..", "artifacts", "findesk", "dist", "public")
```
where `__dirname = path.dirname(fileURLToPath(import.meta.url))` = the `dist/` dir of the compiled API server bundle.
Three `..` from `dist/` reach the workspace root; then `artifacts/findesk/dist/public`.

## Rebuild workflow

When frontend code changes: run `pnpm --filter @workspace/findesk run build` from bash, then restart the API server workflow.

**Why:** The artifact.toml `localPort` system requires the dev server to bind its port within the workflow system's timeout. A new artifact's Nix environment takes >60s to rebuild on first run. Pre-built static files served from the already-running API server avoids this entirely.
