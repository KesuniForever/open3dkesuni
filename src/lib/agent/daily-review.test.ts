import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import * as store from "../store";
import { agentModel, setLlmGateway, type LlmRequest, type LlmResponse } from "./chief";
import { dailyFacts, dailyReviewHour, generateDailyReview, jakartaDay, maybeRunDailyReview, SECTIONS } from "./daily-review";
import { GET, POST } from "@/app/api/daily-review/route";
import type { ChainTx, Escrow } from "../types";

const DAY = "2026-10-14";
const at = (hhmm: string, day = DAY) => `${new Date(`${day}T${hhmm}:00+07:00`).toISOString()}`;
const NOW = new Date(`${DAY}T22:00:00+07:00`);
const CLAUDE_TEXT = SECTIONS.map((s) => `## ${s}\n- isi ${s} (testnet)`).join("\n\n");
let sent: LlmRequest[] = [];

function fakeClaude(reply: () => Promise<LlmResponse> = async () => ({
  stop_reason: "end_turn", content: [{ type: "text", text: CLAUDE_TEXT }], usage: { input_tokens: 1200, output_tokens: 300 },
})) {
  sent = [];
  setLlmGateway(async (req) => {
    sent.push(JSON.parse(JSON.stringify(req)));
    return reply();
  });
}

const tx = (kind: ChainTx["kind"], amountMicro: number, when: string, state: ChainTx["state"] = "COMPLETE"): ChainTx =>
  ({ kind, from: "0xa", to: "0xb", amountMicro, idempotencyKey: `${kind}-${when}`, state, at: when });
const escrow = (orderId: string, state: Escrow["state"], amountMicro: number, txs: ChainTx[]): Escrow => ({
  orderId, amountMicro, escrowWalletId: "w1", escrowAddress: "0xe", customerWalletId: "w2", customerAddress: "0xc",
  state, txs, network: "ARC-TESTNET", label: "testnet", createdAt: at("08:00"),
});

/** One busy day: a simulated order and a real one (Aini's), money, tasks, Chief activity. */
function seedDay() {
  const sim = store.getOrder("ORD-001")!;
  store.saveOrder({ ...sim, createdAt: at("08:00"), deadline: "2026-10-16", status: "PLAN_CHOSEN" });
  store.saveOrder({
    ...sim, id: "ORD-002", jobId: "JOB-002", label: "real", product: "Casing korek", quantity: 50, deadline: "2026-10-20",
    status: "IN_PRODUCTION", createdAt: at("09:00"), customerName: "Aini Rahma", customerNote: "Kirim ke Jl. Sudirman 5, WA 081234567890",
    agreement: { version: 1, hash: "h", quoteId: "Q-x", priceMicro: 75_000_000, by: "Aini Rahma", at: at("10:00") },
  });
  // an old order: created yesterday, overdue
  store.saveOrder({ ...sim, id: "ORD-003", jobId: "JOB-003", createdAt: at("09:00", "2026-10-13"), deadline: "2026-10-12", status: "CREATED" });

  store.addDecision({ orderId: "ORD-001", quoteId: "Q-own", decidedBy: "agent", reason: "own studio", at: at("09:30") });
  store.addDecision({ orderId: "ORD-002", quoteId: "Q-own", decidedBy: "human", reason: "owner", at: at("10:30") });
  store.addDecision({ orderId: "ORD-003", quoteId: "Q-own", decidedBy: "agent", reason: "old", at: at("10:30", "2026-10-13") });

  store.saveEscrow(escrow("ORD-001", "FUNDED", 30_000_000, [tx("deposit", 30_000_000, at("11:00"))]));
  store.saveEscrow(escrow("ORD-002", "RELEASED", 75_000_000, [
    tx("customer_topup", 75_000_000, at("10:40")), tx("deposit", 75_000_000, at("10:45")), tx("release", 75_000_000, at("20:00")),
  ]));
  store.saveEscrow(escrow("ORD-003", "AWAITING_DEPOSIT", 30_000_000, [tx("deposit", 30_000_000, at("12:00", "2026-10-13"), "SENT")]));

  store.saveTask({ id: "T-old", orderId: "ORD-003", kind: "check_printer", text: "Cek printer", status: "open", createdBy: "agent", at: at("09:00", "2026-10-13") });
  store.saveTask({ id: "T-q", orderId: "ORD-002", kind: "needs_info", text: "Berapa gram per unit? Aini bilang WA 081234567890",
    status: "open", createdBy: "human", at: at("12:00") });
  store.saveTask({ id: "T-done", orderId: "ORD-002", kind: "collect_and_qc", text: "Ambil print", status: "done", createdBy: "agent",
    at: at("13:00"), doneAt: at("15:00"), doneBy: "operator" });

  const log = (orderId: string, tool: string, ok: boolean, input: unknown, output: unknown, when: string) =>
    store.addLog({ orderId, actor: "agent", tool, ok, input, output, at: when });
  log("ORD-001", "agent_start", true, { trigger: "Heartbeat check (timer) found: ..." }, {}, at("09:20"));
  log("ORD-001", "choose_plan", true, {}, {}, at("09:30"));
  log("ORD-001", "price_by_weight", false, {}, { error: "Pricing refused", reasons: ["Margin 10% is under the owner's minimum 15%: ask the owner"] }, at("09:25"));
  log("ORD-001", "request_human_decision", true, {}, { escalated: true }, at("09:26"));
  log("ORD-001", "agent_summary", true, {}, { text: "ok", usage: { input_tokens: 5000, output_tokens: 400, cache_read_input_tokens: 3000, cache_creation_input_tokens: 0 } }, at("09:31"));
  log("ORD-002", "agent_start", true, { trigger: "The operator pressed Run agent." }, {}, at("14:00"));
  log("ORD-001", "choose_plan", true, {}, {}, at("09:30", "2026-10-13")); // another day

  store.addMessage({ id: "M-1", orderId: "ORD-002", text: "Harga siap, silakan cek.", by: "agent", at: at("10:05") });
  store.addMessage({ id: "M-2", orderId: "ORD-002", text: "Terima kasih", by: "human", at: at("10:06") });
}

