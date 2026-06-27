import { DsqlSigner } from "@aws-sdk/dsql-signer";
import { Pool, type PoolClient } from "pg";
import { dsql } from "@/config";

export interface DsqlConfig {
  endpoint: string;
  region: string;
  database?: string;
  user?: string;
  max?: number;
}

export function createPool(config: DsqlConfig): Pool {
  const { endpoint, region } = config;
  const database = config.database ?? dsql.database;
  const user = config.user ?? dsql.user;

  const signer = new DsqlSigner({ hostname: endpoint, region });

  const created = new Pool({
    host: endpoint,
    port: dsql.port,
    database,
    user,
    ssl: { rejectUnauthorized: true },
    password: async () =>
      user === "admin"
        ? signer.getDbConnectAdminAuthToken()
        : signer.getDbConnectAuthToken(),
    max: config.max ?? dsql.poolMax,
    idleTimeoutMillis: dsql.idleTimeoutMs,
    connectionTimeoutMillis: dsql.connectionTimeoutMs,
    maxLifetimeSeconds: dsql.maxLifetimeSeconds,
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
    endpoint: dsql.endpoint,
    region: dsql.region,
    database: dsql.database,
    user: dsql.user,
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
