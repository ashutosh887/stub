import { NextResponse } from "next/server";
import { db, dsql, limits } from "@/config";
import { activeRegion, getPool } from "@/db/client";
import { HttpError, withRoute } from "@/lib/api";
import { runProof } from "@/lib/proof";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PER_IP_MAX = 5;
const ALL_CALLERS_MAX = 60;

function regionLabel(): string {
  if (db.url) return "local Postgres";
  const region = activeRegion() ?? dsql.region;
  return region === dsql.region ? `${region} (primary)` : `${region} (peer)`;
}

export const POST = withRoute({ name: "proof", rateLimitMax: PER_IP_MAX }, async () => {
  if (!rateLimit("proof:all", ALL_CALLERS_MAX, limits.rateLimitWindowMs).ok) {
    throw new HttpError(429, "the proof is busy, try again in a minute");
  }
  const client = await getPool().connect();
  try {
    const report = await runProof(client, regionLabel());
    return NextResponse.json(report, { headers: { "cache-control": "no-store" } });
  } finally {
    client.release();
  }
});
