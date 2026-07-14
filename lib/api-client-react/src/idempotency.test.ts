import { describe, expect, it, vi } from "vitest";
import {
  createIdempotentExecution,
  newIdempotencyKey,
} from "./idempotency";

describe("client idempotency execution", () => {
  it("creates UUID idempotency keys", () => {
    expect(newIdempotencyKey()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("reuses one key across a failed retry and rotates after success", async () => {
    const execution = createIdempotentExecution();
    const observed: string[] = [];
    const failure = vi.fn(async (key: string) => {
      observed.push(key);
      throw new Error("network failure");
    });
    const success = vi.fn(async (key: string) => {
      observed.push(key);
      return "ok";
    });

    await expect(execution.run(failure)).rejects.toThrow("network failure");
    await expect(execution.run(success)).resolves.toBe("ok");
    await expect(execution.run(success)).resolves.toBe("ok");

    expect(observed[0]).toBe(observed[1]);
    expect(observed[2]).not.toBe(observed[1]);
  });
});
