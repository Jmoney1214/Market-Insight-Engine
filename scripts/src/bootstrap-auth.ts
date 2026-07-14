import { randomBytes, randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import pg from "pg";

const { Pool } = pg;

export const BOOTSTRAP_HUMAN_SCOPES = [
  "committee:run",
  "desk:read",
  "evaluation:grade",
  "evaluation:read",
  "evaluation:run",
  "event:generate",
  "governance:credentials",
  "journal:write",
  "learning:decide",
  "publication:decide",
  "replay:read",
  "report:write",
  "research:read",
  "research:run",
  "scan:refresh",
  "watchlist:write",
] as const;

export type BootstrapRecord = Readonly<{
  principalId: string;
  credentialId: string;
}>;

export type BootstrapHumanInput = Readonly<{
  subject: string;
  displayName: string;
  scopes: readonly string[];
  rawSecret: string;
  pepperVersion: "v1";
  requestId: string;
}>;

export type BootstrapAuthDependencies = Readonly<{
  hasActiveHuman(): Promise<boolean>;
  bootstrapHuman(input: BootstrapHumanInput): Promise<BootstrapRecord>;
  newPermanentCredential(): string;
  newRequestId(): string;
  writeLine(line: string): void;
}>;

export type BootstrapAuthResult = BootstrapRecord &
  Readonly<{
    subject: string;
    requestId: string;
  }>;

export function parseBootstrapArgs(argv: readonly string[]): { subject: string } {
  let subject: string | null = null;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument !== "--subject") {
      throw new Error(`Unknown bootstrap argument: ${argument ?? ""}`);
    }
    const value = argv[index + 1]?.trim();
    if (!value || subject !== null) {
      throw new Error("Bootstrap requires exactly one non-empty --subject value");
    }
    subject = value;
    index += 1;
  }
  if (!subject) {
    throw new Error("Usage: pnpm --filter @workspace/scripts bootstrap:auth --subject <operator-subject>");
  }
  return { subject };
}

function isBootstrapExistsError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.message.includes("human_bootstrap_exists") ||
      error.message.includes("Human bootstrap already exists"))
  );
}

export async function runBootstrapAuth(
  deps: BootstrapAuthDependencies,
  input: { subject: string },
): Promise<BootstrapAuthResult> {
  const subject = input.subject.trim();
  if (!subject) throw new Error("Bootstrap subject is required");
  if (await deps.hasActiveHuman()) {
    throw new Error("Human bootstrap already exists");
  }

  const rawSecret = deps.newPermanentCredential();
  const requestId = deps.newRequestId();
  let record: BootstrapRecord;
  try {
    record = await deps.bootstrapHuman({
      subject,
      displayName: "Desk Operator",
      scopes: BOOTSTRAP_HUMAN_SCOPES,
      rawSecret,
      pepperVersion: "v1",
      requestId,
    });
  } catch (error) {
    if (isBootstrapExistsError(error)) {
      throw new Error("Human bootstrap already exists", { cause: error });
    }
    throw error;
  }

  deps.writeLine(
    JSON.stringify({
      principalId: record.principalId,
      credentialId: record.credentialId,
      subject,
      requestId,
      permanentCredential: rawSecret,
    }),
  );
  return { ...record, subject, requestId };
}

function requiredEnv(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required for auth bootstrap`);
  return value;
}

function permanentCredential(): string {
  const prefix = `mie_${randomBytes(18).toString("base64url")}`;
  return `${prefix}.${randomBytes(32).toString("base64url")}`;
}

export async function bootstrapHumanWithPool(
  pool: Pick<pg.Pool, "connect">,
  input: BootstrapHumanInput,
  credentialPepper: string,
): Promise<BootstrapRecord> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(
      "select set_config($1, $2, true)",
      [`mie.credential_pepper_${input.pepperVersion}`, credentialPepper],
    );
    const result = await client.query<{ payload: Record<string, unknown> }>(
      `select governance.bootstrap_human_principal(
         $1, $2, $3::text[], $4, $5, $6
       ) as payload`,
      [
        input.subject,
        input.displayName,
        [...input.scopes],
        input.rawSecret,
        input.pepperVersion,
        input.requestId,
      ],
    );
    const payload = result.rows[0]?.payload;
    const principalId = payload?.["principal_id"];
    const credentialId = payload?.["credential_id"];
    if (typeof principalId !== "string" || typeof credentialId !== "string") {
      throw new Error("Bootstrap function returned an invalid identity payload");
    }
    await client.query("commit");
    return { principalId, credentialId };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export function createPgBootstrapRuntime(env: NodeJS.ProcessEnv) {
  const pepper = requiredEnv(env, "MIE_CREDENTIAL_PEPPER_V1");
  if (!/^[A-Za-z0-9_-]{32,}$/.test(pepper)) {
    throw new Error("MIE_CREDENTIAL_PEPPER_V1 must be at least 32 URL-safe characters");
  }
  const pool = new Pool({
    connectionString: requiredEnv(env, "MIE_MIGRATOR_DATABASE_URL"),
    max: 1,
  });

  const dependencies: BootstrapAuthDependencies = {
    async hasActiveHuman() {
      // The least-privilege migrator can execute the atomic SECURITY DEFINER
      // bootstrap function but intentionally cannot read governance tables.
      // The function owns the advisory lock and authoritative existence check.
      return false;
    },
    async bootstrapHuman(input) {
      return bootstrapHumanWithPool(pool, input, pepper);
    },
    newPermanentCredential: permanentCredential,
    newRequestId: () => `bootstrap-${randomUUID()}`,
    writeLine: (line) => process.stdout.write(`${line}\n`),
  };

  return {
    dependencies,
    close: () => pool.end(),
  } as const;
}

export async function main(
  argv: readonly string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const input = parseBootstrapArgs(argv);
  const runtime = createPgBootstrapRuntime(env);
  try {
    await runBootstrapAuth(runtime.dependencies, input);
  } finally {
    await runtime.close();
  }
}

const entrypoint = process.argv[1]
  ? pathToFileURL(process.argv[1]).href
  : null;
if (entrypoint === import.meta.url) {
  await main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
