import { listEntries } from "@/lib/data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const cell = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
const usd = (micro: bigint) => (Number(micro < 0n ? -micro : micro) / 1_000_000).toFixed(6);

export async function GET() {
  const entries = await listEntries(5000);
  const header = [
    "recorded_at",
    "transaction_id",
    "account",
    "kind",
    "amount_usd",
    "agent",
    "intent",
    "hash",
    "prev_hash",
  ].join(",");

  const lines = entries.map((e) =>
    [
      e.createdAt,
      e.transactionId,
      cell(e.accountName),
      e.kind,
      usd(e.amountMicro),
      cell(e.agentId ?? ""),
      cell(e.intent ?? ""),
      e.hash,
      e.prevHash,
    ].join(","),
  );

  const body = [header, ...lines].join("\n");
  return new Response(body, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": 'attachment; filename="stub-ledger.csv"',
      "cache-control": "no-store",
    },
  });
}
