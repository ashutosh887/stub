import { describe, expect, it } from "vitest";
import { runHarness } from "@/core/harness";

const USD = 1_000_000n;

describe("harness: naive retry-around-payment double-pays; Stub pays exactly once", () => {
  it("naive overspends real money under contention, Stub holds every invariant", async () => {
    const report = await runHarness({
      capMicro: 3n * USD,
      amountMicro: 1n * USD,
      writers: 12,
      crashRate: 0.25,
    });

    // The naive baseline fires the irreversible payment inside the OCC retry loop, so
    // conflicts re-charge: it sends more payments than spends it could afford.
    expect(report.naive.occConflicts).toBeGreaterThan(0);
    expect(report.naive.doublePaid).toBe(true);
    expect(report.naive.paymentsSent).toBeGreaterThan(report.affordable);
    expect(report.naive.invariantsHold).toBe(false);

    // Stub: at most the affordable number of spends commit, the payment is sent exactly
    // once per committed spend, no hold is left stuck after the sweep, balance never negative.
    expect(report.stub.committedSpends).toBeLessThanOrEqual(report.affordable);
    expect(report.stub.paymentsSent).toBe(report.stub.committedSpends);
    expect(report.stub.doublePaid).toBe(false);
    expect(report.stub.stuckHolds).toBe(0);
    expect(report.stub.overspend).toBe(false);
    expect(report.stub.chainOk).toBe(true);
    expect(report.stub.invariantsHold).toBe(true);
  });
});
