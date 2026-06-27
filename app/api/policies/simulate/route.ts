import { NextResponse } from "next/server";
import { simulatePolicy, type Policy } from "@/core/policy";
import { listSpendEvents } from "@/lib/data";
import { microToUsd, usdToMicro } from "@/lib/money";

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

export async function POST(request: Request) {
  let body: SimulateBody;
  try {
    body = (await request.json()) as SimulateBody;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  if (!body.accountId) {
    return NextResponse.json({ error: "accountId is required" }, { status: 400 });
  }

  let limitMicro: bigint | null = null;
  let approvalThresholdMicro: bigint | null = null;
  try {
    if (body.limitUsd !== undefined && body.limitUsd !== "") limitMicro = usdToMicro(body.limitUsd);
    if (body.approvalThresholdUsd !== undefined && body.approvalThresholdUsd !== "")
      approvalThresholdMicro = usdToMicro(body.approvalThresholdUsd);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }

  const candidate: Policy = {
    id: "candidate",
    accountId: body.accountId,
    label: body.label ?? "candidate",
    enabled: true,
    limitMicro,
    windowSeconds: body.windowSeconds ?? null,
    vendorAllow: body.vendorAllow?.length ? body.vendorAllow : null,
    vendorBlock: body.vendorBlock?.length ? body.vendorBlock : null,
    approvalThresholdMicro,
  };

  try {
    const events = await listSpendEvents(body.accountId);
    const result = await simulatePolicy(candidate, events);
    return NextResponse.json({
      evaluated: result.evaluated,
      blocked: result.blocked,
      needsApproval: result.needsApproval,
      savedUsd: microToUsd(result.savedMicro),
      reasons: result.reasons,
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
