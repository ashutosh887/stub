import { NextResponse } from "next/server";
import { spend } from "../../../core/ledger";
import { store } from "../../../lib/data";
import { usdToMicro } from "../../../lib/money";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface SpendBody {
  budgetAccountId?: string;
  vendorAccountId?: string;
  amountUsd?: string | number;
  idempotencyKey?: string;
  agentId?: string;
  sessionId?: string;
  userId?: string;
  intent?: string;
  receipt?: unknown;
}

export async function POST(request: Request) {
  let body: SpendBody;
  try {
    body = (await request.json()) as SpendBody;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const { budgetAccountId, vendorAccountId, amountUsd } = body;
  if (!budgetAccountId || !vendorAccountId || amountUsd === undefined) {
    return NextResponse.json(
      { error: "budgetAccountId, vendorAccountId and amountUsd are required" },
      { status: 400 },
    );
  }

  let amountMicro: bigint;
  try {
    amountMicro = usdToMicro(amountUsd);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }

  try {
    const result = await spend(store, {
      budgetAccountId,
      vendorAccountId,
      amountMicro,
      idempotencyKey: body.idempotencyKey,
      agentId: body.agentId,
      sessionId: body.sessionId,
      userId: body.userId,
      intent: body.intent,
      receipt: body.receipt,
    });
    const status = result.status === "denied" ? 402 : 200;
    return NextResponse.json(result, { status });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
