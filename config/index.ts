function env(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : undefined;
}

export function requiredEnv(name: string): string {
  const value = env(name);
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

function int(name: string, fallback: number): number {
  const value = env(name);
  if (value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const dsql = {
  get endpoint(): string {
    return requiredEnv("DSQL_ENDPOINT");
  },
  peerEndpoint: env("DSQL_ENDPOINT_PEER"),
  region: env("DSQL_REGION") ?? "us-east-1",
  peerRegion: env("DSQL_REGION_PEER") ?? "us-east-2",
  database: env("DSQL_DATABASE") ?? "postgres",
  user: env("DSQL_USER") ?? "admin",
  port: int("DSQL_PORT", 5432),
  poolMax: int("DSQL_POOL_MAX", 5),
  idleTimeoutMs: int("DSQL_IDLE_TIMEOUT_MS", 30_000),
  connectionTimeoutMs: int("DSQL_CONNECTION_TIMEOUT_MS", 10_000),
  maxLifetimeSeconds: int("DSQL_MAX_LIFETIME_SECONDS", 600),
};

export const openai = {
  apiKey: env("OPENAI_API_KEY"),
  model: env("OPENAI_MODEL") ?? "gpt-4o-mini",
  enabled: Boolean(env("OPENAI_API_KEY")),
};

export const app = {
  baseUrl: env("STUB_BASE_URL") ?? "http://localhost:3000",
  logLevel: env("LOG_LEVEL") ?? "info",
};

export const security = {
  get adminToken(): string | undefined {
    return env("ADMIN_TOKEN");
  },
  get authEnabled(): boolean {
    return Boolean(env("ADMIN_TOKEN"));
  },
};

export const limits = {
  maxSpendMicro: BigInt(int("MAX_SPEND_USD", 1_000_000)) * 1_000_000n,
  maxReceiptBytes: int("MAX_RECEIPT_BYTES", 64_000),
  maxQuestionLength: int("MAX_QUESTION_LENGTH", 500),
  occMaxRetries: int("OCC_MAX_RETRIES", 25),
  rateLimitWindowMs: int("RATE_LIMIT_WINDOW_MS", 60_000),
  rateLimitMax: int("RATE_LIMIT_MAX", 120),
  rateLimitQueryMax: int("RATE_LIMIT_QUERY_MAX", 20),
};

export const demo = {
  spends: int("DEMO_SPENDS", 12),
  priceUsd: env("DEMO_PRICE_USD") ?? "0.40",
};
