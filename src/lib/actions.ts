// The ONLY code paths that change stored state. HTTP routes and agent tools both call
// these, so an agent can never bypass validation a human would face.
import { randomBytes } from "node:crypto";
import * as store from "./store";
import { checkPaymentIntent, checkPlan } from "./policy";
import { network } from "./network";
import { parseColorChoices } from "./colors";
import { MATERIALS } from "./pricing";
import { idrPerUsdc } from "./costing";
import { idrBudget, type Budget } from "./budget";
import { wakeChief } from "./agent/chief";
import { runCount } from "./printer/actions";
import type { Acceptance, Evidence, Label, Material, Order, PaymentIntent, Quote } from "./types";

export type Fail = { ok: false; status: number; error: string; reasons?: string[] };
const fail = (status: number, error: string, reasons?: string[]): Fail => ({ ok: false, status, error, reasons });

const EVIDENCE_KINDS = ["log", "photo", "qc"] as const;
const EVIDENCE_LABELS: Label[] = ["simulated", "manual", "device", "local", "testnet", "mainnet"];

/**
 * createOrder's budget fields from whole rupiah someone typed (the customer's invite form, the New order form):
 * the rupiah as typed, today's app rate, and the USDC mandate rounded to the micro-USDC.
 * Spread it into createOrder: `createOrder({ ...fields, ...budgetFromRupiah(budgetIdr) })`.
 */
export const budgetFromRupiah = (budgetIdr: number): Budget => idrBudget(budgetIdr, idrPerUsdc());

export function createOrder(input: {
  product: string; quantity: number; deadline: string; designVersion: string;
  mandateMicro: number; label: "real" | "simulated"; customerName?: string; customerNote?: string;
  /** The budget in rupiah as the person typed it (or worked out from the USDC typed) and the rate mandateMicro used. */
  budgetIdr?: number; rateIdrPerUsdc?: number;
  /** "PLA" or "PETG". */
  material?: unknown;
  /** [{ type, color, name? }]; check them against the loaded colours first (parseColorChoices with studioPalette). */
  preferredColors?: unknown;
}): { ok: true; order: Order } | Fail {
  const r: string[] = [];
  if (!input.product.trim()) r.push("Product is required");
  if (!Number.isInteger(input.quantity) || input.quantity < 1) r.push("Quantity must be a whole number, at least 1");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.deadline) || Number.isNaN(Date.parse(input.deadline))) r.push("Deadline must be a date (YYYY-MM-DD)");
  if (!input.designVersion.trim()) r.push("Design version is required");
  if (!Number.isInteger(input.mandateMicro) || input.mandateMicro <= 0) r.push("Budget must be a positive USDC amount");
  if (input.label !== "real" && input.label !== "simulated") r.push("Label must be real or simulated");
  if (input.product.trim().length > 200) r.push("Product is too long (at most 200 characters)");
  if ((input.customerName ?? "").length > 80) r.push("Customer name is too long");
  if ((input.customerNote ?? "").length > 1000) r.push("Note is too long");
  const budget = input.budgetIdr !== undefined || input.rateIdrPerUsdc !== undefined;
  if (budget && !(Number.isSafeInteger(input.budgetIdr) && input.budgetIdr! > 0 && input.budgetIdr! <= 1e12)) r.push("Budget in rupiah must be a positive amount");
  if (budget && !(Number.isFinite(input.rateIdrPerUsdc) && input.rateIdrPerUsdc! > 0 && input.rateIdrPerUsdc! <= 1e6)) {
    r.push("The rupiah per USDC rate must be a positive number");
  }
  const noMaterial = input.material === undefined || input.material === null || input.material === "";
  const material = MATERIALS.find((m) => m === input.material) as Material | undefined;
  if (!noMaterial && !material) r.push("Material must be PLA or PETG");
  const colors = parseColorChoices(input.preferredColors);
  if (!colors.ok) r.push(...colors.reasons);
  if (r.length) return fail(400, "Invalid order", r);
  const ids = store.nextOrderIds();
  const order: Order = {
    ...ids, product: input.product.trim(), quantity: input.quantity, deadline: input.deadline,
    designVersion: input.designVersion.trim(), mandateMicro: input.mandateMicro, status: "CREATED", label: input.label,
    customerName: input.customerName?.trim() || undefined, customerNote: input.customerNote?.trim() || undefined,
    customerToken: newCustomerToken(), createdAt: new Date().toISOString(),
    ...(budget ? { budgetIdr: input.budgetIdr, rateIdrPerUsdc: input.rateIdrPerUsdc } : {}),
    ...(material ? { material } : {}),
    ...(colors.ok && colors.choices.length ? { preferredColors: colors.choices } : {}),
  };
  store.saveOrder(order);
  return { ok: true, order };
}

