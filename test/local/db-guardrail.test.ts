import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAdminPool, createAppPool } from "@/db/client";
import { runBypassRace } from "@/lib/bypass-race";
import { PROOF_PROBES, runProof } from "@/lib/proof";
import { db } from "@/config";

const USD = 1_000_000n;
const WRITERS = 10;
const AFFORDABLE = 3;

describe.skipIf(db.driver !== "postgres")(
  "database guardrail: stub_app cannot overspend or rewrite the ledger",
  () => {
    const owner = createAdminPool();
    const app = createAppPool(WRITERS);
    const budgetId = randomUUID();

    beforeAll(async () => {
      await owner.query(
        `INSERT INTO accounts (id, type, parent_id, name, balance_micro, cap_micro)
         VALUES ($1, 'agent', NULL, 'guardrail-budget', $2, $2)`,
        [budgetId, USD.toString()],
      );
    }, 60_000);

    afterAll(async () => {
      await owner.query(`DELETE FROM accounts WHERE id = $1`, [budgetId]);
      await app.end();
      await owner.end();
    }, 60_000);

    it("refuses every proof probe with its expected SQLSTATE", async () => {
      const client = await app.connect();
      try {
        const report = await runProof(client, "local");
        expect(report.reason).toBeUndefined();
        expect(report.ran).toBe(true);
        expect(report.probes.map((p) => [p.id, p.outcome, p.sqlstate])).toEqual(
          PROOF_PROBES.map((p) => [p.id, "refused", p.expected]),
        );
      } finally {
        client.release();
      }
    }, 60_000);

    it(`${WRITERS} writers that skip guard() never take the budget below $0`, async () => {
      const report = await runBypassRace(owner, app, {
        writers: WRITERS,
        balanceMicro: BigInt(AFFORDABLE) * USD,
        amountMicro: USD,
        maxRetries: 50,
      });
      expect(report.connectedAs).toBe(db.appUser);
      expect(report.finalMicro).toBe("0");
      expect(report.committed).toBe(AFFORDABLE);
      expect(report.refused).toEqual({ "23514": WRITERS - AFFORDABLE });
      expect(report.checkConstraint).toBe(true);
    }, 60_000);
  },
);
