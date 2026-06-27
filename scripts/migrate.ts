import "dotenv/config";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { query, close } from "@/db/client";

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

async function main() {
  const ddl = statements(readFileSync(schemaPath, "utf8"));
  console.log(`Applying ${ddl.length} statements to Aurora DSQL...`);
  for (const statement of ddl) {
    await query(statement);
    console.log(`  ✅ ${statement.slice(0, 60).replace(/\s+/g, " ")}...`);
  }
  console.log("✅ Schema applied.");
}

main()
  .catch((err) => {
    console.error("❌ Migration failed:", err.message);
    process.exit(1);
  })
  .finally(close);
