export type QuerySource = "spend" | "denials";
export type GroupBy =
  | "none"
  | "vendor"
  | "account"
  | "agent"
  | "intent"
  | "costCenter"
  | "reason"
  | "day";
export type Metric = "total" | "count";

export interface LedgerQuery {
  source: QuerySource;
  account: string | null;
  vendor: string | null;
  agent: string | null;
  intent: string | null;
  reason: string | null;
  since: string | null;
  until: string | null;
  groupBy: GroupBy;
  metric: Metric;
  limit: number;
}

export const DEFAULT_LIMIT = 10;
export const MAX_LIMIT = 100;

const SOURCES: QuerySource[] = ["spend", "denials"];
const GROUP_BYS: GroupBy[] = [
  "none",
  "vendor",
  "account",
  "agent",
  "intent",
  "costCenter",
  "reason",
  "day",
];
const METRICS: Metric[] = ["total", "count"];

export const QUERY_TOOL = {
  name: "query_ledger",
  description:
    "Query the Stub spend ledger to answer a question about agent spending or denials. " +
    "Spend reads committed double-entry transactions; denials reads blocked spend attempts. " +
    "Set filters, a grouping dimension, and a metric. The account filter matches a spending " +
    "account by name OR its parent team — so 'marketing' matches Marketing's agents too.",
  input_schema: {
    type: "object" as const,
    additionalProperties: false,
    properties: {
      source: {
        type: "string",
        enum: SOURCES,
        description: "'spend' for committed spend, 'denials' for blocked attempts. Default 'spend'.",
      },
      account: {
        type: ["string", "null"],
        description: "Name of a spending account or team to filter by (matches account or its parent team). e.g. 'Marketing', 'research-agent'.",
      },
      vendor: {
        type: ["string", "null"],
        description: "Vendor name to filter by, e.g. 'Data API', 'LLM tokens'. Spend only.",
      },
      agent: {
        type: ["string", "null"],
        description: "Agent identifier recorded on the spend, e.g. 'research-agent'.",
      },
      intent: {
        type: ["string", "null"],
        description: "Substring to match against the spend intent, e.g. 'data API'.",
      },
      reason: {
        type: ["string", "null"],
        description: "Denial reason to filter by (denials only): cap_exceeded, per_txn_limit, window_limit, vendor_blocked, vendor_not_allowed, needs_approval, account_frozen.",
      },
      since: {
        type: ["string", "null"],
        description: "ISO-8601 timestamp lower bound (inclusive). Compute from the current timestamp for phrases like 'last night' or 'this week'.",
      },
      until: {
        type: ["string", "null"],
        description: "ISO-8601 timestamp upper bound (exclusive).",
      },
      groupBy: {
        type: "string",
        enum: GROUP_BYS,
        description:
          "Dimension to break the result down by. 'none' returns a single total. 'costCenter' " +
          "breaks spend down by chargeback cost center (team / customer / feature).",
      },
      metric: {
        type: "string",
        enum: METRICS,
        description: "'total' sums the dollar amount, 'count' counts the rows. Default 'total'.",
      },
      limit: {
        type: "integer",
        description: `Max rows to return (1-${MAX_LIMIT}). Default ${DEFAULT_LIMIT}.`,
      },
    },
    required: ["source", "groupBy", "metric"],
  },
};

