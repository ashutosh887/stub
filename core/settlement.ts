import { randomUUID } from "node:crypto";
import { DEFAULT_MAX_RETRIES, buildEntry, runOcc, type SpendRequest } from "./ledger";
import { evaluatePolicies } from "./policy";
import type { Store, Tx } from "./store";

export type ReserveStatus = "reserved" | "denied" | "duplicate" | "needs_approval";
export type SettleStatus = "settled" | "duplicate" | "not_found" | "invalid";
export type ReleaseStatus = "released" | "duplicate" | "not_found" | "invalid";

export interface ReserveResult {
  status: ReserveStatus;
  reservationId: string;
  reason?: string;
  conflicts: number;
  attempts: number;
}

export interface SettleResult {
  status: SettleStatus;
  reservationId: string;
  transactionId: string | null;
  settledMicro: bigint;
  refundMicro: bigint;
  reason?: string;
  conflicts: number;
  attempts: number;
}

export interface ReleaseResult {
  status: ReleaseStatus;
  reservationId: string;
  refundMicro: bigint;
  reason?: string;
  conflicts: number;
  attempts: number;
}

export interface SettlementOptions {
  maxRetries?: number;
}

export interface SettleOptions extends SettlementOptions {
  actualMicro?: bigint;
}

export async function reserve(
  store: Store,
  request: SpendRequest,
  options: SettlementOptions = {},
): Promise<ReserveResult> {
  if (request.amountMicro <= 0n) throw new Error("amountMicro must be positive");
  const { result, conflicts, attempts } = await runOcc(
    store,
    (tx) => reserveTx(tx, request),
    options.maxRetries ?? DEFAULT_MAX_RETRIES,
  );
  return { ...result, conflicts, attempts };
}

export async function settle(
  store: Store,
  reservationId: string,
  options: SettleOptions = {},
): Promise<SettleResult> {
  const { result, conflicts, attempts } = await runOcc(
    store,
    (tx) => settleTx(tx, reservationId, options.actualMicro),
    options.maxRetries ?? DEFAULT_MAX_RETRIES,
  );
  return { ...result, conflicts, attempts };
}

export async function release(
  store: Store,
  reservationId: string,
  options: SettlementOptions = {},
): Promise<ReleaseResult> {
  const { result, conflicts, attempts } = await runOcc(
    store,
    (tx) => releaseTx(tx, reservationId),
    options.maxRetries ?? DEFAULT_MAX_RETRIES,
  );
  return { ...result, conflicts, attempts };
}

type ReserveOutcome = Omit<ReserveResult, "conflicts" | "attempts">;
type SettleOutcome = Omit<SettleResult, "conflicts" | "attempts">;
type ReleaseOutcome = Omit<ReleaseResult, "conflicts" | "attempts">;

