import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as store from "./store";
import { createOrder } from "./actions";
import { quoteByWeight } from "./agreement";
import { microToUsdc } from "./policy";
import { pricingConfig } from "./pricing";
import { liveView, type LiveRows } from "./live";
import { evaluateGates } from "./token-research";
import { gramsTyped, portalMachines, portalPrice, portalToken } from "./portal";
import { emptySnapshot, stageOf, type PrinterSnapshot } from "./printer/bambu";
import type { Printer } from "./types";
import type { Traction } from "./traction";
import { makeT } from "../i18n/core";
import { ID } from "../i18n/id";

// The customer portal's tabs, shaped on the server: the official price only, the printers without orders, the gates
// without evidence.
const ENV = ["IDR_PER_USDC", "KESUNI_PRICE_PER_GRAM_IDR", "KESUNI_COST_PER_GRAM_IDR", "KESUNI_PRICE_PER_GRAM_IDR_PETG", "KESUNI_COST_PER_GRAM_IDR_PETG", "KESUNI_PRICE_ROUND_IDR"];
beforeEach(() => {
  process.env.IDR_PER_USDC = "16000";
  store.resetDb();
});
afterEach(() => { for (const k of ENV) delete process.env[k]; });

describe("portal price calculator", () => {
  it("shows the official price per gram and no result until grams are given", () => {
    const p = portalPrice({});
    expect(p).toEqual({ material: "PLA", perGram: { PLA: 1500, PETG: 1500 }, roundIdr: 500, minOrderIdr: 100_000, approvalAboveIdr: 1_000_000, input: { grams: "", quantity: "1" }, result: null });
  });

  it("prices like an order: grams × price per gram, rounded up per piece, × quantity; USDC as the quote holds it", () => {
    const p = portalPrice({ g: "38.2", q: "2", m: "PLA" });
    // 38.2 g × Rp1.500 = Rp57.300 → Rp57.500 per piece; × 2 = Rp115.000; at Rp16.000 per USDC = 7.1875 USDC.
    expect(p.result).toEqual({ ok: true, gramsPerUnit: 38.2, quantity: 2, pricePerGramIdr: 1500, unitPriceIdr: 57_500, totalIdr: 115_000, usdc: "7.1875" });
    expect(portalPrice({ g: "38,2", q: "2" }).result).toEqual(p.result); // Indonesian decimal comma
    expect(p.input).toEqual({ grams: "38.2", quantity: "2" });
  });

  it("uses the material's own price per gram, and PLA for anything else", () => {
    process.env.KESUNI_PRICE_PER_GRAM_IDR_PETG = "1800";
    const p = portalPrice({ g: "10", m: "petg" });
    expect(p.material).toBe("PETG");
    expect(p.perGram).toEqual({ PLA: 1500, PETG: 1800 });
    expect(p.result).toMatchObject({ ok: true, pricePerGramIdr: 1800, unitPriceIdr: 18_000, totalIdr: 18_000 });
    expect(portalPrice({ g: "10", m: "ABS" }).material).toBe("PLA");
    expect(portalPrice({ g: "10", m: ["PETG", "PLA"] }).material).toBe("PETG"); // a repeated field: the first
  });

  it("gives the reasons for input it cannot price", () => {
    expect(portalPrice({ g: "0" }).result).toEqual({ ok: false, reasons: ["Grams per piece must be above 0 and at most 5000"] });
    expect(portalPrice({ g: "abc", q: "1.5" }).result).toEqual({
      ok: false, reasons: ["Enter the grams per piece as a number, for example 16", "Quantity must be a whole number, at least 1"],
    });
    expect(portalPrice({ g: "6000" }).result).toEqual({ ok: false, reasons: ["Grams per piece must be above 0 and at most 5000"] });
    expect(portalPrice({ g: "12", q: "0" }).result).toMatchObject({ ok: false });
  });

  it("reads grams as people type them: a unit after the number, a decimal comma, a thousands separator", () => {
    const cases: [string, number][] = [["16", 16], ["16 g", 16], ["16g", 16], ["16 gram", 16], ["12,5", 12.5], ["12.5", 12.5], ["0.5", 0.5], ["12.", 12],
      ["1.000", 1000], ["1,000", 1000], ["2.500", 2500], ["0.125", 0.125]];
    for (const [typed, g] of cases) expect(gramsTyped(typed), typed).toBe(g);
    for (const typed of ["abc", "1.2.3", "-5", "."]) expect(gramsTyped(typed), typed).toBeNaN();
    expect(portalPrice({ g: "16 g", q: "2" }).result).toMatchObject({ ok: true, gramsPerUnit: 16, totalIdr: 48_000 });
    expect(portalPrice({ g: "1.000" }).result).toMatchObject({ ok: true, gramsPerUnit: 1000 });
  });

  it("carries the owner's minimum order and approval limit, so the page can say a small or a large order waits for approval", () => {
    expect(portalPrice({ g: "16" })).toMatchObject({ minOrderIdr: 100_000, approvalAboveIdr: 1_000_000 });
    expect(portalPrice({ g: "16" }, pricingConfig(), { minOrderIdr: 150_000, approvalAboveIdr: 2_000_000 }))
      .toMatchObject({ minOrderIdr: 150_000, approvalAboveIdr: 2_000_000 });
  });

  it("never carries Kesuni's cost or margin", () => {
    process.env.KESUNI_COST_PER_GRAM_IDR = "777";
    process.env.KESUNI_COST_PER_GRAM_IDR_PETG = "888";
    const json = JSON.stringify([portalPrice({ g: "16", q: "3" }), portalPrice({ g: "16", m: "PETG" })]);
    expect(json).not.toMatch(/cost|margin|777|888/i);
  });

  it("gives the same Rupiah and USDC as the quote Kesuni makes for that weight", () => {
    process.env.KESUNI_PRICE_PER_GRAM_IDR_PETG = "1700";
    const o = createOrder({ product: "Casing", quantity: 3, deadline: "2099-12-31", designVersion: "v1", mandateMicro: 100_000_000, label: "real", material: "PETG" });
    if (!o.ok) throw new Error(o.error);
    const q = quoteByWeight(o.order.id, { gramsPerUnit: 23.4, source: "Bambu Studio", by: "human" });
    if (!q.ok) throw new Error(q.error);
    const p = portalPrice({ g: "23.4", q: "3", m: "PETG" }, pricingConfig());
    expect(p.result).toMatchObject({ ok: true, totalIdr: q.gramPricing.totalIdr, unitPriceIdr: q.gramPricing.unitPriceIdr, usdc: microToUsdc(q.quote.priceMicro) });
  });
});

