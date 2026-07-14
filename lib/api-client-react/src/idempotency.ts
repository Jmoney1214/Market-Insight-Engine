export function newIdempotencyKey(): string {
  const key = globalThis.crypto?.randomUUID?.();
  if (!key) {
    throw new Error("Secure random UUID generation is required for idempotency");
  }
  return key;
}

export type IdempotentExecution = Readonly<{
  run<T>(work: (idempotencyKey: string) => Promise<T>): Promise<T>;
  /** Rotate before a deliberate refetch after a terminal failure. */
  rotate(): void;
}>;

/**
 * Keeps one key while an execution is failing/retrying and rotates only after
 * success or an explicit deliberate-refetch signal.
 */
export function createIdempotentExecution(): IdempotentExecution {
  let activeKey: string | null = null;
  return {
    async run<T>(work: (idempotencyKey: string) => Promise<T>): Promise<T> {
      activeKey ??= newIdempotencyKey();
      const result = await work(activeKey);
      activeKey = null;
      return result;
    },
    rotate() {
      activeKey = null;
    },
  };
}
