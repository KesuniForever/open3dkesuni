// An order's label after it was made: "real" (counts as traction) or "simulated" (the team's own test, never counted).
// Orders from the public customer form are always "real"; a judge's or the team's practice order is marked
// "simulated" here, and a mistaken mark can be undone. People only, on the operator order page (POST
// /api/orders/:id/label, behind the operator password like every operator route): no agent tool, and src/lib/agent
// never imports this file (a test checks it). It moves no money and no printer; it writes a decision-log row
// (actor "human", tool "order_label") with who changed what.
// Refused while it would loosen a money rule: a funded escrow or a transfer in progress keeps its label until it is
// settled (a simulated order may be marked printed without a print, and "Reset simulated demo" deletes its records);
// an order with an escrow on mainnet stays real, and on mainnet an order the customer can still pay stays real (a
// later deposit would be real USDC on a simulated order; on testnet it is Kesuni's own test USDC); a demo practice
// order or one marked printed for testing never becomes real.
import * as store from "./store";
import type { Fail } from "./actions";
import { isPersonName } from "./printer/control";
import { isDemoOrder } from "./demo";
import { isTestnetChain, network } from "./network";
import type { ChainTx, Escrow, Order } from "./types";

export type OrderLabel = "real" | "simulated";
export const ORDER_LABELS: readonly OrderLabel[] = ["real", "simulated"];
/** The decision-log tool of a change (actor "human"). */
export const ORDER_LABEL_TOOL = "order_label";

const fail = (status: number, error: string, reasons?: string[]): Fail => ({ ok: false, status, error, reasons });
const FINAL: ChainTx["state"][] = ["COMPLETE", "FAILED", "DENIED", "CANCELLED"];
/** Statuses where checkEscrowOpen (policy.ts) refuses a new escrow: too late to pay. */
const TOO_LATE_TO_PAY: Order["status"][] = ["ACCEPTED", "REJECTED", "PAID"];

/** The customer can still pay: an escrow waits for its deposit, or none is open and it is not too late to open one. */
const canStillPay = (o: Order, escrow: Escrow | undefined): boolean =>
  escrow ? escrow.state === "AWAITING_DEPOSIT" : !TOO_LATE_TO_PAY.includes(o.status);

/** Why this order cannot be relabelled now; empty when it can. English (the order page shows them with tLib). */
export function labelReasons(o: Order, to: OrderLabel): string[] {
  const r: string[] = [];
  const escrow = store.getEscrow(o.id);
  if (escrow?.state === "FUNDED") r.push("Money is held in this order's escrow: release or refund it first");
  if (escrow?.txs.some((x) => !FINAL.includes(x.state))) r.push("An escrow transfer of this order is still in progress");
  if (to === "simulated" && escrow && !isTestnetChain(escrow.network)) r.push("This order's escrow is on mainnet (real USDC): it stays real");
  else if (to === "simulated" && !network().isTestnet && canStillPay(o, escrow)) {
    r.push("On mainnet an order the customer can still pay stays real");
  }
  if (to === "real" && isDemoOrder(o)) r.push("A practice order from the demo stays simulated");
  if (to === "real" && o.printDoneDebug) r.push("Marked printed for testing without a print: it stays simulated");
  return r;
}

/**
 * A person marks the order real or simulated. A name is required. The same label again returns the order unchanged
 * (changed: false) and writes nothing.
 */
export function setOrderLabel(orderId: string, input: { label: unknown; by: unknown }, now = Date.now()):
  { ok: true; order: Order; changed: boolean } | Fail {
  return store.transaction(() => {
    const o = store.getOrder(orderId);
    if (!o) return fail(404, "Order not found");
    if (!ORDER_LABELS.includes(input.label as OrderLabel)) return fail(400, "Label must be real or simulated");
    if (!isPersonName(input.by)) return fail(400, "A person's name is required");
    const to = input.label as OrderLabel;
    if (o.label === to) return { ok: true as const, order: o, changed: false };
    const reasons = labelReasons(o, to);
    if (reasons.length) return fail(409, "The label cannot change now", reasons);
    const by = input.by.trim();
    const order: Order = { ...o, label: to };
    store.saveOrder(order);
    store.addLog({
      orderId, actor: "human", tool: ORDER_LABEL_TOOL, input: { label: to, by }, ok: true,
      output: { from: o.label, to }, at: new Date(now).toISOString(),
    });
    return { ok: true as const, order, changed: true };
  });
}