// ---------- machines ----------

const NOW = new Date("2026-10-16T05:00:00.000Z");
const RECENT = new Date(NOW.getTime() - 8000).toISOString();
const OLD = new Date(NOW.getTime() - 3_600_000).toISOString();
const snap = (over: Partial<PrinterSnapshot>): PrinterSnapshot => ({ ...emptySnapshot(RECENT), state: "IDLE", ...over });
const ams = (trays: { slot: number; type: string; color: string; empty?: boolean }[], activeSlot: number | null) => ({
  trays: trays.map((x) => ({ ams: 0, slot: x.slot, empty: Boolean(x.empty), type: x.type, subBrand: x.type, infoIdx: null, color: x.color, colors: [x.color], remainPct: null, bambu: true })),
  activeSlot, externalActive: false, humidity: null, lite: true,
});
const PRINTERS: Printer[] = [
  {
    id: "a1", name: "A1 Combo #1", lastSeen: RECENT, currentOrderId: "ORD-010",
    snapshot: snap({
      state: "RUNNING", percent: 62, remainingMin: 42, stage: stageOf("RUNNING", [2, 0], 0), jobName: "lia_keychain.gcode.3mf",
      ams: ams([{ slot: 0, type: "PLA", color: "#FEC600" }, { slot: 1, type: "PLA", color: "#000000", empty: true }, { slot: 2, type: "PETG", color: "#FFFFFF" }], 0),
    }),
  },
  { id: "a1-2", name: "A1 Combo #2", lastSeen: RECENT, bedOccupiedBy: "ORD-011", snapshot: snap({ state: "FINISH" }) },
];
const rows = (printers: Printer[]): LiveRows => ({
  printers, orders: [
    { id: "ORD-010", jobId: "J", product: "lia: keychain", quantity: 1, deadline: "2026-10-20", designVersion: "v1", mandateMicro: 1, status: "IN_PRODUCTION", label: "real", customerName: "Lia" },
  ],
  log: [], escrows: [], people: [], agentPrints: { on: false }, network: { name: "Arc Testnet", isTestnet: true }, issueTexts: {},
  usage: {
    rule: "", realCustomers: 0, realOrders: 1, excluded: { simulatedOrders: 0, demoTopups: 0 },
    arcTxs: { count: 0, verifiedOnArc: 0, mismatchOnArc: 0, notCheckedYet: 0, volume: { testnet: { micro: 0, usdc: "0" }, mainnet: { micro: 0, usdc: "0" } } },
  } as unknown as Traction,
});

