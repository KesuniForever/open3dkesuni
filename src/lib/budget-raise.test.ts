import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import * as store from "./store";
import { addQuote, approveByOwner, chooseQuote, createOrder } from "./actions";
import { quoteByWeight } from "./agreement";
import { checkPlan } from "./policy";
import { customerView } from "./customer";
import { idrBudget, budgetRaiseText } from "./budget";
import { NOT_OVER, PRICE_CHANGED, RAISE_CLOSED, RAISE_TOOL, customerRaiseBudget, offeredQuote, raiseWakeText } from "./budget-raise";
import { setLlmGateway, type LlmRequest } from "./agent/chief";
import { callTool } from "./agent/tools";
import { describeEntry } from "./ops";
import { CUSTOMER_UPLOAD_BY } from "./file-rules";
import { makeT } from "../i18n/core";
import { ID } from "../i18n/id";
import { POST as act } from "@/app/api/c/[token]/route";
import type { Order, Quote } from "./types";

// ORD-005 as it was stuck on 17 Oct 2026: 5 lamps, a budget of Rp1.500.000, 270 g per lamp gives the official price by
// weight Rp2.025.000, but Kesuni's real price is Rp500.000 per lamp: Rp2.500.000 (manual quotes, one approved by the owner).
const RATE = 16_500;
const LAMP = 151_515_152; // Rp2.500.000 at Rp16.500
let sent: LlmRequest[] = [];

beforeEach(() => {
  process.env.IDR_PER_USDC = String(RATE);
  store.resetDb();
  sent = [];
  // A fake Claude that only answers: the wake-ups are counted, nothing else happens.
  setLlmGateway(async (req) => {
    sent.push(JSON.parse(JSON.stringify(req)));
    return { stop_reason: "end_turn", content: [{ type: "text", text: "Decision: none. Waiting on: test." }] };
  });
});
afterEach(() => setLlmGateway(undefined));
afterAll(() => { delete process.env.IDR_PER_USDC; });

function lampOrder(budgetIdr = 1_500_000): Order {
  const r = createOrder({
    product: "Lampu meja", quantity: 5, deadline: "2099-12-31", designVersion: "v1", label: "real", customerName: "Aini Putri",
    ...idrBudget(budgetIdr, RATE),
  });
  if (!r.ok) throw new Error(r.error);
  return r.order;
}

/** The order with its three quotes: Q-6 (manual, owner-approved), the price by weight, Q-8 (manual, not approved). */
function stuck(opts: { approve?: boolean; budgetIdr?: number } = {}) {
  const o = lampOrder(opts.budgetIdr);
  const manual = addQuote(o.id, { vendorId: "own", priceMicro: LAMP, etaHours: 72 });
  const weight = quoteByWeight(o.id, { gramsPerUnit: 270, source: "Bambu Studio, operator", by: "human" });
  const manual2 = addQuote(o.id, { vendorId: "own", priceMicro: LAMP, etaHours: 72 });
  if (!manual.ok || !weight.ok || !manual2.ok) throw new Error("quotes");
  if (opts.approve !== false) {
    const a = approveByOwner(o.id, { quoteId: manual.quote.id, by: "Felia", note: "Pilot order first customer" });
    if (!a.ok) throw new Error(a.error);
  }
  return { id: o.id, token: o.customerToken!, approved: manual.quote, weight: weight.quote, other: manual2.quote };
}

const order = (id: string) => store.getOrder(id)!;
const quotes = (id: string) => store.listQuotes(id);
const settle = () => new Promise((r) => setTimeout(r, 20));

