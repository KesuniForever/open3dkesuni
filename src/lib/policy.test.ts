import { describe, expect, it } from "vitest";
import { canTransition } from "./payment-state";
import { checkPaymentIntent, checkPlan, microToUsdc, usdcToMicro } from "./policy";
import type { Acceptance, Evidence, Order, Quote, Vendor } from "./types";

const order: Order = {
  id: "O", jobId: "J", product: "p", quantity: 1, deadline: "2099-12-31",
  designVersion: "v1", mandateMicro: usdcToMicro("32"), status: "ACCEPTED", label: "simulated",
};
const vendor: Vendor = { id: "v", name: "v", address: "0xAbC", approved: true };
const quote = (price: string): Quote => ({ id: "Q", orderId: "O", vendorId: "v", priceMicro: usdcToMicro(price), etaHours: 1, source: "own" });
const qc: Evidence = { id: "E", orderId: "O", kind: "qc", note: "ok", label: "manual", at: "" };
const accepted: Acceptance = { orderId: "O", accepted: true, by: "me", note: "", at: "" };

describe("USDC amounts", () => {
  it("parses exactly and round-trips", () => {
    expect(usdcToMicro("32.5")).toBe(32_500_000);
    expect(microToUsdc(32_500_000)).toBe("32.5");
    expect(microToUsdc(usdcToMicro("0.000001"))).toBe("0.000001");
  });
  it("rejects >6 decimals and junk", () => {
    expect(() => usdcToMicro("1.0000001")).toThrow();
    expect(() => usdcToMicro("-1")).toThrow();
    expect(() => usdcToMicro("1e3")).toThrow();
  });
});

describe("checkPlan", () => {
  it("allows a quote within mandate", () => expect(checkPlan(order, quote("30"), vendor).ok).toBe(true));
  it("refuses 35 against mandate 32", () => {
    const r = checkPlan(order, quote("35"), vendor);
    expect(r.ok).toBe(false);
    expect(r.reasons[0]).toMatch(/exceeds mandate/);
  });
  it("refuses unapproved vendor", () => expect(checkPlan(order, quote("30"), { ...vendor, approved: false }).ok).toBe(false));
});

describe("checkPaymentIntent", () => {
  const base = {
    order, chosenQuote: quote("30"), vendor, evidence: [qc], acceptance: accepted, existingIntents: [],
    proposed: { recipient: "0xabc", amountMicro: usdcToMicro("30"), idempotencyKey: "k1" },
  };
  it("passes when accepted with QC, right payee and amount", () => expect(checkPaymentIntent(base).ok).toBe(true));
  it("blocks without acceptance", () => expect(checkPaymentIntent({ ...base, acceptance: undefined }).ok).toBe(false));
  it("blocks without QC evidence", () => expect(checkPaymentIntent({ ...base, evidence: [] }).ok).toBe(false));
  it("blocks a changed recipient address", () =>
    expect(checkPaymentIntent({ ...base, proposed: { ...base.proposed, recipient: "0xdead" } }).ok).toBe(false));
  it("blocks amount differing from quote", () =>
    expect(checkPaymentIntent({ ...base, proposed: { ...base.proposed, amountMicro: usdcToMicro("31") } }).ok).toBe(false));
  it("blocks a second intent under a different key", () => {
    const first = { id: "PI", orderId: "O", recipient: "0xabc", amountMicro: 1, token: "USDC" as const, network: "n", idempotencyKey: "k0", state: "CONFIRMED" as const, label: "local" as const, createdAt: "" };
    expect(checkPaymentIntent({ ...base, existingIntents: [first] }).ok).toBe(false);
  });
});

describe("payment state machine", () => {
  it("only allows legal transitions", () => {
    expect(canTransition("ALLOCATED", "PAYMENT_INTENT_CREATED")).toBe(true);
    expect(canTransition("ALLOCATED", "CONFIRMED")).toBe(false);
    expect(canTransition("CONFIRMED", "SUBMITTED")).toBe(false);
    expect(canTransition("SUBMITTED", "UNKNOWN")).toBe(true);
  });
});
