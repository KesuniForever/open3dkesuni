import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as store from "./store";
import { setCircleGateway } from "./circle";
import { addEvidence, chooseQuote, ensureCustomerToken } from "./actions";
import { customerCreateOrder, customerDecide, customerPay, customerView, orderForToken, refreshPayment } from "./customer";
import { DEMO, fakeCircle } from "./fake-circle.test-helper";
import { customerAgree } from "./agreement";
import { GET as view, POST as act } from "@/app/api/c/[token]/route";
import { POST as createViaInvite } from "@/app/api/c/route";
import { clientIp } from "./http";

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
    expect((await customerDecide(ORDER, { accepted: true, by: "Aini", note: "", checked: true })).ok).toBe(false);
  });

  it("before QC there is nothing to accept", async () => {
    await pay();
    expect((await customerDecide(ORDER, { accepted: true, by: "Aini", note: "", checked: true })).ok).toBe(false);
  });

  it("Terima: the agent releases the escrow to Kesuni without asking anyone", async () => {
    await pay();
    qc();
    const r = await customerDecide(ORDER, { accepted: true, by: "Aini", note: "rapi", checked: true });
    expect(r.ok && r.settled).toBe(true);
    await refreshPayment(ORDER);
    expect(store.getEscrow(ORDER)!.state).toBe("RELEASED");
    expect(store.getOrder(ORDER)!.status).toBe("PAID");
    expect(fake.balances.get(SHOP)).toBe(30_000_000);
    const tools = store.listLog(ORDER).map((e) => `${e.actor}:${e.tool}`);
    expect(tools).toContain("human:customer_decision");
    expect(tools).toContain("agent:release_escrow");
  });

  it("Terima needs the 'I checked the goods' tick; Tolak does not", async () => {
    await pay();
    qc();
    const r = await customerDecide(ORDER, { accepted: true, by: "Aini", note: "" });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.status).toBe(400);
    expect(!r.ok && r.error).toMatch(/First tick the box/);
    expect(store.getOrder(ORDER)!.status).toBe("EVIDENCE_SUBMITTED"); // nothing recorded, no money moved
    expect(store.getEscrow(ORDER)!.state).toBe("FUNDED");
    expect(store.getAcceptance(ORDER)).toBeUndefined();
    // over the API: checked must be exactly true
    const token = ensureCustomerToken(ORDER)!;
    const ctx = { params: Promise.resolve({ token }) };
    const post = (body: unknown) => new Request("http://x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    expect((await act(post({ action: "accept", by: "Aini", note: "", checked: "yes" }), ctx)).status).toBe(400);
    const ok = await act(post({ action: "accept", by: "Aini", note: "", checked: true }), ctx);
    expect(ok.status).toBe(200);
    expect(store.getOrder(ORDER)!.status).toBe("ACCEPTED");
    expect(store.listLog(ORDER).find((e) => e.tool === "customer_decision")!.input).toEqual({ accepted: true, checked: true });
  });

  it("above the agreed tolerance: the page warns, accepting is still allowed, recorded, and released by the policy", async () => {
    await pay();
    qc();
    const o = store.getOrder(ORDER)!;
    store.saveOrder({
      ...o,
      spec: { dimensions: "40 × 25 × 10 mm", toleranceMm: 0.3, material: "PLA", color: "hitam", layerMm: 0.2, infillPct: 15, finishing: "Standar", promise: "diukur jangka sorong" },
      actual: { filamentGrams: 20, machineHours: 1, costIdr: 30000, maxDeviationMm: 0.6, unitsPassed: 1, note: "", by: "op", at: new Date().toISOString() },
    });
    const token = ensureCustomerToken(ORDER)!;
    expect(customerView(store.getOrder(ORDER)!, token).overTolerance).toBe(true);
    const r = await customerDecide(ORDER, { accepted: true, by: "Aini", note: "tidak apa-apa", checked: true });
    expect(r.ok && r.settled).toBe(true);
    expect(store.getAcceptance(ORDER)!.note).toBe("tidak apa-apa [Accepted although the size deviation of 0.6 mm exceeds the ±0.3 mm limit]");
    expect(store.listLog(ORDER).find((e) => e.tool === "customer_decision")!.input)
      .toEqual({ accepted: true, checked: true, acceptedOverTolerance: { maxDeviationMm: 0.6, toleranceMm: 0.3 } });
    await refreshPayment(ORDER);
    expect(store.getEscrow(ORDER)!.state).toBe("RELEASED");
  });

  it("within tolerance (or not measured) there is no warning", async () => {
    const o = store.getOrder(ORDER)!;
    expect(customerView(o, ensureCustomerToken(ORDER)!).overTolerance).toBe(false);
    store.saveOrder({
      ...o,
      spec: { dimensions: "x", toleranceMm: 0.3, material: "PLA", color: "", layerMm: 0.2, infillPct: 15, finishing: "", promise: "" },
      actual: { filamentGrams: 20, machineHours: 1, costIdr: 1, maxDeviationMm: 0.3, unitsPassed: 1, note: "", by: "op", at: new Date().toISOString() },
    });
    expect(customerView(store.getOrder(ORDER)!, ensureCustomerToken(ORDER)!).overTolerance).toBe(false);
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

  it("limits orders per network address per hour, and refuses a very long product name", async () => {
    process.env.CUSTOMER_INVITE_CODE = "kesuni-pilot-2026";
    const req = (ip: string, product = "Casing") => new Request("http://x/api/c", {
      method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip },
      body: JSON.stringify({ invite: "kesuni-pilot-2026", name: "A", product, quantity: 1, deadline: "2026-10-20", budgetIdr: 50000 }),
    });
    expect((await createViaInvite(req("203.0.113.9", "x".repeat(201)))).status).toBe(400);
    for (let i = 0; i < 5; i++) expect((await createViaInvite(req("203.0.113.9"))).status).toBe(201);
    const sixth = await createViaInvite(req("203.0.113.9"));
    expect(sixth.status).toBe(429);
    expect((await sixth.json()).error).toMatch(/Too many orders/);
    expect((await createViaInvite(req("198.51.100.7"))).status).toBe(201);
  });

  it("reads the address from the header the host writes: X-Real-IP on Railway, CF-Connecting-IP behind the tunnel", () => {
    const r = new Request("http://x", { headers: { "cf-connecting-ip": "10.9.9.9", "x-real-ip": "203.0.113.5", "x-forwarded-for": "10.1.1.1, 203.0.113.5" } });
    expect(clientIp(r, true)).toBe("203.0.113.5");
    expect(clientIp(r, false)).toBe("10.9.9.9");
    expect(clientIp(new Request("http://x", { headers: { "x-forwarded-for": "10.1.1.1, 203.0.113.6" } }), true)).toBe("203.0.113.6");
  });

  it("on Railway a made-up CF-Connecting-IP does not reset the limit, and all addresses together are capped", async () => {
    process.env.CUSTOMER_INVITE_CODE = "kesuni-pilot-2026";
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + 2 * 3_600_000 }); // the earlier tests' orders are over an hour old
    const req = (headers: Record<string, string>) => new Request("http://x/api/c", {
      method: "POST", headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({ invite: "kesuni-pilot-2026", name: "A", product: "Casing", quantity: 1, deadline: "2026-10-20", budgetIdr: 50000 }),
    });
    try {
      process.env.RAILWAY_ENVIRONMENT_ID = "test";
      for (let i = 0; i < 5; i++) expect((await createViaInvite(req({ "x-real-ip": "203.0.113.50", "cf-connecting-ip": `10.0.0.${i}` }))).status).toBe(201);
      expect((await createViaInvite(req({ "x-real-ip": "203.0.113.50", "cf-connecting-ip": "10.0.0.99" }))).status).toBe(429);
      delete process.env.RAILWAY_ENVIRONMENT_ID;
      for (let i = 0; i < 15; i++) expect((await createViaInvite(req({ "x-forwarded-for": `198.51.100.${i + 10}` }))).status).toBe(201);
      expect((await createViaInvite(req({ "x-forwarded-for": "198.51.100.200" }))).status).toBe(429); // 20 orders this hour
    } finally {
      delete process.env.RAILWAY_ENVIRONMENT_ID;
      vi.useRealTimers();
    }
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
