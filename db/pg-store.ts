import type { Pool, PoolClient } from "pg";
import { getPool } from "./client";
import type { Policy } from "@/core/policy";
import {
  type Account,
  type AccountType,
  type Denial,
  type Entry,
  type Store,
  type Tx,
  ConflictError,
  isConflict,
} from "@/core/store";

export class PgStore implements Store {
  constructor(private readonly pool: Pool = getPool()) {}

  async transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await fn(makeTx(client));
      await client.query("COMMIT");
      return result;
    } catch (err) {
      await rollbackQuietly(client);
      if (isConflict(err)) throw new ConflictError((err as Error).message);
      throw err;
    } finally {
      client.release();
    }
  }
}

function makeTx(client: PoolClient): Tx {
  return {
    async getAccount(id) {
      const { rows } = await client.query(
        `SELECT id, type, parent_id, name, balance_micro, cap_micro, frozen, last_entry_hash
           FROM accounts WHERE id = $1`,
        [id],
      );
      return rows[0] ? toAccount(rows[0]) : null;
    },
    async updateAccount(id, balanceMicro, lastEntryHash) {
      await client.query(
        `UPDATE accounts SET balance_micro = $2, last_entry_hash = $3 WHERE id = $1`,
        [id, balanceMicro.toString(), lastEntryHash],
      );
    },
    async insertEntry(entry: Entry) {
      await client.query(
        `INSERT INTO entries
           (id, transaction_id, account_id, kind, amount_micro,
            agent_id, session_id, user_id, intent, receipt, prev_hash, hash)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          entry.id,
          entry.transactionId,
          entry.accountId,
          entry.kind,
          entry.amountMicro.toString(),
          entry.agentId,
          entry.sessionId,
          entry.userId,
          entry.intent,
          entry.receipt === undefined ? null : JSON.stringify(entry.receipt),
          entry.prevHash,
          entry.hash,
        ],
      );
    },
    async insertDenial(denial: Denial) {
      await client.query(
        `INSERT INTO denials
           (id, account_id, attempted_micro, reason, agent_id, session_id, intent, receipt)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          denial.id,
          denial.accountId,
          denial.attemptedMicro.toString(),
          denial.reason,
          denial.agentId,
          denial.sessionId,
          denial.intent,
          denial.receipt === undefined ? null : JSON.stringify(denial.receipt),
        ],
      );
    },
    async getIdempotent(key) {
      const { rows } = await client.query(
        `SELECT transaction_id FROM idempotency_keys WHERE key = $1`,
        [key],
      );
      return rows[0]?.transaction_id ?? null;
    },
    async putIdempotent(key, transactionId) {
      await client.query(
        `INSERT INTO idempotency_keys (key, transaction_id) VALUES ($1, $2)`,
        [key, transactionId],
      );
    },
    async getPolicies(accountId) {
      const { rows } = await client.query(
        `SELECT id, account_id, label, enabled, limit_micro, window_seconds,
                vendor_allow, vendor_block, approval_threshold_micro
           FROM policies
          WHERE account_id = $1 AND enabled IS NOT false`,
        [accountId],
      );
      return rows.map(toPolicy);
    },
    async spentInWindow(accountId, windowSeconds) {
      const { rows } = await client.query(
        `SELECT COALESCE(SUM(-amount_micro), 0) AS spent
           FROM entries
          WHERE account_id = $1 AND kind = 'debit'
            AND created_at >= now() - ($2 || ' seconds')::interval`,
        [accountId, String(windowSeconds)],
      );
      return BigInt(rows[0]?.spent ?? 0);
    },
  };
}

function toPolicy(row: Record<string, unknown>): Policy {
  return {
    id: row.id as string,
    accountId: row.account_id as string,
    label: (row.label as string | null) ?? "",
    enabled: row.enabled !== false,
    limitMicro: row.limit_micro == null ? null : BigInt(row.limit_micro as string),
    windowSeconds: row.window_seconds == null ? null : Number(row.window_seconds),
    vendorAllow: (row.vendor_allow as string[] | null) ?? null,
    vendorBlock: (row.vendor_block as string[] | null) ?? null,
    approvalThresholdMicro:
      row.approval_threshold_micro == null ? null : BigInt(row.approval_threshold_micro as string),
  };
}

function toAccount(row: Record<string, unknown>): Account {
  return {
    id: row.id as string,
    type: row.type as AccountType,
    parentId: (row.parent_id as string | null) ?? null,
    name: row.name as string,
    balanceMicro: BigInt(row.balance_micro as string),
    capMicro: row.cap_micro == null ? null : BigInt(row.cap_micro as string),
    frozen: row.frozen === true,
    lastEntryHash: row.last_entry_hash as string,
  };
}

async function rollbackQuietly(client: PoolClient): Promise<void> {
  try {
    await client.query("ROLLBACK");
  } catch {}
}
