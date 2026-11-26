import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { resetRateLimits } from "@/lib/rate-limit";

const ACCOUNT = "3bfd0c1a-0000-4000-8000-000000000001";
const TOKEN = "correct-horse-battery-staple";

vi.mock("@/lib/data", async () => {
  const { MemStore } = await import("@/core/mem-store");
  const empty = async () => [];
  return {
    store: new MemStore(),
    listAccounts: empty,
    listEntries: empty,
    listDenials: empty,
    listJournalLines: empty,
    listPolicies: empty,
    listAgents: empty,
    listSpendEvents: empty,
    runLedgerQuery: empty,
    setFrozen: async () => {},
    setAllFrozen: async () => {},
    setPolicyEnabled: async () => {},
    deletePolicy: async () => {},
    createPolicy: async () => ACCOUNT,
    createAgent: async (name: string, accountId: string) => ({
      id: ACCOUNT,
      name,
      accountId,
      apiKey: "stub_sk_test",
    }),
    resolveApiKey: async () => null,
    auditReport: async () => ({
      ok: true,
      entryCount: 0,
      accountCount: 0,
      problems: [],
      chains: [],
    }),
    tamperDemo: async () => ({ detected: true }),
    ledgerFingerprint: async () => "0:0",
    queryCacheKey: (question: string) => question,
    getCachedQuery: async () => null,
    putCachedQuery: async () => {},
  };
});

vi.mock("@/lib/ai", () => ({ openaiEnabled: false, answerSpendQuestion: vi.fn() }));

vi.mock("@/db/client", () => ({
  query: async () => ({ rows: [] }),
  createDriverPool: () => ({ end: async () => {} }),
  activeRegion: () => null,
  getPool: () => {
    throw new Error("no pool in tests");
  },
}));

vi.mock("@/db/pg-store", async () => {
  const { MemStore } = await import("@/core/mem-store");
  return { PgStore: MemStore };
});

vi.mock("@/core/sharded", async (original) => ({
  ...(await original<typeof import("@/core/sharded")>()),
  shardExistingAccount: async (_store: unknown, accountId: string) => ({
    accountId,
    shards: 4,
    totalMicro: 0n,
  }),
}));

vi.mock("@/lib/drills", async (original) => ({
  ...(await original<typeof import("@/lib/drills")>()),
  runDrill: async () => ({
    calls: 2,
    held: 1,
    denied: 1,
    failed: 0,
    conflicts: 0,
    heldMicro: 250_000n,
    lowMicro: 750_000n,
    restoredMicro: 1_000_000n,
    capMicro: 1_000_000n,
  }),
}));

type Handler = (request: Request) => Promise<Response>;

interface AdminCase {
  route: string;
  method: "GET" | "POST" | "PATCH" | "DELETE";
  load: () => Promise<Record<string, unknown>>;
  body?: unknown;
  query?: string;
}

const ADMIN_ROUTES: AdminCase[] = [
  { route: "/api/accounts", method: "GET", load: () => import("@/app/api/accounts/route") },
  {
    route: "/api/accounts/shard",
    method: "POST",
    load: () => import("@/app/api/accounts/shard/route"),
    body: { accountId: ACCOUNT },
  },
  { route: "/api/agents", method: "GET", load: () => import("@/app/api/agents/route") },
  {
    route: "/api/agents",
    method: "POST",
    load: () => import("@/app/api/agents/route"),
    body: { name: "agent", accountId: ACCOUNT },
  },
  {
    route: "/api/audit/tamper-demo",
    method: "POST",
    load: () => import("@/app/api/audit/tamper-demo/route"),
  },
  { route: "/api/audit/verify", method: "GET", load: () => import("@/app/api/audit/verify/route") },
  { route: "/api/export", method: "GET", load: () => import("@/app/api/export/route") },
  {
    route: "/api/export/journal",
    method: "GET",
    load: () => import("@/app/api/export/journal/route"),
  },
  {
    route: "/api/freeze",
    method: "POST",
    load: () => import("@/app/api/freeze/route"),
    body: { all: true, frozen: false },
  },
  { route: "/api/harness", method: "POST", load: () => import("@/app/api/harness/route") },
  {
    route: "/api/incident",
    method: "POST",
    load: () => import("@/app/api/incident/route"),
    body: {},
  },
  { route: "/api/ledger", method: "GET", load: () => import("@/app/api/ledger/route") },
  { route: "/api/policies", method: "GET", load: () => import("@/app/api/policies/route") },
  {
    route: "/api/policies",
    method: "POST",
    load: () => import("@/app/api/policies/route"),
    body: { accountId: ACCOUNT, label: "cap", limitUsd: "5" },
  },
  {
    route: "/api/policies",
    method: "PATCH",
    load: () => import("@/app/api/policies/route"),
    body: { id: ACCOUNT, enabled: true },
  },
  {
    route: "/api/policies",
    method: "DELETE",
    load: () => import("@/app/api/policies/route"),
    query: `?id=${ACCOUNT}`,
  },
  {
    route: "/api/policies/simulate",
    method: "POST",
    load: () => import("@/app/api/policies/simulate/route"),
    body: { accountId: ACCOUNT, limitUsd: "5" },
  },
  {
    route: "/api/query",
    method: "POST",
    load: () => import("@/app/api/query/route"),
    body: { question: "total spend this week" },
  },
  {
    route: "/api/stress",
    method: "POST",
    load: () => import("@/app/api/stress/route"),
    body: { count: 2 },
  },
  { route: "/api/sweep", method: "POST", load: () => import("@/app/api/sweep/route") },
];

