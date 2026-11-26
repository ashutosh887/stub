import type { QueryResult } from "pg";

export const APP_ROLE = "stub_app";

export interface ProofProbe {
  id: string;
  description: string;
  sql: string;
  expected: string;
}

export type ProbeOutcome = "refused" | "refused-differently" | "accepted" | "no-row" | "error";

export interface ProbeResult {
  id: string;
  description: string;
  sql: string;
  expected: string;
  outcome: ProbeOutcome;
  sqlstate: string | null;
  message: string;
  rows: number | null;
  ms: number;
}

export interface ProofReport {
  ran: boolean;
  role: string;
  region: string;
  reason?: string;
  probes: ProbeResult[];
  totalMs: number;
  at: string;
}

export interface ProofClient {
  query(text: string): Promise<Pick<QueryResult, "rows" | "rowCount">>;
}

const PICK_BUDGET = `(SELECT id FROM accounts WHERE type = 'agent' ORDER BY id LIMIT 1)`;
const PICK_CAPPED_BUDGET = `(SELECT id FROM accounts WHERE type = 'agent' AND cap_micro IS NOT NULL ORDER BY id LIMIT 1)`;
const PICK_ENTRY = `(SELECT id FROM entries ORDER BY id LIMIT 1)`;

export const PROOF_PROBES: ProofProbe[] = [
  {
    id: "negative-balance",
    description: "Drive a budget balance below zero",
    sql: `UPDATE accounts SET balance_micro = -1 WHERE id = ${PICK_BUDGET}`,
    expected: "23514",
  },
  {
    id: "above-cap",
    description: "Raise a budget above its cap",
    sql: `UPDATE accounts SET balance_micro = cap_micro + 1 WHERE id = ${PICK_CAPPED_BUDGET}`,
    expected: "23514",
  },
  {
    id: "rewrite-entry",
    description: "Rewrite a ledger entry",
    sql: `UPDATE entries SET amount_micro = 0 WHERE id = ${PICK_ENTRY}`,
    expected: "42501",
  },
  {
    id: "delete-entry",
    description: "Delete a ledger entry",
    sql: `DELETE FROM entries WHERE id = ${PICK_ENTRY}`,
    expected: "42501",
  },
  {
    id: "create-table",
    description: "Create a table",
    sql: `CREATE TABLE stub_proof_probe (id INT PRIMARY KEY)`,
    expected: "42501",
  },
  {
    id: "drop-entries",
    description: "Drop the entries table",
    sql: `DROP TABLE entries`,
    expected: "42501",
  },
];

const WHO = `SELECT current_user AS role,
  pg_has_role(current_user, (SELECT tableowner FROM pg_tables
                             WHERE schemaname = 'public' AND tablename = 'entries'),
              'MEMBER') AS owns`;

const SQLSTATE = /^[0-9A-Z]{5}$/;

export function redact(text: string): string {
  return text
    .replace(/arn:aws[\w-]*:[^\s"']+/g, "<arn>")
    .replace(/[\w.-]+\.on\.aws\b/g, "<endpoint>")
    .replace(/[\w.-]+\.amazonaws\.com\b/g, "<endpoint>")
    .replace(/\b\d{12}\b/g, "<account>")
    .replace(/\b[a-z0-9]{26}\b/g, "<cluster>");
}

function firstLine(message: string | undefined): string {
  return redact((message ?? "").split("\n")[0]).slice(0, 300);
}

export function outcomeOf(
  probe: ProofProbe,
  result: { rows: number | null } | { error: { code?: string; message?: string } },
): Pick<ProbeResult, "outcome" | "sqlstate" | "message" | "rows"> {
  if ("error" in result) {
    const code = result.error.code && SQLSTATE.test(result.error.code) ? result.error.code : null;
    const message = firstLine(result.error.message);
    if (!code) return { outcome: "error", sqlstate: null, message, rows: null };
    const outcome = code === probe.expected ? "refused" : "refused-differently";
    return { outcome, sqlstate: code, message, rows: null };
  }
  if (result.rows === 0) {
    return {
      outcome: "no-row",
      sqlstate: null,
      message: "the statement matched no row, so it tested nothing",
      rows: 0,
    };
  }
  return {
    outcome: "accepted",
    sqlstate: null,
    message: "ACCEPTED by the database, then rolled back",
    rows: result.rows,
  };
}

async function attempt(client: ProofClient, probe: ProofProbe): Promise<ProbeResult> {
  const start = performance.now();
  await client.query("BEGIN");
  let mapped: Pick<ProbeResult, "outcome" | "sqlstate" | "message" | "rows">;
  try {
    const res = await client.query(probe.sql);
    mapped = outcomeOf(probe, { rows: res.rowCount });
  } catch (err) {
    mapped = outcomeOf(probe, { error: err as { code?: string; message?: string } });
  } finally {
    await client.query("ROLLBACK").catch(() => {});
  }
  const { id, description, sql, expected } = probe;
  const ms = Math.round(performance.now() - start);
  return { id, description, sql, expected, ...mapped, ms };
}

export async function runProof(client: ProofClient, region: string): Promise<ProofReport> {
  const start = performance.now();
  const at = new Date().toISOString();
  const who = await client.query(WHO);
  const { role, owns } = who.rows[0] as { role: string; owns: boolean };
  const done = (fields: Partial<ProofReport>): ProofReport => ({
    ran: false,
    role,
    region,
    probes: [],
    at,
    ...fields,
    totalMs: Math.round(performance.now() - start),
  });

  if (role !== APP_ROLE) return done({ reason: `not run: connected as ${role}` });
  if (owns) return done({ reason: `not run: ${role} owns the ledger tables` });

  const probes: ProbeResult[] = [];
  for (const probe of PROOF_PROBES) probes.push(await attempt(client, probe));
  return done({ ran: true, probes });
}
