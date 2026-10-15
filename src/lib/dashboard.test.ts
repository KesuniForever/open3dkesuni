import { beforeEach, describe, expect, it } from "vitest";
import * as store from "./store";
import { dashboard } from "./dashboard";

beforeEach(() => store.resetDb());

describe("dashboard", () => {
  it("never adds simulated money to real money", () => {
    store.saveEscrow({
      orderId: "ORD-001", amountMicro: 30_000_000, escrowWalletId: "w", escrowAddress: "0x", customerWalletId: "c",
      customerAddress: "0x", state: "RELEASED", txs: [], network: "ARC-TESTNET", label: "testnet", createdAt: new Date().toISOString(),
    });
    const d = dashboard();
    expect(d.releasedMicro).toEqual({ testnet: 0, mainnet: 0, simulated: 30_000_000 });
    expect(d.activeSimulated).toBe(1);
    expect(d.activeReal).toBe(0);
  });

  it("counts real money by each escrow's own network: a testnet escrow stays test USDC after a mainnet switch", () => {
    process.env.CIRCLE_BLOCKCHAIN = "ARC";
    const base = { ...store.getOrder("ORD-001")!, label: "real" as const, status: "IN_PRODUCTION" as const };
    store.saveOrder({ ...base, id: "ORD-002", jobId: "JOB-002" });
    store.saveOrder({ ...base, id: "ORD-003", jobId: "JOB-003" });
    const escrow = (orderId: string, network: string, label: "testnet" | "mainnet", amountMicro: number) => store.saveEscrow({
      orderId, amountMicro, escrowWalletId: "w", escrowAddress: "0x", customerWalletId: "c", customerAddress: "0x",
      state: "FUNDED", txs: [], network, label, createdAt: new Date().toISOString(),
    });
    escrow("ORD-002", "ARC-TESTNET", "testnet", 72_730_000);
    escrow("ORD-003", "ARC", "mainnet", 10_000_000);
    expect(dashboard().escrowHeldMicro).toEqual({ testnet: 72_730_000, mainnet: 10_000_000, simulated: 0 });
    delete process.env.CIRCLE_BLOCKCHAIN;
  });

  it("lists what needs a person, open tasks first", () => {
    store.saveTask({ id: "T-1", orderId: "ORD-001", kind: "collect_and_qc", text: "Ambil barang + QC", status: "open", createdBy: "agent", at: new Date().toISOString() });
    const d = dashboard();
    expect(d.attention[0]).toMatchObject({ kind: "task", text: "Ambil barang + QC" });
    expect(d.attention.some((a) => a.kind === "price")).toBe(true);
  });
});

describe("dashboard tasks", () => {
  beforeEach(() => store.resetDb());
  it("shows a repeated reminder once, with a count", () => {
    for (let i = 1; i <= 3; i++) {
      store.saveTask({ id: `T-${i}`, orderId: "ORD-001", kind: "check_printer", text: "Printer offline", status: "open", createdBy: "agent", at: new Date().toISOString() });
    }
    const tasks = dashboard().attention.filter((a) => a.kind === "task");
    expect(tasks).toHaveLength(1);
    expect(tasks[0].text).toBe("Printer offline (×3)");
  });
});

describe("dashboard: printer faults", () => {
  beforeEach(() => store.resetDb());
  it("puts printer faults first, loud, linked to the machines page when no order is linked", () => {
    store.savePrinter({ id: "a1-3", name: "A1 Combo #3" });
    store.saveTask({ id: "T-1", orderId: "ORD-001", kind: "collect_and_qc", text: "Collect and QC", status: "open", createdBy: "agent", at: new Date().toISOString() });
    store.saveTask({
      id: "T-2", orderId: "printer:a1-3", printerId: "a1-3", kind: "check_printer", errorCode: "HMS_0510_0400_0001_0044",
      text: "A1 Combo #3 reports HMS_0510_0400_0001_0044 (fatal): ...", status: "open", createdBy: "agent", at: new Date().toISOString(),
    });
    const [first, second] = dashboard().attention;
    expect(first).toMatchObject({ kind: "printer", product: "A1 Combo #3", href: "/machines", printerId: "a1-3" });
    expect(second).toMatchObject({ kind: "task", orderId: "ORD-001" });
    expect(second.href).toBeUndefined();
  });

  it("a fault on a printer linked to an order links to that order", () => {
    store.saveTask({
      id: "T-3", orderId: "ORD-001", printerId: "a1", kind: "check_printer", errorCode: "0500-400A", text: "A1 Combo #1 reports error 0500-400A",
      status: "open", createdBy: "agent", at: new Date().toISOString(),
    });
    expect(dashboard().attention[0]).toMatchObject({ kind: "printer", orderId: "ORD-001", product: store.getOrder("ORD-001")!.product });
    expect(dashboard().attention[0].href).toBeUndefined();
  });
});
