import { randomUUID } from "node:crypto";
import { GENESIS_HASH } from "./hash";
import { buildEntry, runOcc, spend, type SpendRequest, type SpendResult } from "./ledger";
import { evaluatePolicies } from "./policy";
import { type Shard, type Store, type Tx } from "./store";

export const DEFAULT_SHARDS = 8;

export interface ShardedSpendOptions {
  shards?: number;
  maxRetries?: number;
  pickShard?: (shards: number) => number;
}

interface Draw {
  index: number;
  amountMicro: bigint;
}

export async function provisionShards(
  store: Store,
  accountId: string,
  totalMicro: bigint,
  shards: number = DEFAULT_SHARDS,
): Promise<void> {
  if (shards < 1) throw new Error("shards must be at least 1");

  const base = totalMicro / BigInt(shards);
  const remainder = totalMicro % BigInt(shards);

  await store.transaction(async (tx) => {
    for (let index = 0; index < shards; index++) {
      await tx.upsertShard({
        accountId,
        index,
        balanceMicro: base + (BigInt(index) < remainder ? 1n : 0n),
        lastEntryHash: GENESIS_HASH,
      });
    }
    await tx.markSharded(accountId);
  });
}

export interface ShardExistingAccountResult {
  accountId: string;
  shards: number;
  totalMicro: bigint;
}

export async function shardExistingAccount(
  store: Store,
  accountId: string,
  shards: number = DEFAULT_SHARDS,
): Promise<ShardExistingAccountResult> {
  const account = await store.transaction((tx) => tx.getAccount(accountId));
  if (!account) throw new Error(`unknown account: ${accountId}`);
  // account.balanceMicro goes stale once sharded, so re-provisioning would silently rewind it.
  if (account.sharded) throw new Error(`account already sharded: ${accountId}`);

  await provisionShards(store, accountId, account.balanceMicro, shards);
  return { accountId, shards, totalMicro: account.balanceMicro };
}

export async function shardBalance(store: Store, accountId: string): Promise<bigint> {
  return store.transaction(async (tx) => {
    const shards = await tx.listShards(accountId);
    return shards.reduce((sum, shard) => sum + shard.balanceMicro, 0n);
  });
}

function planDraw(preferred: Shard | null, all: Shard[], amountMicro: bigint): Draw[] | null {
  if (preferred && preferred.balanceMicro >= amountMicro) {
    return [{ index: preferred.index, amountMicro }];
  }

  const ordered = [...all].sort((a, b) => {
    if (preferred) {
      if (a.index === preferred.index) return -1;
      if (b.index === preferred.index) return 1;
    }
    return b.balanceMicro > a.balanceMicro ? 1 : b.balanceMicro < a.balanceMicro ? -1 : 0;
  });

  const draws: Draw[] = [];
  let remaining = amountMicro;
  for (const shard of ordered) {
    if (remaining === 0n) break;
    if (shard.balanceMicro <= 0n) continue;
    const take = shard.balanceMicro < remaining ? shard.balanceMicro : remaining;
    draws.push({ index: shard.index, amountMicro: take });
    remaining -= take;
  }

  return remaining === 0n ? draws : null;
}

export async function shardedSpend(
  store: Store,
  request: SpendRequest,
  options: ShardedSpendOptions = {},
): Promise<SpendResult> {
  if (request.amountMicro <= 0n) throw new Error("amountMicro must be positive");

  const shardCount = options.shards ?? DEFAULT_SHARDS;
  const pick = options.pickShard ?? ((n: number) => Math.floor(Math.random() * n));

  const { result, conflicts, attempts } = await runOcc(
    store,
    (tx) => settleSharded(tx, request, shardCount, pick),
    options.maxRetries,
  );

  return { ...result, conflicts, attempts };
}

export async function spendAuto(
  store: Store,
  request: SpendRequest,
  options: ShardedSpendOptions = {},
): Promise<SpendResult> {
  const budget = await store.transaction((tx) => tx.getAccount(request.budgetAccountId));
  if (budget?.sharded) return shardedSpend(store, request, options);
  return spend(store, request, { maxRetries: options.maxRetries });
}

