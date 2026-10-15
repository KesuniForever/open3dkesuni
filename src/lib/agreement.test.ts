import { afterAll, beforeEach, describe, expect, it } from "vitest";
import * as store from "./store";
import { setCircleGateway } from "./circle";
import { addEvidence, chooseQuote, recordAcceptance } from "./actions";
import { agreementCurrent, customerAgree, quoteFromCosting, recordActual, setSpec } from "./agreement";
import { costingEtaHours } from "./costing";
import { customerPay, customerView, refreshPayment } from "./customer";
import { customerReview, reputation } from "./reputation";
import { DEMO, fakeCircle } from "./fake-circle.test-helper";

const ORDER = "ORD-001";
const SPEC = {
  dimensions: "60 × 30 × 15 mm", toleranceMm: 0.3, material: "PLA", color: "Hitam",
  layerMm: 0.2, infillPct: 20, finishing: "Standar", promise: "Korek masuk pas, tutup menutup rapat",
};

beforeEach(() => {
  process.env.KESUNI_PAYOUT_ADDRESS = "0x1111111111111111111111111111111111111111";
  process.env.KESUNI_DEMO_FUNDS_ADDRESS = DEMO;
  process.env.IDR_PER_USDC = "16000";
  store.resetDb();
  setCircleGateway(fakeCircle().gw);
});
afterAll(() => {
  setCircleGateway(undefined);
  delete process.env.IDR_PER_USDC;
});

