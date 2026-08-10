import "dotenv/config";
import { close } from "@/db/client";
import { PgStore } from "@/db/pg-store";
import { sweepExpiredReservations } from "@/core/settlement";
import { limits } from "@/config";

async function main() {
  const store = new PgStore();
  const results = await sweepExpiredReservations(store, limits.reservationTtlSeconds);

  const released = results.filter((r) => r.status === "released").length;
  console.log(
    `Swept ${results.length} expired reservation(s) older than ${limits.reservationTtlSeconds}s: ` +
      `${released} released, ${results.length - released} already resolved.`,
  );
}

main()
  .catch((err) => {
    console.error("sweep failed:", err.message);
    process.exit(1);
  })
  .finally(close);
