import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeT } from "../i18n/core";
import { ID } from "../i18n/id";
import * as store from "./store";
import { tLib } from "./lib-text";
import { chiefAuthority } from "./agent/authority";
import { SKILLS, SKILL_TEXT } from "./agent/skills";
import { dashboard } from "./dashboard";
import { ownerRuleReasons } from "./owner-rules";
import { checkEscrowOpen, checkPlan, checkRefund, checkRelease, usdcToMicro } from "./policy";
import { weightInputReasons } from "./pricing";
import { notReadyReason } from "./printer/actions";
import type { Escrow, Order, Printer, Quote, Vendor } from "./types";

const en = makeT("en", ID);
const id = makeT("id", ID);
const NOW = new Date("2026-10-14T15:00:00+07:00");
const ENV = ["KESUNI_MIN_ORDER_IDR", "KESUNI_MAX_WAKES_PER_HOUR", "CIRCLE_BLOCKCHAIN", "KESUNI_ALLOW_MAINNET", "KESUNI_HEARTBEAT_SECONDS"];

beforeEach(() => store.resetDb());
afterEach(() => { for (const k of ENV) delete process.env[k]; });

/** Every text: English stays byte-identical, Indonesian is different (so it was found in the dictionary). */
function covered(texts: string[]) {
  for (const s of texts) {
    expect(tLib(en, s), s).toBe(s);
    expect(tLib(id, s), s).not.toBe(s);
  }
}

const authorityTexts = () => {
  const a = chiefAuthority(NOW);
  return [...a.decidesAlone.map((d) => d.text), ...a.limitedByCode.map((l) => l.text), ...a.handedToPerson.flatMap((h) => [h.text, h.how])];
};

describe("library texts in Indonesian", () => {
  it("covers the Chief's rules with today's config, and with any other config through the templates", () => {
    const today = authorityTexts();
    covered(today);
    for (const s of today) expect(id(s), `plain t() finds "${s}"`).not.toBe(s);

    process.env.KESUNI_MIN_ORDER_IDR = "150000";
    process.env.KESUNI_MAX_WAKES_PER_HOUR = "7";
    process.env.KESUNI_HEARTBEAT_SECONDS = "300";
    covered(authorityTexts());
    process.env.KESUNI_HEARTBEAT_SECONDS = "45";
    covered(authorityTexts());
    process.env.KESUNI_HEARTBEAT_SECONDS = "0";
    covered(authorityTexts());
    process.env.CIRCLE_BLOCKCHAIN = "ARC";
    covered(authorityTexts());
    process.env.KESUNI_ALLOW_MAINNET = "1";
    covered(authorityTexts());
  });

  it("fills values back in", () => {
    process.env.KESUNI_MIN_ORDER_IDR = "150000";
    expect(tLib(id, chiefAuthority(NOW).limitedByCode.find((l) => l.id === "min_order")!.text)).toBe("Pesanan di bawah Rp150.000 perlu persetujuan pemilik");
    expect(tLib(id, "Order is PAID; quotes are closed")).toBe("Pesanan berstatus DIBAYAR; penawaran sudah ditutup");
    expect(id("Order is PAID; quotes are closed")).toBe("Pesanan berstatus DIBAYAR; penawaran sudah ditutup");
    expect(tLib(id, "Heartbeat checks every 7 min: wakes the Chief when an order needs a decision")).toBe("Cek heartbeat tiap 7 mnt: membangunkan Chief saat pesanan butuh keputusan");
    expect(tLib(id, "A1 Combo #1: bed still holds the part of ORD-001. Collect it first.")).toBe("A1 Combo #1: bed masih berisi hasil ORD-001. Ambil dulu.");
    expect(tLib(id, "A1 Combo #2: bed still holds the part of a print without an order")).toBe("A1 Combo #2: bed masih berisi hasil cetakan tanpa pesanan");
    expect(tLib(id, "Something no library writes")).toBe("Something no library writes");
    expect(tLib(id, "ORD-001")).toBe("ORD-001");
  });

  it("covers skills and the home page's attention lines", () => {
    for (const s of SKILLS) {
      expect(id(s), s).not.toBe(s);
      expect(id(SKILL_TEXT[s]), s).not.toBe(SKILL_TEXT[s]);
    }
    const fixed = dashboard().attention.filter((a) => a.kind !== "task").map((a) => a.text);
    expect(fixed.length).toBeGreaterThan(0);
    for (const s of fixed) expect(id(s), s).not.toBe(s);
  });

  it("covers the reasons the policy engine, the owner's rules, pricing and printers give", () => {
    const order: Order = {
      id: "O", jobId: "J", product: "p", quantity: 1, deadline: "2026-10-15", designVersion: "v1",
      mandateMicro: usdcToMicro("5"), status: "PAID", label: "real",
    };
    const quote = (price: string, source: Quote["source"] = "own", etaHours = 100): Quote =>
      ({ id: "Q", orderId: "O", vendorId: "v", priceMicro: usdcToMicro(price), etaHours, source });
    const vendor: Vendor = { id: "v", name: "v", address: "0x0000000000000000000000000000000000000001", approved: true };
    const escrow: Escrow = {
      orderId: "O", amountMicro: usdcToMicro("6"), escrowWalletId: "w", escrowAddress: "0x", customerWalletId: "c", customerAddress: "0x",
      state: "RELEASED", txs: [], network: "ARC-TESTNET", label: "testnet", createdAt: "",
    };
    const reasons = [
      ...ownerRuleReasons(order, quote("1", "partner"), NOW.getTime()).reasons,
      ...ownerRuleReasons(order, quote("100"), NOW.getTime()).reasons,
      ...checkPlan(order, { ...quote("6"), orderId: "X" }, { ...vendor, approved: false }).reasons,
      ...checkPlan(order, quote("1"), undefined).reasons,
      ...checkEscrowOpen(order, quote("6"), escrow).reasons,
      ...checkEscrowOpen(order, undefined, undefined).reasons,
      ...checkRelease({ order, chosenQuote: undefined, vendor, evidence: [], acceptance: undefined, escrow, escrowBalanceMicro: 0 }).reasons,
      ...checkRelease({ order, chosenQuote: quote("1"), vendor: { ...vendor, address: "nope" }, evidence: [], acceptance: undefined, escrow, escrowBalanceMicro: 0 }).reasons,
      ...checkRefund({ acceptance: undefined, escrow, escrowBalanceMicro: 0 }).reasons,
      ...weightInputReasons(0, 0),
    ];
    expect(reasons.length).toBeGreaterThan(15);
    covered(reasons);

    const seen = new Date(NOW.getTime() - 10_000).toISOString();
    const printers: Printer[] = [
      { id: "a1", name: "A1 Combo #1" },
      { id: "a1-2", name: "A1 Combo #2", lastSeen: seen, currentOrderId: "ORD-004" },
      { id: "a1-3", name: "A1 Combo #3", lastSeen: seen, bedOccupiedBy: "a print without an order" },
      ...(["RUNNING", "PAUSE", "FAILED", "PREPARE"] as const).map((state, i): Printer => ({
        id: `p${i}`, name: `Printer p${i}`, lastSeen: seen,
        snapshot: { state, percent: 0, remainingMin: null, layer: null, totalLayers: null, jobName: null, errorCode: 0, nozzleTemp: null, bedTemp: null, at: seen },
      })),
    ];
    const why = printers.map((p) => notReadyReason(p, NOW.getTime())!);
    covered([...why, ...printers.map((p, i) => `${p.name}: ${why[i]}`), "A1 Combo #1: ready"]);
  });
});
