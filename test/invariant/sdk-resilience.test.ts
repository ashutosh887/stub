import { describe, expect, it } from "vitest";
import { StubClient, StubError } from "@/sdk/index";

interface Call {
  path: string;
  body: Record<string, unknown>;
}

function recordingFetch(
  responder: (call: Call, attempt: number) => { status: number; body: unknown } | Promise<never>,
) {
  const calls: Call[] = [];
  const doFetch = (async (url: string, init: RequestInit) => {
    const path = String(url).replace(/^https?:\/\/[^/]+/, "");
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    const call = { path, body };
    calls.push(call);
    const attempt = calls.filter((c) => c.path === path).length;
    const result = await responder(call, attempt);
    return new Response(JSON.stringify(result.body), {
      status: result.status,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { doFetch, calls };
}

const committed = { status: "committed", transactionId: "t1", conflicts: 0, attempts: 1 };

describe("SDK resilience", () => {
  it("attaches an idempotency key so a retried spend cannot double-charge", async () => {
    const { doFetch, calls } = recordingFetch((_call, attempt) =>
      attempt === 1
        ? { status: 503, body: { error: "unavailable" } }
        : { status: 200, body: { ...committed, status: "duplicate" } },
    );

    const client = new StubClient({ fetch: doFetch, retryDelayMs: 1 });
    const result = await client.spend({ vendorAccountId: "v", amountUsd: "0.02" });

    expect(calls).toHaveLength(2);
    expect(calls[0].body.idempotencyKey).toBeTruthy();
    expect(calls[1].body.idempotencyKey).toBe(calls[0].body.idempotencyKey);
    expect(result.status).toBe("committed");
  });

  it("retries a 5xx and succeeds without calling the caller twice", async () => {
    const { doFetch, calls } = recordingFetch((_call, attempt) =>
      attempt <= 2 ? { status: 500, body: { error: "boom" } } : { status: 200, body: committed },
    );

    const client = new StubClient({ fetch: doFetch, retryDelayMs: 1 });
    expect(await client.guard({ vendorAccountId: "v", amountUsd: "0.02" })).toBe(true);
    expect(calls).toHaveLength(3);
  });

  it("gives up after maxRetries and reports the failure", async () => {
    const { doFetch, calls } = recordingFetch(() => ({ status: 500, body: { error: "boom" } }));
    const client = new StubClient({ fetch: doFetch, retryDelayMs: 1, maxRetries: 1 });

    await expect(client.spend({ vendorAccountId: "v", amountUsd: "0.02" })).rejects.toBeInstanceOf(
      StubError,
    );
    expect(calls).toHaveLength(2);
  });

  it("does not retry a denial or a bad request", async () => {
    const denied = recordingFetch(() => ({
      status: 402,
      body: { status: "denied", reason: "cap_exceeded", transactionId: "t", conflicts: 0 },
    }));
    const deniedClient = new StubClient({ fetch: denied.doFetch, retryDelayMs: 1 });
    expect(await deniedClient.guard({ vendorAccountId: "v", amountUsd: "999" })).toBe(false);
    expect(denied.calls).toHaveLength(1);

    const bad = recordingFetch(() => ({ status: 400, body: { error: "bad amount" } }));
    const badClient = new StubClient({ fetch: bad.doFetch, retryDelayMs: 1 });
    await expect(badClient.spend({ vendorAccountId: "v", amountUsd: "-1" })).rejects.toBeInstanceOf(
      StubError,
    );
    expect(bad.calls).toHaveLength(1);
  });

  it("omits the generated key when retries are disabled", async () => {
    const { doFetch, calls } = recordingFetch(() => ({ status: 200, body: committed }));
    const client = new StubClient({ fetch: doFetch, maxRetries: 0 });
    await client.spend({ vendorAccountId: "v", amountUsd: "0.02" });
    expect(calls[0].body.idempotencyKey).toBeUndefined();
  });

  it("aborts a hung request instead of hanging forever", async () => {
    const hang = (async (_url: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      })) as unknown as typeof fetch;

    const client = new StubClient({ fetch: hang, timeoutMs: 20, maxRetries: 0 });
    await expect(client.spend({ vendorAccountId: "v", amountUsd: "0.02" })).rejects.toBeInstanceOf(
      StubError,
    );
  });
});
