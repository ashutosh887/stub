import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { query, close } from "../core/db";

const schemaPath = fileURLToPath(new URL("../core/schema.sql", import.meta.url));

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
  const sql = readFileSync(schemaPath, "utf8");
  const ddl = statements(sql);
  console.log(`Applying ${ddl.length} statements to Aurora DSQL...`);
  for (const statement of ddl) {
    const name = statement.slice(0, 60).replace(/\s+/g, " ");
    await query(statement);
    console.log(`  ✅ ${name}...`);
  }
  console.log("✅ Migration complete.");
}

main()
  .catch((err) => {
    console.error("❌ Migration failed:", err.message);
    process.exit(1);
  })
  .finally(close);
