import { NextResponse } from "next/server";
import { shardExistingAccount } from "@/core/sharded";
import { store } from "@/lib/data";
import { formatUsd, microToUsd } from "@/lib/money";
import { HttpError, readJson, withRoute } from "@/lib/api";
import { requireUuid } from "@/lib/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ShardBody {
  accountId?: string;
  shards?: number;
}

export const POST = withRoute({ name: "accounts/shard", admin: true }, async ({ request }) => {
  const body = await readJson<ShardBody>(request);
  const accountId = requireUuid(body.accountId, "accountId");

  if (body.shards !== undefined && (!Number.isInteger(body.shards) || body.shards < 1)) {
    throw new HttpError(400, "shards must be a positive integer");
  }

  try {
    const result = await shardExistingAccount(store, accountId, body.shards);
    return NextResponse.json({
      accountId: result.accountId,
      shards: result.shards,
      total: microToUsd(result.totalMicro),
      totalDisplay: formatUsd(result.totalMicro),
    });
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("unknown account:")) {
      throw new HttpError(404, err.message);
    }
    if (
      err instanceof Error &&
      (err.message.startsWith("account already sharded:") ||
        err.message.startsWith("account has child accounts:"))
    ) {
      throw new HttpError(409, err.message);
    }
    throw err;
  }
});
