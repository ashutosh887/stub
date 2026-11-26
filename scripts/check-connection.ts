import "dotenv/config";
import { query, close } from "@/db/client";
import { db } from "@/config";

const EXPECTED_TABLES = [
  "accounts",
  "entries",
  "denials",
  "reservations",
  "idempotency_keys",
  "query_cache",
  "policies",
  "agents",
  "sessions",
  "account_shards",
  "proof_runs",
];

async function reportSchema() {
  const { rows } = await query<{ table_name: string }>(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'",
  );
  const present = new Set(rows.map((r) => r.table_name));
  const missing = EXPECTED_TABLES.filter((name) => !present.has(name));

  if (missing.length === 0) {
    console.log("   schema: up to date");
    return;
  }
  console.log(`   schema: ${missing.length} table(s) pending: ${missing.join(", ")}`);
  console.log("   run `npm run migrate` to apply them");
}

async function main() {
  const { rows } = await query<{ now: string; version: string }>(
    "SELECT now() AS now, version() AS version",
  );
  console.log(`Connected to ${db.driver === "postgres" ? "Postgres" : "Aurora DSQL"}`);
  console.log("   time:", rows[0].now);
  console.log("   server:", rows[0].version);
  await reportSchema();
}

main()
  .catch((err) => {
    console.error("Connection failed:", err.message);
    process.exit(1);
  })
  .finally(close);
