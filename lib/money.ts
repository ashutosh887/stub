export const MICRO_PER_USD = 1_000_000n;

export function usdToMicro(usd: string | number): bigint {
  const normalized = typeof usd === "number" ? usd.toString() : usd.trim();
  if (!/^\d+(\.\d+)?$/.test(normalized)) {
    throw new Error(`invalid USD amount: ${usd}`);
  }
  const [whole, frac = ""] = normalized.split(".");
  const micros = (frac + "000000").slice(0, 6);
  return BigInt(whole) * MICRO_PER_USD + BigInt(micros);
}

export function microToUsd(micro: bigint): string {
  const negative = micro < 0n;
  const abs = negative ? -micro : micro;
  const whole = abs / MICRO_PER_USD;
  const frac = (abs % MICRO_PER_USD).toString().padStart(6, "0").replace(/0+$/, "") || "0";
  return `${negative ? "-" : ""}${whole}.${frac}`;
}

export function formatUsd(micro: bigint): string {
  const dollars = Number(micro) / 1_000_000;
  return dollars.toLocaleString("en-US", { style: "currency", currency: "USD" });
}
