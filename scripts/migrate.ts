import "dotenv/config";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createAdminPool } from "@/db/client";
import { db } from "@/config";

const pool = createAdminPool();
const query = pool.query.bind(pool);

const schemaPath = fileURLToPath(new URL("../db/schema.sql", import.meta.url));

function statements(sql: string): string[] {
  return sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

function portable(statement: string): string {
  return db.driver === "postgres"
    ? statement.replace(/CREATE\s+INDEX\s+ASYNC/gi, "CREATE INDEX")
    : statement;
}

const ADD_CONSTRAINT = /^ALTER\s+TABLE\s+(\w+)\s+ADD\s+CONSTRAINT\s+(\w+)\s/i;

async function constraintState(name: string): Promise<"absent" | "not_valid" | "valid"> {
  const { rows } = await query<{ convalidated: boolean }>(
    `SELECT convalidated FROM pg_constraint WHERE conname = $1`,
    [name],
  );
  if (rows.length === 0) return "absent";
  return rows[0].convalidated ? "valid" : "not_valid";
}

async function validate(table: string, name: string): Promise<void> {
  if (db.driver === "postgres") {
    await query(`ALTER TABLE ${table} VALIDATE CONSTRAINT ${name}`);
    return;
  }
  const { rows } = await query<{ job_id: string }>(
    `ALTER TABLE ASYNC ${table} VALIDATE CONSTRAINT ${name}`,
  );
  const jobId = rows[0]?.job_id;
  const deadline = Date.now() + 300_000;
  while (Date.now() < deadline) {
    if ((await constraintState(name)) === "valid") return;
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error(
    `validation of ${name} did not finish (job ${jobId ?? "unknown"}); existing rows may violate it`,
  );
}

async function applyConstraint(statement: string, table: string, name: string): Promise<void> {
  if ((await constraintState(name)) === "absent") await query(statement);
  if ((await constraintState(name)) === "not_valid") await validate(table, name);
}

async function main() {
  const target = db.driver === "postgres" ? "Postgres" : "Aurora DSQL";
  const ddl = statements(readFileSync(schemaPath, "utf8")).map(portable);
  console.log(`Applying ${ddl.length} statements to ${target}...`);
  for (const statement of ddl) {
    const constraint = statement.match(ADD_CONSTRAINT);
    if (constraint) await applyConstraint(statement, constraint[1], constraint[2]);
    else await query(statement);
    console.log(`  ✅ ${statement.slice(0, 60).replace(/\s+/g, " ")}...`);
  }
  console.log(`✅ Schema applied to ${target}.`);
}

main()
  .catch((err) => {
    console.error("❌ Migration failed:", err.message);
    process.exit(1);
  })
  .finally(() => pool.end());