const newCustomerToken = () => randomBytes(18).toString("base64url");

/** The customer's link token for an order, created on first use for orders made before links existed. */
export function ensureCustomerToken(orderId: string): string | undefined {
  const order = store.getOrder(orderId);
  if (!order) return undefined;
  if (order.customerToken) return order.customerToken;
  const customerToken = newCustomerToken();
  store.saveOrder({ ...order, customerToken });
  return customerToken;
}

export function addQuote(
  orderId: string, input: { vendorId: string; priceMicro: number; etaHours: number },
): { ok: true; quote: Quote } | Fail {
  const order = store.getOrder(orderId);
  if (!order) return fail(404, "Order not found");
  if (order.status !== "CREATED") return fail(409, `Order is ${order.status}; quotes are closed`);
  if (!store.getVendor(input.vendorId)) return fail(400, "Unknown vendor");
  if (!Number.isInteger(input.priceMicro) || input.priceMicro <= 0) return fail(400, "Price must be a positive integer (micro-USDC)");
  if (!Number.isInteger(input.etaHours) || input.etaHours <= 0) return fail(400, "ETA must be a positive whole number of hours");
  const quote: Quote = {
    id: store.nextQuoteId(), orderId, vendorId: input.vendorId, priceMicro: input.priceMicro,
    etaHours: input.etaHours, source: input.vendorId === "own" ? "own" : "partner",
  };
  store.saveQuote(quote);
  return { ok: true, quote };
}

export function chooseQuote(
  orderId: string, quoteId: string, decidedBy: "agent" | "human", reason: string,
): { ok: true; order: Order } | Fail {
  const order = store.getOrder(orderId);
  if (!order) return fail(404, "Order not found");
  if (order.status !== "CREATED") return fail(409, `Order is ${order.status}; plan already chosen`);
  const quote = store.getQuote(quoteId);
  if (!quote) return fail(404, "Quote not found");
  const policy = checkPlan(order, quote, store.getVendor(quote.vendorId));
  if (!policy.ok) return fail(422, "Plan rejected by policy", policy.reasons);
  const updated: Order = { ...order, chosenQuoteId: quote.id, status: "PLAN_CHOSEN" };
  store.saveOrder(updated);
  store.addDecision({ orderId, quoteId, decidedBy, reason, at: new Date().toISOString() });
  return { ok: true, order: updated };
}

export function addEvidence(
  orderId: string, input: { kind: string; note: string; label: string },
): { ok: true; evidence: Evidence } | Fail {
  const order = store.getOrder(orderId);
  if (!order) return fail(404, "Order not found");
  if (!["PLAN_CHOSEN", "IN_PRODUCTION", "EVIDENCE_SUBMITTED"].includes(order.status)) {
    return fail(409, order.status === "CREATED" ? "Choose a plan before submitting evidence" : `Order is ${order.status}; evidence is closed`);
  }
  if (!EVIDENCE_KINDS.includes(input.kind as Evidence["kind"]) || !input.note.trim() || !EVIDENCE_LABELS.includes(input.label as Label)) {
    return fail(400, "Expected { kind: 'log'|'photo'|'qc', note, label }");
  }
  const evidence: Evidence = {
    id: store.nextEvidenceId(), orderId, kind: input.kind as Evidence["kind"], note: input.note.trim(),
    label: input.label as Label, at: new Date().toISOString(),
  };
  store.addEvidence(evidence);
  const reachedQc = evidence.kind === "qc" || order.status === "EVIDENCE_SUBMITTED";
  store.saveOrder({ ...order, status: reachedQc ? "EVIDENCE_SUBMITTED" : "IN_PRODUCTION" });
  // The first QC record: the Chief tells the customer to check and decide (the note itself is not passed on). With runs
  // still to print it is told so, to ask a person first.
  if (evidence.kind === "qc" && order.status !== "EVIDENCE_SUBMITTED") {
    const runs = runCount(order);
    wakeChief(orderId, runs.needed > 1 && runs.done < runs.needed
      ? `A person recorded QC for this order, but only ${runs.done} of ${runs.needed} runs are printed. Ask a person before telling the customer it is done.`
      : "A person recorded QC for this order: printing and QC are done, and the order now waits for the customer to accept or reject it on their page.");
  }
  return { ok: true, evidence };
}

