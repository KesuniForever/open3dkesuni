import { afterEach, describe, expect, it } from "vitest";
import { ownerRuleReasons } from "./owner-rules";
import { idrToMicro } from "./costing";
import type { Order, Quote } from "./types";

// 1 USDC = Rp16.000 in these tests.
const order: Order = {
  id: "O", jobId: "J", product: "Casing korek", quantity: 1, deadline: "2099-12-31",
  designVersion: "v1", mandateMicro: 200_000_000, status: "CREATED", label: "real",
};
const q = (usdc: number, source: Quote["source"] = "own", etaHours = 24): Quote =>
  ({ id: "Q", orderId: "O", vendorId: source === "own" ? "own" : "p", priceMicro: usdc * 1e6, etaHours, source });
const approval = (quote: Quote, note = "pilot") => ({ quoteId: quote.id, priceMicro: quote.priceMicro, by: "Felia", note, at: "" });

process.env.IDR_PER_USDC = "16000";
afterEach(() => { delete process.env.KESUNI_MIN_ORDER_IDR; process.env.IDR_PER_USDC = "16000"; });

describe("owner rules", () => {
  it("an order under Rp100.000 needs the owner, and the owner can allow it", () => {
    const r = ownerRuleReasons(order, q(3)); // Rp48.000
    expect(r.reasons[0]).toMatch(/under the owner's minimum/);
    expect(r.ownerCanApprove).toBe(true);
    const ok = ownerRuleReasons({ ...order, ownerApproval: approval(q(3)) }, q(3));
    expect(ok.reasons).toEqual([]);
  });

  it("small orders stay in-house: no partner under Rp300.000, even with approval", () => {
    const r = ownerRuleReasons({ ...order, ownerApproval: approval(q(10, "partner"), "") }, q(10, "partner")); // Rp160.000
    expect(r.reasons.join()).toMatch(/keep it in-house/);
    expect(r.ownerCanApprove).toBe(false);
    expect(ownerRuleReasons(order, q(25, "partner")).reasons).toEqual([]); // Rp400.000
  });

  it("orders above Rp1.000.000 need the owner", () => {
    expect(ownerRuleReasons(order, q(70)).reasons.join()).toMatch(/owner approval needed/); // Rp1.120.000
  });

  it("the approval is for one quote at one price: another quote or a new price needs a new approval", () => {
    const approved = { ...order, ownerApproval: approval(q(70)) }; // Rp1.120.000 approved
    expect(ownerRuleReasons(approved, q(70)).reasons).toEqual([]);
    expect(ownerRuleReasons(approved, q(250)).reasons.join()).toMatch(/Rp4\.000\.000 is above/); // re-priced, not approved
    expect(ownerRuleReasons(approved, { ...q(70), id: "Q-other" }).reasons.join()).toMatch(/owner approval needed/);
    expect(ownerRuleReasons(approved, q(3)).reasons.join()).toMatch(/under the owner's minimum/); // lifts no other price
  });

  it("exactly Rp100.000, Rp300.000 and Rp1.000.000 are within the rules despite USDC cent rounding", () => {
    process.env.IDR_PER_USDC = "16500"; // Rp100.000 → 6,06 USDC → Rp99.990; Rp1.000.000 → 60,61 USDC → Rp1.000.065
    const at = (idr: number, source: Quote["source"] = "own"): Quote => ({ ...q(1, source), priceMicro: idrToMicro(idr) });
    expect(ownerRuleReasons(order, at(100_000)).reasons).toEqual([]);
    expect(ownerRuleReasons(order, at(1_000_000)).reasons).toEqual([]);
    expect(ownerRuleReasons(order, at(300_000, "partner")).reasons).toEqual([]);
    expect(ownerRuleReasons(order, at(99_500)).reasons.join()).toMatch(/under the owner's minimum/);
    expect(ownerRuleReasons(order, at(1_000_500)).reasons.join()).toMatch(/above Rp1\.000\.000/);
    // Kesuni's own by-weight quote is compared in the rupiah that was agreed.
    const byWeight = { ...order, gramPricing: { quoteId: "Q", totalIdr: 1_000_000 } as Order["gramPricing"] };
    expect(ownerRuleReasons(byWeight, at(1_000_000)).reasons).toEqual([]);
    const aini = { ...order, gramPricing: { quoteId: "Q", totalIdr: 1_200_000 } as Order["gramPricing"] };
    expect(ownerRuleReasons(aini, at(1_200_000)).reasons.join()).toMatch(/Order value Rp1\.200\.000 is above/);
  });

  it("an option that finishes after the deadline is refused (SLA)", () => {
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const r = ownerRuleReasons({ ...order, deadline: tomorrow }, q(10, "own", 24 * 5));
    expect(r.reasons.join()).toMatch(/SLA/);
  });

  it("the owner sets the numbers", () => {
    process.env.KESUNI_MIN_ORDER_IDR = "40000";
    expect(ownerRuleReasons(order, q(3)).reasons).toEqual([]);
  });
});