beforeEach(() => {
  process.env.IDR_PER_USDC = "16000";
  store.resetDb();
  fakeClaude();
});
afterEach(() => {
  delete process.env.KESUNI_AGENT_MODE;
  delete process.env.KESUNI_DAILY_REVIEW_HOUR;
});
afterAll(() => {
  setLlmGateway(undefined);
  delete process.env.IDR_PER_USDC;
});

describe("facts (code only)", () => {
  it("counts one Jakarta day, keeps real and simulated money apart, labels the network", () => {
    seedDay();
    const f = dailyFacts(DAY, NOW);
    expect(f.orders).toMatchObject({ createdReal: 1, createdSimulated: 1 });
    expect(f.orders.created.map((o) => o.orderId)).toEqual(["ORD-001", "ORD-002"]);
    expect(f.plans).toMatchObject({ byAgent: 1, byHuman: 1 });
    expect(f.agreements.count).toBe(1);
    const money = (event: string, label: string) => f.money.find((m) => m.event === event && m.orderLabel === label);
    expect(money("funded", "simulated")).toMatchObject({ count: 1, amountMicro: 30_000_000, amountUsdc: "30", networkLabel: "testnet", testMoney: true, network: "Arc Testnet" });
    expect(money("funded", "real")).toMatchObject({ count: 1, amountMicro: 75_000_000, amountIdrApprox: 1_200_000 });
    expect(money("released", "real")).toMatchObject({ count: 1, orders: ["ORD-002"] });
    expect(f.money).toHaveLength(3); // the top-up is not income; yesterday's pending deposit is not counted
    expect(f.pendingTransfersNow).toBe(1);
    expect(f.network).toMatchObject({ label: "testnet", testMoney: true });
    expect(f.tasks).toMatchObject({ opened: 2, done: 1, openNow: 2, oldestOpen: { orderId: "ORD-003", kind: "check_printer", ageHours: 37 } });
    expect(f.chief).toMatchObject({
      runs: 2, heartbeatWakeups: 1, toolCalls: 3, decisions: 1, escalations: 1, refusals: 1, messagesToCustomers: 1, messagesByPeople: 1,
    });
    expect(f.chief.refusalReasons[0]).toContain("Margin 10%");
    expect(f.claudeTokens).toMatchObject({ logged: true, runs: 1, input: 5000, output: 400, cacheRead: 3000 });
    expect(f.deadlines.next3Days.map((o) => o.orderId)).toEqual(["ORD-001"]);
    expect(f.deadlines.overdue.map((o) => o.orderId)).toEqual(["ORD-003"]);
    expect(f.partialDay).toBe(true);
  });

  it("never contains the customer's name, phone or address", () => {
    seedDay();
    const json = JSON.stringify(dailyFacts(DAY, NOW));
    expect(json).not.toMatch(/Aini|081234567890|Sudirman/);
    expect(json).toContain("[nomor disembunyikan]");
  });

  it("an empty day is all zeros", () => {
    const f = dailyFacts("2026-01-01", NOW);
    expect(f.orders.created).toEqual([]);
    expect(f.money).toEqual([]);
    expect(f.chief.runs).toBe(0);
    expect(f.claudeTokens.logged).toBe(false);
    expect(f.partialDay).toBe(false);
  });
});

