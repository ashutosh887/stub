import "dotenv/config";
import type { PoolClient } from "pg";
import { getPool, close } from "@/db/client";

interface Outcome {
  probe: string;
  result: "accepted" | "refused";
  rows?: number | null;
  code?: string;
  message?: string;
}

const PICK_AGENT = `(SELECT id FROM accounts WHERE type = 'agent' ORDER BY id LIMIT 1)`;
const PICK_ENTRY = `(SELECT id FROM entries ORDER BY id LIMIT 1)`;

const DML_PROBES: Array<[string, string]> = [
  [
    "drive a budget balance below zero",
    `UPDATE accounts SET balance_micro = -1 WHERE id = ${PICK_AGENT}`,
  ],
  [
    "raise a budget balance by $1,000",
    `UPDATE accounts SET balance_micro = balance_micro + 1000000000 WHERE id = ${PICK_AGENT}`,
  ],
  ["rewrite an entries row", `UPDATE entries SET amount_micro = 0 WHERE id = ${PICK_ENTRY}`],
  ["delete an entries row", `DELETE FROM entries WHERE id = ${PICK_ENTRY}`],
  [
    "create an account",
    `INSERT INTO accounts (id, type, name, balance_micro, last_entry_hash)
     VALUES (gen_random_uuid(), 'agent', 'wa-probe', 1, 'x')`,
  ],
];

const DDL_PROBES: Array<[string, string]> = [
  ["create a table", `CREATE TABLE wa_probe_ddl (id INT PRIMARY KEY)`],
  ["drop the entries table", `DROP TABLE entries`],
];

async function attempt(client: PoolClient, probe: string, sql: string): Promise<Outcome> {
  await client.query("BEGIN");
  try {
    const res = await client.query(sql);
    return { probe, result: "accepted", rows: res.rowCount };
  } catch (err) {
    const e = err as { code?: string; message: string };
    return { probe, result: "refused", code: e.code, message: e.message.split("\n")[0] };
  } finally {
    await client.query("ROLLBACK").catch(() => {});
  }
}

async function main() {
  const client = await getPool().connect();
  try {
    const who = await client.query<{ user: string; owns: boolean }>(
      `SELECT current_user AS user,
              pg_has_role(current_user, (SELECT tableowner FROM pg_tables
                                          WHERE schemaname = 'public' AND tablename = 'entries'),
                          'MEMBER') AS owns`,
    );
    const { user, owns } = who.rows[0];
    console.log(JSON.stringify({ user, ownsEntries: owns, at: new Date().toISOString() }));

    for (const [probe, sql] of DML_PROBES) {
      console.log(JSON.stringify(await attempt(client, probe, sql)));
    }
    for (const [probe, sql] of DDL_PROBES) {
      if (owns) {
        console.log(JSON.stringify({ probe, result: "skipped", message: "role owns the tables" }));
        continue;
      }
      console.log(JSON.stringify(await attempt(client, probe, sql)));
    }
  } finally {
    client.release();
  }
}

main()
  .catch((err) => {
    console.error("probe failed:", (err as Error).message);
    process.exit(1);
  })
  .finally(close);
