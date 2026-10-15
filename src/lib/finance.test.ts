import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as store from "./store";
import { agreementHash } from "./agreement";
import { KESUNI_DEFAULTS, calculate } from "./costing";
import { agreedPrice, bucketOf, countsAsAgreed, escrowFlow, finance, journalLines, marginOf, potOf, rp, wib } from "./finance";
import type { ChainTx, Escrow, GramPricing, Order } from "./types";

const hash = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;
const tx = (kind: ChainTx["kind"], n: number, amountMicro: number, extra: Partial<ChainTx> = {}): ChainTx => ({
  kind, from: "0xa", to: "0xb", amountMicro, idempotencyKey: `k-${kind}-${n}`, state: "COMPLETE",
  txHash: hash(n), at: new Date(Date.UTC(2026, 9, 1, 0, n)).toISOString(), ...extra,
});
const escrow = (orderId: string, amountMicro: number, state: Escrow["state"], txs: ChainTx[], network = "ARC-TESTNET"): Escrow => ({
  orderId, amountMicro, escrowWalletId: "w", escrowAddress: "0xe", customerWalletId: "c", customerAddress: "0xc",
  state, txs, network, label: network === "ARC" ? "mainnet" : "testnet", createdAt: new Date().toISOString(),
});
/** A real order with its own chosen quote (own studio) at `priceMicro`. */
function realOrder(id: string, priceMicro: number, extra: Partial<Order> = {}): Order {
  const quoteId = `Q-${id}`;
  store.saveQuote({ id: quoteId, orderId: id, vendorId: "own", priceMicro, etaHours: 48, source: "own" });
  const o: Order = {
    ...store.getOrder("ORD-001")!, id, jobId: `JOB-${id}`, label: "real", status: "IN_PRODUCTION", chosenQuoteId: quoteId,
    createdAt: new Date(Date.UTC(2026, 9, Number(id.slice(-2)))).toISOString(), ...extra,
  };
  store.saveOrder(o);
  return o;
}
/** The customer approves the order as it is now (current agreement). */
function agree(id: string): Order {
  const o = store.getOrder(id)!;
  const q = store.getQuote(o.chosenQuoteId!)!;
  const agreed = { ...o, agreement: { version: 1, hash: agreementHash(o, q), quoteId: q.id, priceMicro: q.priceMicro, by: "customer", at: "x" } };
  store.saveOrder(agreed);
  return agreed;
}
const gram = (quoteId: string, totalIdr: number, costIdr: number): GramPricing => ({
  gramsPerUnit: 38.2, quantity: 1, pricePerGramIdr: 1500, costPerGramIdr: 750, unitPriceIdr: totalIdr, totalIdr, costIdr,
  source: "slicer", quoteId, by: "human", at: new Date().toISOString(),
});

beforeEach(() => store.resetDb());
afterEach(() => { delete process.env.CIRCLE_BLOCKCHAIN; delete process.env.IDR_PER_USDC; });

