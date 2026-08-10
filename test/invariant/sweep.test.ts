import { describe, expect, it } from "vitest";
import { MemStore } from "@/core/mem-store";
import { reserve, settle, sweepExpiredReservations } from "@/core/settlement";
import { GENESIS_HASH } from "@/core/hash";
import type { Account } from "@/core/store";

const USD = 1_000_000n;

function budget(balanceMicro: bigint): Account {
  return {
    id: "budget",
    type: "agent",
    parentId: "team",
    name: "agent-budget",
    balanceMicro,
    capMicro: balanceMicro,
    lastEntryHash: GENESIS_HASH,
  };
}

function team(balanceMicro: bigint): Account {
  return {
    id: "team",
    type: "team",
    parentId: null,
    name: "team-budget",
    balanceMicro,
    capMicro: balanceMicro,
    lastEntryHash: GENESIS_HASH,
  };
}

function vendor(): Account {
  return {
    id: "vendor",
    type: "vendor",
    parentId: null,
    name: "data-api",
    balanceMicro: 0n,
    capMicro: null,
    lastEntryHash: GENESIS_HASH,
  };
}

function seed(balance: bigint): MemStore {
  const store = new MemStore();
  store.seedAccount(team(balance));
  store.seedAccount(budget(balance));
  store.seedAccount(vendor());
  return store;
}

describe("sweepExpiredReservations reclaims crashed holds", () => {
  it("leaves a reservation alone before it reaches the TTL", async () => {
    const store = seed(5n * USD);
    await reserve(store, {
      budgetAccountId: "budget",
      vendorAccountId: "vendor",
      amountMicro: 2n * USD,
    });

    const results = await sweepExpiredReservations(store, 1_000_000);
    expect(results).toHaveLength(0);
    expect(store.getAccount("budget")!.balanceMicro).toBe(3n * USD);
    expect(store.heldReservationCount()).toBe(1);
  });

  it("releases a hold past its TTL and refunds it up the hierarchy", async () => {
    const store = seed(5n * USD);
    await reserve(store, {
      budgetAccountId: "budget",
      vendorAccountId: "vendor",
      amountMicro: 2n * USD,
    });

    const future = new Date(Date.now() + 1000);
    const results = await sweepExpiredReservations(store, 0, { now: future });

    expect(results).toHaveLength(1);
    expect(results[0].status).toBe("released");
    expect(results[0].refundMicro).toBe(2n * USD);
    expect(store.getAccount("budget")!.balanceMicro).toBe(5n * USD);
    expect(store.getAccount("team")!.balanceMicro).toBe(5n * USD);
    expect(store.heldReservationCount()).toBe(0);
  });

  it("sweeping twice never double-releases (idempotent)", async () => {
    const store = seed(5n * USD);
    await reserve(store, {
      budgetAccountId: "budget",
      vendorAccountId: "vendor",
      amountMicro: 2n * USD,
    });

    const future = new Date(Date.now() + 1000);
    const first = await sweepExpiredReservations(store, 0, { now: future });
    const second = await sweepExpiredReservations(store, 0, { now: future });

    expect(first).toHaveLength(1);
    expect(first[0].status).toBe("released");
    expect(second).toHaveLength(0);
    expect(store.getAccount("budget")!.balanceMicro).toBe(5n * USD);
  });

  it("exactly-once: a sweep racing a concurrent settle never double-books or double-refunds", async () => {
    const store = seed(5n * USD);
    const reserved = await reserve(store, {
      budgetAccountId: "budget",
      vendorAccountId: "vendor",
      amountMicro: 2n * USD,
    });

    const future = new Date(Date.now() + 1000);
    store.arm(2);
    const [settled, sweepResults] = await Promise.all([
      settle(store, reserved.reservationId, { actualMicro: 2n * USD }),
      sweepExpiredReservations(store, 0, { now: future }),
    ]);
    const swept = sweepResults[0];

    const settleWon = settled.status === "settled";
    const sweepWon = swept.status === "released";
    expect(settleWon).toBe(!sweepWon);

    if (settleWon) {
      expect(swept.status).toBe("invalid");
      expect(store.getAccount("vendor")!.balanceMicro).toBe(2n * USD);
      expect(store.getAccount("budget")!.balanceMicro).toBe(3n * USD);
      expect(store.entries).toHaveLength(2);
    } else {
      expect(settled.status).toBe("invalid");
      expect(store.getAccount("vendor")!.balanceMicro).toBe(0n);
      expect(store.getAccount("budget")!.balanceMicro).toBe(5n * USD);
      expect(store.entries).toHaveLength(0);
    }
    expect(store.heldReservationCount()).toBe(0);
  });
});
