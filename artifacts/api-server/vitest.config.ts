import { defineConfig } from "vitest/config";

// The server is authored with NodeNext semantics (explicit ".js" specifiers on
// relative imports). extensionAlias lets vitest resolve those back to the ".ts"
// sources. NODE_ENV=production + LOG_LEVEL=silent keep the pino logger from
// spawning a pino-pretty worker thread during tests.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    // Force the keyless deterministic committee path (spec items 13/18/23):
    // selectProviderId() fails closed to null (deterministic) when
    // COPILOT_LLM_PROVIDER names a non-provider, so the committee runs without
    // any live LLM call — fast and reproducible. The AI-integration env vars are
    // left intact (the integration client throws at import if they are empty);
    // the live-provider path is exercised separately by the e2e verification
    // against the running server.
    env: {
      NODE_ENV: "production",
      LOG_LEVEL: "silent",
      COPILOT_LLM_PROVIDER: "none",
    },
  },
  resolve: {
    extensionAlias: {
      ".js": [".ts", ".js"],
    },
  },
});
