import {
  type Account,
  type Denial,
  type Entry,
  type Store,
  type Tx,
  ConflictError,
} from "./store";

interface Versioned {
  account: Account;
  version: number;
}

export class MemStore implements Store {
  private accounts = new Map<string, Versioned>();
  readonly entries: Entry[] = [];
  readonly denials: Denial[] = [];
  private idempotency = new Map<string, string>();

  private commitLock: Promise<void> = Promise.resolve();
  private barrier: Barrier | null = null;

  seedAccount(account: Account): void {
    this.accounts.set(account.id, { account: clone(account), version: 0 });
  }

  getAccount(id: string): Account | null {
    const found = this.accounts.get(id);
    return found ? clone(found.account) : null;
  }

  arm(n: number): void {
    this.barrier = new Barrier(n);
  }

  async transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    const reads = new Map<string, number>();
    const accountWrites = new Map<string, { balanceMicro: bigint; lastEntryHash: string }>();
    const entryWrites: Entry[] = [];
    const denialWrites: Denial[] = [];
    const idempotencyWrites = new Map<string, string>();

    const snapshot = (id: string): Versioned | undefined => {
      const found = this.accounts.get(id);
      if (found && !reads.has(id)) reads.set(id, found.version);
      return found;
    };

    const tx: Tx = {
      getAccount: async (id) => {
        const found = snapshot(id);
        if (!found) return null;
        const pending = accountWrites.get(id);
        const account = clone(found.account);
        if (pending) {
          account.balanceMicro = pending.balanceMicro;
          account.lastEntryHash = pending.lastEntryHash;
        }
        return account;
      },
      updateAccount: async (id, balanceMicro, lastEntryHash) => {
        snapshot(id);
        accountWrites.set(id, { balanceMicro, lastEntryHash });
      },
      insertEntry: async (entry) => {
        entryWrites.push(clone(entry));
      },
      insertDenial: async (denial) => {
        denialWrites.push(clone(denial));
      },
      getIdempotent: async (key) => idempotencyWrites.get(key) ?? this.idempotency.get(key) ?? null,
      putIdempotent: async (key, transactionId) => {
        idempotencyWrites.set(key, transactionId);
      },
    };

    const result = await fn(tx);

    if (this.barrier) await this.barrier.wait();

    return this.commit(() => {
      for (const [id, version] of reads) {
        const current = this.accounts.get(id);
        if (!current || current.version !== version) throw new ConflictError();
      }
      for (const [key] of idempotencyWrites) {
        if (this.idempotency.has(key)) throw new ConflictError("duplicate idempotency key");
      }
      for (const [id, write] of accountWrites) {
        const current = this.accounts.get(id);
        if (!current) throw new ConflictError("account vanished");
        current.account.balanceMicro = write.balanceMicro;
        current.account.lastEntryHash = write.lastEntryHash;
        current.version += 1;
      }
      for (const entry of entryWrites) this.entries.push(entry);
      for (const denial of denialWrites) this.denials.push(denial);
      for (const [key, transactionId] of idempotencyWrites) this.idempotency.set(key, transactionId);
      return result;
    });
  }

  private async commit<T>(apply: () => T): Promise<T> {
    const run = this.commitLock.then(apply, apply);
    this.commitLock = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}

class Barrier {
  private arrived = 0;
  private released = false;
  private waiters: Array<() => void> = [];

  constructor(private readonly target: number) {}

  wait(): Promise<void> {
    if (this.released) return Promise.resolve();
    this.arrived += 1;
    if (this.arrived >= this.target) {
      this.released = true;
      const waiters = this.waiters;
      this.waiters = [];
      for (const resolve of waiters) resolve();
      return Promise.resolve();
    }
    return new Promise((resolve) => this.waiters.push(resolve));
  }
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
