import "dotenv/config";
import { randomUUID } from "node:crypto";
import { createFailoverPool, createPool, regionalEndpoint } from "@/db/client";
import { PgStore } from "@/db/pg-store";
import { spend } from "@/core/ledger";
import { GENESIS_HASH } from "@/core/hash";
import { dsql } from "@/config";

const BLOCKS = {
  blackhole: { host: "192.0.2.1", what: "TCP to an unroutable address (packets dropped)" },
  dns: { host: "primary-blocked.invalid", what: "endpoint name that does not resolve" },
} as const;

type Block = keyof typeof BLOCKS;

async function timed<T>(fn: () => Promise<T>): Promise<{ ms: number; value: T }> {
  const start = performance.now();
  const value = await fn();
  return { ms: Math.round(performance.now() - start), value };
}

async function main() {
  if (!dsql.peerEndpoint) throw new Error("DSQL_ENDPOINT_PEER is required for the drill");
  const block = (process.argv[2] ?? "blackhole") as Block;
  if (!(block in BLOCKS)) throw new Error(`block must be one of ${Object.keys(BLOCKS).join(", ")}`);

  const admin = createPool({ endpoint: dsql.endpoint, region: dsql.region, max: 1 });
  const runId = randomUUID().slice(0, 8);
  const budgetId = randomUUID();
  const vendorId = randomUUID();
  await admin.query(
    `INSERT INTO accounts (id, type, parent_id, name, balance_micro, cap_micro, last_entry_hash)
     VALUES ($1,'agent',NULL,$2,10000000,10000000,$3)`,
    [budgetId, `drill-budget-${runId}`, GENESIS_HASH],
  );
  await admin.query(
    `INSERT INTO accounts (id, type, parent_id, name, balance_micro, last_entry_hash)
     VALUES ($1,'vendor',NULL,$2,0,$3)`,
    [vendorId, `drill-vendor-${runId}`, GENESIS_HASH],
  );

  const spendOnce = (store: PgStore, n: number) =>
    spend(store, {
      budgetAccountId: budgetId,
      vendorAccountId: vendorId,
      amountMicro: 10_000n,
      idempotencyKey: `drill:${runId}:${n}`,
      agentId: "failover-drill",
      intent: "failover-drill",
    });

  const healthy = createFailoverPool(regionalEndpoint("primary"), regionalEndpoint("peer"));
  const blocked = () =>
    createPool({ endpoint: dsql.endpoint, host: BLOCKS[block].host, region: dsql.region });
  const pinned = blocked();
  const blockedPrimary = { name: "primary" as const, region: dsql.region, pool: blocked() };
  const outage = createFailoverPool(blockedPrimary, regionalEndpoint("peer"));

  try {
    const baseline = await timed(() => spendOnce(new PgStore(healthy), 1));
    const pinnedStart = performance.now();
    const pinnedError = await spendOnce(new PgStore(pinned), 9).then(
      () => null,
      (err: Error) => err.message.split("\n")[0],
    );
    const pinnedMs = Math.round(performance.now() - pinnedStart);
    const first = await timed(() => spendOnce(new PgStore(outage), 2));
    const regionAfterFirst = outage.active.region;
    const second = await timed(() => spendOnce(new PgStore(outage), 3));
    const balance = await admin.query<{ balance_micro: string }>(
      `SELECT balance_micro FROM accounts WHERE id = $1`,
      [budgetId],
    );
    console.log(
      JSON.stringify({
        at: new Date().toISOString(),
        block,
        simulated: BLOCKS[block].what,
        connectTimeoutMs: dsql.connectionTimeoutMs,
        baseline: { region: healthy.active.region, ms: baseline.ms, status: baseline.value.status },
        pinnedToPrimary: { ms: pinnedMs, error: pinnedError },
        firstSpendDuringOutage: {
          region: regionAfterFirst,
          ms: first.ms,
          seconds: Number((first.ms / 1000).toFixed(2)),
          status: first.value.status,
        },
        nextSpendDuringOutage: {
          region: outage.active.region,
          ms: second.ms,
          status: second.value.status,
        },
        budgetBalanceMicro: balance.rows[0].balance_micro,
      }),
    );
  } finally {
    await admin.query(`DELETE FROM entries WHERE account_id IN ($1,$2)`, [budgetId, vendorId]);
    await admin.query(`DELETE FROM idempotency_keys WHERE key LIKE $1`, [`drill:${runId}:%`]);
    await admin.query(`DELETE FROM accounts WHERE id IN ($1,$2)`, [budgetId, vendorId]);
    await Promise.allSettled([healthy.end(), outage.end(), pinned.end(), admin.end()]);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
