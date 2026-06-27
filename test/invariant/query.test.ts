import { describe, expect, it } from "vitest";
import { MAX_LIMIT, describeQuery, normalizeLedgerQuery, parseQuestion, summarize } from "@/core/query";

const NOW = Date.parse("2026-06-26T12:00:00Z");

describe("normalizeLedgerQuery", () => {
  it("fills defaults for an empty input", () => {
    const q = normalizeLedgerQuery({});
    expect(q).toMatchObject({ source: "spend", groupBy: "none", metric: "total", limit: 10 });
    expect(q.account).toBeNull();
  });

  it("whitelists enums and clamps the limit", () => {
    const q = normalizeLedgerQuery({ source: "evil", groupBy: "drop", metric: "x", limit: 9999 });
    expect(q).toMatchObject({ source: "spend", groupBy: "none", metric: "total", limit: MAX_LIMIT });
  });

  it("drops unparseable timestamps but keeps valid ISO", () => {
    const q = normalizeLedgerQuery({ since: "not-a-date", until: "2026-06-26T00:00:00Z" });
    expect(q.since).toBeNull();
    expect(q.until).toBe("2026-06-26T00:00:00Z");
  });

  it("trims string filters and nulls empties", () => {
    const q = normalizeLedgerQuery({ account: "  Marketing  ", vendor: "   " });
    expect(q.account).toBe("Marketing");
    expect(q.vendor).toBeNull();
  });
});

describe("describeQuery", () => {
  it("renders a readable description with grouping and filters", () => {
    const q = normalizeLedgerQuery({
      source: "spend",
      groupBy: "vendor",
      metric: "total",
      account: "Marketing",
      intent: "data API",
    });
    expect(describeQuery(q)).toBe('Total spend by vendor for Marketing, matching "data API"');
  });

  it("describes a denial count query grouped by reason", () => {
    const q = normalizeLedgerQuery({ source: "denials", metric: "count", groupBy: "reason" });
    expect(describeQuery(q)).toBe("Number of denials by reason");
  });
});

describe("parseQuestion (no-LLM fallback)", () => {
  it("parses a team + vendor spend question", () => {
    const q = parseQuestion("How much did Marketing's agents spend on data APIs?", NOW);
    expect(q).toMatchObject({ source: "spend", metric: "total", groupBy: "none", account: "marketing", vendor: "Data API" });
  });

  it("parses 'top vendors by spend'", () => {
    const q = parseQuestion("Top vendors by spend", NOW);
    expect(q).toMatchObject({ groupBy: "vendor", source: "spend", limit: 5 });
  });

  it("parses 'which agent spent the most'", () => {
    expect(parseQuestion("Which agent spent the most?", NOW).groupBy).toBe("agent");
  });

  it("routes denial questions to the denials source grouped by reason", () => {
    const q = parseQuestion("How much spend got denied, and why?", NOW);
    expect(q).toMatchObject({ source: "denials", groupBy: "reason" });
  });

  it("resolves relative time windows from the given now", () => {
    expect(parseQuestion("spend yesterday", NOW)).toMatchObject({
      since: "2026-06-25T00:00:00.000Z",
      until: "2026-06-26T00:00:00.000Z",
    });
  });
});

describe("summarize", () => {
  it("states a single total", () => {
    const q = normalizeLedgerQuery({ groupBy: "none", account: "Marketing" });
    expect(summarize([{ label: "Total", amountUsd: "12.4", count: 3 }], q)).toBe(
      "Total spend for Marketing: $12.4.",
    );
  });

  it("lists grouped rows", () => {
    const q = normalizeLedgerQuery({ groupBy: "vendor" });
    const rows = [
      { label: "Data API", amountUsd: "12.4", count: 3 },
      { label: "LLM tokens", amountUsd: "3.1", count: 2 },
    ];
    expect(summarize(rows, q)).toBe("Total spend by vendor: Data API ($12.4), LLM tokens ($3.1).");
  });

  it("handles no results", () => {
    expect(summarize([], normalizeLedgerQuery({}))).toBe("No matching activity found.");
  });
});
