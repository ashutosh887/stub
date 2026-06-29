import "server-only";
import { randomUUID } from "node:crypto";
import { query } from "@/db/client";
import { PgStore } from "@/db/pg-store";
import type { AccountType } from "@/core/store";
import type { LedgerQuery } from "@/core/query";
import { type BurnStatus, burnStatus } from "@/core/burn";
import { generateApiKey, hashApiKey, keysMatch } from "@/core/apikey";

export const store = new PgStore();

export interface AccountRow {
  id: string;
  type: AccountType;
  parentId: string | null;
  name: string;
  balanceMicro: bigint;
  capMicro: bigint | null;
  frozen: boolean;
  burn: BurnStatus;
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
  prevHash: string;
  receipt: unknown;
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
  return rows.map((r) => {
    const balanceMicro = BigInt(r.balance_micro as string);
    const capMicro = r.cap_micro == null ? null : BigInt(r.cap_micro as string);
    return {
      id: r.id as string,
      type: r.type as AccountType,
      parentId: (r.parent_id as string | null) ?? null,
      name: r.name as string,
      balanceMicro,
      capMicro,
      frozen: r.frozen === true,
      burn: burnStatus(capMicro, balanceMicro),
    };
  });
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
            e.kind, e.amount_micro, e.agent_id, e.intent, e.hash, e.prev_hash,
            e.receipt, e.created_at
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
    prevHash: (r.prev_hash as string | null) ?? "",
    receipt: (r.receipt as unknown) ?? null,
    createdAt: new Date(r.created_at as string).toISOString(),
  }));
}

export interface PolicyRow {
  id: string;
  accountId: string;
  accountName: string;
  label: string;
  enabled: boolean;
  limitMicro: bigint | null;
  windowSeconds: number | null;
  vendorAllow: string[] | null;
  vendorBlock: string[] | null;
  approvalThresholdMicro: bigint | null;
}

export interface PolicyInput {
  accountId: string;
  label: string;
  limitMicro?: bigint | null;
  windowSeconds?: number | null;
  vendorAllow?: string[] | null;
  vendorBlock?: string[] | null;
  approvalThresholdMicro?: bigint | null;
}

export async function listPolicies(): Promise<PolicyRow[]> {
  const { rows } = await query<Record<string, unknown>>(
    `SELECT p.id, p.account_id, a.name AS account_name, p.label, p.enabled,
            p.limit_micro, p.window_seconds, p.vendor_allow, p.vendor_block,
            p.approval_threshold_micro
       FROM policies p
       JOIN accounts a ON a.id = p.account_id
      ORDER BY a.type, a.name, p.created_at`,
  );
  return rows.map((r) => ({
    id: r.id as string,
    accountId: r.account_id as string,
    accountName: r.account_name as string,
    label: (r.label as string | null) ?? "",
    enabled: r.enabled !== false,
    limitMicro: r.limit_micro == null ? null : BigInt(r.limit_micro as string),
    windowSeconds: r.window_seconds == null ? null : Number(r.window_seconds),
    vendorAllow: (r.vendor_allow as string[] | null) ?? null,
    vendorBlock: (r.vendor_block as string[] | null) ?? null,
    approvalThresholdMicro:
      r.approval_threshold_micro == null ? null : BigInt(r.approval_threshold_micro as string),
  }));
}

export async function createPolicy(input: PolicyInput): Promise<string> {
  const id = randomUUID();
  const scope = input.windowSeconds != null ? "window" : input.limitMicro != null ? "per_txn" : "rule";
  await query(
    `INSERT INTO policies
       (id, account_id, label, enabled, scope, limit_micro, window_seconds,
        vendor_allow, vendor_block, approval_threshold_micro)
     VALUES ($1,$2,$3,true,$4,$5,$6,$7,$8,$9)`,
    [
      id,
      input.accountId,
      input.label,
      scope,
      input.limitMicro == null ? null : input.limitMicro.toString(),
      input.windowSeconds ?? null,
      input.vendorAllow && input.vendorAllow.length ? JSON.stringify(input.vendorAllow) : null,
      input.vendorBlock && input.vendorBlock.length ? JSON.stringify(input.vendorBlock) : null,
      input.approvalThresholdMicro == null ? null : input.approvalThresholdMicro.toString(),
    ],
  );
  return id;
}

