import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { createPool, query } from "@/db/client";
import { PgStore } from "@/db/pg-store";
import { spend, type SpendResult } from "@/core/ledger";
import { GENESIS_HASH } from "@/core/hash";
import { dsql } from "@/config";
import { HttpError, isAdmin, readJson, withRoute } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const USD = 1_000_000n;
const PER_SPEND = 250_000n; // $0.25 — only 4 fit in a $1.00 budget

// Races N concurrent spends at one near-empty budget on the real cluster. Each
// spend uses its own connection (dedicated pool) so the OCC conflicts are real
// 40001s, not serialized. Runs in isolated accounts that are deleted after, so
// the main ledger is never touched.
export const POST = withRoute({ name: "stress" }, async ({ request }) => {
  if (!isAdmin(request)) throw new HttpError(401, "unauthorized");
  const body = await readJson<{ count?: number }>(request).catch(() => ({ count: 12 }));
  const count = Math.max(2, Math.min(24, Number(body?.count ?? 12) || 12));

  const budgetId = randomUUID();
  const vendorId = randomUUID();
  await query(
    `INSERT INTO accounts (id, type, parent_id, name, balance_micro, cap_micro, last_entry_hash)
     VALUES ($1,'agent',NULL,'stress-budget',$2,$2,$3)`,
    [budgetId, USD.toString(), GENESIS_HASH],
  );
  await query(
    `INSERT INTO accounts (id, type, parent_id, name, balance_micro, cap_micro, last_entry_hash)
     VALUES ($1,'vendor',NULL,'stress-vendor',0,NULL,$2)`,
    [vendorId, GENESIS_HASH],
  );

  const pool = createPool({
    endpoint: dsql.endpoint,
    region: dsql.region,
    database: dsql.database,
    user: dsql.user,
    max: count,
  });
  const store = new PgStore(pool);

  try {
    const settled = await Promise.all(
      Array.from({ length: count }, (_, i) =>
        spend(
          store,
          {
            budgetAccountId: budgetId,
            vendorAccountId: vendorId,
            amountMicro: PER_SPEND,
            intent: "stress test",
            agentId: `stress-${i}`,
          },
          { maxRetries: 50 },
        ).catch(
          () => ({ status: "denied", conflicts: 0, attempts: 1 } as unknown as SpendResult),
        ),
      ),
    );

    const committed = settled.filter((r) => r.status === "committed").length;
    const denied = settled.length - committed;
    const conflicts = settled.reduce((s, r) => s + (r.conflicts ?? 0), 0);

    const { rows } = await query<{ balance_micro: string }>(
      `SELECT balance_micro FROM accounts WHERE id = $1`,
      [budgetId],
    );
    const finalMicro = BigInt(rows[0]?.balance_micro ?? "0");

    return NextResponse.json({
      count,
      budgetUsd: 1,
      perSpendUsd: 0.25,
      committed,
      denied,
      conflicts,
      committedUsd: committed * 0.25,
      finalBalanceUsd: Number(finalMicro) / 1e6,
      neverNegative: finalMicro >= 0n,
    });
  } finally {
    await pool.end().catch(() => {});
    await query(`DELETE FROM entries WHERE account_id IN ($1,$2)`, [budgetId, vendorId]).catch(() => {});
    await query(`DELETE FROM denials WHERE account_id IN ($1,$2)`, [budgetId, vendorId]).catch(() => {});
    await query(`DELETE FROM accounts WHERE id IN ($1,$2)`, [budgetId, vendorId]).catch(() => {});
  }
});
