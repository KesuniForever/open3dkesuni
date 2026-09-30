// The ONLY code paths that change order state. HTTP routes and agent tools both call
// these, so an agent can never bypass validation a human would face.
import { db } from "./store";
import { checkPaymentIntent, checkPlan } from "./policy";
import type { Order, PaymentIntent } from "./types";

export type Fail = { ok: false; status: number; error: string; reasons?: string[] };
const fail = (status: number, error: string, reasons?: string[]): Fail => ({ ok: false, status, error, reasons });

export function chooseQuote(
  orderId: string, quoteId: string, decidedBy: "agent" | "human", reason: string,
): { ok: true; order: Order } | Fail {
  const order = db.orders.get(orderId);
  if (!order) return fail(404, "Order not found");
  if (order.status !== "CREATED") return fail(409, `Order is ${order.status}; plan already chosen`);
  const quote = db.quotes.get(quoteId);
  if (!quote) return fail(404, "Quote not found");
  const policy = checkPlan(order, quote, db.vendors.get(quote.vendorId));
  if (!policy.ok) return fail(422, "Plan rejected by policy", policy.reasons);
  order.chosenQuoteId = quote.id;
  order.status = "PLAN_CHOSEN";
  db.decisions.push({ orderId, quoteId, decidedBy, reason, at: new Date().toISOString() });
  return { ok: true, order };
}

export function createPaymentIntent(
  orderId: string, proposed: { recipient: string; amountMicro: number; idempotencyKey: string },
): { ok: true; intent: PaymentIntent; replayed: boolean } | Fail {
  const order = db.orders.get(orderId);
  if (!order) return fail(404, "Order not found");
  const existing = [...db.intents.values()];
  const replay = existing.find((i) => i.orderId === orderId && i.idempotencyKey === proposed.idempotencyKey);
  if (replay) return { ok: true, intent: replay, replayed: true };

  const quote = order.chosenQuoteId ? db.quotes.get(order.chosenQuoteId) : undefined;
  const policy = checkPaymentIntent({
    order, chosenQuote: quote, vendor: quote ? db.vendors.get(quote.vendorId) : undefined,
    evidence: db.evidence.filter((e) => e.orderId === orderId),
    acceptance: db.acceptances.get(orderId), existingIntents: existing, proposed,
  });
  if (!policy.ok) return fail(422, "Payment blocked by policy", policy.reasons);

  const intent: PaymentIntent = {
    id: `PI-${existing.length + 1}`, orderId, recipient: proposed.recipient,
    amountMicro: proposed.amountMicro, token: "USDC", network: "ARC-TESTNET",
    idempotencyKey: proposed.idempotencyKey, state: "PAYMENT_INTENT_CREATED", label: "local",
    createdAt: new Date().toISOString(),
  };
  db.intents.set(intent.id, intent);
  return { ok: true, intent, replayed: false };
}
