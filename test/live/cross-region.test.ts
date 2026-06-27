import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPool, query, close } from "@/db/client";
import { PgStore } from "@/db/pg-store";
import { spend } from "@/core/ledger";
import { verifyChain } from "@/core/audit";
import { GENESIS_HASH } from "@/core/hash";
import type { Entry } from "@/core/store";
import { formatUsd } from "@/lib/money";
import { dsql } from "@/config";

const USD = 1_000_000n;
const AMOUNT = 1n * USD;
const AFFORDABLE = 2;
const WRITERS = 6;

const REGION_A = dsql.region;
const REGION_B = dsql.peerRegion;
const PEER_ENDPOINT = dsql.peerEndpoint;

function chainOrder(entries: Entry[]): Entry[] {
  const byPrev = new Map(entries.map((e) => [e.prevHash, e]));
  const ordered: Entry[] = [];
  let prev = GENESIS_HASH;
  while (byPrev.has(prev)) {
    const next = byPrev.get(prev)!;
    ordered.push(next);
    prev = next.hash;
  }
  return ordered;
}

async function loadEntries(accountId: string): Promise<Entry[]> {
  const { rows } = await query<Record<string, unknown>>(
    `SELECT id, transaction_id, account_id, kind, amount_micro,
            agent_id, session_id, user_id, intent, receipt, prev_hash, hash
       FROM entries WHERE account_id = $1`,
    [accountId],
  );
  return rows.map((r) => ({
    id: r.id as string,
    transactionId: r.transaction_id as string,
    accountId: r.account_id as string,
    kind: r.kind as Entry["kind"],
    amountMicro: BigInt(r.amount_micro as string),
    agentId: (r.agent_id as string | null) ?? null,
    sessionId: (r.session_id as string | null) ?? null,
    userId: (r.user_id as string | null) ?? null,
    intent: (r.intent as string | null) ?? null,
    receipt: r.receipt ?? null,
    prevHash: r.prev_hash as string,
    hash: r.hash as string,
  }));
}

describe.skipIf(!PEER_ENDPOINT)(
  "live invariant: a near-empty budget cannot be overspent across regions",
  () => {
    const peer = createPool({
      endpoint: PEER_ENDPOINT!,
      region: REGION_B,
      database: dsql.database,
      user: dsql.user,
    });
    const storeA = new PgStore();
    const storeB = new PgStore(peer);
    const runId = randomUUID().slice(0, 8);
    const budgetId = randomUUID();
    const vendorId = randomUUID();

    beforeAll(async () => {
      await query(
        `INSERT INTO accounts (id, type, parent_id, name, balance_micro, cap_micro, last_entry_hash)
         VALUES ($1,'agent',NULL,$2,$3,$3,$4)`,
        [budgetId, "xregion-budget", (BigInt(AFFORDABLE) * AMOUNT).toString(), GENESIS_HASH],
      );
      await query(
        `INSERT INTO accounts (id, type, parent_id, name, balance_micro, last_entry_hash)
         VALUES ($1,'vendor',NULL,$2,0,$3)`,
        [vendorId, "xregion-vendor", GENESIS_HASH],
      );
    }, 60_000);

    afterAll(async () => {
      await query(`DELETE FROM entries WHERE account_id IN ($1,$2)`, [budgetId, vendorId]);
      await query(`DELETE FROM denials WHERE account_id = $1`, [budgetId]);
      await query(`DELETE FROM idempotency_keys WHERE key LIKE $1`, [`xrun:${runId}:%`]);
      await query(`DELETE FROM accounts WHERE id IN ($1,$2)`, [budgetId, vendorId]);
      await peer.end();
      await close();
    }, 60_000);

    it(`${WRITERS} agents racing across ${REGION_A} + ${REGION_B} commit only what fits`, async () => {
      const writers = Array.from({ length: WRITERS }, (_, i) => {
        const region = i % 2 === 0 ? REGION_A : REGION_B;
        const store = i % 2 === 0 ? storeA : storeB;
        return {
          region,
          run: () =>
            spend(store, {
              budgetAccountId: budgetId,
              vendorAccountId: vendorId,
              amountMicro: AMOUNT,
              idempotencyKey: `xrun:${runId}:${i}`,
              agentId: `agent-${i + 1}@${region}`,
              sessionId: `sess-${i}`,
              intent: "data-api-call",
              receipt: { ask: "402 Payment Required", region, amountUsd: 1 },
            }),
        };
      });

      const results = await Promise.all(writers.map((w) => w.run()));

      const committed = results.filter((r) => r.status === "committed").length;
      const denied = results.filter((r) => r.status === "denied").length;
      const totalConflicts = results.reduce((sum, r) => sum + r.conflicts, 0);

      const budgetEntries = await loadEntries(budgetId);
      const vendorEntries = await loadEntries(vendorId);
      const finalBudget = (
        await query<{ balance_micro: string }>(
          `SELECT balance_micro FROM accounts WHERE id = $1`,
          [budgetId],
        )
      ).rows[0].balance_micro;
      const finalVendor = (
        await query<{ balance_micro: string }>(
          `SELECT balance_micro FROM accounts WHERE id = $1`,
          [vendorId],
        )
      ).rows[0].balance_micro;

      const balanceMicro = BigInt(finalBudget);
      const vendorMicro = BigInt(finalVendor);
      const doubleEntrySum = [...budgetEntries, ...vendorEntries].reduce(
        (acc, e) => acc + e.amountMicro,
        0n,
      );

      console.log(
        `\n  ${WRITERS} agents across ${REGION_A} + ${REGION_B} hit a ${formatUsd(
          BigInt(AFFORDABLE) * AMOUNT,
        )} budget:` +
          `\n    committed ${committed} · denied ${denied} · OCC 40001 conflicts ${totalConflicts}` +
          `\n    budget floored at ${formatUsd(balanceMicro)} (never negative) · vendor ${formatUsd(
            vendorMicro,
          )}\n`,
      );

      expect(committed).toBe(AFFORDABLE);
      expect(denied).toBe(WRITERS - AFFORDABLE);
      expect(balanceMicro).toBeGreaterThanOrEqual(0n);
      expect(balanceMicro).toBe(0n);
      expect(vendorMicro).toBe(BigInt(AFFORDABLE) * AMOUNT);
      expect(totalConflicts).toBeGreaterThan(0);
      expect(doubleEntrySum).toBe(0n);
      expect(verifyChain(chainOrder(budgetEntries))).toEqual([]);
    }, 60_000);
  },
);
