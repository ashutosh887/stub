# trystub

> **One budget your agents can't break.**

[![npm version](https://img.shields.io/npm/v/trystub.svg)](https://www.npmjs.com/package/trystub)
[![npm downloads](https://img.shields.io/npm/dm/trystub.svg)](https://www.npmjs.com/package/trystub)
[![install size](https://packagephobia.com/badge?p=trystub)](https://packagephobia.com/result?p=trystub)
[![types](https://img.shields.io/npm/types/trystub.svg)](https://www.npmjs.com/package/trystub)
[![license](https://img.shields.io/npm/l/trystub.svg)](https://github.com/ashutosh887/stub/blob/main/sdk/LICENSE)

A drop-in budget gate for AI agents that spend real money: paid APIs, x402 micropayments, and LLM
tokens. Put one enforceable budget in front of your whole fleet and keep an exact, double-entry
record of what every agent spent. Zero dependencies, TypeScript-first, works with any runtime that
has `fetch`.

The hard part it solves: a naive retry around an irreversible payment double-charges. `trystub` uses
a **reserve → pay → settle** flow, so the payment fires exactly once, even under concurrent writers,
conflict retries, or a crash mid-flight.

```bash
npm install trystub
```

## Three lines in front of a paid call

```ts
import { StubClient } from "trystub";

const stub = new StubClient({ apiKey: process.env.STUB_API_KEY, baseUrl: process.env.STUB_URL });

if (await stub.guard({ vendorAccountId, amountUsd: 0.02, intent: "fetch market data" })) {
  await doThePaidThing();
}
```

## Exactly-once around an irreversible payment

When the payment itself can't be taken back, reserve first, pay once, then settle the real cost:

```ts
import { StubClient } from "trystub";
import { payThroughStub } from "trystub/x402";

const stub = new StubClient({ apiKey: process.env.STUB_API_KEY, baseUrl: process.env.STUB_URL });

const data = await payThroughStub(stub, vendorAccountId, {
  status: 402,
  priceUsd: 0.04,
  intent: "fetch market data",
  costCenter: "Marketing",
  pay: async () => {
    const res = await fetchPaidResource();
    return { result: res.body, actualUsd: res.chargedUsd };
  },
});
```

`payThroughStub` reserves the estimate against the budget, runs `pay()` exactly once, then settles
for the actual amount and refunds the difference. If the reservation is denied it throws
`BudgetDeniedError` and never pays; if `pay()` throws, the hold is released.

## Metering LLM tokens

Tokens are the spend most fleets actually have. `meterLLM` holds an estimate, runs the call once,
then settles the real token cost:

```ts
import { StubClient } from "trystub";
import { meterLLM, estimateUsd } from "trystub/llm";

const pricing = { inputPerMTok: 3, outputPerMTok: 15 };

const response = await meterLLM(
  stub,
  {
    vendorAccountId,
    pricing,
    estimatedUsd: estimateUsd(promptTokens, maxOutputTokens, pricing),
    model: "your-model",
    costCenter: "Marketing",
  },
  () => callTheModel(),
);
```

`usageFrom` reads both OpenAI-shaped (`prompt_tokens` / `completion_tokens`) and Anthropic-shaped
(`input_tokens` / `output_tokens`) responses, including cached-input tokens, and `costUsd` prices
them. **You supply the rates.** This package ships no price table on purpose: published prices go
stale, and a stale number in a dependency silently mis-bills you. If the response carries no usage,
the hold settles at the full estimate rather than guessing low.

## Reliability

Every call has a timeout and bounded retries on network errors, `429`, and `5xx`. Retries are safe
because the client attaches a generated `idempotencyKey` to each `spend` and `reserve`, so a request
that is retried after the server already committed it resolves to that same single ledger entry
instead of charging twice. Denials and `4xx` are never retried.

```ts
new StubClient({ baseUrl, apiKey, timeoutMs: 10_000, maxRetries: 2, retryDelayMs: 200 });
```

Set `maxRetries: 0` to disable retries; the client then sends no generated key.

## Operator actions

Two calls are for whoever runs the Stub deployment, not an agent's runtime: construct the client
with the server's `ADMIN_TOKEN` as `apiKey` instead of an agent's scoped key.

```ts
const admin = new StubClient({
  apiKey: process.env.STUB_ADMIN_TOKEN,
  baseUrl: process.env.STUB_URL,
});

await admin.sweep(); // reclaim reservations left held past the server's TTL; run on a schedule
await admin.provisionShards(accountId); // split a hot budget across shard rows for throughput
```

`provisionShards` shards whatever the account's balance is right now, and refuses to run twice on
the same account. If you shard a budget account, shard every vendor account it pays too — a sharded
spend errors if either side of the pair isn't sharded.

## API

- `new StubClient({ apiKey?, baseUrl?, fetch?, timeoutMs?, maxRetries?, retryDelayMs? })`
- `stub.guard(input): Promise<boolean>`: true only if the spend committed
- `stub.spend(input): Promise<SpendResult>`: single-shot debit
- `stub.reserve(input): Promise<ReserveResult>`: hold funds against the cap
- `stub.settle(reservationId, actualUsd?): Promise<SettleResult>`: book the real cost
- `stub.release(reservationId): Promise<ReleaseResult>`: return a hold
- `stub.sweep(): Promise<SweepResult>`: operator-only, reclaim expired holds
- `stub.provisionShards(accountId, shards?): Promise<ShardAccountResult>`: operator-only, shard an account

`input` accepts `{ vendorAccountId, amountUsd, intent?, costCenter?, idempotencyKey?, budgetAccountId?, receipt? }`.
A scoped API key pins spends to one budget account; without one, pass `budgetAccountId` and
authenticate as an admin.

Ships as both ESM and CommonJS, so `import` and `require` both work.

## Links

- Live console: [trystub.vercel.app](https://trystub.vercel.app)
- Source: [github.com/ashutosh887/stub](https://github.com/ashutosh887/stub)
- Changelog: [CHANGELOG.md](https://github.com/ashutosh887/stub/blob/main/sdk/CHANGELOG.md)
- How it was built: [the build story on Hashnode](https://ashutosh887.hashnode.dev/building-a-budget-your-ai-agents-physically-cannot-overspend-on-aurora-dsql)

## License

MIT
