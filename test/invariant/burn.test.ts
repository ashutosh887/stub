import { describe, expect, it } from "vitest";
import { burnStatus } from "@/core/burn";
import { forecast } from "@/core/forecast";

const USD = 1_000_000n;

describe("burn status: soft alert thresholds over a hard cap", () => {
  it("buckets into ok / notice / warn / critical at 50 / 80 / 100%", () => {
    const cap = 100n * USD;
    expect(burnStatus(cap, 100n * USD).state).toBe("ok"); // 0% spent
    expect(burnStatus(cap, 49n * USD).state).toBe("notice"); // 51%
    expect(burnStatus(cap, 15n * USD).state).toBe("warn"); // 85%
    expect(burnStatus(cap, 0n).state).toBe("critical"); // 100%
    expect(burnStatus(cap, 70n * USD).pct).toBe(30);
  });

  it("is inert for accounts with no cap (vendors)", () => {
    const s = burnStatus(null, 0n);
    expect(s.state).toBe("ok");
    expect(s.pct).toBe(0);
  });
});

describe("forecast: projected runway from recent burn", () => {
  it("projects depletion from the active spend span", () => {
    const now = 10 * 86_400_000;
    // $10 spent evenly over the last 2 days → $5/day → $50 balance lasts ~10 days.
    const events = [
      { amountMicro: 5n * USD, atMs: now - 2 * 86_400_000 },
      { amountMicro: 5n * USD, atMs: now },
    ];
    const f = forecast({ balanceMicro: 50n * USD, events, nowMs: now });
    expect(f.ratePerDayMicro).toBe(5n * USD);
    expect(f.daysToDepletion).toBeCloseTo(10, 1);
  });

  it("reports no runway when there has been no recent spend", () => {
    const f = forecast({ balanceMicro: 50n * USD, events: [], nowMs: 0 });
    expect(f.daysToDepletion).toBeNull();
    expect(f.ratePerDayMicro).toBe(0n);
  });
});
