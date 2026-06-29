import { describe, expect, it } from "vitest";
import { MemStore } from "@/core/mem-store";
import { spend } from "@/core/ledger";
import { GENESIS_HASH } from "@/core/hash";
import type { Account } from "@/core/store";

const USD = 1_000_000n;

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

// org → team → agent: the agent has room but the team is the tightest ceiling.
function seedTree(store: MemStore, opts: { org: bigint; team: bigint; agent: bigint }) {
  store.seedAccount(acct({ id: "org", type: "org", balanceMicro: opts.org, capMicro: opts.org }));
  store.seedAccount(
    acct({
      id: "team",
      type: "team",
      parentId: "org",
      balanceMicro: opts.team,
      capMicro: opts.team,
    }),
  );
  store.seedAccount(
    acct({
      id: "agent",
      type: "agent",
      parentId: "team",
      balanceMicro: opts.agent,
      capMicro: opts.agent,
    }),
  );
  store.seedAccount(acct({ id: "vendor", type: "vendor" }));
}

describe("invariant: a spend is bound by the tightest cap up the hierarchy", () => {
  it("denies with the binding ancestor's reason when an ancestor is the ceiling", async () => {
    const store = new MemStore();
    seedTree(store, { org: 500n * USD, team: 5n * USD, agent: 50n * USD });

    const result = await spend(store, {
      budgetAccountId: "agent",
      vendorAccountId: "vendor",
      amountMicro: 10n * USD, // fits the agent ($50) but not the team ($5)
    });

    expect(result.status).toBe("denied");
    expect(result.reason).toBe("team_cap_exceeded");
    expect(store.getAccount("agent")!.balanceMicro).toBe(50n * USD); // untouched
    expect(store.denials).toHaveLength(1);
  });

  it("rolls a committed spend up every ancestor balance", async () => {
    const store = new MemStore();
    seedTree(store, { org: 500n * USD, team: 200n * USD, agent: 50n * USD });

    const result = await spend(store, {
      budgetAccountId: "agent",
      vendorAccountId: "vendor",
      amountMicro: 10n * USD,
    });

    expect(result.status).toBe("committed");
    expect(store.getAccount("agent")!.balanceMicro).toBe(40n * USD);
    expect(store.getAccount("team")!.balanceMicro).toBe(190n * USD);
    expect(store.getAccount("org")!.balanceMicro).toBe(490n * USD);
  });

  it("a frozen ancestor (org kill-switch) cascades to every descendant agent", async () => {
    const store = new MemStore();
    seedTree(store, { org: 500n * USD, team: 200n * USD, agent: 50n * USD });
    await store.transaction((tx) => tx.setFrozen("org", true));

    const result = await spend(store, {
      budgetAccountId: "agent",
      vendorAccountId: "vendor",
      amountMicro: 1n * USD,
    });

    expect(result.status).toBe("denied");
    expect(result.reason).toBe("account_frozen");
  });

  it("the org budget can't be overspent by agents in different teams racing it", async () => {
    const store = new MemStore();
    // org has room for exactly 2 of these; each team/agent has ample local budget.
    store.seedAccount(acct({ id: "org", type: "org", balanceMicro: 2n * USD, capMicro: 2n * USD }));
    const vendors = acct({ id: "vendor", type: "vendor" });
    store.seedAccount(vendors);
    const agents: string[] = [];
    for (let t = 0; t < 6; t += 1) {
      store.seedAccount(
        acct({ id: `team${t}`, type: "team", parentId: "org", balanceMicro: 100n * USD }),
      );
      store.seedAccount(
        acct({ id: `agent${t}`, type: "agent", parentId: `team${t}`, balanceMicro: 100n * USD }),
      );
      agents.push(`agent${t}`);
    }

    store.arm(agents.length);
    const results = await Promise.all(
      agents.map((id) =>
        spend(store, { budgetAccountId: id, vendorAccountId: "vendor", amountMicro: 1n * USD }),
      ),
    );

    expect(results.filter((r) => r.status === "committed")).toHaveLength(2);
    expect(store.getAccount("org")!.balanceMicro).toBe(0n);
    expect(store.getAccount("org")!.balanceMicro).toBeGreaterThanOrEqual(0n);
  });
});

describe("velocity circuit-breaker: runaway spend auto-freezes the account", () => {
  it("trips on the spend that crosses the window limit, then freezes future spends", async () => {
    const store = new MemStore();
    store.seedAccount(
      acct({
        id: "agent",
        type: "agent",
        balanceMicro: 100n * USD,
        capMicro: 100n * USD,
        velocityLimitMicro: 5n * USD,
        velocityWindowSeconds: 60,
      }),
    );
    store.seedAccount(acct({ id: "vendor", type: "vendor" }));

    const spendOnce = () =>
      spend(store, { budgetAccountId: "agent", vendorAccountId: "vendor", amountMicro: 2n * USD });

    expect((await spendOnce()).status).toBe("committed"); // 2
    expect((await spendOnce()).status).toBe("committed"); // 4
    const tripped = await spendOnce(); // would reach 6 > 5
    expect(tripped.status).toBe("denied");
    expect(tripped.reason).toBe("velocity_tripped");

    // The breaker froze the account, so even an affordable spend is now denied.
    expect(store.getAccount("agent")!.frozen).toBe(true);
    const after = await spendOnce();
    expect(after.status).toBe("denied");
    expect(after.reason).toBe("account_frozen");
  });
});
