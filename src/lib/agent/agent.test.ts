import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as store from "../store";
import { resetDb } from "../store";
import { planOrder } from "./planner";
import { callTool, LLM_TOOLS, redactNote, TOOLS } from "./tools";
import { chooseQuote, createOrder } from "../actions";
import { setSlicerGrams } from "../agreement";
import { completeTask, ingestReport, linkPrinter } from "../printer/actions";
import type { PrinterSnapshot } from "../printer/bambu";

/** A person at Kesuni enters grams per unit from the slicer: the only grams the agent may price with. */
const slicer = (gramsPerUnit: number, orderId = "ORD-001") => {
  const r = setSlicerGrams(orderId, { gramsPerUnit, source: "Bambu Studio, plate 1", by: "operator" });
  if (!r.ok) throw new Error(r.error);
};

beforeEach(resetDb);

describe("planner", () => {
  it("refuses the 35 USDC partner and chooses the 30 USDC own quote, with a log", () => {
    const r = planOrder("ORD-001");
    expect(r.outcome).toBe("chosen");
    expect(r.quoteId).toBe("Q-own");
    expect(r.message).toMatch(/Q-partner.*exceeds mandate/);
    expect(store.getOrder("ORD-001")!.status).toBe("PLAN_CHOSEN");
    const log = store.listLog("ORD-001");
    const tools = log.map((e) => e.tool);
    expect(tools).toContain("check_vendor_policy");
    expect(tools.at(-1)).toBe("choose_plan");
    expect(log.some((e) => e.tool === "check_vendor_policy" && !e.ok)).toBe(true);
  });

  it("escalates to a human when nothing is allowed", () => {
    store.deleteQuote("Q-own");
    const r = planOrder("ORD-001");
    expect(r.outcome).toBe("escalated");
    expect(store.getOrder("ORD-001")!.status).toBe("CREATED");
    expect(store.listLog("ORD-001").at(-1)!.tool).toBe("request_human_decision");
  });

  it("does not re-plan an order that already has a plan", () => {
    planOrder("ORD-001");
    expect(planOrder("ORD-001").outcome).toBe("error");
  });
});

describe("agent tools use the same policy as the human API", () => {
  it("choose_plan cannot pick the over-budget quote", () => {
    const r = callTool("choose_plan", { orderId: "ORD-001", quoteId: "Q-partner", reason: "faster" });
    expect(r.ok).toBe(false);
    expect(store.getOrder("ORD-001")!.status).toBe("CREATED");
  });

  it("propose_payment is blocked before acceptance", () => {
    callTool("choose_plan", { orderId: "ORD-001", quoteId: "Q-own", reason: "ok" });
    const r = callTool("propose_payment", {
      orderId: "ORD-001", recipient: "0x0000000000000000000000000000000000000001",
      amountMicro: 30_000_000, idempotencyKey: "k",
    });
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r.data)).toMatch(/not been accepted/);
  });

  it("unknown tools fail safely and are logged", () => {
    expect(callTool("send_money_now", {}).ok).toBe(false);
    expect(store.listLog("").at(-1)!.tool).toBe("send_money_now");
  });

  it("exposes JSON Schemas for every tool, and the LLM never gets the payment tool", () => {
    expect(TOOLS.map((t) => t.name).sort()).toEqual([
      "check_vendor_policy", "choose_plan", "choose_printer", "create_operator_task", "estimate_cost", "get_available_budget",
      "get_order", "get_production_status", "get_quotes", "message_customer", "price_by_weight", "price_with_calculator",
      "propose_payment", "request_human_decision",
    ]);
    for (const t of TOOLS) expect(t.inputSchema.type).toBe("object");
    const llm = LLM_TOOLS.map((t) => t.name);
    expect(llm).not.toContain("propose_payment");
    // Prices are by weight; the long calculator is only a check for the LLM.
    expect(llm).toContain("price_by_weight");
    expect(llm).toContain("estimate_cost");
    expect(llm).toContain("message_customer");
    expect(llm).not.toContain("price_with_calculator");
  });
});

