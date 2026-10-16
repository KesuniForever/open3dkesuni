import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as store from "../store";
import { resetDb } from "../store";
import { planOrder } from "./planner";
import { callTool, LLM_TOOLS, redactNote, TOOLS } from "./tools";
import { approveByOwner, chooseQuote, createOrder, ensureCustomerToken } from "../actions";
import { setSlicerGrams } from "../agreement";
import { completeTask, ingestReport, linkPrinter } from "../printer/actions";
import { detectEvents, mergeReport, type PrinterSnapshot } from "../printer/bambu";
import { setOrderRuns } from "../printer/dispatch";
import { nameOf } from "../colors";
import { setLlmGateway } from "./chief";
import { POST as approvalRoute } from "@/app/api/orders/[id]/owner-approval/route";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/** A person at Kesuni enters grams per unit from the slicer: the only grams the agent may price with. */
const slicer = (gramsPerUnit: number, orderId = "ORD-001", colorMode?: "single" | "multi") => {
  const r = setSlicerGrams(orderId, { gramsPerUnit, source: "Bambu Studio, plate 1", by: "operator", colorMode });
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
      "propose_payment", "request_dispatch", "request_human_decision",
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
    slicer(15, made.order.id, "multi");
    const r = callTool("price_by_weight", { orderId: made.order.id, gramsPerUnit: 15, source: "Bambu Studio", etaHours: 2 });
    const quote = (r.data as { quote: { id: string; etaHours: number } }).quote;
    // Multi colour, as the operator entered: 40 units on 3 printers = 14 rounds × 15 g × 15 min = 3150 min → 53 h + 1 h
    expect(quote.etaHours).toBe(54);
    expect(JSON.stringify(callTool("choose_plan", { orderId: made.order.id, quoteId: quote.id, reason: "x" }).data)).toMatch(/SLA/);
  });

  it("uses the colour mode a person entered with the slicer grams; older grams without one are single colour", () => {
    slicer(30, "ORD-001", "multi");
    const multi = callTool("price_by_weight", { orderId: "ORD-001", gramsPerUnit: 30, source: "Bambu Studio" });
    // 1 unit: 30 g × 5–15 min = 150–450 min → 8 h + 1 h. Same price as single colour.
    expect(multi.data).toMatchObject({ colorMode: "multi", totalIdr: 45_000, printMinutes: { min: 150, max: 450 }, etaHours: 9 });
    expect(store.getOrder("ORD-001")!.gramPricing).toMatchObject({ colorMode: "multi", by: "agent" });
    expect(JSON.stringify(callTool("get_order", { orderId: "ORD-001" }).data)).toMatch(/"slicerGrams":\{"gramsPerUnit":30,"source":"Bambu Studio, plate 1","colorMode":"multi"\}/);
    // A row saved before the colour mode existed.
    const { colorMode: _old, ...older } = store.getOrder("ORD-001")!.slicerGrams!;
    void _old;
    store.saveOrder({ ...store.getOrder("ORD-001")!, slicerGrams: older });
    const single = callTool("price_by_weight", { orderId: "ORD-001", gramsPerUnit: 30, source: "Bambu Studio" });
    expect(single.data).toMatchObject({ colorMode: "single", totalIdr: 45_000, printMinutes: { min: 90, max: 150 }, etaHours: 4 });
    // The Chief cannot pick a faster colour mode itself: an input it sends is ignored.
    slicer(30, "ORD-001", "multi");
    const forced = callTool("price_by_weight", { orderId: "ORD-001", gramsPerUnit: 30, source: "Bambu Studio", colorMode: "single" });
    expect(forced.data).toMatchObject({ colorMode: "multi", etaHours: 9 });
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
    expect(json).toContain("Casing korek untuk [customer name]");
  });

  it("get_order does not include the customer name", () => {
    store.saveOrder({ ...store.getOrder("ORD-001")!, customerName: "Aini", customerNote: "hp 081234567890" });
    const r = callTool("get_order", { orderId: "ORD-001" });
    expect(JSON.stringify(r.data)).not.toMatch(/Aini|081234567890/);
  });
});

