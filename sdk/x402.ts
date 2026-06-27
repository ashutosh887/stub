import type { SpendResult, StubClient } from "./index";

export class BudgetDeniedError extends Error {
  constructor(
    readonly result: SpendResult,
    readonly vendorAccountId: string,
  ) {
    super(`budget gate denied spend (${result.reason ?? "denied"})`);
    this.name = "BudgetDeniedError";
  }
}

export interface PaymentRequired {
  status: 402;
  priceUsd: number | string;
  intent?: string;
  receipt?: unknown;
  pay: () => Promise<unknown>;
}

export interface PaymentSettled {
  status: 200;
  result: unknown;
}

export type PaidExchange = PaymentRequired | PaymentSettled;

export async function payThroughStub(
  stub: StubClient,
  vendorAccountId: string,
  exchange: PaidExchange,
): Promise<unknown> {
  if (exchange.status === 200) return exchange.result;

  const result = await stub.spend({
    vendorAccountId,
    amountUsd: exchange.priceUsd,
    intent: exchange.intent,
    receipt: exchange.receipt,
  });
  if (result.status !== "committed") {
    throw new BudgetDeniedError(result, vendorAccountId);
  }
  return exchange.pay();
}

export function mockX402Resource(priceUsd: number | string, body: unknown): () => PaidExchange {
  return () => ({
    status: 402,
    priceUsd,
    intent: "x402 micropayment",
    receipt: { rail: "x402", network: "base-sepolia", priceUsd },
    pay: async () => body,
  });
}
