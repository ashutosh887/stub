import { query, close } from "../core/db";

async function main() {
  const { rows } = await query<{ now: string; version: string }>(
    "SELECT now() AS now, version() AS version"
  );
  console.log("✅ Connected to Aurora DSQL");
  console.log("   time:", rows[0].now);
  console.log("   server:", rows[0].version);
}

main()
  .catch((err) => {
    console.error("❌ Connection failed:", err.message);
    process.exit(1);
  })
  .finally(close);