/**
 * The owner lifts their own rule for one quote at its current price (e.g. a small pilot order). A re-priced or
 * new quote needs a new approval. People only: no agent tool calls this.
 * Refused, with nothing saved, when the quote would still be refused for a reason the owner cannot lift (the deadline,
 * the partner rule, the vendor). When only the customer's budget still blocks it, the approval is saved (the customer's
 * page offers to raise the budget to this price: src/lib/budget-raise.ts) and the order waits on the customer
 * (waitsOnCustomer: the route does not wake the Chief). Either way the Chief's open questions are answered: closed.
 */
export function approveByOwner(
  orderId: string, input: { quoteId: string; by: string; note: string },
): { ok: true; order: Order; waitsOnCustomer: boolean } | Fail {
  const order = store.getOrder(orderId);
  if (!order) return fail(404, "Order not found");
  if (order.status !== "CREATED") return fail(409, `Order is ${order.status}; approval is for choosing a plan`);
  if (!input.by.trim() || !input.note.trim()) return fail(400, "Who approves and why are required");
  const quote = store.getQuote(input.quoteId);
  if (!quote || quote.orderId !== orderId) return fail(400, "Say which quote of this order the owner approves");
  const at = new Date().toISOString();
  const by = input.by.trim().slice(0, 80);
  const updated: Order = { ...order, ownerApproval: { quoteId: quote.id, priceMicro: quote.priceMicro, by, note: input.note.trim().slice(0, 300), at } };
  // The policy with this approval, as if the customer's budget covered the price: what is left, the owner cannot lift.
  const lifted = checkPlan({ ...updated, mandateMicro: Math.max(order.mandateMicro, quote.priceMicro) }, quote, store.getVendor(quote.vendorId));
  if (!lifted.ok) return fail(422, "The owner's approval cannot make this quote allowed: nothing was saved", lifted.reasons);
  const waitsOnCustomer = quote.priceMicro > order.mandateMicro;
  store.saveOrder(updated);
  const answered = waitsOnCustomer ? "approved by the owner; the customer may raise their budget" : "approved by the owner";
  for (const t of store.listTasks(orderId)) {
    if (t.status === "open" && t.kind === "needs_info") store.saveTask({ ...t, status: "done", doneAt: at, doneBy: `${by} (${answered})` });
  }
  store.addLog({ orderId, actor: "human", tool: "owner_approval", input: { quoteId: quote.id, note: updated.ownerApproval!.note }, ok: true, output: { by, waitsOnCustomer }, at });
  return { ok: true, order: updated, waitsOnCustomer };
}

// Acceptance is a human decision. It is never derived from model output.
export function recordAcceptance(
  orderId: string, input: { accepted: boolean; by: string; note: string },
): { ok: true; acceptance: Acceptance; order: Order } | Fail {
  const order = store.getOrder(orderId);
  if (!order) return fail(404, "Order not found");
  if (order.status !== "EVIDENCE_SUBMITTED") return fail(409, `Order is ${order.status}; QC evidence required first`);
  if (!input.by.trim()) return fail(400, "Who accepted is required");
  const acceptance: Acceptance = { orderId, accepted: input.accepted, by: input.by.trim(), note: input.note, at: new Date().toISOString() };
  store.saveAcceptance(acceptance);
  const updated: Order = { ...order, status: input.accepted ? "ACCEPTED" : "REJECTED" };
  store.saveOrder(updated);
  return { ok: true, acceptance, order: updated };
}

export function createPaymentIntent(
  orderId: string, proposed: { recipient: string; amountMicro: number; idempotencyKey: string },
): { ok: true; intent: PaymentIntent; replayed: boolean } | Fail {
  const order = store.getOrder(orderId);
  if (!order) return fail(404, "Order not found");
  const existing = store.listIntents(orderId);
  const replay = existing.find((i) => i.idempotencyKey === proposed.idempotencyKey);
  if (replay) return { ok: true, intent: replay, replayed: true };

  const quote = order.chosenQuoteId ? store.getQuote(order.chosenQuoteId) : undefined;
  const policy = checkPaymentIntent({
    order, chosenQuote: quote, vendor: quote ? store.getVendor(quote.vendorId) : undefined,
    evidence: store.listEvidence(orderId), acceptance: store.getAcceptance(orderId),
    existingIntents: existing, proposed,
  });
  if (!policy.ok) return fail(422, "Payment blocked by policy", policy.reasons);

  const intent: PaymentIntent = {
    id: store.nextIntentId(), orderId, recipient: proposed.recipient,
    amountMicro: proposed.amountMicro, token: "USDC", network: network().blockchain,
    idempotencyKey: proposed.idempotencyKey, state: "PAYMENT_INTENT_CREATED", label: "local",
    createdAt: new Date().toISOString(),
  };
  store.insertIntent(intent);
  return { ok: true, intent, replayed: false };
}
