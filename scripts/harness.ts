import { type ApproachResult, runHarness } from "@/core/harness";

const USD = 1_000_000n;
const usd = (micro: bigint) => `$${(Number(micro) / 1e6).toFixed(2)}`;

function line(r: ApproachResult): string {
  const verdict = r.invariantsHold ? "PASS" : "FAIL";
  return [
    r.approach.padEnd(6),
    `committed=${String(r.committedSpends).padStart(2)}`,
    `paid_attempted=${String(r.paymentsAttempted).padStart(3)}`,
    `paid_sent=${String(r.paymentsSent).padStart(3)}`,
    `charged=${usd(r.chargedMicro).padStart(7)}`,
    `balance=${usd(r.finalBalanceMicro).padStart(7)}`,
    `conflicts=${String(r.occConflicts).padStart(3)}`,
    `stuck=${r.stuckHolds}`,
    `double_paid=${r.doublePaid}`,
    verdict,
  ].join("  ");
}

async function main() {
  const report = await runHarness({
    capMicro: 3n * USD,
    amountMicro: 1n * USD,
    writers: 16,
    crashRate: 0.25,
  });

  console.log("Stub concurrency harness");
  console.log(
    `  budget ${usd(report.config.capMicro)} · ${usd(report.config.amountMicro)}/spend · ` +
      `${report.config.writers} concurrent writers · ${Math.round(report.config.crashRate * 100)}% crash after pay`,
  );
  console.log(`  affordable spends: ${report.affordable}`);
  console.log("");
  console.log(line(report.naive));
  console.log(line(report.stub));
  console.log("");

  if (report.naive.doublePaid && report.stub.invariantsHold) {
    console.log("✅ Naive retry double-pays real money. Stub holds exactly-once + no overspend.");
    process.exit(0);
  }

  console.error("❌ Unexpected result — invariants did not separate as expected.");
  process.exit(1);
}

main().catch((err) => {
  console.error("harness failed:", err.message);
  process.exit(1);
});
