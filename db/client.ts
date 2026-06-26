import { DsqlSigner } from "@aws-sdk/dsql-signer";
import { Pool, type PoolClient } from "pg";
import "dotenv/config";

export interface DsqlConfig {
  endpoint: string;
  region: string;
  database?: string;
  user?: string;
  max?: number;
}

export function createPool(config: DsqlConfig): Pool {
  const { endpoint, region } = config;
  const database = config.database ?? "postgres";
  const user = config.user ?? "admin";

  const signer = new DsqlSigner({ hostname: endpoint, region });

  const created = new Pool({
    host: endpoint,
    port: 5432,
    database,
    user,
    ssl: { rejectUnauthorized: true },
    password: async () =>
      user === "admin"
        ? signer.getDbConnectAdminAuthToken()
        : signer.getDbConnectAuthToken(),
    max: config.max ?? Number(process.env.DSQL_POOL_MAX ?? 5),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    maxLifetimeSeconds: 600,
  });

  created.on("error", (err) => {
    console.error(`[dsql:${region}] idle pool client error:`, err.message);
  });

  return created;
}

let pool: Pool | undefined;

export function getPool(): Pool {
  if (pool) return pool;
  pool = createPool({
    endpoint: required("DSQL_ENDPOINT"),
    region: process.env.DSQL_REGION ?? "us-east-1",
    database: process.env.DSQL_DATABASE,
    user: process.env.DSQL_USER,
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
