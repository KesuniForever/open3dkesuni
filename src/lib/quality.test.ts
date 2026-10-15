import { beforeEach, describe, expect, it } from "vitest";
import * as store from "./store";
import { agreementHash } from "./agreement";
import { reputation } from "./reputation";
import { marginRows, partnerRows, qualityOverview, qualityRow, reputationParts, reviewRows } from "./quality";
import type { Order, Quote, Spec } from "./types";

beforeEach(() => store.resetDb());

const SPEC: Spec = {
  dimensions: "40 × 25 × 10 mm", toleranceMm: 0.3, material: "PLA", color: "Black", layerMm: 0.2, infillPct: 20,
  finishing: "Standard", promise: "Every unit is measured with a caliper.",
};

function order(id: string, over: Partial<Order> = {}): Order {
  const o: Order = {
    id, jobId: `JOB-${id}`, product: `Part ${id}`, quantity: 2, deadline: "2026-10-20", designVersion: "v1",
    mandateMicro: 50_000_000, status: "IN_PRODUCTION", label: "real", createdAt: "2026-10-01T00:00:00Z", ...over,
  };
  store.saveOrder(o);
  return o;
}

function quote(orderId: string, over: Partial<Quote> = {}): Quote {
  const q: Quote = { id: `Q-${orderId}`, orderId, vendorId: "own", priceMicro: 2_000_000, etaHours: 48, source: "own", ...over };
  store.saveQuote(q);
  return q;
}

const accept = (orderId: string, accepted: boolean, at: string) =>
  store.saveAcceptance({ orderId, accepted, by: "Customer", note: "", at });

describe("qualityOverview", () => {
  it("keeps real and simulated results apart", () => {
    order("R1", { status: "ACCEPTED" });
    accept("R1", true, "2026-10-19T08:00:00Z");
    order("R2", { status: "REJECTED" });
    accept("R2", false, "2026-10-19T09:00:00Z");
    order("S1", { status: "PAID", label: "simulated" });
    accept("S1", true, "2026-10-18T09:00:00Z");

    const q = qualityOverview();
    expect(q.real).toMatchObject({ orders: 2, decided: 2, accepted: 1, rejected: 1, passRatePct: 50 });
    // The seeded ORD-001 is simulated and undecided.
    expect(q.simulated).toMatchObject({ orders: 2, decided: 1, accepted: 1, rejected: 0, passRatePct: 100 });
  });

  it("has no pass rate, on-time rate or review average before anything is decided", () => {
    const q = qualityOverview();
    expect(q.real).toMatchObject({ orders: 0, passRatePct: null, onTimePct: null, avgReview: null });
  });

  it("uses the same on-time rule as the reputation score (end of the deadline day, Jakarta)", () => {
    order("R1", { status: "ACCEPTED", deadline: "2026-10-20" });
    accept("R1", true, "2026-10-20T16:59:00Z"); // 23:59 WIB, on time
    order("R2", { status: "PAID", deadline: "2026-10-20" });
    accept("R2", true, "2026-10-20T17:01:00Z"); // 00:01 WIB next day, late
    order("R3", { status: "REJECTED", deadline: "2026-10-20" });
    accept("R3", false, "2026-10-19T00:00:00Z"); // rejected: not a finished order

    const q = qualityOverview();
    expect(q.real).toMatchObject({ finished: 2, onTime: 1, onTimePct: 50 });
    expect(q.real.onTimePct).toBe(reputation().onTimePct);
    expect(q.rows.find((r) => r.orderId === "R3")!.onTime).toBeNull();
  });

  it("averages all three review ratings of real orders", () => {
    order("R1", { status: "PAID", review: { quality: 5, communication: 4, value: 3, text: "Good", by: "A", at: "2026-10-10T00:00:00Z" } });
    order("S1", { status: "PAID", label: "simulated", review: { quality: 1, communication: 1, value: 1, text: "", by: "B", at: "2026-10-11T00:00:00Z" } });
    const q = qualityOverview();
    expect(q.real.avgReview).toBe(4);
    expect(q.real.reviews).toBe(1);
    expect(q.simulated.avgReview).toBe(1);
  });

  it("counts QC evidence by kind", () => {
    order("R1");
    for (const [i, kind] of (["photo", "photo", "qc", "log"] as const).entries()) {
      store.addEvidence({ id: `E-${i}`, orderId: "R1", kind, note: "n", label: "manual", at: "2026-10-02T00:00:00Z" });
    }
    const r = qualityRow(store.getOrder("R1")!);
    expect(r.evidence).toEqual({ log: 1, photo: 2, qc: 1 });
    expect(qualityOverview().real.withQcEvidence).toBe(1);
  });
});

describe("agreement state", () => {
  it("is agreed only while the approved fingerprint still matches the order", () => {
    const o = order("R1", { status: "PLAN_CHOSEN", spec: SPEC, chosenQuoteId: "Q-R1" });
    const q = quote("R1");
    const agreement = { version: 1, hash: agreementHash(o, q), quoteId: q.id, priceMicro: q.priceMicro, by: "A", at: "2026-10-02T00:00:00Z" };
    store.saveOrder({ ...o, agreement });
    expect(qualityRow(store.getOrder("R1")!).agreement).toBe("agreed");

    store.saveOrder({ ...store.getOrder("R1")!, spec: { ...SPEC, toleranceMm: 1 } });
    expect(qualityRow(store.getOrder("R1")!).agreement).toBe("changed");
    expect(qualityOverview().real.agreed).toBe(0);
  });

  it("tells a spec without approval apart from nothing at all", () => {
    expect(qualityRow(order("R1", { spec: SPEC })).agreement).toBe("spec");
    expect(qualityRow(order("R2")).agreement).toBe("none");
  });
});

