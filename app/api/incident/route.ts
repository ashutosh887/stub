import { NextResponse } from "next/server";
import { createDriverPool } from "@/db/client";
import { HttpError, readJson, withRoute } from "@/lib/api";
import { DrillNotProvisionedError, incidentBudget, runDrill } from "@/lib/drills";
import { findScenario } from "@/lib/incidents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withRoute({ name: "incident", admin: true }, async ({ request }) => {
  const body = await readJson<{ scenarioId?: string }>(request).catch(
    () => ({}) as { scenarioId?: string },
  );
  const scenario = findScenario(body?.scenarioId);

  const calls = Math.min(40, scenario.calls);
  const perCall = BigInt(Math.round(scenario.perCallUsd * 1_000_000));

  const pool = createDriverPool(calls);
  try {
    const run = await runDrill(pool, incidentBudget(scenario), {
      calls,
      amountMicro: perCall,
      intent: `${scenario.id} runaway call`,
      agentPrefix: "runaway",
    });

    const attemptedUsd = (calls * Number(perCall)) / 1e6;
    const committedUsd = Number(run.heldMicro) / 1e6;

    return NextResponse.json({
      scenario,
      calls,
      committed: run.held,
      denied: run.denied,
      failed: run.failed,
      conflicts: run.conflicts,
      attemptedUsd: Number(attemptedUsd.toFixed(2)),
      committedUsd: Number(committedUsd.toFixed(2)),
      blockedUsd: Number((attemptedUsd - committedUsd).toFixed(2)),
      finalBalanceUsd: Number(run.lowMicro) / 1e6,
      restoredBalanceUsd: Number(run.restoredMicro) / 1e6,
      capUsd: Number(run.capMicro) / 1e6,
      neverNegative: run.lowMicro >= 0n && run.restoredMicro >= 0n,
    });
  } catch (err) {
    if (err instanceof DrillNotProvisionedError) throw new HttpError(503, err.message);
    throw err;
  } finally {
    await pool.end().catch(() => {});
  }
});
