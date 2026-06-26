import { NextResponse } from "next/server";
import { setAllFrozen, setFrozen } from "../../../lib/data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface FreezeBody {
  accountId?: string;
  frozen?: boolean;
  all?: boolean;
}

export async function POST(request: Request) {
  let body: FreezeBody;
  try {
    body = (await request.json()) as FreezeBody;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const frozen = body.frozen ?? true;
  try {
    if (body.all) {
      await setAllFrozen(frozen);
      return NextResponse.json({ scope: "all", frozen });
    }
    if (!body.accountId) {
      return NextResponse.json({ error: "accountId or all is required" }, { status: 400 });
    }
    await setFrozen(body.accountId, frozen);
    return NextResponse.json({ scope: "account", accountId: body.accountId, frozen });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
