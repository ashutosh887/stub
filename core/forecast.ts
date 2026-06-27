export interface BurnEvent {
  amountMicro: bigint;
  atMs: number;
}

export interface ForecastInput {
  balanceMicro: bigint;
  events: BurnEvent[];
  nowMs: number;
  lookbackMs?: number;
}

export interface Forecast {
  ratePerDayMicro: bigint;
  daysToDepletion: number | null;
}

const DAY_MS = 86_400_000;
const DEFAULT_LOOKBACK_MS = 7 * DAY_MS;

export function forecast(input: ForecastInput): Forecast {
  const lookbackMs = input.lookbackMs ?? DEFAULT_LOOKBACK_MS;
  const cutoff = input.nowMs - lookbackMs;
  const recent = input.events.filter((e) => e.atMs >= cutoff);

  let spent = 0n;
  let earliest = input.nowMs;
  for (const e of recent) {
    spent += e.amountMicro;
    if (e.atMs < earliest) earliest = e.atMs;
  }

  if (spent <= 0n) return { ratePerDayMicro: 0n, daysToDepletion: null };

  const spanMs = Math.max(input.nowMs - earliest, 1);
  const ratePerDay = (Number(spent) / spanMs) * DAY_MS;
  const daysToDepletion =
    ratePerDay > 0 && input.balanceMicro > 0n ? Number(input.balanceMicro) / ratePerDay : null;

  return { ratePerDayMicro: BigInt(Math.round(ratePerDay)), daysToDepletion };
}
