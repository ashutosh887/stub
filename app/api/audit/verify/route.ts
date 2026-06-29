import { NextResponse } from "next/server";
import { auditReport } from "@/lib/data";
import { withRoute } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withRoute({ name: "audit-verify" }, async () => {
  const report = await auditReport();
  return NextResponse.json(report);
});
