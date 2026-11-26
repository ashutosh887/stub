import { DsqlSigner } from "@aws-sdk/dsql-signer";
import { awsCredentialsProvider } from "@vercel/oidc-aws-credentials-provider";
import { Pool, type PoolClient } from "pg";
import { aws, db, dsql } from "@/config";
import { type Connectable, type Endpoint, FailoverPool } from "./failover";

export type { Connectable } from "./failover";

export interface DsqlConfig {
  endpoint: string;
  host?: string;
  region: string;
  database?: string;
  user?: string;
  max?: number;
}

export function createPool(config: DsqlConfig): Pool {
  const { endpoint, region } = config;
  const database = config.database ?? dsql.database;
  const user = config.user ?? dsql.user;

  const signer = new DsqlSigner({
    hostname: endpoint,
    region,
    ...(aws.roleArn && {
      credentials: awsCredentialsProvider({ roleArn: aws.roleArn, clientConfig: { region } }),
    }),
  });

  const created = new Pool({
    host: config.host ?? endpoint,
    port: dsql.port,
    database,
    user,
    ssl: { rejectUnauthorized: true },
    password: async () =>
      user === dsql.adminUser
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

export function createPostgresPool(url: string, max?: number): Pool {
  const isLocal = /@(localhost|127\.0\.0\.1|host\.docker\.internal)[:/]/.test(url);

  const created = new Pool({
    connectionString: url,
    ssl: isLocal ? undefined : { rejectUnauthorized: true },
    max: max ?? db.poolMax,
    idleTimeoutMillis: db.idleTimeoutMs,
    connectionTimeoutMillis: db.connectionTimeoutMs,
  });

  created.on("error", (err) => {
    console.error("[postgres] idle pool client error:", err.message);
  });

  return created;
}

export function createDriverPool(max?: number, user: string = dsql.user): Pool {
  const url = db.url;
  if (url) return createPostgresPool(url, max);
  return createPool({
    endpoint: dsql.endpoint,
    region: dsql.region,
    database: dsql.database,
    user,
    max,
  });
}

export function createAdminPool(): Pool {
  return createDriverPool(1, dsql.adminUser);
}

export function regionalEndpoint(name: Endpoint["name"], max?: number, user = dsql.user): Endpoint {
  const endpoint = name === "peer" ? dsql.peerEndpoint : dsql.endpoint;
  const region = name === "peer" ? dsql.peerRegion : dsql.region;
  if (!endpoint) throw new Error("DSQL_ENDPOINT_PEER is not set");
  return { name, region, pool: createPool({ endpoint, region, user, max }) };
}

export function createFailoverPool(primary: Endpoint, peer: Endpoint): FailoverPool {
  return new FailoverPool(primary, peer, {
    failbackAfterMs: dsql.failbackAfterMs,
    probeTimeoutMs: dsql.probeTimeoutMs,
    onSwitch: ({ from, to, reason }) =>
      console.warn(
        JSON.stringify({
          level: "warn",
          msg: "dsql_endpoint_switch",
          from: `${from.name}:${from.region}`,
          to: `${to.name}:${to.region}`,
          reason,
        }),
      ),
  });
}

let pool: Connectable | undefined;

export function getPool(): Connectable {
  if (pool) return pool;
  const failover = !db.url && dsql.failover && dsql.peerEndpoint;
  pool = failover
    ? createFailoverPool(regionalEndpoint("primary"), regionalEndpoint("peer"))
    : createDriverPool();
  return pool;
}

export function activeRegion(): string | null {
  if (db.url) return null;
  return pool instanceof FailoverPool ? pool.active.region : dsql.region;
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
  if (pool instanceof FailoverPool || pool instanceof Pool) await pool.end();
}
