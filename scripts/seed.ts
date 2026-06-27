import "dotenv/config";
import { randomUUID } from "node:crypto";
import { GENESIS_HASH } from "@/core/hash";
import { query, close } from "@/db/client";

const USD = 1_000_000n;

interface SeedAccount {
  id: string;
  type: string;
  parentId: string | null;
  name: string;
  balanceMicro: bigint;
  capMicro: bigint | null;
}

function account(
  type: string,
  name: string,
  balanceMicro: bigint,
  capMicro: bigint | null,
  parentId: string | null,
): SeedAccount {
  return { id: randomUUID(), type, parentId, name, balanceMicro, capMicro };
}

async function main() {
  const org = account("org", "Acme AI Co", 500n * USD, 500n * USD, null);
  const marketing = account("team", "Marketing", 200n * USD, 200n * USD, org.id);
  const engineering = account("team", "Engineering", 300n * USD, 300n * USD, org.id);
  const researcher = account("agent", "research-agent", 50n * USD, 50n * USD, marketing.id);
  const coder = account("agent", "coding-agent", 100n * USD, 100n * USD, engineering.id);
  const dataApi = account("vendor", "Data API (x402)", 0n, null, null);
  const llm = account("vendor", "LLM tokens", 0n, null, null);

  const accounts = [org, marketing, engineering, researcher, coder, dataApi, llm];

  for (const a of accounts) {
    await query(
      `INSERT INTO accounts (id, type, parent_id, name, balance_micro, cap_micro, last_entry_hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [a.id, a.type, a.parentId, a.name, a.balanceMicro.toString(), a.capMicro?.toString() ?? null, GENESIS_HASH],
    );
    console.log(`  ✅ ${a.type.padEnd(7)} ${a.name}`);
  }
  console.log(`✅ Seeded ${accounts.length} accounts ($500 org budget).`);
}

main()
  .catch((err) => {
    console.error("❌ Seed failed:", err.message);
    process.exit(1);
  })
  .finally(close);
