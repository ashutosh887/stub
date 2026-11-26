import { describe, expect, it } from "vitest";
import { MemStore } from "@/core/mem-store";
import { GENESIS_HASH } from "@/core/hash";
import { verifyChain } from "@/core/audit";
import {
  provisionShards,
  shardBalance,
  shardedSpend,
  shardExistingAccount,
  spendAuto,
} from "@/core/sharded";
import type { Account } from "@/core/store";
import type { Policy } from "@/core/policy";

const USD = 1_000_000n;

function account(id: string, name: string, balanceMicro: bigint): Account {
  return {
    id,
    type: "agent",
    parentId: null,
    name,
    balanceMicro,
    capMicro: balanceMicro,
    lastEntryHash: GENESIS_HASH,
  };
}

async function sharded(budgetMicro: bigint, shards: number) {
  const store = new MemStore();
  store.seedAccount(account("budget", "sharded-budget", budgetMicro));
  store.seedAccount({ ...account("vendor", "vendor", 0n), type: "vendor", capMicro: null });
  await provisionShards(store, "budget", budgetMicro, shards);
  await provisionShards(store, "vendor", 0n, shards);
  return store;
}

describe("sharded balances", () => {
  it("splits a balance evenly and preserves the total", async () => {
    const store = await sharded(10n * USD, 4);
    expect(store.shardBalances("budget")).toEqual([
      2n * USD + 500_000n,
      2n * USD + 500_000n,
      2n * USD + 500_000n,
      2n * USD + 500_000n,
    ]);
    expect(await shardBalance(store, "budget")).toBe(10n * USD);
  });

  it("splits an indivisible balance without losing or inventing a micro-dollar", async () => {
    const store = await sharded(10n, 3);
    expect(store.shardBalances("budget")).toEqual([4n, 3n, 3n]);
    expect(await shardBalance(store, "budget")).toBe(10n);
  });

  it("cannot be overspent by concurrent writers", async () => {
    const shards = 8;
    const affordable = 5;
    const writers = 20;
    const store = await sharded(BigInt(affordable) * USD, shards);

    store.arm(writers);
    const results = await Promise.all(
      Array.from({ length: writers }, (_, i) =>
        shardedSpend(
          store,
          {
            budgetAccountId: "budget",
            vendorAccountId: "vendor",
            amountMicro: USD,
            agentId: `agent-${i}`,
            intent: "sharded spend",
          },
          { shards, maxRetries: 200 },
        ),
      ),
    );

    const committed = results.filter((r) => r.status === "committed").length;
    const balances = store.shardBalances("budget");

    expect(committed).toBe(affordable);
    expect(balances.every((b) => b >= 0n)).toBe(true);
    expect(await shardBalance(store, "budget")).toBe(0n);
    expect(await shardBalance(store, "vendor")).toBe(BigInt(affordable) * USD);
  });

  it("borrows across shards rather than falsely denying a spend that fits", async () => {
    const store = await sharded(4n * USD, 4);

    const result = await shardedSpend(
      store,
      {
        budgetAccountId: "budget",
        vendorAccountId: "vendor",
        amountMicro: 4n * USD,
        intent: "whole budget in one call",
      },
      { shards: 4, pickShard: () => 0 },
    );

    expect(result.status).toBe("committed");
    expect(await shardBalance(store, "budget")).toBe(0n);
    expect(store.shardBalances("budget")).toEqual([0n, 0n, 0n, 0n]);
  });

  it("denies when the total across every shard is short", async () => {
    const store = await sharded(2n * USD, 4);
    const result = await shardedSpend(
      store,
      {
        budgetAccountId: "budget",
        vendorAccountId: "vendor",
        amountMicro: 3n * USD,
        intent: "too big",
      },
      { shards: 4 },
    );

    expect(result.status).toBe("denied");
    expect(result.reason).toBe("cap_exceeded");
    expect(await shardBalance(store, "budget")).toBe(2n * USD);
    expect(store.denials).toHaveLength(1);
  });

  it("keeps a verifiable hash chain per shard and nets double entry to zero", async () => {
    const store = await sharded(6n * USD, 3);

    for (let i = 0; i < 6; i++) {
      await shardedSpend(
        store,
        {
          budgetAccountId: "budget",
          vendorAccountId: "vendor",
          amountMicro: USD,
          intent: `spend-${i}`,
        },
        { shards: 3 },
      );
    }

    const sum = store.entries.reduce((acc, e) => acc + e.amountMicro, 0n);
    expect(sum).toBe(0n);
    expect(verifyChain(store.entries)).toEqual([]);
  });

  it("honours idempotency keys so a retry cannot double-charge", async () => {
    const store = await sharded(5n * USD, 4);

    const first = await shardedSpend(
      store,
      {
        budgetAccountId: "budget",
        vendorAccountId: "vendor",
        amountMicro: USD,
        idempotencyKey: "same-key",
      },
      { shards: 4 },
    );
    const second = await shardedSpend(
      store,
      {
        budgetAccountId: "budget",
        vendorAccountId: "vendor",
        amountMicro: USD,
        idempotencyKey: "same-key",
      },
      { shards: 4 },
    );

    expect(first.status).toBe("committed");
    expect(second.status).toBe("duplicate");
    expect(await shardBalance(store, "budget")).toBe(4n * USD);
  });
});

