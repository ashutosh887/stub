import "dotenv/config";
import { PgStore } from "@/db/pg-store";
import { spend } from "@/core/ledger";
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

  async function run(budget: Row, vendor: Row, amount: number, intent: string) {
    const r = await spend(store, {
      budgetAccountId: budget.id,
      vendorAccountId: vendor.id,
      amountMicro: usd(amount),
      intent,
      agentId: budget.name,
    });
    if (r.status === "committed") committed += 1;
    else denied += 1;
    return r;
  }

  // Marketing · research-agent → Data API (kept under the $1.50/hr velocity breaker)
  const dataSpends: [number, string][] = [
    [0.04, "fetch market data"],
    [0.2, "scrape SEC filings"],
    [0.04, "enrich lead list"],
    [0.12, "competitor pricing pull"],
    [0.08, "news sentiment fetch"],
    [0.16, "company firmographics"],
  ];
  for (const [amt, intent] of dataSpends) await run(research, dataApi, amt, intent);

  // Engineering · coding-agent → LLM tokens
  const llmSpends: [number, string][] = [
    [4.5, "generate API client"],
    [2.1, "write unit tests"],
    [6.8, "refactor billing module"],
    [1.4, "explain stack trace"],
    [3.25, "draft DB migration"],
    [0.9, "summarize code review"],
    [2.6, "generate type stubs"],
    [1.75, "write integration test"],
  ];
  for (const [amt, intent] of llmSpends) await run(coding, llm, amt, intent);

  // A denial: over the agent's cap (no state change — just a recorded denial)
  await run(coding, llm, 500, "bulk fine-tune run");

  // A second denial with a different reason: spend against a momentarily frozen account
  await query("UPDATE accounts SET frozen = true WHERE id = $1", [coding.id]);
  await run(coding, llm, 5, "nightly batch job");
  await query("UPDATE accounts SET frozen = false WHERE id = $1", [coding.id]);

  console.log(`\n  ${committed} committed · ${denied} denied`);
  console.log("  Ledger now has real double-entry history + denials.\n");
}

main()
  .catch((err) => {
    console.error("activity seed failed:", (err as Error).message);
    process.exit(1);
  })
  .finally(close);
