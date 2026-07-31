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
  timeoutMs?: number;
  maxRetries?: number;
  retryDelayMs?: number;
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

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_RETRY_DELAY_MS = 200;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function newIdempotencyKey(): string {
  const webCrypto = globalThis.crypto;
  if (webCrypto && typeof webCrypto.randomUUID === "function") {
    return `stub-${webCrypto.randomUUID()}`;
  }
  return `stub-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export class StubClient {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly doFetch: typeof fetch;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly retryDelayMs: number;

  constructor(options: StubClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? "http://localhost:3000").replace(/\/$/, "");
    this.apiKey = options.apiKey;
    const f = options.fetch ?? globalThis.fetch;
    if (!f) throw new Error("no fetch available; pass options.fetch");
    this.doFetch = f.bind(globalThis);
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxRetries = Math.max(0, options.maxRetries ?? DEFAULT_MAX_RETRIES);
    this.retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  }

  private async once(path: string, body: unknown): Promise<Response> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.apiKey) headers.authorization = `Bearer ${this.apiKey}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.doFetch(`${this.baseUrl}${path}`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  private async post<T>(path: string, body: unknown): Promise<{ data: T; attempts: number }> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= this.maxRetries + 1; attempt++) {
      let res: Response;
      try {
        res = await this.once(path, body);
      } catch (err) {
        lastError = err;
        if (attempt > this.maxRetries) break;
        await sleep(this.retryDelayMs * 2 ** (attempt - 1));
        continue;
      }

      if ((res.status === 429 || res.status >= 500) && attempt <= this.maxRetries) {
        await sleep(this.retryDelayMs * 2 ** (attempt - 1));
        continue;
      }

      const data = (await res.json().catch(() => ({}))) as T & { error?: string };
      if (res.status >= 500 || res.status === 429 || res.status === 401 || res.status === 400) {
        throw new StubError(data.error ?? `${path} failed (${res.status})`, res.status);
      }
      return { data, attempts: attempt };
    }

    const reason = lastError instanceof Error ? lastError.message : "network error";
    throw new StubError(`${path} unreachable after ${this.maxRetries + 1} attempts: ${reason}`, 0);
  }

  private keyFor(input: SpendInput): string | undefined {
    if (input.idempotencyKey !== undefined) return input.idempotencyKey;
    return this.maxRetries > 0 ? newIdempotencyKey() : undefined;
  }

  async spend(input: SpendInput): Promise<SpendResult> {
    const ownedKey = input.idempotencyKey === undefined;
    const idempotencyKey = this.keyFor(input);
    const { data, attempts } = await this.post<SpendResult>("/api/spend", {
      ...input,
      idempotencyKey,
    });
    if (ownedKey && attempts > 1 && data.status === "duplicate") {
      return { ...data, status: "committed" };
    }
    return data;
  }

  async guard(input: SpendInput): Promise<boolean> {
    const result = await this.spend(input);
    return result.status === "committed";
  }

  async reserve(input: SpendInput): Promise<ReserveResult> {
    const ownedKey = input.idempotencyKey === undefined;
    const idempotencyKey = this.keyFor(input);
    const { data, attempts } = await this.post<ReserveResult>("/api/reserve", {
      ...input,
      idempotencyKey,
    });
    if (ownedKey && attempts > 1 && data.status === "duplicate") {
      return { ...data, status: "reserved" };
    }
    return data;
  }

  async settle(reservationId: string, actualUsd?: number | string): Promise<SettleResult> {
    const { data } = await this.post<SettleResult>("/api/settle", { reservationId, actualUsd });
    return data;
  }

  async release(reservationId: string): Promise<ReleaseResult> {
    const { data } = await this.post<ReleaseResult>("/api/release", { reservationId });
    return data;
  }
}
