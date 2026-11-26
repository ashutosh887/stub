import type { Policy } from "./policy";
import {
  type Account,
  type Denial,
  type Entry,
  type Reservation,
  type Shard,
  type Store,
  type Tx,
  ConflictError,
} from "./store";

interface Versioned {
  account: Account;
  version: number;
}

interface VersionedShard {
  shard: Shard;
  version: number;
}

function shardKey(accountId: string, index: number): string {
  return `${accountId}#${index}`;
}

interface VersionedReservation {
  reservation: Reservation;
  version: number;
}

export class MemStore implements Store {
  private accounts = new Map<string, Versioned>();
  private shards = new Map<string, VersionedShard>();
  readonly entries: Entry[] = [];
  readonly denials: Denial[] = [];
  private idempotency = new Map<string, string>();
  private policies = new Map<string, Policy[]>();
  private reservations = new Map<string, VersionedReservation>();

  getReservation(id: string): Reservation | null {
    const found = this.reservations.get(id);
    return found ? clone(found.reservation) : null;
  }

  heldReservationCount(): number {
    let n = 0;
    for (const { reservation } of this.reservations.values()) {
      if (reservation.status === "held") n += 1;
    }
    return n;
  }

  private commitLock: Promise<void> = Promise.resolve();
  private barrier: Barrier | null = null;

  seedAccount(account: Account): void {
    this.accounts.set(account.id, { account: clone(account), version: 0 });
  }

  seedShard(shard: Shard): void {
    this.shards.set(shardKey(shard.accountId, shard.index), { shard: clone(shard), version: 0 });
  }

  shardBalances(accountId: string): bigint[] {
    return [...this.shards.values()]
      .filter(({ shard }) => shard.accountId === accountId)
      .sort((a, b) => a.shard.index - b.shard.index)
      .map(({ shard }) => shard.balanceMicro);
  }

  seedPolicy(policy: Policy): void {
    const list = this.policies.get(policy.accountId) ?? [];
    list.push(clone(policy));
    this.policies.set(policy.accountId, list);
  }

  getAccount(id: string): Account | null {
    const found = this.accounts.get(id);
    return found ? clone(found.account) : null;
  }

  async listExpiredReservations(olderThan: Date): Promise<Reservation[]> {
    const result: Reservation[] = [];
    for (const { reservation } of this.reservations.values()) {
      if (reservation.status === "held" && reservation.createdAt < olderThan) {
        result.push(clone(reservation));
      }
    }
    return result;
  }

  arm(n: number): void {
    this.barrier = new Barrier(n);
  }

  async transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    const reads = new Map<string, number>();
    const accountWrites = new Map<
      string,
      { balanceMicro?: bigint; lastEntryHash?: string; frozen?: boolean; sharded?: boolean }
    >();
    const entryWrites: Entry[] = [];
    const denialWrites: Denial[] = [];
    const idempotencyWrites = new Map<string, string>();
    const reservationReads = new Map<string, number>();
    const reservationWrites = new Map<string, Reservation>();
    const shardReads = new Map<string, number>();
    const shardWrites = new Map<string, Shard>();

    const snapshot = (id: string): Versioned | undefined => {
      const found = this.accounts.get(id);
      if (found && !reads.has(id)) reads.set(id, found.version);
      return found;
    };

    const readAccount = (id: string): Account | null => {
      const found = snapshot(id);
      if (!found) return null;
      const pending = accountWrites.get(id);
      const account = clone(found.account);
      if (pending) {
        if (pending.balanceMicro !== undefined) account.balanceMicro = pending.balanceMicro;
        if (pending.lastEntryHash !== undefined) account.lastEntryHash = pending.lastEntryHash;
        if (pending.frozen !== undefined) account.frozen = pending.frozen;
        if (pending.sharded !== undefined) account.sharded = pending.sharded;
      }
      return account;
    };

    const readShard = (accountId: string, index: number, track: boolean): Shard | null => {
      const key = shardKey(accountId, index);
      const pending = shardWrites.get(key);
      if (pending) return clone(pending);
      const found = this.shards.get(key);
      if (!found) {
        if (track && !shardReads.has(key)) shardReads.set(key, -1);
        return null;
      }
      if (track && !shardReads.has(key)) shardReads.set(key, found.version);
      return clone(found.shard);
    };

