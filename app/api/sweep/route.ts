import { NextResponse } from "next/server";
import { sweepExpiredReservations } from "@/core/settlement";
import { store } from "@/lib/data";
import { limits } from "@/config";
import { withRoute } from "@/lib/api";
import { log } from "@/lib/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withRoute({ name: "sweep", admin: true }, async ({ requestId }) => {
  const results = await sweepExpiredReservations(store, limits.reservationTtlSeconds);
  const released = results.filter((r) => r.status === "released").length;

  log.info("sweep_completed", { requestId, swept: results.length, released });

  return NextResponse.json({
    ttlSeconds: limits.reservationTtlSeconds,
    swept: results.length,
    released,
  });
});
