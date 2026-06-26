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
    if (policy.vendorAllow && policy.vendorAllow.length > 0 && !policy.vendorAllow.includes(ctx.vendorId)) {
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
      approval = { decision: "needs_approval", reason: "needs_approval", policyLabel: policy.label };
    }
  }

  return approval ?? ALLOW;
}
