import { afterAll, beforeEach, describe, expect, it } from "vitest";
import * as store from "./store";
import { setCircleGateway } from "./circle";
import { addEvidence, chooseQuote, ensureCustomerToken } from "./actions";
import { customerCreateOrder, customerDecide, customerPay, customerView, orderForToken, refreshPayment } from "./customer";
import { DEMO, fakeCircle } from "./fake-circle.test-helper";
import { customerAgree } from "./agreement";
import { GET as view, POST as act } from "@/app/api/c/[token]/route";
import { POST as createViaInvite } from "@/app/api/c/route";

const SHOP = "0x1111111111111111111111111111111111111111";
const ORDER = "ORD-001";
let fake: ReturnType<typeof fakeCircle>;

beforeEach(() => {
  process.env.KESUNI_PAYOUT_ADDRESS = SHOP;
  process.env.KESUNI_DEMO_FUNDS_ADDRESS = DEMO;
  store.resetDb();
  fake = fakeCircle();
  setCircleGateway(fake.gw);
});
afterAll(() => {
  setCircleGateway(undefined);
  delete process.env.KESUNI_PAYOUT_ADDRESS;
  delete process.env.CUSTOMER_INVITE_CODE;
});

/** The customer presses "Bayar", then their page refreshes until the escrow is funded. */
async function pay() {
  expect(customerAgree(ORDER, "Aini").ok).toBe(true);
  expect((await customerPay(ORDER)).ok).toBe(true);
  for (let i = 0; i < 4; i++) await refreshPayment(ORDER);
  expect(store.getEscrow(ORDER)!.state).toBe("FUNDED");
}
const qc = () => {
  addEvidence(ORDER, { kind: "log", note: "printed", label: "device" });
  addEvidence(ORDER, { kind: "qc", note: "rapi", label: "manual" });
};

describe("customer link", () => {
  it("every order gets an unguessable link, and only that link finds it", () => {
    const token = ensureCustomerToken(ORDER)!;
    expect(token.length).toBeGreaterThanOrEqual(24);
    expect(ensureCustomerToken(ORDER)).toBe(token); // stable
    expect(orderForToken(token)!.id).toBe(ORDER);
    expect(orderForToken("x".repeat(24))).toBeUndefined();
    expect(orderForToken("' OR 1=1 --")).toBeUndefined();
  });

  it("the view hides wallet ids and vendor addresses", async () => {
    chooseQuote(ORDER, "Q-own", "agent", "within budget");
    customerAgree(ORDER, "Aini");
    await customerPay(ORDER);
    const json = JSON.stringify(customerView(store.getOrder(ORDER)!, ensureCustomerToken(ORDER)!));
    expect(json).not.toContain(SHOP);
    expect(json).not.toMatch(/walletId|0xaaaa/);
    expect(json).toContain("customer_topup");
  });
});

describe("customer pays, accepts, and the agent settles", () => {
  beforeEach(() => { chooseQuote(ORDER, "Q-own", "agent", "within budget"); });

  it("Bayar: test USDC first, then the deposit follows on its own", async () => {
    await pay();
    expect(store.getEscrow(ORDER)!.txs.map((t) => t.kind)).toEqual(["customer_topup", "deposit"]);
    // pressing again does nothing
    expect((await customerPay(ORDER)).ok).toBe(true);
    expect(store.getEscrow(ORDER)!.txs).toHaveLength(2);
  });

  it("cannot accept before paying", async () => {
    qc();
    expect((await customerDecide(ORDER, { accepted: true, by: "Aini", note: "" })).ok).toBe(false);
  });

  it("before QC there is nothing to accept", async () => {
    await pay();
    expect((await customerDecide(ORDER, { accepted: true, by: "Aini", note: "" })).ok).toBe(false);
  });

  it("Terima: the agent releases the escrow to Kesuni without asking anyone", async () => {
    await pay();
    qc();
    const r = await customerDecide(ORDER, { accepted: true, by: "Aini", note: "rapi" });
    expect(r.ok && r.settled).toBe(true);
    await refreshPayment(ORDER);
    expect(store.getEscrow(ORDER)!.state).toBe("RELEASED");
    expect(store.getOrder(ORDER)!.status).toBe("PAID");
    expect(fake.balances.get(SHOP)).toBe(30_000_000);
    const tools = store.listLog(ORDER).map((e) => `${e.actor}:${e.tool}`);
    expect(tools).toContain("human:customer_decision");
    expect(tools).toContain("agent:release_escrow");
  });

  it("Tolak: the agent refunds the customer", async () => {
    await pay();
    qc();
    const r = await customerDecide(ORDER, { accepted: false, by: "Aini", note: "retak" });
    expect(r.ok && r.settled).toBe(true);
    await refreshPayment(ORDER);
    expect(store.getEscrow(ORDER)!.state).toBe("REFUNDED");
    expect(fake.balances.get(SHOP) ?? 0).toBe(0);
  });
});

describe("ordering through the invite link", () => {
  it("creates a real order with the budget converted from rupiah", () => {
    process.env.IDR_PER_USDC = "16000";
    const r = customerCreateOrder({ name: "Aini", product: "Casing korek", quantity: 2, deadline: "2026-10-20", budgetIdr: 48_000, note: "hitam" });
    expect(r.ok && r.order).toMatchObject({ label: "real", customerName: "Aini", mandateMicro: 3_000_000, status: "CREATED" });
    delete process.env.IDR_PER_USDC;
  });

  it("the endpoint refuses a wrong or missing invite code", async () => {
    const req = (invite: string) => new Request("http://x/api/c", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ invite, name: "A", product: "B", quantity: 1, deadline: "2026-10-20", budgetIdr: 50000 }),
    });
    expect((await createViaInvite(req("anything"))).status).toBe(404); // no code configured
    process.env.CUSTOMER_INVITE_CODE = "kesuni-pilot-2026";
    expect((await createViaInvite(req("wrong"))).status).toBe(404);
    const ok = await createViaInvite(req("kesuni-pilot-2026"));
    expect(ok.status).toBe(201);
    expect((await ok.json()).link).toMatch(/^\/c\/[\w-]{24}$/);
  });

  it("the customer API answers 404 for an unknown token and pays for a known one", async () => {
    chooseQuote(ORDER, "Q-own", "agent", "within budget");
    const ctx = (token: string) => ({ params: Promise.resolve({ token }) });
    expect((await view(new Request("http://x"), ctx("nope-nope-nope-nope-nope"))).status).toBe(404);
    const token = ensureCustomerToken(ORDER)!;
    const post = (body: unknown) => new Request("http://x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    expect((await act(post({ action: "pay" }), ctx(token))).status).toBe(409); // not agreed yet
    expect((await act(post({ action: "pay", agree: true, by: "Aini" }), ctx(token))).status).toBe(200);
    expect((await act(post({ action: "release" }), ctx(token))).status).toBe(400); // operator actions are not here
  });
});
