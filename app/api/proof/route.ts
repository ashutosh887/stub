import { NextResponse } from "next/server";
import { db, dsql, limits } from "@/config";
import { activeRegion, getPool } from "@/db/client";
import { HttpError, withRoute } from "@/lib/api";
import { log } from "@/lib/log";
import { redact, runProof, type ProofReport, type ProofTally } from "@/lib/proof";
import { readTally, recordRun, type TallyClient } from "@/lib/proof-runs";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PER_IP_MAX = 5;
const ALL_CALLERS_MAX = 60;
const TALLY_PER_IP_MAX = 30;

function regionLabel(): string {
  if (db.url) return "local Postgres";
  const region = activeRegion() ?? dsql.region;
  return region === dsql.region ? `${region} (primary)` : `${region} (peer)`;
}

async function tallyAfter(client: TallyClient, report?: ProofReport): Promise<ProofTally | null> {
  try {
    if (report) await recordRun(client, report);
    return await readTally(client);
  } catch (err) {
    log.warn("proof_tally_unavailable", { error: redact((err as Error).message) });
    return null;
  }
}

export const POST = withRoute({ name: "proof", rateLimitMax: PER_IP_MAX }, async () => {
  if (!rateLimit("proof:all", ALL_CALLERS_MAX, limits.rateLimitWindowMs).ok) {
    throw new HttpError(429, "the proof is busy, try again in a minute");
  }
  const client = await getPool().connect();
  try {
    const report = await runProof(client, regionLabel());
    const tally = await tallyAfter(client, report);
    return NextResponse.json({ ...report, tally }, { headers: { "cache-control": "no-store" } });
  } finally {
    client.release();
  }
});

export const GET = withRoute({ name: "proof-tally", rateLimitMax: TALLY_PER_IP_MAX }, async () => {
  let tally: ProofTally | null = null;
  try {
    const client = await getPool().connect();
    try {
      tally = await tallyAfter(client);
    } finally {
      client.release();
    }
  } catch (err) {
    log.warn("proof_tally_unavailable", { error: redact((err as Error).message) });
  }
  return NextResponse.json(
    { tally },
    { headers: { "cache-control": "public, s-maxage=30, stale-while-revalidate=300" } },
  );
});
