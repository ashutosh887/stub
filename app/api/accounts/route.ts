import { NextResponse } from "next/server";
import { listAccounts } from "@/lib/data";
import { formatUsd, microToUsd } from "@/lib/money";
import { withRoute } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withRoute({ name: "accounts", admin: true }, async () => {
  const accounts = await listAccounts();
  return NextResponse.json({
    accounts: accounts.map((a) => ({
      id: a.id,
      type: a.type,
      parentId: a.parentId,
      name: a.name,
      balance: microToUsd(a.balanceMicro),
      balanceDisplay: formatUsd(a.balanceMicro),
      cap: a.capMicro == null ? null : microToUsd(a.capMicro),
      capDisplay: a.capMicro == null ? null : formatUsd(a.capMicro),
    })),
  });
});