describe("finance totals", () => {
  it("counts only real orders; simulated money stays apart and is never added in", () => {
    realOrder("ORD-101", 10_000_000);
    agree("ORD-101");
    store.saveEscrow(escrow("ORD-101", 10_000_000, "FUNDED", [tx("customer_topup", 1, 10_000_000), tx("deposit", 2, 10_000_000)]));
    // The simulated seed order: chosen quote, deposited and released. Must not reach the real totals.
    store.saveOrder({ ...store.getOrder("ORD-001")!, chosenQuoteId: "Q-own", status: "PAID" });
    agree("ORD-001");
    store.saveEscrow(escrow("ORD-001", 30_000_000, "RELEASED", [tx("deposit", 3, 30_000_000), tx("release", 4, 30_000_000)]));

    const f = finance();
    expect(f.totals.held).toEqual({ testnet: 10_000_000, mainnet: 0, simulated: 0, simulatedMainnet: 0 });
    expect(f.totals.released).toEqual({ testnet: 0, mainnet: 0, simulated: 30_000_000, simulatedMainnet: 0 });
    expect(f.totals.heldOrders).toEqual({ testnet: 1, mainnet: 0, simulated: 0, simulatedMainnet: 0 });
    expect(f.totals.agreed.real.count).toBe(1);
    expect(f.totals.agreed.simulated.count).toBe(1);
    expect(f.totals.agreed.real.idr).toBe(165_000);    // 10 USDC × Rp16.500 (display rate)
    expect(f.totals.agreed.real.approx).toBe(true);    // converted, not a rupiah price
  });

  it("only COMPLETE transfers are money: pending and failed ones are not held, released or refunded", () => {
    realOrder("ORD-102", 5_000_000);
    store.saveEscrow(escrow("ORD-102", 5_000_000, "AWAITING_DEPOSIT", [
      tx("deposit", 1, 5_000_000, { state: "FAILED", txHash: undefined }),
      tx("deposit", 2, 5_000_000, { state: "SENT", txHash: undefined }),
    ]));
    const p = finance().positions.find((x) => x.orderId === "ORD-102")!;
    expect(p).toMatchObject({ depositedMicro: 0, heldMicro: 0, pending: 1, awaitingMicro: 5_000_000 });
    expect(finance().totals.held.testnet).toBe(0);
  });

  it("splits real money per escrow network: a testnet escrow stays test USDC after a mainnet switch", () => {
    process.env.CIRCLE_BLOCKCHAIN = "ARC";
    realOrder("ORD-103", 2_000_000);
    realOrder("ORD-104", 3_000_000);
    store.saveEscrow(escrow("ORD-103", 2_000_000, "RELEASED", [tx("deposit", 1, 2_000_000), tx("release", 2, 2_000_000)]));
    store.saveEscrow(escrow("ORD-104", 3_000_000, "REFUNDED", [tx("deposit", 3, 3_000_000), tx("refund", 4, 3_000_000)], "ARC"));
    const f = finance();
    expect(f.totals.released).toEqual({ testnet: 2_000_000, mainnet: 0, simulated: 0, simulatedMainnet: 0 });
    expect(f.totals.refunded).toEqual({ testnet: 0, mainnet: 3_000_000, simulated: 0, simulatedMainnet: 0 });
    expect(f.totals.held).toEqual({ testnet: 0, mainnet: 0, simulated: 0, simulatedMainnet: 0 });
    expect(f.transfers.find((t) => t.orderId === "ORD-104")!.explorerUrl).toMatch(/^https:\/\/explorer\.arc\.io\/tx\/0x/);
    expect(f.transfers.find((t) => t.orderId === "ORD-103")!.explorerUrl).toMatch(/^https:\/\/explorer\.testnet\.arc\.io\/tx\/0x/);
  });

  it("an escrow without its order is never real", () => {
    expect(bucketOf(undefined, escrow("X", 1, "FUNDED", []))).toBe("simulated");
    expect(bucketOf({ ...store.getOrder("ORD-001")!, label: "manual" })).toBe("simulated");
  });

  it("keeps a simulated order's mainnet USDC apart from simulated test USDC, in totals and journal", () => {
    process.env.CIRCLE_BLOCKCHAIN = "ARC";
    realOrder("ORD-114", 1_000_000, { label: "simulated" });
    realOrder("ORD-115", 2_000_000, { label: "simulated" });
    realOrder("ORD-116", 4_000_000, { label: "simulated" }); // no escrow yet: its price will lock on mainnet
    store.saveEscrow(escrow("ORD-114", 1_000_000, "FUNDED", [tx("deposit", 1, 1_000_000)]));
    store.saveEscrow(escrow("ORD-115", 2_000_000, "FUNDED", [tx("deposit", 2, 2_000_000)], "ARC"));
    expect(potOf(store.getOrder("ORD-115"), store.getEscrow("ORD-115"))).toBe("simulatedMainnet");
    const f = finance();
    expect(f.totals.held).toEqual({ testnet: 0, mainnet: 0, simulated: 1_000_000, simulatedMainnet: 2_000_000 });
    expect(f.ledger.balances.simulated.escrow_held).toBe(1_000_000);
    expect(f.ledger.balances.simulatedMainnet.escrow_held).toBe(2_000_000);
    const pos = (id: string) => f.positions.find((p) => p.orderId === id)!;
    expect([pos("ORD-114").testMoney, pos("ORD-115").testMoney, pos("ORD-116").testMoney]).toEqual([true, false, false]);
  });
});

