import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    // scorecard.ts imports @workspace/db, whose module init requires a
    // DATABASE_URL. The pool connects lazily, so a placeholder is enough for
    // unit tests that never touch the database.
    env: {
      DATABASE_URL: "postgres://vitest:vitest@localhost:5432/vitest",
    },
  },
});