const AGENT_ROUTES: AdminCase[] = [
  { route: "/api/spend", method: "POST", load: () => import("@/app/api/spend/route"), body: {} },
  {
    route: "/api/reserve",
    method: "POST",
    load: () => import("@/app/api/reserve/route"),
    body: {},
  },
  { route: "/api/settle", method: "POST", load: () => import("@/app/api/settle/route"), body: {} },
  {
    route: "/api/release",
    method: "POST",
    load: () => import("@/app/api/release/route"),
    body: {},
  },
];

function call(c: AdminCase, headers: Record<string, string>): Promise<Response> {
  return c.load().then((mod) => {
    const handler = mod[c.method] as Handler;
    const init: RequestInit = { method: c.method, headers: { ...headers } };
    if (c.body !== undefined) {
      init.body = JSON.stringify(c.body);
      (init.headers as Record<string, string>)["content-type"] = "application/json";
    }
    return handler(new Request(`http://stub.test${c.route}${c.query ?? ""}`, init));
  });
}

const saved: Record<string, string | undefined> = {};

beforeAll(() => {
  for (const key of ["VERCEL_ENV", "ADMIN_TOKEN", "DATABASE_URL"]) saved[key] = process.env[key];
  process.env.VERCEL_ENV = "production";
  process.env.DATABASE_URL = "postgres://route-tests.invalid/stub";
});

afterEach(() => {
  resetRateLimits();
  delete process.env.ADMIN_TOKEN;
});

afterAll(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

const label = (c: AdminCase) => `${c.method} ${c.route}`;

describe("WA SEC03-BP01: every admin and export route is closed in production", () => {
  it.each(ADMIN_ROUTES.map((c) => [label(c), c] as const))(
    "%s: 401 without a token configured, whatever the caller sends",
    async (_name, c) => {
      expect((await call(c, {})).status).toBe(401);
      expect((await call(c, { authorization: `Bearer ${TOKEN}` })).status).toBe(401);
    },
  );

  it.each(ADMIN_ROUTES.map((c) => [label(c), c] as const))(
    "%s: 401 with no token or a wrong one, 200 with the right one",
    async (_name, c) => {
      process.env.ADMIN_TOKEN = TOKEN;
      expect((await call(c, {})).status).toBe(401);
      expect((await call(c, { authorization: "Bearer wrong" })).status).toBe(401);
      expect((await call(c, { authorization: `Bearer ${TOKEN}x` })).status).toBe(401);
      expect((await call(c, { cookie: "stub_admin=wrong" })).status).toBe(401);
      expect((await call(c, { authorization: `Bearer ${TOKEN}` })).status).toBe(200);
      expect((await call(c, { cookie: `stub_admin=${TOKEN}` })).status).toBe(200);
    },
  );

  it.each(AGENT_ROUTES.map((c) => [label(c), c] as const))(
    "%s: 401 with no credential or an unknown key, past the gate with the admin cookie",
    async (_name, c) => {
      process.env.ADMIN_TOKEN = TOKEN;
      expect((await call(c, {})).status).toBe(401);
      expect((await call(c, { authorization: "Bearer stub_sk_unknown" })).status).toBe(401);
      expect((await call(c, { cookie: `stub_admin=${TOKEN}` })).status).not.toBe(401);
    },
  );
});

describe("the admin token compare", () => {
  it("matches only the exact token, at any length, without throwing", async () => {
    const { tokenMatches } = await import("@/lib/api");
    process.env.ADMIN_TOKEN = TOKEN;
    expect(tokenMatches(TOKEN)).toBe(true);
    expect(tokenMatches(`${TOKEN} `)).toBe(false);
    expect(tokenMatches("")).toBe(false);
    expect(tokenMatches("x".repeat(4096))).toBe(false);
    expect(tokenMatches(null)).toBe(false);
    delete process.env.ADMIN_TOKEN;
    expect(tokenMatches(TOKEN)).toBe(false);
  });

  it("the login route refuses to issue a session in production with no token configured", async () => {
    const { POST } = await import("@/app/api/auth/route");
    const res = await POST(
      new Request("http://stub.test/api/auth", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: "anything" }),
      }),
    );
    expect(res.status).toBe(401);
  });
});
