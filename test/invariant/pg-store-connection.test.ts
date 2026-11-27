import { EventEmitter } from "node:events";
import type { PoolClient } from "pg";
import { describe, expect, it } from "vitest";
import type { Connectable } from "@/db/client";
import { PgStore } from "@/db/pg-store";

function droppingPool() {
  const sent: string[] = [];
  const released: unknown[] = [];
  const client = Object.assign(new EventEmitter(), {
    query: async (text: string) => {
      sent.push(text);
      if (text === "COMMIT") {
        client.emit("error", new Error("Connection terminated unexpectedly"));
        throw Object.assign(new Error("internal error"), { code: "XX000" });
      }
      return { rows: [], rowCount: 0 };
    },
    release: (err?: unknown) => released.push(err),
  }) as unknown as PoolClient;
  const pool = {
    query: async () => ({ rows: [], rowCount: 0 }),
    connect: async () => client,
  } as unknown as Connectable;
  return { pool, sent, released };
}

describe("WA REL10-BP01: a transaction whose connection dies does not take the process with it", () => {
  it("rejects the spend, skips the rollback on a dead connection and discards it", async () => {
    const { pool, sent, released } = droppingPool();
    const store = new PgStore(pool);
    await expect(store.transaction(async () => "spent")).rejects.toThrow("internal error");
    expect(sent.at(-1)).toBe("COMMIT");
    expect(sent).not.toContain("ROLLBACK");
    expect((released[0] as Error).message).toBe("Connection terminated unexpectedly");
  });
});