describe("printers: the Chief reads their status, only people control them", () => {
  const CONTROL_WORD = /\b(start|pause|resum|stop|speed|light|print_now|gcode|g-code)/i;

  it("no tool can start, pause, resume or stop a print, or change a printer's speed or light", () => {
    for (const t of TOOLS) {
      expect(t.name, t.name).not.toMatch(CONTROL_WORD);
      expect(t.description, t.name).not.toMatch(CONTROL_WORD);
      expect(JSON.stringify(t.inputSchema), t.name).not.toMatch(CONTROL_WORD);
    }
    for (const name of ["pause_print", "stop_print", "start_print", "set_speed", "light_on", "printer_command"]) {
      expect(callTool(name, { orderId: "ORD-001" }).ok, name).toBe(false);
    }
  });

  it("the agent's code never imports the printer controls or the print-job code", () => {
    const dir = path.join(process.cwd(), "src", "lib", "agent");
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))) {
      const src = readFileSync(path.join(dir, file), "utf8");
      expect(src, file).not.toMatch(/printer\/(jobs|control)["']/);
      expect(src, file).not.toMatch(/createPrinterCommand|createPrintJob|buildMqttPayload|updateQueueItem/);
      // Agent prints: only the dispatcher's read (planDispatch/safePlan) and its "look now" (safeDispatch) are reachable;
      // never the enforcer, the switch, a bed confirmation, an order's runs or a slice request.
      expect(src, file).not.toMatch(/createAgentPrintJob|agentStartReasons|setAutoPrint|setOrderRuns|clearBed|completeTask|confirmColors|requestSlice|runDispatch/);
      // "Done (debug)" (a test order counts as printed without a print) is for people only.
      expect(src, file).not.toMatch(/done-debug|markPrintDoneDebug|print_done_debug/);
      for (const m of src.matchAll(/from "\.\.\/printer\/([\w-]+)"/g)) expect(["actions", "bambu", "errors", "dispatch", "autoprint", "autoprint-rules"], file).toContain(m[1]);
    }
  });

  it("request_dispatch takes only the order, cannot pass a gate, and does nothing while agent prints are off", () => {
    const tool = TOOLS.find((t) => t.name === "request_dispatch")!;
    expect(tool.inputSchema).toEqual({ type: "object", properties: { orderId: { type: "string" } }, required: ["orderId"] });
    expect(LLM_TOOLS.map((t) => t.name)).toContain("request_dispatch");
    chooseQuote("ORD-001", "Q-own", "agent", "within budget");
    store.saveOrder({ ...store.getOrder("ORD-001")!, label: "real", autoPrint: { runsNeeded: 5, by: "Khelda", at: new Date().toISOString() } });
    // Extra fields the model might send (a printer, "skip the bed", the switch) are ignored.
    const r = callTool("request_dispatch", { orderId: "ORD-001", printerId: "a1", bedEmptyConfirmed: true, on: true, force: true });
    expect(r).toMatchObject({ ok: true, data: { agentPrintsOn: false, queuedForThisOrder: [] } });
    expect(store.getMeta("autoPrint")).toBeUndefined();
    expect(store.listPrintJobs()).toEqual([]);
    expect(store.listLog("ORD-001").at(-1)).toMatchObject({ actor: "agent", tool: "request_dispatch" });
  });

  it("get_production_status shows what each printer is doing, its faults and its spools (read-only)", () => {
    const report = (print: Record<string, unknown>, prev?: PrinterSnapshot) => {
      const next = mergeReport(prev, { print }, new Date().toISOString())!;
      ingestReport("a1-3", next, detectEvents(prev, next));
      return next;
    };
    report({
      gcode_state: "PREPARE", stg: [2, 13, 1], stg_cur: 2, spd_lvl: 2, sdcard: true, nozzle_diameter: "0.4",
      hms: [{ attr: 84935680, code: 65604 }],
      ams: { ams: [{ id: "0", info: "1002", tray: [{ id: "0", tray_type: "PLA", tray_color: "FF6910FF" }, { id: "1" }] }] },
    });
    const data = callTool("get_production_status", { orderId: "ORD-001" }).data as { printers: Record<string, unknown>[]; printJobs: unknown[] };
    expect(data.printers[0]).toMatchObject({
      id: "a1-3", state: "PREPARE", stage: "Heatbed preheating", needsPerson: false, speed: "Standard", nozzleMm: "0.4", sdCard: true,
      faults: [{ code: "HMS_0510_0400_0001_0044", level: "fatal", text: "The firmware of AMS lite does not match the printer. Please upgrade it on the \"Firmware\" page." }],
      spools: [{ slot: 1, material: "PLA", color: "#FF6910", colorName: "Orange" }], spoolColoursChecked: false,
    });
    expect(data.printJobs).toEqual([]);
  });
});

