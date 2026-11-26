import "dotenv/config";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createAdminPool } from "@/db/client";
import { db } from "@/config";

const APP_ROLE = "stub_app";

const grantsPath = fileURLToPath(new URL("../db/app-role.sql", import.meta.url));
const pool = createAdminPool();
const ARN = /^arn:aws:iam::\d{12}:role\/[\w+=,.@/-]+$/;

function statements(sql: string): string[] {
  return sql
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

async function ensureRole(): Promise<void> {
  const { rows } = await pool.query(`SELECT 1 FROM pg_roles WHERE rolname = $1`, [APP_ROLE]);
  if (rows.length === 0) await pool.query(`CREATE ROLE ${APP_ROLE} WITH LOGIN`);
  if (db.driver === "postgres" && db.appPassword) {
    const { rows: set } = await pool.query<{ sql: string }>(
      `SELECT format('ALTER ROLE ${APP_ROLE} WITH PASSWORD %L', $1::text) AS sql`,
      [db.appPassword],
    );
    await pool.query(set[0].sql);
    console.log(`  ok  ${APP_ROLE} password set from STUB_APP_PASSWORD`);
  }
  for (const statement of statements(readFileSync(grantsPath, "utf8"))) {
    await pool.query(statement);
    console.log(`  ok  ${statement.replace(/\s+/g, " ").slice(0, 90)}`);
  }
}

async function mapped(arn: string): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT 1 FROM sys.iam_pg_role_mappings WHERE arn = $1 AND pg_role_name = $2`,
    [arn, APP_ROLE],
  );
  return rows.length > 0;
}

async function main() {
  const [action = "apply", arn] = process.argv.slice(2);
  if (action === "apply") {
    await ensureRole();
    console.log(`${APP_ROLE} exists with the grants in db/app-role.sql`);
    return;
  }
  if (db.driver === "postgres") throw new Error("AWS IAM GRANT exists only on Aurora DSQL");
  if (!arn || !ARN.test(arn)) throw new Error("usage: app-role (grant|revoke) <iam-role-arn>");
  if (action === "grant" && !(await mapped(arn))) {
    await pool.query(`AWS IAM GRANT ${APP_ROLE} TO '${arn}'`);
  } else if (action === "revoke" && (await mapped(arn))) {
    await pool.query(`AWS IAM REVOKE ${APP_ROLE} FROM '${arn}'`);
  } else if (action !== "grant" && action !== "revoke") {
    throw new Error(`unknown action ${action}`);
  }
  console.log(`${action} ${APP_ROLE} ↔ ${arn}: mapped=${await mapped(arn)}`);
}

main()
  .catch((err) => {
    console.error("app role setup failed:", (err as Error).message);
    process.exit(1);
  })
  .finally(() => pool.end());
