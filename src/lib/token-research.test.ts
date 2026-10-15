import { beforeEach, describe, expect, it } from "vitest";
import * as store from "./store";
import { evaluateGates, gateFacts, THRESHOLDS, tokenReadiness, type GateFacts } from "./token-research";
import { allocationModel, distributionPreview, rp, teamUnlockedPct, teamUnlockedUnits, units } from "./token-research-model";
import { makeT } from "../i18n/core";
import { ID } from "../i18n/id";
import type { ChainTx, Escrow, Order } from "./types";

const ZERO: GateFacts = { realOrders: 0, realCustomers: 0, verifiedOnArc: 0, mismatchOnArc: 0, finished: 0, onTimePct: null, firstPassPct: null };
const ENOUGH: GateFacts = { realOrders: 30, realCustomers: 10, verifiedOnArc: 30, mismatchOnArc: 0, finished: 10, onTimePct: 90, firstPassPct: 95 };
const gate = (f: GateFacts, id: string) => evaluateGates(f).gates.find((g) => g.id === id)!;

beforeEach(() => store.resetDb());

describe("launch gates", () => {
  it("has 8 gates in order, legal blocked, and issuance blocked with no evidence", () => {
    const r = evaluateGates(ZERO);
    expect(r.gates.map((g) => g.n)).toEqual(["01", "02", "03", "04", "05", "06", "07", "08"]);
    expect(r.total).toBe(8);
    expect(r.passed).toBe(0);
    expect(r.overall).toBe("ISSUANCE BLOCKED");
    expect(gate(ZERO, "legal").status).toBe("BLOCKED");
    expect(gate(ZERO, "legal").why).toMatch(/Law 7\/2011 Art\. 21.*Law 4\/2026.*POJK 27\/2024 Art\. 80\(7\)/);
    expect(r.gates.filter((g) => g.live).map((g) => g.id)).toEqual(["business", "service"]);
  });

  it("business evidence passes only when every live number meets its threshold and nothing mismatches on Arc", () => {
    expect(gate(ENOUGH, "business").status).toBe("PASS");
    expect(gate({ ...ENOUGH, realOrders: THRESHOLDS.realOrders - 1 }, "business").status).toBe("NOT YET");
    expect(gate({ ...ENOUGH, realCustomers: 9 }, "business").status).toBe("NOT YET");
    expect(gate({ ...ENOUGH, verifiedOnArc: 29 }, "business").status).toBe("NOT YET");
    const mismatch = gate({ ...ENOUGH, mismatchOnArc: 1 }, "business");
    expect(mismatch.status).toBe("NOT YET");
    expect(mismatch.line).toBe("1 transfer does not match on Arc.");
    expect(gate(ZERO, "business").checks).toEqual([
      { label: "Real orders", short: "orders", value: 0, target: 30, unit: "", ok: false },
      { label: "Real customers", short: "customers", value: 0, target: 10, unit: "", ok: false },
      { label: "Verified on Arc", short: "Arc-verified", value: 0, target: 30, unit: "", ok: false },
    ]);
  });

  it("service health needs enough finished orders and treats missing rates as not met", () => {
    expect(gate(ENOUGH, "service").status).toBe("PASS");
    expect(gate(ZERO, "service").line).toBe("Too few finished real orders.");
    expect(gate({ ...ENOUGH, onTimePct: null }, "service").status).toBe("NOT YET");
    const slow = gate({ ...ENOUGH, onTimePct: 89.9 }, "service");
    expect(slow.status).toBe("NOT YET");
    expect(slow.line).toBe("On time or QC below the draft.");
    expect(gate({ ...ENOUGH, firstPassPct: 94 }, "service").status).toBe("NOT YET");
  });

  it("stays blocked even when both live gates pass (the fixed gates are not PASS)", () => {
    const r = evaluateGates({ ...ENOUGH, realOrders: 1000 });
    expect(r.passed).toBe(2);
    expect(r.overall).toBe("ISSUANCE BLOCKED");
  });

  it("reads real orders only: simulated orders and their transfers never count", () => {
    // the seeded simulated order, finished and paid out on Arc
    const sim = store.getOrder("ORD-001")!;
    store.saveOrder({ ...sim, status: "PAID" });
    const tx = (kind: ChainTx["kind"], n: number): ChainTx => ({
      kind, from: "0xa", to: "0xb", amountMicro: 1_000_000, idempotencyKey: `k${n}`, state: "COMPLETE",
      txHash: `0x${n.toString(16).padStart(64, "0")}`, at: new Date().toISOString(), verified: { ok: true, at: "x", logId: "l" },
    });
    const escrow = (orderId: string, txs: ChainTx[]): Escrow => ({
      orderId, amountMicro: 1_000_000, escrowWalletId: "w", escrowAddress: "0xe", customerWalletId: "c", customerAddress: "0xc",
      state: "RELEASED", txs, network: "ARC-TESTNET", label: "testnet", createdAt: new Date().toISOString(),
    });
    store.saveEscrow(escrow("ORD-001", [tx("deposit", 1), tx("release", 2)]));
    expect(gateFacts()).toMatchObject({ realOrders: 0, realCustomers: 0, verifiedOnArc: 0, finished: 0 });

    // one real order, accepted on time, all units passed QC, deposit + release verified on Arc
    const real: Order = {
      ...sim, id: "ORD-501", jobId: "JOB-501", label: "real", status: "PAID", customerName: "Aini", deadline: "2026-12-31",
      customerToken: "tok-501-xxxxxxxxxxxxxxxx",
      actual: { filamentGrams: 10, machineHours: 1, costIdr: 1000, maxDeviationMm: 0.1, unitsPassed: sim.quantity, note: "", by: "op", at: "2026-10-01T00:00:00Z" },
    };
    store.saveOrder(real);
    store.saveAcceptance({ orderId: "ORD-501", accepted: true, by: "Aini", note: "", at: "2026-10-02T00:00:00Z" });
    store.saveEscrow(escrow("ORD-501", [tx("deposit", 3), tx("release", 4)]));
    expect(gateFacts()).toEqual({
      realOrders: 1, realCustomers: 1, verifiedOnArc: 2, mismatchOnArc: 0, finished: 1, onTimePct: 100, firstPassPct: 100,
    });
    const r = tokenReadiness();
    expect(r.gates.find((g) => g.id === "business")!.checks!.map((c) => c.value)).toEqual([1, 1, 2]);
    expect(r.overall).toBe("ISSUANCE BLOCKED");
  });
});