describe("the price offered to the customer (offeredQuote)", () => {
  it("ORD-005: the owner-approved Rp2.500.000 wins over the price by weight, Rp500.000 per lamp", () => {
    const s = stuck();
    expect(order(s.id).gramPricing).toMatchObject({ totalIdr: 2_025_000, unitPriceIdr: 405_000 });
    const offer = offeredQuote(order(s.id), quotes(s.id));
    expect(offer).toMatchObject({ source: "owner-approved", priceIdr: 2_500_000, unitIdr: 500_000 });
    expect(offer!.quote.id).toBe(s.approved.id);
  });

  it("without the owner's approval: the price by weight; a manual quote nobody approved is never offered", () => {
    const s = stuck({ approve: false });
    expect(offeredQuote(order(s.id), quotes(s.id))).toMatchObject({ source: "by-weight", priceIdr: 2_025_000, unitIdr: 405_000, quote: { id: s.weight.id } });
    // No price by weight either: nothing to offer, whatever manual quotes exist.
    const noWeight: Order = { ...order(s.id), gramPricing: undefined };
    expect(offeredQuote(noWeight, quotes(s.id))).toBeNull();
  });

  it("an approval naming a quote that is not there (or at another price) falls back to the price by weight", () => {
    const s = stuck();
    const o = order(s.id);
    const gone = { ...o, ownerApproval: { ...o.ownerApproval!, quoteId: "Q-404" } };
    expect(offeredQuote(gone, quotes(s.id))).toMatchObject({ source: "by-weight", priceIdr: 2_025_000 });
    const repriced = { ...o, ownerApproval: { ...o.ownerApproval!, priceMicro: LAMP - 1 } };
    expect(offeredQuote(repriced, quotes(s.id))?.source).toBe("by-weight");
    // Another order's quote with the approved id is not this order's.
    const foreign: Quote[] = quotes(s.id).map((q) => (q.id === s.approved.id ? { ...q, orderId: "ORD-999" } : q));
    expect(offeredQuote(o, foreign)?.source).toBe("by-weight");
  });

  it("nothing when Kesuni's price fits the budget; a manual quote's rupiah uses the order's rate", () => {
    const s = stuck({ budgetIdr: 2_500_000 });
    expect(order(s.id).mandateMicro).toBe(LAMP);
    expect(offeredQuote(order(s.id), quotes(s.id))).toBeNull(); // equal to the mandate is within budget
    const o: Order = { ...order(s.id), mandateMicro: 1, budgetIdr: 1_000_000, rateIdrPerUsdc: 16_000 };
    expect(offeredQuote(o, quotes(s.id))?.priceIdr).toBe(2_424_242); // 151.515152 USDC at the order's Rp16.000
    expect(offeredQuote({ ...o, rateIdrPerUsdc: undefined }, quotes(s.id), 16_500)?.priceIdr).toBe(2_500_000);
  });

  it("nothing when the price is above the mandate but not above the budget in rupiah (the rate moved)", () => {
    // Budget Rp1.500.000 at Rp16.500 = 90.909091 USDC. At Rp16.000 the price by weight Rp1.480.000 is 92.5 USDC: above
    // the mandate, yet fewer rupiah than the budget. No "raise" to Rp1.480.000.
    const s = stuck({ approve: false });
    const o = order(s.id);
    const moved: Order = { ...o, gramPricing: { ...o.gramPricing!, totalIdr: 1_480_000 } };
    const at92: Quote[] = quotes(s.id).map((q) => (q.id === s.weight.id ? { ...q, priceMicro: 92_500_000 } : q));
    expect(offeredQuote(moved, at92, 16_000)).toBeNull();
    // A USDC price a few micro above the mandate is the same Rp1.500.000: not a raise either.
    const a = stuck();
    const ao = order(a.id);
    const few = ao.mandateMicro + 5;
    const approvedFew: Order = { ...ao, ownerApproval: { ...ao.ownerApproval!, priceMicro: few } };
    const fewQuotes: Quote[] = quotes(a.id).map((q) => (q.id === a.approved.id ? { ...q, priceMicro: few } : q));
    expect(offeredQuote(approvedFew, fewQuotes)).toBeNull();
    // Offered when the rupiah is above the budget too, with the budget the page shows.
    expect(offeredQuote({ ...moved, gramPricing: { ...moved.gramPricing!, totalIdr: 1_600_000 } }, at92, 16_000))
      .toMatchObject({ priceIdr: 1_600_000, budgetIdr: 1_500_000 });
  });
});

