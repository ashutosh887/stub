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
  lastEntryHash: string;
}

export type EntryKind = "debit" | "credit";

export interface Entry {
  id: string;
  transactionId: string;
  accountId: string;
  kind: EntryKind;
  amountMicro: bigint;
  agentId: string | null;
  sessionId: string | null;
  userId: string | null;
  intent: string | null;
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
  receipt: unknown;
}

export interface Tx {
  getAccount(id: string): Promise<Account | null>;
  updateAccount(id: string, balanceMicro: bigint, lastEntryHash: string): Promise<void>;
  insertEntry(entry: Entry): Promise<void>;
  insertDenial(denial: Denial): Promise<void>;
  getIdempotent(key: string): Promise<string | null>;
  putIdempotent(key: string, transactionId: string): Promise<void>;
  getPolicies(accountId: string): Promise<Policy[]>;
  spentInWindow(accountId: string, windowSeconds: number): Promise<bigint>;
}

export interface Store {
  transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
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
