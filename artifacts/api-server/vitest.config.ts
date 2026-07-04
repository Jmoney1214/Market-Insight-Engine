import { defineConfig } from "vitest/config";

// The server is authored with NodeNext semantics (explicit ".js" specifiers on
// relative imports). extensionAlias lets vitest resolve those back to the ".ts"
// sources. NODE_ENV=production + LOG_LEVEL=silent keep the pino logger from
// spawning a pino-pretty worker thread during tests.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    // COPILOT_LLM_PROVIDER=none forces the keyless deterministic committee path
    // so copilot tests run without any live LLM call — fast and reproducible.
    // DATABASE_URL is a placeholder: @workspace/db requires it at import time,
    // but the pool connects lazily so unit tests never touch a real database.
    env: {
      NODE_ENV: "production",
      LOG_LEVEL: "silent",
      COPILOT_LLM_PROVIDER: "none",
      DATABASE_URL: "postgres://vitest:vitest@localhost:5432/vitest",
    },
  },
  resolve: {
    extensionAlias: {
      ".js": [".ts", ".js"],
    },
  },
});
