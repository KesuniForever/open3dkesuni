import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as store from "./store";
import { DEMO_SCENARIOS, demoFacts, demoOrders, fitGrams, isDemoOrder, runScenario, type ScenarioId } from "./demo";
import { ownerRuleReasons } from "./owner-rules";
import type { Order } from "./types";
import { makeT } from "../i18n/core";
import { ID } from "../i18n/id";

const ENV = ["KESUNI_MIN_ORDER_IDR", "KESUNI_OWNER_APPROVAL_ABOVE_IDR", "KESUNI_PRICE_PER_GRAM_IDR", "KESUNI_GRAMS_PER_HOUR", "KESUNI_PRINTER_COUNT"];

beforeEach(() => {
  for (const k of ENV) delete process.env[k];
  process.env.IDR_PER_USDC = "16500";
  store.resetDb();
});
afterEach(() => {
  for (const k of ENV) delete process.env[k];
  delete process.env.IDR_PER_USDC;
});

/** Run a scenario and return its one new order (fails the test if it did not make exactly one). */
function run(id: ScenarioId): Order {
  const before = store.listOrders().map((o) => o.id);
  const r = runScenario(id);
  expect(r, JSON.stringify(r)).toMatchObject({ ok: true });
  const added = store.listOrders().filter((o) => !before.includes(o.id));
  expect(added).toHaveLength(1);
  expect(r.ok && r.orderId).toBe(added[0].id);
  return added[0];
}
const quotes = (o: Order) => store.listQuotes(o.id);
const openTasks = (o: Order) => store.listTasks(o.id).filter((t) => t.status === "open");
const jakartaToday = () => new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);

