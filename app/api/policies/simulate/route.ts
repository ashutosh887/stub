import { NextResponse } from "next/server";
import { simulatePolicy, type Policy } from "@/core/policy";
import { listSpendEvents } from "@/lib/data";
import { microToUsd, usdToMicro } from "@/lib/money";
import { HttpError, readJson, withRoute } from "@/lib/api";
import { requireUuid } from "@/lib/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface SimulateBody {
  accountId?: string;
  label?: string;
  limitUsd?: string | number;
  windowSeconds?: number;
  vendorAllow?: string[];
  vendorBlock?: string[];
  approvalThresholdUsd?: string | number;
}

export const POST = withRoute({ name: "policies/simulate", admin: true }, async ({ request }) => {
  const body = await readJson<SimulateBody>(request);
  const accountId = requireUuid(body.accountId, "accountId");

  let limitMicro: bigint | null = null;
  let approvalThresholdMicro: bigint | null = null;
  try {
    if (body.limitUsd !== undefined && body.limitUsd !== "") limitMicro = usdToMicro(body.limitUsd);
    if (body.approvalThresholdUsd !== undefined && body.approvalThresholdUsd !== "")
      approvalThresholdMicro = usdToMicro(body.approvalThresholdUsd);
  } catch {
    throw new HttpError(400, "limitUsd / approvalThresholdUsd must be valid USD amounts");
  }

  const candidate: Policy = {
    id: "candidate",
    accountId,
    label: body.label ?? "candidate",
    enabled: true,
    limitMicro,
    windowSeconds: body.windowSeconds ?? null,
    vendorAllow: body.vendorAllow?.length ? body.vendorAllow : null,
    vendorBlock: body.vendorBlock?.length ? body.vendorBlock : null,
    approvalThresholdMicro,
  };

  const events = await listSpendEvents(accountId);
  const result = await simulatePolicy(candidate, events);
  return NextResponse.json({
    evaluated: result.evaluated,
    blocked: result.blocked,
    needsApproval: result.needsApproval,
    savedUsd: microToUsd(result.savedMicro),
    reasons: result.reasons,
  });
});
