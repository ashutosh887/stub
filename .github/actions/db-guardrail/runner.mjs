import { appendFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";

const SQLSTATE = /^[0-9A-Z]{5}$/;
const PROBE_KEYS = new Set(["id", "sql", "expect", "description"]);
const TRANSACTION_CONTROL =
  /^\s*(begin|start|commit|end|rollback|abort|savepoint|release|prepare\s+transaction|commit\s+prepared|set\s+transaction)\b/i;
const IDENT = String.raw`(?:"(?:[^"]|"")+"|[a-z_][\w$]*)`;
const RELATION = new RegExp(
  String.raw`\b(?:from|update|into|join|table|truncate|on)\s+(?:(?:only|table|if\s+(?:not\s+)?exists)\s+)*(${IDENT}(?:\s*\.\s*${IDENT})?)`,
  "gi",
);
const DSQL_HOST = /\.dsql\.[a-z0-9-]+\.on\.aws$/i;

class Refusal extends Error {}

function fail(message) {
  throw new Refusal(message);
}

function loadProbes(file) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch (err) {
    fail(`cannot read probes from ${file}: ${err.message}`);
  }
  if (!Array.isArray(parsed) || parsed.length === 0) fail(`${file} must be a non-empty JSON array`);
  const seen = new Set();
  return parsed.map((probe, index) => {
    const where = `${file} [${index}]`;
    if (!probe || typeof probe !== "object") fail(`${where} is not an object`);
    for (const key of Object.keys(probe)) {
      if (!PROBE_KEYS.has(key)) fail(`${where} has unknown key "${key}"`);
    }
    const { id, sql, expect } = probe;
    if (typeof id !== "string" || !id.trim()) fail(`${where} needs a non-empty "id"`);
    if (seen.has(id)) fail(`${where} repeats id "${id}"`);
    seen.add(id);
    if (typeof sql !== "string" || !sql.trim()) fail(`${where} (${id}) needs a non-empty "sql"`);
    if (typeof expect !== "string" || !SQLSTATE.test(expect)) {
      fail(`${where} (${id}) needs "expect" to be a five-character SQLSTATE such as "42501"`);
    }
    if (TRANSACTION_CONTROL.test(sql)) {
      fail(
        `${where} (${id}) is a transaction control statement; the runner owns BEGIN and ROLLBACK`,
      );
    }
    return { id, sql, expect };
  });
}

function connectionConfig(url, password) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    fail("database-url is not a valid URL");
  }
  if (!/^postgres(ql)?:$/.test(parsed.protocol)) fail("database-url must start with postgres://");
  if (parsed.password) console.log(`::add-mask::${decodeURIComponent(parsed.password)}`);
  if (password) {
    console.log(`::add-mask::${password}`);
    parsed.password = encodeURIComponent(password);
  }
  const sslmode = parsed.searchParams.get("sslmode");
  if (DSQL_HOST.test(parsed.hostname)) {
    if (sslmode === "disable" || sslmode === "allow" || sslmode === "prefer") {
      fail("Aurora DSQL requires TLS; use sslmode=verify-full or leave sslmode out");
    }
    if (!sslmode) parsed.searchParams.set("sslmode", "verify-full");
  }
  return {
    connectionString: parsed.toString(),
    connectionTimeoutMillis: 15_000,
    query_timeout: 60_000,
  };
}

function relationsIn(sql) {
  const names = new Map();
  for (const match of sql.matchAll(RELATION)) {
    const parts = match[1]
      .match(new RegExp(IDENT, "gi"))
      .map((part) =>
        part.startsWith('"') ? part.slice(1, -1).replace(/""/g, '"') : part.toLowerCase(),
      );
    const [schema, table] = parts.length === 2 ? parts : [null, parts[0]];
    names.set(`${schema ?? ""}.${table}`, { schema, table });
  }
  return [...names.values()];
}

async function ownership(client, probes) {
  const who = await client.query(
    `SELECT current_user AS role,
            COALESCE((SELECT rolsuper FROM pg_roles WHERE rolname = current_user), false) AS superuser`,
  );
  const { role, superuser } = who.rows[0];
  const owned = new Set();
  const tables = new Map();
  for (const probe of probes) {
    for (const rel of relationsIn(probe.sql)) tables.set(`${rel.schema ?? ""}.${rel.table}`, rel);
  }
  for (const { schema, table } of tables.values()) {
    const { rows } = await client.query(
      `SELECT schemaname, tablename
         FROM pg_tables
        WHERE tablename = $1
          AND ($2::text IS NULL OR schemaname = $2::text)
          AND pg_has_role(current_user, tableowner, 'MEMBER')`,
      [table, schema],
    );
    for (const row of rows) owned.add(`${row.schemaname}.${row.tablename}`);
  }
  return { role, superuser, owned: [...owned].sort(), checked: tables.size };
}

