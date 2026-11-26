import "dotenv/config";
import { createAdminPool } from "@/db/client";
import { provisionDrills } from "@/lib/drills";

const pool = createAdminPool();

provisionDrills(pool)
  .then((report) => {
    for (const r of report) console.log(`${r.status.padEnd(8)} ${r.name}`);
  })
  .catch((err) => {
    console.error("seed:drills failed:", (err as Error).message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