export interface SpendEventRow {
  amountMicro: bigint;
  vendorId: string;
  atMs: number;
}

export async function listSpendEvents(accountId: string, limit = 500): Promise<SpendEventRow[]> {
  const { rows } = await query<Record<string, unknown>>(
    `SELECT -d.amount_micro AS amount_micro, c.account_id AS vendor_id, d.created_at
       FROM entries d
       JOIN entries c ON c.transaction_id = d.transaction_id AND c.kind = 'credit'
      WHERE d.account_id = $1 AND d.kind = 'debit'
      ORDER BY d.created_at ASC
      LIMIT $2`,
    [accountId, limit],
  );
  return rows.map((r) => ({
    amountMicro: BigInt(r.amount_micro as string),
    vendorId: r.vendor_id as string,
    atMs: new Date(r.created_at as string).getTime(),
  }));
}

export interface BurnEventRow {
  amountMicro: bigint;
  atMs: number;
}

export async function listFleetSpend(limit = 2000): Promise<BurnEventRow[]> {
  const { rows } = await query<Record<string, unknown>>(
    `SELECT -amount_micro AS amount_micro, created_at
       FROM entries
      WHERE kind = 'debit'
      ORDER BY created_at DESC
      LIMIT $1`,
    [limit],
  );
  return rows.map((r) => ({
    amountMicro: BigInt(r.amount_micro as string),
    atMs: new Date(r.created_at as string).getTime(),
  }));
}

export async function setPolicyEnabled(id: string, enabled: boolean): Promise<void> {
  await query(`UPDATE policies SET enabled = $2 WHERE id = $1`, [id, enabled]);
}

export async function deletePolicy(id: string): Promise<void> {
  await query(`DELETE FROM policies WHERE id = $1`, [id]);
}

export interface AgentRow {
  id: string;
  accountId: string;
  accountName: string | null;
  name: string;
  keyPreview: string | null;
  createdAt: string;
}

export async function listAgents(): Promise<AgentRow[]> {
  const { rows } = await query<Record<string, unknown>>(
    `SELECT ag.id, ag.account_id, a.name AS account_name, ag.name,
            ag.api_key_preview, ag.created_at
       FROM agents ag
       LEFT JOIN accounts a ON a.id = ag.account_id
      ORDER BY ag.created_at DESC`,
  );
  return rows.map((r) => ({
    id: r.id as string,
    accountId: r.account_id as string,
    accountName: (r.account_name as string | null) ?? null,
    name: r.name as string,
    keyPreview: (r.api_key_preview as string | null) ?? null,
    createdAt: new Date(r.created_at as string).toISOString(),
  }));
}

export interface CreatedAgent {
  id: string;
  apiKey: string;
  keyPreview: string;
}

export async function createAgent(name: string, accountId: string): Promise<CreatedAgent> {
  const id = randomUUID();
  const key = generateApiKey();
  await query(
    `INSERT INTO agents (id, account_id, name, api_key_hash, api_key_preview)
     VALUES ($1,$2,$3,$4,$5)`,
    [id, accountId, name, key.hash, key.preview],
  );
  return { id, apiKey: key.plaintext, keyPreview: key.preview };
}

export interface ResolvedAgent {
  agentId: string;
  agentName: string;
  accountId: string;
}

export async function resolveApiKey(plaintext: string): Promise<ResolvedAgent | null> {
  const { rows } = await query<Record<string, unknown>>(
    `SELECT id, name, account_id, api_key_hash FROM agents WHERE api_key_hash = $1`,
    [hashApiKey(plaintext)],
  );
  const row = rows[0];
  if (!row || !keysMatch(plaintext, row.api_key_hash as string)) return null;
  return {
    agentId: row.id as string,
    agentName: row.name as string,
    accountId: row.account_id as string,
  };
}

