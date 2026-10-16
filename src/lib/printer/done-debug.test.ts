import { beforeEach, describe, expect, it } from "vitest";
import * as store from "../store";
import { addEvidence, chooseQuote, recordAcceptance } from "../actions";
import { customerView, TEST_PRINTED_ON } from "../customer";
import { checkHeartbeat } from "../agent/heartbeat";
import { orderStatus } from "@/app/request/[code]/order-status";
import { emptySnapshot } from "./bambu";
import { orderGate } from "./autoprint";
import { planDispatch } from "./dispatch";
import { printFinished } from "./actions";
import { markPrintDoneDebug, PRINT_DONE_DEBUG_TOOL } from "./done-debug";
import { canMarkPrintDoneDebug, ON_ITS_WAY_TEXT, REAL_ORDER_TEXT } from "./done-debug-rules";
import type { Escrow, Order, PrintJob } from "../types";

// "Done (debug)": a person marks a test order's printing as finished without printing, to try QC and the customer's
// decision quickly. The seeded demo order ORD-001 is simulated; chooseQuote puts it in PLAN_CHOSEN.
const ORDER = "ORD-001";
const AT = new Date().toISOString();
const order = () => store.getOrder(ORDER)!;
const save = (over: Partial<Order>) => store.saveOrder({ ...order(), ...over });
const job = (state: PrintJob["state"]): PrintJob => ({
  id: `PJ-1-${state}`, orderId: ORDER, printerId: "a1", attachmentId: "A-1", plate: 1, fileName: "x.gcode.3mf", amsMapping: [0],
  options: { bedLevelling: true, flowCali: true, timelapse: false, useAms: true }, state, by: "Khelda", createdAt: AT, updatedAt: AT,
});
const funded = (): Escrow => ({
  orderId: ORDER, amountMicro: 30_000_000, escrowWalletId: "w1", escrowAddress: "0xe", customerWalletId: "w2", customerAddress: "0xc",
  state: "FUNDED", txs: [], network: "ARC-TESTNET", label: "testnet", createdAt: AT,
});
const logRows = () => store.listLog(ORDER).filter((e) => e.tool === PRINT_DONE_DEBUG_TOOL);

beforeEach(() => {
  store.resetDb();
  expect(chooseQuote(ORDER, "Q-own", "human", "test").ok).toBe(true);
});

describe("Done (debug): who and when", () => {
  it("refuses a real order (traction stays honest) and writes nothing", () => {
    save({ label: "real" });
    expect(canMarkPrintDoneDebug(order())).toBe(false);
    expect(markPrintDoneDebug(ORDER, { by: "Khelda" })).toMatchObject({ ok: false, status: 409, error: REAL_ORDER_TEXT });
    expect(order().printDoneDebug).toBeUndefined();
    expect(order().status).toBe("PLAN_CHOSEN");
    expect(store.listEvidence(ORDER)).toEqual([]);
    expect(logRows()).toEqual([]);
  });

  it("only an order in production: not before a plan, not once QC is in", () => {
    save({ status: "CREATED" });
    expect(canMarkPrintDoneDebug(order())).toBe(false);
    expect(markPrintDoneDebug(ORDER, { by: "Khelda" })).toMatchObject({
      ok: false, status: 409, error: "Order is CREATED; only an order in production can be marked printed",
    });
    for (const status of ["EVIDENCE_SUBMITTED", "ACCEPTED", "REJECTED", "PAID"] as const) {
      save({ status });
      expect(markPrintDoneDebug(ORDER, { by: "Khelda" }), status).toMatchObject({ ok: false, status: 409 });
    }
    expect(store.listEvidence(ORDER)).toEqual([]);
    expect(store.getOrder("ORD-404")).toBeUndefined();
    expect(markPrintDoneDebug("ORD-404", { by: "Khelda" })).toMatchObject({ ok: false, status: 404 });
  });

  it("needs a person's name: never the agent, the Chief or a blank", () => {
    for (const by of ["", "   ", "agent", "Chief", "claude", undefined, 42]) {
      expect(markPrintDoneDebug(ORDER, { by }), String(by)).toMatchObject({ ok: false, status: 400, error: "A person's name is required" });
    }
    expect(order().printDoneDebug).toBeUndefined();
  });

  it("refuses while a print of the order is on its way or a printer linked to it is printing", () => {
    for (const state of ["queued", "uploading", "sent", "printing"] as const) {
      store.savePrintJob(job(state));
      expect(markPrintDoneDebug(ORDER, { by: "Khelda" }), state).toMatchObject({ ok: false, status: 409, error: ON_ITS_WAY_TEXT });
      store.savePrintJob({ ...job(state), state: "cancelled" });
    }
    // A print started outside the website: the linked printer reports it.
    store.savePrinter({ id: "a2", name: "A1 Combo #2", currentOrderId: ORDER, lastSeen: AT, snapshot: { ...emptySnapshot(AT), state: "RUNNING" } });
    expect(markPrintDoneDebug(ORDER, { by: "Khelda" })).toMatchObject({ ok: false, status: 409, error: ON_ITS_WAY_TEXT });
    store.savePrinter({ id: "a2", name: "A1 Combo #2", currentOrderId: ORDER, lastSeen: AT, snapshot: { ...emptySnapshot(AT), state: "FINISH" } });
    expect(markPrintDoneDebug(ORDER, { by: "Khelda" }).ok).toBe(true);
  });
});

