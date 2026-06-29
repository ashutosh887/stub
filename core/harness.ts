import { randomUUID } from "node:crypto";
import { MemStore } from "./mem-store";
import { buildEntry } from "./ledger";
import { reserve, settle } from "./settlement";
import { CountingGateway } from "./payment";
import { verifyChain } from "./audit";
import { GENESIS_HASH } from "./hash";
import { type Account, isConflict } from "./store";

export interface HarnessConfig {
  capMicro: bigint;
  amountMicro: bigint;
  writers: number;
  crashRate: number;
}

export interface ApproachResult {
  approach: "naive" | "stub";
  writers: number;
  committedSpends: number;
  paymentsAttempted: number;
  paymentsSent: number;
  chargedMicro: bigint;
  finalBalanceMicro: bigint;
  occConflicts: number;
  stuckHolds: number;
  overspend: boolean;
  doublePaid: boolean;
  chainOk: boolean;
  invariantsHold: boolean;
}

export interface HarnessReport {
  config: HarnessConfig;
  affordable: number;
  naive: ApproachResult;
  stub: ApproachResult;
}

function seed(capMicro: bigint): MemStore {
  const store = new MemStore();
  const budget: Account = {
    id: "budget",
    type: "agent",
    parentId: null,
    name: "agent-budget",
    balanceMicro: capMicro,
    capMicro,
    lastEntryHash: GENESIS_HASH,
  };
  const vendor: Account = {
    id: "vendor",
    type: "vendor",
    parentId: null,
    name: "data-api",
    balanceMicro: 0n,
    capMicro: null,
    lastEntryHash: GENESIS_HASH,
  };
  store.seedAccount(budget);
  store.seedAccount(vendor);
  return store;
}

async function naiveAttempt(
  store: MemStore,
  gateway: CountingGateway,
  amountMicro: bigint,
): Promise<{ status: "committed" | "denied"; conflicts: number }> {
  let conflicts = 0;
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await store.transaction(async (tx) => {
        const budget = await tx.getAccount("budget");
        const vendor = await tx.getAccount("vendor");
        if (!budget || !vendor) throw new Error("seed missing");
        if (amountMicro > budget.balanceMicro) {
          return { status: "denied" as const, conflicts };
        }
        const transactionId = randomUUID();
        await gateway.pay(randomUUID(), amountMicro);
        const debit = buildEntry({
          transactionId,
          account: budget,
          kind: "debit",
          amountMicro: -amountMicro,
          request: {},
        });
        const credit = buildEntry({
          transactionId,
          account: vendor,
          kind: "credit",
          amountMicro,
          request: {},
        });
        await tx.insertEntry(debit);
        await tx.insertEntry(credit);
        await tx.updateAccount(budget.id, budget.balanceMicro - amountMicro, debit.hash);
        await tx.updateAccount(vendor.id, vendor.balanceMicro + amountMicro, credit.hash);
        return { status: "committed" as const, conflicts };
      });
    } catch (err) {
      if (isConflict(err) && attempt <= 100) {
        conflicts += 1;
        continue;
      }
      throw err;
    }
  }
}

export async function runNaive(config: HarnessConfig): Promise<ApproachResult> {
  const store = seed(config.capMicro);
  const gateway = new CountingGateway();
  store.arm(config.writers);

  const results = await Promise.all(
    Array.from({ length: config.writers }, () => naiveAttempt(store, gateway, config.amountMicro)),
  );

  const committedSpends = results.filter((r) => r.status === "committed").length;
  const occConflicts = results.reduce((sum, r) => sum + r.conflicts, 0);
  const finalBalanceMicro = store.getAccount("budget")!.balanceMicro;

  return {
    approach: "naive",
    writers: config.writers,
    committedSpends,
    paymentsAttempted: gateway.attempts,
    paymentsSent: gateway.sent,
    chargedMicro: gateway.chargedMicro,
    finalBalanceMicro,
    occConflicts,
    stuckHolds: 0,
    overspend: finalBalanceMicro < 0n,
    doublePaid: gateway.sent > committedSpends,
    chainOk: verifyChain(store.entries).length === 0,
    invariantsHold:
      finalBalanceMicro >= 0n &&
      gateway.sent === committedSpends &&
      verifyChain(store.entries).length === 0,
  };
}

export async function runStub(config: HarnessConfig): Promise<ApproachResult> {
  const store = seed(config.capMicro);
  const gateway = new CountingGateway();
  store.arm(config.writers);

  const held: string[] = [];
  const results = await Promise.all(
    Array.from({ length: config.writers }, (_, i) =>
      stubAttempt(store, gateway, config.amountMicro, i / config.writers < config.crashRate),
    ),
  );

  for (const r of results) {
    if (r.heldId) held.push(r.heldId);
  }

  let conflicts = results.reduce((sum, r) => sum + r.conflicts, 0);

  for (const reservationId of held) {
    const swept = await settle(store, reservationId, { actualMicro: config.amountMicro });
    conflicts += swept.conflicts;
  }

  const committedSpends = countSettled(store);
  const finalBalanceMicro = store.getAccount("budget")!.balanceMicro;
  const stuckHolds = countHeld(store);

  return {
    approach: "stub",
    writers: config.writers,
    committedSpends,
    paymentsAttempted: gateway.attempts,
    paymentsSent: gateway.sent,
    chargedMicro: gateway.chargedMicro,
    finalBalanceMicro,
    occConflicts: conflicts,
    stuckHolds,
    overspend: finalBalanceMicro < 0n,
    doublePaid: gateway.sent > committedSpends,
    chainOk: verifyChain(store.entries).length === 0,
    invariantsHold:
      finalBalanceMicro >= 0n &&
      gateway.sent === committedSpends &&
      stuckHolds === 0 &&
      verifyChain(store.entries).length === 0,
  };
}

async function stubAttempt(
  store: MemStore,
  gateway: CountingGateway,
  amountMicro: bigint,
  crashAfterPay: boolean,
): Promise<{ status: string; conflicts: number; heldId?: string }> {
  const reserved = await reserve(store, {
    budgetAccountId: "budget",
    vendorAccountId: "vendor",
    amountMicro,
  });
  if (reserved.status !== "reserved")
    return { status: reserved.status, conflicts: reserved.conflicts };

  await gateway.pay(reserved.reservationId, amountMicro);

  if (crashAfterPay) {
    return { status: "crashed", conflicts: reserved.conflicts, heldId: reserved.reservationId };
  }

  const settled = await settle(store, reserved.reservationId, { actualMicro: amountMicro });
  return { status: settled.status, conflicts: reserved.conflicts + settled.conflicts };
}

function countSettled(store: MemStore): number {
  return store.entries.filter((e) => e.kind === "debit").length;
}

function countHeld(store: MemStore): number {
  return store.heldReservationCount();
}

export async function runHarness(config: HarnessConfig): Promise<HarnessReport> {
  const [naive, stub] = await Promise.all([runNaive(config), runStub(config)]);
  return {
    config,
    affordable: Number(config.capMicro / config.amountMicro),
    naive,
    stub,
  };
}
