/**
 * JSON Schema generation + drift gate.
 *
 * `pnpm codegen` (REGEN=1) regenerates ../schemas/*.schema.json from the Zod
 * source of truth. In CI (REGEN unset) this test FAILS if the committed
 * schemas differ from what the Zod contracts generate — the single-source-of-
 * truth rule from the buildout plan §5.
 */
import { describe, it, expect } from "vitest";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod/v4";
import { CONTRACT_REGISTRY } from "./contracts";

const SCHEMA_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "schemas");
const REGEN = process.env["REGEN"] === "1";

function generated(name: keyof typeof CONTRACT_REGISTRY): unknown {
  return z.toJSONSchema(CONTRACT_REGISTRY[name], { target: "draft-2020-12", io: "output" });
}

describe(REGEN ? "regenerating schemas" : "schema drift gate", () => {
  for (const name of Object.keys(CONTRACT_REGISTRY) as Array<keyof typeof CONTRACT_REGISTRY>) {
    it(`${name}.schema.json ${REGEN ? "written" : "matches Zod source"}`, () => {
      const fresh = generated(name);
      const file = join(SCHEMA_DIR, `${name}.schema.json`);
      if (REGEN) {
        mkdirSync(SCHEMA_DIR, { recursive: true });
        writeFileSync(file, JSON.stringify(fresh, null, 2) + "\n");
        expect(true).toBe(true);
        return;
      }
      const committed = JSON.parse(readFileSync(file, "utf8"));
      expect(committed, `${name}: run "pnpm --filter @workspace/research-contracts run codegen" and commit`).toEqual(fresh);
    });
  }
});
