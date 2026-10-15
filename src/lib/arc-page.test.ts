import { describe, expect, it } from "vitest";
import {
  explorerAddressBase, explorerHome, knownWallets, orderTag, rpcHost, shortAddress, transferCounts, transferRows,
} from "./arc-page";
import type { ChainTx, Escrow, Order } from "./types";

const addr = (c: string) => `0x${c.repeat(40)}`;
const DEMO = addr("d");
const PAYOUT = "0xE4E40000000000000000000000000000000AE302";
const hash = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;
const tx = (kind: ChainTx["kind"], n: number, from: string, to: string, extra: Partial<ChainTx> = {}): ChainTx => ({
  kind, from, to, amountMicro: 100_000, idempotencyKey: `k-${n}`, state: "COMPLETE", txHash: hash(n),
  at: new Date(Date.UTC(2026, 9, 13, 10, n)).toISOString(), ...extra,
});
const escrow = (orderId: string, esc: string, cust: string, txs: ChainTx[], extra: Partial<Escrow> = {}): Escrow => ({
  orderId, amountMicro: 100_000, escrowWalletId: `w-${orderId}`, escrowAddress: esc, customerWalletId: `c-${orderId}`,
  customerAddress: cust, state: "RELEASED", txs, network: "ARC-TESTNET", label: "testnet", createdAt: "2026-10-13T00:00:00Z", ...extra,
});
const order = (id: string, label: Order["label"]) => ({ id, label }) as Order;
const TESTNET = { blockchain: "ARC-TESTNET", label: "testnet" as const };

describe("arc page: transfers", () => {
  const escrows = [
    escrow("ORD-003", addr("e"), addr("c"), [
      tx("customer_topup", 1, DEMO, addr("c"), { verified: { ok: true, at: "x", internal: true } }),
      tx("deposit", 2, addr("c"), addr("e"), { verified: { ok: true, at: "x", logId: "5042002:0x:1" } }),
      tx("release", 3, addr("e"), PAYOUT, { verified: { ok: false, at: "x", reason: "amount differs" } }),
    ]),
    escrow("ORD-004", addr("f"), addr("a"), [
      tx("deposit", 4, addr("a"), addr("f")),                       // complete, not checked yet
      tx("refund", 5, addr("f"), addr("a"), { state: "SENT", txHash: undefined }), // not complete: not "unchecked"
    ], { state: "FUNDED" }),
  ];

  it("lists every transfer with its escrow and order", () => {
    const rows = transferRows(escrows, (id) => (id === "ORD-003" ? order(id, "simulated") : undefined));
    expect(rows.map((r) => r.tx.idempotencyKey)).toEqual(["k-1", "k-2", "k-3", "k-4", "k-5"]);
    expect(rows[0].order?.label).toBe("simulated");
    expect(rows[3].order).toBeUndefined();
  });

  it("counts deposits, releases and refunds only; test top-ups are internal; real and simulated apart", () => {
    const c = transferCounts(transferRows(escrows, (id) => order(id, id === "ORD-004" ? "real" : "simulated")));
    expect(c).toEqual({ transfers: 4, verified: 1, mismatch: 1, unchecked: 1, internal: 1, onReal: 2, onSimulated: 2 });
  });

  it("tags a missing (removed) order apart, and counts its transfers as simulated, never real", () => {
    expect([orderTag(order("ORD-1", "real")), orderTag(order("ORD-2", "simulated")), orderTag(undefined)])
      .toEqual(["real", "simulated", "removed"]);
    const c = transferCounts(transferRows(escrows, (id) => (id === "ORD-004" ? order(id, "real") : undefined)));
    expect(c).toMatchObject({ transfers: 4, onReal: 2, onSimulated: 2 });
  });

  it("counts nothing without escrows", () => {
    expect(transferCounts([])).toEqual({ transfers: 0, verified: 0, mismatch: 0, unchecked: 0, internal: 0, onReal: 0, onSimulated: 0 });
  });
});