describe("allocation model (simulation)", () => {
  const base = { supply: 1_000_000, communityPct: 50, teamPct: 20, treasuryPct: 30, cliffMonths: 12, vestingMonths: 36 };

  it("splits the supply into model units that add up exactly", () => {
    const m = allocationModel({ ...base, supply: 1_000_001, communityPct: 33.3, teamPct: 33.3, treasuryPct: 33.4 });
    expect(m.ok).toBe(true);
    expect(m.totalPct).toBe(100);
    expect(m.slices.map((s) => s.units)).toEqual([333_000, 333_000, 334_001]);
    expect(m.slices.reduce((a, s) => a + s.units, 0)).toBe(1_000_001);
    expect(allocationModel(base).teamFullMonth).toBe(48);
  });

  it("refuses shares that do not add up to 100% and bad supply or months", () => {
    expect(allocationModel({ ...base, treasuryPct: 25 })).toMatchObject({ ok: false, totalPct: 95, slices: [], errors: ["Shares add up to 95%, not 100%."] });
    expect(allocationModel({ ...base, teamPct: 120, treasuryPct: -40 }).errors).toEqual(["Team must be 0–100%.", "Treasury must be 0–100%."]);
    expect(allocationModel({ ...base, supply: 0 }).ok).toBe(false);
    expect(allocationModel({ ...base, supply: 1.5 }).ok).toBe(false);
    expect(allocationModel({ ...base, cliffMonths: 49 }).errors).toEqual(["Cliff must be 0–48 whole months."]);
    expect(allocationModel({ ...base, vestingMonths: NaN }).ok).toBe(false);
  });

  it("unlocks nothing before the cliff, then in equal monthly steps", () => {
    expect(teamUnlockedPct(11, 12, 36)).toBe(0);
    expect(teamUnlockedPct(12, 12, 36)).toBe(0);
    expect(teamUnlockedPct(30, 12, 36)).toBe(50);
    expect(teamUnlockedPct(60, 12, 36)).toBe(100);
    expect(teamUnlockedPct(12, 12, 0)).toBe(100);
    expect(teamUnlockedUnits(300_000, 24, 12, 36)).toBe(100_000); // a third, without float drift
    expect(teamUnlockedUnits(300_000, 11, 12, 36)).toBe(0);
    expect(teamUnlockedUnits(300_000, 99, 12, 36)).toBe(300_000);
    expect(teamUnlockedUnits(300_000, 12, 12, 0)).toBe(300_000);
  });
});

