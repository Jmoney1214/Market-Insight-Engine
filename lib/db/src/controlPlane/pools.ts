import pg from "pg";

const { Pool } = pg;

export type ControlPlaneCapability =
  | "api"
  | "worker"
  | "evaluator"
  | "reviewer";

export type ControlPlanePools = Readonly<{
  api: pg.Pool;
  worker: pg.Pool;
  evaluator: pg.Pool;
  reviewer: pg.Pool;
  secrets: Readonly<{
    credentialPepper: string;
    sessionPepper: string;
  }>;
}>;

function requireEnv(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) {
    throw new Error(`${name} must be set for the private control plane`);
  }
  return value;
}

function requirePepper(env: NodeJS.ProcessEnv, name: string): string {
  const value = requireEnv(env, name);
  if (!/^[A-Za-z0-9_-]{32,}$/.test(value)) {
    throw new Error(`${name} must be at least 32 URL-safe characters`);
  }
  return value;
}

export function createControlPlanePools(
  env: NodeJS.ProcessEnv,
): ControlPlanePools {
  const credentialPepper = requirePepper(env, "MIE_CREDENTIAL_PEPPER_V1");
  const sessionPepper = requirePepper(env, "MIE_SESSION_PEPPER_V1");
  return {
    api: new Pool({
      connectionString: requireEnv(env, "MIE_API_DATABASE_URL"),
    }),
    worker: new Pool({
      connectionString: requireEnv(env, "MIE_WORKER_DATABASE_URL"),
    }),
    evaluator: new Pool({
      connectionString: requireEnv(env, "MIE_EVAL_DATABASE_URL"),
    }),
    reviewer: new Pool({
      connectionString: requireEnv(env, "MIE_REVIEWER_DATABASE_URL"),
    }),
    secrets: { credentialPepper, sessionPepper },
  };
}

export async function closeControlPlanePools(
  pools: ControlPlanePools,
): Promise<void> {
  await Promise.all([
    pools.api.end(),
    pools.worker.end(),
    pools.evaluator.end(),
    pools.reviewer.end(),
  ]);
}
