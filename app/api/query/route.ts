import { NextResponse } from "next/server";
import { answerSpendQuestion, openaiEnabled } from "@/lib/ai";
import { describeQuery, parseQuestion, summarize } from "@/core/query";
import { runLedgerQuery } from "@/lib/data";
import { microToUsd } from "@/lib/money";
import { limits } from "@/config";
import { HttpError, readJson, withRoute } from "@/lib/api";
import { log } from "@/lib/log";
import { requireText } from "@/lib/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withRoute(
  { name: "query", admin: true, rateLimitMax: limits.rateLimitQueryMax },
  async ({ request, requestId }) => {
    const body = await readJson<{ question?: string }>(request);
    const question = requireText(body.question, "question", limits.maxQuestionLength);

    try {
      if (!openaiEnabled) throw new Error("OpenAI not configured");
      const result = await answerSpendQuestion(question);
      return NextResponse.json({ ...result, engine: "openai" });
    } catch (llmErr) {
      if (openaiEnabled) {
        log.warn("query_openai_fallback", { requestId, error: (llmErr as Error).message });
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
        throw new HttpError(502, (parserErr as Error).message);
      }
    }
  },
);