describe("materials: the Chief prices PLA and PETG", () => {
  beforeEach(() => { process.env.IDR_PER_USDC = "16000"; });
  afterEach(() => { delete process.env.IDR_PER_USDC; delete process.env.KESUNI_PRICE_PER_GRAM_IDR_PETG; });

  it("prices an order whose material is PETG, at the PETG price per gram", () => {
    process.env.KESUNI_PRICE_PER_GRAM_IDR_PETG = "1800";
    store.saveOrder({ ...store.getOrder("ORD-001")!, material: "PETG", customerNote: "Pakai PETG ya, warna hitam" });
    slicer(100);
    const get = callTool("get_order", { orderId: "ORD-001" }).data as { material: string; pricingBlockedBy: string | null };
    expect(get).toMatchObject({ material: "PETG", pricingBlockedBy: null });
    const r = callTool("price_by_weight", { orderId: "ORD-001", gramsPerUnit: 100, source: "Bambu Studio" });
    expect(r.data).toMatchObject({ unitPriceIdr: 180_000, totalIdr: 180_000 });
    expect(store.getOrder("ORD-001")!.gramPricing).toMatchObject({ pricePerGramIdr: 1800, costPerGramIdr: 750 });
  });

  it("PETG in the note of an order that is not PETG still goes to a person; so do other materials", () => {
    store.saveOrder({ ...store.getOrder("ORD-001")!, material: "PLA", customerNote: "PETG kalau bisa" });
    expect((callTool("get_order", { orderId: "ORD-001" }).data as { pricingBlockedBy: string }).pricingBlockedBy)
      .toBe('The order mentions "PETG" but its material is PLA: a person checks which material it is');
    store.saveOrder({ ...store.getOrder("ORD-001")!, material: "PETG", customerNote: "PETG atau ABS" });
    expect((callTool("get_order", { orderId: "ORD-001" }).data as { pricingBlockedBy: string }).pricingBlockedBy).toMatch(/mentions "ABS"/);
    store.saveOrder({ ...store.getOrder("ORD-001")!, material: "PETG", customerNote: "", spec: { dimensions: "", toleranceMm: 0.2, material: "PLA", color: "", layerMm: 0.2, infillPct: 15, finishing: "Standard", promise: "" } });
    expect((callTool("get_order", { orderId: "ORD-001" }).data as { pricingBlockedBy: string }).pricingBlockedBy)
      .toBe('The order\'s material is PETG but the spec says "PLA": a person checks which one it is');
  });
});

