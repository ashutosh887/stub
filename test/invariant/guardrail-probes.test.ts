import { describe, expect, it } from "vitest";
import probes from "@/test/guardrail/probes.json";
import { PROOF_PROBES } from "@/lib/proof";

describe("the guardrail action sends the same probes as /proof", () => {
  it("matches PROOF_PROBES statement for statement", () => {
    expect(probes).toEqual(
      PROOF_PROBES.map(({ id, description, sql, expected }) => ({
        id,
        description,
        sql,
        expect: expected,
      })),
    );
  });
});
