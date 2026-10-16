// "The customer decides": when Kesuni's price is above the budget the customer typed, their order page shows that price
// and they may raise their budget to exactly it (POST /api/c/<token> { action: "raise-budget", quoteId, by }).
// Kesuni's price is always decided by people or the pricing rules, never by the customer: the quote the owner approved,
// else the official quote by weight. The customer only says yes to it: no amount is ever read from the request.
// Nothing else changes: a quote above the mandate is still refused by the policy, the owner still approves above the
// limit, and the customer still reads and agrees to the agreement before paying. The raise only moves the mandate (the
// customer's consent) up to that one quote's price, then wakes the Chief to choose the plan.
import * as store from "./store";
import { idrPerUsdc, microToIdr } from "./costing";
import { ownerApproved, quoteIdr } from "./owner-rules";
import { rp } from "./budget";
import { microToUsdc } from "./policy";
import { wakeChief } from "./agent/chief";
import type { Fail } from "./actions";
import type { BudgetRaise, Order, Quote } from "./types";

const fail = (status: number, error: string): Fail => ({ ok: false, status, error });

/** The log row of a raise (actor "human", like the customer's other steps). */
export const RAISE_TOOL = "customer_budget_raise";
// The page reloads its view after an answer: the new price is already shown above this line.
export const PRICE_CHANGED = "The price changed. Check the new price above.";
export const NOT_OVER = "Your budget already covers Kesuni's price.";
export const RAISE_CLOSED = "Your budget can no longer change here. Message Kesuni.";

export interface OfferedQuote {
  quote: Quote;
  source: BudgetRaise["source"];
  /** The quote in whole rupiah: the price by weight as agreed, any other quote at the order's rate (else the app rate). */
  priceIdr: number;
  /** Per piece, rounded to the rupiah. */
  unitIdr: number;
  /** The customer's budget now in whole rupiah (a USDC budget at the order's rate, else the app rate). */
  budgetIdr: number;
}

/**
 * Kesuni's price for this order when it is above the customer's budget, else null. (a) The quote the owner approved, at
 * the price approved, when it is one of this order's quotes; (b) otherwise the official quote by weight. A quote nobody
 * approved is never offered (a manual quote, a partner's). Pure: the caller passes the order's quotes.
 */
export function offeredQuote(order: Order, quotes: Quote[], appRate = idrPerUsdc()): OfferedQuote | null {
  const mine = quotes.filter((q) => q.orderId === order.id);
  const approved = mine.find((q) => ownerApproved(order, q));
  const byWeight = order.gramPricing ? mine.find((q) => q.id === order.gramPricing!.quoteId) : undefined;
  const quote = approved ?? byWeight;
  if (!quote || quote.priceMicro <= order.mandateMicro) return null;
  const rate = order.rateIdrPerUsdc ?? appRate;
  const priceIdr = quoteIdr(order, quote, rate);
  const budgetIdr = order.budgetIdr ?? microToIdr(order.mandateMicro, rate);
  // Above the budget in rupiah too: when the rate moved since the order, a "raise" to the same or fewer rupiah is
  // never offered (a person sorts it out).
  if (priceIdr <= budgetIdr) return null;
  return {
    quote, source: approved ? "owner-approved" : "by-weight", priceIdr, unitIdr: Math.round(priceIdr / Math.max(1, order.quantity)), budgetIdr,
  };
}

/** Something is signed or paid (or the plan is chosen): the budget no longer changes from the customer's page. */
export function raiseClosed(order: Order): boolean {
  return order.status !== "CREATED" || Boolean(order.agreement) || Boolean(store.getEscrow(order.id)) || store.listIntents(order.id).length > 0;
}

/** What the customer's page offers now: Kesuni's price above their budget, while nothing is signed or paid. */
export const raiseOffer = (order: Order): OfferedQuote | null =>
  raiseClosed(order) ? null : offeredQuote(order, store.listQuotes(order.id));

/** Why the Chief wakes up. No customer name: it never reaches Claude. */
export function raiseWakeText(r: BudgetRaise): string {
  const from = r.fromIdr === null ? `${microToUsdc(r.fromMicro)} USDC` : rp(r.fromIdr);
  return `The customer raised their budget from ${from} to ${rp(r.toIdr)} to match quote ${r.quoteId} ` +
    `(${r.source === "owner-approved" ? "owner-approved" : "by weight"}), confirmed with their name on their order page. ` +
    "Choose the plan with that quote; owner approval rules still apply.";
}

/**
 * "Raise my budget to RpX" on the customer's page. quoteId must be the quote the page offered and still the one offered
 * now; the new mandate is that quote's priceMicro exactly and the new rupiah budget its rupiah (the rate stays the
 * order's). Recorded on the order (budgetRaises) and in the log, then the Chief is woken once. The same press again (a
 * double click, a retry) answers ok without a second raise or wake.
 */
export function customerRaiseBudget(
  orderId: string, input: { quoteId: string; by: string },
): { ok: true; raise: BudgetRaise; order: Order; repeated: boolean } | Fail {
  // One write transaction: a second request (another process too) sees the raised budget, never the old one.
  const r = store.transaction(() => raise(orderId, input));
  if (r.ok && !r.repeated) wakeChief(orderId, raiseWakeText(r.raise));
  return r;
}

function raise(orderId: string, input: { quoteId: string; by: string }): { ok: true; raise: BudgetRaise; order: Order; repeated: boolean } | Fail {
  const order = store.getOrder(orderId);
  if (!order) return fail(404, "Order not found");
  const by = input.by.trim().slice(0, 80);
  if (!by) return fail(400, "Name is required");
  const last = order.budgetRaises?.at(-1);
  if (last && last.quoteId === input.quoteId && last.toMicro === order.mandateMicro) return { ok: true, raise: last, order, repeated: true };
  if (raiseClosed(order)) return fail(409, RAISE_CLOSED);
  const offer = offeredQuote(order, store.listQuotes(orderId));
  if (!offer) return fail(409, NOT_OVER);
  if (offer.quote.id !== input.quoteId) return fail(409, PRICE_CHANGED);
  const entry: BudgetRaise = {
    fromIdr: order.budgetIdr ?? null, toIdr: offer.priceIdr, fromMicro: order.mandateMicro, toMicro: offer.quote.priceMicro,
    quoteId: offer.quote.id, source: offer.source, by, at: new Date().toISOString(),
  };
  // Only up (offeredQuote offers nothing at or under the mandate, nor at or under the rupiah budget). An order with a
  // USDC budget only gets the rate used.
  const updated: Order = {
    ...order, mandateMicro: entry.toMicro, budgetIdr: entry.toIdr, rateIdrPerUsdc: order.rateIdrPerUsdc ?? idrPerUsdc(),
    budgetRaises: [...(order.budgetRaises ?? []), entry],
  };
  store.saveOrder(updated);
  store.addLog({
    orderId, actor: "human", tool: RAISE_TOOL, ok: true, at: entry.at,
    input: { quoteId: entry.quoteId, source: entry.source, fromIdr: entry.fromIdr, toIdr: entry.toIdr, fromMicro: entry.fromMicro, toMicro: entry.toMicro },
    output: { by },
  });
  return { ok: true, raise: entry, order: updated, repeated: false };
}