describe("privacy: no tool result carries the customer's name or the token of their order page", () => {
  beforeEach(() => { process.env.IDR_PER_USDC = "16000"; });
  afterEach(() => { delete process.env.IDR_PER_USDC; });

  it("every tool, before and after the plan, refused or not", () => {
    const orderId = "ORD-001";
    const token = ensureCustomerToken(orderId)!;
    store.saveOrder({
      ...store.getOrder(orderId)!, customerName: "Aini Rahmawati", label: "real", customerNote: "Untuk Aini Rahmawati",
      // The owner may name the customer in their note.
      ownerApproval: { quoteId: "Q-own", priceMicro: 30_000_000, by: "Khelda", note: "Pilot order for Aini, OK", at: new Date().toISOString() },
    });
    slicer(300);
    const inputs: Record<string, Record<string, unknown>> = {
      check_vendor_policy: { quoteId: "Q-own" },
      price_by_weight: { orderId, gramsPerUnit: 300, source: "Bambu Studio" },
      request_human_decision: { orderId, question: "Is this right?" },
      create_operator_task: { orderId, kind: "check_printer", text: "Check the nozzle" },
      message_customer: { orderId, text: "Your order is in." },
      propose_payment: { orderId, recipient: "0x0000000000000000000000000000000000000001", amountMicro: 1, idempotencyKey: "k" },
      price_with_calculator: { orderId, gramsPerUnit: 300, machineHours: 2, unitPriceIdr: 450_000, source: "slicer" },
    };
    const results: unknown[] = [];
    const runAll = () => { for (const t of TOOLS) results.push(callTool(t.name, inputs[t.name] ?? { orderId })); };
    runAll();
    results.push(callTool("choose_plan", { orderId, quoteId: "Q-own", reason: "Own studio" }));
    expect(results.at(-1)).toMatchObject({ ok: true, data: { id: orderId, status: "PLAN_CHOSEN", chosenQuoteId: "Q-own" } });
    store.saveEscrow({
      orderId, amountMicro: 30_000_000, escrowWalletId: "w1", escrowAddress: "0xe", customerWalletId: "w2", customerAddress: "0xc",
      state: "FUNDED", txs: [], network: "ARC-TESTNET", label: "testnet", createdAt: new Date().toISOString(),
    });
    runAll();
    const json = JSON.stringify(results);
    expect(json).not.toContain(token);
    expect(json).not.toMatch(/Aini|Rahmawati|customerName|customerToken/);
    // nor the log the tools write
    expect(JSON.stringify(store.listLog(orderId))).not.toContain(token);
    expect(json).toContain("Pilot order for [customer name], OK");
  });

  it("the owner's approval note wakes the Chief without the customer's name", async () => {
    const orderId = "ORD-001";
    const woken: string[] = [];
    process.env.KESUNI_MAX_WAKES_PER_HOUR = "1000";
    setLlmGateway(async (req) => { woken.push(String(req.messages[0].content)); return { stop_reason: "end_turn", content: [{ type: "text", text: "ok" }] }; });
    store.saveOrder({ ...store.getOrder(orderId)!, customerName: "Aini Rahmawati" });
    const res = await approvalRoute(new Request("http://x", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ quoteId: "Q-own", by: "Khelda", note: "Pilot order for Aini, OK" }),
    }), { params: Promise.resolve({ id: orderId }) });
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 20));
    setLlmGateway(undefined);
    delete process.env.KESUNI_MAX_WAKES_PER_HOUR;
    expect(woken).toEqual([expect.stringContaining('quote Q-own: "Pilot order for [customer name], OK"')]);
    expect(woken.join()).not.toMatch(/Aini|Rahmawati/);
  });
});

