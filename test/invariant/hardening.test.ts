import { afterEach, describe, expect, it } from "vitest";
import { rateLimit, resetRateLimits } from "@/lib/rate-limit";
import { redact } from "@/lib/log";
import {
  ValidationError,
  ensureWithinSize,
  isUuid,
  parseSpendAmount,
  requireText,
} from "@/lib/validate";

const USD = 1_000_000n;

afterEach(() => {
  resetRateLimits();
  delete process.env.ADMIN_TOKEN;
});

describe("rate limiter", () => {
  it("allows up to max within a window, then blocks until reset", () => {
    const now = 1_000;
    for (let i = 0; i < 3; i += 1) {
      expect(rateLimit("k", 3, 1000, now).ok).toBe(true);
    }
    expect(rateLimit("k", 3, 1000, now).ok).toBe(false);
    expect(rateLimit("k", 3, 1000, now + 1001).ok).toBe(true); // window rolled over
  });

  it("isolates buckets by key", () => {
    expect(rateLimit("a", 1, 1000, 0).ok).toBe(true);
    expect(rateLimit("a", 1, 1000, 0).ok).toBe(false);
    expect(rateLimit("b", 1, 1000, 0).ok).toBe(true);
  });
});

describe("log redaction", () => {
  it("masks sensitive keys and stub_sk_ values, stringifies bigints", () => {
    const out = redact({
      authorization: "Bearer secret",
      apiKey: "x",
      key: "stub_sk_abc123",
      amountMicro: 5n,
      ok: "visible",
    });
    expect(out.authorization).toBe("[redacted]");
    expect(out.apiKey).toBe("[redacted]");
    expect(out.key).toBe("[redacted]");
    expect(out.amountMicro).toBe("5");
    expect(out.ok).toBe("visible");
  });
});

describe("validation", () => {
  it("validates UUIDs", () => {
    expect(isUuid("3bfd0c1a-0000-4000-8000-000000000000")).toBe(true);
    expect(isUuid("not-a-uuid")).toBe(false);
    expect(isUuid(123)).toBe(false);
  });

  it("parses spend amounts with bounds", () => {
    expect(parseSpendAmount("1.50", 10n * USD)).toBe(1_500_000n);
    expect(() => parseSpendAmount("0", 10n * USD)).toThrow(ValidationError);
    expect(() => parseSpendAmount("100", 10n * USD)).toThrow(ValidationError); // over max
    expect(() => parseSpendAmount("abc", 10n * USD)).toThrow(ValidationError);
    expect(() => parseSpendAmount(undefined, 10n * USD)).toThrow(ValidationError);
  });

  it("enforces size and text bounds", () => {
    expect(() => ensureWithinSize({ big: "x".repeat(100) }, 10, "receipt")).toThrow(
      ValidationError,
    );
    expect(ensureWithinSize(undefined, 10, "receipt")).toBeUndefined();
    expect(requireText("  hi  ", "q", 10)).toBe("hi");
    expect(() => requireText("", "q", 10)).toThrow(ValidationError);
    expect(() => requireText("x".repeat(20), "q", 10)).toThrow(ValidationError);
  });
});

describe("admin auth guard", () => {
  it("is open when ADMIN_TOKEN is unset, enforced when set", async () => {
    const { isAdmin } = await import("@/lib/api");
    const bare = new Request("http://x");
    expect(isAdmin(bare)).toBe(true); // no token configured → open

    process.env.ADMIN_TOKEN = "s3cret";
    expect(isAdmin(bare)).toBe(false);
    expect(isAdmin(new Request("http://x", { headers: { authorization: "Bearer s3cret" } }))).toBe(
      true,
    );
    expect(isAdmin(new Request("http://x", { headers: { cookie: "stub_admin=s3cret" } }))).toBe(
      true,
    );
    expect(isAdmin(new Request("http://x", { headers: { authorization: "Bearer wrong" } }))).toBe(
      false,
    );
  });
});
