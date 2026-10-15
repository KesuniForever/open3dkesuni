import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import * as store from "./store";
import { approveByOwner, createOrder, chooseQuote, ensureCustomerToken } from "./actions";
import { quoteByWeight } from "./agreement";
import { customerView } from "./customer";
import { ownerRuleReasons } from "./owner-rules";
import {
  DEFAULT_PRINT_MIN_PER_GRAM, orderMaterial, parseColorMode, parseMinutesRange, priceByWeight, pricingConfig, pricingFor, toColorMode, toMaterial,
  type ColorMode,
} from "./pricing";
import { POST as priceRoute } from "@/app/api/orders/[id]/price-by-weight/route";
import { POST as approvalRoute } from "@/app/api/orders/[id]/owner-approval/route";
import { POST as gramsRoute } from "@/app/api/orders/[id]/slicer-grams/route";
import { setLlmGateway } from "./agent/chief";
import { callTool } from "./agent/tools";

const ENV = [
  "KESUNI_PRICE_PER_GRAM_IDR", "KESUNI_COST_PER_GRAM_IDR", "KESUNI_PRICE_ROUND_IDR", "KESUNI_PRINTER_COUNT",
  "KESUNI_PRINT_MIN_PER_GRAM_SINGLE", "KESUNI_PRINT_MIN_PER_GRAM_MULTI", "KESUNI_HANDLING_HOURS",
];
const price = (g: number, q = 1, mode: ColorMode = "single") => {
  const r = priceByWeight(g, q, mode);
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
    // 50 pieces on 3 printers = 17 rounds × 16 g × 3–5 min = 816–1360 min (13.6–22.7 h) → 23 h, plus 1 h to collect, check and pack
    expect(p).toMatchObject({ batches: 17, printMinutes: { min: 816, max: 1360 }, handlingHours: 1, etaHours: 24 });
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
    expect(pricingConfig()).toMatchObject({ pricePerGramIdr: 2000, roundIdr: 1000, printerCount: 1 });
    expect(price(16).unitPriceIdr).toBe(32_000);
  });
});

