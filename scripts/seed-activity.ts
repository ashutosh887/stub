import "dotenv/config";
import { PgStore } from "@/db/pg-store";
import { spend } from "@/core/ledger";
import { reserve, settle, release } from "@/core/settlement";
import { query, close } from "@/db/client";

// Generates realistic ledger activity by running real spends through the core
// ledger against the live cluster — committed double-entry lines + a few denials.
// Run AFTER `npm run seed` (which resets accounts and clears history).

const usd = (n: number) => BigInt(Math.round(n * 1_000_000));

interface Row {
  id: string;
  type: string;
  name: string;
}

async function main() {
  const store = new PgStore();
  const { rows } = await query<Row>("SELECT id, type, name FROM accounts");
  const byName = (name: string) => rows.find((r) => r.name === name);

  const research = byName("research-agent");
  const coding = byName("coding-agent");
  const dataApi = byName("Data API (x402)");
  const llm = byName("LLM tokens");
  if (!research || !coding || !dataApi || !llm) {
    throw new Error("accounts missing — run `npm run seed` first");
  }

  let committed = 0;
  let denied = 0;

  async function run(budget: Row, vendor: Row, amount: number, intent: string, costCenter: string) {
    const r = await spend(store, {
      budgetAccountId: budget.id,
      vendorAccountId: vendor.id,
      amountMicro: usd(amount),
      intent,
      costCenter,
      agentId: budget.name,
      receipt: {
        rail: "x402",
        merchant: `x402://${vendor.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
        vendor: vendor.name,
        amountUsd: amount.toFixed(2),
        intent,
        proof: "0x" + Math.abs(Math.round(amount * 1e8)).toString(16).padStart(12, "0"),
      },
    });
    if (r.status === "committed") committed += 1;
    else denied += 1;
    return r;
  }

  // research-agent → Data API, attributed across cost centers (kept under the velocity breaker)
  const dataSpends: [number, string, string][] = [
    [0.04, "fetch market data", "Marketing"],
    [0.2, "scrape SEC filings", "Customer: Acme"],
    [0.04, "enrich lead list", "Marketing"],
    [0.12, "competitor pricing pull", "Feature: Pricing"],
    [0.08, "news sentiment fetch", "Customer: Acme"],
    [0.16, "company firmographics", "Marketing"],
  ];
  for (const [amt, intent, cc] of dataSpends) await run(research, dataApi, amt, intent, cc);

  // coding-agent → LLM tokens, attributed across cost centers
  const llmSpends: [number, string, string][] = [
    [4.5, "generate API client", "Feature: Search"],
    [2.1, "write unit tests", "Engineering"],
    [6.8, "refactor billing module", "Feature: Billing"],
    [1.4, "explain stack trace", "Engineering"],
    [3.25, "draft DB migration", "Feature: Billing"],
    [0.9, "summarize code review", "Engineering"],
    [2.6, "generate type stubs", "Feature: Search"],
    [1.75, "write integration test", "Engineering"],
  ];
  for (const [amt, intent, cc] of llmSpends) await run(coding, llm, amt, intent, cc);

  // A denial: over the agent's cap (no state change — just a recorded denial)
  await run(coding, llm, 500, "bulk fine-tune run", "Engineering");

  // A second denial with a different reason: spend against a momentarily frozen account
  await query("UPDATE accounts SET frozen = true WHERE id = $1", [coding.id]);
  await run(coding, llm, 5, "nightly batch job", "Engineering");
  await query("UPDATE accounts SET frozen = false WHERE id = $1", [coding.id]);

  // A settled reservation (estimate held, real cost lower → refund) and a released one.
  const held = await reserve(store, {
    budgetAccountId: research.id,
    vendorAccountId: dataApi.id,
    amountMicro: usd(0.3),
    intent: "batch enrichment (estimated)",
    costCenter: "Marketing",
    agentId: research.name,
  });
  if (held.status === "reserved") await settle(store, held.reservationId, { actualMicro: usd(0.18) });

  const cancelled = await reserve(store, {
    budgetAccountId: research.id,
    vendorAccountId: dataApi.id,
    amountMicro: usd(0.25),
    intent: "speculative fetch (cancelled)",
    costCenter: "Marketing",
    agentId: research.name,
  });
  if (cancelled.status === "reserved") await release(store, cancelled.reservationId);

  console.log(`\n  ${committed} committed · ${denied} denied · 2 reservations (1 settled, 1 released)`);
  console.log("  Ledger now has attributed double-entry history, denials, and reservations.\n");
}

main()
  .catch((err) => {
    console.error("activity seed failed:", (err as Error).message);
    process.exit(1);
  })
  .finally(close);
