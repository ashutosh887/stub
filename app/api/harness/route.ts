import { NextResponse } from "next/server";
import { type ApproachResult, runHarness } from "@/core/harness";
import { HttpError, isAdmin, withRoute } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const USD = 1_000_000n;

function view(r: ApproachResult) {
  return {
    approach: r.approach,
    committedSpends: r.committedSpends,
    paymentsAttempted: r.paymentsAttempted,
    paymentsSent: r.paymentsSent,
    chargedUsd: Number(r.chargedMicro) / 1e6,
    finalBalanceUsd: Number(r.finalBalanceMicro) / 1e6,
    occConflicts: r.occConflicts,
    stuckHolds: r.stuckHolds,
    overspend: r.overspend,
    doublePaid: r.doublePaid,
    invariantsHold: r.invariantsHold,
  };
}

export const POST = withRoute({ name: "harness" }, async ({ request }) => {
  if (!isAdmin(request)) throw new HttpError(401, "unauthorized");
  const report = await runHarness({
    capMicro: 3n * USD,
    amountMicro: 1n * USD,
    writers: 16,
    crashRate: 0.25,
  });
  return NextResponse.json({
    affordable: report.affordable,
    writers: report.config.writers,
    naive: view(report.naive),
    stub: view(report.stub),
  });
});
