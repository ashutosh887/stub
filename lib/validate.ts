import { usdToMicro } from "@/lib/money";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

export function requireUuid(value: unknown, field: string): string {
  if (!isUuid(value)) throw new ValidationError(`${field} must be a valid id`);
  return value;
}

export function parseSpendAmount(value: unknown, maxMicro: bigint): bigint {
  if (value === undefined || value === null || value === "") {
    throw new ValidationError("amountUsd is required");
  }
  let micro: bigint;
  try {
    micro = usdToMicro(value as string | number);
  } catch {
    throw new ValidationError("amountUsd must be a valid USD amount");
  }
  if (micro <= 0n) throw new ValidationError("amountUsd must be positive");
  if (micro > maxMicro) throw new ValidationError("amountUsd exceeds the maximum allowed");
  return micro;
}

export function ensureWithinSize(value: unknown, maxBytes: number, field: string): void {
  if (value === undefined || value === null) return;
  if (Buffer.byteLength(JSON.stringify(value)) > maxBytes) {
    throw new ValidationError(`${field} exceeds the maximum size of ${maxBytes} bytes`);
  }
}

export function requireText(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new ValidationError(`${field} is required`);
  }
  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    throw new ValidationError(`${field} must be ${maxLength} characters or fewer`);
  }
  return trimmed;
}
