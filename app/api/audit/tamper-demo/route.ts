import { NextResponse } from "next/server";
import { tamperDemo } from "@/lib/data";
import { HttpError, isAdmin, withRoute } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withRoute({ name: "audit-tamper" }, async ({ request }) => {
  if (!isAdmin(request)) throw new HttpError(401, "unauthorized");
  const result = await tamperDemo();
  return NextResponse.json(result);
});