describe("agreed order value", () => {
  it("counts only current customer agreements; chosen quotes apart; rejected orders never", () => {
    realOrder("ORD-201", 1_000_000, { status: "PLAN_CHOSEN" });   // quote chosen, never approved
    realOrder("ORD-202", 2_000_000, { status: "REJECTED" });      // approved, then the print was rejected
    agree("ORD-202");
    realOrder("ORD-203", 4_000_000, { status: "PLAN_CHOSEN" });   // approved, then changed: stale
    agree("ORD-203");
    store.saveOrder({ ...store.getOrder("ORD-203")!, quantity: 9 });
    realOrder("ORD-204", 8_000_000, { status: "PLAN_CHOSEN" });   // approved, still current
    agree("ORD-204");

    expect(["ORD-201", "ORD-202", "ORD-203", "ORD-204"].map((id) => countsAsAgreed(store.getOrder(id)!))).toEqual([false, false, false, true]);
    const { agreed, quoted } = finance().totals;
    expect(agreed.real).toEqual({ count: 1, idr: 132_000, approx: true });  // 8 USDC × Rp16.500
    expect(quoted.real).toEqual({ count: 2, idr: 82_500, approx: true });   // 1 + 4 USDC; the rejected one left out
  });
});

describe("agreed price", () => {
  it("keeps the rupiah set by weight exactly, and marks a converted price as approximate", () => {
    const o = realOrder("ORD-105", 3_480_000, { gramPricing: gram("Q-ORD-105", 57_500, 28_650) });
    const q = store.getQuote("Q-ORD-105")!;
    expect(agreedPrice(o, q, false)).toEqual({ basis: "quote", quoteId: "Q-ORD-105", micro: 3_480_000, idr: 57_500, idrExact: true });
    process.env.IDR_PER_USDC = "16000";
    expect(agreedPrice({ ...o, gramPricing: undefined }, q, false)).toMatchObject({ idr: 55_680, idrExact: false });
    expect(agreedPrice(o, undefined, false)).toBeUndefined();
  });

  it("says 'agreement' only while the customer's agreement still matches the order", () => {
    const o = realOrder("ORD-106", 4_000_000);
    const q = store.getQuote("Q-ORD-106")!;
    store.saveOrder({ ...o, agreement: { version: 1, hash: agreementHash(o, q), quoteId: q.id, priceMicro: q.priceMicro, by: "customer", at: "x" } });
    expect(finance().positions.find((p) => p.orderId === "ORD-106")!.price!.basis).toBe("agreement");
    store.saveOrder({ ...store.getOrder("ORD-106")!, quantity: 9 }); // changed after approval: needs a new one
    expect(finance().positions.find((p) => p.orderId === "ORD-106")!.price!.basis).toBe("quote");
  });

  it("margin comes from what production used when reported, else from the price rule", () => {
    const o = realOrder("ORD-107", 3_480_000, { gramPricing: gram("Q-ORD-107", 57_500, 28_650) });
    const price = agreedPrice(o, store.getQuote("Q-ORD-107"), false);
    expect(marginOf(o, price)).toEqual({ idr: 28_850, source: "price rule" });
    const actual = { filamentGrams: 40, machineHours: 2, costIdr: 31_000, maxDeviationMm: 0.1, unitsPassed: 1, note: "", by: "x", at: "x" };
    expect(marginOf({ ...o, actual }, price)).toEqual({ idr: 26_500, source: "actual" });
    expect(marginOf({ ...o, gramPricing: undefined }, price)).toBeUndefined();
  });

  it("calculator prices keep the payment fee out of the margin, before and after the actual cost (as /quality)", () => {
    const input = { ...KESUNI_DEFAULTS, quantity: 2, unitPriceIdr: 100_000, feePct: 10 };
    const o = realOrder("ORD-117", 12_120_000, { costing: { input, quoteId: "Q-ORD-117", at: "x" } });
    const price = agreedPrice(o, store.getQuote("Q-ORD-117"), false)!;
    expect(price).toMatchObject({ idr: 200_000, idrExact: true });
    expect(marginOf(o, price)).toEqual({ idr: calculate(input).profitIdr, source: "cost calculator" });
    const actual = { filamentGrams: 50, machineHours: 1, costIdr: 60_000, maxDeviationMm: 0.1, unitsPassed: 2, note: "", by: "x", at: "x" };
    expect(marginOf({ ...o, actual }, price)).toEqual({ idr: 120_000, source: "actual" }); // 200.000 − 20.000 fee − 60.000
  });
});