export interface QueryResultRow {
  label: string;
  totalMicro: bigint;
  count: number;
}

const SPEND_GROUP: Record<LedgerQuery["groupBy"], string | null> = {
  none: null,
  vendor: "va.name",
  account: "da.name",
  agent: "COALESCE(d.agent_id, '—')",
  intent: "COALESCE(d.intent, '—')",
  reason: null,
  day: "to_char(date_trunc('day', d.created_at), 'YYYY-MM-DD')",
};

const DENIAL_GROUP: Record<LedgerQuery["groupBy"], string | null> = {
  none: null,
  vendor: null,
  account: "a.name",
  agent: "COALESCE(dn.agent_id, '—')",
  intent: "COALESCE(dn.intent, '—')",
  reason: "dn.reason",
  day: "to_char(date_trunc('day', dn.created_at), 'YYYY-MM-DD')",
};

export async function runLedgerQuery(q: LedgerQuery): Promise<QueryResultRow[]> {
  const params: unknown[] = [];
  const p = (value: unknown): string => {
    params.push(value);
    return `$${params.length}`;
  };
  const like = (term: string): string => p(`%${term}%`);

  const where: string[] = [];
  let from: string;
  let groupExpr: string | null;
  let amountExpr: string;

  if (q.source === "denials") {
    from = `FROM denials dn
       JOIN accounts a ON a.id = dn.account_id
       LEFT JOIN accounts pa ON pa.id = a.parent_id`;
    amountExpr = "dn.attempted_micro";
    groupExpr = DENIAL_GROUP[q.groupBy];
    if (q.account) {
      const ph = like(q.account);
      where.push(`(a.name ILIKE ${ph} OR pa.name ILIKE ${ph})`);
    }
    if (q.agent) where.push(`dn.agent_id ILIKE ${like(q.agent)}`);
    if (q.intent) where.push(`dn.intent ILIKE ${like(q.intent)}`);
    if (q.reason) where.push(`dn.reason ILIKE ${like(q.reason)}`);
    if (q.since) where.push(`dn.created_at >= ${p(q.since)}::timestamptz`);
    if (q.until) where.push(`dn.created_at < ${p(q.until)}::timestamptz`);
  } else {
    from = `FROM entries d
       JOIN entries c ON c.transaction_id = d.transaction_id AND c.kind = 'credit'
       JOIN accounts da ON da.id = d.account_id
       JOIN accounts va ON va.id = c.account_id
       LEFT JOIN accounts pa ON pa.id = da.parent_id`;
    amountExpr = "ABS(d.amount_micro)";
    groupExpr = SPEND_GROUP[q.groupBy];
    where.push("d.kind = 'debit'");
    if (q.account) {
      const ph = like(q.account);
      where.push(`(da.name ILIKE ${ph} OR pa.name ILIKE ${ph})`);
    }
    if (q.vendor) where.push(`va.name ILIKE ${like(q.vendor)}`);
    if (q.agent) where.push(`d.agent_id ILIKE ${like(q.agent)}`);
    if (q.intent) where.push(`d.intent ILIKE ${like(q.intent)}`);
    if (q.since) where.push(`d.created_at >= ${p(q.since)}::timestamptz`);
    if (q.until) where.push(`d.created_at < ${p(q.until)}::timestamptz`);
  }

  const label = groupExpr ?? "'Total'";
  const orderCol = q.metric === "count" ? "cnt" : "total_micro";
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const groupSql = groupExpr ? `GROUP BY ${groupExpr}` : "";
  const limitPh = p(q.limit);

  const sql = `SELECT ${label} AS label,
            COALESCE(SUM(${amountExpr}), 0) AS total_micro,
            COUNT(*) AS cnt
       ${from}
      ${whereSql}
      ${groupSql}
      ORDER BY ${orderCol} DESC
      LIMIT ${limitPh}`;

  const { rows } = await query<Record<string, unknown>>(sql, params);
  return rows.map((r) => ({
    label: String(r.label),
    totalMicro: BigInt(r.total_micro as string),
    count: Number(r.cnt),
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
