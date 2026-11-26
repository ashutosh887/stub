import type { Pool, PoolClient } from "pg";
import { describe, expect, it } from "vitest";
import { type Endpoint, FailoverPool, isEndpointFailure } from "@/db/failover";

function fakePool(label: string) {
  const state = { failWith: null as null | { code?: string; message: string }, connects: 0 };
  const client = {
    query: async () => ({ rows: [{ label }], rowCount: 1 }),
    release: () => {},
  } as unknown as PoolClient;
  const pool = {
    connect: async () => {
      state.connects += 1;
      if (state.failWith) throw Object.assign(new Error(state.failWith.message), state.failWith);
      return client;
    },
    end: async () => {},
  } as unknown as Pool;
  return { pool, state };
}

function setup(failbackAfterMs = 60_000) {
  const primary = fakePool("primary");
  const peer = fakePool("peer");
  let clock = 0;
  const switches: string[] = [];
  const failover = new FailoverPool(
    { name: "primary", region: "us-east-1", pool: primary.pool } satisfies Endpoint,
    { name: "peer", region: "us-east-2", pool: peer.pool } satisfies Endpoint,
    {
      failbackAfterMs,
      probeTimeoutMs: 1_000,
      now: () => clock,
      onSwitch: ({ to }) => switches.push(to.name),
    },
  );
  return {
    failover,
    primary,
    peer,
    switches,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

describe("WA REL10-BP01, REL13-BP05: the pool moves to the peer Region on its own", () => {
  it("serves a call from the peer when the primary cannot be reached", async () => {
    const { failover, primary, switches } = setup();
    primary.state.failWith = { code: "ETIMEDOUT", message: "connect ETIMEDOUT" };
    const result = await failover.query<{ label: string }>("SELECT 1");
    expect(result.rows[0].label).toBe("peer");
    expect(failover.active.region).toBe("us-east-2");
    expect(switches).toEqual(["peer"]);
  });

  it("stays on the peer, without touching the primary, until the failback window passes", async () => {
    const { failover, primary } = setup();
    primary.state.failWith = { message: "timeout exceeded when trying to connect" };
    await failover.query("SELECT 1");
    const before = primary.state.connects;
    await failover.query("SELECT 1");
    await failover.query("SELECT 1");
    expect(primary.state.connects).toBe(before);
  });

  it("returns to the primary only after a probe answers", async () => {
    const { failover, primary, advance, switches } = setup(1_000);
    primary.state.failWith = { code: "ECONNREFUSED", message: "refused" };
    await failover.query("SELECT 1");
    advance(1_500);
    await failover.query("SELECT 1");
    await failover.probe();
    expect(failover.active.name).toBe("peer");
    primary.state.failWith = null;
    advance(1_500);
    await failover.query("SELECT 1");
    await failover.probe();
    expect(failover.active.name).toBe("primary");
    expect(switches).toEqual(["peer", "primary"]);
  });

  it("never switches on a SQL error, so OCC conflicts and CHECK refusals stay where they are", async () => {
    const { failover, primary } = setup();
    for (const code of ["40001", "23514", "42501"]) {
      primary.state.failWith = { code, message: "sql" };
      await expect(failover.connect()).rejects.toThrow("sql");
    }
    expect(failover.active.name).toBe("primary");
    expect(isEndpointFailure({ code: "08006", message: "connection failure" })).toBe(true);
    expect(isEndpointFailure({ code: "40001", message: "change conflicts" })).toBe(false);
  });
});
