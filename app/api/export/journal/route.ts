import { NextResponse } from "next/server";
import { listJournalLines } from "@/lib/data";
import { withRoute } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const cell = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;

export const GET = withRoute({ name: "export/journal", admin: true }, async () => {
  const lines = await listJournalLines(5000);
  const header = [
    "date",
    "transaction_id",
    "account",
    "cost_center",
    "debit_usd",
    "credit_usd",
    "memo",
  ].join(",");

  const body = [
    header,
    ...lines.map((l) =>
      [
        l.recordedAt,
        l.transactionId,
        cell(l.account),
        cell(l.costCenter),
        l.debitUsd,
        l.creditUsd,
        cell(l.memo),
      ].join(","),
    ),
  ].join("\n");

  return new NextResponse(body, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": 'attachment; filename="stub-journal.csv"',
      "cache-control": "no-store",
    },
  });
});