describe("journal", () => {
  it("books each completed deposit, release and refund as balanced double entry", () => {
    for (const kind of ["deposit", "release", "refund"] as const) {
      const lines = journalLines(kind, 1_234_567);
      expect(lines.reduce((a, l) => a + l.debitMicro, 0)).toBe(lines.reduce((a, l) => a + l.creditMicro, 0));
    }
    expect(journalLines("release", 5)).toEqual([
      { account: "kesuni_wallet", debitMicro: 5, creditMicro: 0 },
      { account: "escrow_held", debitMicro: 0, creditMicro: 5 },
      { account: "customer_funds", debitMicro: 5, creditMicro: 0 },
      { account: "revenue", debitMicro: 0, creditMicro: 5 },
    ]);
  });

  it("never books demo top-ups or unfinished transfers; account balances match the stat totals", () => {
    realOrder("ORD-108", 7_000_000);
    realOrder("ORD-109", 2_500_000);
    realOrder("ORD-110", 1_000_000);
    store.saveEscrow(escrow("ORD-108", 7_000_000, "RELEASED", [
      tx("customer_topup", 1, 7_000_000), tx("deposit", 2, 7_000_000), tx("release", 3, 7_000_000, { verified: { ok: true, at: "x" } }),
    ]));
    store.saveEscrow(escrow("ORD-109", 2_500_000, "FUNDED", [tx("deposit", 4, 2_500_000), tx("release", 5, 2_500_000, { state: "QUEUED", txHash: undefined })]));
    store.saveEscrow(escrow("ORD-110", 1_000_000, "REFUNDED", [tx("deposit", 6, 1_000_000), tx("refund", 7, 1_000_000)]));

    const f = finance();
    expect(f.transfers).toHaveLength(7);
    expect(f.transfers.filter((t) => t.internal).map((t) => t.kind)).toEqual(["customer_topup"]);
    expect(f.ledger.entries.map((e) => e.kind)).toEqual(["refund", "deposit", "deposit", "release", "deposit"]); // newest first
    expect(f.ledger.balanced).toBe(true);
    expect(f.ledger.debitMicro).toBe(f.ledger.creditMicro);
    const b = f.ledger.balances.testnet;
    expect(b.escrow_held).toBe(f.totals.held.testnet);
    expect(b.escrow_held).toBe(2_500_000);
    expect(b.customer_funds).toBe(2_500_000);
    expect(b.kesuni_wallet).toBe(f.totals.released.testnet);
    expect(b.revenue).toBe(7_000_000);
    expect(f.totals.refunded.testnet).toBe(1_000_000);
    expect(f.ledger.entries.find((e) => e.kind === "release")!.verified).toBe(true);
  });
});

describe("positions and display", () => {
  it("lists every order, newest first, with its escrow flow", () => {
    realOrder("ORD-111", 1_000_000, { createdAt: "2030-01-01T00:00:00.000Z" });
    realOrder("ORD-112", 1_000_000, { createdAt: "2030-01-02T00:00:00.000Z" });
    realOrder("ORD-113", 1_000_000, { createdAt: undefined }); // made before createdAt existed: last
    const ids = finance().positions.map((p) => p.orderId);
    expect(ids).toEqual(["ORD-112", "ORD-111", "ORD-001", "ORD-113"]);
    expect(escrowFlow(undefined)).toEqual({ depositedMicro: 0, releasedMicro: 0, refundedMicro: 0, heldMicro: 0, pending: 0 });
  });

  it("writes rupiah with dot thousands and times in WIB", () => {
    expect(rp(1650)).toBe("Rp1.650");
    expect(rp(1_000_000)).toBe("Rp1.000.000");
    expect(rp(-2500)).toBe("−Rp2.500");
    expect(wib("2026-10-13T10:11:34.593Z")).toBe("13 Oct, 17:11 WIB");
    expect(wib("2026-10-13T10:11:34.593Z", "id")).toBe("13 Okt, 17.11 WIB");
  });
});