async function reserveTx(tx: Tx, request: SpendRequest): Promise<ReserveOutcome> {
  if (request.idempotencyKey) {
    const existing = await tx.getIdempotent(request.idempotencyKey);
    if (existing) return { status: "duplicate", reservationId: existing };
  }

  const budget = await tx.getAccount(request.budgetAccountId);
  if (!budget) throw new Error(`unknown budget account: ${request.budgetAccountId}`);
  const vendor = await tx.getAccount(request.vendorAccountId);
  if (!vendor) throw new Error(`unknown vendor account: ${request.vendorAccountId}`);

  const reservationId = randomUUID();
  const deny = async (reason: string): Promise<ReserveOutcome> => {
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
    return { status: "denied", reservationId, reason };
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

  const binding = chain.find((a) => request.amountMicro > a.balanceMicro);
  if (binding) {
    return deny(binding.id === budget.id ? "cap_exceeded" : `${binding.type}_cap_exceeded`);
  }

  await tx.updateAccount(
    budget.id,
    budget.balanceMicro - request.amountMicro,
    budget.lastEntryHash,
  );
  for (const ancestor of ancestors) {
    await tx.updateAccount(
      ancestor.id,
      ancestor.balanceMicro - request.amountMicro,
      ancestor.lastEntryHash,
    );
  }

  await tx.insertReservation({
    id: reservationId,
    budgetAccountId: budget.id,
    vendorAccountId: vendor.id,
    heldMicro: request.amountMicro,
    settledMicro: null,
    status: "held",
    transactionId: null,
    agentId: request.agentId ?? null,
    sessionId: request.sessionId ?? null,
    userId: request.userId ?? null,
    intent: request.intent ?? null,
    costCenter: request.costCenter ?? null,
    receipt: request.receipt ?? null,
  });

  if (request.idempotencyKey) await tx.putIdempotent(request.idempotencyKey, reservationId);

  return { status: "reserved", reservationId };
}

async function settleTx(
  tx: Tx,
  reservationId: string,
  actualMicro?: bigint,
): Promise<SettleOutcome> {
  const reservation = await tx.getReservation(reservationId);
  if (!reservation) {
    return {
      status: "not_found",
      reservationId,
      transactionId: null,
      settledMicro: 0n,
      refundMicro: 0n,
    };
  }
  if (reservation.status === "settled") {
    return {
      status: "duplicate",
      reservationId,
      transactionId: reservation.transactionId,
      settledMicro: reservation.settledMicro ?? 0n,
      refundMicro: 0n,
    };
  }
  if (reservation.status === "released") {
    return {
      status: "invalid",
      reservationId,
      transactionId: null,
      settledMicro: 0n,
      refundMicro: 0n,
      reason: "already_released",
    };
  }

  const actual = actualMicro ?? reservation.heldMicro;
  if (actual <= 0n) {
    return {
      status: "invalid",
      reservationId,
      transactionId: null,
      settledMicro: 0n,
      refundMicro: 0n,
      reason: "non_positive_amount",
    };
  }
  if (actual > reservation.heldMicro) {
    return {
      status: "invalid",
      reservationId,
      transactionId: null,
      settledMicro: 0n,
      refundMicro: 0n,
      reason: "exceeds_hold",
    };
  }

  const budget = await tx.getAccount(reservation.budgetAccountId);
  if (!budget) throw new Error(`unknown budget account: ${reservation.budgetAccountId}`);
  const vendor = await tx.getAccount(reservation.vendorAccountId);
  if (!vendor) throw new Error(`unknown vendor account: ${reservation.vendorAccountId}`);

  const transactionId = randomUUID();
  const attribution = {
    agentId: reservation.agentId,
    sessionId: reservation.sessionId,
    userId: reservation.userId,
    intent: reservation.intent,
    costCenter: reservation.costCenter,
    receipt: reservation.receipt,
  };
  const debit = buildEntry({
    transactionId,
    account: budget,
    kind: "debit",
    amountMicro: -actual,
    request: attribution,
  });
  const credit = buildEntry({
    transactionId,
    account: vendor,
    kind: "credit",
    amountMicro: actual,
    request: attribution,
  });

  const refund = reservation.heldMicro - actual;

  await tx.insertEntry(debit);
  await tx.insertEntry(credit);
  await tx.updateAccount(budget.id, budget.balanceMicro + refund, debit.hash);
  await tx.updateAccount(vendor.id, vendor.balanceMicro + actual, credit.hash);

  const ancestors = await tx.getAncestors(budget.id);
  for (const ancestor of ancestors) {
    await tx.updateAccount(ancestor.id, ancestor.balanceMicro + refund, ancestor.lastEntryHash);
  }

  await tx.updateReservation(reservationId, {
    status: "settled",
    settledMicro: actual,
    transactionId,
  });

  return {
    status: "settled",
    reservationId,
    transactionId,
    settledMicro: actual,
    refundMicro: refund,
  };
}

async function releaseTx(tx: Tx, reservationId: string): Promise<ReleaseOutcome> {
  const reservation = await tx.getReservation(reservationId);
  if (!reservation) return { status: "not_found", reservationId, refundMicro: 0n };
  if (reservation.status === "released")
    return { status: "duplicate", reservationId, refundMicro: 0n };
  if (reservation.status === "settled") {
    return { status: "invalid", reservationId, refundMicro: 0n, reason: "already_settled" };
  }

  const budget = await tx.getAccount(reservation.budgetAccountId);
  if (!budget) throw new Error(`unknown budget account: ${reservation.budgetAccountId}`);

  await tx.updateAccount(
    budget.id,
    budget.balanceMicro + reservation.heldMicro,
    budget.lastEntryHash,
  );
  const ancestors = await tx.getAncestors(budget.id);
  for (const ancestor of ancestors) {
    await tx.updateAccount(
      ancestor.id,
      ancestor.balanceMicro + reservation.heldMicro,
      ancestor.lastEntryHash,
    );
  }

  await tx.updateReservation(reservationId, { status: "released" });

  return { status: "released", reservationId, refundMicro: reservation.heldMicro };
}
