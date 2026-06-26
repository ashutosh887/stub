import { NextResponse } from "next/server";
import { listDenials, listEntries } from "../../../lib/data";
import { formatUsd, microToUsd } from "../../../lib/money";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const limit = Number(new URL(request.url).searchParams.get("limit") ?? 50);
    const [entries, denials] = await Promise.all([
      listEntries(limit),
      listDenials(20),
    ]);
    return NextResponse.json({
      entries: entries.map((e) => ({
        id: e.id,
        transactionId: e.transactionId,
        account: e.accountName,
        kind: e.kind,
        amount: microToUsd(e.amountMicro),
        amountDisplay: formatUsd(e.amountMicro),
        agentId: e.agentId,
        intent: e.intent,
        hash: e.hash,
        createdAt: e.createdAt,
      })),
      denials: denials.map((d) => ({
        id: d.id,
        account: d.accountName,
        attempted: microToUsd(d.attemptedMicro),
        attemptedDisplay: formatUsd(d.attemptedMicro),
        reason: d.reason,
        agentId: d.agentId,
        intent: d.intent,
        createdAt: d.createdAt,
      })),
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
