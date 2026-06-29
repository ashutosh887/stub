import { NextResponse } from "next/server";
import { release } from "@/core/settlement";
import { resolveApiKey, store } from "@/lib/data";
import { limits } from "@/config";
import { HttpError, isAdmin, readJson, withRoute } from "@/lib/api";
import { log } from "@/lib/log";
import { requireUuid } from "@/lib/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ReleaseBody {
  reservationId?: string;
}

export const POST = withRoute({ name: "release" }, async ({ request, requestId }) => {
  const body = await readJson<ReleaseBody>(request);

  const auth = request.headers.get("authorization");
  const bearer = auth?.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : null;
  if (bearer) {
    if (!(await resolveApiKey(bearer))) throw new HttpError(401, "invalid api key");
  } else if (!isAdmin(request)) {
    throw new HttpError(401, "unauthorized");
  }

  const reservationId = requireUuid(body.reservationId, "reservationId");
  const result = await release(store, reservationId, { maxRetries: limits.occMaxRetries });

  log.info("release_settled", { requestId, status: result.status, conflicts: result.conflicts });

  const status = result.status === "not_found" ? 404 : result.status === "invalid" ? 409 : 200;
  return NextResponse.json(result, { status });
});
