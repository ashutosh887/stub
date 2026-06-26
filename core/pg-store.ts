import type { PoolClient } from "pg";
import { getPool } from "./db";
import {
  type Account,
  type AccountType,
  type Denial,
  type Entry,
  type Store,
  type Tx,
  ConflictError,
  isConflict,
} from "./store";

/**
 * Aurora DSQL-backed store. The ledger logic is identical to MemStore's; here the OCC
 * conflict is enforced by DSQL itself — two transactions that update the same account
 * row concurrently make the loser's COMMIT fail with SQLSTATE 40001, which we surface
 * as ConflictError for spend()'s retry/deny loop.
 */
export class PgStore implements Store {
  async transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    const client = await getPool().connect();
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
  } catch {
    // The transaction is already aborted; nothing to undo.
  }
}
