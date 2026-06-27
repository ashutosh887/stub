import "server-only";
import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import {
  QUERY_TOOL,
  describeQuery,
  normalizeLedgerQuery,
  type LedgerQuery,
} from "@/core/query";
import { runLedgerQuery } from "@/lib/data";
import { microToUsd } from "@/lib/money";
import { openai } from "@/config";

const MODEL = openai.model;

export const openaiEnabled = openai.enabled;

let client: OpenAI | undefined;
function getClient(): OpenAI {
  if (!client) client = new OpenAI({ apiKey: openai.apiKey });
  return client;
}

export interface AskResultRow {
  label: string;
  amountUsd: string;
  count: number;
}

export interface AskResult {
  answer: string;
  description: string;
  query: LedgerQuery;
  rows: AskResultRow[];
}

function systemPrompt(now: string): string {
  return [
    "You are the analytics copilot for Stub, a spend control plane for AI agents.",
    `The current timestamp is ${now}.`,
    "The organization has teams (Marketing, Engineering); agents are nested under teams " +
      "(research-agent under Marketing, coding-agent under Engineering); vendors include " +
      "'Data API (x402)' and 'LLM tokens'.",
    "Call the query_ledger function exactly once to fetch real data before answering. The account " +
      "filter matches a team or any agent under it. For relative times like 'last night' or " +
      "'this week', compute ISO-8601 timestamps from the current timestamp.",
    "After the function result returns, reply in one or two plain sentences citing the concrete " +
      "figures. Never invent numbers that are not in the results.",
  ].join(" ");
}

export async function answerSpendQuestion(question: string): Promise<AskResult> {
  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt(new Date().toISOString()) },
    { role: "user", content: question },
  ];
  const tools = [
    {
      type: "function" as const,
      function: {
        name: QUERY_TOOL.name,
        description: QUERY_TOOL.description,
        parameters: QUERY_TOOL.input_schema,
      },
    },
  ];

  let first;
  try {
    first = await getClient().chat.completions.create({
      model: MODEL,
      messages,
      tools,
      tool_choice: { type: "function", function: { name: QUERY_TOOL.name } },
    });
  } catch (err) {
    throw describeError(err);
  }

  const message = first.choices[0]?.message;
  const call = message?.tool_calls?.[0];
  if (!call || call.type !== "function") {
    throw new Error("The model did not produce a structured query.");
  }

  const query = normalizeLedgerQuery(safeParse(call.function.arguments));
  const description = describeQuery(query);
  const raw = await runLedgerQuery(query);
  const rows: AskResultRow[] = raw.map((r) => ({
    label: r.label,
    amountUsd: microToUsd(r.totalMicro),
    count: r.count,
  }));

  let answer = "";
  try {
    const second = await getClient().chat.completions.create({
      model: MODEL,
      messages: [
        ...messages,
        message,
        {
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify({ interpreted: description, results: rows }),
        },
      ],
    });
    answer = second.choices[0]?.message?.content ?? "";
  } catch (err) {
    throw describeError(err);
  }

  return { answer: answer.trim() || fallbackAnswer(rows, query), description, query, rows };
}

function safeParse(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return {};
  }
}

function fallbackAnswer(rows: AskResultRow[], query: LedgerQuery): string {
  if (rows.length === 0) return "No matching activity found in the ledger.";
  if (query.groupBy === "none") {
    const r = rows[0];
    return query.metric === "count"
      ? `${r.count} matching ${query.source === "denials" ? "denials" : "spends"}.`
      : `$${r.amountUsd} total.`;
  }
  return rows
    .map((r) => (query.metric === "count" ? `${r.label}: ${r.count}` : `${r.label}: $${r.amountUsd}`))
    .join(" · ");
}

function describeError(err: unknown): Error {
  const message = err instanceof Error ? err.message : String(err);
  const status = (err as { status?: number } | null)?.status;
  if (status === 401 || /api key|incorrect.*key|unauthor/i.test(message)) {
    return new Error(`OpenAI rejected the key — check OPENAI_API_KEY. (${message})`);
  }
  if (status === 404 || /model.*(not found|does not exist)/i.test(message)) {
    return new Error(`Model "${MODEL}" not available on this account. Set OPENAI_MODEL. (${message})`);
  }
  if (status === 429 || /quota|rate limit/i.test(message)) {
    return new Error(`OpenAI quota/rate limit hit for ${MODEL}. (${message})`);
  }
  return new Error(`OpenAI call failed (${MODEL}): ${message}`);
}
