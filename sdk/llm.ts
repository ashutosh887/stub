import type { StubClient } from "./index.js";
import { BudgetDeniedError } from "./index.js";

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
}

export interface TokenPricing {
  inputPerMTok: number;
  outputPerMTok: number;
  cachedInputPerMTok?: number;
}

export interface MeterOptions {
  vendorAccountId: string;
  pricing: TokenPricing;
  estimatedUsd: number | string;
  model?: string;
  intent?: string;
  costCenter?: string;
  receipt?: unknown;
}

const PER_MTOK = 1_000_000;

export function costUsd(usage: TokenUsage, pricing: TokenPricing): number {
  const cached = usage.cachedInputTokens ?? 0;
  const freshInput = Math.max(0, usage.inputTokens - cached);
  const cachedRate = pricing.cachedInputPerMTok ?? pricing.inputPerMTok;

  const total =
    (freshInput * pricing.inputPerMTok) / PER_MTOK +
    (cached * cachedRate) / PER_MTOK +
    (usage.outputTokens * pricing.outputPerMTok) / PER_MTOK;

  return Math.round(total * PER_MTOK) / PER_MTOK;
}

export function estimateUsd(
  inputTokens: number,
  maxOutputTokens: number,
  pricing: TokenPricing,
): number {
  return costUsd({ inputTokens, outputTokens: maxOutputTokens }, pricing);
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function usageFrom(response: unknown): TokenUsage | null {
  const usage = (response as { usage?: Record<string, unknown> } | null)?.usage;
  if (!usage) return null;

  const inputTokens = num(usage.inputTokens) ?? num(usage.input_tokens) ?? num(usage.prompt_tokens);
  const outputTokens =
    num(usage.outputTokens) ?? num(usage.output_tokens) ?? num(usage.completion_tokens);
  if (inputTokens === undefined || outputTokens === undefined) return null;

  const promptDetails = usage.prompt_tokens_details as Record<string, unknown> | undefined;
  const cachedInputTokens =
    num(usage.cachedInputTokens) ??
    num(usage.cache_read_input_tokens) ??
    num(promptDetails?.cached_tokens);

  return cachedInputTokens === undefined
    ? { inputTokens, outputTokens }
    : { inputTokens, outputTokens, cachedInputTokens };
}

export async function meterLLM<T>(
  stub: StubClient,
  options: MeterOptions,
  call: () => Promise<T>,
): Promise<T> {
  const reserved = await stub.reserve({
    vendorAccountId: options.vendorAccountId,
    amountUsd: options.estimatedUsd,
    intent: options.intent ?? (options.model ? `llm call: ${options.model}` : "llm call"),
    costCenter: options.costCenter,
    receipt: options.receipt ?? (options.model ? { model: options.model } : undefined),
  });
  if (reserved.status !== "reserved") {
    throw new BudgetDeniedError(reserved, options.vendorAccountId);
  }

  let response: T;
  try {
    response = await call();
  } catch (err) {
    await stub.release(reserved.reservationId).catch(() => {});
    throw err;
  }

  const usage = usageFrom(response);
  const actualUsd = usage ? costUsd(usage, options.pricing) : undefined;
  await stub.settle(reserved.reservationId, actualUsd);

  return response;
}
