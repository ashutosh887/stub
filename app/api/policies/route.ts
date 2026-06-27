import { NextResponse } from "next/server";
import { createPolicy, deletePolicy, listPolicies, setPolicyEnabled } from "@/lib/data";
import { usdToMicro } from "@/lib/money";
import { HttpError, readJson, withRoute } from "@/lib/api";
import { requireText, requireUuid } from "@/lib/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withRoute({ name: "policies", admin: true }, async () => {
  const policies = await listPolicies();
  return NextResponse.json(
    policies.map((p) => ({
      ...p,
      limitMicro: p.limitMicro?.toString() ?? null,
      approvalThresholdMicro: p.approvalThresholdMicro?.toString() ?? null,
    })),
  );
});

interface PolicyBody {
  accountId?: string;
  label?: string;
  limitUsd?: string | number;
  windowSeconds?: number;
  vendorAllow?: string[];
  vendorBlock?: string[];
  approvalThresholdUsd?: string | number;
}

export const POST = withRoute({ name: "policies", admin: true }, async ({ request }) => {
  const body = await readJson<PolicyBody>(request);
  const accountId = requireUuid(body.accountId, "accountId");
  const label = requireText(body.label, "label", 120);

  let limitMicro: bigint | null = null;
  let approvalThresholdMicro: bigint | null = null;
  try {
    if (body.limitUsd !== undefined && body.limitUsd !== "") limitMicro = usdToMicro(body.limitUsd);
    if (body.approvalThresholdUsd !== undefined && body.approvalThresholdUsd !== "")
      approvalThresholdMicro = usdToMicro(body.approvalThresholdUsd);
  } catch {
    throw new HttpError(400, "limitUsd / approvalThresholdUsd must be valid USD amounts");
  }

  const hasRule =
    limitMicro != null ||
    approvalThresholdMicro != null ||
    (body.vendorAllow?.length ?? 0) > 0 ||
    (body.vendorBlock?.length ?? 0) > 0;
  if (!hasRule) {
    throw new HttpError(400, "a policy needs at least one constraint (limit, approval, or vendor list)");
  }

  const id = await createPolicy({
    accountId,
    label,
    limitMicro,
    windowSeconds: body.windowSeconds ?? null,
    vendorAllow: body.vendorAllow ?? null,
    vendorBlock: body.vendorBlock ?? null,
    approvalThresholdMicro,
  });
  return NextResponse.json({ id });
});

export const PATCH = withRoute({ name: "policies", admin: true }, async ({ request }) => {
  const body = await readJson<{ id?: string; enabled?: boolean }>(request);
  const id = requireUuid(body.id, "id");
  if (typeof body.enabled !== "boolean") throw new HttpError(400, "enabled is required");
  await setPolicyEnabled(id, body.enabled);
  return NextResponse.json({ id, enabled: body.enabled });
});

export const DELETE = withRoute({ name: "policies", admin: true }, async ({ request }) => {
  const id = new URL(request.url).searchParams.get("id");
  const validId = requireUuid(id, "id");
  await deletePolicy(validId);
  return NextResponse.json({ id: validId });
});