describe("distribution illustration (simulation)", () => {
  it("splits profit × share evenly in whole rupiah and keeps the rest", () => {
    expect(distributionPreview({ monthlyProfitIdr: 10_000_000, sharePct: 10, holders: 3 }))
      .toEqual({ ok: true, errors: [], poolIdr: 1_000_000, perHolderIdr: 333_333, leftoverIdr: 1 });
    expect(distributionPreview({ monthlyProfitIdr: 0, sharePct: 10, holders: 100 })).toMatchObject({ ok: true, poolIdr: 0, perHolderIdr: 0 });
  });

  it("refuses negative profit, shares over 100% and zero or fractional holders", () => {
    expect(distributionPreview({ monthlyProfitIdr: -1, sharePct: 10, holders: 1 }).ok).toBe(false);
    expect(distributionPreview({ monthlyProfitIdr: 1, sharePct: 101, holders: 1 }).errors).toEqual(["Share must be 0–100%."]);
    expect(distributionPreview({ monthlyProfitIdr: 1, sharePct: 10, holders: 0 }).ok).toBe(false);
    expect(distributionPreview({ monthlyProfitIdr: 1, sharePct: 10, holders: 2.5 }).ok).toBe(false);
  });

  it("writes rupiah with dot thousands", () => {
    expect(rp(1650)).toBe("Rp1.650");
    expect(rp(1_000_000)).toBe("Rp1.000.000");
  });
});

describe("Indonesian texts (the ID switch)", () => {
  const id = makeT("id", ID);

  it("translates the gate texts but keeps the status words the page relies on", () => {
    const r = evaluateGates({ ...ZERO, mismatchOnArc: 2 }, id);
    const business = r.gates.find((g) => g.id === "business")!;
    expect(business).toMatchObject({ title: "Bukti bisnis", status: "NOT YET", line: "2 transfer tidak cocok di Arc.", reviewer: "kode" });
    expect(business.checks!.map((c) => c.short)).toEqual(["pesanan", "pelanggan", "terverifikasi"]);
    expect(r.gates[0]).toMatchObject({ status: "BLOCKED", evidence: "tidak ada" });
    expect(r.overall).toBe("ISSUANCE BLOCKED");
    expect(evaluateGates(ZERO).gates[3].title).toBe("Business evidence");
  });

  it("translates the model errors and labels, and can write units the Indonesian way", () => {
    const base = { supply: 1_000_000, communityPct: 50, teamPct: 20, treasuryPct: 25, cliffMonths: 12, vestingMonths: 36 };
    expect(allocationModel(base, id).errors).toEqual(["Total porsi 95%, bukan 100%."]);
    expect(allocationModel({ ...base, treasuryPct: 30 }, id).slices.map((s) => s.label)).toEqual(["Komunitas", "Tim", "Treasury"]);
    expect(distributionPreview({ monthlyProfitIdr: 1, sharePct: 101, holders: 1 }, id).errors).toEqual(["Porsi harus 0–100%."]);
    expect(units(1_000_000)).toBe("1,000,000");
    expect(units(1_000_000, "id-ID")).toBe("1.000.000");
  });
});
