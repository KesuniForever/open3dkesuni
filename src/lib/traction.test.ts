import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as store from "./store";
import { COUNTING_RULE, traction } from "./traction";
import { GET } from "@/app/api/traction/route";
import type { ChainTx, Escrow, Order } from "./types";

const hash = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;
const tx = (kind: ChainTx["kind"], n: number, extra: Partial<ChainTx> = {}): ChainTx => ({
  kind, from: "0xa", to: "0xb", amountMicro: 10_000_000, idempotencyKey: `k-${kind}-${n}`, state: "COMPLETE",
  txHash: hash(n), at: new Date(Date.UTC(2026, 9, 1, 0, n)).toISOString(), ...extra,
});
const escrow = (orderId: string, txs: ChainTx[], network = "ARC-TESTNET"): Escrow => ({
  orderId, amountMicro: 10_000_000, escrowWalletId: "w", escrowAddress: "0xe", customerWalletId: "c", customerAddress: "0xc",
  state: "RELEASED", txs, network, label: network === "ARC" ? "mainnet" : "testnet", createdAt: new Date().toISOString(),
});
function realOrder(id: string, customerName: string | undefined, status: Order["status"]) {
  store.saveOrder({ ...store.getOrder("ORD-001")!, id, jobId: `JOB-${id}`, label: "real", status, customerName, customerToken: `tok-${id}-xxxxxxxxxxxxxxxx` });
}

beforeEach(() => store.resetDb());
afterEach(() => { delete process.env.CIRCLE_BLOCKCHAIN; });

describe("traction (real usage)", () => {
  it("counts only real orders' deposit/release/refund that are COMPLETE with a hash; never demo top-ups or simulated orders", () => {
    realOrder("ORD-101", "Aini", "PAID");
    realOrder("ORD-102", " aini ", "IN_PRODUCTION"); // the same customer again
    realOrder("ORD-103", "Budi", "REJECTED");
    realOrder("ORD-104", undefined, "CREATED");
    store.saveEscrow(escrow("ORD-101", [
      tx("customer_topup", 1),                                    // internal: test USDC from the demo-funds wallet
      tx("deposit", 2, { verified: { ok: true, at: "x", logId: "5042002:0x:1" } }),
      tx("release", 3, { verified: { ok: false, at: "x", reason: "no match" } }),
    ]));
    store.saveEscrow(escrow("ORD-102", [tx("deposit", 4, { state: "SENT" })])); // not COMPLETE yet
    store.saveEscrow(escrow("ORD-103", [tx("deposit", 5), tx("refund", 6), tx("refund", 7, { txHash: undefined })]));
    // the simulated seed order with complete transfers: never counted
    store.saveEscrow(escrow("ORD-001", [tx("deposit", 8), tx("release", 9)]));

    const t = traction();
    expect(t.rule).toBe(COUNTING_RULE);
    expect(t.rule).toBe("Simulated orders, demo top-ups and internal transfers are not counted.");
    expect(t.realOrders).toBe(4);
    expect(t.realCustomers).toBe(3); // Aini (twice), Budi, one order without a name
    expect(t.realOrdersByStatus).toMatchObject({ PAID: 1, IN_PRODUCTION: 1, REJECTED: 1, CREATED: 1, ACCEPTED: 0 });
    expect(t.arcTxs.count).toBe(4);
    expect(t.arcTxs.byKind).toEqual({ deposit: 2, release: 1, refund: 1 });
    expect(t.arcTxs.verifiedOnArc).toBe(1);
    expect(t.arcTxs.mismatchOnArc).toBe(1);
    expect(t.arcTxs.notCheckedYet).toBe(2);
    expect(t.arcTxs.volume.testnet).toEqual({ micro: 40_000_000, usdc: "40" });
    expect(t.arcTxs.volume.mainnet.micro).toBe(0);
    expect(t.excluded).toEqual({ simulatedOrders: 1, demoTopups: 1 });
    // newest first, with explorer links
    expect(t.arcTxs.last.map((x) => x.txHash)).toEqual([hash(6), hash(5), hash(3), hash(2)]);
    expect(t.arcTxs.last[0].explorerUrl).toBe(`https://explorer.testnet.arc.io/tx/${hash(6)}`);
    expect(t.arcTxs.last.map((x) => x.verifiedOnArc)).toEqual([null, null, false, true]);
  });

  it("labels volume by each escrow's own network and keeps the last 10", () => {
    process.env.CIRCLE_BLOCKCHAIN = "ARC";
    realOrder("ORD-201", "Citra", "PAID");
    realOrder("ORD-202", "Dewi", "PAID");
    store.saveEscrow(escrow("ORD-201", Array.from({ length: 12 }, (_, i) => tx("deposit", 20 + i))));
    store.saveEscrow(escrow("ORD-202", [tx("release", 50, { amountMicro: 2_500_000 })], "ARC"));
    const t = traction();
    expect(t.arcTxs.count).toBe(13);
    expect(t.arcTxs.last).toHaveLength(10);
    expect(t.arcTxs.volume.testnet.micro).toBe(120_000_000);
    expect(t.arcTxs.volume.mainnet).toEqual({ micro: 2_500_000, usdc: "2.5" });
    expect(t.arcTxs.last[0]).toMatchObject({ orderId: "ORD-202", networkLabel: "mainnet", network: "ARC" });
    expect(t.arcTxs.last[1]).toMatchObject({ networkLabel: "testnet", explorerUrl: `https://explorer.testnet.arc.io/tx/${hash(31)}` });
  });

  it("GET /api/traction returns the same numbers without customer names or link tokens", async () => {
    realOrder("ORD-301", "Aini Rahmawati", "PAID");
    store.saveEscrow(escrow("ORD-301", [tx("deposit", 1), tx("release", 2)]));
    const res = GET();
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(JSON.parse(text)).toMatchObject({ realCustomers: 1, realOrders: 1, arcTxs: { count: 2 } });
    expect(text).not.toMatch(/Aini|tok-ORD/);
  });
});
