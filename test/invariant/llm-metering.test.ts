import { describe, expect, it } from "vitest";
import { StubClient } from "@/sdk/index";
import { BudgetDeniedError } from "@/sdk/x402";
import { costUsd, estimateUsd, meterLLM, usageFrom } from "@/sdk/llm";

describe("LLM metering", () => {
  const pricing = { inputPerMTok: 3, outputPerMTok: 15 };

  it("prices usage from OpenAI-shaped and Anthropic-shaped responses alike", () => {
    const openai = usageFrom({
      usage: { prompt_tokens: 1000, completion_tokens: 500 },
    });
    const anthropic = usageFrom({
      usage: { input_tokens: 1000, output_tokens: 500 },
    });
    expect(openai).toEqual(anthropic);
    expect(costUsd(openai!, pricing)).toBeCloseTo(0.0105, 6);
    expect(usageFrom({ id: "no usage here" })).toBeNull();
  });

  it("charges cached input at the cached rate", () => {
    const usage = usageFrom({
      usage: { input_tokens: 1000, output_tokens: 0, cache_read_input_tokens: 900 },
    });
    const cost = costUsd(usage!, { ...pricing, cachedInputPerMTok: 0.3 });
    expect(cost).toBeCloseTo(0.0003 + 0.00027, 6);
  });

  it("reserves the estimate, calls once, settles the real cost", async () => {
    const seen: Record<string, unknown>[] = [];
    const doFetch = (async (url: string, init: RequestInit) => {
      const path = String(url).replace(/^https?:\/\/[^/]+/, "");
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      seen.push({ path, ...body });
      const payload =
        path === "/api/reserve"
          ? { status: "reserved", reservationId: "r1", conflicts: 0, attempts: 1 }
          : {
              status: "settled",
              reservationId: "r1",
              transactionId: "t",
              settledMicro: "10500",
              refundMicro: "7500",
            };
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const stub = new StubClient({ fetch: doFetch });
    let calls = 0;
    const response = await meterLLM(
      stub,
      {
        vendorAccountId: "llm-vendor",
        pricing,
        estimatedUsd: estimateUsd(1000, 1000, pricing),
        model: "some-model",
        costCenter: "Marketing",
      },
      async () => {
        calls += 1;
        return { text: "hi", usage: { input_tokens: 1000, output_tokens: 500 } };
      },
    );

    expect(calls).toBe(1);
    expect(response.text).toBe("hi");
    expect(seen[0].path).toBe("/api/reserve");
    expect(seen[0].amountUsd).toBeCloseTo(0.018, 6);
    expect(seen[0].costCenter).toBe("Marketing");
    expect(seen[1].path).toBe("/api/settle");
    expect(seen[1].actualUsd).toBeCloseTo(0.0105, 6);
  });

  it("never calls the model when the budget denies the hold", async () => {
    let called = false;
    const doFetch = (async () =>
      new Response(
        JSON.stringify({ status: "denied", reason: "cap_exceeded", reservationId: "" }),
        { status: 402, headers: { "content-type": "application/json" } },
      )) as unknown as typeof fetch;

    const stub = new StubClient({ fetch: doFetch });
    await expect(
      meterLLM(stub, { vendorAccountId: "llm-vendor", pricing, estimatedUsd: "0.02" }, async () => {
        called = true;
        return { usage: { input_tokens: 1, output_tokens: 1 } };
      }),
    ).rejects.toBeInstanceOf(BudgetDeniedError);
    expect(called).toBe(false);
  });

  it("releases the hold when the model call throws", async () => {
    const paths: string[] = [];
    const doFetch = (async (url: string) => {
      const path = String(url).replace(/^https?:\/\/[^/]+/, "");
      paths.push(path);
      const payload =
        path === "/api/reserve"
          ? { status: "reserved", reservationId: "r9", conflicts: 0, attempts: 1 }
          : { status: "released", reservationId: "r9", refundMicro: "20000" };
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const stub = new StubClient({ fetch: doFetch });
    await expect(
      meterLLM(stub, { vendorAccountId: "llm-vendor", pricing, estimatedUsd: "0.02" }, async () => {
        throw new Error("model overloaded");
      }),
    ).rejects.toThrow("model overloaded");
    expect(paths).toContain("/api/release");
  });
});