describe("one open question per order (the over-budget loop of ORD-005)", () => {
  afterEach(() => setLlmGateway(undefined));

  it("the same question is not asked twice; a new one while it is open becomes an Update line", () => {
    const orderId = "ORD-001";
    const a = callTool("request_human_decision", { orderId, question: "Rp600.000 is over the budget. Approve?", recommendation: "Ask the customer" });
    const id = (a.data as { taskId: string }).taskId;
    expect(callTool("request_human_decision", { orderId, question: "Rp600.000 is over the budget. Approve?" }).data)
      .toMatchObject({ taskId: id, alreadyAsked: true });
    expect(callTool("request_human_decision", { orderId, question: "Still over the budget with the new grams. Approve?" }).data)
      .toMatchObject({ taskId: id, updatedOpenQuestion: true });
    const open = store.listTasks(orderId).filter((t) => t.kind === "needs_info");
    expect(open).toHaveLength(1);
    expect(open[0].text).toBe("Rp600.000 is over the budget. Approve?\nChief's recommendation: Ask the customer\nUpdate: Still over the budget with the new grams. Approve?");
    expect(open[0]).toMatchObject({ by: "chief", createdBy: "agent" });
    // get_order shows earlier questions, answered ones too, without who answered.
    completeTask(id, "Khelda");
    const seen = (callTool("get_order", { orderId }).data as { earlierQuestions: unknown[] }).earlierQuestions;
    expect(seen).toEqual([{ taskId: id, text: open[0].text, status: "done", at: open[0].at, doneAt: expect.any(String) }]);
    expect(JSON.stringify(seen)).not.toContain("Khelda");
    // Answered: the next question is a new task.
    expect((callTool("request_human_decision", { orderId, question: "Grams per unit?" }).data as { taskId: string }).taskId).not.toBe(id);
  });

  it("an owner approval the policy would still refuse is refused: nothing saved, the question stays open, no wake", async () => {
    const orderId = "ORD-001";
    const woken: string[] = [];
    setLlmGateway(async (req) => { woken.push(String(req.messages[0].content)); return { stop_reason: "end_turn", content: [{ type: "text", text: "ok" }] }; });
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    store.saveOrder({ ...store.getOrder(orderId)!, deadline: tomorrow });
    store.saveQuote({ ...store.getQuote("Q-own")!, etaHours: 500 }); // after the deadline: no approval lifts that
    store.saveTask({ id: "T-q", orderId, kind: "needs_info", text: "Approve?", status: "open", createdBy: "agent", at: new Date().toISOString() });
    const res = await approvalRoute(new Request("http://x", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ quoteId: "Q-own", by: "Khelda", note: "ok" }),
    }), { params: Promise.resolve({ id: orderId }) });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ error: expect.stringMatching(/cannot make this quote allowed/), reasons: [expect.stringMatching(/SLA/)] });
    await new Promise((r) => setTimeout(r, 20));
    expect(store.getOrder(orderId)!.ownerApproval).toBeUndefined();
    expect(store.getTask("T-q")!.status).toBe("open");
    expect(woken).toEqual([]);
  });

  it("a price above the customer's budget: saved for the customer's raise, the question answered, the Chief not woken", async () => {
    const orderId = "ORD-001";
    const woken: string[] = [];
    setLlmGateway(async (req) => { woken.push(String(req.messages[0].content)); return { stop_reason: "end_turn", content: [{ type: "text", text: "ok" }] }; });
    store.saveQuote({ ...store.getQuote("Q-own")!, priceMicro: 40_000_000 }); // over the 32 USDC budget
    store.saveTask({ id: "T-q", orderId, kind: "needs_info", text: "Over budget. Approve?", status: "open", createdBy: "agent", at: new Date().toISOString() });
    const res = await approvalRoute(new Request("http://x", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ quoteId: "Q-own", by: "Khelda", note: "pilot" }),
    }), { params: Promise.resolve({ id: orderId }) });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ waitsOnCustomer: true });
    await new Promise((r) => setTimeout(r, 20));
    expect(store.getOrder(orderId)!.ownerApproval).toMatchObject({ quoteId: "Q-own", priceMicro: 40_000_000 });
    expect(store.getTask("T-q")).toMatchObject({ status: "done", doneBy: "Khelda (approved by the owner; the customer may raise their budget)" });
    expect(woken).toEqual([]);
    expect(approveByOwner(orderId, { quoteId: "Q-partner", by: "Khelda", note: "x" })).toMatchObject({ ok: true, waitsOnCustomer: true });
  });
});