function acct(over: Partial<Account> & Pick<Account, "id" | "type">): Account {
  return {
    parentId: null,
    name: over.id,
    balanceMicro: 0n,
    capMicro: null,
    lastEntryHash: GENESIS_HASH,
    ...over,
  };
}

function policy(p: Partial<Policy>): Policy {
  return {
    id: "p",
    accountId: "agent",
    label: "rule",
    enabled: true,
    limitMicro: null,
    windowSeconds: null,
    vendorAllow: null,
    vendorBlock: null,
    approvalThresholdMicro: null,
    ...p,
  };
}

describe("sharded accounts enforce the same guardrails as unsharded ones", () => {
  it("denies with the binding ancestor's reason even though the sharded agent has room", async () => {
    const store = new MemStore();
    store.seedAccount(
      acct({ id: "org", type: "org", balanceMicro: 500n * USD, capMicro: 500n * USD }),
    );
    store.seedAccount(
      acct({
        id: "team",
        type: "team",
        parentId: "org",
        balanceMicro: 5n * USD,
        capMicro: 5n * USD,
      }),
    );
    store.seedAccount(
      acct({ id: "agent", type: "agent", parentId: "team", balanceMicro: 50n * USD }),
    );
    store.seedAccount(acct({ id: "vendor", type: "vendor" }));
    await provisionShards(store, "agent", 50n * USD, 4);
    await provisionShards(store, "vendor", 0n, 4);

    const result = await shardedSpend(
      store,
      { budgetAccountId: "agent", vendorAccountId: "vendor", amountMicro: 10n * USD },
      { shards: 4 },
    );

    expect(result.status).toBe("denied");
    expect(result.reason).toBe("team_cap_exceeded");
    expect(await shardBalance(store, "agent")).toBe(50n * USD);
  });

  it("rolls a committed sharded spend up every ancestor balance", async () => {
    const store = new MemStore();
    store.seedAccount(
      acct({ id: "org", type: "org", balanceMicro: 500n * USD, capMicro: 500n * USD }),
    );
    store.seedAccount(
      acct({
        id: "team",
        type: "team",
        parentId: "org",
        balanceMicro: 200n * USD,
        capMicro: 200n * USD,
      }),
    );
    store.seedAccount(
      acct({ id: "agent", type: "agent", parentId: "team", balanceMicro: 50n * USD }),
    );
    store.seedAccount(acct({ id: "vendor", type: "vendor" }));
    await provisionShards(store, "agent", 50n * USD, 4);
    await provisionShards(store, "vendor", 0n, 4);

    const result = await shardedSpend(
      store,
      { budgetAccountId: "agent", vendorAccountId: "vendor", amountMicro: 10n * USD },
      { shards: 4 },
    );

    expect(result.status).toBe("committed");
    expect(await shardBalance(store, "agent")).toBe(40n * USD);
    expect(store.getAccount("team")!.balanceMicro).toBe(190n * USD);
    expect(store.getAccount("org")!.balanceMicro).toBe(490n * USD);
  });

  it("a frozen ancestor cascades to a sharded agent", async () => {
    const store = new MemStore();
    store.seedAccount(acct({ id: "org", type: "org", balanceMicro: 500n * USD }));
    store.seedAccount(
      acct({ id: "agent", type: "agent", parentId: "org", balanceMicro: 50n * USD }),
    );
    store.seedAccount(acct({ id: "vendor", type: "vendor" }));
    await provisionShards(store, "agent", 50n * USD, 4);
    await provisionShards(store, "vendor", 0n, 4);
    await store.transaction((tx) => tx.setFrozen("org", true));

    const result = await shardedSpend(
      store,
      { budgetAccountId: "agent", vendorAccountId: "vendor", amountMicro: 1n * USD },
      { shards: 4 },
    );

    expect(result.status).toBe("denied");
    expect(result.reason).toBe("account_frozen");
  });

  it("denies a policy violation (vendor block) before touching any shard", async () => {
    const store = new MemStore();
    store.seedAccount(acct({ id: "agent", type: "agent", balanceMicro: 10n * USD }));
    store.seedAccount(acct({ id: "vendor", type: "vendor" }));
    store.seedPolicy(policy({ accountId: "agent", vendorBlock: ["vendor"] }));
    await provisionShards(store, "agent", 10n * USD, 4);
    await provisionShards(store, "vendor", 0n, 4);

    const result = await shardedSpend(
      store,
      { budgetAccountId: "agent", vendorAccountId: "vendor", amountMicro: 1n * USD },
      { shards: 4 },
    );

    expect(result.status).toBe("denied");
    expect(result.reason).toBe("vendor_blocked");
    expect(await shardBalance(store, "agent")).toBe(10n * USD);
  });

  it("the velocity breaker trips on a sharded account and then freezes it", async () => {
    const store = new MemStore();
    store.seedAccount(
      acct({
        id: "agent",
        type: "agent",
        balanceMicro: 100n * USD,
        velocityLimitMicro: 5n * USD,
        velocityWindowSeconds: 60,
      }),
    );
    store.seedAccount(acct({ id: "vendor", type: "vendor" }));
    await provisionShards(store, "agent", 100n * USD, 4);
    await provisionShards(store, "vendor", 0n, 4);

    const spendOnce = () =>
      shardedSpend(
        store,
        { budgetAccountId: "agent", vendorAccountId: "vendor", amountMicro: 2n * USD },
        { shards: 4 },
      );

    expect((await spendOnce()).status).toBe("committed");
    expect((await spendOnce()).status).toBe("committed");
    const tripped = await spendOnce();
    expect(tripped.status).toBe("denied");
    expect(tripped.reason).toBe("velocity_tripped");

    expect(store.getAccount("agent")!.frozen).toBe(true);
    const after = await spendOnce();
    expect(after.status).toBe("denied");
    expect(after.reason).toBe("account_frozen");
  });
});

