import { describe, expect, it } from "vitest";
import { KEY_PREFIX, generateApiKey, hashApiKey, keysMatch } from "@/core/apikey";

describe("agent api keys", () => {
  it("mints a prefixed key whose hash verifies and whose plaintext is not the hash", () => {
    const key = generateApiKey();
    expect(key.plaintext.startsWith(KEY_PREFIX)).toBe(true);
    expect(key.hash).not.toBe(key.plaintext);
    expect(key.preview).toBe(key.plaintext.slice(-4));
    expect(keysMatch(key.plaintext, key.hash)).toBe(true);
  });

  it("rejects a wrong key and a mismatched hash", () => {
    const a = generateApiKey();
    const b = generateApiKey();
    expect(keysMatch(b.plaintext, a.hash)).toBe(false);
    expect(hashApiKey(a.plaintext)).toBe(a.hash);
  });
});
