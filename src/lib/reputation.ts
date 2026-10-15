// Customer reviews and Kesuni's reputation, built from finished work rather than order count.
// Score (0–100), same weights as our earlier prototype:
//   40% passed QC without rework · 25% on time · 20% quality review · 10% communication · 5% worth the price.
// Each part starts from a neutral 70/100 worth PRIOR_WEIGHT orders, so one order cannot swing the score.
// Only real orders count: simulated orders are never reputation (or traction).
import * as store from "./store";
import type { Fail } from "./actions";
import type { Order, Review } from "./types";

const fail = (status: number, error: string, reasons?: string[]): Fail => ({ ok: false, status, error, reasons });
const PRIOR = 70;
const PRIOR_WEIGHT = 3;

export function customerReview(orderId: string, raw: Record<string, unknown>): { ok: true; review: Review } | Fail {
  const order = store.getOrder(orderId);
  if (!order) return fail(404, "Order not found");
  if (!["ACCEPTED", "PAID"].includes(order.status)) return fail(409, "Reviews open after the item is accepted");
  if (order.review) return fail(409, "This order already has a review");
  const star = (k: string) => Number(raw[k]);
  const review: Review = {
    quality: star("quality"), communication: star("communication"), value: star("value"),
    text: String(raw.text ?? "").trim().slice(0, 1000), by: String(raw.by ?? "").trim().slice(0, 80), at: new Date().toISOString(),
  };
  const r: string[] = [];
  const RATING = { quality: "Quality", communication: "Communication", value: "Value" } as const;
  for (const k of ["quality", "communication", "value"] as const) {
    if (!Number.isInteger(review[k]) || review[k] < 1 || review[k] > 5) r.push(`${RATING[k]} rating must be 1 to 5`);
  }
  if (!review.by) r.push("Name is required");
  if (r.length) return fail(400, "The review is incomplete", r);
  store.saveOrder({ ...order, review });
  store.addLog({ orderId, actor: "human", tool: "customer_review", input: { quality: review.quality }, ok: true, output: {}, at: review.at });
  return { ok: true, review };
}

export interface Reputation {
  score: number | null;        // null until at least one real order is finished
  evidence: "none" | "limited" | "solid";
  finished: number;            // real orders accepted or paid
  reviews: number;
  onTimePct: number | null;
  firstPassPct: number | null;
  avg: { quality: number | null; communication: number | null; value: number | null };
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const smooth = (xs: number[]) => (xs.reduce((a, b) => a + b, 0) + PRIOR * PRIOR_WEIGHT) / (xs.length + PRIOR_WEIGHT);
const round1 = (n: number | null) => (n === null ? null : Math.round(n * 10) / 10);

/** Finished on time: accepted no later than the end of the deadline day (Jakarta time). */
function onTime(order: Order): boolean | null {
  const acc = store.getAcceptance(order.id);
  if (!acc) return null;
  return Date.parse(acc.at) <= Date.parse(`${order.deadline}T23:59:59+07:00`);
}

export function reputation(orders: Order[] = store.listOrders()): Reputation {
  const finished = orders.filter((o) => o.label === "real" && ["ACCEPTED", "PAID"].includes(o.status));
  const timely = finished.map(onTime).filter((x): x is boolean => x !== null).map((x) => (x ? 100 : 0));
  const firstPass = finished.filter((o) => o.actual).map((o) => (o.actual!.unitsPassed / o.quantity) * 100);
  const reviews = finished.map((o) => o.review).filter((r): r is Review => Boolean(r));
  const pct = (stars: number[]) => stars.map((s) => ((s - 1) / 4) * 100);
  const score = finished.length === 0 ? null : Math.round(
    0.4 * smooth(firstPass) + 0.25 * smooth(timely) +
    0.2 * smooth(pct(reviews.map((r) => r.quality))) + 0.1 * smooth(pct(reviews.map((r) => r.communication))) +
    0.05 * smooth(pct(reviews.map((r) => r.value))),
  );
  return {
    score,
    evidence: finished.length === 0 ? "none" : finished.length < 5 ? "limited" : "solid",
    finished: finished.length,
    reviews: reviews.length,
    onTimePct: round1(mean(timely)),
    firstPassPct: round1(mean(firstPass)),
    avg: {
      quality: round1(mean(reviews.map((r) => r.quality))),
      communication: round1(mean(reviews.map((r) => r.communication))),
      value: round1(mean(reviews.map((r) => r.value))),
    },
  };
}