describe("price from the cost calculator", () => {
  it("adds Kesuni's own quote in USDC and keeps the calculation", () => {
    const r = quoteFromCosting(ORDER, { gramsPerUnit: 300, machineHours: 6, unitPriceIdr: 160_000 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.quote).toMatchObject({ vendorId: "own", priceMicro: 10_000_000 }); // Rp160.000 / 16.000
    expect(store.getOrder(ORDER)!.costing?.quoteId).toBe(r.quote.id);
    expect(r.overBudget).toBe(false);
  });

  it("the quote is ready in machine time + labour hours, with no fixed 24 h on top", () => {
    const small = quoteFromCosting(ORDER, { unitPriceIdr: 160_000 }); // defaults: 1 h machine + 0.5 h labour
    if (!small.ok) throw new Error(small.error);
    expect(small.quote.etaHours).toBe(2);
    const big = quoteFromCosting(ORDER, { gramsPerUnit: 300, machineHours: 6, unitPriceIdr: 160_000 });
    if (!big.ok) throw new Error(big.error);
    expect(big.quote.etaHours).toBe(7);
    const given = quoteFromCosting(ORDER, { unitPriceIdr: 160_000, etaHours: 30 });
    if (!given.ok) throw new Error(given.error);
    expect(given.quote.etaHours).toBe(30);
    expect(costingEtaHours({ machineHours: 2.2, laborHours: 0.8 })).toBe(3); // not 4 from 3.0000000000000004
    expect(costingEtaHours({ machineHours: 0, laborHours: 0 })).toBe(1);
  });

  it("refuses a quantity that differs from the order", () => {
    expect(quoteFromCosting(ORDER, { quantity: 3 }).ok).toBe(false);
  });

  it("shows the customer where the money goes", () => {
    const r = quoteFromCosting(ORDER, { unitPriceIdr: 160_000 });
    if (!r.ok) throw new Error(r.error);
    chooseQuote(ORDER, r.quote.id, "agent", "within budget");
    const v = customerView(store.getOrder(ORDER)!, "t".repeat(24));
    expect(v.costs?.totalIdr).toBe(160_000);
    expect(v.costs!.lines.reduce((s, l) => s + l.idr, 0) + v.costs!.kesuniIdr).toBeGreaterThanOrEqual(159_990);
  });
});

describe("agreement", () => {
  beforeEach(() => { chooseQuote(ORDER, "Q-own", "agent", "within budget"); });

  it("the customer cannot pay before approving price and spec", async () => {
    const r = await customerPay(ORDER);
    expect(r.ok).toBe(false);
    expect(store.getEscrow(ORDER)).toBeUndefined(); // no wallets opened either
  });

  it("changing the spec after approval needs a new approval", () => {
    setSpec(ORDER, SPEC);
    const a = customerAgree(ORDER, "Aini");
    expect(a.ok && a.agreement.version).toBe(1);
    expect(agreementCurrent(store.getOrder(ORDER)!)).toBe(true);
    setSpec(ORDER, { ...SPEC, color: "Merah" });
    expect(agreementCurrent(store.getOrder(ORDER)!)).toBe(false);
    const b = customerAgree(ORDER, "Aini");
    expect(b.ok && b.agreement.version).toBe(2);
  });

  it("once the customer has paid, the spec is locked", async () => {
    setSpec(ORDER, SPEC);
    customerAgree(ORDER, "Aini");
    await customerPay(ORDER);
    for (let i = 0; i < 4; i++) await refreshPayment(ORDER);
    expect(store.getEscrow(ORDER)!.state).toBe("FUNDED");
    expect(setSpec(ORDER, { ...SPEC, color: "Merah" }).ok).toBe(false);
  });

  it("rejects a spec without a quality promise", () => {
    const r = setSpec(ORDER, { ...SPEC, promise: "" });
    expect(r.ok).toBe(false);
  });

  it("an empty finishing becomes \"Standard\"", () => {
    const r = setSpec(ORDER, { ...SPEC, finishing: "" });
    expect(r.ok && r.order.spec?.finishing).toBe("Standard");
  });
});

describe("plan vs actual, reviews and reputation", () => {
  async function finish(label: "real" | "simulated") {
    store.saveOrder({ ...store.getOrder(ORDER)!, label });
    chooseQuote(ORDER, "Q-own", "agent", "within budget");
    addEvidence(ORDER, { kind: "log", note: "printed", label: "device" });
    expect(recordActual(ORDER, { filamentGrams: 52, machineHours: 1.2, costIdr: 21_000, maxDeviationMm: 0.2, unitsPassed: 1, by: "Khelda" }).ok).toBe(true);
    addEvidence(ORDER, { kind: "qc", note: "rapi", label: "manual" });
    recordAcceptance(ORDER, { accepted: true, by: "Aini", note: "" });
  }

  it("refuses an actual report with more passed units than ordered", async () => {
    chooseQuote(ORDER, "Q-own", "agent", "within budget");
    addEvidence(ORDER, { kind: "log", note: "printed", label: "device" });
    expect(recordActual(ORDER, { filamentGrams: 1, machineHours: 1, costIdr: 1, maxDeviationMm: 0, unitsPassed: 2, by: "K" }).ok).toBe(false);
  });

  it("a review is possible once, after acceptance", async () => {
    expect(customerReview(ORDER, { quality: 5, communication: 5, value: 5, by: "Aini" }).ok).toBe(false);
    await finish("real");
    const bad = customerReview(ORDER, { quality: 6, communication: 5, value: 5, by: "Aini" });
    expect(!bad.ok && bad.reasons).toEqual(["Quality rating must be 1 to 5"]);
    expect(customerReview(ORDER, { quality: 5, communication: 4, value: 5, by: "Aini", text: "rapi" }).ok).toBe(true);
    expect(customerReview(ORDER, { quality: 5, communication: 4, value: 5, by: "Aini" }).ok).toBe(false);
  });

  it("reputation counts real finished orders only, and one order cannot max it out", async () => {
    expect(reputation().score).toBeNull();
    await finish("simulated");
    expect(reputation().score).toBeNull();
    store.saveOrder({ ...store.getOrder(ORDER)!, label: "real" });
    customerReview(ORDER, { quality: 5, communication: 5, value: 5, by: "Aini" });
    const rep = reputation();
    expect(rep.finished).toBe(1);
    expect(rep.evidence).toBe("limited");
    expect(rep.score!).toBeGreaterThan(70);
    expect(rep.score!).toBeLessThan(100);
  });
});
