import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as store from "./store";
import { createOrder } from "./actions";

const g = globalThis as unknown as { __kesuniSqlite?: { close(): void } };
/** Close the cached connection so the next store call reopens the file (like a server restart). */
function closeDb() {
  g.__kesuniSqlite?.close();
  g.__kesuniSqlite = undefined;
}
const realOrder = () =>
  createOrder({ product: "Lamp for Ibu Rina", quantity: 1, deadline: "2026-10-08", designVersion: "v2", mandateMicro: 50_000_000, label: "real" });

beforeEach(store.resetDb);

describe("persistence", () => {
  let dir = "";
  afterEach(() => {
    closeDb();
    process.env.KESUNI_DB_PATH = ":memory:";
    rmSync(dir, { recursive: true, force: true });
  });

  it("keeps orders after the server restarts (new connection to the same file)", () => {
    closeDb();
    dir = mkdtempSync(path.join(tmpdir(), "kesuni-"));
    process.env.KESUNI_DB_PATH = path.join(dir, "test.db");

    const r = realOrder();
    expect(r.ok).toBe(true);
    const id = r.ok ? r.order.id : "";

    closeDb(); // simulate a restart
    expect(store.getOrder(id)?.product).toBe("Lamp for Ibu Rina");
    expect(store.getOrder("ORD-001")?.label).toBe("simulated"); // seeded once, not duplicated
    expect(store.listOrders()).toHaveLength(2);
  }, 20_000); // a real SQLite file on Windows can take seconds to create (antivirus, busy disk)
});

describe("resetSimulated", () => {
  it("restores the demo order but never deletes a real order", () => {
    const r = realOrder();
    const realId = r.ok ? r.order.id : "";
    store.saveOrder({ ...store.getOrder("ORD-001")!, status: "ACCEPTED" });

    store.resetSimulated();

    expect(store.getOrder(realId)?.label).toBe("real");
    expect(store.getOrder("ORD-001")?.status).toBe("CREATED");
    expect(store.listQuotes("ORD-001")).toHaveLength(2);
  });

  it("forgets what the heartbeat handled for the demo order, so the re-seeded order wakes the Chief again", () => {
    const r = realOrder();
    const realId = r.ok ? r.order.id : "";
    store.setMeta("heartbeatSeen", {
      "needs_plan:ORD-001": { since: "x", handled: true },
      "printer_offline:a1:ORD-001": { since: "x", handled: true },
      [`needs_price:${realId}`]: { since: "x", handled: true },
    });
    store.resetSimulated();
    expect(Object.keys(store.getMeta<Record<string, unknown>>("heartbeatSeen")!)).toEqual([`needs_price:${realId}`]);
  });
});

describe("createOrder", () => {
  it("gives a new order the next id and CREATED status", () => {
    const r = realOrder();
    expect(r.ok && r.order).toMatchObject({ id: "ORD-002", jobId: "JOB-002", status: "CREATED", label: "real" });
  });
  it("skips the number of a removed order whose Chief log and task were left behind", () => {
    realOrder(); realOrder(); // ORD-002, ORD-003
    store.setMeta("lastOrderNo", null); // a database from before the counter
    const at = new Date().toISOString();
    store.addLog({ orderId: "ORD-004", actor: "agent", tool: "agent_summary", input: {}, ok: true, output: { text: "old run" }, at });
    store.saveTask({ id: "T-14", orderId: "ORD-004", kind: "check_printer", text: "old", status: "open", createdBy: "agent", at });
    const r = realOrder();
    expect(r.ok && r.order.id).toBe("ORD-005");
    expect(store.listLog("ORD-005")).toEqual([]);
    expect(store.listTasks("ORD-005")).toEqual([]);
  });
  it("never hands out a number again, even after the demo reset deleted that order completely", () => {
    const sim = createOrder({ product: "Demo", quantity: 1, deadline: "2026-10-30", designVersion: "v1", mandateMicro: 5_000_000, label: "simulated" });
    expect(sim.ok && sim.order.id).toBe("ORD-002");
    store.resetSimulated();
    expect(store.getOrder("ORD-002")).toBeUndefined();
    const r = realOrder();
    expect(r.ok && r.order).toMatchObject({ id: "ORD-003", jobId: "JOB-003" });
  });
  it("rejects bad input with readable reasons", () => {
    const r = createOrder({ product: "", quantity: 0, deadline: "tomorrow", designVersion: "", mandateMicro: 0, label: "real" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reasons).toHaveLength(5);
  });
});

describe("double-payment guard in the database", () => {
  it("refuses a second intent row with the same idempotency key", () => {
    const intent = {
      id: "PI-x", orderId: "ORD-001", recipient: "0x1", amountMicro: 1, token: "USDC" as const, network: "ARC-TESTNET",
      idempotencyKey: "same", state: "PAYMENT_INTENT_CREATED" as const, label: "local" as const, createdAt: "",
    };
    store.insertIntent(intent);
    expect(() => store.insertIntent({ ...intent, id: "PI-y" })).toThrow(/UNIQUE/);
  });
});

describe("write transactions (agent prints: check and write as one step)", () => {
  it("a throw rolls everything back; a nested call is a savepoint that rolls back alone; fn must be synchronous", () => {
    expect(() => store.transaction(() => { store.setMeta("x", 1); throw new Error("no"); })).toThrow("no");
    expect(store.getMeta("x")).toBeUndefined();
    store.transaction(() => {
      store.setMeta("a", 1);
      expect(() => store.transaction(() => { store.setMeta("b", 2); throw new Error("inner"); })).toThrow("inner");
      store.setMeta("c", 3);
    });
    expect([store.getMeta("a"), store.getMeta("b"), store.getMeta("c")]).toEqual([1, undefined, 3]);
    expect(() => store.transaction(() => Promise.resolve(1) as unknown as number)).toThrow(/synchronous/);
    expect(store.getMeta("a")).toBe(1);
  });

  it("another process (connection) cannot write in between: BEGIN IMMEDIATE holds the write lock", async () => {
    const { DatabaseSync } = await import("node:sqlite");
    closeDb();
    const dir = mkdtempSync(path.join(tmpdir(), "kesuni-tx-"));
    const file = path.join(dir, "test.db");
    process.env.KESUNI_DB_PATH = file;
    try {
      store.listOrders(); // open and create the schema
      const other = new DatabaseSync(file);
      other.exec("PRAGMA busy_timeout = 0");
      store.transaction(() => {
        store.setMeta("mine", 1);
        expect(() => other.exec("INSERT INTO meta (key, data) VALUES ('theirs', '1')")).toThrow(/locked|busy/i);
      });
      other.exec("INSERT INTO meta (key, data) VALUES ('theirs', '1')");
      expect(store.getMeta("theirs")).toBe(1);
      other.close();
    } finally {
      closeDb();
      process.env.KESUNI_DB_PATH = ":memory:";
      rmSync(dir, { recursive: true, force: true });
    }
  }, 20_000);
});
