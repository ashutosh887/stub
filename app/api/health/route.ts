import { NextResponse } from "next/server";
import { query } from "@/db/client";
import { withRoute } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withRoute({ name: "health", rateLimitMax: 600 }, async () => {
  const start = Date.now();
  try {
    await query("SELECT 1");
  } catch {
    return NextResponse.json({ status: "degraded", db: "down" }, { status: 503 });
  }
  return NextResponse.json({ status: "ok", db: "up", latencyMs: Date.now() - start });
});
