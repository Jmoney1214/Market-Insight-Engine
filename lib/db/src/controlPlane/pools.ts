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
  const options = [
    `-c mie.credential_pepper_v1=${credentialPepper}`,
    `-c mie.session_pepper_v1=${sessionPepper}`,
  ].join(" ");
  return {
    api: new Pool({
      connectionString: requireEnv(env, "MIE_API_DATABASE_URL"),
      options,
    }),
    worker: new Pool({
      connectionString: requireEnv(env, "MIE_WORKER_DATABASE_URL"),
      options,
    }),
    evaluator: new Pool({
      connectionString: requireEnv(env, "MIE_EVAL_DATABASE_URL"),
      options,
    }),
    reviewer: new Pool({
      connectionString: requireEnv(env, "MIE_REVIEWER_DATABASE_URL"),
      options,
    }),
  };
}

export async function closeControlPlanePools(
  pools: ControlPlanePools,
): Promise<void> {
  await Promise.all(Object.values(pools).map((pool) => pool.end()));
}