describe("plan vs actual and margins", () => {
  const gram = (orderId: string, totalIdr: number, costIdr: number) => ({
    gramsPerUnit: 10, quantity: 2, pricePerGramIdr: 1500, costPerGramIdr: 750, unitPriceIdr: totalIdr / 2, totalIdr, costIdr,
    source: "Bambu Studio", quoteId: `Q-${orderId}`, by: "human" as const, at: "2026-10-01T00:00:00Z",
  });
  const actual = (costIdr: number, unitsPassed: number, maxDeviationMm: number) => ({
    filamentGrams: 21, machineHours: 1.5, costIdr, maxDeviationMm, unitsPassed, note: "", by: "Operator", at: "2026-10-05T00:00:00Z",
  });

  it("compares the actual report with the planned cost and the agreed tolerance", () => {
    const o = order("R1", { spec: SPEC, chosenQuoteId: "Q-R1", gramPricing: gram("R1", 30_000, 15_000), actual: actual(18_000, 1, 0.4) });
    quote("R1");
    expect(qualityRow(o).actual).toEqual({
      unitsPassed: 1, quantity: 2, firstPassPct: 50, maxDeviationMm: 0.4, toleranceMm: 0.3, withinTolerance: false,
      plannedCostIdr: 15_000, actualCostIdr: 18_000,
    });
  });

  it("flags a margin under the owner's minimum, planned or actual", () => {
    order("R1", { chosenQuoteId: "Q-R1", gramPricing: gram("R1", 30_000, 15_000), actual: actual(27_000, 2, 0.1) });
    quote("R1");
    order("R2", { chosenQuoteId: "Q-R2", gramPricing: gram("R2", 30_000, 15_000) });
    quote("R2");
    const rows = marginRows(store.listOrders(), 15);
    const r1 = rows.find((r) => r.orderId === "R1")!;
    expect(r1).toMatchObject({ method: "weight", priceIdr: 30_000, plannedMarginPct: 50, actualMarginPct: 10, belowMin: true });
    expect(rows.find((r) => r.orderId === "R2")).toMatchObject({ plannedMarginPct: 50, actualMarginPct: null, belowMin: false });
  });

  it("leaves out orders without Kesuni's own cost (partner plans, unpriced orders)", () => {
    order("R1", { chosenQuoteId: "Q-R1" });
    quote("R1", { vendorId: "partner-a", source: "partner" });
    expect(marginRows(store.listOrders(), 15)).toEqual([]);
  });

  it("ignores a by-weight price that is not the chosen plan", () => {
    order("R1", { chosenQuoteId: "Q-other", gramPricing: gram("R1", 30_000, 15_000) });
    quote("R1", { id: "Q-other", vendorId: "partner-a", source: "partner" });
    expect(marginRows(store.listOrders(), 15)).toEqual([]);
  });
});

describe("partnerRows", () => {
  it("puts Kesuni first, flags demo partners and counts quotes per real and simulated orders", () => {
    order("R1", { chosenQuoteId: "Q-R1" });
    quote("R1");
    quote("R1", { id: "Q-R1-p", vendorId: "partner-b", source: "partner" });
    const vendors = [
      { id: "partner-a", name: "Partner printer A (simulated)", address: "0x0000000000000000000000000000000000000002", approved: true },
      { id: "partner-b", name: "Bukittinggi Print", address: "0x1234567890abcdef1234567890abcdef12345678", approved: true },
      { id: "own", name: "Kesuni studio", address: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd", approved: true },
    ];
    const rows = partnerRows(store.listOrders(), vendors);
    expect(rows.map((r) => r.id)).toEqual(["own", "partner-b", "partner-a"]);
    // The seeded simulated ORD-001 has one own quote and one from partner-a.
    expect(rows[0]).toMatchObject({ own: true, simulated: false, quotes: { real: 1, simulated: 1 }, chosen: { real: 1, simulated: 0 } });
    expect(rows[1]).toMatchObject({ simulated: false, quotes: { real: 1, simulated: 0 }, chosen: { real: 0, simulated: 0 } });
    expect(rows[2]).toMatchObject({ simulated: true, placeholderAddress: true, quotes: { real: 0, simulated: 1 } });
  });
});

describe("reputation", () => {
  it("lists reviews newest first, flagged real or simulated", () => {
    order("R1", { status: "PAID", review: { quality: 5, communication: 5, value: 4, text: "", by: "A", at: "2026-10-10T00:00:00Z" } });
    order("S1", { status: "PAID", label: "simulated", review: { quality: 3, communication: 3, value: 3, text: "", by: "B", at: "2026-10-12T00:00:00Z" } });
    const rows = reviewRows();
    expect(rows.map((r) => [r.orderId, r.real, r.avg])).toEqual([["S1", false, 3], ["R1", true, 4.7]]);
  });

  it("shows the five weighted parts, empty until there is data", () => {
    const parts = reputationParts(reputation());
    expect(parts.map((p) => p.weightPct)).toEqual([40, 25, 20, 10, 5]);
    expect(parts.every((p) => p.value === null)).toBe(true);
  });
});