describe("production: runs, units and the studio's slices", () => {
  const realOrder = (quantity: number) => {
    const r = createOrder({ product: "Lampu", quantity, deadline: "2099-12-31", designVersion: "v1", mandateMicro: 500_000_000, label: "real" });
    if (!r.ok) throw new Error(r.error);
    return r.order.id;
  };

  it("get_production_status: a real order needs one run per unit unless a person set the runs", () => {
    const id = realOrder(6);
    const prod = () => (callTool("get_production_status", { orderId: id }).data as { production: Record<string, unknown> }).production;
    expect(prod()).toEqual({
      quantity: 6, runsNeeded: 6, runsDone: 0, runsOnTheirWay: 0, unitsPerRun: 1, unitsPrinted: 0, runsSetBy: "default", printingFinished: false,
    });
    expect(setOrderRuns(id, { runsNeeded: 2, by: "Khelda" }).ok).toBe(true); // three lamps per plate
    expect(prod()).toMatchObject({ runsNeeded: 2, unitsPerRun: 3, runsSetBy: "a person" });
  });

  it("get_production_status: once a person printed a real order (a full plate), it needs that one run", () => {
    const id = realOrder(6);
    const at = new Date().toISOString();
    store.savePrintJob({
      id: "PJ-1-x", orderId: id, printerId: "a1", attachmentId: "A-1", plate: 1, fileName: "x.gcode.3mf", amsMapping: [0],
      options: { bedLevelling: true, flowCali: true, timelapse: false, useAms: true }, state: "done", by: "Khelda", createdAt: at, updatedAt: at,
    });
    const prod = (callTool("get_production_status", { orderId: id }).data as { production: Record<string, unknown> }).production;
    expect(prod).toMatchObject({ quantity: 6, runsNeeded: 1, runsDone: 1, unitsPerRun: 6, unitsPrinted: 6, runsSetBy: "default" });
  });

  it("get_order shows the studio's slices for checking (weight, minutes), never who sliced", () => {
    const id = realOrder(1);
    const at = new Date().toISOString();
    store.insertSliceJob({
      id: "SJ-1", orderId: id, attachmentId: "A-1", sourceName: "Lampu.stl", mode: "mesh", printerId: "a1", tray: 0, material: "PLA", color: "#FFFFFF",
      quality: "standard", infillPct: 15, supports: "auto", key: "k", state: "done", actor: "person", by: "Khelda", createdAt: at, updatedAt: at,
      result: { predictionSec: 8700, weightG: 55.29, priceIdr: null },
    });
    const d = callTool("get_order", { orderId: id }).data as { slices: unknown[] };
    expect(d.slices).toEqual([{ sliceId: "SJ-1", file: "Lampu.stl", weightG: 55.29, minutes: 145, by: "a person" }]);
    expect(JSON.stringify(d)).not.toContain("Khelda");
  });

  it("choose_printer picks the printer with the order's spool; without one it asks for it and links nothing", () => {
    const id = realOrder(1);
    store.saveQuote({ id: "Q-x", orderId: id, vendorId: "own", priceMicro: 30_000_000, etaHours: 48, source: "own" });
    expect(chooseQuote(id, "Q-x", "agent", "ok").ok).toBe(true);
    store.saveOrder({ ...store.getOrder(id)!, material: "PETG", preferredColors: [{ type: "PETG", color: "#0A3FD0" }] });
    store.saveEscrow({
      orderId: id, amountMicro: 30_000_000, escrowWalletId: "w1", escrowAddress: "0xe", customerWalletId: "w2", customerAddress: "0xc",
      state: "FUNDED", txs: [], network: "ARC-TESTNET", label: "testnet", createdAt: new Date().toISOString(),
    });
    const idle = (type: string, color: string) => ({
      gcode_state: "IDLE", sdcard: true, hms: [], nozzle_diameter: "0.4",
      ams: { ams: [{ id: "0", info: "1002", tray: [{ id: "0", tray_type: type, tray_color: color, tray_sub_brands: "" }] }] },
    });
    ingestReport("a1", mergeReport(undefined, { print: idle("PLA", "FEC600FF") }, new Date().toISOString())!, []);
    ingestReport("a1-2", mergeReport(undefined, { print: idle("PETG", "0A3FD0FF") }, new Date().toISOString())!, []);
    expect(callTool("choose_printer", { orderId: id })).toMatchObject({ ok: true, data: { printer: "A1 Combo #2" } });
    store.savePrinter({ ...store.getPrinter("a1-2")!, currentOrderId: undefined });
    ingestReport("a1-2", mergeReport(undefined, { print: idle("PLA", "FFFFFFFF") }, new Date().toISOString())!, []);
    const r = callTool("choose_printer", { orderId: id });
    expect(r).toMatchObject({ ok: false, data: { error: `No ready printer has PETG ${nameOf("#0A3FD0")} (#0A3FD0) loaded` } });
    expect(store.listPrinters().some((p) => p.currentOrderId === id)).toBe(false);
    expect(store.listTasks(id).filter((t) => t.status === "open"))
      .toMatchObject([{ kind: "change_filament", by: "chief", text: expect.stringContaining(`Load PETG ${nameOf("#0A3FD0")} (#0A3FD0) on a ready printer for ${id}`) }]);
    callTool("choose_printer", { orderId: id });
    expect(store.listTasks(id).filter((t) => t.kind === "change_filament")).toHaveLength(1); // asked once
  });
});

describe("a tool that fails", () => {
  it("is an error result for the Chief, logged; callTool never throws", () => {
    TOOLS.push({ name: "boom", description: "test", inputSchema: { type: "object" }, run: () => { throw new Error("disk full"); } });
    try {
      expect(callTool("boom", { orderId: "ORD-001" })).toEqual({ ok: false, data: { error: "The tool failed: disk full", reasons: undefined } });
      expect(store.listLog("ORD-001").at(-1)).toMatchObject({ tool: "boom", ok: false, by: "chief" });
    } finally {
      TOOLS.pop();
    }
  });
});
