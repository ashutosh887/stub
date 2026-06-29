import type { ReserveResult, StubClient } from "./index";

export class BudgetDeniedError extends Error {
  constructor(
    readonly result: ReserveResult,
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
  costCenter?: string;
  receipt?: unknown;
  pay: () => Promise<{ result: unknown; actualUsd?: number | string }>;
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

  const reserved = await stub.reserve({
    vendorAccountId,
    amountUsd: exchange.priceUsd,
    intent: exchange.intent,
    costCenter: exchange.costCenter,
    receipt: exchange.receipt,
  });
  if (reserved.status !== "reserved") {
    throw new BudgetDeniedError(reserved, vendorAccountId);
  }

  let paid: { result: unknown; actualUsd?: number | string };
  try {
    paid = await exchange.pay();
  } catch (err) {
    await stub.release(reserved.reservationId).catch(() => {});
    throw err;
  }

  await stub.settle(reserved.reservationId, paid.actualUsd);
  return paid.result;
}

export function mockX402Resource(priceUsd: number | string, body: unknown): () => PaidExchange {
  return () => ({
    status: 402,
    priceUsd,
    intent: "x402 micropayment",
    receipt: { rail: "x402", network: "base-sepolia", priceUsd },
    pay: async () => ({ result: body, actualUsd: priceUsd }),
  });
}
