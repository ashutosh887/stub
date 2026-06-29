import { NextResponse } from "next/server";
import { answerSpendQuestion, openaiEnabled } from "@/lib/ai";
import { describeQuery, parseQuestion, summarize } from "@/core/query";
import {
  getCachedQuery,
  ledgerFingerprint,
  putCachedQuery,
  queryCacheKey,
  runLedgerQuery,
} from "@/lib/data";
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

    const key = queryCacheKey(question, await ledgerFingerprint());
    const cached = await getCachedQuery(key);
    if (cached) {
      return NextResponse.json({ ...cached, engine: "cache" });
    }

    let payload: Record<string, unknown>;
    try {
      if (!openaiEnabled) throw new Error("OpenAI not configured");
      const result = await answerSpendQuestion(question);
      payload = { ...result, engine: "openai" };
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
        payload = {
          answer: summarize(rows, query),
          description: describeQuery(query),
          query,
          rows,
          engine: "parser",
        };
      } catch (parserErr) {
        throw new HttpError(502, (parserErr as Error).message);
      }
    }

    await putCachedQuery(key, question, payload);
    return NextResponse.json(payload);
  },
);
