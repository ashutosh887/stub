import { NextResponse } from "next/server";
import { answerSpendQuestion, openaiEnabled } from "@/lib/ai";
import { describeQuery, parseQuestion, summarize } from "@/core/query";
import { runLedgerQuery } from "@/lib/data";
import { microToUsd } from "@/lib/money";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface QueryBody {
  question?: string;
}

export async function POST(request: Request) {
  let body: QueryBody;
  try {
    body = (await request.json()) as QueryBody;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const question = (body.question ?? "").trim();
  if (!question) {
    return NextResponse.json({ error: "question is required" }, { status: 400 });
  }

  // Primary engine: OpenAI (when OPENAI_API_KEY is set). If it errors, fall back to the
  // deterministic local parser so the box always answers.
  try {
    if (openaiEnabled) {
      const result = await answerSpendQuestion(question);
      return NextResponse.json({ ...result, engine: "openai" });
    }
    throw new Error("OpenAI not configured");
  } catch (llmErr) {
    if (openaiEnabled) {
      console.warn("[query] OpenAI unavailable, using local parser:", (llmErr as Error).message);
    }
    try {
      const query = parseQuestion(question, Date.now());
      const raw = await runLedgerQuery(query);
      const rows = raw.map((r) => ({
        label: r.label,
        amountUsd: microToUsd(r.totalMicro),
        count: r.count,
      }));
      return NextResponse.json({
        answer: summarize(rows, query),
        description: describeQuery(query),
        query,
        rows,
        engine: "parser",
      });
    } catch (parserErr) {
      return NextResponse.json({ error: (parserErr as Error).message }, { status: 502 });
    }
  }
}
