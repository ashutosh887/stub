import { describe, expect, it } from "vitest";
import { MemStore } from "@/core/mem-store";
import { spend } from "@/core/ledger";
import { reserve } from "@/core/settlement";
import { provisionShards, shardBalance, shardedSpend } from "@/core/sharded";
import { verifyChain } from "@/core/audit";
import { GENESIS_HASH } from "@/core/hash";
import type { Account } from "@/core/store";

const USD = 1_000_000n;

function world(): MemStore {
  const store = new MemStore();
  const budget: Account = {
    id: "budget",
    type: "agent",
    parentId: null,
    name: "agent-budget",
    balanceMicro: 10n * USD,
    capMicro: 10n * USD,
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

describe("ledger: single spend correctness", () => {
  it("writes exactly two summed-to-zero entries and moves the balance", async () => {
    const store = world();
    const result = await spend(store, {
      budgetAccountId: "budget",
      vendorAccountId: "vendor",
      amountMicro: 3n * USD,
    });

    expect(result.status).toBe("committed");
    expect(store.entries).toHaveLength(2);
    expect(store.entries.reduce((acc, e) => acc + e.amountMicro, 0n)).toBe(0n);
    expect(store.getAccount("budget")!.balanceMicro).toBe(7n * USD);
    expect(store.getAccount("vendor")!.balanceMicro).toBe(3n * USD);
  });

  it("denies a spend over the cap and records an immutable denial", async () => {
    const store = world();
    const result = await spend(store, {
      budgetAccountId: "budget",
      vendorAccountId: "vendor",
      amountMicro: 11n * USD,
    });

    expect(result.status).toBe("denied");
    expect(result.reason).toBe("cap_exceeded");
    expect(store.entries).toHaveLength(0);
    expect(store.denials).toHaveLength(1);
    expect(store.getAccount("budget")!.balanceMicro).toBe(10n * USD);
  });

  it("idempotency key makes a retried request a no-op duplicate", async () => {
    const store = world();
    const req = {
      budgetAccountId: "budget",
      vendorAccountId: "vendor",
      amountMicro: 2n * USD,
      idempotencyKey: "charge-123",
    };

    const first = await spend(store, req);
    const second = await spend(store, req);

    expect(first.status).toBe("committed");
    expect(second.status).toBe("duplicate");
    expect(second.transactionId).toBe(first.transactionId);
    expect(store.entries).toHaveLength(2); // not 4: charged once
    expect(store.getAccount("budget")!.balanceMicro).toBe(8n * USD);
  });

  it("detects tampering: mutating a committed entry breaks the chain", async () => {
    const store = world();
    await spend(store, {
      budgetAccountId: "budget",
      vendorAccountId: "vendor",
      amountMicro: 1n * USD,
    });
    expect(verifyChain(store.entries)).toEqual([]);

    store.entries[0].amountMicro = -999n; // tamper
    expect(verifyChain(store.entries).length).toBeGreaterThan(0);
  });
});

describe("ledger: only a vendor account can be paid", () => {
  const paths = {
    spend: (store: MemStore, vendorAccountId: string) =>
      spend(store, { budgetAccountId: "budget", vendorAccountId, amountMicro: USD }),
    reserve: (store: MemStore, vendorAccountId: string) =>
      reserve(store, { budgetAccountId: "budget", vendorAccountId, amountMicro: USD }),
    shardedSpend: (store: MemStore, vendorAccountId: string) =>
      shardedSpend(store, { budgetAccountId: "budget", vendorAccountId, amountMicro: USD }),
  };

  it.each(Object.keys(paths) as (keyof typeof paths)[])(
    "%s denies paying itself, a peer agent, or an unknown account",
    async (path) => {
      const store = world();
      store.seedAccount({ ...store.getAccount("budget")!, id: "peer", name: "peer-agent" });
      if (path === "shardedSpend") await provisionShards(store, "budget", 10n * USD, 2);
      const budgetBalance = () =>
        path === "shardedSpend"
          ? shardBalance(store, "budget")
          : Promise.resolve(store.getAccount("budget")!.balanceMicro);

      const results = [];
      for (const payee of ["budget", "peer", "ghost"]) {
        results.push(await paths[path](store, payee));
      }

      expect(results.map((r) => [r.status, r.reason])).toEqual([
        ["denied", "payee_not_vendor"],
        ["denied", "payee_not_vendor"],
        ["denied", "unknown_vendor"],
      ]);
      expect(store.denials).toHaveLength(3);
      expect(store.entries).toHaveLength(0);
      expect(await budgetBalance()).toBe(10n * USD);
      expect(store.getAccount("peer")!.balanceMicro).toBe(10n * USD);
    },
  );
});
