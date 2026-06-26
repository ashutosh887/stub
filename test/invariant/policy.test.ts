import { describe, expect, it } from "vitest";
import { evaluatePolicies, type Policy } from "@/core/policy";

const USD = 1_000_000n;

function policy(p: Partial<Policy>): Policy {
  return {
    id: "p",
    accountId: "a",
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

const ctx = (amountMicro: bigint, vendorId = "v1", spent = 0n) => ({
  amountMicro,
  vendorId,
  spentInWindow: async () => spent,
});

describe("policy engine", () => {
  it("allows when no rule binds", async () => {
    const v = await evaluatePolicies([policy({ limitMicro: 5n * USD })], ctx(2n * USD));
    expect(v.decision).toBe("allow");
  });

  it("denies a per-transaction cap breach", async () => {
    const v = await evaluatePolicies([policy({ limitMicro: 1n * USD })], ctx(2n * USD));
    expect(v).toMatchObject({ decision: "deny", reason: "per_txn_limit" });
  });

  it("denies on a rolling-window ceiling using prior spend", async () => {
    const p = policy({ limitMicro: 10n * USD, windowSeconds: 86400 });
    expect((await evaluatePolicies([p], ctx(3n * USD, "v1", 8n * USD))).decision).toBe("deny");
    expect((await evaluatePolicies([p], ctx(1n * USD, "v1", 8n * USD))).decision).toBe("allow");
  });

  it("enforces vendor block and allow lists", async () => {
    const block = policy({ vendorBlock: ["v1"] });
    expect((await evaluatePolicies([block], ctx(1n * USD, "v1"))).decision).toBe("deny");
    const allow = policy({ vendorAllow: ["v2"] });
    expect((await evaluatePolicies([allow], ctx(1n * USD, "v1"))).decision).toBe("deny");
    expect((await evaluatePolicies([allow], ctx(1n * USD, "v2"))).decision).toBe("allow");
  });

  it("flags spend over the approval threshold", async () => {
    const v = await evaluatePolicies([policy({ approvalThresholdMicro: 5n * USD })], ctx(6n * USD));
    expect(v).toMatchObject({ decision: "needs_approval" });
  });

  it("a hard deny outranks a needs_approval", async () => {
    const policies = [
      policy({ approvalThresholdMicro: 1n * USD }),
      policy({ limitMicro: 1n * USD }),
    ];
    expect((await evaluatePolicies(policies, ctx(5n * USD))).decision).toBe("deny");
  });
});
