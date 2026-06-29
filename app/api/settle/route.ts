import { NextResponse } from "next/server";
import { settle } from "@/core/settlement";
import { resolveApiKey, store } from "@/lib/data";
import { limits } from "@/config";
import { HttpError, isAdmin, readJson, withRoute } from "@/lib/api";
import { log } from "@/lib/log";
import { parseSpendAmount, requireUuid } from "@/lib/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface SettleBody {
  reservationId?: string;
  actualUsd?: string | number;
}

export const POST = withRoute({ name: "settle" }, async ({ request, requestId }) => {
  const body = await readJson<SettleBody>(request);

  const auth = request.headers.get("authorization");
  const bearer = auth?.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : null;
  if (bearer) {
    if (!(await resolveApiKey(bearer))) throw new HttpError(401, "invalid api key");
  } else if (!isAdmin(request)) {
    throw new HttpError(401, "unauthorized");
  }

  const reservationId = requireUuid(body.reservationId, "reservationId");
  const actualMicro =
    body.actualUsd === undefined || body.actualUsd === null || body.actualUsd === ""
      ? undefined
      : parseSpendAmount(body.actualUsd, limits.maxSpendMicro);

  const result = await settle(store, reservationId, {
    actualMicro,
    maxRetries: limits.occMaxRetries,
  });

  log.info("settle_settled", {
    requestId,
    status: result.status,
    conflicts: result.conflicts,
  });

  const status = result.status === "not_found" ? 404 : result.status === "invalid" ? 409 : 200;
  return NextResponse.json(result, { status });
});
