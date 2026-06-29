import { randomUUID } from "node:crypto";
import { GENESIS_HASH, hashEntry } from "./hash";
import { evaluatePolicies } from "./policy";
import { type Entry, type Store, type Tx, isConflict } from "./store";

export interface SpendRequest {
  budgetAccountId: string;
  vendorAccountId: string;
  amountMicro: bigint;
  idempotencyKey?: string;
  agentId?: string;
  sessionId?: string;
  userId?: string;
  intent?: string;
  costCenter?: string;
  receipt?: unknown;
  approve?: boolean;
}

export type SpendStatus = "committed" | "denied" | "duplicate" | "needs_approval";

export interface SpendResult {
  status: SpendStatus;
  transactionId: string;
  reason?: string;
  conflicts: number;
  attempts: number;
}

export interface SpendOptions {
  maxRetries?: number;
}

export const DEFAULT_MAX_RETRIES = 50;

type SettleOutcome = Omit<SpendResult, "conflicts" | "attempts">;

export interface OccResult<T> {
  result: T;
  conflicts: number;
  attempts: number;
}

export async function runOcc<T>(
  store: Store,
  fn: (tx: Tx) => Promise<T>,
  maxRetries: number = DEFAULT_MAX_RETRIES,
): Promise<OccResult<T>> {
  let conflicts = 0;
  for (let attempt = 1; ; attempt += 1) {
    try {
      const result = await store.transaction(fn);
      return { result, conflicts, attempts: attempt };
    } catch (err) {
      if (isConflict(err) && attempt <= maxRetries) {
        conflicts += 1;
        await backoff(attempt);
        continue;
      }
      throw err;
    }
  }
}

export async function spend(
  store: Store,
  request: SpendRequest,
  options: SpendOptions = {},
): Promise<SpendResult> {
  if (request.amountMicro <= 0n) {
    throw new Error("amountMicro must be positive");
  }

  const { result, conflicts, attempts } = await runOcc(
    store,
    (tx) => settle(tx, request),
    options.maxRetries ?? DEFAULT_MAX_RETRIES,
  );
  return { ...result, conflicts, attempts };
}

async function settle(tx: Tx, request: SpendRequest): Promise<SettleOutcome> {
  if (request.idempotencyKey) {
    const existing = await tx.getIdempotent(request.idempotencyKey);
    if (existing) return { status: "duplicate", transactionId: existing };
  }

  const budget = await tx.getAccount(request.budgetAccountId);
  if (!budget) throw new Error(`unknown budget account: ${request.budgetAccountId}`);
  const vendor = await tx.getAccount(request.vendorAccountId);
  if (!vendor) throw new Error(`unknown vendor account: ${request.vendorAccountId}`);

  const transactionId = randomUUID();
  const deny = async (reason: string): Promise<SettleOutcome> => {
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
      vendorId: vendor.id,
      spentInWindow: (windowSeconds) => tx.spentInWindow(budget.id, windowSeconds),
    });
    if (verdict.decision !== "allow" && !(verdict.decision === "needs_approval" && request.approve)) {
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

  const binding = chain.find((a) => request.amountMicro > a.balanceMicro);
  if (binding) {
    return deny(binding.id === budget.id ? "cap_exceeded" : `${binding.type}_cap_exceeded`);
  }

  const debit = buildEntry({
    transactionId,
    account: budget,
    kind: "debit",
    amountMicro: -request.amountMicro,
    request,
  });
  const credit = buildEntry({
    transactionId,
    account: vendor,
    kind: "credit",
    amountMicro: request.amountMicro,
    request,
  });

  await tx.insertEntry(debit);
  await tx.insertEntry(credit);
  await tx.updateAccount(budget.id, budget.balanceMicro - request.amountMicro, debit.hash);
  await tx.updateAccount(vendor.id, vendor.balanceMicro + request.amountMicro, credit.hash);

  for (const ancestor of ancestors) {
    await tx.updateAccount(ancestor.id, ancestor.balanceMicro - request.amountMicro, ancestor.lastEntryHash);
  }

  if (request.idempotencyKey) {
    await tx.putIdempotent(request.idempotencyKey, transactionId);
  }

  return { status: "committed", transactionId };
}

export interface EntryAttribution {
  agentId?: string | null;
  sessionId?: string | null;
  userId?: string | null;
  intent?: string | null;
  costCenter?: string | null;
  receipt?: unknown;
}

export function buildEntry(args: {
  transactionId: string;
  account: { id: string; lastEntryHash: string };
  kind: "debit" | "credit";
  amountMicro: bigint;
  request: EntryAttribution;
}): Entry {
  const id = randomUUID();
  const prevHash = args.account.lastEntryHash || GENESIS_HASH;
  const fields = {
    id,
    transactionId: args.transactionId,
    accountId: args.account.id,
    kind: args.kind,
    amountMicro: args.amountMicro,
    agentId: args.request.agentId ?? null,
    sessionId: args.request.sessionId ?? null,
    userId: args.request.userId ?? null,
    intent: args.request.intent ?? null,
    costCenter: args.request.costCenter ?? null,
    receipt: args.request.receipt ?? null,
  };
  return { ...fields, prevHash, hash: hashEntry(prevHash, fields) };
}

export async function backoff(attempt: number): Promise<void> {
  const jitter = Math.min(attempt * 2, 25);
  await new Promise((resolve) => setTimeout(resolve, jitter));
}
