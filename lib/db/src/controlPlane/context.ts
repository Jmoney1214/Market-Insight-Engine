import type pg from "pg";
import type {
  ControlPlaneCapability,
  ControlPlanePools,
} from "./pools.js";

export type VerifiedControlPlaneContext = Readonly<{
  requestId: string;
  principalId?: string;
  credentialId?: string;
  runId?: string;
  caseRevisionId?: string;
}>;

async function setLocalContext(
  client: pg.PoolClient,
  context: VerifiedControlPlaneContext,
): Promise<void> {
  await client.query(
    `select
       set_config('mie.request_id', $1, true),
       set_config('mie.principal_id', $2, true),
       set_config('mie.credential_id', $3, true),
       set_config('mie.run_id', $4, true),
       set_config('mie.case_revision_id', $5, true)`,
    [
      context.requestId,
      context.principalId ?? "",
      context.credentialId ?? "",
      context.runId ?? "",
      context.caseRevisionId ?? "",
    ],
  );
}

async function setLocalSecrets(
  client: pg.PoolClient,
  pools: ControlPlanePools,
): Promise<void> {
  await client.query(
    `select
       set_config('mie.credential_pepper_v1', $1, true),
       set_config('mie.session_pepper_v1', $2, true)`,
    [pools.secrets.credentialPepper, pools.secrets.sessionPepper],
  );
}

export async function withControlPlaneSecretsTransaction<T>(
  pools: ControlPlanePools,
  capability: ControlPlaneCapability,
  work: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pools[capability].connect();
  try {
    await client.query("begin");
    await setLocalSecrets(client, pools);
    const result = await work(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function withControlPlaneTransaction<T>(
  pools: ControlPlanePools,
  capability: ControlPlaneCapability,
  context: VerifiedControlPlaneContext,
  work: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  if (!context.requestId.trim()) {
    throw new Error("A non-empty verified request ID is required");
  }

  return withControlPlaneSecretsTransaction(pools, capability, async (client) => {
    await setLocalContext(client, context);
    return work(client);
  });
}
