export interface Policy {
  id: string;
  accountId: string;
  label: string;
  enabled: boolean;
  limitMicro: bigint | null;
  windowSeconds: number | null;
  vendorAllow: string[] | null;
  vendorBlock: string[] | null;
  approvalThresholdMicro: bigint | null;
}

export interface PolicyContext {
  amountMicro: bigint;
  vendorId: string;
  spentInWindow: (windowSeconds: number) => Promise<bigint>;
}

export type PolicyDecision =
  | { decision: "allow" }
  | { decision: "deny"; reason: string; policyLabel: string }
  | { decision: "needs_approval"; reason: string; policyLabel: string };

const ALLOW: PolicyDecision = { decision: "allow" };

export async function evaluatePolicies(
  policies: Policy[],
  ctx: PolicyContext,
): Promise<PolicyDecision> {
  let approval: PolicyDecision | null = null;

  for (const policy of policies) {
    if (!policy.enabled) continue;

    if (policy.vendorBlock?.includes(ctx.vendorId)) {
      return { decision: "deny", reason: "vendor_blocked", policyLabel: policy.label };
    }
    if (
      policy.vendorAllow &&
      policy.vendorAllow.length > 0 &&
      !policy.vendorAllow.includes(ctx.vendorId)
    ) {
      return { decision: "deny", reason: "vendor_not_allowed", policyLabel: policy.label };
    }

    if (policy.limitMicro != null) {
      if (policy.windowSeconds == null) {
        if (ctx.amountMicro > policy.limitMicro) {
          return { decision: "deny", reason: "per_txn_limit", policyLabel: policy.label };
        }
      } else {
        const spent = await ctx.spentInWindow(policy.windowSeconds);
        if (spent + ctx.amountMicro > policy.limitMicro) {
          return { decision: "deny", reason: "window_limit", policyLabel: policy.label };
        }
      }
    }

    if (
      policy.approvalThresholdMicro != null &&
      ctx.amountMicro > policy.approvalThresholdMicro &&
      !approval
    ) {
      approval = {
        decision: "needs_approval",
        reason: "needs_approval",
        policyLabel: policy.label,
      };
    }
  }

  return approval ?? ALLOW;
}

export interface SpendEvent {
  amountMicro: bigint;
  vendorId: string;
  atMs: number;
}

export interface SimulationResult {
  evaluated: number;
  blocked: number;
  needsApproval: number;
  savedMicro: bigint;
  reasons: Record<string, number>;
}

export async function simulatePolicy(
  policy: Policy,
  events: SpendEvent[],
): Promise<SimulationResult> {
  const ordered = [...events].sort((a, b) => a.atMs - b.atMs);
  const committed: SpendEvent[] = [];
  const result: SimulationResult = {
    evaluated: 0,
    blocked: 0,
    needsApproval: 0,
    savedMicro: 0n,
    reasons: {},
  };

  for (const event of ordered) {
    const verdict = await evaluatePolicies([policy], {
      amountMicro: event.amountMicro,
      vendorId: event.vendorId,
      spentInWindow: async (windowSeconds) => {
        const cutoff = event.atMs - windowSeconds * 1000;
        let total = 0n;
        for (const c of committed) if (c.atMs >= cutoff) total += c.amountMicro;
        return total;
      },
    });

    result.evaluated += 1;
    if (verdict.decision === "deny") {
      result.blocked += 1;
      result.savedMicro += event.amountMicro;
      result.reasons[verdict.reason] = (result.reasons[verdict.reason] ?? 0) + 1;
    } else {
      if (verdict.decision === "needs_approval") {
        result.needsApproval += 1;
        result.reasons[verdict.reason] = (result.reasons[verdict.reason] ?? 0) + 1;
      }
      committed.push(event);
    }
  }

  return result;
}
