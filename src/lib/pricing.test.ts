import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import * as store from "./store";
import { approveByOwner, createOrder, chooseQuote, ensureCustomerToken } from "./actions";
import { quoteByWeight } from "./agreement";
import { customerView } from "./customer";
import { ownerRuleReasons } from "./owner-rules";
import { priceByWeight, pricingConfig } from "./pricing";
import { POST as priceRoute } from "@/app/api/orders/[id]/price-by-weight/route";
import { POST as approvalRoute } from "@/app/api/orders/[id]/owner-approval/route";
import { POST as gramsRoute } from "@/app/api/orders/[id]/slicer-grams/route";
import { setLlmGateway } from "./agent/chief";
import { callTool } from "./agent/tools";

const ENV = ["KESUNI_PRICE_PER_GRAM_IDR", "KESUNI_COST_PER_GRAM_IDR", "KESUNI_PRICE_ROUND_IDR", "KESUNI_GRAMS_PER_HOUR", "KESUNI_PRINTER_COUNT"];
const price = (g: number, q = 1) => {
  const r = priceByWeight(g, q);
  if (!r.ok) throw new Error(r.reasons.join());
  return r.price;
};

beforeEach(() => {
  process.env.IDR_PER_USDC = "16000";
  store.resetDb();
});
afterEach(() => { for (const k of ENV) delete process.env[k]; });
afterAll(() => { delete process.env.IDR_PER_USDC; setLlmGateway(undefined); });
const json = (body: unknown) => new Request("http://x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const ctxOf = (id: string) => ({ params: Promise.resolve({ id }) });
const settle = () => new Promise((r) => setTimeout(r, 20));

describe("price by weight (Kesuni's official price)", () => {
  it("casing korek 16 g: Rp24.000 per unit; Aini's 50 units: Rp1.200.000", () => {
    expect(price(16).unitPriceIdr).toBe(24_000);
    const p = price(16, 50);
    expect(p).toMatchObject({ unitPriceIdr: 24_000, totalIdr: 1_200_000, unitCostIdr: 12_000, costIdr: 600_000, marginPct: 50 });
    // 800 g on 2 printers at ~15 g/h = 26.7 h → 27 h, plus 24 h for prep, QC and packing
    expect(p.etaHours).toBe(51);
  });

  it("rounds the unit price UP to the nearest Rp500", () => {
    expect(price(38.2).unitPriceIdr).toBe(57_500);   // 57.300
    expect(price(5).unitPriceIdr).toBe(7_500);       // exact
    expect(price(29.27).unitPriceIdr).toBe(44_000);  // 43.905
  });

  it("refuses grams that are zero, negative, missing or too big, and bad quantities", () => {
    for (const g of [0, -1, Number.NaN, 5000.5]) expect(priceByWeight(g, 1).ok).toBe(false);
    expect(priceByWeight(5000, 1).ok).toBe(true);
    for (const q of [0, 1.5, -2]) expect(priceByWeight(10, q).ok).toBe(false);
  });

  it("the numbers come from env", () => {
    process.env.KESUNI_PRICE_PER_GRAM_IDR = "2000";
    process.env.KESUNI_PRICE_ROUND_IDR = "1000";
    process.env.KESUNI_PRINTER_COUNT = "1";
    process.env.KESUNI_GRAMS_PER_HOUR = "abc"; // ignored: default 15
    expect(pricingConfig()).toMatchObject({ pricePerGramIdr: 2000, roundIdr: 1000, printerCount: 1, gramsPerHour: 15 });
    expect(price(16).unitPriceIdr).toBe(32_000);
  });
});

describe("quoteByWeight: Kesuni's own quote", () => {
  const aini = () => {
    const r = createOrder({ product: "Casing korek", quantity: 50, deadline: "2099-12-31", designVersion: "v1", mandateMicro: 100_000_000, label: "real", customerName: "Aini" });
    if (!r.ok) throw new Error(r.error);
    return r.order.id;
  };

  it("adds an own quote in USDC and saves where the grams came from; above Rp1.000.000 the owner approves", () => {
    const id = aini();
    const r = quoteByWeight(id, { gramsPerUnit: 16, source: "Bambu Studio, plate 1", by: "human" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.quote).toMatchObject({ vendorId: "own", source: "own", priceMicro: 75_000_000, etaHours: 51 });
    expect(store.getOrder(id)!.gramPricing).toMatchObject({ gramsPerUnit: 16, unitPriceIdr: 24_000, totalIdr: 1_200_000, costIdr: 600_000, source: "Bambu Studio, plate 1", by: "human", quoteId: r.quote.id });
    expect(store.listLog(id).at(-1)).toMatchObject({ tool: "price_by_weight", actor: "human", ok: true });
    expect(ownerRuleReasons(store.getOrder(id)!, r.quote).reasons.join()).toMatch(/owner approval needed/);
  });

  it("needs a source, and only works while the order is CREATED", () => {
    const id = aini();
    expect(quoteByWeight(id, { gramsPerUnit: 16, source: "  ", by: "human" })).toMatchObject({ ok: false, status: 400 });
    expect(quoteByWeight("ORD-001", { gramsPerUnit: 300, source: "slicer", by: "human" }).ok).toBe(true);
    expect(chooseQuote("ORD-001", store.getOrder("ORD-001")!.gramPricing!.quoteId, "human", "ok").ok).toBe(true);
    expect(quoteByWeight("ORD-001", { gramsPerUnit: 200, source: "slicer", by: "human" })).toMatchObject({ ok: false, status: 409 });
  });

  it("pricing again replaces the earlier by-weight quote instead of piling up", () => {
    const id = aini();
    const first = quoteByWeight(id, { gramsPerUnit: 16, source: "estimate from the operator", by: "human" });
    const second = quoteByWeight(id, { gramsPerUnit: 15.5, source: "Bambu Studio", by: "human", etaHours: 60 });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    const quotes = store.listQuotes(id);
    expect(quotes.map((q) => q.id)).toEqual([second.quote.id]);
    expect(second.quote.etaHours).toBe(60);
    expect(store.getQuote(first.quote.id)).toBeUndefined();
  });

  it("never touches other quotes (partner, calculator)", () => {
    quoteByWeight("ORD-001", { gramsPerUnit: 300, source: "slicer", by: "human" });
    quoteByWeight("ORD-001", { gramsPerUnit: 310, source: "slicer", by: "human" });
    expect(store.listQuotes("ORD-001").map((q) => q.id)).toEqual(expect.arrayContaining(["Q-own", "Q-partner"]));
    expect(store.listQuotes("ORD-001")).toHaveLength(3);
  });

  it("the customer sees grams × price per gram, never Kesuni's cost or margin", () => {
    const r = quoteByWeight("ORD-001", { gramsPerUnit: 38.2, source: "slicer", by: "human" });
    if (!r.ok) throw new Error(r.error);
    approveByOwner("ORD-001", { quoteId: r.quote.id, by: "Khelda", note: "small pilot order" }); // Rp57.500 is under the minimum
    expect(chooseQuote("ORD-001", r.quote.id, "human", "by weight").ok).toBe(true);
    const v = customerView(store.getOrder("ORD-001")!, ensureCustomerToken("ORD-001")!);
    expect(v.weightPrice).toEqual({ gramsPerUnit: 38.2, pricePerGramIdr: 1500, exactUnitIdr: 57_300, unitPriceIdr: 57_500, quantity: 1, totalIdr: 57_500 });
    expect(v.costs).toBeNull();
    const json = JSON.stringify(v);
    expect(json).not.toMatch(/costIdr|costPerGram|marginPct|"source"/);
  });

  it("operator API: POST /api/orders/[id]/price-by-weight", async () => {
    const ctx = { params: Promise.resolve({ id: "ORD-001" }) };
    const post = (body: unknown) => priceRoute(new Request("http://x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), ctx);
    expect((await post({ gramsPerUnit: 300 })).status).toBe(400); // no source
    expect((await post({ gramsPerUnit: 300, source: "slicer", by: "agent" })).status).toBe(400);
    const ok = await post({ gramsPerUnit: 300, source: "Bambu Studio", by: "Khelda" });
    expect(ok.status).toBe(201);
    expect((await ok.json()).price.unitPriceIdr).toBe(450_000);
    expect(store.getOrder("ORD-001")!.gramPricing!.by).toBe("human");
  });
});

describe("owner approval (Aini: 50 × 16 g = Rp1.200.000, above the Rp1.000.000 limit)", () => {
  const aini = () => {
    const r = createOrder({ product: "Casing korek", quantity: 50, deadline: "2099-12-31", designVersion: "v1", mandateMicro: 400_000_000, label: "real", customerName: "Aini" });
    if (!r.ok) throw new Error(r.error);
    return r.order.id;
  };

  it("is for the approved quote at its price: the Chief re-pricing afterwards needs a new approval", () => {
    const id = aini();
    const first = quoteByWeight(id, { gramsPerUnit: 16, source: "Bambu Studio", by: "human" });
    if (!first.ok) throw new Error(first.error);
    expect(chooseQuote(id, first.quote.id, "agent", "x")).toMatchObject({ ok: false, reasons: [expect.stringMatching(/owner approval needed/)] });
    expect(approveByOwner(id, { quoteId: first.quote.id, by: "Khelda", note: "OK 1,2 juta" }).ok).toBe(true);
    // The Chief re-prices at 60 g (Rp4.500.000): the approval of Rp1.200.000 does not carry over.
    store.saveOrder({ ...store.getOrder(id)!, slicerGrams: { gramsPerUnit: 60, source: "Bambu Studio", by: "operator", at: "" } });
    const again = callTool("price_by_weight", { orderId: id, gramsPerUnit: 60, source: "Bambu Studio" });
    const quoteId = (again.data as { quote: { id: string } }).quote.id;
    expect(store.getOrder(id)!.ownerApproval).toBeUndefined();
    expect(chooseQuote(id, quoteId, "agent", "x")).toMatchObject({ ok: false, reasons: [expect.stringMatching(/Rp4\.500\.000 is above/)] });
  });

  it("closes the Chief's open question and wakes the Chief to choose the plan", async () => {
    const id = aini();
    const q = quoteByWeight(id, { gramsPerUnit: 16, source: "Bambu Studio", by: "human" });
    if (!q.ok) throw new Error(q.error);
    store.saveTask({ id: "T-q", orderId: id, kind: "needs_info", text: "Rp1.200.000 di atas batas. Setujui?", status: "open", createdBy: "agent", at: new Date().toISOString() });
    const woken: string[] = [];
    setLlmGateway(async (req) => {
      woken.push(String(req.messages[0].content));
      return { stop_reason: "end_turn", content: [{ type: "text", text: "ok" }] };
    });
    expect((await approvalRoute(json({ by: "Khelda", note: "OK 1,2 juta" }), ctxOf(id))).status).toBe(200); // the only approvable quote
    await settle();
    expect(store.getOrder(id)!.ownerApproval).toMatchObject({ quoteId: q.quote.id, priceMicro: q.quote.priceMicro, by: "Khelda" });
    expect(store.getTask("T-q")).toMatchObject({ status: "done", doneBy: "Khelda (approved by the owner)" });
    expect(woken.join()).toMatch(/owner approved an exception/);
    expect((await approvalRoute(json({ quoteId: "Q-nope", by: "Khelda", note: "x" }), ctxOf(id))).status).toBe(400);
  });

  it("the customer page shows the agreed Rp1.200.000, not a value converted back from USDC cents", () => {
    process.env.IDR_PER_USDC = "16500"; // Rp1.200.000 → 72,73 USDC → Rp1.200.045
    const id = aini();
    const q = quoteByWeight(id, { gramsPerUnit: 16, source: "Bambu Studio", by: "human" });
    if (!q.ok) throw new Error(q.error);
    approveByOwner(id, { quoteId: q.quote.id, by: "Khelda", note: "pilot" });
    expect(chooseQuote(id, q.quote.id, "human", "by weight").ok).toBe(true);
    const v = customerView(store.getOrder(id)!, ensureCustomerToken(id)!);
    expect(v.price).toMatchObject({ usdc: "72.73", idr: 1_200_000 });
  });
});

describe("slicer grams: the only grams the Chief may price with", () => {
  it("operator API: POST /api/orders/[id]/slicer-grams saves them and wakes the Chief", async () => {
    const woken: string[] = [];
    setLlmGateway(async (req) => {
      woken.push(String(req.messages[0].content));
      return { stop_reason: "end_turn", content: [{ type: "text", text: "ok" }] };
    });
    expect((await gramsRoute(json({ gramsPerUnit: 16 }), ctxOf("ORD-001"))).status).toBe(400); // no source
    const ok = await gramsRoute(json({ gramsPerUnit: 16, source: "Bambu Studio, plate 1", by: "Khelda" }), ctxOf("ORD-001"));
    expect(ok.status).toBe(200);
    await settle();
    expect(store.getOrder("ORD-001")!.slicerGrams).toMatchObject({ gramsPerUnit: 16, source: "Bambu Studio, plate 1", by: "Khelda" });
    expect(woken.join()).toMatch(/16 g/);
  });

  it("a person's by-weight price also counts as trusted grams", () => {
    expect(quoteByWeight("ORD-001", { gramsPerUnit: 20, source: "slicer", by: "human" }).ok).toBe(true);
    expect(store.getOrder("ORD-001")!.slicerGrams).toMatchObject({ gramsPerUnit: 20, by: "operator" });
    expect(quoteByWeight("ORD-001", { gramsPerUnit: 21, source: "agent", by: "agent" }).ok).toBe(true);
    expect(store.getOrder("ORD-001")!.slicerGrams!.gramsPerUnit).toBe(20); // the agent never sets them
  });
});
