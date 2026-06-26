import { NextResponse } from "next/server";
import { listAccounts } from "../../../lib/data";
import { formatUsd, microToUsd } from "../../../lib/money";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
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
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
