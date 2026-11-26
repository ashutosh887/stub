import { NextResponse } from "next/server";
import { tamperDemo } from "@/lib/data";
import { withRoute } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withRoute({ name: "audit-tamper", admin: true }, async () => {
  const result = await tamperDemo();
  return NextResponse.json(result);
});