async function settleSharded(
  tx: Tx,
  request: SpendRequest,
  shardCount: number,
  pick: (shards: number) => number,
): Promise<Omit<SpendResult, "conflicts" | "attempts">> {
  if (request.idempotencyKey) {
    const existing = await tx.getIdempotent(request.idempotencyKey);
    if (existing) return { status: "duplicate", transactionId: existing };
  }

  const budget = await tx.getAccount(request.budgetAccountId);
  if (!budget) throw new Error(`unknown budget account: ${request.budgetAccountId}`);

  const transactionId = randomUUID();
  type Outcome = Omit<SpendResult, "conflicts" | "attempts">;
  const deny = async (reason: string): Promise<Outcome> => {
    await tx.insertDenial({
      id: randomUUID(),
      accountId: budget.id,
      attemptedMicro: request.amountMicro,
      reason,
      agentId: request.agentId ?? null,
      sessionId: request.sessionId ?? null,
      intent: request.intent ?? null,
      costCenter: request.costCenter ?? null,
      receipt: request.receipt ?? null,
    });
    return { status: "denied", transactionId, reason };
  };

  const ancestors = await tx.getAncestors(budget.id);
  const chain = [budget, ...ancestors];

  const frozen = chain.find((a) => a.frozen);
  if (frozen) return deny("account_frozen");

  const policies = await tx.getPolicies(budget.id);
  if (policies.length > 0) {
    const verdict = await evaluatePolicies(policies, {
      amountMicro: request.amountMicro,
      vendorId: request.vendorAccountId,
      spentInWindow: (windowSeconds) => tx.spentInWindow(budget.id, windowSeconds),
    });
    if (
      verdict.decision !== "allow" &&
      !(verdict.decision === "needs_approval" && request.approve)
    ) {
      const outcome = await deny(verdict.reason);
      if (verdict.decision === "needs_approval") return { ...outcome, status: "needs_approval" };
      return outcome;
    }
  }

  if (budget.velocityLimitMicro != null && budget.velocityWindowSeconds != null) {
    const recent = await tx.spentInWindow(budget.id, budget.velocityWindowSeconds);
    if (recent + request.amountMicro > budget.velocityLimitMicro) {
      await tx.setFrozen(budget.id, true);
      return deny("velocity_tripped");
    }
  }

  const boundAncestor = ancestors.find((a) => request.amountMicro > a.balanceMicro);
  if (boundAncestor) return deny(`${boundAncestor.type}_cap_exceeded`);

  const budgetIndex = pick(shardCount);
  const preferred = await tx.getShard(request.budgetAccountId, budgetIndex);

  // Fast path: the chosen shard covers it, so the txn never reads the other shards.
  let draws: Draw[] | null;
  let known: Shard[];
  if (preferred && preferred.balanceMicro >= request.amountMicro) {
    draws = [{ index: preferred.index, amountMicro: request.amountMicro }];
    known = [preferred];
  } else {
    const all = await tx.listShards(request.budgetAccountId);
    if (all.length === 0) throw new Error(`account is not sharded: ${request.budgetAccountId}`);
    draws = planDraw(preferred, all, request.amountMicro);
    known = all;
  }

  if (!draws) return deny("cap_exceeded");

  const byIndex = new Map(known.map((shard) => [shard.index, shard]));

  for (const draw of draws) {
    const current =
      draw.index === preferred?.index
        ? preferred
        : ((await tx.getShard(request.budgetAccountId, draw.index)) ??
          byIndex.get(draw.index) ??
          null);
    if (!current) throw new Error(`unknown shard: ${request.budgetAccountId}#${draw.index}`);
    if (current.balanceMicro < draw.amountMicro) {
      throw new Error("shard drained during draw");
    }

    const entry = buildEntry({
      transactionId,
      account: { id: request.budgetAccountId, lastEntryHash: current.lastEntryHash },
      kind: "debit",
      amountMicro: -draw.amountMicro,
      request,
    });
    entry.shardIndex = draw.index;

    await tx.insertEntry(entry);
    await tx.updateShard(
      request.budgetAccountId,
      draw.index,
      current.balanceMicro - draw.amountMicro,
      entry.hash,
    );
  }

  const vendorIndex = pick(shardCount);
  const vendorShard = await tx.getShard(request.vendorAccountId, vendorIndex);
  if (!vendorShard) throw new Error(`vendor account is not sharded: ${request.vendorAccountId}`);

  const credit = buildEntry({
    transactionId,
    account: { id: request.vendorAccountId, lastEntryHash: vendorShard.lastEntryHash },
    kind: "credit",
    amountMicro: request.amountMicro,
    request,
  });
  credit.shardIndex = vendorIndex;

  await tx.insertEntry(credit);
  await tx.updateShard(
    request.vendorAccountId,
    vendorIndex,
    vendorShard.balanceMicro + request.amountMicro,
    credit.hash,
  );

  for (const ancestor of ancestors) {
    await tx.updateAccount(
      ancestor.id,
      ancestor.balanceMicro - request.amountMicro,
      ancestor.lastEntryHash,
    );
  }

  if (request.idempotencyKey) {
    await tx.putIdempotent(request.idempotencyKey, transactionId);
  }

  return { status: "committed", transactionId };
}
