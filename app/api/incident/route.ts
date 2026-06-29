import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { createPool, query } from "@/db/client";
import { PgStore } from "@/db/pg-store";
import { spend, type SpendResult } from "@/core/ledger";
import { GENESIS_HASH } from "@/core/hash";
import { dsql } from "@/config";
import { HttpError, isAdmin, readJson, withRoute } from "@/lib/api";
import { findScenario } from "@/lib/incidents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withRoute({ name: "incident" }, async ({ request }) => {
  if (!isAdmin(request)) throw new HttpError(401, "unauthorized");
  const body = await readJson<{ scenarioId?: string }>(request).catch(
    () => ({}) as { scenarioId?: string },
  );
  const scenario = findScenario(body?.scenarioId);

  const calls = Math.min(40, scenario.calls);
  const perSpend = BigInt(Math.round(scenario.perCallUsd * 1_000_000));
  const cap = BigInt(Math.round(scenario.budgetUsd * 1_000_000));

  const budgetId = randomUUID();
  const vendorId = randomUUID();
  await query(
    `INSERT INTO accounts (id, type, parent_id, name, balance_micro, cap_micro, last_entry_hash)
     VALUES ($1,'agent',NULL,'incident-budget',$2,$2,$3)`,
    [budgetId, cap.toString(), GENESIS_HASH],
  );
  await query(
    `INSERT INTO accounts (id, type, parent_id, name, balance_micro, cap_micro, last_entry_hash)
     VALUES ($1,'vendor',NULL,'incident-vendor',0,NULL,$2)`,
    [vendorId, GENESIS_HASH],
  );

  const pool = createPool({
    endpoint: dsql.endpoint,
    region: dsql.region,
    database: dsql.database,
    user: dsql.user,
    max: calls,
  });
  const store = new PgStore(pool);

  try {
    const settled = await Promise.all(
      Array.from({ length: calls }, (_, i) =>
        spend(
          store,
          {
            budgetAccountId: budgetId,
            vendorAccountId: vendorId,
            amountMicro: perSpend,
            intent: `${scenario.id} runaway call`,
            agentId: `runaway-${i}`,
          },
          { maxRetries: 50 },
        ).catch(() => ({ status: "denied", conflicts: 0, attempts: 1 }) as unknown as SpendResult),
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

    const attemptedUsd = calls * scenario.perCallUsd;
    const committedUsd = committed * scenario.perCallUsd;

    return NextResponse.json({
      scenario,
      calls,
      committed,
      denied,
      conflicts,
      attemptedUsd: Number(attemptedUsd.toFixed(2)),
      committedUsd: Number(committedUsd.toFixed(2)),
      blockedUsd: Number((attemptedUsd - committedUsd).toFixed(2)),
      finalBalanceUsd: Number(finalMicro) / 1e6,
      capUsd: scenario.budgetUsd,
      neverNegative: finalMicro >= 0n,
    });
  } finally {
    await pool.end().catch(() => {});
    await query(`DELETE FROM entries WHERE account_id IN ($1,$2)`, [budgetId, vendorId]).catch(() => {});
    await query(`DELETE FROM denials WHERE account_id IN ($1,$2)`, [budgetId, vendorId]).catch(() => {});
    await query(`DELETE FROM accounts WHERE id IN ($1,$2)`, [budgetId, vendorId]).catch(() => {});
  }
});