describe("demo scenarios: one simulated order each, through the real engine", () => {
  it.each(DEMO_SCENARIOS.map((s) => s.id))("%s: one simulated demo order, no escrow, no payment, other orders untouched", (id) => {
    const seed = JSON.stringify(store.getOrder("ORD-001"));
    const o = run(id);
    expect(o.label).toBe("simulated");
    expect(o.customerName).toBe(DEMO_SCENARIOS.find((s) => s.id === id)!.customerName);
    expect(isDemoOrder(o)).toBe(true);
    expect(store.getEscrow(o.id)).toBeUndefined();
    expect(store.listIntents(o.id)).toEqual([]);
    expect(quotes(o)).toHaveLength(1);
    expect(quotes(o)[0]).toMatchObject({ vendorId: "own", source: "own" });
    expect(o.gramPricing?.source).toMatch(/sample weight/);
    expect(JSON.stringify(store.getOrder("ORD-001"))).toBe(seed);
    expect(store.listPrinters()).toEqual([]);
    expect(store.listLog(o.id).some((l) => l.tool === "demo_scenario" && l.actor === "human")).toBe(true);
    // Never logged as the agent: the Chief did not run.
    expect(store.listLog(o.id).filter((l) => l.actor === "agent")).toEqual([]);
  });

  it("smooth order: priced by weight inside the owner's rules, plan chosen", () => {
    const o = run("smooth");
    expect(o.status).toBe("PLAN_CHOSEN");
    expect(o.chosenQuoteId).toBe(quotes(o)[0].id);
    expect(o.gramPricing).toMatchObject({ gramsPerUnit: 12, quantity: 10, unitPriceIdr: 18_000, totalIdr: 180_000, by: "human" });
    expect(ownerRuleReasons(o, quotes(o)[0]).reasons).toEqual([]);
    expect(o.spec?.finishing).toBe("Standard");
    expect(store.listDecisions(o.id)).toHaveLength(1);
    expect(openTasks(o)).toEqual([]);
  });

  it("above the owner's limit: plan refused, the owner can approve, a task asks the owner", () => {
    const o = run("above-limit");
    expect(o.status).toBe("CREATED");
    expect(o.gramPricing?.totalIdr).toBe(1_200_000);
    const check = ownerRuleReasons(o, quotes(o)[0]);
    expect(check.reasons.join()).toMatch(/above Rp1\.000\.000: owner approval needed/);
    expect(check.ownerCanApprove).toBe(true);
    expect(o.ownerApproval).toBeUndefined();
    expect(openTasks(o)).toHaveLength(1);
    expect(openTasks(o)[0]).toMatchObject({ kind: "needs_info", createdBy: "human" });
    expect(openTasks(o)[0].text).toMatch(/^Demo: .*owner approval needed.*Owner's rules/);
  });

  it("below the minimum: refused, then an owner exception for that quote, then the plan", () => {
    const o = run("below-minimum");
    expect(o.status).toBe("PLAN_CHOSEN");
    const q = quotes(o)[0];
    expect(o.gramPricing?.totalIdr).toBe(12_000);
    expect(o.ownerApproval).toMatchObject({ quoteId: q.id, priceMicro: q.priceMicro, by: "Owner (demo)" });
    // Without the exception the rule would refuse it.
    expect(ownerRuleReasons({ ...o, ownerApproval: undefined }, q).reasons.join()).toMatch(/under the owner's minimum Rp100\.000/);
    expect(ownerRuleReasons(o, q).reasons).toEqual([]);
    expect(store.listLog(o.id).some((l) => l.tool === "owner_approval")).toBe(true);
  });

  it("late deadline: due today, the plan cannot finish in time and the owner cannot lift it", () => {
    const o = run("late-deadline");
    expect(o.status).toBe("CREATED");
    expect(o.deadline).toBe(jakartaToday());
    const check = ownerRuleReasons(o, quotes(o)[0]);
    expect(check.reasons.join()).toMatch(/finishes after the deadline .* \(SLA\)/);
    expect(check.reasons.join()).not.toMatch(/owner approval needed/);
    expect(check.ownerCanApprove).toBe(false);
    expect(openTasks(o)).toHaveLength(1);
    expect(openTasks(o)[0].text).toMatch(/later date/);
  });

  it("customer rejects: QC recorded, rejected, and no money ever moved", () => {
    const o = run("customer-rejects");
    expect(o.status).toBe("REJECTED");
    expect(store.getAcceptance(o.id)).toMatchObject({ accepted: false, by: "Demo customer" });
    expect(store.listEvidence(o.id).map((e) => [e.kind, e.label])).toEqual([["log", "simulated"], ["qc", "simulated"]]);
    expect(store.listEscrows()).toEqual([]);
  });

  it("printer goes offline: an order in production, no printer data invented", () => {
    const o = run("printer-offline");
    expect(o.status).toBe("IN_PRODUCTION");
    expect(store.listPrinters()).toEqual([]);
    expect(openTasks(o)).toEqual([]);
  });

  it("an unknown scenario makes nothing", () => {
    const n = store.listOrders().length;
    expect(runScenario("pay-twice")).toMatchObject({ ok: false, status: 404 });
    expect(store.listOrders()).toHaveLength(n);
  });

  it("every scenario again makes a new order (no reuse)", () => {
    const a = run("smooth");
    const b = run("smooth");
    expect(a.id).not.toBe(b.id);
  });
});

describe("owner's rules from .env.local", () => {
  it("keeps the sample weight when it fits, moves it when the limits changed", () => {
    expect(fitGrams(16, 50, "above")).toBe(16);
    process.env.KESUNI_OWNER_APPROVAL_ABOVE_IDR = "3000000";
    const g = fitGrams(16, 50, "above")!;
    expect(g * 50 * 1500).toBeGreaterThan(3_000_000);
    const o = run("above-limit");
    expect(ownerRuleReasons(o, quotes(o)[0]).reasons.join()).toMatch(/above Rp3\.000\.000/);
  });

  it("no minimum set: the below-minimum scenario says so and makes nothing", () => {
    process.env.KESUNI_MIN_ORDER_IDR = "0";
    const n = store.listOrders().length;
    expect(runScenario("below-minimum")).toMatchObject({ ok: false, status: 409 });
    expect(store.listOrders()).toHaveLength(n);
  });
});

describe("demo center lists", () => {
  it("lists demo orders newest first, never the seed order or a real order", () => {
    store.saveOrder({ ...store.getOrder("ORD-001")!, id: "ORD-900", jobId: "JOB-900", label: "real", customerName: "Demo: smooth order" });
    const a = run("smooth");
    const b = run("customer-rejects");
    const rows = demoOrders();
    expect(rows.map((r) => r.orderId)).toEqual([b.id, a.id]);
    expect(rows[0]).toMatchObject({ scenario: "Customer rejects", status: "REJECTED", now: "Rejected, no money moved", tone: "bad" });
    expect(rows[1]).toMatchObject({ scenario: "Smooth order", now: "Plan chosen, not paid" });
  });

  it("says where each demo order stands", () => {
    run("above-limit");
    run("late-deadline");
    run("printer-offline");
    const byScenario = Object.fromEntries(demoOrders().map((r) => [r.scenario, r.now]));
    expect(byScenario).toEqual({
      "Above the owner's limit": "Waiting for the owner",
      "Late deadline": "No plan fits the rules",
      "Printer goes offline": "In production",
    });
  });

  it("facts come from the configured rules and the live printers", () => {
    store.savePrinter({ id: "a1", name: "A1 #1", lastSeen: new Date().toISOString() });
    store.savePrinter({ id: "a1-2", name: "A1 #2", lastSeen: new Date(Date.now() - 10 * 60_000).toISOString() });
    const f = demoFacts();
    expect(f["above-limit"]).toBe("Owner approval above Rp1.000.000");
    expect(f["below-minimum"]).toBe("Owner minimum Rp100.000");
    expect(f.smooth).toBe("Rp1.500 per gram, own studio");
    expect(f["printer-offline"]).toBe("Live: 1 of 2 printers online");
  });

  it("says the facts and states in Indonesian with the ID switch, the order data stays as made", () => {
    const id = makeT("id", ID);
    store.savePrinter({ id: "a1", name: "A1 #1", lastSeen: new Date().toISOString() });
    expect(demoFacts(id)["printer-offline"]).toBe("Langsung: 1 dari 1 printer online");
    expect(demoFacts(id)["below-minimum"]).toBe("Minimum pemilik Rp100.000");
    const o = run("customer-rejects");
    expect(demoOrders(undefined, id)[0]).toMatchObject({ scenario: "Customer rejects", product: o.product, now: "Ditolak, tidak ada uang berpindah" });
  });
});
