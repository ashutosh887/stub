import { describe, expect, it } from "vitest";
import { spend } from "@/core/ledger";
import { MemStore } from "@/core/mem-store";
import { reserve } from "@/core/settlement";
import { GENESIS_HASH } from "@/core/hash";
import type { Account, Store } from "@/core/store";

const USD = 1_000_000n;

function account(id: string, type: Account["type"], balanceMicro: bigint, capMicro: bigint | null) {
  return {
    id,
    type,
    parentId: null,
    name: id,
    balanceMicro,
    capMicro,
    lastEntryHash: GENESIS_HASH,
  };
}

function seed(vendorCapMicro: bigint | null): MemStore {
  const store = new MemStore();
  store.seedAccount(account("budget", "agent", 10n * USD, 10n * USD));
  store.seedAccount(account("vendor", "vendor", 0n, vendorCapMicro));
  return store;
}

function refusingWrites(inner: Store): Store {
  return {
    listExpiredReservations: (olderThan) => inner.listExpiredReservations(olderThan),
    transaction: (fn) =>
      inner.transaction((tx) =>
        fn({
          ...tx,
          updateAccount: async () => {
            throw Object.assign(new Error("violates check constraint"), { code: "23514" });
          },
        }),
      ),
  };
}

const request = {
  budgetAccountId: "budget",
  vendorAccountId: "vendor",
  amountMicro: 2n * USD,
  agentId: "research-agent",
};

describe("a 23514 from the database is a recorded denial, not a 500", () => {
  it("spend: the app check passes, the vendor CHECK refuses the credit", async () => {
    const store = seed(1n * USD);
    const result = await spend(store, request);

    expect(result).toMatchObject({ status: "denied", reason: "db_refused", conflicts: 0 });
    expect(store.denials).toHaveLength(1);
    expect(store.denials[0]).toMatchObject({ reason: "db_refused", accountId: "budget" });
    expect(store.entries).toHaveLength(0);
    expect(store.getAccount("budget")?.balanceMicro).toBe(10n * USD);
    expect(store.getAccount("vendor")?.balanceMicro).toBe(0n);
  });

  it("reserve: a store-raised 23514 is terminal and leaves no hold", async () => {
    const store = seed(null);
    const result = await reserve(refusingWrites(store), request);

    expect(result).toMatchObject({ status: "denied", reason: "db_refused", attempts: 1 });
    expect(store.denials.map((d) => d.reason)).toEqual(["db_refused"]);
    expect(store.heldReservationCount()).toBe(0);
    expect(store.getAccount("budget")?.balanceMicro).toBe(10n * USD);
  });
});
