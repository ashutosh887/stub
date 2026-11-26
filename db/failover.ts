import type { Pool, PoolClient, QueryResult, QueryResultRow } from "pg";

export interface Connectable {
  connect(): Promise<PoolClient>;
  query<R extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: unknown[],
  ): Promise<QueryResult<R>>;
}

export type EndpointName = "primary" | "peer";

export interface Endpoint {
  name: EndpointName;
  region: string;
  pool: Pool;
}

export interface FailoverOptions {
  failbackAfterMs: number;
  probeTimeoutMs: number;
  now?: () => number;
  onSwitch?: (event: { from: Endpoint; to: Endpoint; reason: string }) => void;
}

const NETWORK_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EPIPE",
]);

const CONNECT_FAILURE =
  /timeout exceeded when trying to connect|Connection terminated|connect ETIMEDOUT|getaddrinfo/i;

export function isEndpointFailure(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | null;
  if (!e) return false;
  if (e.code && NETWORK_CODES.has(e.code)) return true;
  if (e.code && /^(08|57P0|28)/.test(e.code)) return true;
  if (e.code === "XX000" && /^internal error$/i.test(e.message ?? "")) return true;
  return CONNECT_FAILURE.test(e.message ?? "");
}

function describe(err: unknown): string {
  const e = err as { code?: string; message?: string };
  return [e.code, e.message?.split("\n")[0]].filter(Boolean).join(" ");
}

export class FailoverPool implements Connectable {
  private peerSince: number | null = null;
  private probing: Promise<void> | null = null;
  private readonly now: () => number;

  constructor(
    private readonly primary: Endpoint,
    private readonly peer: Endpoint,
    private readonly options: FailoverOptions,
  ) {
    this.now = options.now ?? Date.now;
  }

  get active(): Endpoint {
    return this.peerSince === null ? this.primary : this.peer;
  }

  async connect(): Promise<PoolClient> {
    this.failBackWhenDue();
    const first = this.active;
    try {
      return await first.pool.connect();
    } catch (err) {
      if (!isEndpointFailure(err)) throw err;
      const second = first === this.primary ? this.peer : this.primary;
      this.switchTo(second, describe(err));
      return second.pool.connect();
    }
  }

  async query<R extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: unknown[],
  ): Promise<QueryResult<R>> {
    const client = await this.connect();
    let broken: Error | undefined;
    try {
      return await client.query<R>(text, params);
    } catch (err) {
      if (isEndpointFailure(err)) {
        broken = err as Error;
        this.switchTo(this.otherThan(this.active), describe(err));
      }
      throw err;
    } finally {
      client.release(broken);
    }
  }

  probe(): Promise<void> {
    return this.probing ?? Promise.resolve();
  }

  async end(): Promise<void> {
    await Promise.allSettled([this.primary.pool.end(), this.peer.pool.end()]);
  }

  private otherThan(endpoint: Endpoint): Endpoint {
    return endpoint === this.primary ? this.peer : this.primary;
  }

  private switchTo(target: Endpoint, reason: string) {
    const from = this.active;
    this.peerSince = target === this.peer ? this.now() : null;
    if (from !== target) this.options.onSwitch?.({ from, to: target, reason });
  }

  private failBackWhenDue() {
    if (this.peerSince === null || this.probing) return;
    if (this.now() - this.peerSince < this.options.failbackAfterMs) return;
    this.probing = this.probePrimary().finally(() => {
      this.probing = null;
    });
  }

  private async probePrimary(): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const attempt = this.primary.pool.connect();
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error("failback probe timed out")),
        this.options.probeTimeoutMs,
      );
    });
    try {
      const client = await Promise.race([attempt, timeout]);
      try {
        await client.query("SELECT 1");
      } finally {
        client.release();
      }
      if (this.peerSince !== null) this.switchTo(this.primary, "primary answered the probe");
    } catch {
      attempt.then((late) => late.release()).catch(() => {});
      if (this.peerSince !== null) this.peerSince = this.now();
    } finally {
      clearTimeout(timer);
    }
  }
}