describe("what the customer's page shows (customerView.overBudget)", () => {
  it("Kesuni's price and their own budget only: no cost, grams, source, owner or note", () => {
    const s = stuck();
    const v = customerView(order(s.id), s.token);
    expect(v.overBudget).toEqual({
      quoteId: s.approved.id, priceIdr: 2_500_000, unitIdr: 500_000, quantity: 5, priceUsdc: "151.515152", budgetIdr: 1_500_000,
    });
    expect(v.budgetRaised).toBeNull();
    expect(v.ownerApprovalAboveIdr).toBe(1_000_000);
    expect(JSON.stringify(v)).not.toMatch(/Felia|Pilot order|owner-approved|Bambu Studio|costIdr|margin/);
  });

  it("hidden within budget, once the order moved on, and once an agreement, escrow or payment intent exists", () => {
    const within = stuck({ budgetIdr: 2_600_000 });
    expect(customerView(order(within.id), within.token).overBudget).toBeNull();
    const s = stuck();
    const o = order(s.id);
    const view = (x: Order) => customerView(x, s.token).overBudget;
    expect(view(o)).not.toBeNull();
    expect(view({ ...o, status: "PLAN_CHOSEN" })).toBeNull();
    expect(view({ ...o, agreement: { version: 1, hash: "h", quoteId: s.approved.id, priceMicro: LAMP, by: "Aini", at: "" } })).toBeNull();
    store.insertIntent({
      id: "PI-1", orderId: s.id, recipient: "0x1", amountMicro: 1, token: "USDC", network: "ARC-TESTNET", idempotencyKey: "k",
      state: "PAYMENT_INTENT_CREATED", label: "local", createdAt: "",
    });
    expect(view(o)).toBeNull();
    const t = stuck();
    store.saveEscrow({
      orderId: t.id, amountMicro: LAMP, escrowWalletId: "w", escrowAddress: "0x2", customerWalletId: "c", customerAddress: "0x3",
      state: "AWAITING_DEPOSIT", txs: [], network: "ARC-TESTNET", label: "testnet", createdAt: "",
    });
    expect(customerView(order(t.id), t.token).overBudget).toBeNull();
  });

  it("the customer's design card drops its estimate by weight while Kesuni's own price is offered or was agreed to", () => {
    const s = stuck();
    store.saveAttachment({
      id: "A-1", orderId: s.id, kind: "design", filename: "lamp.stl", size: 1000, mime: "model/stl", uploadedBy: CUSTOMER_UPLOAD_BY, at: "", storageKey: "k",
    });
    expect(customerView(order(s.id), s.token).design?.estimate).toBeNull();
    expect(customerView({ ...order(s.id), ownerApproval: undefined, gramPricing: undefined }, s.token).design?.estimate).toMatchObject({ totalIdr: 2_025_000 });
    // Raised: still no second price while Kesuni prepares the agreement.
    customerRaiseBudget(s.id, { quoteId: s.approved.id, by: "Aini" });
    expect(customerView(order(s.id), s.token)).toMatchObject({ overBudget: null, budgetRaised: { toIdr: 2_500_000 }, design: { estimate: null } });
  });
});

