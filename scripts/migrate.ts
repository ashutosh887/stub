import "dotenv/config";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { query, close } from "@/db/client";
import { db } from "@/config";

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

async function main() {
  const target = db.driver === "postgres" ? "Postgres" : "Aurora DSQL";
  const ddl = statements(readFileSync(schemaPath, "utf8")).map(portable);
  console.log(`Applying ${ddl.length} statements to ${target}...`);
  for (const statement of ddl) {
    await query(statement);
    console.log(`  ✅ ${statement.slice(0, 60).replace(/\s+/g, " ")}...`);
  }
  console.log(`✅ Schema applied to ${target}.`);
}

main()
  .catch((err) => {
    console.error("❌ Migration failed:", err.message);
    process.exit(1);
  })
  .finally(close);
