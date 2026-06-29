# trystub

> **One budget your agents can't break.**

A drop-in budget gate for AI agents that spend real money: paid APIs, x402 micropayments, and LLM
tokens. Put one enforceable budget in front of your whole fleet and keep an exact, double-entry
record of what every agent spent.

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

## API

- `new StubClient({ apiKey?, baseUrl?, fetch? })`
- `stub.guard(input): Promise<boolean>`: true only if the spend committed
- `stub.spend(input): Promise<SpendResult>`: single-shot debit
- `stub.reserve(input): Promise<ReserveResult>`: hold funds against the cap
- `stub.settle(reservationId, actualUsd?): Promise<SettleResult>`: book the real cost
- `stub.release(reservationId): Promise<ReleaseResult>`: return a hold

`input` accepts `{ vendorAccountId, amountUsd, intent?, costCenter?, idempotencyKey?, budgetAccountId?, receipt? }`.
A scoped API key pins spends to one budget account; without one, pass `budgetAccountId` and
authenticate as an admin.

## Links

- Live console: [trystub.vercel.app](https://trystub.vercel.app)
- Source: [github.com/ashutosh887/stub](https://github.com/ashutosh887/stub)

## License

MIT
