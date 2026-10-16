import { beforeEach, describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import * as store from "./store";
import { traction } from "./traction";
import { describeEntry } from "./ops";
import { makeT } from "../i18n/core";
import { ID } from "../i18n/id";
import { ORDER_LABEL_TOOL, setOrderLabel } from "./order-label";
import { POST } from "@/app/api/orders/[id]/label/route";
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";
import type { ChainTx, Escrow, Order } from "./types";

// The order page's real / simulated switch: a practice order from the public form stops counting as traction.
const at = "2026-10-16T05:00:00.000Z";
const order = (id: string, extra: Partial<Order> = {}): Order => ({
  id, jobId: `JOB-${id}`, product: "Lamp", quantity: 1, deadline: "2026-10-30", designVersion: "v1", mandateMicro: 50_000_000,
  status: "CREATED", label: "real", customerName: "A judge", ...extra,
});
const tx = (kind: ChainTx["kind"], state: ChainTx["state"]): ChainTx => ({
  kind, from: "0xc", to: "0xe", amountMicro: 1_000_000, idempotencyKey: `k-${kind}-${state}`, state, txHash: `0x${"ab".repeat(32)}`, at,
});
const escrow = (orderId: string, state: Escrow["state"], txs: ChainTx[], network = "ARC-TESTNET"): Escrow => ({
  orderId, amountMicro: 1_000_000, escrowWalletId: "w", escrowAddress: "0xe", customerWalletId: "c", customerAddress: "0xc",
  state, txs, network, label: "testnet", createdAt: at,
});
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const post = (id: string, body: unknown, type = "application/json") =>
  POST(new Request(`http://x/api/orders/${id}/label`, { method: "POST", body: JSON.stringify(body), headers: { "content-type": type } }), ctx(id));

beforeEach(() => {
  store.resetDb();
  store.saveOrder(order("ORD-050"));
});

describe("setOrderLabel", () => {
  it("marks a real order simulated with a person's name, logs who and what, and traction stops counting it; back again", () => {
    const before = traction().realOrders;
    const r = setOrderLabel("ORD-050", { label: "simulated", by: " Khelda " }, Date.parse(at));
    expect(r).toMatchObject({ ok: true, changed: true, order: { id: "ORD-050", label: "simulated" } });
    expect(store.getOrder("ORD-050")!.label).toBe("simulated");
    expect(traction().realOrders).toBe(before - 1);
    const row = store.listLog("ORD-050").find((e) => e.tool === ORDER_LABEL_TOOL)!;
    expect(row).toMatchObject({ actor: "human", ok: true, input: { label: "simulated", by: "Khelda" }, output: { from: "real", to: "simulated" }, at });
    expect(describeEntry(row)).toEqual({ title: "Marked simulated by Khelda", line: "real → simulated" });
    expect(describeEntry(row, makeT("id", ID))).toEqual({ title: "Ditandai simulasi oleh Khelda", line: "nyata → simulasi" });

    expect(setOrderLabel("ORD-050", { label: "real", by: "Khelda" })).toMatchObject({ ok: true, changed: true, order: { label: "real" } });
    expect(traction().realOrders).toBe(before);
  });

  it("the same label again changes and logs nothing", () => {
    expect(setOrderLabel("ORD-050", { label: "real", by: "Khelda" })).toMatchObject({ ok: true, changed: false });
    expect(store.listLog("ORD-050").filter((e) => e.tool === ORDER_LABEL_TOOL)).toHaveLength(0);
  });

  it("needs a real or simulated label and a person's name; an unknown order is 404", () => {
    for (const label of ["manual", "testnet", "", undefined, "REAL"]) expect(setOrderLabel("ORD-050", { label, by: "Khelda" })).toMatchObject({ ok: false, status: 400 });
    for (const by of ["", "  ", "agent", "Claude", undefined]) expect(setOrderLabel("ORD-050", { label: "simulated", by }), String(by)).toMatchObject({ ok: false, status: 400 });
    expect(setOrderLabel("ORD-404", { label: "simulated", by: "Khelda" })).toMatchObject({ ok: false, status: 404 });
    expect(store.getOrder("ORD-050")!.label).toBe("real");
  });

  it("never while money is held in its escrow or a transfer is on its way; settled, it may change", () => {
    store.saveEscrow(escrow("ORD-050", "FUNDED", [tx("deposit", "COMPLETE")]));
    expect(setOrderLabel("ORD-050", { label: "simulated", by: "Khelda" })).toMatchObject({
      ok: false, status: 409, reasons: ["Money is held in this order's escrow: release or refund it first"],
    });
    store.saveEscrow(escrow("ORD-050", "AWAITING_DEPOSIT", [tx("deposit", "SENT")]));
    expect(setOrderLabel("ORD-050", { label: "simulated", by: "Khelda" })).toMatchObject({
      ok: false, status: 409, reasons: ["An escrow transfer of this order is still in progress"],
    });
    store.saveEscrow(escrow("ORD-050", "REFUNDED", [tx("deposit", "COMPLETE"), tx("refund", "COMPLETE")]));
    expect(setOrderLabel("ORD-050", { label: "simulated", by: "Khelda" })).toMatchObject({ ok: true, changed: true });
    expect(store.getOrder("ORD-050")!.label).toBe("simulated");
  });

  it("an order with an escrow on mainnet stays real, settled or not even paid yet", () => {
    const onMainnet = ["This order's escrow is on mainnet (real USDC): it stays real"];
    store.saveEscrow(escrow("ORD-050", "RELEASED", [tx("deposit", "COMPLETE"), tx("release", "COMPLETE")], "ARC"));
    expect(setOrderLabel("ORD-050", { label: "simulated", by: "Khelda" })).toMatchObject({ ok: false, status: 409, reasons: onMainnet });
    store.saveEscrow(escrow("ORD-050", "AWAITING_DEPOSIT", [], "ARC"));
    expect(setOrderLabel("ORD-050", { label: "simulated", by: "Khelda" })).toMatchObject({ ok: false, status: 409, reasons: onMainnet });
    expect(store.getOrder("ORD-050")!.label).toBe("real");
  });

  it("on mainnet an order the customer can still pay stays real; on testnet a later deposit is Kesuni's own test USDC", () => {
    const before = process.env.CIRCLE_BLOCKCHAIN;
    const canPay = ["On mainnet an order the customer can still pay stays real"];
    try {
      process.env.CIRCLE_BLOCKCHAIN = "ARC";
      // No escrow yet: the customer may still agree and pay, in any status before ACCEPTED.
      for (const status of ["CREATED", "PLAN_CHOSEN", "IN_PRODUCTION", "EVIDENCE_SUBMITTED"] as const) {
        store.saveOrder(order("ORD-050", { status }));
        expect(setOrderLabel("ORD-050", { label: "simulated", by: "Khelda" }), status).toMatchObject({ ok: false, status: 409, reasons: canPay });
      }
      // A testnet escrow from before the switch, still open for a deposit.
      store.saveEscrow(escrow("ORD-050", "AWAITING_DEPOSIT", []));
      expect(setOrderLabel("ORD-050", { label: "simulated", by: "Khelda" })).toMatchObject({ ok: false, status: 409, reasons: canPay });
      // Settled on testnet, or too late to pay: it may change.
      store.saveEscrow(escrow("ORD-050", "REFUNDED", [tx("deposit", "COMPLETE"), tx("refund", "COMPLETE")]));
      expect(setOrderLabel("ORD-050", { label: "simulated", by: "Khelda" })).toMatchObject({ ok: true, changed: true });
      store.saveOrder(order("ORD-053", { status: "REJECTED" }));
      expect(setOrderLabel("ORD-053", { label: "simulated", by: "Khelda" })).toMatchObject({ ok: true, changed: true });
    } finally {
      if (before === undefined) delete process.env.CIRCLE_BLOCKCHAIN;
      else process.env.CIRCLE_BLOCKCHAIN = before;
    }
    store.saveOrder(order("ORD-054", { status: "PLAN_CHOSEN" }));
    store.saveEscrow(escrow("ORD-054", "AWAITING_DEPOSIT", []));
    expect(setOrderLabel("ORD-054", { label: "simulated", by: "Khelda" })).toMatchObject({ ok: true, changed: true });
  });

  it("a demo practice order, or a test order marked printed without a print, never becomes real", () => {
    store.saveOrder(order("ORD-051", { label: "simulated", customerName: "Demo: smooth order" }));
    expect(setOrderLabel("ORD-051", { label: "real", by: "Khelda" })).toMatchObject({ ok: false, status: 409, reasons: ["A practice order from the demo stays simulated"] });
    store.saveOrder(order("ORD-052", { label: "simulated", status: "IN_PRODUCTION", printDoneDebug: { by: "Khelda", at } }));
    expect(setOrderLabel("ORD-052", { label: "real", by: "Khelda" })).toMatchObject({
      ok: false, status: 409, reasons: ["Marked printed for testing without a print: it stays simulated"],
    });
    expect(store.getOrder("ORD-051")!.label).toBe("simulated");
    expect(store.getOrder("ORD-052")!.label).toBe("simulated");
  });

  it("is for people only: the agent's code never imports it", () => {
    const dir = path.join(process.cwd(), "src", "lib", "agent");
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))) {
      expect(readFileSync(path.join(dir, file), "utf8"), file).not.toMatch(/order-label|setOrderLabel|order_label/);
    }
  });
});

