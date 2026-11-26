import type { PoolClient } from "pg";
import { type Connectable, getPool } from "./client";
import { db } from "@/config";
import type { Policy } from "@/core/policy";
import {
  type Account,
  type AccountType,
  type Denial,
  type Entry,
  type Reservation,
  type ReservationStatus,
  type Shard,
  type Store,
  type Tx,
  ConflictError,
  isConflict,
} from "@/core/store";

// DSQL is snapshot-isolated with OCC by default; plain Postgres needs SERIALIZABLE to raise 40001.
function beginStatement(): string {
  return db.driver === "postgres" ? "BEGIN ISOLATION LEVEL SERIALIZABLE" : "BEGIN";
}

export class PgStore implements Store {
  constructor(private readonly pool: Connectable = getPool()) {}

  async transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query(beginStatement());
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

  async listExpiredReservations(olderThan: Date): Promise<Reservation[]> {
    const { rows } = await this.pool.query(
      `SELECT id, budget_account_id, vendor_account_id, held_micro, settled_micro,
              status, transaction_id, agent_id, session_id, user_id, intent, cost_center,
              receipt, created_at
         FROM reservations WHERE status = 'held' AND created_at < $1`,
      [olderThan],
    );
    return rows.map(toReservation);
  }
}

const ACCOUNT_COLS = `id, type, parent_id, name, balance_micro, cap_micro, frozen,
  velocity_limit_micro, velocity_window_seconds, sharded, last_entry_hash`;

