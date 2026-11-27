import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAdminPool, createAppPool } from "@/db/client";
import { STRESS_BUDGET, DRILL_VENDOR_ID, provisionDrills, runDrill } from "@/lib/drills";
import { db } from "@/config";

const CALLS = 12;
const HOLD = 250_000n;

describe.skipIf(db.driver !== "postgres")(
  "drills run as stub_app and leave the ledger where they found it",
  () => {
    const owner = createAdminPool();
    const app = createAppPool(CALLS * 2);

    const balance = async (id: string) => {
      const { rows } = await owner.query<{ balance_micro: string }>(
        `SELECT balance_micro FROM accounts WHERE id = $1`,
        [id],
      );
      return BigInt(rows[0].balance_micro);
    };
    const count = async (sql: string) => {
      const { rows } = await owner.query<{ n: string }>(sql, [STRESS_BUDGET.id]);
      return Number(rows[0].n);
    };

    beforeAll(async () => {
      await provisionDrills(owner);
    }, 60_000);

    afterAll(async () => {
      await app.end();
      await owner.end();
    }, 60_000);

    it("two concurrent stress drills hold only what fits, record denials and restore the budget", async () => {
      const deniedBefore = await count(`SELECT count(*) AS n FROM denials WHERE account_id = $1`);

      const runs = await Promise.all(
        [0, 1].map((i) =>
          runDrill(app, STRESS_BUDGET, {
            calls: CALLS,
            amountMicro: HOLD,
            intent: "stress test",
            agentPrefix: `stress-${i}`,
          }),
        ),
      );

      const held = runs.reduce((s, r) => s + r.held, 0);
      const denied = runs.reduce((s, r) => s + r.denied, 0);
      expect(held).toBeGreaterThan(0);
      expect(runs.every((r) => r.held <= Number(STRESS_BUDGET.capMicro / HOLD))).toBe(true);
      expect(runs.every((r) => r.failed === 0 && r.lowMicro >= 0n)).toBe(true);
      expect(held + denied).toBe(CALLS * 2);

      expect(await balance(STRESS_BUDGET.id)).toBe(STRESS_BUDGET.capMicro);
      expect(await balance(DRILL_VENDOR_ID)).toBe(0n);
      expect(await count(`SELECT count(*) AS n FROM denials WHERE account_id = $1`)).toBe(
        deniedBefore + denied,
      );
      expect(
        await count(
          `SELECT count(*) AS n FROM reservations WHERE budget_account_id = $1 AND status = 'held'`,
        ),
      ).toBe(0);
      expect(await count(`SELECT count(*) AS n FROM entries WHERE account_id = $1`)).toBe(0);
    }, 120_000);
  },
);