describe("\"Raise my budget\" (customerRaiseBudget)", () => {
  it("sets the mandate to exactly the quote's price and the rupiah budget to Kesuni's price; then the policy passes", () => {
    const s = stuck();
    expect(checkPlan(order(s.id), s.approved, store.getVendor("own")).reasons).toEqual([expect.stringMatching(/exceeds mandate/)]);
    const r = customerRaiseBudget(s.id, { quoteId: s.approved.id, by: "  Aini Putri  " });
    expect(r).toMatchObject({ ok: true, repeated: false });
    const o = order(s.id);
    expect(o).toMatchObject({ mandateMicro: LAMP, budgetIdr: 2_500_000, rateIdrPerUsdc: RATE });
    expect(o.budgetRaises).toEqual([{
      fromIdr: 1_500_000, toIdr: 2_500_000, fromMicro: 90_909_091, toMicro: LAMP, quoteId: s.approved.id, source: "owner-approved",
      by: "Aini Putri", at: expect.any(String),
    }]);
    // The policy is unchanged: the approved quote now fits the mandate and the owner's approval covers it.
    expect(checkPlan(o, s.approved, store.getVendor("own"))).toEqual({ ok: true, reasons: [] });
    expect(checkPlan(o, s.other, store.getVendor("own")).reasons).toEqual([expect.stringMatching(/above Rp1\.000\.000: owner approval needed/)]);
    expect(chooseQuote(s.id, s.approved.id, "agent", "the customer raised their budget").ok).toBe(true);
    // The page: the agreement and price come next, at Kesuni's price.
    const v = customerView(order(s.id), s.token);
    expect(v).toMatchObject({ overBudget: null, budgetRaised: null, price: { idr: 2_500_000, usdc: "151.515152" } });
    // Logged like the customer's other steps.
    const log = store.listLog(s.id).filter((e) => e.tool === RAISE_TOOL);
    expect(log).toEqual([expect.objectContaining({
      actor: "human", ok: true, output: { by: "Aini Putri" },
      input: { quoteId: s.approved.id, source: "owner-approved", fromIdr: 1_500_000, toIdr: 2_500_000, fromMicro: 90_909_091, toMicro: LAMP },
    })]);
  });

  it("the price by weight when the owner approved nothing; the owner's approval is still needed above the limit", () => {
    const s = stuck({ approve: false });
    expect(customerRaiseBudget(s.id, { quoteId: s.weight.id, by: "Aini" }).ok).toBe(true);
    const o = order(s.id);
    expect(o).toMatchObject({ mandateMicro: s.weight.priceMicro, budgetIdr: 2_025_000 });
    expect(o.budgetRaises?.[0]).toMatchObject({ source: "by-weight", toIdr: 2_025_000 });
    expect(checkPlan(o, s.weight, store.getVendor("own")).reasons).toEqual([expect.stringMatching(/Rp2\.025\.000 is above Rp1\.000\.000: owner approval needed/)]);
    // Until a plan is chosen, the page says the budget was raised.
    expect(customerView(o, s.token)).toMatchObject({ overBudget: null, budgetRaised: { toIdr: 2_025_000 } });
  });

  it("refuses a stale or other quote, a missing name, a budget that already fits and an order that moved on", () => {
    const s = stuck();
    expect(customerRaiseBudget(s.id, { quoteId: s.weight.id, by: "Aini" })).toMatchObject({ ok: false, status: 409, error: PRICE_CHANGED });
    expect(customerRaiseBudget(s.id, { quoteId: s.other.id, by: "Aini" })).toMatchObject({ ok: false, status: 409, error: PRICE_CHANGED });
    expect(customerRaiseBudget(s.id, { quoteId: s.approved.id, by: "   " })).toMatchObject({ ok: false, status: 400, error: "Name is required" });
    expect(customerRaiseBudget("ORD-404", { quoteId: s.approved.id, by: "Aini" })).toMatchObject({ ok: false, status: 404 });
    const within = stuck({ budgetIdr: 2_500_000 });
    expect(customerRaiseBudget(within.id, { quoteId: within.approved.id, by: "Aini" })).toMatchObject({ ok: false, status: 409, error: NOT_OVER });
    store.saveOrder({ ...order(s.id), status: "PLAN_CHOSEN" });
    expect(customerRaiseBudget(s.id, { quoteId: s.approved.id, by: "Aini" })).toMatchObject({ ok: false, status: 409, error: RAISE_CLOSED });
    store.saveOrder({ ...order(s.id), status: "CREATED", agreement: { version: 1, hash: "h", quoteId: "Q", priceMicro: 1, by: "A", at: "" } });
    expect(customerRaiseBudget(s.id, { quoteId: s.approved.id, by: "Aini" })).toMatchObject({ ok: false, status: 409, error: RAISE_CLOSED });
    // Above the mandate but not above the rupiah budget (the rate moved): nothing to raise to.
    const moved = stuck();
    store.saveOrder({ ...order(moved.id), budgetIdr: 2_500_000 });
    expect(customerView(order(moved.id), moved.token).overBudget).toBeNull();
    expect(customerRaiseBudget(moved.id, { quoteId: moved.approved.id, by: "Aini" })).toMatchObject({ ok: false, status: 409, error: NOT_OVER });
    expect(order(moved.id)).toMatchObject({ mandateMicro: 90_909_091, budgetIdr: 2_500_000 });
    expect(order(s.id).mandateMicro).toBe(90_909_091);
    expect(order(s.id).budgetRaises).toBeUndefined();
    expect(store.listLog(s.id).some((e) => e.tool === RAISE_TOOL)).toBe(false);
  });

  it("a double click raises once and wakes the Chief once, without the customer's name", async () => {
    const s = stuck();
    const first = customerRaiseBudget(s.id, { quoteId: s.approved.id, by: "Aini Putri" });
    const second = customerRaiseBudget(s.id, { quoteId: s.approved.id, by: "Aini Putri" });
    expect(first).toMatchObject({ ok: true, repeated: false });
    expect(second).toMatchObject({ ok: true, repeated: true });
    await settle();
    expect(order(s.id).budgetRaises).toHaveLength(1);
    expect(store.listLog(s.id).filter((e) => e.tool === RAISE_TOOL)).toHaveLength(1);
    expect(sent).toHaveLength(1);
    const why = String(sent[0].messages[0].content);
    expect(why).toContain(`The customer raised their budget from Rp1.500.000 to Rp2.500.000 to match quote ${s.approved.id} (owner-approved)`);
    expect(why).toContain("Choose the plan with that quote; owner approval rules still apply.");
    expect(JSON.stringify(sent)).not.toMatch(/Aini|Putri/);
    // The Chief reads the raised budget and its history (no name) in get_order.
    const seen = callTool("get_order", { orderId: s.id }).data as Record<string, unknown>;
    expect(seen).toMatchObject({ mandateMicro: LAMP, budgetIdr: 2_500_000, budgetIdrApprox: 2_500_000 });
    expect(seen.budgetRaises).toEqual([{
      fromIdr: 1_500_000, toIdr: 2_500_000, fromMicro: 90_909_091, toMicro: LAMP, quoteId: s.approved.id, source: "owner-approved", at: expect.any(String),
    }]);
    expect(JSON.stringify(seen)).not.toMatch(/Aini|Putri/);
  });

  it("an order with a USDC budget only gets the rupiah and the rate it was worked out with", () => {
    const r = createOrder({ product: "Lampu", quantity: 5, deadline: "2099-12-31", designVersion: "v1", label: "real", mandateMicro: 30_000_000 });
    if (!r.ok) throw new Error(r.error);
    const q = addQuote(r.order.id, { vendorId: "own", priceMicro: LAMP, etaHours: 72 });
    if (!q.ok) throw new Error(q.error);
    approveByOwner(r.order.id, { quoteId: q.quote.id, by: "Felia", note: "ok" });
    expect(customerView(order(r.order.id), r.order.customerToken!).overBudget).toMatchObject({ budgetIdr: 495_000, priceIdr: 2_500_000 });
    const raised = customerRaiseBudget(r.order.id, { quoteId: q.quote.id, by: "Budi" });
    expect(raised.ok && raised.raise).toMatchObject({ fromIdr: null, fromMicro: 30_000_000, toIdr: 2_500_000 });
    expect(order(r.order.id)).toMatchObject({ budgetIdr: 2_500_000, rateIdrPerUsdc: RATE, mandateMicro: LAMP });
    expect(raised.ok && raiseWakeText(raised.raise)).toMatch(/^The customer raised their budget from 30 USDC to Rp2\.500\.000/);
  });
});

