export type BurnState = "ok" | "notice" | "warn" | "critical";

export interface BurnStatus {
  pct: number;
  state: BurnState;
}

export function burnStatus(capMicro: bigint | null, balanceMicro: bigint): BurnStatus {
  if (capMicro == null || capMicro <= 0n) return { pct: 0, state: "ok" };
  const spent = capMicro - balanceMicro;
  const clamped = spent < 0n ? 0n : spent;
  const pct = Math.min(100, Math.round(Number((clamped * 10000n) / capMicro) / 100));
  return { pct, state: stateFor(pct) };
}

function stateFor(pct: number): BurnState {
  if (pct >= 100) return "critical";
  if (pct >= 80) return "warn";
  if (pct >= 50) return "notice";
  return "ok";
}
