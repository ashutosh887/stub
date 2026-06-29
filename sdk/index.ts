export type SpendStatus = "committed" | "denied" | "duplicate" | "needs_approval";
export type ReserveStatus = "reserved" | "denied" | "duplicate" | "needs_approval";
export type SettleStatus = "settled" | "duplicate" | "not_found" | "invalid";
export type ReleaseStatus = "released" | "duplicate" | "not_found" | "invalid";

export interface SpendInput {
  vendorAccountId: string;
  amountUsd: number | string;
  intent?: string;
  costCenter?: string;
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

export interface ReserveResult {
  status: ReserveStatus;
  reservationId: string;
  reason?: string;
  conflicts: number;
  attempts: number;
}

export interface SettleResult {
  status: SettleStatus;
  reservationId: string;
  transactionId: string | null;
  settledMicro: string | number;
  refundMicro: string | number;
  reason?: string;
}

export interface ReleaseResult {
  status: ReleaseStatus;
  reservationId: string;
  refundMicro: string | number;
  reason?: string;
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

  private async post<T>(path: string, body: unknown): Promise<T> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.apiKey) headers.authorization = `Bearer ${this.apiKey}`;
    const res = await this.doFetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    const data = (await res.json()) as T & { error?: string };
    if (res.status >= 500 || res.status === 401 || res.status === 400) {
      throw new StubError(data.error ?? `${path} failed (${res.status})`, res.status);
    }
    return data;
  }

  spend(input: SpendInput): Promise<SpendResult> {
    return this.post<SpendResult>("/api/spend", input);
  }

  async guard(input: SpendInput): Promise<boolean> {
    const result = await this.spend(input);
    return result.status === "committed";
  }

  reserve(input: SpendInput): Promise<ReserveResult> {
    return this.post<ReserveResult>("/api/reserve", input);
  }

  settle(reservationId: string, actualUsd?: number | string): Promise<SettleResult> {
    return this.post<SettleResult>("/api/settle", { reservationId, actualUsd });
  }

  release(reservationId: string): Promise<ReleaseResult> {
    return this.post<ReleaseResult>("/api/release", { reservationId });
  }
}