describe("POST /api/c/<token> { action: \"raise-budget\" }", () => {
  const post = (token: string, body: unknown, headers: Record<string, string> = {}) => act(new Request("http://x", {
    method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "198.51.100.7", ...headers }, body: JSON.stringify(body),
  }), { params: Promise.resolve({ token }) });

  it("raises to Kesuni's price whatever amount the body carries; a repeat answers ok", async () => {
    const s = stuck();
    const res = await post(s.token, {
      action: "raise-budget", quoteId: s.approved.id, by: "Aini", priceMicro: 1, mandateMicro: 999_999_999_999, budgetIdr: 1, amount: "1",
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, budgetIdr: 2_500_000, repeated: false });
    expect(order(s.id)).toMatchObject({ mandateMicro: LAMP, budgetIdr: 2_500_000 });
    const again = await post(s.token, { action: "raise-budget", quoteId: s.approved.id, by: "Aini" });
    expect(await again.json()).toMatchObject({ ok: true, repeated: true });
    await settle();
    expect(sent).toHaveLength(1);
  });

  it("answers 409 for a stale price, 400 without a name, 403 from another site, 429 after too many tries", async () => {
    const s = stuck();
    const stale = await post(s.token, { action: "raise-budget", quoteId: s.weight.id, by: "Aini" }, { "cf-connecting-ip": "198.51.100.8" });
    expect(stale.status).toBe(409);
    expect((await stale.json()).error).toBe(PRICE_CHANGED);
    expect((await post(s.token, { action: "raise-budget", quoteId: s.approved.id }, { "cf-connecting-ip": "198.51.100.8" })).status).toBe(400);
    expect((await post(s.token, { action: "raise-budget", quoteId: s.approved.id, by: "A" }, { "cf-connecting-ip": "198.51.100.8", "sec-fetch-site": "cross-site" })).status).toBe(403);
    expect((await post("x".repeat(24), { action: "raise-budget", quoteId: s.approved.id, by: "A" })).status).toBe(404);
    let last = 0;
    for (let i = 0; i < 31; i++) last = (await post(s.token, { action: "raise-budget", quoteId: "Q-x", by: "A" }, { "cf-connecting-ip": "198.51.100.9" })).status;
    expect(last).toBe(429);
    expect(order(s.id).mandateMicro).toBe(90_909_091);
  });
});

