import { NextResponse } from "next/server";
import { createPolicy, deletePolicy, listPolicies, setPolicyEnabled } from "@/lib/data";
import { usdToMicro } from "@/lib/money";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const policies = await listPolicies();
    return NextResponse.json(
      policies.map((p) => ({
        ...p,
        limitMicro: p.limitMicro?.toString() ?? null,
        approvalThresholdMicro: p.approvalThresholdMicro?.toString() ?? null,
      })),
    );
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

interface PolicyBody {
  accountId?: string;
  label?: string;
  limitUsd?: string | number;
  windowSeconds?: number;
  vendorAllow?: string[];
  vendorBlock?: string[];
  approvalThresholdUsd?: string | number;
}

export async function POST(request: Request) {
  let body: PolicyBody;
  try {
    body = (await request.json()) as PolicyBody;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  if (!body.accountId || !body.label) {
    return NextResponse.json({ error: "accountId and label are required" }, { status: 400 });
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

  const hasRule =
    limitMicro != null ||
    approvalThresholdMicro != null ||
    (body.vendorAllow?.length ?? 0) > 0 ||
    (body.vendorBlock?.length ?? 0) > 0;
  if (!hasRule) {
    return NextResponse.json(
      { error: "a policy needs at least one constraint (limit, approval, or vendor list)" },
      { status: 400 },
    );
  }

  try {
    const id = await createPolicy({
      accountId: body.accountId,
      label: body.label,
      limitMicro,
      windowSeconds: body.windowSeconds ?? null,
      vendorAllow: body.vendorAllow ?? null,
      vendorBlock: body.vendorBlock ?? null,
      approvalThresholdMicro,
    });
    return NextResponse.json({ id });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  let body: { id?: string; enabled?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (!body.id || typeof body.enabled !== "boolean") {
    return NextResponse.json({ error: "id and enabled are required" }, { status: 400 });
  }
  try {
    await setPolicyEnabled(body.id, body.enabled);
    return NextResponse.json({ id: body.id, enabled: body.enabled });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id query param is required" }, { status: 400 });
  try {
    await deletePolicy(id);
    return NextResponse.json({ id });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
