import { NextResponse } from "next/server";
import { spend } from "@/core/ledger";
import { resolveApiKey, store } from "@/lib/data";
import { limits } from "@/config";
import { HttpError, isAdmin, readJson, withRoute } from "@/lib/api";
import { log } from "@/lib/log";
import { ensureWithinSize, parseSpendAmount, requireUuid } from "@/lib/validate";

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
  approve?: boolean;
}

export const POST = withRoute({ name: "spend" }, async ({ request, requestId }) => {
  const body = await readJson<SpendBody>(request);

  let scopedAgentId: string | undefined;
  let scopedBudgetId: string | undefined;
  const auth = request.headers.get("authorization");
  const bearer = auth?.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : null;
  if (bearer) {
    const agent = await resolveApiKey(bearer);
    if (!agent) throw new HttpError(401, "invalid api key");
    scopedAgentId = agent.agentId;
    scopedBudgetId = agent.accountId;
  } else if (!isAdmin(request)) {
    throw new HttpError(401, "unauthorized");
  }

  const vendorAccountId = requireUuid(body.vendorAccountId, "vendorAccountId");
  const budgetAccountId = scopedBudgetId ?? requireUuid(body.budgetAccountId, "budgetAccountId");
  const amountMicro = parseSpendAmount(body.amountUsd, limits.maxSpendMicro);
  ensureWithinSize(body.receipt, limits.maxReceiptBytes, "receipt");

  const result = await spend(
    store,
    {
      budgetAccountId,
      vendorAccountId,
      amountMicro,
      idempotencyKey: body.idempotencyKey,
      agentId: scopedAgentId ?? body.agentId,
      sessionId: body.sessionId,
      userId: body.userId,
      intent: body.intent,
      receipt: body.receipt,
      approve: body.approve === true,
    },
    { maxRetries: limits.occMaxRetries },
  );

  log.info("spend_settled", {
    requestId,
    status: result.status,
    reason: result.reason,
    conflicts: result.conflicts,
    attempts: result.attempts,
  });

  return NextResponse.json(result, { status: result.status === "denied" ? 402 : 200 });
});
