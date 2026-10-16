// The owner's rules of the game (from Kesuni's owner, 27 Sep 2026). Enforced here in code, for the
// agent and for people alike; the agent's prompt repeats them as a second layer, never as the only one.
//   - Do not take orders under ~Rp100.000 (margin too thin) without the owner's approval.
//   - Only hand work to a partner when the order is worth Rp300.000 or more; small orders stay in-house.
//   - Orders above the approval limit need the owner's approval.
//   - The chosen option must finish before the deadline (SLA).
// Every number can be changed in .env.local. Display and checks in rupiah; money still moves in USDC.
import { idrPerUsdc, microToIdr } from "./costing";
import type { Order, Quote } from "./types";

export interface OwnerRules {
  minOrderIdr: number;        // below this: owner approval needed
  partnerMinIdr: number;      // below this: own studio only
  approvalAboveIdr: number;   // above this: owner approval needed
  minMarginPct: number;       // lowest margin the agent may price at on its own
  partnerMarginPct: number;   // what Kesuni keeps when a partner prints (for the agent's pricing)
}

const num = (name: string, fallback: number) => {
  const n = Number(process.env[name]);
  return process.env[name] !== undefined && process.env[name] !== "" && Number.isFinite(n) && n >= 0 ? n : fallback;
};

export const ownerRules = (): OwnerRules => ({
  minOrderIdr: num("KESUNI_MIN_ORDER_IDR", 100_000),
  partnerMinIdr: num("KESUNI_PARTNER_MIN_IDR", 300_000),
  approvalAboveIdr: num("KESUNI_OWNER_APPROVAL_ABOVE_IDR", 1_000_000),
  minMarginPct: num("KESUNI_MIN_MARGIN_PCT", 15),
  partnerMarginPct: num("KESUNI_PARTNER_MARGIN_PCT", 20),
});

const rp = (n: number) => `Rp${Math.round(n).toLocaleString("id-ID")}`;

/** End of the deadline day, Jakarta time. */
export const deadlineEnd = (order: Order): number => Date.parse(`${order.deadline}T23:59:59+07:00`);

/**
 * The quote's value in rupiah. Kesuni's own quotes keep the rupiah that was agreed (by weight or from the
 * calculator); converting the USDC price back would be off by up to half a cent (about Rp80). Other quotes are
 * converted at the app rate, or at `rate` when given (the customer's budget raise uses the order's own rate).
 */
export function quoteIdr(order: Order, quote: Quote, rate = idrPerUsdc()): number {
  if (order.gramPricing?.quoteId === quote.id) return order.gramPricing.totalIdr;
  if (order.costing?.quoteId === quote.id) return Math.round(order.costing.input.quantity * order.costing.input.unitPriceIdr);
  return microToIdr(quote.priceMicro, rate);
}

/** The owner approved exactly this quote at exactly this price. */
export const ownerApproved = (order: Order, quote: Quote): boolean =>
  order.ownerApproval?.quoteId === quote.id && order.ownerApproval.priceMicro === quote.priceMicro;

/**
 * Owner-rule reasons against choosing this quote. Rules marked "owner" can be lifted by the owner's
 * approval of this quote at this price; the SLA and partner rules cannot (choose another option instead).
 */
export function ownerRuleReasons(order: Order, quote: Quote, now = Date.now(), rules = ownerRules()): { reasons: string[]; ownerCanApprove: boolean } {
  const idr = quoteIdr(order, quote);
  // Other quotes are converted from USDC (whole cents): allow half a cent either way at the limits.
  const tol = idrPerUsdc() / 200;
  const approved = ownerApproved(order, quote);
  const reasons: string[] = [];
  let hard = false;
  if (!approved && idr < rules.minOrderIdr - tol) reasons.push(`Order value ${rp(idr)} is under the owner's minimum ${rp(rules.minOrderIdr)}: owner approval needed`);
  if (!approved && idr > rules.approvalAboveIdr + tol) reasons.push(`Order value ${rp(idr)} is above ${rp(rules.approvalAboveIdr)}: owner approval needed`);
  if (quote.source === "partner" && idr < rules.partnerMinIdr - tol) {
    reasons.push(`Partners only get orders of ${rp(rules.partnerMinIdr)} or more; this one is ${rp(idr)}, keep it in-house`);
    hard = true;
  }
  if (now + quote.etaHours * 3_600_000 > deadlineEnd(order)) {
    reasons.push(`ETA ${quote.etaHours}h finishes after the deadline ${order.deadline} (SLA)`);
    hard = true;
  }
  return { reasons, ownerCanApprove: !hard && reasons.length > 0 };
}