function outcomeOf(probe, result) {
  if ("error" in result) {
    const code = typeof result.error.code === "string" && SQLSTATE.test(result.error.code);
    const message = String(result.error.message ?? "")
      .split("\n")[0]
      .slice(0, 300);
    if (!code) return { outcome: "error", got: "no SQLSTATE", message, pass: false };
    const sqlstate = result.error.code;
    if (sqlstate === probe.expect)
      return { outcome: "refused", got: sqlstate, message, pass: true };
    return { outcome: "wrong SQLSTATE", got: sqlstate, message, pass: false };
  }
  if (result.rows === 0) {
    return {
      outcome: "no row",
      got: "0 rows",
      message: "the statement matched no row, so it tested nothing",
      pass: false,
    };
  }
  const got = result.rows === null ? "accepted" : `accepted (${result.rows} rows)`;
  return {
    outcome: "ACCEPTED",
    got,
    message: "the database accepted it, then it was rolled back",
    pass: false,
  };
}

async function attempt(client, probe) {
  const start = performance.now();
  await client.query("BEGIN");
  let mapped;
  try {
    const res = await client.query({ text: probe.sql, queryMode: "extended" });
    mapped = outcomeOf(probe, { rows: res.rowCount ?? null });
  } catch (err) {
    mapped = outcomeOf(probe, { error: err });
  }
  await client.query("ROLLBACK");
  return { ...probe, ...mapped, ms: Math.round(performance.now() - start) };
}

function table(results) {
  const rows = [
    ["id", "expected", "got", "outcome"],
    ...results.map((r) => [r.id, r.expect, r.got, r.outcome]),
  ];
  const widths = rows[0].map((_, i) => Math.max(...rows.map((row) => row[i].length)));
  const line = (row) =>
    row
      .map((cell, i) => cell.padEnd(widths[i]))
      .join("  ")
      .trimEnd();
  return [
    line(rows[0]),
    widths.map((w) => "-".repeat(w)).join("  "),
    ...rows.slice(1).map(line),
  ].join("\n");
}

function cell(text) {
  return String(text).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function summary(markdown) {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (file) appendFileSync(file, `${markdown}\n`);
}

function annotate(level, message) {
  if (process.env.GITHUB_ACTIONS) console.log(`::${level}::${message.replace(/\r?\n/g, " ")}`);
  else console.error(`${level}: ${message}`);
}

async function main() {
  const url = process.env.GUARDRAIL_DATABASE_URL;
  const probesPath = process.env.GUARDRAIL_PROBES;
  const password = process.env.GUARDRAIL_PASSWORD || undefined;
  const requireNonOwner =
    (process.env.GUARDRAIL_REQUIRE_NON_OWNER ?? "true").trim().toLowerCase() !== "false";
  if (!url) fail("database-url is required");
  if (!probesPath) fail("probes is required");

  const file = resolve(process.env.GITHUB_WORKSPACE ?? process.cwd(), probesPath);
  const probes = loadProbes(file);
  const client = new pg.Client(connectionConfig(url, password));
  client.on("error", () => {});
  await client.connect();
  try {
    const who = await ownership(client, probes);
    console.log(`connected as ${who.role}${who.superuser ? " (superuser)" : ""}`);
    if (requireNonOwner && (who.superuser || who.owned.length > 0)) {
      const why = who.superuser
        ? `${who.role} is a superuser, so grants do not apply to it`
        : `${who.role} owns ${who.owned.join(", ")}, and an owner bypasses grants`;
      summary(`## Database guardrail\n\nNot run: ${why}. Connect as the application role.\n`);
      fail(`not run: ${why}; connect as the application role`);
    }
    if (!requireNonOwner)
      annotate(
        "warning",
        "require-non-owner is false; a probe on a table this role owns does not test its grants",
      );

    const results = [];
    for (const probe of probes) results.push(await attempt(client, probe));

    console.log(`\n${table(results)}\n`);
    const failed = results.filter((r) => !r.pass);
    for (const r of failed)
      annotate("error", `probe ${r.id}: expected ${r.expect}, got ${r.got}. ${r.message}`);

    summary(
      [
        "## Database guardrail",
        "",
        `Connected as \`${cell(who.role)}\`. ${results.length - failed.length} of ${results.length} probes refused with the expected SQLSTATE. Every probe ran inside BEGIN and ROLLBACK.`,
        "",
        "| id | expected | got | outcome | message |",
        "| --- | --- | --- | --- | --- |",
        ...results.map(
          (r) =>
            `| ${cell(r.id)} | ${r.expect} | ${cell(r.got)} | ${r.pass ? "pass" : `**${cell(r.outcome)}**`} | ${cell(r.message)} |`,
        ),
        "",
      ].join("\n"),
    );

    if (failed.length > 0) {
      fail(
        `${failed.length} of ${results.length} probes were not refused with the expected SQLSTATE`,
      );
    }
    console.log(`all ${results.length} probes refused with the expected SQLSTATE`);
  } finally {
    await client.end().catch(() => {});
  }
}

main().catch((err) => {
  annotate("error", err instanceof Refusal ? err.message : `db-guardrail failed: ${err.message}`);
  process.exit(1);
});