    const tx: Tx = {
      getAccount: async (id) => readAccount(id),
      listShards: async (accountId) =>
        [...this.shards.values()]
          .filter(({ shard }) => shard.accountId === accountId)
          .sort((a, b) => a.shard.index - b.shard.index)
          .map(({ shard }) => readShard(shard.accountId, shard.index, false)!)
          .filter(Boolean),
      getShard: async (accountId, index) => readShard(accountId, index, true),
      upsertShard: async (shard) => {
        readShard(shard.accountId, shard.index, true);
        shardWrites.set(shardKey(shard.accountId, shard.index), clone(shard));
      },
      updateShard: async (accountId, index, balanceMicro, lastEntryHash) => {
        const current = readShard(accountId, index, true);
        if (!current) throw new Error(`unknown shard: ${accountId}#${index}`);
        shardWrites.set(shardKey(accountId, index), {
          ...current,
          balanceMicro,
          lastEntryHash,
        });
      },
      hasChildren: async (id) =>
        [...this.accounts.values()].some(({ account }) => account.parentId === id),
      getAncestors: async (id) => {
        const result: Account[] = [];
        const self = readAccount(id);
        let parentId = self?.parentId ?? null;
        while (parentId) {
          const parent = readAccount(parentId);
          if (!parent) break;
          result.push(parent);
          parentId = parent.parentId;
        }
        return result;
      },
      updateAccount: async (id, balanceMicro, lastEntryHash) => {
        snapshot(id);
        accountWrites.set(id, { ...accountWrites.get(id), balanceMicro, lastEntryHash });
      },
      setFrozen: async (id, frozen) => {
        snapshot(id);
        accountWrites.set(id, { ...accountWrites.get(id), frozen });
      },
      markSharded: async (id) => {
        snapshot(id);
        accountWrites.set(id, { ...accountWrites.get(id), sharded: true });
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
      getPolicies: async (accountId) => (this.policies.get(accountId) ?? []).map(clone),
      spentInWindow: async (accountId) => {
        let total = 0n;
        for (const entry of this.entries) {
          if (entry.accountId === accountId && entry.kind === "debit") total += -entry.amountMicro;
        }
        return total;
      },
      getReservation: async (id) => {
        const pending = reservationWrites.get(id);
        if (pending) return clone(pending);
        const found = this.reservations.get(id);
        if (!found) return null;
        if (!reservationReads.has(id)) reservationReads.set(id, found.version);
        return clone(found.reservation);
      },
      insertReservation: async (reservation) => {
        reservationWrites.set(reservation.id, clone(reservation));
      },
      updateReservation: async (id, patch) => {
        let current = reservationWrites.get(id);
        if (!current) {
          const found = this.reservations.get(id);
          if (found) {
            if (!reservationReads.has(id)) reservationReads.set(id, found.version);
            current = clone(found.reservation);
          }
        }
        if (!current) throw new Error(`unknown reservation: ${id}`);
        const updated: Reservation = { ...current, status: patch.status };
        if (patch.settledMicro !== undefined) updated.settledMicro = patch.settledMicro;
        if (patch.transactionId !== undefined) updated.transactionId = patch.transactionId;
        reservationWrites.set(id, updated);
      },
    };

    const result = await fn(tx);

    if (this.barrier) await this.barrier.wait();

    return this.commit(() => {
      for (const [id, version] of reads) {
        const current = this.accounts.get(id);
        if (!current || current.version !== version) throw new ConflictError();
      }
      for (const [id, version] of reservationReads) {
        const current = this.reservations.get(id);
        if (!current || current.version !== version) throw new ConflictError();
      }
      for (const [key, version] of shardReads) {
        const current = this.shards.get(key);
        const seen = current?.version ?? -1;
        if (seen !== version) throw new ConflictError();
      }
      for (const [key] of idempotencyWrites) {
        if (this.idempotency.has(key)) throw new ConflictError("duplicate idempotency key");
      }
      for (const [id, write] of accountWrites) {
        const current = this.accounts.get(id);
        if (!current) throw new ConflictError("account vanished");
        if (write.balanceMicro !== undefined) current.account.balanceMicro = write.balanceMicro;
        if (write.lastEntryHash !== undefined) current.account.lastEntryHash = write.lastEntryHash;
        if (write.frozen !== undefined) current.account.frozen = write.frozen;
        if (write.sharded !== undefined) current.account.sharded = write.sharded;
        current.version += 1;
      }
      for (const [id, reservation] of reservationWrites) {
        const existing = this.reservations.get(id);
        this.reservations.set(id, { reservation, version: (existing?.version ?? -1) + 1 });
      }
      for (const [key, shard] of shardWrites) {
        const existing = this.shards.get(key);
        this.shards.set(key, { shard, version: (existing?.version ?? -1) + 1 });
      }
      for (const entry of entryWrites) this.entries.push(entry);
      for (const denial of denialWrites) this.denials.push(denial);
      for (const [key, transactionId] of idempotencyWrites)
        this.idempotency.set(key, transactionId);
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
