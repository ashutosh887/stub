import "dotenv/config";
import { StubClient } from "@/sdk/index";
import { BudgetDeniedError, mockX402Resource, payThroughStub } from "@/sdk/x402";
import { app, demo } from "@/config";

const baseUrl = app.baseUrl;
const SPENDS = demo.spends;
const PRICE_USD = demo.priceUsd;

interface AccountDto {
  id: string;
  type: string;
  name: string;
  balanceDisplay: string;
}

async function getAccounts(): Promise<AccountDto[]> {
  const res = await fetch(`${baseUrl}/api/accounts`).catch(() => null);
  if (!res || !res.ok) {
    throw new Error(`could not reach Stub at ${baseUrl} — is \`npm run dev\` running?`);
  }
  return (await res.json()).accounts as AccountDto[];
}

async function mintKey(name: string, accountId: string): Promise<string> {
  const res = await fetch(`${baseUrl}/api/agents`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, accountId }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "could not mint key");
  return data.apiKey as string;
}

async function main() {
  const accounts = await getAccounts();
  const budget = accounts.find((a) => a.type === "agent");
  const vendor = accounts.find((a) => a.type === "vendor");
  if (!budget || !vendor) throw new Error("need one agent account and one vendor — run `npm run seed`");

  console.log(`\n  Agent budget: ${budget.name} (${budget.balanceDisplay})`);
  console.log(`  Vendor:       ${vendor.name}`);

  const apiKey = await mintKey(`demo-agent-${Date.now()}`, budget.id);
  console.log(`  Scoped key:   …${apiKey.slice(-6)}  (spends pin to ${budget.name})\n`);

  const stub = new StubClient({ apiKey, baseUrl });
  const buyData = mockX402Resource(PRICE_USD, { rows: 1000 });

  let committed = 0;
  let denied = 0;
  for (let i = 1; i <= SPENDS; i += 1) {
    try {
      await payThroughStub(stub, vendor.id, buyData());
      committed += 1;
      console.log(`  #${String(i).padStart(2)}  ✅ paid $${PRICE_USD} for data`);
    } catch (err) {
      if (err instanceof BudgetDeniedError) {
        denied += 1;
        console.log(`  #${String(i).padStart(2)}  ⛔ blocked — ${err.result.reason}`);
      } else {
        throw err;
      }
    }
  }

  try {
    await payThroughStub(stub, vendor.id, mockX402Resource("100000.00", { rows: 1 })());
    console.log("  #!!  ✅ (unexpected) a $100k spend committed");
  } catch (err) {
    if (err instanceof BudgetDeniedError) {
      denied += 1;
      console.log(`  #!!  ⛔ $100k spend blocked — ${err.result.reason}`);
    } else {
      throw err;
    }
  }

  console.log(`\n  ${committed} committed · ${denied} blocked by the gate.`);
  console.log("  The agent never overspent — the ledger refused.\n");
}

main().catch((err) => {
  console.error(`\n  ✗ ${(err as Error).message}\n`);
  process.exit(1);
});