describe("arc page: wallets", () => {
  it("lists each address once with its main role, orders and transfers; payout and demo funds first", () => {
    const escrows = [
      escrow("ORD-003", addr("e"), addr("c"), [
        tx("customer_topup", 1, DEMO, addr("c")),
        tx("deposit", 2, addr("c"), addr("e")),
        tx("release", 3, addr("e"), PAYOUT.toLowerCase()), // same payout address, other case
      ]),
      escrow("ORD-004", addr("f"), addr("c"), [], { state: "AWAITING_DEPOSIT" }), // same customer wallet again
    ];
    const w = knownWallets(escrows, {
      payoutAddress: PAYOUT, network: TESTNET, orderOf: (id) => order(id, id === "ORD-003" ? "simulated" : "real"),
    });
    expect(w.map((x) => [x.role, x.address])).toEqual([
      ["kesuni_payout", PAYOUT],
      ["demo_funds", DEMO],
      ["escrow", addr("e")],
      ["customer", addr("c")],
      ["escrow", addr("f")],
    ]);
    const payout = w[0];
    expect(payout.roles).toEqual(["kesuni_payout", "shop_payout"]);
    expect(payout.transfers).toBe(1);
    expect(payout.label).toBe("testnet");
    const customer = w[3];
    expect(customer.orders).toEqual([{ id: "ORD-003", tag: "simulated" }, { id: "ORD-004", tag: "real" }]);
    expect(customer.transfers).toBe(2); // top-up in, deposit out
    expect(customer.lastAt).toBe(new Date(Date.UTC(2026, 9, 13, 10, 2)).toISOString());
    expect(w[2].escrowState).toBe("RELEASED");
    expect(w[4]).toMatchObject({ escrowState: "AWAITING_DEPOSIT", transfers: 0, lastAt: undefined });
  });

  it("tags the orders of a wallet as removed when the order is gone; untagged without orderOf", () => {
    const escrows = [escrow("ORD-004", addr("e"), addr("c"), [])];
    const removed = knownWallets(escrows, { network: TESTNET, orderOf: () => undefined });
    expect(removed.map((w) => w.orders)).toEqual([[{ id: "ORD-004", tag: "removed" }], [{ id: "ORD-004", tag: "removed" }]]);
    expect(knownWallets(escrows, { network: TESTNET })[0].orders).toEqual([{ id: "ORD-004", tag: undefined }]);
  });

  it("leaves out placeholder and malformed addresses", () => {
    const w = knownWallets([escrow("ORD-001", "0x", "0x0000000000000000000000000000000000000002", [])], {
      payoutAddress: "0x0000000000000000000000000000000000000001", network: TESTNET,
    });
    expect(w).toEqual([]);
  });

  it("shows the payout address on the current network when there are no escrows", () => {
    const w = knownWallets([], { payoutAddress: PAYOUT, network: { blockchain: "ARC", label: "mainnet" } });
    expect(w).toEqual([{ address: PAYOUT, role: "kesuni_payout", roles: ["kesuni_payout"], orders: [], network: "ARC", label: "mainnet",
      transfers: 0, lastAt: undefined, escrowState: undefined }]);
  });
});

describe("arc page: formatting", () => {
  it("shortens addresses like 0xE4E4…E302", () => {
    expect(shortAddress(PAYOUT)).toBe("0xE4E4…E302");
    expect(shortAddress("0x12")).toBe("0x12");
  });

  it("shows only the RPC host, never a path, key or user info", () => {
    expect(rpcHost("https://rpc.testnet.arc.io")).toBe("rpc.testnet.arc.io");
    expect(rpcHost("https://user:secret@arc.example.com:8545/v2/API_KEY?token=abc")).toBe("arc.example.com");
    expect(rpcHost("not a url")).toBeNull();
  });

  it("builds explorer address links from the tx base", () => {
    expect(explorerAddressBase("https://explorer.testnet.arc.io/tx/")).toBe("https://explorer.testnet.arc.io/address/");
    expect(explorerAddressBase("https://scan.example/transaction/")).toBeNull();
    expect(explorerHome("https://explorer.testnet.arc.io/tx/")).toBe("https://explorer.testnet.arc.io");
    expect(explorerHome("nope")).toBeNull();
  });
});
