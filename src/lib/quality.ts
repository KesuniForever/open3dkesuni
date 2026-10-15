// Data for the "Value & quality" page (/quality). Read-only, pure shaping over store data.
// Per order: was the spec + quality promise agreed, what QC evidence exists, plan vs actual, and the customer's
// accept/reject. Real and simulated orders are summarised apart: simulated orders are never business numbers
// (same rule as dashboard.ts, traction.ts and reputation.ts).
import * as store from "./store";
import { agreementCurrent, costingForChosen, gramPricingForChosen } from "./agreement";
import { deadlineEnd, ownerRules, quoteIdr } from "./owner-rules";
import { isPlaceholderAddress } from "./policy";
import type { Reputation } from "./reputation";
import type { Evidence, Order, Review, Vendor } from "./types";

/** agreed = the customer approved this exact spec + price; changed = approved, then the spec or price changed. */
export type AgreementState = "agreed" | "changed" | "spec" | "none";
export type ResultState = "accepted" | "rejected" | "waiting";

export interface PlanVsActual {
  unitsPassed: number;
  quantity: number;
  firstPassPct: number;
  maxDeviationMm: number;
  toleranceMm: number | null;
  /** null when the order has no spec to compare against. */
  withinTolerance: boolean | null;
  plannedCostIdr: number | null;
  actualCostIdr: number;
}

export interface QualityRow {
  orderId: string;
  product: string;
  real: boolean;
  status: Order["status"];
  quantity: number;
  deadline: string;
  agreement: AgreementState;
  agreementVersion: number | null;
  promise: string | null;
  evidence: Record<Evidence["kind"], number>;
  actual: PlanVsActual | null;
  result: ResultState;
  decidedAt: string | null;
  /** Accepted no later than the end of the deadline day (Jakarta). null until the order is finished. */
  onTime: boolean | null;
}

export interface QualitySummary {
  orders: number;
  agreed: number;
  decided: number;
  accepted: number;
  rejected: number;
  /** accepted ÷ (accepted + rejected); null until the customer has decided on at least one order. */
  passRatePct: number | null;
  finished: number;
  onTime: number;
  onTimePct: number | null;
  reviews: number;
  /** Mean of quality, communication and value over all reviews (1–5). */
  avgReview: number | null;
  withQcEvidence: number;
}

export interface QualityOverview { rows: QualityRow[]; real: QualitySummary; simulated: QualitySummary }

const FINISHED = ["ACCEPTED", "PAID"];
const pct1 = (n: number, d: number): number | null => (d === 0 ? null : Math.round((n / d) * 1000) / 10);
const round1 = (n: number) => Math.round(n * 10) / 10;

function agreementState(order: Order): AgreementState {
  if (order.agreement) return agreementCurrent(order) ? "agreed" : "changed";
  return order.spec ? "spec" : "none";
}

/** Planned cost of the chosen plan, when Kesuni priced it (by weight or with the calculator). */
function plannedCost(order: Order): number | null {
  const gp = gramPricingForChosen(order);
  if (gp) return gp.costIdr;
  const c = costingForChosen(order);
  return c ? c.businessCostIdr : null;
}

function planVsActual(order: Order): PlanVsActual | null {
  const a = order.actual;
  if (!a) return null;
  const tol = order.spec ? order.spec.toleranceMm : null;
  return {
    unitsPassed: a.unitsPassed,
    quantity: order.quantity,
    firstPassPct: order.quantity > 0 ? round1((a.unitsPassed / order.quantity) * 100) : 0,
    maxDeviationMm: a.maxDeviationMm,
    toleranceMm: tol,
    withinTolerance: tol === null ? null : a.maxDeviationMm <= tol,
    plannedCostIdr: plannedCost(order),
    actualCostIdr: a.costIdr,
  };
}

export function qualityRow(order: Order): QualityRow {
  const evidence: Record<Evidence["kind"], number> = { log: 0, photo: 0, qc: 0 };
  for (const e of store.listEvidence(order.id)) evidence[e.kind] = (evidence[e.kind] ?? 0) + 1;
  const acc = store.getAcceptance(order.id);
  const result: ResultState = !acc ? "waiting" : acc.accepted ? "accepted" : "rejected";
  const finished = Boolean(acc) && FINISHED.includes(order.status);
  return {
    orderId: order.id,
    product: order.product,
    real: order.label === "real",
    status: order.status,
    quantity: order.quantity,
    deadline: order.deadline,
    agreement: agreementState(order),
    agreementVersion: order.agreement?.version ?? null,
    promise: order.spec?.promise || null,
    evidence,
    actual: planVsActual(order),
    result,
    decidedAt: acc?.at ?? null,
    onTime: finished ? Date.parse(acc!.at) <= deadlineEnd(order) : null,
  };
}

function summarise(rows: QualityRow[], orders: Order[]): QualitySummary {
  const accepted = rows.filter((r) => r.result === "accepted").length;
  const rejected = rows.filter((r) => r.result === "rejected").length;
  const timed = rows.filter((r) => r.onTime !== null);
  const onTime = timed.filter((r) => r.onTime).length;
  const reviews = orders.map((o) => o.review).filter((r): r is Review => Boolean(r));
  const stars = reviews.flatMap((r) => [r.quality, r.communication, r.value]);
  return {
    orders: rows.length,
    agreed: rows.filter((r) => r.agreement === "agreed").length,
    decided: accepted + rejected,
    accepted,
    rejected,
    passRatePct: pct1(accepted, accepted + rejected),
    finished: timed.length,
    onTime,
    onTimePct: pct1(onTime, timed.length),
    reviews: reviews.length,
    avgReview: stars.length ? round1(stars.reduce((a, b) => a + b, 0) / stars.length) : null,
    withQcEvidence: rows.filter((r) => r.evidence.qc + r.evidence.photo > 0).length,
  };
}

