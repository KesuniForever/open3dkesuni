// "Done (debug)" on the order page: a person marks a test order's printing as finished WITHOUT printing, so the rest of
// the flow (QC, then the customer's accept or reject) can be tried quickly. People only: it is no agent tool, and
// src/lib/agent never imports this file (a test checks it). Only an order that is not real, so traction stays honest;
// only an order in production; never while a print of the order is on its way or a printer linked to it is printing.
// It touches no printer, print job, bridge, escrow or money. It stores the mark on the order (Order.printDoneDebug),
// moves PLAN_CHOSEN to IN_PRODUCTION and writes a "simulated" log evidence and a decision-log row. Then the dispatcher
// counts the order's runs as printed (autoprint.ts orderGate), printFinished says printed (no "start production" from
// the heartbeat) and the customer page says "Printing finished".
import * as store from "../store";
import { addEvidence, type Fail } from "../actions";
import { isPersonName } from "./control";
import { orderGate } from "./autoprint";
import { DEBUG_DONE_STATUSES, ON_ITS_WAY_TEXT, REAL_ORDER_TEXT } from "./done-debug-rules";
import type { Evidence, Order } from "../types";

const fail = (status: number, error: string, reasons?: string[]): Fail => ({ ok: false, status, error, reasons });

/** The decision-log tool of a mark (actor "human"). */
export const PRINT_DONE_DEBUG_TOOL = "print_done_debug";

/**
 * A person marks this test order's printing as finished without printing. A name is required. Marking again returns the
 * existing mark (replayed: true) and writes nothing.
 */
export function markPrintDoneDebug(orderId: string, input: { by: unknown }, now = Date.now()):
  { ok: true; order: Order; evidence: Evidence | null; replayed: boolean } | Fail {
  return store.transaction(() => {
    const o = store.getOrder(orderId);
    if (!o) return fail(404, "Order not found");
    if (o.label === "real") return fail(409, REAL_ORDER_TEXT);
    if (!isPersonName(input.by)) return fail(400, "A person's name is required");
    if (o.printDoneDebug) return { ok: true as const, order: o, evidence: null, replayed: true };
    if (!DEBUG_DONE_STATUSES.includes(o.status)) return fail(409, `Order is ${o.status}; only an order in production can be marked printed`);
    // Its print jobs not ended, and any printer linked to it that is printing (the dispatcher's own count).
    if (orderGate(o).runsActive > 0) return fail(409, ON_ITS_WAY_TEXT);
    const by = input.by.trim();
    const at = new Date(now).toISOString();
    // The same evidence path as a person's log note: PLAN_CHOSEN becomes IN_PRODUCTION.
    const ev = addEvidence(orderId, { kind: "log", label: "simulated", note: `Print marked done for testing (no real print) by ${by}` });
    if (!ev.ok) return ev;
    const order: Order = { ...store.getOrder(orderId)!, printDoneDebug: { by, at } };
    store.saveOrder(order);
    store.addLog({
      orderId, actor: "human", tool: PRINT_DONE_DEBUG_TOOL, input: { by }, ok: true,
      output: { evidenceId: ev.evidence.id, status: order.status, note: "No real print: a test order" }, at,
    });
    return { ok: true as const, order, evidence: ev.evidence, replayed: false };
  });
}
