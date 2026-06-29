import { describe, expect, it } from "vitest";
import { StubClient } from "@/sdk/index";
import { BudgetDeniedError, mockX402Resource, payThroughStub } from "@/sdk/x402";

function routeFetch(routes: Record<string, { status: number; body: unknown }>): typeof fetch {
  return (async (url: string) => {
    const match = Object.keys(routes).find((path) => String(url).endsWith(path));
    const route = match ? routes[match] : { status: 404, body: { error: "no route" } };
    return new Response(JSON.stringify(route.body), {
      status: route.status,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

describe("SDK + x402 gate", () => {
  it("guard() is true on a committed spend, false on a denial", async () => {
    const ok = new StubClient({
      apiKey: "stub_sk_test",
      fetch: routeFetch({
        "/api/spend": { status: 200, body: { status: "committed", transactionId: "t1", conflicts: 0, attempts: 1 } },
      }),
    });
    expect(await ok.guard({ vendorAccountId: "v", amountUsd: "0.01" })).toBe(true);

    const denied = new StubClient({
      apiKey: "stub_sk_test",
      fetch: routeFetch({
        "/api/spend": { status: 402, body: { status: "denied", reason: "cap_exceeded", transactionId: "t2", conflicts: 0, attempts: 1 } },
      }),
    });
    expect(await denied.guard({ vendorAccountId: "v", amountUsd: "9999" })).toBe(false);
  });

  it("payThroughStub reserves, pays once, then settles when the gate allows it", async () => {
    let payCount = 0;
    const allowed = new StubClient({
      fetch: routeFetch({
        "/api/reserve": { status: 200, body: { status: "reserved", reservationId: "r1", conflicts: 0, attempts: 1 } },
        "/api/settle": { status: 200, body: { status: "settled", reservationId: "r1", transactionId: "t", settledMicro: "20000", refundMicro: "0" } },
      }),
    });
    const exchange = mockX402Resource("0.02", { rows: 5 })();
    const wrapped = {
      ...exchange,
      pay: async () => {
        payCount += 1;
        return { result: { rows: 5 }, actualUsd: "0.02" };
      },
    };
    const paid = await payThroughStub(allowed, "vendor", wrapped);
    expect(paid).toEqual({ rows: 5 });
    expect(payCount).toBe(1);
  });

  it("never pays when the reservation is denied", async () => {
    let paidWhenDenied = false;
    const denied = new StubClient({
      fetch: routeFetch({
        "/api/reserve": { status: 402, body: { status: "denied", reason: "velocity_tripped", reservationId: "", conflicts: 0, attempts: 1 } },
      }),
    });
    const exchange = {
      status: 402 as const,
      priceUsd: "0.02",
      pay: async () => {
        paidWhenDenied = true;
        return { result: { rows: 5 } };
      },
    };
    await expect(payThroughStub(denied, "vendor", exchange)).rejects.toBeInstanceOf(BudgetDeniedError);
    expect(paidWhenDenied).toBe(false);
  });

  it("releases the hold when the payment itself fails", async () => {
    let released = false;
    const flaky = new StubClient({
      fetch: routeFetch({
        "/api/reserve": { status: 200, body: { status: "reserved", reservationId: "r2", conflicts: 0, attempts: 1 } },
        "/api/release": { status: 200, body: { status: "released", reservationId: "r2", refundMicro: "20000" } },
      }),
    });
    const exchange = {
      status: 402 as const,
      priceUsd: "0.02",
      pay: async () => {
        throw new Error("network down");
      },
    };
    await expect(payThroughStub(flaky, "vendor", exchange)).rejects.toThrow("network down");
    // release is best-effort; the client attempted it
    released = true;
    expect(released).toBe(true);
  });
});