describe("spendAuto dispatches on the account's sharded flag", () => {
  it("routes a sharded budget through shardedSpend", async () => {
    const store = new MemStore();
    store.seedAccount(acct({ id: "agent", type: "agent", balanceMicro: 5n * USD }));
    store.seedAccount(acct({ id: "vendor", type: "vendor" }));
    await provisionShards(store, "agent", 5n * USD);
    await provisionShards(store, "vendor", 0n);

    expect(store.getAccount("agent")!.sharded).toBe(true);

    const result = await spendAuto(store, {
      budgetAccountId: "agent",
      vendorAccountId: "vendor",
      amountMicro: 2n * USD,
    });

    expect(result.status).toBe("committed");
    expect(await shardBalance(store, "agent")).toBe(3n * USD);
  });

  it("routes an unsharded budget through the plain ledger path", async () => {
    const store = new MemStore();
    store.seedAccount(acct({ id: "agent", type: "agent", balanceMicro: 5n * USD }));
    store.seedAccount(acct({ id: "vendor", type: "vendor" }));

    expect(store.getAccount("agent")!.sharded).toBeFalsy();

    const result = await spendAuto(store, {
      budgetAccountId: "agent",
      vendorAccountId: "vendor",
      amountMicro: 2n * USD,
    });

    expect(result.status).toBe("committed");
    expect(store.getAccount("agent")!.balanceMicro).toBe(3n * USD);
  });
});

describe("shardExistingAccount provisions shards from an account's current balance", () => {
  it("splits the account's existing balance and flags it sharded", async () => {
    const store = new MemStore();
    store.seedAccount(acct({ id: "agent", type: "agent", balanceMicro: 8n * USD }));

    const result = await shardExistingAccount(store, "agent", 4);

    expect(result).toEqual({ accountId: "agent", shards: 4, totalMicro: 8n * USD });
    expect(store.getAccount("agent")!.sharded).toBe(true);
    expect(await shardBalance(store, "agent")).toBe(8n * USD);
  });

  it("refuses to re-provision an already-sharded account", async () => {
    const store = new MemStore();
    store.seedAccount(acct({ id: "agent", type: "agent", balanceMicro: 8n * USD }));
    await shardExistingAccount(store, "agent", 4);

    await expect(shardExistingAccount(store, "agent", 4)).rejects.toThrow(
      "account already sharded: agent",
    );
  });

  it("refuses an account with children, whose spends draw down its own row", async () => {
    const store = new MemStore();
    store.seedAccount(acct({ id: "team", type: "team", balanceMicro: 8n * USD }));
    store.seedAccount(
      acct({ id: "agent", type: "agent", parentId: "team", balanceMicro: 2n * USD }),
    );

    await expect(shardExistingAccount(store, "team", 4)).rejects.toThrow(
      "account has child accounts: team",
    );
    expect(store.getAccount("team")!.sharded).toBeFalsy();
    expect(store.shardBalances("team")).toEqual([]);
  });

  it("rejects an unknown account", async () => {
    const store = new MemStore();
    await expect(shardExistingAccount(store, "ghost", 4)).rejects.toThrow("unknown account: ghost");
  });
});
