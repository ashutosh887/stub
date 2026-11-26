import { createHash } from "node:crypto";
import type { Connectable } from "@/db/failover";
import { PgStore } from "@/db/pg-store";
import { release, reserve } from "@/core/settlement";
import { GENESIS_HASH } from "@/core/hash";
import { SCENARIOS, type Scenario } from "@/lib/incidents";

const USD = 1_000_000n;
const STALE_HOLD_MS = 120_000;
const MAX_RETRIES = 50;

function drillId(key: string): string {
  const h = createHash("sha256").update(`stub-drill:${key}`).digest("hex");
  const variant = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export interface DrillBudget {
  id: string;
  name: string;
  capMicro: bigint;
}

export interface DrillAccount {
  id: string;
  type: "agent" | "vendor";
  parentId: string | null;
  name: string;
  capMicro: bigint | null;
}

export const DRILL_VENDOR_ID = drillId("vendor");

export const STRESS_BUDGET: DrillBudget = {
  id: drillId("stress"),
  name: "drill-stress",
  capMicro: 1n * USD,
};

export function incidentBudget(scenario: Scenario): DrillBudget {
  return {
    id: drillId(`incident:${scenario.id}`),
    name: `drill-${scenario.id}`,
    capMicro: BigInt(Math.round(scenario.budgetUsd * 1_000_000)),
  };
}

export const DRILL_BUDGETS: DrillBudget[] = [STRESS_BUDGET, ...SCENARIOS.map(incidentBudget)];

export function drillAccounts(): DrillAccount[] {
  return [
    ...DRILL_BUDGETS.map((b) => ({
      id: b.id,
      type: "agent" as const,
      parentId: null,
      name: b.name,
      capMicro: b.capMicro,
    })),
    { id: DRILL_VENDOR_ID, type: "vendor", parentId: null, name: "drill-vendor", capMicro: null },
  ];
}

export const DRILL_ACCOUNT_IDS: string[] = drillAccounts().map((a) => a.id);

export function excludeDrills(column: string, placeholder: (value: string) => string): string {
  return `${column} NOT IN (${DRILL_ACCOUNT_IDS.map(placeholder).join(", ")})`;
}

export type ProvisionStatus = "created" | "ok" | "reset";

export async function provisionDrills(
  owner: Connectable,
): Promise<Array<{ name: string; status: ProvisionStatus }>> {
  const list = DRILL_ACCOUNT_IDS.map((_, i) => `$${i + 1}`).join(", ");
  const held = await owner.query<{ n: string }>(
    `SELECT count(*) AS n FROM reservations WHERE status = 'held' AND budget_account_id IN (${list})`,
    DRILL_ACCOUNT_IDS,
  );
  const busy = Number(held.rows[0]?.n ?? 0) > 0;

  const report: Array<{ name: string; status: ProvisionStatus }> = [];
  for (const a of drillAccounts()) {
    const cap = a.capMicro?.toString() ?? null;
    const balance = a.capMicro?.toString() ?? "0";
    const { rows } = await owner.query<Record<string, string | null>>(
      `SELECT type, parent_id, name, cap_micro, balance_micro FROM accounts WHERE id = $1`,
      [a.id],
    );
    const row = rows[0];
    if (!row) {
      await owner.query(
        `INSERT INTO accounts (id, type, parent_id, name, balance_micro, cap_micro, last_entry_hash)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [a.id, a.type, a.parentId, a.name, balance, cap, GENESIS_HASH],
      );
      report.push({ name: a.name, status: "created" });
      continue;
    }
    const matches =
      row.type === a.type &&
      row.parent_id === a.parentId &&
      row.name === a.name &&
      (row.cap_micro == null ? null : String(row.cap_micro)) === cap &&
      String(row.balance_micro) === balance;
    if (matches) {
      report.push({ name: a.name, status: "ok" });
      continue;
    }
    if (busy) {
      throw new Error(`${a.name} differs from its spec while drill holds are open; retry later`);
    }
    const booked = await owner.query(`SELECT 1 FROM entries WHERE account_id = $1 LIMIT 1`, [a.id]);
    if (booked.rows.length > 0) {
      throw new Error(`${a.name} has ledger entries, so its balance cannot be reset to the spec`);
    }
    await owner.query(
      `UPDATE accounts SET type = $2, parent_id = $3, name = $4, cap_micro = $5, balance_micro = $6
        WHERE id = $1`,
      [a.id, a.type, a.parentId, a.name, cap, balance],
    );
    report.push({ name: a.name, status: "reset" });
  }
  return report;
}

export class DrillNotProvisionedError extends Error {
  constructor() {
    super("drill accounts are missing; an operator must run npm run seed:drills");
    this.name = "DrillNotProvisionedError";
  }
}

export interface DrillRun {
  calls: number;
  held: number;
  denied: number;
  failed: number;
  conflicts: number;
  heldMicro: bigint;
  lowMicro: bigint;
  restoredMicro: bigint;
  capMicro: bigint;
}

async function balanceOf(pool: Connectable, id: string): Promise<bigint | null> {
  const { rows } = await pool.query<{ balance_micro: string }>(
    `SELECT balance_micro FROM accounts WHERE id = $1`,
    [id],
  );
  return rows[0] ? BigInt(rows[0].balance_micro) : null;
}

async function releaseStaleHolds(pool: Connectable, store: PgStore, budgetId: string) {
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM reservations
      WHERE budget_account_id = $1 AND status = 'held' AND created_at < $2`,
    [budgetId, new Date(Date.now() - STALE_HOLD_MS)],
  );
  for (const r of rows) await release(store, r.id, { maxRetries: MAX_RETRIES });
}

export async function runDrill(
  pool: Connectable,
  budget: DrillBudget,
  attempt: { calls: number; amountMicro: bigint; intent: string; agentPrefix: string },
): Promise<DrillRun> {
  if ((await balanceOf(pool, DRILL_VENDOR_ID)) == null) throw new DrillNotProvisionedError();
  if ((await balanceOf(pool, budget.id)) == null) throw new DrillNotProvisionedError();

  const store = new PgStore(pool);
  await releaseStaleHolds(pool, store, budget.id);

  const outcomes = await Promise.allSettled(
    Array.from({ length: attempt.calls }, (_, i) =>
      reserve(
        store,
        {
          budgetAccountId: budget.id,
          vendorAccountId: DRILL_VENDOR_ID,
          amountMicro: attempt.amountMicro,
          intent: attempt.intent,
          agentId: `${attempt.agentPrefix}-${i}`,
        },
        { maxRetries: MAX_RETRIES },
      ),
    ),
  );

  const reserved = outcomes.flatMap((o) =>
    o.status === "fulfilled" && o.value.status === "reserved" ? [o.value] : [],
  );
  const denied = outcomes.filter(
    (o) => o.status === "fulfilled" && o.value.status !== "reserved",
  ).length;
  const conflicts = outcomes.reduce(
    (sum, o) => sum + (o.status === "fulfilled" ? o.value.conflicts : 0),
    0,
  );

  const lowMicro = (await balanceOf(pool, budget.id)) ?? 0n;

  await Promise.allSettled(
    reserved.map((r) => release(store, r.reservationId, { maxRetries: MAX_RETRIES })),
  );

  return {
    calls: attempt.calls,
    held: reserved.length,
    denied,
    failed: attempt.calls - reserved.length - denied,
    conflicts,
    heldMicro: BigInt(reserved.length) * attempt.amountMicro,
    lowMicro,
    restoredMicro: (await balanceOf(pool, budget.id)) ?? 0n,
    capMicro: budget.capMicro,
  };
}
