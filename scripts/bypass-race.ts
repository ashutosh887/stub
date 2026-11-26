import "dotenv/config";
import { parseArgs } from "node:util";
import type { Pool } from "pg";
import { createAdminPool, createAppPool, createDriverPool } from "@/db/client";
import { runBypassRace } from "@/lib/bypass-race";
import { usdToMicro } from "@/lib/money";
import { db, dsql, limits } from "@/config";

const { values } = parseArgs({
  options: {
    as: { type: "string", default: "auto" },
    writers: { type: "string", default: "10" },
    balance: { type: "string", default: "3" },
    amount: { type: "string", default: "1" },
  },
});

const owner = createAdminPool();

async function appRoleExists(): Promise<boolean> {
  const { rows } = await owner.query(`SELECT 1 FROM pg_roles WHERE rolname = $1`, [db.appUser]);
  return rows.length > 0;
}

async function writerPool(writers: number): Promise<Pool> {
  const as = values.as;
  if (as !== "auto" && as !== "app" && as !== "owner") throw new Error("--as must be app|owner");
  const useApp = as === "app" || (as === "auto" && (await appRoleExists()));
  if (useApp) return createAppPool(writers);
  return db.url ? createDriverPool(writers) : createDriverPool(writers, dsql.adminUser);
}

async function main() {
  const writers = Number(values.writers);
  if (!Number.isInteger(writers) || writers < 1) throw new Error("--writers must be >= 1");
  const pool = await writerPool(writers);
  try {
    const report = await runBypassRace(owner, pool, {
      writers,
      balanceMicro: usdToMicro(values.balance),
      amountMicro: usdToMicro(values.amount),
      maxRetries: limits.occMaxRetries,
    });
    const lines = [
      { at: report.at, driver: db.driver, connectedAs: report.connectedAs },
      { checkConstraint: report.checkConstraint },
      {
        writers,
        startUsd: report.startUsd,
        amountUsd: report.amountUsd,
        affordable: report.affordable,
      },
      { committed: report.committed, refusedBySqlstate: report.refused, retries: report.retries },
      { finalUsd: report.finalUsd, overspendUsd: report.overspendUsd },
    ];
    for (const line of lines) console.log(JSON.stringify(line));
  } finally {
    await pool.end();
  }
}

main()
  .catch((err) => {
    console.error("bypass race failed:", (err as Error).message);
    process.exit(1);
  })
  .finally(() => owner.end());