describe("POST /api/orders/:id/label", () => {
  it("is an operator route: on the public link it needs the operator password, and a post from another site is blocked", () => {
    const tunnel = { host: "kesuni.trycloudflare.com", "cf-connecting-ip": "1.2.3.4" };
    const req = (headers: Record<string, string>) =>
      new NextRequest("http://localhost:3000/api/orders/ORD-050/label", { method: "POST", headers: { host: "localhost:3000", ...headers } });
    const before = process.env.OPERATOR_PASSWORD;
    process.env.OPERATOR_PASSWORD = "correct horse";
    try {
      expect(proxy(req(tunnel)).status).toBe(401);
      const auth = `Basic ${Buffer.from("operator:correct horse", "utf8").toString("base64")}`;
      expect(proxy(req({ ...tunnel, authorization: auth })).headers.get("x-middleware-next")).toBe("1");
      expect(proxy(req({ ...tunnel, authorization: auth, "sec-fetch-site": "cross-site" })).status).toBe(403);
    } finally {
      if (before === undefined) delete process.env.OPERATOR_PASSWORD;
      else process.env.OPERATOR_PASSWORD = before;
    }
  });

  it("200 with the order and whether it changed", async () => {
    const res = await post("ORD-050", { label: "simulated", by: "Khelda" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ changed: true, order: { id: "ORD-050", label: "simulated" } });
    const again = await post("ORD-050", { label: "simulated", by: "Khelda" });
    expect(await again.json()).toMatchObject({ changed: false });
  });

  it("400 without a JSON body, a label or a name; 404 for no order; 409 with the reasons while money is held", async () => {
    expect((await post("ORD-050", { label: "simulated", by: "Khelda" }, "text/plain")).status).toBe(400);
    expect((await post("ORD-050", { by: "Khelda" })).status).toBe(400);
    expect((await post("ORD-050", { label: "simulated" })).status).toBe(400);
    expect((await post("ORD-404", { label: "simulated", by: "Khelda" })).status).toBe(404);
    store.saveEscrow(escrow("ORD-050", "FUNDED", [tx("deposit", "COMPLETE")]));
    const held = await post("ORD-050", { label: "simulated", by: "Khelda" });
    expect(held.status).toBe(409);
    expect(await held.json()).toEqual({ error: "The label cannot change now", reasons: ["Money is held in this order's escrow: release or refund it first"] });
    expect(store.getOrder("ORD-050")!.label).toBe("real");
  });
});