describe("Done (debug): what it does", () => {
  it("stores the mark, moves PLAN_CHOSEN to IN_PRODUCTION, logs a simulated evidence and a person's log row", () => {
    expect(canMarkPrintDoneDebug(order())).toBe(true);
    const r = markPrintDoneDebug(ORDER, { by: "  Khelda " }, Date.parse("2026-10-16T07:05:00Z"));
    if (!r.ok) throw new Error(r.error);
    expect(r.replayed).toBe(false);
    expect(order()).toMatchObject({ status: "IN_PRODUCTION", printDoneDebug: { by: "Khelda", at: "2026-10-16T07:05:00.000Z" } });
    expect(canMarkPrintDoneDebug(order())).toBe(false);
    expect(store.listEvidence(ORDER)).toEqual([
      expect.objectContaining({ kind: "log", label: "simulated", note: "Print marked done for testing (no real print) by Khelda" }),
    ]);
    expect(r.evidence?.id).toBe(store.listEvidence(ORDER)[0].id);
    expect(logRows()).toEqual([expect.objectContaining({ actor: "human", ok: true, input: { by: "Khelda" } })]);
  });

  it("an order already IN_PRODUCTION stays there", () => {
    save({ status: "IN_PRODUCTION" });
    expect(markPrintDoneDebug(ORDER, { by: "Khelda" }).ok).toBe(true);
    expect(order().status).toBe("IN_PRODUCTION");
  });

  it("is idempotent: marking again returns the same mark and writes nothing new", () => {
    const first = markPrintDoneDebug(ORDER, { by: "Khelda" });
    const again = markPrintDoneDebug(ORDER, { by: "Felia" });
    if (!first.ok || !again.ok) throw new Error("refused");
    expect(again.replayed).toBe(true);
    expect(again.evidence).toBeNull();
    expect(again.order.printDoneDebug).toEqual(first.order.printDoneDebug);
    expect(store.listEvidence(ORDER)).toHaveLength(1);
    expect(logRows()).toHaveLength(1);
    // Still the same mark after QC moved the order on.
    expect(addEvidence(ORDER, { kind: "qc", note: "Looks right", label: "manual" }).ok).toBe(true);
    expect(markPrintDoneDebug(ORDER, { by: "Khelda" })).toMatchObject({ ok: true, replayed: true });
  });

  it("never touches printers, print jobs, the escrow or money", () => {
    store.savePrinter({ id: "a1", name: "A1 Combo #1", lastSeen: AT, snapshot: { ...emptySnapshot(AT), state: "IDLE" } });
    store.savePrintJob(job("failed"));
    store.saveEscrow(funded());
    const before = JSON.stringify([store.listPrinters(), store.listPrintJobs(), store.getEscrow(ORDER), store.listIntents(ORDER), store.listPrinterCommands()]);
    expect(markPrintDoneDebug(ORDER, { by: "Khelda" }).ok).toBe(true);
    expect(JSON.stringify([store.listPrinters(), store.listPrintJobs(), store.getEscrow(ORDER), store.listIntents(ORDER), store.listPrinterCommands()])).toBe(before);
    expect(store.listOpenTasks()).toEqual([]);
  });
});

describe("Done (debug): the rest of the app reads the order as printed", () => {
  it("the dispatcher counts every run as printed and never prints it", () => {
    save({ autoPrint: { runsNeeded: 2, by: "Khelda", at: AT } });
    expect(orderGate(order()).why).toBeNull(); // before: the agent would print it
    expect(markPrintDoneDebug(ORDER, { by: "Khelda" }).ok).toBe(true);
    expect(orderGate(order())).toMatchObject({ runsDone: 2, runsNeeded: 2, runsActive: 0, why: { key: "Marked printed for testing: the agent does not print it" } });
    expect(planDispatch().orders[ORDER]).toMatchObject({ action: "wait", runsDone: 2, runsNeeded: 2, why: { key: "Marked printed for testing: the agent does not print it" } });
  });

  it("printFinished says printed, so the heartbeat does not ask to start production", () => {
    store.saveEscrow(funded());
    expect(printFinished(ORDER)).toBe(false);
    expect(checkHeartbeat().map((f) => f.kind)).toContain("start_production");
    expect(markPrintDoneDebug(ORDER, { by: "Khelda" }).ok).toBe(true);
    expect(printFinished(ORDER)).toBe(true);
    expect(checkHeartbeat().map((f) => f.kind)).not.toContain("start_production");
  });

  it("the customer page says printing finished, and My orders shows the quality check", () => {
    store.saveEscrow(funded());
    expect(customerView(order(), "token").printedOn).toBeNull();
    expect(orderStatus(customerView(order(), "token")).stage).toBe("waiting");
    expect(markPrintDoneDebug(ORDER, { by: "Khelda" }).ok).toBe(true);
    const v = customerView(order(), "token");
    expect(v.printedOn).toBe(TEST_PRINTED_ON);
    expect(orderStatus(v)).toMatchObject({ stage: "checking", text: "Quality check" });
  });

  it("then QC and the decision work as after a real print", () => {
    expect(markPrintDoneDebug(ORDER, { by: "Khelda" }).ok).toBe(true);
    expect(addEvidence(ORDER, { kind: "qc", note: "Size and colour checked", label: "manual" }).ok).toBe(true);
    expect(order().status).toBe("EVIDENCE_SUBMITTED");
    expect(recordAcceptance(ORDER, { accepted: true, by: "Khelda", note: "test" })).toMatchObject({ ok: true, order: { status: "ACCEPTED" } });
  });
});
