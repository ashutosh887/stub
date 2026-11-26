import { NextResponse } from "next/server";
import { createDriverPool } from "@/db/client";
import { HttpError, readJson, withRoute } from "@/lib/api";
import { DrillNotProvisionedError, STRESS_BUDGET, runDrill } from "@/lib/drills";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PER_HOLD = 250_000n;

export const POST = withRoute({ name: "stress", admin: true }, async ({ request }) => {
  const body = await readJson<{ count?: number }>(request).catch(() => ({ count: 12 }));
  const count = Math.max(2, Math.min(24, Number(body?.count ?? 12) || 12));

  const pool = createDriverPool(count);
  try {
    const run = await runDrill(pool, STRESS_BUDGET, {
      calls: count,
      amountMicro: PER_HOLD,
      intent: "stress test",
      agentPrefix: "stress",
    });
    return NextResponse.json({
      count,
      budgetUsd: Number(run.capMicro) / 1e6,
      perSpendUsd: Number(PER_HOLD) / 1e6,
      committed: run.held,
      denied: run.denied,
      failed: run.failed,
      conflicts: run.conflicts,
      committedUsd: Number(run.heldMicro) / 1e6,
      finalBalanceUsd: Number(run.lowMicro) / 1e6,
      restoredBalanceUsd: Number(run.restoredMicro) / 1e6,
      neverNegative: run.lowMicro >= 0n && run.restoredMicro >= 0n,
    });
  } catch (err) {
    if (err instanceof DrillNotProvisionedError) throw new HttpError(503, err.message);
    throw err;
  } finally {
    await pool.end().catch(() => {});
  }
});
