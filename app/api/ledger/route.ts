import { NextResponse } from "next/server";
import { listDenials, listEntries } from "@/lib/data";
import { formatUsd, microToUsd } from "@/lib/money";
import { withRoute } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withRoute({ name: "ledger", admin: true }, async ({ request }) => {
  const requested = Number(new URL(request.url).searchParams.get("limit") ?? 50);
  const limit = Number.isFinite(requested) ? Math.min(Math.max(1, requested), 200) : 50;
  const [entries, denials] = await Promise.all([listEntries(limit), listDenials(20)]);
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
});