function str(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function isoOrNull(value: unknown): string | null {
  const s = str(value);
  if (!s) return null;
  return Number.isNaN(Date.parse(s)) ? null : s;
}

function pick<T extends string>(value: unknown, allowed: T[], fallback: T): T {
  return typeof value === "string" && (allowed as string[]).includes(value) ? (value as T) : fallback;
}

export function normalizeLedgerQuery(raw: unknown): LedgerQuery {
  const r = (raw ?? {}) as Record<string, unknown>;
  let limit = Number(r.limit);
  if (!Number.isFinite(limit)) limit = DEFAULT_LIMIT;
  limit = Math.max(1, Math.min(MAX_LIMIT, Math.trunc(limit)));

  return {
    source: pick(r.source, SOURCES, "spend"),
    account: str(r.account),
    vendor: str(r.vendor),
    agent: str(r.agent),
    intent: str(r.intent),
    reason: str(r.reason),
    since: isoOrNull(r.since),
    until: isoOrNull(r.until),
    groupBy: pick(r.groupBy, GROUP_BYS, "none"),
    metric: pick(r.metric, METRICS, "total"),
    limit,
  };
}

const GROUP_PHRASE: Record<GroupBy, string> = {
  none: "",
  vendor: " by vendor",
  account: " by account",
  agent: " by agent",
  intent: " by intent",
  costCenter: " by cost center",
  reason: " by reason",
  day: " by day",
};

export function describeQuery(q: LedgerQuery): string {
  const noun = q.source === "denials" ? "denied spend" : "spend";
  const head = q.metric === "count" ? `Number of ${q.source === "denials" ? "denials" : "spends"}` : `Total ${noun}`;

  const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

  const clauses: string[] = [];
  if (q.account) clauses.push(`for ${cap(q.account)}`);
  if (q.vendor) clauses.push(`to ${q.vendor}`);
  if (q.agent) clauses.push(`by agent ${q.agent}`);
  if (q.intent) clauses.push(`matching "${q.intent}"`);
  if (q.reason) clauses.push(`reason ${q.reason}`);
  if (q.since) clauses.push(`since ${q.since.slice(0, 10)}`);
  if (q.until) clauses.push(`until ${q.until.slice(0, 10)}`);

  const filters = clauses.length ? ` ${clauses.join(", ")}` : "";
  return `${head}${GROUP_PHRASE[q.groupBy]}${filters}`;
}

// Vocabulary from the seed data — keep in sync if account/vendor names change.
const TEAM_NAMES = ["marketing", "engineering"];
const AGENT_NAMES = ["research-agent", "research agent", "coding-agent", "coding agent"];
const VENDOR_HINTS: Array<[RegExp, string]> = [
  [/data ?api|x402/, "Data API"],
  [/\bllm\b|token/, "LLM"],
];

function parseTime(q: string, nowMs: number): { since: string | null; until: string | null } {
  const startOfDay = (ms: number): Date => {
    const d = new Date(ms);
    d.setUTCHours(0, 0, 0, 0);
    return d;
  };
  const DAY = 86_400_000;
  if (/yesterday/.test(q)) {
    const today = startOfDay(nowMs);
    const yest = new Date(today.getTime() - DAY);
    return { since: yest.toISOString(), until: today.toISOString() };
  }
  if (/today/.test(q)) return { since: startOfDay(nowMs).toISOString(), until: null };
  if (/last night|overnight|past 24|last 24|past day/.test(q))
    return { since: new Date(nowMs - DAY).toISOString(), until: null };
  if (/last hour|past hour/.test(q)) return { since: new Date(nowMs - 3_600_000).toISOString(), until: null };
  if (/this week|past week|last week|last 7|7 days/.test(q))
    return { since: new Date(nowMs - 7 * DAY).toISOString(), until: null };
  if (/this month|past month|last month|last 30|30 days/.test(q))
    return { since: new Date(nowMs - 30 * DAY).toISOString(), until: null };
  return { since: null, until: null };
}

// Deterministic, dependency-free fallback for the natural-language box when no LLM is configured.
export function parseQuestion(question: string, nowMs: number): LedgerQuery {
  const q = question.toLowerCase();

  const source: QuerySource = /\b(denie|denial|deny|block|reject|refus)/.test(q) ? "denials" : "spend";
  const metric: Metric = /\b(how many|number of|count|times)\b/.test(q) ? "count" : "total";

  let groupBy: GroupBy = "none";
  if (/by reason|reasons|\bwhy\b/.test(q)) groupBy = "reason";
  else if (/by day|per day|daily|by date|each day/.test(q)) groupBy = "day";
  else if (/cost cent|chargeback|charge back|showback|show back|by customer|by feature|per customer|per feature/.test(q))
    groupBy = "costCenter";
  else if (/by intent|per intent|each intent/.test(q)) groupBy = "intent";
  else if (/by vendor|per vendor|each vendor|top vendor|vendors\b/.test(q)) groupBy = "vendor";
  else if (/which agent|by agent|per agent|each agent|top agent/.test(q)) groupBy = "agent";
  else if (/by team|per team|by account|each team|top team|teams\b/.test(q)) groupBy = "account";
  if (source === "denials" && groupBy === "vendor") groupBy = "reason";

  let account: string | null = null;
  for (const name of [...AGENT_NAMES, ...TEAM_NAMES]) {
    if (q.includes(name)) {
      account = name;
      break;
    }
  }

  let vendor: string | null = null;
  if (source === "spend") {
    for (const [re, label] of VENDOR_HINTS) {
      if (re.test(q)) {
        vendor = label;
        break;
      }
    }
  }

  const { since, until } = parseTime(q, nowMs);

  let limit = DEFAULT_LIMIT;
  const topN = q.match(/top\s+(\d+)/);
  if (topN) limit = Number(topN[1]);
  else if (/\btop\b/.test(q)) limit = 5;

  return normalizeLedgerQuery({ source, metric, groupBy, account, vendor, since, until, limit });
}

export interface SummaryRow {
  label: string;
  amountUsd: string;
  count: number;
}

export function summarize(rows: SummaryRow[], q: LedgerQuery): string {
  if (rows.length === 0) return "No matching activity found.";
  const desc = describeQuery(q);
  if (q.groupBy === "none") {
    const r = rows[0];
    return q.metric === "count" ? `${desc}: ${r.count}.` : `${desc}: $${r.amountUsd}.`;
  }
  const top = rows
    .slice(0, 5)
    .map((r) => (q.metric === "count" ? `${r.label} (${r.count})` : `${r.label} ($${r.amountUsd})`))
    .join(", ");
  return `${desc}: ${top}.`;
}
