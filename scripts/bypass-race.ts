import "dotenv/config";
import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import type { Pool } from "pg";
import { createAdminPool, createAppPool, createDriverPool } from "@/db/client";
import { type RaceReport, runBypassRace } from "@/lib/bypass-race";
import { usdToMicro } from "@/lib/money";
import { db, dsql, limits } from "@/config";

const { values } = parseArgs({
  options: {
    as: { type: "string", default: "auto" },
    writers: { type: "string", default: "10" },
    balance: { type: "string", default: "3" },
    amount: { type: "string", default: "1" },
    runs: { type: "string", default: "1" },
    out: { type: "string" },
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

function print(report: RaceReport) {
  const lines = [
    { at: report.at, driver: db.driver, connectedAs: report.connectedAs },
    { checkConstraint: report.checkConstraint },
    {
      writers: report.writers,
      startUsd: report.startUsd,
      amountUsd: report.amountUsd,
      affordable: report.affordable,
    },
    { committed: report.committed, refusedBySqlstate: report.refused, retries: report.retries },
    { finalUsd: report.finalUsd, overspendUsd: report.overspendUsd },
  ];
  for (const line of lines) console.log(JSON.stringify(line));
}

async function main() {
  const writers = Number(values.writers);
  const runs = Number(values.runs);
  if (!Number.isInteger(writers) || writers < 1) throw new Error("--writers must be >= 1");
  if (!Number.isInteger(runs) || runs < 1) throw new Error("--runs must be >= 1");
  const pool = await writerPool(writers);
  const reports: RaceReport[] = [];
  try {
    for (let run = 1; run <= runs; run++) {
      const report = await runBypassRace(owner, pool, {
        writers,
        balanceMicro: usdToMicro(values.balance),
        amountMicro: usdToMicro(values.amount),
        maxRetries: limits.occMaxRetries,
      });
      reports.push(report);
      if (runs > 1) console.log(JSON.stringify({ run }));
      print(report);
    }
    if (runs > 1) {
      const finals = reports.map((r) => Number(r.finalMicro) / 1e6);
      console.log(
        JSON.stringify({
          runs,
          committed: reports.map((r) => r.committed),
          minFinalUsd: Math.min(...finals).toFixed(2),
          maxFinalUsd: Math.max(...finals).toFixed(2),
        }),
      );
    }
    if (values.out) {
      writeFileSync(values.out, `${JSON.stringify({ driver: db.driver, reports }, null, 2)}\n`);
    }
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
