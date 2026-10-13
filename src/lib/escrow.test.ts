import { afterAll, beforeEach, describe, expect, it } from "vitest";
import * as store from "./store";
import { setCircleGateway } from "./circle";
import { DEMO, fakeCircle } from "./fake-circle.test-helper";
import { addEvidence, chooseQuote, recordAcceptance } from "./actions";
import { deposit, openEscrow, refund, release, syncEscrow, topUpCustomer } from "./escrow";

const SHOP = "0x1111111111111111111111111111111111111111"; // KESUNI_PAYOUT_ADDRESS for the "own" vendor

let fake: ReturnType<typeof fakeCircle>;
beforeEach(() => {
  process.env.KESUNI_PAYOUT_ADDRESS = SHOP;
  store.resetDb();
  fake = fakeCircle();
  setCircleGateway(fake.gw);
  process.env.KESUNI_DEMO_FUNDS_ADDRESS = DEMO;
});
afterAll(() => {
  setCircleGateway(undefined);
  delete process.env.KESUNI_PAYOUT_ADDRESS;
});

const ORDER = "ORD-001";
async function fundedEscrow() {
  expect(chooseQuote(ORDER, "Q-own", "agent", "cheapest within budget").ok).toBe(true);
  expect((await openEscrow(ORDER)).ok).toBe(true);
  expect((await topUpCustomer(ORDER)).ok).toBe(true);
  await syncEscrow(ORDER);
  expect((await deposit(ORDER)).ok).toBe(true);
  const s = await syncEscrow(ORDER);
  expect(s.ok && s.escrow.state).toBe("FUNDED");
}
function produceAndQc() {
  addEvidence(ORDER, { kind: "log", note: "printed", label: "manual" });
  addEvidence(ORDER, { kind: "qc", note: "passed", label: "manual" });
}

describe("escrow", () => {
  it("cannot open before a plan is chosen (the amount comes from the quote)", async () => {
    const r = await openEscrow(ORDER);
    expect(r.ok).toBe(false);
  });

  it("locks exactly the quote price, then releases to the shop only after acceptance", async () => {
    await fundedEscrow();
    expect(store.getEscrow(ORDER)!.amountMicro).toBe(30_000_000);

    produceAndQc();
    const early = await release(ORDER);
    expect(early.ok).toBe(false);
    expect(!early.ok && early.reasons).toContain("Order has not been accepted by the customer");

    expect(recordAcceptance(ORDER, { accepted: true, by: "Aini", note: "sesuai" }).ok).toBe(true);
    const r = await release(ORDER);
    expect(r.ok).toBe(true);
    await syncEscrow(ORDER);

    expect(store.getEscrow(ORDER)!.state).toBe("RELEASED");
    expect(store.getOrder(ORDER)!.status).toBe("PAID");
    const intent = store.listIntents(ORDER)[0];
    expect(intent).toMatchObject({ state: "CONFIRMED", recipient: SHOP, amountMicro: 30_000_000, label: "testnet" });
    expect(fake.balances.get(SHOP)).toBe(30_000_000);
  });

  it("refuses to release to a placeholder payout address", async () => {
    delete process.env.KESUNI_PAYOUT_ADDRESS;
    store.resetDb(); // "own" vendor back to the seeded 0x000…0001
    await fundedEscrow();
    produceAndQc();
    recordAcceptance(ORDER, { accepted: true, by: "Aini", note: "ok" });
    const r = await release(ORDER);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reasons?.join(" ")).toMatch(/placeholder/);
  });

  it("never releases twice", async () => {
    await fundedEscrow();
    produceAndQc();
    recordAcceptance(ORDER, { accepted: true, by: "Aini", note: "ok" });
    expect((await release(ORDER)).ok).toBe(true);
    const again = await release(ORDER);
    expect(again.ok).toBe(false);
    await syncEscrow(ORDER);
    expect((await release(ORDER)).ok).toBe(false);
    expect(fake.balances.get(SHOP)).toBe(30_000_000);
  });

  it("refunds the customer after rejection, and then nothing can be released", async () => {
    await fundedEscrow();
    produceAndQc();
    const cantRefund = await refund(ORDER);
    expect(cantRefund.ok).toBe(false); // not rejected yet

    recordAcceptance(ORDER, { accepted: false, by: "Aini", note: "warna salah" });
    expect((await refund(ORDER)).ok).toBe(true);
    await syncEscrow(ORDER);
    const e = store.getEscrow(ORDER)!;
    expect(e.state).toBe("REFUNDED");
    expect(fake.balances.get(e.customerAddress)).toBe(30_000_000);
    expect((await release(ORDER)).ok).toBe(false);
  });

  it("retries a lost Circle call with the same idempotency key (no double payment)", async () => {
    await fundedEscrow();
    produceAndQc();
    recordAcceptance(ORDER, { accepted: true, by: "Aini", note: "ok" });
    const before = fake.calls.transfers;
    fake.failNext();
    expect((await release(ORDER)).ok).toBe(true);
    const tx = store.getEscrow(ORDER)!.txs.find((t) => t.kind === "release")!;
    expect(tx.state).toBe("NOT_SUBMITTED");

    await syncEscrow(ORDER); // resubmits with the saved key
    await syncEscrow(ORDER); // picks up COMPLETE
    expect(fake.calls.transfers).toBe(before + 1);
    expect(store.getEscrow(ORDER)!.state).toBe("RELEASED");
    expect(fake.balances.get(SHOP)).toBe(30_000_000);
  });

  it("refuses a deposit when the customer wallet is short", async () => {
    chooseQuote(ORDER, "Q-own", "agent", "ok");
    await openEscrow(ORDER);
    const r = await deposit(ORDER);
    expect(r.ok).toBe(false);
  });
});
