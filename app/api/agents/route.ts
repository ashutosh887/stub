import { NextResponse } from "next/server";
import { createAgent, listAgents } from "@/lib/data";
import { readJson, withRoute } from "@/lib/api";
import { requireText, requireUuid } from "@/lib/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface AgentBody {
  name?: string;
  accountId?: string;
}

export const GET = withRoute({ name: "agents", admin: true }, async () => {
  return NextResponse.json(await listAgents());
});

export const POST = withRoute({ name: "agents", admin: true }, async ({ request }) => {
  const body = await readJson<AgentBody>(request);
  const name = requireText(body.name, "name", 80);
  const accountId = requireUuid(body.accountId, "accountId");
  const created = await createAgent(name, accountId);
  return NextResponse.json(created);
});