describe("print time and ETA (QA: 1 g showed ± 25 hours)", () => {
  it("defaults: single colour 3–5 min per gram, multi colour 5–15, 1 h handling, Kesuni's 3 printers", () => {
    expect(pricingConfig()).toMatchObject({
      printMinPerGram: { single: { min: 3, max: 5 }, multi: { min: 5, max: 15 } }, handlingHours: 1, printerCount: 3,
    });
    expect(pricingConfig()).not.toHaveProperty("gramsPerHour"); // KESUNI_GRAMS_PER_HOUR is retired
  });

  it("1 g single colour prints in 3–5 min and is ready in 2 h, not 25 h", () => {
    expect(price(1)).toMatchObject({ colorMode: "single", batches: 1, printMinutes: { min: 3, max: 5 }, handlingHours: 1, etaHours: 2 });
  });

  it("10 g single colour: 30–50 min", () => {
    expect(price(10)).toMatchObject({ printMinutes: { min: 30, max: 50 }, etaHours: 2 });
  });

  it("multi colour: 1 g 5–15 min, 10 g 50–150 min (ready in 3 h + 1 h)", () => {
    expect(price(1, 1, "multi")).toMatchObject({ colorMode: "multi", printMinutes: { min: 5, max: 15 }, etaHours: 2 });
    expect(price(10, 1, "multi")).toMatchObject({ printMinutes: { min: 50, max: 150 }, etaHours: 4 });
  });

  it("the colour mode never changes the price", () => {
    const single = price(38.2, 7);
    const multi = price(38.2, 7, "multi");
    for (const k of ["unitPriceIdr", "totalIdr", "costIdr", "marginPct", "pricePerGramIdr"] as const) expect(multi[k]).toBe(single[k]);
    expect(multi.etaHours).toBeGreaterThan(single.etaHours);
  });

  it("one unit is never split across printers; units print side by side: 7 units on 3 printers = 3 rounds", () => {
    expect(price(10, 7)).toMatchObject({ batches: 3, printMinutes: { min: 90, max: 150 }, etaHours: 4 });
    expect(price(10, 3)).toMatchObject({ batches: 1, printMinutes: { min: 30, max: 50 } }); // 3 at once
    expect(price(10, 4)).toMatchObject({ batches: 2, printMinutes: { min: 60, max: 100 } });
    process.env.KESUNI_PRINTER_COUNT = "2";
    expect(price(10, 7)).toMatchObject({ batches: 4, printMinutes: { min: 120, max: 200 }, etaHours: 5 });
  });

  it("etaHours = whole hours of the slowest print time + handling; exactly 60 min is 1 h, not 2", () => {
    expect(price(12)).toMatchObject({ printMinutes: { min: 36, max: 60 }, etaHours: 2 }); // 12 g × 5 min = 60 min → 1 h + 1 h
    expect(price(12.01).etaHours).toBe(3);                                                 // 60.05 min → 2 h + 1 h
    expect(price(38.2)).toMatchObject({ printMinutes: { min: 114.6, max: 191 }, etaHours: 5 });
  });

  it("handling hours come from KESUNI_HANDLING_HOURS (whole hours, 0 allowed); bad values fall back to 1 h", () => {
    const eta = (v: string) => { process.env.KESUNI_HANDLING_HOURS = v; return [pricingConfig().handlingHours, price(10).etaHours]; };
    expect(eta("3")).toEqual([3, 4]);
    expect(eta("0")).toEqual([0, 1]);
    expect(eta("1.5")).toEqual([2, 3]);
    for (const bad of ["abc", "-2", "500"]) expect(eta(bad)).toEqual([1, 2]);
  });

  it("minutes per gram come from KESUNI_PRINT_MIN_PER_GRAM_SINGLE / _MULTI as min-max", () => {
    process.env.KESUNI_PRINT_MIN_PER_GRAM_SINGLE = "2-4";
    process.env.KESUNI_PRINT_MIN_PER_GRAM_MULTI = " 6 – 12 ";
    expect(pricingConfig().printMinPerGram).toEqual({ single: { min: 2, max: 4 }, multi: { min: 6, max: 12 } });
    expect(price(10).printMinutes).toEqual({ min: 20, max: 40 });
    expect(price(10, 1, "multi").printMinutes).toEqual({ min: 60, max: 120 });
    process.env.KESUNI_PRINT_MIN_PER_GRAM_SINGLE = "nonsense";
    process.env.KESUNI_PRINT_MIN_PER_GRAM_MULTI = "15-5";
    expect(pricingConfig().printMinPerGram).toEqual(DEFAULT_PRINT_MIN_PER_GRAM);
  });

  it("parses a range with sane limits, else falls back", () => {
    const d = { min: 3, max: 5 };
    expect(parseMinutesRange("3-5", d)).toEqual({ min: 3, max: 5 });
    expect(parseMinutesRange("3.5-4.5", d)).toEqual({ min: 3.5, max: 4.5 });
    expect(parseMinutesRange("3–5", d)).toEqual({ min: 3, max: 5 });
    expect(parseMinutesRange("4", d)).toEqual({ min: 4, max: 4 });
    for (const bad of [undefined, "", "abc", "5-3", "0-5", "-3-5", "3-61", "3,5-4", "3-5-7", "3 to 5"]) {
      expect(parseMinutesRange(bad, d), String(bad)).toEqual(d);
    }
  });

  it("colour mode from requests and stored rows: missing is single colour, unknown is refused", () => {
    expect([undefined, null, ""].map(parseColorMode)).toEqual(["single", "single", "single"]);
    expect(parseColorMode("multi")).toBe("multi");
    expect(parseColorMode("rainbow")).toBeNull();
    expect(toColorMode(undefined)).toBe("single"); // rows saved before the colour mode existed
    expect(toColorMode("multi")).toBe("multi");
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
    expect(r.quote).toMatchObject({ vendorId: "own", source: "own", priceMicro: 75_000_000, etaHours: 24 });
    expect(store.getOrder(id)!.gramPricing).toMatchObject({ gramsPerUnit: 16, unitPriceIdr: 24_000, totalIdr: 1_200_000, costIdr: 600_000, source: "Bambu Studio, plate 1", colorMode: "single", by: "human", quoteId: r.quote.id });
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

  it("operator API takes colorMode: multi colour makes the ETA longer, the price stays the same", async () => {
    const id = aini(); // 50 units
    const res = await priceRoute(json({ gramsPerUnit: 16, source: "Bambu Studio", colorMode: "multi" }), ctxOf(id));
    expect(res.status).toBe(201);
    const body = await res.json();
    // 17 rounds × 16 g × 5–15 min = 1360–4080 min → 68 h + 1 h
    expect(body.price).toMatchObject({ colorMode: "multi", totalIdr: 1_200_000, printMinutes: { min: 1360, max: 4080 }, etaHours: 69 });
    expect(body.quote.etaHours).toBe(69);
    expect(store.getOrder(id)!.gramPricing).toMatchObject({ colorMode: "multi", totalIdr: 1_200_000 });
    expect(store.getOrder(id)!.slicerGrams).toMatchObject({ gramsPerUnit: 16, colorMode: "multi" });
    expect(store.listLog(id).at(-1)).toMatchObject({ tool: "price_by_weight", input: { colorMode: "multi" }, output: { etaHours: 69 } });
    // Without colorMode it is single colour.
    expect((await (await priceRoute(json({ gramsPerUnit: 16, source: "Bambu Studio" }), ctxOf(id))).json()).quote.etaHours).toBe(24);
    expect(store.getOrder(id)!.gramPricing!.colorMode).toBe("single");
    const bad = await priceRoute(json({ gramsPerUnit: 16, source: "Bambu Studio", colorMode: "rainbow" }), ctxOf(id));
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toMatch(/Colour mode must be "single" or "multi"/);
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
    process.env.IDR_PER_USDC = "16500"; // Rp1.200.000 → 72,727273 USDC (micro-USDC since 15 Oct 2026; cents gave 72,73)
    const id = aini();
    const q = quoteByWeight(id, { gramsPerUnit: 16, source: "Bambu Studio", by: "human" });
    if (!q.ok) throw new Error(q.error);
    approveByOwner(id, { quoteId: q.quote.id, by: "Khelda", note: "pilot" });
    expect(chooseQuote(id, q.quote.id, "human", "by weight").ok).toBe(true);
    const v = customerView(store.getOrder(id)!, ensureCustomerToken(id)!);
    expect(v.price).toMatchObject({ usdc: "72.727273", idr: 1_200_000 });
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
    expect(store.getOrder("ORD-001")!.slicerGrams).toMatchObject({ gramsPerUnit: 16, source: "Bambu Studio, plate 1", by: "Khelda", colorMode: "single" });
    expect(woken.join()).toMatch(/16 g, single colour/);
  });

  it("operator API: slicer grams carry the colour mode for the Chief; an unknown mode is refused", async () => {
    const woken: string[] = [];
    setLlmGateway(async (req) => {
      woken.push(String(req.messages[0].content));
      return { stop_reason: "end_turn", content: [{ type: "text", text: "ok" }] };
    });
    expect((await gramsRoute(json({ gramsPerUnit: 16, source: "Bambu Studio", by: "Khelda", colorMode: "rgb" }), ctxOf("ORD-001"))).status).toBe(400);
    expect(store.getOrder("ORD-001")!.slicerGrams).toBeUndefined();
    const ok = await gramsRoute(json({ gramsPerUnit: 16, source: "Bambu Studio", by: "Khelda", colorMode: "multi" }), ctxOf("ORD-001"));
    expect(ok.status).toBe(200);
    await settle();
    expect(store.getOrder("ORD-001")!.slicerGrams).toMatchObject({ gramsPerUnit: 16, colorMode: "multi" });
    expect(woken.join()).toMatch(/16 g, multi colour/);
    // The Chief prices with that colour mode: ORD-001 is 1 unit, 16 g × 5–15 min = 80–240 min → 4 h + 1 h.
    const r = callTool("price_by_weight", { orderId: "ORD-001", gramsPerUnit: 16, source: "Bambu Studio" });
    expect(r.data).toMatchObject({ colorMode: "multi", printMinutes: { min: 80, max: 240 }, handlingHours: 1, etaHours: 5 });
    expect(store.getOrder("ORD-001")!.gramPricing).toMatchObject({ colorMode: "multi", by: "agent" });
  });

  it("a person's by-weight price also counts as trusted grams", () => {
    expect(quoteByWeight("ORD-001", { gramsPerUnit: 20, source: "slicer", by: "human" }).ok).toBe(true);
    expect(store.getOrder("ORD-001")!.slicerGrams).toMatchObject({ gramsPerUnit: 20, by: "operator" });
    expect(quoteByWeight("ORD-001", { gramsPerUnit: 21, source: "agent", by: "agent" }).ok).toBe(true);
    expect(store.getOrder("ORD-001")!.slicerGrams!.gramsPerUnit).toBe(20); // the agent never sets them
  });
});

describe("materials: PLA and PETG, each with its own price per gram", () => {
  afterEach(() => { delete process.env.KESUNI_PRICE_PER_GRAM_IDR_PETG; delete process.env.KESUNI_COST_PER_GRAM_IDR_PETG; });

  it("PETG costs the same as PLA unless the env says otherwise", () => {
    expect(pricingConfig().materials).toEqual({ PLA: { pricePerGramIdr: 1500, costPerGramIdr: 750 }, PETG: { pricePerGramIdr: 1500, costPerGramIdr: 750 } });
    process.env.KESUNI_PRICE_PER_GRAM_IDR = "1600";
    expect(pricingConfig().materials!.PETG).toEqual({ pricePerGramIdr: 1600, costPerGramIdr: 750 }); // follows the PLA price
    process.env.KESUNI_PRICE_PER_GRAM_IDR_PETG = "1800";
    process.env.KESUNI_COST_PER_GRAM_IDR_PETG = "900";
    const cfg = pricingConfig();
    expect(pricingFor(cfg, "PETG")).toMatchObject({ pricePerGramIdr: 1800, costPerGramIdr: 900 });
    expect(pricingFor(cfg, "PLA")).toMatchObject({ pricePerGramIdr: 1600, costPerGramIdr: 750 });
    expect(pricingFor(cfg, null)).toBe(cfg);
  });

  it("an order's material: the choice on the order, else a plain PLA/PETG spec", () => {
    expect(toMaterial("PLA Basic")).toBe("PLA");
    expect(toMaterial("petg hf")).toBe("PETG");
    expect(toMaterial("PLA-CF")).toBeNull();
    expect(orderMaterial({ material: "PETG", spec: undefined })).toBe("PETG");
    expect(orderMaterial({ spec: { material: "PLA Matte" } as never })).toBe("PLA");
    expect(orderMaterial({ spec: undefined })).toBeNull();
  });

  it("a PETG order is quoted at the PETG price per gram", () => {
    process.env.KESUNI_PRICE_PER_GRAM_IDR_PETG = "1800";
    const o = createOrder({ product: "Hook", quantity: 2, deadline: "2099-12-31", designVersion: "v1", mandateMicro: 50_000_000, label: "real", material: "PETG" });
    const r = quoteByWeight(o.ok ? o.order.id : "", { gramsPerUnit: 16, source: "Bambu Studio", by: "human" });
    expect(r.ok && r.gramPricing).toMatchObject({ pricePerGramIdr: 1800, unitPriceIdr: 29_000, totalIdr: 58_000 });
  });
});
