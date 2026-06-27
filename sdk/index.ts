export type SpendStatus = "committed" | "denied" | "duplicate" | "needs_approval";

export interface SpendInput {
  vendorAccountId: string;
  amountUsd: number | string;
  intent?: string;
  idempotencyKey?: string;
  budgetAccountId?: string;
  receipt?: unknown;
}

export interface SpendResult {
  status: SpendStatus;
  transactionId: string;
  reason?: string;
  conflicts: number;
  attempts: number;
}

export interface StubClientOptions {
  apiKey?: string;
  baseUrl?: string;
  fetch?: typeof fetch;
}

export class StubError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "StubError";
  }
}

export class StubClient {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly doFetch: typeof fetch;

  constructor(options: StubClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? "http://localhost:3000").replace(/\/$/, "");
    this.apiKey = options.apiKey;
    const f = options.fetch ?? globalThis.fetch;
    if (!f) throw new Error("no fetch available; pass options.fetch");
    this.doFetch = f.bind(globalThis);
  }

  async spend(input: SpendInput): Promise<SpendResult> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.apiKey) headers.authorization = `Bearer ${this.apiKey}`;

    const res = await this.doFetch(`${this.baseUrl}/api/spend`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        vendorAccountId: input.vendorAccountId,
        amountUsd: input.amountUsd,
        intent: input.intent,
        idempotencyKey: input.idempotencyKey,
        budgetAccountId: input.budgetAccountId,
        receipt: input.receipt,
      }),
    });

    const data = (await res.json()) as SpendResult & { error?: string };
    if (res.status !== 200 && res.status !== 402) {
      throw new StubError(data.error ?? `spend failed (${res.status})`, res.status);
    }
    return data;
  }

  async guard(input: SpendInput): Promise<boolean> {
    const result = await this.spend(input);
    return result.status === "committed";
  }
}