describe("generate", () => {
  it("Claude writes it from the facts only, with no tools and no customer data; saved with the model", async () => {
    seedDay();
    const r = await generateDailyReview(DAY, { trigger: "button", now: NOW });
    expect(r.ok).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0].tools).toEqual([]);
    expect(sent[0].model).toBe(agentModel());
    expect(sent[0].system[0].text).toContain("ONLY the facts");
    expect(sent[0].system[0].text).toContain("testnet");
    expect(JSON.stringify(sent[0])).not.toMatch(/Aini|081234567890|Sudirman/);
    const saved = store.getDailyReview(DAY)!;
    expect(saved).toMatchObject({ day: DAY, mode: "claude", model: agentModel(), trigger: "button", text: CLAUDE_TEXT, usage: { input_tokens: 1200 } });
    expect(saved.facts).toMatchObject({ day: DAY });
  });

  it("falls back to the code template when Claude throws, with the same five sections", async () => {
    seedDay();
    fakeClaude(async () => { throw new Error("overloaded"); });
    const r = await generateDailyReview(DAY, { trigger: "schedule", now: NOW });
    if (!r.ok) throw new Error(r.error);
    expect(r.review).toMatchObject({ mode: "template", model: null, error: expect.stringContaining("overloaded") });
    for (const s of SECTIONS) expect(r.review.text).toContain(`## ${s}`);
    expect(r.review.text).toContain("bukan uang sungguhan");
    expect(r.review.text).toContain("ORD-003"); // overdue
    expect(r.review.text).toContain("Berapa gram per unit"); // the open question for the owner
    expect(r.review.text).not.toMatch(/Aini|081234567890/);
  });

  it("uses the template when Claude refuses or skips a section, and in rules mode without calling Claude", async () => {
    fakeClaude(async () => ({ stop_reason: "end_turn", content: [{ type: "text", text: "## Ringkasan\n- singkat" }] }));
    expect((await generateDailyReview(DAY, { trigger: "button", now: NOW })).ok).toBe(true);
    expect(store.getDailyReview(DAY)).toMatchObject({ mode: "template", error: expect.stringContaining("sections") });

    process.env.KESUNI_AGENT_MODE = "rules";
    fakeClaude();
    const r = await generateDailyReview(DAY, { trigger: "button", now: NOW });
    expect(r.ok && r.review).toMatchObject({ mode: "template", error: undefined });
    expect(sent).toHaveLength(0);
  });

  it("regenerating replaces the day's review; future and invalid days are refused", async () => {
    await generateDailyReview(DAY, { trigger: "button", now: NOW });
    await generateDailyReview(DAY, { trigger: "button", now: new Date(NOW.getTime() + 60_000) });
    expect(store.listDailyReviews()).toHaveLength(1);
    expect(store.getDailyReview(DAY)!.at).toBe(new Date(NOW.getTime() + 60_000).toISOString());
    expect(await generateDailyReview("2026-10-15", { trigger: "button", now: NOW })).toMatchObject({ ok: false, status: 400 });
    expect(await generateDailyReview("2026-02-30", { trigger: "button", now: NOW })).toMatchObject({ ok: false, status: 400 });
  });
});