/** Every order's agreement + QC + result, newest first, with real and simulated summaries kept apart. */
export function qualityOverview(orders: Order[] = store.listOrders()): QualityOverview {
  const rows = orders.map(qualityRow).reverse();
  const real = orders.filter((o) => o.label === "real");
  const sim = orders.filter((o) => o.label !== "real");
  return {
    rows,
    real: summarise(rows.filter((r) => r.real), real),
    simulated: summarise(rows.filter((r) => !r.real), sim),
  };
}

// ---------- margins on Kesuni's own quotes ----------

export interface MarginRow {
  orderId: string;
  product: string;
  real: boolean;
  method: "weight" | "calculator";
  priceIdr: number;
  plannedCostIdr: number;
  plannedMarginPct: number;
  actualCostIdr: number | null;
  actualMarginPct: number | null;
  /** Planned or actual margin under the owner's minimum. */
  belowMin: boolean;
}

/**
 * Margin of every order whose chosen plan is Kesuni's own price (by weight or from the calculator), planned and,
 * once production reported its cost, actual. Partner plans carry no cost data and are left out.
 */
export function marginRows(orders: Order[] = store.listOrders(), minMarginPct = ownerRules().minMarginPct): MarginRow[] {
  const out: MarginRow[] = [];
  for (const o of orders) {
    const quote = o.chosenQuoteId ? store.getQuote(o.chosenQuoteId) : undefined;
    const gp = gramPricingForChosen(o);
    const calc = gp ? null : costingForChosen(o);
    if (!gp && !calc) continue;
    const priceIdr = quote ? quoteIdr(o, quote) : gp ? gp.totalIdr : calc!.revenueIdr;
    if (priceIdr <= 0) continue;
    const feeIdr = calc ? calc.feeIdr : 0;
    const plannedCostIdr = gp ? gp.costIdr : calc!.businessCostIdr;
    const margin = (cost: number) => round1(((priceIdr - feeIdr - cost) / priceIdr) * 100);
    const plannedMarginPct = margin(plannedCostIdr);
    const actualCostIdr = o.actual ? o.actual.costIdr : null;
    const actualMarginPct = actualCostIdr === null ? null : margin(actualCostIdr);
    out.push({
      orderId: o.id, product: o.product, real: o.label === "real", method: gp ? "weight" : "calculator",
      priceIdr, plannedCostIdr, plannedMarginPct, actualCostIdr, actualMarginPct,
      belowMin: plannedMarginPct < minMarginPct || (actualMarginPct !== null && actualMarginPct < minMarginPct),
    });
  }
  return out.reverse();
}

// ---------- production partners ----------

export interface PartnerRow {
  id: string;
  name: string;
  own: boolean;
  approved: boolean;
  /** Demo vendor: named "simulated" or paid to a placeholder address, so it can never receive real money. */
  simulated: boolean;
  address: string;
  placeholderAddress: boolean;
  quotes: { real: number; simulated: number };
  chosen: { real: number; simulated: number };
}

export function partnerRows(orders: Order[] = store.listOrders(), vendors: Vendor[] = store.listVendors()): PartnerRow[] {
  const rows = new Map<string, PartnerRow>(vendors.map((v) => {
    const placeholder = isPlaceholderAddress(v.address);
    return [v.id, {
      id: v.id, name: v.name, own: v.id === "own", approved: v.approved,
      simulated: v.id !== "own" && (/simulated/i.test(v.name) || placeholder),
      address: v.address, placeholderAddress: placeholder,
      quotes: { real: 0, simulated: 0 }, chosen: { real: 0, simulated: 0 },
    }];
  }));
  for (const o of orders) {
    const bucket = o.label === "real" ? "real" : "simulated";
    for (const q of store.listQuotes(o.id)) {
      const row = rows.get(q.vendorId);
      if (!row) continue;
      row.quotes[bucket]++;
      if (q.id === o.chosenQuoteId) row.chosen[bucket]++;
    }
  }
  // Kesuni's own studio first, then real partners, then demo ones.
  return [...rows.values()].sort((a, b) => Number(b.own) - Number(a.own) || Number(a.simulated) - Number(b.simulated));
}

// ---------- reputation ----------

export interface ReviewRow { orderId: string; product: string; real: boolean; review: Review; avg: number }

/** Customer reviews, newest first. Simulated ones are returned too, flagged, so the page can show them apart. */
export function reviewRows(orders: Order[] = store.listOrders()): ReviewRow[] {
  return orders
    .filter((o) => o.review)
    .map((o) => ({
      orderId: o.id, product: o.product, real: o.label === "real", review: o.review!,
      avg: round1((o.review!.quality + o.review!.communication + o.review!.value) / 3),
    }))
    .sort((a, b) => Date.parse(b.review.at) - Date.parse(a.review.at));
}

export interface ReputationPart { weightPct: number; label: string; value: string | null }

/** The five parts of the reputation score (src/lib/reputation.ts) with their weights and current real values. */
export function reputationParts(r: Reputation): ReputationPart[] {
  const pct = (n: number | null) => (n === null ? null : `${n}%`);
  const star = (n: number | null) => (n === null ? null : `${n} / 5`);
  return [
    { weightPct: 40, label: "Passed QC first time", value: pct(r.firstPassPct) },
    { weightPct: 25, label: "On time", value: pct(r.onTimePct) },
    { weightPct: 20, label: "Quality review", value: star(r.avg.quality) },
    { weightPct: 10, label: "Communication", value: star(r.avg.communication) },
    { weightPct: 5, label: "Worth the price", value: star(r.avg.value) },
  ];
}
