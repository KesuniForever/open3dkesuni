import { describe, expect, it } from "vitest";
import type { CustomerView } from "@/lib/customer";
import { orderLinkFrom, orderStatus } from "./order-status";

// "My orders": one short status per order, read the same way as the order page's headline.
type V = Parameters<typeof orderStatus>[0];
const view = (status: CustomerView["order"]["status"], over: Partial<V> = {}): V => ({
  order: { id: "ORD-020", product: "Casing", quantity: 1, deadline: "2026-10-20", status, label: "real" },
  escrow: null, paying: false, printing: null, printedOn: null, ...over,
});
const escrow = (state: NonNullable<V["escrow"]>["state"]): V["escrow"] => ({ state, amountUsdc: "3.5", network: "ARC-TESTNET", label: "testnet", txs: [] });
const printing = (state: string, percent = 45.6): V["printing"] => ({ printer: "A1 Combo #1", state, percent, remainingMin: 30, online: true });

describe("order status in My orders", () => {
  it("follows the order from price to done", () => {
    const stage = (v: V) => orderStatus(v).stage;
    expect(stage(view("CREATED"))).toBe("preparing");
    expect(stage(view("CREATED", { design: { state: "weighing" } }))).toBe("weighing");
    expect(stage(view("CREATED", { design: { state: "weighed", gramsPerPiece: 16 } }))).toBe("preparing");
    expect(stage(view("CREATED", { design: { state: "check" } }))).toBe("preparing");
    expect(stage(view("PLAN_CHOSEN"))).toBe("price");
    expect(stage(view("PLAN_CHOSEN", { escrow: escrow("AWAITING_DEPOSIT") }))).toBe("price");
    expect(stage(view("PLAN_CHOSEN", { escrow: escrow("AWAITING_DEPOSIT"), paying: true }))).toBe("paying");
    expect(stage(view("PLAN_CHOSEN", { escrow: escrow("FUNDED") }))).toBe("waiting");
    expect(stage(view("IN_PRODUCTION", { escrow: escrow("FUNDED"), printing: printing("PREPARE") }))).toBe("printing");
    expect(stage(view("IN_PRODUCTION", { escrow: escrow("FUNDED"), printing: printing("PAUSE") }))).toBe("paused");
    expect(stage(view("IN_PRODUCTION", { escrow: escrow("FUNDED"), printedOn: "A1 Combo #1" }))).toBe("checking");
    expect(stage(view("EVIDENCE_SUBMITTED", { escrow: escrow("FUNDED") }))).toBe("check");
    expect(stage(view("ACCEPTED", { escrow: escrow("FUNDED") }))).toBe("done");
    expect(stage(view("PAID", { escrow: escrow("RELEASED") }))).toBe("done");
    expect(stage(view("REJECTED", { escrow: escrow("FUNDED") }))).toBe("refunding");
    expect(stage(view("REJECTED", { escrow: escrow("REFUNDED") }))).toBe("refunded");
  });

  it("an unpaid order is waiting for payment before anything else, as on the order page", () => {
    expect(orderStatus(view("EVIDENCE_SUBMITTED"))).toMatchObject({ stage: "price", yourTurn: true });
  });

  it("gives the words, the colour, the percent while printing, and when it is the customer's turn", () => {
    expect(orderStatus(view("CREATED"))).toEqual({ stage: "preparing", text: "Preparing your price", tone: "", yourTurn: false, percent: null });
    expect(orderStatus(view("PLAN_CHOSEN"))).toEqual({ stage: "price", text: "Price ready", tone: "warn", yourTurn: true, percent: null });
    expect(orderStatus(view("IN_PRODUCTION", { escrow: escrow("FUNDED"), printing: printing("RUNNING") })))
      .toEqual({ stage: "printing", text: "Printing {pct}", tone: "testnet", yourTurn: false, percent: 46 });
    expect(orderStatus(view("EVIDENCE_SUBMITTED", { escrow: escrow("FUNDED") }))).toMatchObject({ text: "Ready to check", tone: "warn", yourTurn: true });
    expect(orderStatus(view("PAID", { escrow: escrow("RELEASED") }))).toMatchObject({ text: "Done", tone: "ok", yourTurn: false });
    expect(orderStatus(view("REJECTED", { escrow: escrow("REFUNDED") }))).toMatchObject({ text: "Refunded", tone: "", yourTurn: false });
    // A finished print still marked running reads 100%, never more.
    expect(orderStatus(view("IN_PRODUCTION", { escrow: escrow("FUNDED"), printing: printing("RUNNING", 100.4) })).percent).toBe(100);
  });
});

describe("order link from pasted text", () => {
  const token = "AbC123_-xyz456789";
  it("finds /c/<token> in a whole address, a path, or a WhatsApp message", () => {
    expect(orderLinkFrom(`https://kesuni.example/c/${token}`)).toBe(`/c/${token}`);
    expect(orderLinkFrom(`https://kesuni.example/c/${token}?new=1`)).toBe(`/c/${token}`);
    expect(orderLinkFrom(`/c/${token}/`)).toBe(`/c/${token}`);
    expect(orderLinkFrom(`  c/${token}  `)).toBe(`/c/${token}`);
    expect(orderLinkFrom(`Your order: https://kesuni.example/c/${token} thanks`)).toBe(`/c/${token}`);
  });

  it("finds nothing in other links or a short code", () => {
    expect(orderLinkFrom("")).toBeNull();
    expect(orderLinkFrom(token)).toBeNull();
    expect(orderLinkFrom("https://kesuni.example/c/short")).toBeNull();
    expect(orderLinkFrom(`https://kesuni.example/request/${token}`)).toBeNull();
    expect(orderLinkFrom(`https://kesuni.example/abc/${token}`)).toBeNull();
    expect(orderLinkFrom(`https://kesuni.example/c/${token}.html`)).toBeNull();
  });
});
