import { NextResponse } from "next/server";
import { setAllFrozen, setFrozen } from "@/lib/data";
import { HttpError, readJson, withRoute } from "@/lib/api";
import { requireUuid } from "@/lib/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface FreezeBody {
  accountId?: string;
  frozen?: boolean;
  all?: boolean;
}

export const POST = withRoute({ name: "freeze", admin: true }, async ({ request }) => {
  const body = await readJson<FreezeBody>(request);
  const frozen = body.frozen ?? true;

  if (body.all) {
    await setAllFrozen(frozen);
    return NextResponse.json({ scope: "all", frozen });
  }
  if (!body.accountId) throw new HttpError(400, "accountId or all is required");
  const accountId = requireUuid(body.accountId, "accountId");
  await setFrozen(accountId, frozen);
  return NextResponse.json({ scope: "account", accountId, frozen });
});
