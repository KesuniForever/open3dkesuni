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
    expect(d.releasedMicro).toEqual({ real: 0, simulated: 30_000_000 });
    expect(d.activeSimulated).toBe(1);
    expect(d.activeReal).toBe(0);
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
