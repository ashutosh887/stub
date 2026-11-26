import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDriverPool, query, close } from "@/db/client";
import { PgStore } from "@/db/pg-store";
import { spend } from "@/core/ledger";
import { provisionShards, shardBalance, shardedSpend } from "@/core/sharded";
import type { Store } from "@/core/store";
import { GENESIS_HASH } from "@/core/hash";
import { formatUsd } from "@/lib/money";
import { db } from "@/config";

const USD = 1_000_000n;
const AMOUNT = 1n * USD;
const AFFORDABLE = 3;
const WRITERS = 10;

describe.skipIf(db.driver !== "postgres")(
  "local invariant: a near-empty budget cannot be overspent under concurrent writers",
  () => {
    const pool = createDriverPool(WRITERS);
    const store = new PgStore(pool);
    const runId = randomUUID().slice(0, 8);
    const budgetId = randomUUID();
    const vendorId = randomUUID();

    beforeAll(async () => {
      await query(
        `INSERT INTO accounts (id, type, parent_id, name, balance_micro, cap_micro, last_entry_hash)
         VALUES ($1,'agent',NULL,$2,$3,$3,$4)`,
        [budgetId, "local-budget", (BigInt(AFFORDABLE) * AMOUNT).toString(), GENESIS_HASH],
      );
      await query(
        `INSERT INTO accounts (id, type, parent_id, name, balance_micro, last_entry_hash)
         VALUES ($1,'vendor',NULL,$2,0,$3)`,
        [vendorId, "local-vendor", GENESIS_HASH],
      );
    }, 60_000);

    afterAll(async () => {
      await query(`DELETE FROM entries WHERE account_id IN ($1,$2)`, [budgetId, vendorId]);
      await query(`DELETE FROM denials WHERE account_id = $1`, [budgetId]);
      await query(`DELETE FROM idempotency_keys WHERE key LIKE $1`, [`local:${runId}:%`]);
      await query(`DELETE FROM accounts WHERE id IN ($1,$2)`, [budgetId, vendorId]);
      await pool.end();
      await close();
    }, 60_000);

    it(`${WRITERS} agents racing one budget commit only the ${AFFORDABLE} that fit`, async () => {
      const results = await Promise.all(
        Array.from({ length: WRITERS }, (_, i) =>
          spend(
            store,
            {
              budgetAccountId: budgetId,
              vendorAccountId: vendorId,
              amountMicro: AMOUNT,
              idempotencyKey: `local:${runId}:${i}`,
              agentId: `agent-${i + 1}`,
              intent: "data-api-call",
            },
            { maxRetries: 50 },
          ),
        ),
      );

      const committed = results.filter((r) => r.status === "committed").length;
      const denied = results.filter((r) => r.status === "denied").length;
      const conflicts = results.reduce((sum, r) => sum + r.conflicts, 0);

      const balances = await query<{ id: string; balance_micro: string }>(
        `SELECT id, balance_micro FROM accounts WHERE id IN ($1,$2)`,
        [budgetId, vendorId],
      );
      const balanceOf = (id: string) =>
        BigInt(balances.rows.find((r) => r.id === id)?.balance_micro ?? "0");

      const budgetMicro = balanceOf(budgetId);
      const vendorMicro = balanceOf(vendorId);

      console.log(
        `\n  ${WRITERS} agents hit a ${formatUsd(BigInt(AFFORDABLE) * AMOUNT)} budget on local Postgres:` +
          `\n    committed ${committed}, denied ${denied}, serialization conflicts ${conflicts}` +
          `\n    budget floored at ${formatUsd(budgetMicro)} (never negative)\n`,
      );

      expect(committed).toBe(AFFORDABLE);
      expect(denied).toBe(WRITERS - AFFORDABLE);
      expect(budgetMicro).toBe(0n);
      expect(vendorMicro).toBe(BigInt(AFFORDABLE) * AMOUNT);
      expect(conflicts).toBeGreaterThan(0);
    }, 60_000);
  },
);

describe.skipIf(db.driver !== "postgres")(
  "local invariant: a Postgres deadlock between sharded spends is retried, not surfaced",
  () => {
    const pool = createDriverPool(2);
    const store = new PgStore(pool);
    const budgetId = randomUUID();
    const vendorId = randomUUID();

    beforeAll(async () => {
      await pool.query(
        `INSERT INTO accounts (id, type, parent_id, name, balance_micro, cap_micro, last_entry_hash)
         VALUES ($1,'agent',NULL,'deadlock-budget',$2,$2,$3), ($4,'vendor',NULL,'deadlock-vendor',0,NULL,$3)`,
        [budgetId, (2n * USD).toString(), GENESIS_HASH, vendorId],
      );
      await provisionShards(store, budgetId, 2n * USD, 2);
    }, 60_000);

    afterAll(async () => {
      await pool.query(`DELETE FROM entries WHERE account_id IN ($1,$2)`, [budgetId, vendorId]);
      await pool.query(`DELETE FROM denials WHERE account_id = $1`, [budgetId]);
      await pool.query(`DELETE FROM account_shards WHERE account_id = $1`, [budgetId]);
      await pool.query(`DELETE FROM accounts WHERE id IN ($1,$2)`, [budgetId, vendorId]);
      await pool.end();
    }, 60_000);

    it("two spends draining both shards in opposite order commit one and deny the other", async () => {
      let arrived = 0;
      let open!: () => void;
      const gate = new Promise<void>((resolve) => (open = resolve));
      const lockstep: Store = {
        listExpiredReservations: (olderThan) => store.listExpiredReservations(olderThan),
        transaction: (fn) =>
          store.transaction((tx) => {
            let writes = 0;
            return fn({
              ...tx,
              async updateShard(...args) {
                writes += 1;
                if (writes === 2 && arrived < 2) {
                  arrived += 1;
                  if (arrived === 2) open();
                  await gate;
                }
                return tx.updateShard(...args);
              },
            });
          }),
      };

      const request = {
        budgetAccountId: budgetId,
        vendorAccountId: vendorId,
        amountMicro: 1_500_000n,
      };
      const results = await Promise.all(
        [0, 1].map((first) =>
          shardedSpend(lockstep, request, { shards: 2, pickShard: () => first }),
        ),
      );

      expect(results.map((r) => r.status).sort()).toEqual(["committed", "denied"]);
      expect(results.reduce((sum, r) => sum + r.conflicts, 0)).toBeGreaterThan(0);
      expect(await shardBalance(store, budgetId)).toBe(500_000n);
    }, 60_000);
  },
);
