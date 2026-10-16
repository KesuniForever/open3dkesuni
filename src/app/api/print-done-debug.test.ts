import { beforeEach, describe, expect, it } from "vitest";
import * as store from "@/lib/store";
import { chooseQuote } from "@/lib/actions";
import { POST } from "./orders/[id]/print-done-debug/route";

// POST /api/orders/:id/print-done-debug { by }: "Done (debug)" on the order page (src/lib/printer/done-debug.ts).
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const post = (id: string, body: unknown, type = "application/json") =>
  POST(new Request(`http://x/api/orders/${id}/print-done-debug`, { method: "POST", body: JSON.stringify(body), headers: { "content-type": type } }), ctx(id));

beforeEach(() => {
  store.resetDb();
  chooseQuote("ORD-001", "Q-own", "human", "test");
});

describe("POST /api/orders/:id/print-done-debug", () => {
  it("201 with the mark, then 200 with the same mark", async () => {
    const res = await post("ORD-001", { by: "Khelda" });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({ replayed: false, mark: { by: "Khelda" }, order: { id: "ORD-001", status: "IN_PRODUCTION" }, evidence: { kind: "log", label: "simulated" } });
    const again = await post("ORD-001", { by: "Khelda" });
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ replayed: true, mark: body.mark, evidence: null });
    expect(store.listEvidence("ORD-001")).toHaveLength(1);
  });

  it("409 for a real order and for an order not in production; 400 without a name or a JSON body; 404 for no order", async () => {
    store.saveOrder({ ...store.getOrder("ORD-001")!, label: "real" });
    const real = await post("ORD-001", { by: "Khelda" });
    expect(real.status).toBe(409);
    expect(await real.json()).toMatchObject({ error: "Only test orders can be marked printed without a print" });

    store.saveOrder({ ...store.getOrder("ORD-001")!, label: "simulated", status: "CREATED" });
    const created = await post("ORD-001", { by: "Khelda" });
    expect(created.status).toBe(409);
    expect((await created.json()).error).toBe("Order is CREATED; only an order in production can be marked printed");

    store.saveOrder({ ...store.getOrder("ORD-001")!, status: "PLAN_CHOSEN" });
    expect((await post("ORD-001", { by: "" })).status).toBe(400);
    expect((await post("ORD-001", { by: "agent" })).status).toBe(400);
    expect((await post("ORD-001", { by: "Khelda" }, "text/plain")).status).toBe(400);
    expect((await post("ORD-404", { by: "Khelda" })).status).toBe(404);
    expect(store.getOrder("ORD-001")!.printDoneDebug).toBeUndefined();
  });

  it("409 while a print of the order is on its way", async () => {
    const at = new Date().toISOString();
    store.savePrintJob({
      id: "PJ-1-x", orderId: "ORD-001", printerId: "a1", attachmentId: "A-1", plate: 1, fileName: "x.gcode.3mf", amsMapping: [0],
      options: { bedLevelling: true, flowCali: true, timelapse: false, useAms: true }, state: "uploading", by: "Khelda", createdAt: at, updatedAt: at,
    });
    const res = await post("ORD-001", { by: "Khelda" });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("A print of this order is on its way: stop it first");
  });
});
