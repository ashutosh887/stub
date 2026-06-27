import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const KEY_PREFIX = "stub_sk_";

export interface GeneratedKey {
  plaintext: string;
  hash: string;
  preview: string;
}

export function generateApiKey(): GeneratedKey {
  const plaintext = KEY_PREFIX + randomBytes(24).toString("base64url");
  return { plaintext, hash: hashApiKey(plaintext), preview: plaintext.slice(-4) };
}

export function hashApiKey(plaintext: string): string {
  return createHash("sha256").update(plaintext.trim()).digest("hex");
}

export function keysMatch(plaintext: string, hash: string): boolean {
  const candidate = Buffer.from(hashApiKey(plaintext), "hex");
  const expected = Buffer.from(hash, "hex");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}
