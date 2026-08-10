import type { Policy } from "./policy";

export type AccountType = "org" | "team" | "agent" | "vendor";

export interface Account {
  id: string;
  type: AccountType;
  parentId: string | null;
  name: string;
  balanceMicro: bigint;
  capMicro: bigint | null;
  frozen?: boolean;
  velocityLimitMicro?: bigint | null;
  velocityWindowSeconds?: number | null;
  sharded?: boolean;
  lastEntryHash: string;
}

export type EntryKind = "debit" | "credit";

export interface Entry {
  id: string;
  transactionId: string;
  accountId: string;
  shardIndex?: number | null;
  kind: EntryKind;
  amountMicro: bigint;
  agentId: string | null;
  sessionId: string | null;
  userId: string | null;
  intent: string | null;
  costCenter: string | null;
  receipt: unknown;
  prevHash: string;
  hash: string;
}

export interface Denial {
  id: string;
  accountId: string;
  attemptedMicro: bigint;
  reason: string;
  agentId: string | null;
  sessionId: string | null;
  intent: string | null;
  costCenter: string | null;
  receipt: unknown;
}

export type ReservationStatus = "held" | "settled" | "released";

export interface Reservation {
  id: string;
  budgetAccountId: string;
  vendorAccountId: string;
  heldMicro: bigint;
  settledMicro: bigint | null;
  status: ReservationStatus;
  createdAt: Date;
  transactionId: string | null;
  agentId: string | null;
  sessionId: string | null;
  userId: string | null;
  intent: string | null;
  costCenter: string | null;
  receipt: unknown;
}

export interface ReservationPatch {
  status: ReservationStatus;
  settledMicro?: bigint | null;
  transactionId?: string | null;
}

export interface Shard {
  accountId: string;
  index: number;
  balanceMicro: bigint;
  lastEntryHash: string;
}

export interface Tx {
  getAccount(id: string): Promise<Account | null>;
  listShards(accountId: string): Promise<Shard[]>;
  getShard(accountId: string, index: number): Promise<Shard | null>;
  upsertShard(shard: Shard): Promise<void>;
  updateShard(
    accountId: string,
    index: number,
    balanceMicro: bigint,
    lastEntryHash: string,
  ): Promise<void>;
  getAncestors(id: string): Promise<Account[]>;
  updateAccount(id: string, balanceMicro: bigint, lastEntryHash: string): Promise<void>;
  setFrozen(id: string, frozen: boolean): Promise<void>;
  markSharded(id: string): Promise<void>;
  insertEntry(entry: Entry): Promise<void>;
  insertDenial(denial: Denial): Promise<void>;
  getIdempotent(key: string): Promise<string | null>;
  putIdempotent(key: string, transactionId: string): Promise<void>;
  getPolicies(accountId: string): Promise<Policy[]>;
  spentInWindow(accountId: string, windowSeconds: number): Promise<bigint>;
  getReservation(id: string): Promise<Reservation | null>;
  insertReservation(reservation: Reservation): Promise<void>;
  updateReservation(id: string, patch: ReservationPatch): Promise<void>;
}

export interface Store {
  transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
  listExpiredReservations(olderThan: Date): Promise<Reservation[]>;
}

export const SERIALIZATION_FAILURE = "40001";
export const UNIQUE_VIOLATION = "23505";

export class ConflictError extends Error {
  readonly code = SERIALIZATION_FAILURE;
  constructor(message = "OCC serialization failure") {
    super(message);
    this.name = "ConflictError";
  }
}

export function isConflict(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code;
  return code === SERIALIZATION_FAILURE || code === UNIQUE_VIOLATION;
}
