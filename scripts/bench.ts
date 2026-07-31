import "dotenv/config";
import { randomUUID } from "node:crypto";
import { createDriverPool, query, close } from "@/db/client";
import { PgStore } from "@/db/pg-store";
import { spend } from "@/core/ledger";
import { provisionShards, shardedSpend } from "@/core/sharded";
import { GENESIS_HASH } from "@/core/hash";
import { db } from "@/config";

const PER_SPEND = 1_000n;
const OPS_PER_WRITER = 10;
const LEVELS = [1, 2, 4, 8, 16, 32];
const SHARDS = 8;

type Mode = "single" | "sharded";

interface LevelResult {
  mode: Mode;
  writers: number;
  ops: number;
  seconds: number;
  opsPerSecond: number;
  conflicts: number;
  conflictsPerOp: number;
  committed: number;
  p50Ms: number;
  p95Ms: number;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[index];
}

async function runLevel(mode: Mode, writers: number): Promise<LevelResult> {
  const pool = createDriverPool(Math.max(writers, 4));
  const store = new PgStore(pool);
  const budgetId = randomUUID();
  const vendorId = randomUUID();
  const ops = writers * OPS_PER_WRITER;
  const funding = BigInt(ops) * PER_SPEND * 10n;

  await query(
    `INSERT INTO accounts (id, type, parent_id, name, balance_micro, cap_micro, last_entry_hash)
     VALUES ($1,'agent',NULL,'bench-budget',$2,$2,$3)`,
    [budgetId, funding.toString(), GENESIS_HASH],
  );
  await query(
    `INSERT INTO accounts (id, type, parent_id, name, balance_micro, last_entry_hash)
     VALUES ($1,'vendor',NULL,'bench-vendor',0,$2)`,
    [vendorId, GENESIS_HASH],
  );

  if (mode === "sharded") {
    await provisionShards(store, budgetId, funding, SHARDS);
    await provisionShards(store, vendorId, 0n, SHARDS);
  }

  const latencies: number[] = [];
  let conflicts = 0;
  let committed = 0;

  const started = performance.now();
  await Promise.all(
    Array.from({ length: writers }, async () => {
      for (let i = 0; i < OPS_PER_WRITER; i++) {
        const request = {
          budgetAccountId: budgetId,
          vendorAccountId: vendorId,
          amountMicro: PER_SPEND,
          intent: "bench",
        };
        const opStart = performance.now();
        const result =
          mode === "sharded"
            ? await shardedSpend(store, request, { shards: SHARDS, maxRetries: 200 })
            : await spend(store, request, { maxRetries: 200 });
        latencies.push(performance.now() - opStart);
        conflicts += result.conflicts;
        if (result.status === "committed") committed += 1;
      }
    }),
  );
  const seconds = (performance.now() - started) / 1000;

  await query(`DELETE FROM entries WHERE account_id IN ($1,$2)`, [budgetId, vendorId]);
  await query(`DELETE FROM denials WHERE account_id = $1`, [budgetId]);
  await query(`DELETE FROM account_shards WHERE account_id IN ($1,$2)`, [budgetId, vendorId]);
  await query(`DELETE FROM accounts WHERE id IN ($1,$2)`, [budgetId, vendorId]);
  await pool.end();

  latencies.sort((a, b) => a - b);

  return {
    mode,
    writers,
    ops,
    seconds,
    opsPerSecond: ops / seconds,
    conflicts,
    conflictsPerOp: conflicts / ops,
    committed,
    p50Ms: percentile(latencies, 50),
    p95Ms: percentile(latencies, 95),
  };
}

function row(result: LevelResult): string {
  return [
    String(result.writers).padStart(7),
    result.opsPerSecond.toFixed(1).padStart(9),
    result.conflictsPerOp.toFixed(2).padStart(14),
    result.p50Ms.toFixed(1).padStart(8),
    result.p95Ms.toFixed(1).padStart(8),
    `${result.committed}/${result.ops}`.padStart(11),
  ].join("");
}

async function sweep(mode: Mode, label: string): Promise<LevelResult[]> {
  console.log(`\n${label}`);
  console.log("writers   ops/sec   conflicts/op   p50 ms   p95 ms   committed");
  console.log("-------   -------   ------------   ------   ------   ---------");

  const results: LevelResult[] = [];
  for (const writers of LEVELS) {
    const result = await runLevel(mode, writers);
    results.push(result);
    console.log(row(result));
  }
  return results;
}

async function main() {
  const target = db.driver === "postgres" ? "local Postgres" : "Aurora DSQL";
  console.log(`\nHot-row contention benchmark against ${target}`);
  console.log(`${OPS_PER_WRITER} spends per writer, all against one budget account.`);

  const single = await sweep("single", "One balance row (today's default)");
  const shardedResults = await sweep("sharded", `${SHARDS} balance shards`);

  console.log("\nwriters   single ops/sec   sharded ops/sec   speedup   conflicts/op");
  console.log("-------   --------------   ---------------   -------   ------------");
  for (let i = 0; i < LEVELS.length; i++) {
    const a = single[i];
    const b = shardedResults[i];
    console.log(
      [
        String(a.writers).padStart(7),
        a.opsPerSecond.toFixed(1).padStart(17),
        b.opsPerSecond.toFixed(1).padStart(18),
        `${(b.opsPerSecond / a.opsPerSecond).toFixed(2)}x`.padStart(10),
        `${a.conflictsPerOp.toFixed(2)} → ${b.conflictsPerOp.toFixed(2)}`.padStart(15),
      ].join(""),
    );
  }
  console.log("");
}

main()
  .catch((err) => {
    console.error("Benchmark failed:", err.message);
    process.exit(1);
  })
  .finally(close);
