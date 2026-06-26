import { describe, expect, it } from "vitest";
import { MemStore } from "@/core/mem-store";
import { spend, type SpendResult } from "@/core/ledger";
import { verifyChain } from "@/core/audit";
import { GENESIS_HASH } from "@/core/hash";
import type { Account } from "@/core/store";

const USD = 1_000_000n;

function budget(balanceMicro: bigint): Account {
  return {
    id: "budget",
    type: "agent",
    parentId: null,
    name: "agent-budget",
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

describe("invariant: a near-empty budget cannot be overspent under concurrency", () => {
  it("commits exactly what fits, denies the rest, never goes negative", async () => {
    const cap = 1n * USD; // $1.00
    const price = 300_000n; // $0.30 → at most 3 spends fit
    const writers = 10;
    const affordable = Number(cap / price); // 3

    const store = new MemStore();
    store.seedAccount(budget(cap));
    store.seedAccount(vendor());

    // Force every writer to take its snapshot before any of them commit — this is the
    // cross-region race the demo is built on. Without OCC, all 10 would read "$1.00 left"
    // and overspend to -$2.00 (DynamoDB last-writer-wins). With it, the losers get 40001.
    store.arm(writers);

    const results = await Promise.all(
      Array.from({ length: writers }, (_, i) =>
        spend(store, {
          budgetAccountId: "budget",
          vendorAccountId: "vendor",
          amountMicro: price,
          agentId: `agent-${i}`,
          intent: "buy data",
          receipt: { x402: { amount: price.toString() } },
        }),
      ),
    );

    const committed = results.filter((r) => r.status === "committed");
    const denied = results.filter((r) => r.status === "denied");
    const finalBudget = store.getAccount("budget")!;
    const finalVendor = store.getAccount("vendor")!;

    // The whole product in assertions:
    expect(committed).toHaveLength(affordable);
    expect(denied).toHaveLength(writers - affordable);
    expect(finalBudget.balanceMicro).toBe(cap - price * BigInt(affordable));
    expect(finalBudget.balanceMicro).toBeGreaterThanOrEqual(0n); // never negative
    expect(finalBudget.balanceMicro).toBeLessThanOrEqual(cap); // never exceeds cap
    expect(finalVendor.balanceMicro).toBe(price * BigInt(affordable));

    // OCC actually fired — the invariant was enforced by conflicts, not luck.
    const totalConflicts = results.reduce((sum, r) => sum + r.conflicts, 0);
    expect(totalConflicts).toBeGreaterThan(0);

    // Double-entry holds: every signed amount sums to zero.
    const sum = store.entries.reduce((acc, e) => acc + e.amountMicro, 0n);
    expect(sum).toBe(0n);
    expect(store.entries).toHaveLength(affordable * 2);
    expect(store.denials).toHaveLength(writers - affordable);

    // Ledger is tamper-evident: the hash chain verifies clean.
    expect(verifyChain(store.entries)).toEqual([]);
  });

  it("a single writer that exactly drains the cap leaves a zero balance, no denials", async () => {
    const store = new MemStore();
    store.seedAccount(budget(2n * USD));
    store.seedAccount(vendor());

    const results: SpendResult[] = [];
    for (let i = 0; i < 2; i += 1) {
      results.push(
        await spend(store, {
          budgetAccountId: "budget",
          vendorAccountId: "vendor",
          amountMicro: 1n * USD,
        }),
      );
    }

    expect(results.every((r) => r.status === "committed")).toBe(true);
    expect(store.getAccount("budget")!.balanceMicro).toBe(0n);
  });
});