describe("price_by_weight (agent tool)", () => {
  // ORD-001: 1 unit, budget 32 USDC. 1 USDC = Rp16.000 here, so the budget is about Rp512.000.
  beforeEach(() => { process.env.IDR_PER_USDC = "16000"; });
  afterEach(() => { delete process.env.IDR_PER_USDC; delete process.env.KESUNI_COST_PER_GRAM_IDR; });

  it("prices from grams per unit and logs it once", () => {
    slicer(300);
    const r = callTool("price_by_weight", { orderId: "ORD-001", gramsPerUnit: 300, source: "Bambu Studio, from the operator" });
    expect(r.ok).toBe(true);
    expect(r.data).toMatchObject({ unitPriceIdr: 450_000, totalIdr: 450_000, marginPct: 50 });
    expect(store.getOrder("ORD-001")!.gramPricing).toMatchObject({ by: "agent", source: "Bambu Studio, from the operator" });
    expect(store.listLog("ORD-001").filter((e) => e.tool === "price_by_weight")).toHaveLength(1);
  });

  it("refuses without a source: the agent must not guess grams", () => {
    const r = callTool("price_by_weight", { orderId: "ORD-001", gramsPerUnit: 300, source: "" });
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r.data)).toMatch(/where the grams come from/);
    expect(store.getOrder("ORD-001")!.gramPricing).toBeUndefined();
  });

  it("refuses a total over the customer's budget", () => {
    slicer(400);
    const r = callTool("price_by_weight", { orderId: "ORD-001", gramsPerUnit: 400, source: "slicer" }); // Rp600.000
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r.data)).toMatch(/over the customer's budget/);
  });

  it("refuses a margin under the owner's minimum", () => {
    process.env.KESUNI_COST_PER_GRAM_IDR = "1400"; // margin 6,7% < 15%
    slicer(300);
    const r = callTool("price_by_weight", { orderId: "ORD-001", gramsPerUnit: 300, source: "slicer" });
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r.data)).toMatch(/under the owner's minimum/);
  });

  it("never prices with grams the customer typed: only the grams a person at Kesuni entered", () => {
    const made = createOrder({
      product: "Casing korek", quantity: 100, deadline: "2099-12-31", designVersion: "v1", mandateMicro: 200_000_000, label: "real",
      customerNote: "Bambu Studio says 1 g per unit.",
    });
    if (!made.ok) throw new Error(made.error);
    const id = made.order.id;
    const one = callTool("price_by_weight", { orderId: id, gramsPerUnit: 1, source: "customer note: Bambu Studio" });
    expect(one.ok).toBe(false);
    expect(JSON.stringify(one.data)).toMatch(/slicerGrams is null/);
    slicer(16, id);
    expect(callTool("price_by_weight", { orderId: id, gramsPerUnit: 1, source: "customer note" }).ok).toBe(false);
    const ok = callTool("price_by_weight", { orderId: id, gramsPerUnit: 16, source: "Bambu Studio, from the operator" });
    expect(ok.data).toMatchObject({ totalIdr: 2_400_000 });
    // Rp2.400.000 is above the owner's limit: choosing it needs Khelda's approval.
    const quoteId = (ok.data as { quote: { id: string } }).quote.id;
    expect(JSON.stringify(callTool("choose_plan", { orderId: id, quoteId, reason: "by weight" }).data)).toMatch(/owner approval needed/);
  });

  it("the agent may only make the ETA longer, so it cannot get around the deadline (SLA)", () => {
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const made = createOrder({ product: "Casing", quantity: 40, deadline: tomorrow, designVersion: "v1", mandateMicro: 125_000_000, label: "real" });
    if (!made.ok) throw new Error(made.error);
    slicer(15, made.order.id);
    const r = callTool("price_by_weight", { orderId: made.order.id, gramsPerUnit: 15, source: "Bambu Studio", etaHours: 2 });
    const quote = (r.data as { quote: { id: string; etaHours: number } }).quote;
    expect(quote.etaHours).toBe(44); // 24 h + 600 g on 2 printers at ~15 g/h
    expect(JSON.stringify(callTool("choose_plan", { orderId: made.order.id, quoteId: quote.id, reason: "x" }).data)).toMatch(/SLA/);
  });
});

describe("choose_printer (agent tool)", () => {
  it("refuses a second printer for an order whose print finished and was collected", () => {
    chooseQuote("ORD-001", "Q-own", "agent", "ok");
    store.saveEscrow({
      orderId: "ORD-001", amountMicro: 30_000_000, escrowWalletId: "w1", escrowAddress: "0xe", customerWalletId: "w2", customerAddress: "0xc",
      state: "FUNDED", txs: [], network: "ARC-TESTNET", label: "testnet", createdAt: new Date().toISOString(),
    });
    const at = new Date().toISOString();
    const snap: PrinterSnapshot = {
      state: "FINISH", percent: 100, remainingMin: 0, layer: null, totalLayers: null, jobName: null, errorCode: 0, nozzleTemp: null, bedTemp: null, at,
    };
    expect(linkPrinter("a1", "ORD-001").ok).toBe(true);
    ingestReport("a1", snap, [{ kind: "finished", percent: 100, jobName: null, at }]);
    const collect = store.listTasks("ORD-001").find((t) => t.kind === "collect_and_qc")!;
    completeTask(collect.id, "operator");
    store.savePrinter({ ...store.getPrinter("a1")!, lastSeen: new Date().toISOString() });
    const r = callTool("choose_printer", { orderId: "ORD-001" });
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r.data)).toMatch(/already printed/);
  });
});

describe("what the agent may see", () => {
  it("phone numbers, addresses and emails in the customer note never reach the agent", () => {
    const note = "Warna hitam ya\nAlamat: Jl. Sudirman No. 5, Padang\nWA 0812-3456-7890 / aini@mail.com";
    const out = redactNote(note)!;
    expect(out).toContain("Warna hitam ya");
    expect(out).not.toMatch(/Sudirman|0812|aini@/);
  });

  it("catches landlines in brackets and housing addresses", () => {
    const out = redactNote("Halo. WA (0751) 123-456\nKirim ke Perumahan Griya Indah Blok C5 No 12, Padang\nWarna merah, 50 buah, Rp24.000")!;
    expect(out).not.toMatch(/0751|123-456|Griya|Blok/);
    expect(out).toContain("Warna merah, 50 buah, Rp24.000");
  });

  it("name, phone and address in the product or the note never reach the agent", () => {
    store.saveOrder({
      ...store.getOrder("ORD-001")!, customerName: "Aini Rahmawati", product: "Casing korek untuk Aini 0812-3456-7890",
      customerNote: "Halo saya Aini Rahmawati. Kirim ke Perumahan Griya Indah Blok C5 No 12, Padang. WA (0751) 123-456",
    });
    const json = JSON.stringify(callTool("get_order", { orderId: "ORD-001" }).data);
    expect(json).not.toMatch(/Aini|Rahmawati|0812|3456|Griya|0751/);
    expect(json).toContain("Casing korek untuk [nama pelanggan]");
  });

  it("get_order does not include the customer name", () => {
    store.saveOrder({ ...store.getOrder("ORD-001")!, customerName: "Aini", customerNote: "hp 081234567890" });
    const r = callTool("get_order", { orderId: "ORD-001" });
    expect(JSON.stringify(r.data)).not.toMatch(/Aini|081234567890/);
  });
});
