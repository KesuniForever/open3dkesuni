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
  });
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
});

describe("createOrder", () => {
  it("gives a new order the next id and CREATED status", () => {
    const r = realOrder();
    expect(r.ok && r.order).toMatchObject({ id: "ORD-002", jobId: "JOB-002", status: "CREATED", label: "real" });
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
