import { describe, expect, it } from "vitest";
import { MemStore } from "@/core/mem-store";
import { reserve, settle, release } from "@/core/settlement";
import { verifyChain } from "@/core/audit";
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

describe("settlement: reserve → settle holds funds then books actual cost", () => {
  it("holds the estimate on reserve and refunds the difference on settle", async () => {
    const store = seed(10n * USD);
    const reserved = await reserve(store, {
      budgetAccountId: "budget",
      vendorAccountId: "vendor",
      amountMicro: 4n * USD,
      intent: "llm call (estimated)",
    });
    expect(reserved.status).toBe("reserved");

    // The hold is real: balance reflects the held estimate before any spend is booked.
    expect(store.getAccount("budget")!.balanceMicro).toBe(6n * USD);
    expect(store.getAccount("team")!.balanceMicro).toBe(6n * USD);
    expect(store.getAccount("vendor")!.balanceMicro).toBe(0n);
    expect(store.entries).toHaveLength(0);

    // Actual cost came in lower — settle books $2.50 and refunds $1.50.
    const settled = await settle(store, reserved.reservationId, { actualMicro: 2_500_000n });
    expect(settled.status).toBe("settled");
    expect(settled.settledMicro).toBe(2_500_000n);
    expect(settled.refundMicro).toBe(1_500_000n);

    expect(store.getAccount("budget")!.balanceMicro).toBe(10n * USD - 2_500_000n);
    expect(store.getAccount("team")!.balanceMicro).toBe(10n * USD - 2_500_000n);
    expect(store.getAccount("vendor")!.balanceMicro).toBe(2_500_000n);

    // Double-entry holds and the chain verifies.
    const sum = store.entries.reduce((acc, e) => acc + e.amountMicro, 0n);
    expect(sum).toBe(0n);
    expect(store.entries).toHaveLength(2);
    expect(verifyChain(store.entries)).toEqual([]);
  });

  it("release returns the full hold and books nothing", async () => {
    const store = seed(5n * USD);
    const reserved = await reserve(store, {
      budgetAccountId: "budget",
      vendorAccountId: "vendor",
      amountMicro: 2n * USD,
    });
    const released = await release(store, reserved.reservationId);
    expect(released.status).toBe("released");
    expect(released.refundMicro).toBe(2n * USD);
    expect(store.getAccount("budget")!.balanceMicro).toBe(5n * USD);
    expect(store.entries).toHaveLength(0);
  });

  it("denies a reservation that exceeds the cap, books nothing", async () => {
    const store = seed(1n * USD);
    const reserved = await reserve(store, {
      budgetAccountId: "budget",
      vendorAccountId: "vendor",
      amountMicro: 2n * USD,
    });
    expect(reserved.status).toBe("denied");
    expect(reserved.reason).toBe("cap_exceeded");
    expect(store.getAccount("budget")!.balanceMicro).toBe(1n * USD);
    expect(store.denials).toHaveLength(1);
  });

  it("exactly-once: concurrent settles of one reservation book the spend once", async () => {
    const store = seed(10n * USD);
    const reserved = await reserve(store, {
      budgetAccountId: "budget",
      vendorAccountId: "vendor",
      amountMicro: 3n * USD,
    });

    store.arm(5);
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        settle(store, reserved.reservationId, { actualMicro: 3n * USD }),
      ),
    );

    const settledOnce = results.filter((r) => r.status === "settled");
    const duplicates = results.filter((r) => r.status === "duplicate");
    expect(settledOnce).toHaveLength(1);
    expect(duplicates).toHaveLength(4);

    // The vendor was paid exactly once, the chain has exactly one debit/credit pair.
    expect(store.getAccount("vendor")!.balanceMicro).toBe(3n * USD);
    expect(store.getAccount("budget")!.balanceMicro).toBe(7n * USD);
    expect(store.entries).toHaveLength(2);

    // OCC actually fired — exactly-once was enforced by conflicts, not ordering luck.
    const conflicts = results.reduce((sum, r) => sum + r.conflicts, 0);
    expect(conflicts).toBeGreaterThan(0);
  });

  it("cannot settle a released hold, cannot release a settled one", async () => {
    const store = seed(5n * USD);
    const a = await reserve(store, { budgetAccountId: "budget", vendorAccountId: "vendor", amountMicro: 1n * USD });
    await release(store, a.reservationId);
    const lateSettle = await settle(store, a.reservationId);
    expect(lateSettle.status).toBe("invalid");

    const b = await reserve(store, { budgetAccountId: "budget", vendorAccountId: "vendor", amountMicro: 1n * USD });
    await settle(store, b.reservationId);
    const lateRelease = await release(store, b.reservationId);
    expect(lateRelease.status).toBe("invalid");
  });
});
