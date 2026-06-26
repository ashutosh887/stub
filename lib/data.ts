import "server-only";
import { query } from "../core/db";
import { PgStore } from "../core/pg-store";
import type { AccountType } from "../core/store";

export const store = new PgStore();

export interface AccountRow {
  id: string;
  type: AccountType;
  parentId: string | null;
  name: string;
  balanceMicro: bigint;
  capMicro: bigint | null;
  frozen: boolean;
}

export interface EntryRow {
  id: string;
  transactionId: string;
  accountId: string;
  accountName: string;
  kind: "debit" | "credit";
  amountMicro: bigint;
  agentId: string | null;
  intent: string | null;
  hash: string;
  createdAt: string;
}

export interface DenialRow {
  id: string;
  accountId: string;
  accountName: string;
  attemptedMicro: bigint;
  reason: string;
  agentId: string | null;
  intent: string | null;
  createdAt: string;
}

export async function listAccounts(): Promise<AccountRow[]> {
  const { rows } = await query<Record<string, unknown>>(
    `SELECT id, type, parent_id, name, balance_micro, cap_micro, frozen
       FROM accounts ORDER BY type, name`,
  );
  return rows.map((r) => ({
    id: r.id as string,
    type: r.type as AccountType,
    parentId: (r.parent_id as string | null) ?? null,
    name: r.name as string,
    balanceMicro: BigInt(r.balance_micro as string),
    capMicro: r.cap_micro == null ? null : BigInt(r.cap_micro as string),
    frozen: r.frozen === true,
  }));
}

export async function setFrozen(accountId: string, frozen: boolean): Promise<void> {
  await query(`UPDATE accounts SET frozen = $2 WHERE id = $1`, [accountId, frozen]);
}

export async function setAllFrozen(frozen: boolean): Promise<void> {
  await query(`UPDATE accounts SET frozen = $1 WHERE type IN ('org','team','agent')`, [frozen]);
}

export async function listEntries(limit = 50): Promise<EntryRow[]> {
  const { rows } = await query<Record<string, unknown>>(
    `SELECT e.id, e.transaction_id, e.account_id, a.name AS account_name,
            e.kind, e.amount_micro, e.agent_id, e.intent, e.hash, e.created_at
       FROM entries e
       JOIN accounts a ON a.id = e.account_id
      ORDER BY e.created_at DESC
      LIMIT $1`,
    [limit],
  );
  return rows.map((r) => ({
    id: r.id as string,
    transactionId: r.transaction_id as string,
    accountId: r.account_id as string,
    accountName: r.account_name as string,
    kind: r.kind as "debit" | "credit",
    amountMicro: BigInt(r.amount_micro as string),
    agentId: (r.agent_id as string | null) ?? null,
    intent: (r.intent as string | null) ?? null,
    hash: r.hash as string,
    createdAt: new Date(r.created_at as string).toISOString(),
  }));
}

export async function listDenials(limit = 20): Promise<DenialRow[]> {
  const { rows } = await query<Record<string, unknown>>(
    `SELECT d.id, d.account_id, a.name AS account_name, d.attempted_micro,
            d.reason, d.agent_id, d.intent, d.created_at
       FROM denials d
       JOIN accounts a ON a.id = d.account_id
      ORDER BY d.created_at DESC
      LIMIT $1`,
    [limit],
  );
  return rows.map((r) => ({
    id: r.id as string,
    accountId: r.account_id as string,
    accountName: r.account_name as string,
    attemptedMicro: BigInt(r.attempted_micro as string),
    reason: r.reason as string,
    agentId: (r.agent_id as string | null) ?? null,
    intent: (r.intent as string | null) ?? null,
    createdAt: new Date(r.created_at as string).toISOString(),
  }));
}