function makeTx(client: PoolClient): Tx {
  return {
    async getAccount(id) {
      const { rows } = await client.query(`SELECT ${ACCOUNT_COLS} FROM accounts WHERE id = $1`, [
        id,
      ]);
      return rows[0] ? toAccount(rows[0]) : null;
    },
    async getAncestors(id) {
      const result: Account[] = [];
      const seen = new Set<string>([id]);
      const { rows } = await client.query(`SELECT parent_id FROM accounts WHERE id = $1`, [id]);
      let parentId = (rows[0]?.parent_id as string | null) ?? null;
      while (parentId && !seen.has(parentId)) {
        seen.add(parentId);
        const parent = await client.query(`SELECT ${ACCOUNT_COLS} FROM accounts WHERE id = $1`, [
          parentId,
        ]);
        if (!parent.rows[0]) break;
        result.push(toAccount(parent.rows[0]));
        parentId = (parent.rows[0].parent_id as string | null) ?? null;
      }
      return result;
    },
    async listShards(accountId) {
      const { rows } = await client.query(
        `SELECT account_id, shard_index, balance_micro, last_entry_hash
           FROM account_shards WHERE account_id = $1 ORDER BY shard_index`,
        [accountId],
      );
      return rows.map(toShard);
    },
    async getShard(accountId, index) {
      const { rows } = await client.query(
        `SELECT account_id, shard_index, balance_micro, last_entry_hash
           FROM account_shards WHERE account_id = $1 AND shard_index = $2`,
        [accountId, index],
      );
      return rows[0] ? toShard(rows[0]) : null;
    },
    async upsertShard(shard: Shard) {
      const params = [
        shard.accountId,
        shard.index,
        shard.balanceMicro.toString(),
        shard.lastEntryHash,
      ];
      const updated = await client.query(
        `UPDATE account_shards SET balance_micro = $3, last_entry_hash = $4
          WHERE account_id = $1 AND shard_index = $2`,
        params,
      );
      if (updated.rowCount === 0) {
        await client.query(
          `INSERT INTO account_shards (account_id, shard_index, balance_micro, last_entry_hash)
           VALUES ($1,$2,$3,$4)`,
          params,
        );
      }
    },
    async updateShard(accountId, index, balanceMicro, lastEntryHash) {
      await client.query(
        `UPDATE account_shards SET balance_micro = $3, last_entry_hash = $4
          WHERE account_id = $1 AND shard_index = $2`,
        [accountId, index, balanceMicro.toString(), lastEntryHash],
      );
    },
    async updateAccount(id, balanceMicro, lastEntryHash) {
      await client.query(
        `UPDATE accounts SET balance_micro = $2, last_entry_hash = $3 WHERE id = $1`,
        [id, balanceMicro.toString(), lastEntryHash],
      );
    },
    async setFrozen(id, frozen) {
      await client.query(`UPDATE accounts SET frozen = $2 WHERE id = $1`, [id, frozen]);
    },
    async markSharded(id) {
      await client.query(`UPDATE accounts SET sharded = true WHERE id = $1`, [id]);
    },
    async insertEntry(entry: Entry) {
      const columns = [
        "id",
        "transaction_id",
        "account_id",
        "kind",
        "amount_micro",
        "agent_id",
        "session_id",
        "user_id",
        "intent",
        "cost_center",
        "receipt",
        "prev_hash",
        "hash",
      ];
      const values: unknown[] = [
        entry.id,
        entry.transactionId,
        entry.accountId,
        entry.kind,
        entry.amountMicro.toString(),
        entry.agentId,
        entry.sessionId,
        entry.userId,
        entry.intent,
        entry.costCenter,
        entry.receipt === undefined ? null : JSON.stringify(entry.receipt),
        entry.prevHash,
        entry.hash,
      ];

      // Only sharded spends reference shard_index, so unsharded writes work on either schema.
      if (entry.shardIndex != null) {
        columns.push("shard_index");
        values.push(entry.shardIndex);
      }

      await client.query(
        `INSERT INTO entries (${columns.join(", ")})
         VALUES (${values.map((_, i) => `$${i + 1}`).join(",")})`,
        values,
      );
    },
    async insertDenial(denial: Denial) {
      await client.query(
        `INSERT INTO denials
           (id, account_id, attempted_micro, reason, agent_id, session_id, intent, cost_center, receipt)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          denial.id,
          denial.accountId,
          denial.attemptedMicro.toString(),
          denial.reason,
          denial.agentId,
          denial.sessionId,
          denial.intent,
          denial.costCenter,
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
      await client.query(`INSERT INTO idempotency_keys (key, transaction_id) VALUES ($1, $2)`, [
        key,
        transactionId,
      ]);
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
    async getReservation(id) {
      const { rows } = await client.query(
        `SELECT id, budget_account_id, vendor_account_id, held_micro, settled_micro,
                status, transaction_id, agent_id, session_id, user_id, intent, cost_center,
                receipt, created_at
           FROM reservations WHERE id = $1`,
        [id],
      );
      return rows[0] ? toReservation(rows[0]) : null;
    },
    async insertReservation(reservation: Reservation) {
      await client.query(
        `INSERT INTO reservations
           (id, budget_account_id, vendor_account_id, held_micro, settled_micro, status,
            transaction_id, agent_id, session_id, user_id, intent, cost_center, receipt, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [
          reservation.id,
          reservation.budgetAccountId,
          reservation.vendorAccountId,
          reservation.heldMicro.toString(),
          reservation.settledMicro == null ? null : reservation.settledMicro.toString(),
          reservation.status,
          reservation.transactionId,
          reservation.agentId,
          reservation.sessionId,
          reservation.userId,
          reservation.intent,
          reservation.costCenter,
          reservation.receipt === undefined ? null : JSON.stringify(reservation.receipt),
          reservation.createdAt,
        ],
      );
    },
    async updateReservation(id, patch) {
      const settledAt = patch.status === "settled" ? "now()" : "settled_at";
      await client.query(
        `UPDATE reservations
            SET status = $2,
                settled_micro = COALESCE($3, settled_micro),
                transaction_id = COALESCE($4, transaction_id),
                settled_at = ${settledAt}
          WHERE id = $1`,
        [
          id,
          patch.status,
          patch.settledMicro == null ? null : patch.settledMicro.toString(),
          patch.transactionId ?? null,
        ],
      );
    },
  };
}

function toShard(row: Record<string, unknown>): Shard {
  return {
    accountId: row.account_id as string,
    index: Number(row.shard_index),
    balanceMicro: BigInt(row.balance_micro as string),
    lastEntryHash: row.last_entry_hash as string,
  };
}

function toReservation(row: Record<string, unknown>): Reservation {
  return {
    id: row.id as string,
    budgetAccountId: row.budget_account_id as string,
    vendorAccountId: row.vendor_account_id as string,
    heldMicro: BigInt(row.held_micro as string),
    settledMicro: row.settled_micro == null ? null : BigInt(row.settled_micro as string),
    status: row.status as ReservationStatus,
    createdAt: new Date(row.created_at as string),
    transactionId: (row.transaction_id as string | null) ?? null,
    agentId: (row.agent_id as string | null) ?? null,
    sessionId: (row.session_id as string | null) ?? null,
    userId: (row.user_id as string | null) ?? null,
    intent: (row.intent as string | null) ?? null,
    costCenter: (row.cost_center as string | null) ?? null,
    receipt: (row.receipt as unknown) ?? null,
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
    velocityLimitMicro:
      row.velocity_limit_micro == null ? null : BigInt(row.velocity_limit_micro as string),
    velocityWindowSeconds:
      row.velocity_window_seconds == null ? null : Number(row.velocity_window_seconds),
    sharded: row.sharded === true,
    lastEntryHash: row.last_entry_hash as string,
  };
}

async function rollbackQuietly(client: PoolClient): Promise<void> {
  try {
    await client.query("ROLLBACK");
  } catch {}
}
