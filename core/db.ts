import { DsqlSigner } from "@aws-sdk/dsql-signer";
import { Pool, type PoolClient } from "pg";
import "dotenv/config";

let pool: Pool | undefined;

export function getPool(): Pool {
  if (pool) return pool;

  const endpoint = required("DSQL_ENDPOINT");
  const region = process.env.DSQL_REGION ?? "us-east-1";
  const database = process.env.DSQL_DATABASE ?? "postgres";
  const user = process.env.DSQL_USER ?? "admin";

  const signer = new DsqlSigner({ hostname: endpoint, region });

  pool = new Pool({
    host: endpoint,
    port: 5432,
    database,
    user,
    ssl: { rejectUnauthorized: true },
    password: async () =>
      user === "admin"
        ? signer.getDbConnectAdminAuthToken()
        : signer.getDbConnectAuthToken(),
    max: Number(process.env.DSQL_POOL_MAX ?? 5),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    maxLifetimeSeconds: 600,
  });

  pool.on("error", (err) => {
    console.error("[dsql] idle pool client error:", err.message);
  });

  return pool;
}

export async function query<T = unknown>(text: string, params?: unknown[]) {
  return getPool().query<T extends object ? T : never>(text, params);
}

export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function close() {
  if (pool) await pool.end();
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}