describe("schedule", () => {
  it("runs once per Jakarta day, only after the hour (default 21 WIB)", async () => {
    expect(dailyReviewHour()).toBe(21);
    expect(await maybeRunDailyReview(new Date(`${DAY}T20:59:00+07:00`))).toMatchObject({ ran: false });
    expect(await maybeRunDailyReview(new Date(`${DAY}T21:05:00+07:00`))).toMatchObject({ ran: true, day: DAY });
    expect(await maybeRunDailyReview(new Date(`${DAY}T23:30:00+07:00`))).toMatchObject({ ran: false, reason: "already written" });
    // 00:30 WIB is the next Jakarta day (still the 14th in UTC): before the hour
    expect(await maybeRunDailyReview(new Date("2026-10-15T00:30:00+07:00"))).toMatchObject({ ran: false, day: "2026-10-15" });
    expect(await maybeRunDailyReview(new Date("2026-10-15T21:00:00+07:00"))).toMatchObject({ ran: true, day: "2026-10-15" });
    expect(store.listDailyReviews().map((r) => r.day)).toEqual(["2026-10-15", DAY]);
    expect(sent).toHaveLength(2);
    expect(store.getDailyReview(DAY)!.trigger).toBe("schedule");
  });

  it("the hour comes from KESUNI_DAILY_REVIEW_HOUR; off turns it off; never throws", async () => {
    process.env.KESUNI_DAILY_REVIEW_HOUR = "8";
    expect(await maybeRunDailyReview(new Date(`${DAY}T09:00:00+07:00`))).toMatchObject({ ran: true });
    process.env.KESUNI_DAILY_REVIEW_HOUR = "off";
    expect(await maybeRunDailyReview(new Date("2026-10-15T23:00:00+07:00"))).toMatchObject({ ran: false, reason: "off" });
    process.env.KESUNI_DAILY_REVIEW_HOUR = "99";
    expect(dailyReviewHour()).toBe(21);
    fakeClaude(async () => { throw new Error("down"); });
    process.env.KESUNI_DAILY_REVIEW_HOUR = "0";
    expect(await maybeRunDailyReview(new Date("2026-10-15T01:00:00+07:00"))).toMatchObject({ ran: true, review: { mode: "template" } });
  });

  it("a button review earlier in the day does not stop the scheduled review that evening", async () => {
    expect((await generateDailyReview(DAY, { trigger: "button", now: new Date(`${DAY}T09:00:00+07:00`) })).ok).toBe(true);
    const r = await maybeRunDailyReview(new Date(`${DAY}T21:30:00+07:00`));
    expect(r).toMatchObject({ ran: true, day: DAY, review: { trigger: "schedule" } });
    expect(store.getDailyReview(DAY)).toMatchObject({ trigger: "schedule", at: new Date(`${DAY}T21:30:00+07:00`).toISOString() });
    // A button review after the hour counts as that day's review.
    expect((await generateDailyReview("2026-10-15", { trigger: "button", now: new Date("2026-10-15T21:10:00+07:00") })).ok).toBe(true);
    expect(await maybeRunDailyReview(new Date("2026-10-15T21:30:00+07:00"))).toMatchObject({ ran: false, reason: "already written" });
  });

  it("catches up yesterday when no complete review was written (server off in the evening)", async () => {
    store.saveOrder({ ...store.getOrder("ORD-001")!, createdAt: at("09:00", "2026-10-13") });
    // A daytime button review of the 13th is not complete.
    expect((await generateDailyReview("2026-10-13", { trigger: "button", now: new Date("2026-10-13T10:00:00+07:00") })).ok).toBe(true);
    const r = await maybeRunDailyReview(new Date(`${DAY}T08:00:00+07:00`));
    expect(r).toMatchObject({ ran: true, day: "2026-10-13", review: { trigger: "schedule", facts: { partialDay: false } } });
    expect(await maybeRunDailyReview(new Date(`${DAY}T08:02:00+07:00`))).toMatchObject({ ran: false, day: DAY, reason: "before 21:00 WIB" });
    // Nothing to catch up before Kesuni had any order.
    expect(await maybeRunDailyReview(new Date("2026-10-13T08:00:00+07:00"))).toMatchObject({ ran: false, day: "2026-10-13" });
  });

  it("jakartaDay follows WIB, not UTC", () => {
    expect(jakartaDay(new Date("2026-10-14T18:00:00Z"))).toBe("2026-10-15");
    expect(jakartaDay(new Date("2026-10-14T16:59:00Z"))).toBe("2026-10-14");
  });
});

describe("API", () => {
  const req = (body?: unknown, url = "http://localhost/api/daily-review") =>
    new Request(url, body === undefined ? undefined : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

  it("POST writes a review (default today), GET lists newest first and returns one by day", async () => {
    const today = jakartaDay();
    const p = await POST(req({}));
    expect(p.status).toBe(200);
    expect((await p.json()).review).toMatchObject({ day: today, trigger: "button" });
    expect((await POST(req({ day: "2026-10-01" }))).status).toBe(200);
    const list = await (await GET(req())).json();
    expect(list.reviews.map((r: { day: string }) => r.day)).toEqual([today, "2026-10-01"]);
    expect((await (await GET(req(undefined, "http://localhost/api/daily-review?day=2026-10-01"))).json()).review.day).toBe("2026-10-01");
    expect((await GET(req(undefined, "http://localhost/api/daily-review?day=2026-09-01"))).status).toBe(404);
    expect((await GET(req(undefined, "http://localhost/api/daily-review?day=kemarin"))).status).toBe(400);
    expect((await POST(req({ day: "14-10-2026" }))).status).toBe(400);
  });
});