describe("portal machines", () => {
  it("each printer: online, what it does, progress with the finish time, and the spools loaded", () => {
    const m = portalMachines(liveView(rows(PRINTERS), NOW));
    expect(m.bridgeDown).toBe(false);
    expect(m.lastReport).toBe("8 s ago");
    const [one, two] = m.printers;
    expect(one).toMatchObject({
      name: "A1 Combo #1", online: true, state: { tone: "busy", text: "Printing 62%" },
      progress: { percent: 62, paused: false, remaining: "42m", doneAt: "12:41" },
    });
    expect(one.spools.map((s) => [s.type, s.name, s.active])).toEqual([["PLA", "Yellow", true], ["PETG", "White", false]]);
    expect(two).toMatchObject({ name: "A1 Combo #2", online: true, state: { text: "Finished" }, progress: null, stage: null, spools: [] });
    // With the page's words: a printer at rest reads "Free" for a customer; one at work keeps its state.
    const id = makeT("id", ID);
    const words = portalMachines(liveView(rows(PRINTERS), NOW), id).printers.map((p) => p.state.text);
    expect(words).toEqual(["Printing 62%", "Luang"]);
    expect(portalMachines(liveView(rows(PRINTERS), NOW), makeT("en", {})).printers[1].state).toEqual({ tone: "ok", text: "Free" });
  });

  it("shows no order, customer, product, file or bed", () => {
    const json = JSON.stringify(portalMachines(liveView(rows(PRINTERS), NOW)));
    expect(json).not.toMatch(/ORD-|Lia|keychain|gcode|bed|order/i);
  });

  it("says the studio connection is down when no printer is online", () => {
    const off = PRINTERS.map((p) => ({ ...p, lastSeen: OLD }));
    const m = portalMachines(liveView(rows(off), NOW));
    expect(m.bridgeDown).toBe(true);
    expect(m.lastReport).toBe("1 h ago");
    expect(m.printers.every((p) => !p.online && p.state.text === "Offline")).toBe(true);
    expect(portalMachines(liveView(rows([]), NOW)).bridgeDown).toBe(false); // nothing reported yet: not "down"
  });
});

// ---------- token research ----------

describe("portal token research", () => {
  it("each gate with its status and one line; no evidence, reviewer, period or thresholds", () => {
    const r = evaluateGates({ realOrders: 3, realCustomers: 2, verifiedOnArc: 4, mismatchOnArc: 0, finished: 1, onTimePct: 100, firstPassPct: null });
    const k = portalToken(r);
    expect(k).toMatchObject({ overall: "ISSUANCE BLOCKED", passed: 0, total: 8 });
    expect(k.gates.map((g) => [g.n, g.status])).toEqual([
      ["01", "BLOCKED"], ["02", "NOT YET"], ["03", "UNKNOWN"], ["04", "NOT YET"], ["05", "NOT YET"], ["06", "UNKNOWN"], ["07", "NOT YET"], ["08", "NOT YET"],
    ]);
    expect(k.gates[0]).toEqual({ n: "01", id: "legal", title: "Legal & instrument rights", status: "BLOCKED", line: "Blocked in Indonesia. Other jurisdictions not reviewed." });
    for (const g of k.gates) expect(Object.keys(g).sort()).toEqual(["id", "line", "n", "status", "title"]);
    expect(JSON.stringify(k)).not.toMatch(/"(evidence|reviewer|period|checks|target|why|live)"/);
  });
});
