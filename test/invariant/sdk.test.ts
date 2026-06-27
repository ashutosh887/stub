import { describe, expect, it } from "vitest";
import { StubClient } from "@/sdk/index";
import { BudgetDeniedError, mockX402Resource, payThroughStub } from "@/sdk/x402";

function fakeFetch(status: number, body: unknown): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;
}

describe("SDK + x402 gate", () => {
  it("guard() is true on a committed spend, false on a denial", async () => {
    const ok = new StubClient({
      apiKey: "stub_sk_test",
      fetch: fakeFetch(200, { status: "committed", transactionId: "t1", conflicts: 0, attempts: 1 }),
    });
    expect(await ok.guard({ vendorAccountId: "v", amountUsd: "0.01" })).toBe(true);

    const denied = new StubClient({
      apiKey: "stub_sk_test",
      fetch: fakeFetch(402, {
        status: "denied",
        reason: "cap_exceeded",
        transactionId: "t2",
        conflicts: 0,
        attempts: 1,
      }),
    });
    expect(await denied.guard({ vendorAccountId: "v", amountUsd: "9999" })).toBe(false);
  });

  it("payThroughStub pays only when the gate commits, else throws and never pays", async () => {
    const committed = new StubClient({
      fetch: fakeFetch(200, { status: "committed", transactionId: "t", conflicts: 0, attempts: 1 }),
    });
    const paid = await payThroughStub(committed, "vendor", mockX402Resource("0.02", { rows: 5 })());
    expect(paid).toEqual({ rows: 5 });

    let paidWhenDenied = false;
    const denied = new StubClient({
      fetch: fakeFetch(402, {
        status: "denied",
        reason: "velocity_tripped",
        transactionId: "t",
        conflicts: 0,
        attempts: 1,
      }),
    });
    const exchange = {
      status: 402 as const,
      priceUsd: "0.02",
      pay: async () => {
        paidWhenDenied = true;
        return { rows: 5 };
      },
    };
    await expect(payThroughStub(denied, "vendor", exchange)).rejects.toBeInstanceOf(
      BudgetDeniedError,
    );
    expect(paidWhenDenied).toBe(false);
  });
});