describe("the raise on the operator's pages", () => {
  const raise = {
    fromIdr: 1_500_000, toIdr: 2_500_000, fromMicro: 90_909_091, toMicro: LAMP, quoteId: "Q-6-x", source: "owner-approved" as const,
    by: "Aini", at: "2026-10-17T03:00:00.000Z",
  };
  const id = makeT("id", ID);
  const en = makeT("en", {});

  it("the Budget mandate row names the old budget, the customer and the day", () => {
    expect(budgetRaiseText({}, en)).toBeNull();
    expect(budgetRaiseText({ budgetRaises: [raise] }, en)).toBe("raised by the customer from Rp1.500.000 (Aini, 17 Oct)");
    expect(budgetRaiseText({ budgetRaises: [raise] }, id, "id")).toBe("dinaikkan oleh pelanggan dari Rp1.500.000 (Aini, 17 Okt)");
    expect(budgetRaiseText({ budgetRaises: [{ ...raise, fromIdr: null, fromMicro: 30_000_000 }] }, en, "en", true)).toBe("raised by the customer from 30 test USDC (Aini, 17 Oct)");
  });

  it("the decision log row, without the customer's name", () => {
    const row = {
      id: 1, orderId: "ORD-005", actor: "human" as const, tool: RAISE_TOOL, ok: true, at: raise.at, output: { by: "Aini" },
      input: { quoteId: "Q-6-x", source: "owner-approved", fromIdr: 1_500_000, toIdr: 2_500_000, fromMicro: 90_909_091, toMicro: LAMP },
    };
    expect(describeEntry(row)).toEqual({ title: "Customer raised the budget", line: "Rp1.500.000 → Rp2.500.000 · Q-6-x" });
    expect(describeEntry(row, id).title).toBe("Pelanggan menaikkan anggaran");
    expect(JSON.stringify(describeEntry(row))).not.toContain("Aini");
  });
});
