import "dotenv/config";
import { createHash } from "node:crypto";
import { createPool } from "@/db/client";
import { verifyChain } from "@/core/audit";
import type { Entry } from "@/core/store";
import { dsql } from "@/config";

const TABLES = [
  "accounts",
  "entries",
  "denials",
  "reservations",
  "idempotency_keys",
  "query_cache",
  "policies",
  "agents",
  "sessions",
  "account_shards",
];

async function main() {
  const endpoint = process.argv[2] ?? dsql.endpoint;
  const region = process.argv[3] ?? dsql.region;
  const pool = createPool({ endpoint, region, user: dsql.adminUser, max: 1 });
  try {
    const counts: Record<string, number> = {};
    for (const table of TABLES) {
      const { rows } = await pool.query<{ n: string }>(`SELECT count(*) AS n FROM ${table}`);
      counts[table] = Number(rows[0].n);
    }
    const { rows } = await pool.query<Record<string, unknown>>(
      `SELECT id, transaction_id, account_id, kind, amount_micro, agent_id, session_id, user_id,
              intent, cost_center, receipt, prev_hash, hash, shard_index
         FROM entries
        ORDER BY account_id, created_at ASC, kind DESC`,
    );
    const entries: Entry[] = rows.map((r) => ({
      id: r.id as string,
      transactionId: r.transaction_id as string,
      accountId: r.account_id as string,
      kind: r.kind as Entry["kind"],
      amountMicro: BigInt(r.amount_micro as string),
      agentId: (r.agent_id as string | null) ?? null,
      sessionId: (r.session_id as string | null) ?? null,
      userId: (r.user_id as string | null) ?? null,
      intent: (r.intent as string | null) ?? null,
      costCenter: (r.cost_center as string | null) ?? null,
      receipt: r.receipt ?? null,
      prevHash: (r.prev_hash as string | null) ?? "",
      hash: r.hash as string,
      shardIndex: (r.shard_index as number | null) ?? undefined,
    }));
    const hashes = entries.map((e) => e.hash).sort();
    const balances = await pool.query<{ total: string; heads: string }>(
      `SELECT coalesce(sum(balance_micro), 0)::text AS total,
              string_agg(id::text || ':' || last_entry_hash, ',' ORDER BY id) AS heads
         FROM accounts`,
    );
    console.log(
      JSON.stringify({
        endpoint: endpoint.split(".")[0].slice(0, 6) + "…",
        region,
        at: new Date().toISOString(),
        counts,
        chainProblems: verifyChain(entries).length,
        entriesDigest: createHash("sha256").update(hashes.join("\n")).digest("hex"),
        balanceTotalMicro: balances.rows[0].total,
        headsDigest: createHash("sha256")
          .update(balances.rows[0].heads ?? "")
          .digest("hex"),
      }),
    );
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
