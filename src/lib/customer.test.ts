import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as store from "./store";
import { setCircleGateway } from "./circle";
import { addEvidence, chooseQuote, ensureCustomerToken } from "./actions";
import {
  customerCreateOrder, customerDecide, customerPay, customerSetColors, customerView, orderForToken, readColorChoice, refreshPayment,
} from "./customer";
import { studioPalette } from "./colors";
import { emptySnapshot, type AmsTray } from "./printer/bambu";
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

describe("material and colours the customer picks", () => {
  const NOW = new Date().toISOString();
  const tray = (slot: number, type: string | null, color: string | null, bambu = false): AmsTray => ({
    ams: 0, slot, empty: !type, type, subBrand: bambu ? `${type} Basic` : null, infoIdx: null, color, colors: color ? [color] : [], remainPct: null, bambu,
  });
  const ams = (trays: AmsTray[]) => ({ trays, activeSlot: null, externalActive: false, humidity: null, lite: true });
  // Printers #1 and #3 as the read-only probe saw them on 15 Oct 2026.
  const studio = () => {
    store.savePrinter({ id: "a1", name: "A1 Combo #1", lastSeen: NOW, snapshot: {
      ...emptySnapshot(NOW), state: "IDLE",
      ams: ams([tray(0, "PLA", "#FEC600", true), tray(1, null, null), tray(2, "PLA", "#C52C18"), tray(3, "PLA", "#C12E1F", true)]),
    } });
    store.savePrinter({ id: "a1-3", name: "A1 Combo #3", lastSeen: NOW, snapshot: {
      ...emptySnapshot(NOW), state: "IDLE",
      ams: ams([tray(0, "PLA", "#000000"), tray(1, "PETG", "#0085D5"), tray(2, "PLA", "#FF6910"), tray(3, "PETG", "#FFFFFF")]),
    } });
  };
  const newOrder = (extra: Partial<Parameters<typeof customerCreateOrder>[0]> = {}) => {
    const r = customerCreateOrder({ name: "Aini", product: "Casing", quantity: 1, deadline: "2026-10-20", budgetIdr: 50_000, note: "", ...extra });
    if (!r.ok) throw new Error(JSON.stringify(r));
    return r.order;
  };

  it("only colours loaded now, of one material, stored with English names whatever the page sent", () => {
    studio();
    const palette = studioPalette(store.listPrinters());
    expect(readColorChoice("PLA", [{ type: "PLA", color: "#fec600", name: "<b>Kuning</b>" }], palette))
      .toEqual({ ok: true, material: "PLA", preferredColors: [{ type: "PLA", color: "#FEC600", name: "Yellow" }] });
    // Colours without a material set it; a material without colours is fine (Kesuni picks the colour).
    expect(readColorChoice(undefined, [{ type: "PETG", color: "#0085D5" }], palette)).toMatchObject({ ok: true, material: "PETG" });
    expect(readColorChoice("PETG", [], palette)).toEqual({ ok: true, material: "PETG", preferredColors: [] });
    expect(readColorChoice(null, undefined, palette)).toEqual({ ok: true, material: undefined, preferredColors: [] });
    // Refused: another material, a colour not loaded, PLA + PETG in one order, a PLA colour as PETG, more than four.
    expect(readColorChoice("ABS", [], palette)).toEqual({ ok: false, reasons: ["Material must be PLA or PETG"] });
    expect(readColorChoice("PLA", [{ type: "PLA", color: "#00FF00" }], palette))
      .toEqual({ ok: false, reasons: ["PLA Lime (#00FF00) is not loaded in the studio right now"] });
    expect(readColorChoice("PLA", [{ type: "PLA", color: "#FEC600" }, { type: "PETG", color: "#FFFFFF" }], palette))
      .toEqual({ ok: false, reasons: ["Pick the colours of one material"] });
    expect(readColorChoice("PETG", [{ type: "PLA", color: "#FEC600" }], palette).ok).toBe(false);
    const five = ["#FEC600", "#C52C18", "#C12E1F", "#000000", "#FF6910"].map((color) => ({ type: "PLA", color }));
    expect(readColorChoice("PLA", five, palette)).toEqual({ ok: false, reasons: ["Pick at most 4 colours"] });
    expect(readColorChoice("PLA", five.slice(0, 4), palette)).toMatchObject({ ok: true });
  });

  it("the invite form stores the choice, the rupiah as typed and the rate", async () => {
    studio();
    process.env.IDR_PER_USDC = "16000";
    process.env.CUSTOMER_INVITE_CODE = "kesuni-pilot-2026";
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + 4 * 3_600_000 }); // past the earlier tests' hourly limit
    try {
      const order = newOrder({ budgetIdr: 48_000, material: "PLA", colors: [{ type: "PLA", color: "#FEC600" }, { type: "PLA", color: "#FF6910" }] });
      expect(order).toMatchObject({
        material: "PLA", budgetIdr: 48_000, rateIdrPerUsdc: 16_000, mandateMicro: 3_000_000,
        preferredColors: [{ type: "PLA", color: "#FEC600", name: "Yellow" }, { type: "PLA", color: "#FF6910", name: "Orange" }],
      });
      const bad = customerCreateOrder({ name: "A", product: "B", quantity: 1, deadline: "2026-10-20", budgetIdr: 50_000, note: "", colors: [{ type: "PLA", color: "#123456" }] });
      expect(bad.ok === false && bad.reasons).toEqual([expect.stringMatching(/is not loaded in the studio right now$/)]);
      // Through the endpoint too.
      const res = await createViaInvite(new Request("http://x/api/c", {
        method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "192.0.2.77" },
        body: JSON.stringify({
          invite: "kesuni-pilot-2026", name: "A", product: "B", quantity: 1, deadline: "2026-10-20", budgetIdr: 50000,
          material: "PETG", colors: [{ type: "PETG", color: "#FFFFFF" }],
        }),
      }));
      expect(res.status).toBe(201);
      const made = orderForToken(String((await res.json()).link).split("/").pop()!)!;
      expect(made).toMatchObject({ material: "PETG", preferredColors: [{ type: "PETG", color: "#FFFFFF", name: "White" }] });
    } finally {
      vi.useRealTimers();
      delete process.env.IDR_PER_USDC;
    }
  });

  it("the order page may change it while Kesuni prepares the price, then it is fixed and still shown", async () => {
    studio();
    const order = newOrder();
    const token = order.customerToken!;
    expect(customerView(order, token).choice).toEqual({ material: null, colors: [], canChange: true, materialLocked: false });
    const ctx = { params: Promise.resolve({ token }) };
    const post = (body: unknown) => act(new Request("http://x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), ctx);

    const ok = await post({ action: "colors", material: "PETG", colors: [{ type: "PETG", color: "#0085D5" }] });
    expect(ok.status).toBe(200);
    expect((await ok.json()).choice).toEqual({ material: "PETG", colors: [{ type: "PETG", color: "#0085D5", name: "Blue" }] });
    expect(store.listLog(order.id).at(-1)).toMatchObject({ actor: "human", tool: "customer_colors", input: { material: "PETG" } });
    expect((await post({ action: "colors", material: "PLA", colors: [{ type: "PLA", color: "#ABCDEF" }] })).status).toBe(400);
    expect(store.getOrder(order.id)!.material).toBe("PETG"); // unchanged

    // Clearing works: Kesuni picks.
    expect(customerSetColors(order.id, { material: null, colors: [] }).ok).toBe(true);
    expect(store.getOrder(order.id)).not.toHaveProperty("material");
    expect(store.getOrder(order.id)).not.toHaveProperty("preferredColors");

    // Once priced, the order page shows the choice but cannot change it.
    expect(customerSetColors(order.id, { material: "PLA", colors: [{ type: "PLA", color: "#000000" }] }).ok).toBe(true);
    store.saveOrder({ ...store.getOrder(order.id)!, status: "PLAN_CHOSEN" });
    expect((await post({ action: "colors", material: "PLA", colors: [] })).status).toBe(409);
    expect(customerView(store.getOrder(order.id)!, token).choice)
      .toMatchObject({ material: "PLA", colors: [{ type: "PLA", color: "#000000", name: "Black" }], canChange: false });
  });

  it("once a quote exists the material stays (the price per gram may depend on it); colours of it may still change", () => {
    studio();
    // ORD-001 has quotes and no material: it is priced as PLA.
    expect(customerView(store.getOrder(ORDER)!, ensureCustomerToken(ORDER)!).choice).toMatchObject({ material: "PLA", materialLocked: true, canChange: true });
    const petg = customerSetColors(ORDER, { material: "PETG", colors: [] });
    expect(petg.ok === false && petg.status).toBe(409);
    expect(customerSetColors(ORDER, { material: "PLA", colors: [{ type: "PLA", color: "#FEC600" }] }).ok).toBe(true);
    expect(store.getOrder(ORDER)!.preferredColors).toEqual([{ type: "PLA", color: "#FEC600", name: "Yellow" }]);
  });

  it("nothing loaded (bridge offline): a material alone is fine, any colour is refused", () => {
    expect(newOrder({ material: "PLA" }).material).toBe("PLA");
    const r = customerCreateOrder({ name: "A", product: "B", quantity: 1, deadline: "2026-10-20", budgetIdr: 50_000, note: "", colors: [{ type: "PLA", color: "#000000" }] });
    expect(r.ok).toBe(false);
  });
});
