import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import * as store from "../store";
import { setCircleGateway } from "../circle";
import { chooseQuote } from "../actions";
import { customerAgree } from "../agreement";
import { customerPay } from "../customer";
import { quoteByWeight } from "../agreement";
import { DEMO, fakeCircle } from "../fake-circle.test-helper";
import { clearBed, completeTask, confirmColors, ingestReport, linkPrinter } from "../printer/actions";
import { mergeReport, type PrinterSnapshot } from "../printer/bambu";
import { setAutoPrint } from "../printer/dispatch";
import { addAttachment, setFileStore, type FileStore } from "../files";
import { fake3mf } from "../threemf.test-helper";
import { SLICER_NAME } from "../slice-rules";
import { setLlmGateway, wakeChief, type LlmResponse } from "./chief";
import { checkHeartbeat, heartbeatStatus, runHeartbeat, startHeartbeatScheduler } from "./heartbeat";
import { register } from "@/instrumentation";
import { GET, POST } from "@/app/api/heartbeat/route";

const ORDER = "ORD-001";
const SHOP = "0x1111111111111111111111111111111111111111";
const end = (text: string): LlmResponse => ({ stop_reason: "end_turn", content: [{ type: "text", text }] });
let woken: { orderId: string; trigger: string }[] = [];

/** A fake Claude that only records who was woken and why, then stops. */
function fakeClaude(reply: () => Promise<LlmResponse> = async () => end("Keputusan: dicek. Menunggu: operator.")) {
  woken = [];
  setLlmGateway(async (req) => {
    const first = String(req.messages[0].content);
    woken.push({ orderId: /Order (\S+)\./.exec(first)![1], trigger: first });
    return reply();
  });
}
const beat = (now?: Date) => runHeartbeat({ trigger: "timer", now }).then((r) => {
  if (!r.ok) throw new Error(r.error);
  return r.summary;
});
const fromHeartbeat = () => woken.filter((w) => w.trigger.includes("Heartbeat check"));

beforeEach(() => {
  process.env.KESUNI_DAILY_REVIEW_HOUR = "off"; // the daily review has its own test below and in daily-review.test.ts
  process.env.IDR_PER_USDC = "16000";
  process.env.KESUNI_PAYOUT_ADDRESS = SHOP;
  process.env.KESUNI_DEMO_FUNDS_ADDRESS = DEMO;
  store.resetDb();
  setCircleGateway(fakeCircle().gw);
  fakeClaude();
});
afterEach(() => {
  delete process.env.KESUNI_AGENT_MODE;
});
afterAll(() => {
  delete process.env.KESUNI_DAILY_REVIEW_HOUR;
  setLlmGateway(undefined);
  setCircleGateway(undefined);
  delete process.env.IDR_PER_USDC;
  delete process.env.KESUNI_PAYOUT_ADDRESS;
  delete process.env.KESUNI_DEMO_FUNDS_ADDRESS;
});

describe("checks (code only)", () => {
  it("a new order without quotes needs a price; with quotes it needs a plan; an open question covers both (no wake)", () => {
    store.deleteQuote("Q-own");
    store.deleteQuote("Q-partner");
    expect(checkHeartbeat().map((f) => f.kind)).toEqual(["needs_price"]);
    store.saveQuote({ id: "Q-own", orderId: ORDER, vendorId: "own", priceMicro: 30_000_000, etaHours: 48, source: "own" });
    // The key is what the Chief decides from: quotes and prices, the budget, the owner's approval, the grams.
    expect(checkHeartbeat()).toMatchObject([{ kind: "needs_plan", key: `needs_plan:${ORDER}:own=30000000/48h:32000000::`, wake: true }]);
    store.saveTask({ id: "T-1", orderId: ORDER, kind: "needs_info", text: "Berapa gram?", status: "open", createdBy: "agent", at: new Date().toISOString() });
    expect(checkHeartbeat()).toMatchObject([{ kind: "needs_plan", wake: false, covered: true, text: expect.stringContaining("Waiting on the open question T-1") }]);
  });

  it("the customer's page offers to raise the budget: no wake while every quote is above it", () => {
    store.deleteQuote("Q-partner");
    store.saveOrder({ ...store.getOrder(ORDER)!, label: "real" });
    store.saveOrder({ ...store.getOrder(ORDER)!, slicerGrams: { gramsPerUnit: 400, source: "Bambu Studio", by: "operator", at: new Date().toISOString() } });
    expect(quoteByWeight(ORDER, { gramsPerUnit: 400, source: "Bambu Studio", by: "human" }).ok).toBe(true); // Rp600.000 > budget
    // Q-own (30 USDC) still fits the budget: the Chief chooses.
    expect(checkHeartbeat()).toMatchObject([{ kind: "needs_plan", wake: true }]);
    store.deleteQuote("Q-own");
    expect(checkHeartbeat()).toMatchObject([{ kind: "needs_plan", wake: false, covered: true, text: expect.stringContaining("Waiting on the customer") }]);
  });

  it("never puts the customer's name in a finding", () => {
    store.saveOrder({ ...store.getOrder(ORDER)!, customerName: "Aini" });
    expect(JSON.stringify(checkHeartbeat())).not.toContain("Aini");
  });

  it("nor a name or phone number the customer typed into the product (the text goes to Claude)", () => {
    store.saveOrder({ ...store.getOrder(ORDER)!, customerName: "Aini Rahmawati", product: "Casing korek untuk Aini 0812-3456-7890" });
    const text = JSON.stringify(checkHeartbeat());
    expect(text).not.toMatch(/Aini|0812/);
    expect(text).toContain("Casing korek untuk [customer name] [number hidden]");
  });

  it("an operator task open for more than 6 hours is a finding without a wake", () => {
    const at = new Date("2026-10-14T00:00:00Z");
    store.saveTask({ id: "T-old", orderId: ORDER, kind: "collect_and_qc", text: "Ambil print", status: "open", createdBy: "agent", at: at.toISOString() });
    store.saveOrder({ ...store.getOrder(ORDER)!, deadline: "2026-12-31" });
    const later = new Date(at.getTime() + 7 * 3_600_000);
    expect(checkHeartbeat(later).find((f) => f.kind === "task_stale")).toMatchObject({ key: "task_stale:T-old", wake: false });
    expect(checkHeartbeat(new Date(at.getTime() + 5 * 3_600_000)).some((f) => f.kind === "task_stale")).toBe(false);
  });
});

describe("heartbeat run", () => {
  it("wakes Claude once for the same unchanged problem, and logs what it noticed", async () => {
    const s1 = await beat();
    expect(s1.woke).toEqual([{ orderId: ORDER, outcome: "done", summary: expect.any(String) }]);
    expect(s1.findings[0]).toMatchObject({ kind: "needs_plan", isNew: true });
    const s2 = await beat();
    expect(s2.woke).toEqual([]);
    expect(s2.findings[0]).toMatchObject({ kind: "needs_plan", isNew: false });
    expect(fromHeartbeat()).toHaveLength(1);
    expect(store.listLog(ORDER).filter((e) => e.tool === "heartbeat")).toHaveLength(1);
    expect(store.getMeta("heartbeatLast")).toMatchObject({ trigger: "timer", woke: [] });
  });

  it("a question closed without any change does not wake Claude again; a change does (no question loop)", async () => {
    await beat();
    store.saveTask({ id: "T-q", orderId: ORDER, kind: "needs_info", text: "Tanya pemilik", status: "open", createdBy: "agent", at: new Date().toISOString() });
    const s = await beat();
    expect(s.findings).toMatchObject([{ kind: "needs_plan", wake: false, covered: true }]);
    expect(s.woke).toEqual([]);
    store.saveTask({ ...store.getTask("T-q")!, status: "done" });
    await beat();
    expect(fromHeartbeat()).toHaveLength(1); // the same quotes, budget, approval and grams: nothing new to decide
    store.saveQuote({ ...store.getQuote("Q-own")!, priceMicro: 29_000_000 }); // re-priced: a new problem
    await beat();
    expect(fromHeartbeat()).toHaveLength(2);
  });

  it("a problem that goes away and comes back wakes Claude again", async () => {
    chooseQuote(ORDER, "Q-own", "agent", "within budget");
    store.saveEscrow({
      orderId: ORDER, amountMicro: 30_000_000, escrowWalletId: "w1", escrowAddress: "0xe", customerWalletId: "w2", customerAddress: "0xc",
      state: "FUNDED", txs: [], network: "ARC-TESTNET", label: "testnet", createdAt: new Date().toISOString(),
    });
    await beat();
    store.savePrinter({ id: "a1", name: "A1 Combo #1", currentOrderId: ORDER, lastSeen: new Date().toISOString() });
    expect((await beat()).findings).toEqual([]);
    store.savePrinter({ id: "a1", name: "A1 Combo #1", lastSeen: new Date().toISOString() });
    await beat();
    expect(fromHeartbeat()).toHaveLength(2);
  });

  it("paid into escrow with no printer: wakes the Chief to start production", async () => {
    chooseQuote(ORDER, "Q-own", "agent", "within budget");
    store.saveEscrow({
      orderId: ORDER, amountMicro: 30_000_000, escrowWalletId: "w1", escrowAddress: "0xe", customerWalletId: "w2", customerAddress: "0xc",
      state: "FUNDED", txs: [], network: "ARC-TESTNET", label: "testnet", createdAt: new Date().toISOString(),
    });
    const s = await beat();
    expect(s.findings.map((f) => f.kind)).toEqual(["start_production"]);
    expect(fromHeartbeat()[0].trigger).toContain("has no printer yet");
    // a printer holding it ends the problem
    store.savePrinter({ id: "a1", name: "A1 Combo #1", currentOrderId: ORDER, lastSeen: new Date().toISOString() });
    expect(checkHeartbeat().some((f) => f.kind === "start_production")).toBe(false);
  });

  it("a finished print that was collected waits for QC: no 'start production' again", async () => {
    chooseQuote(ORDER, "Q-own", "agent", "within budget");
    store.saveEscrow({
      orderId: ORDER, amountMicro: 30_000_000, escrowWalletId: "w1", escrowAddress: "0xe", customerWalletId: "w2", customerAddress: "0xc",
      state: "FUNDED", txs: [], network: "ARC-TESTNET", label: "testnet", createdAt: new Date().toISOString(),
    });
    const at = new Date().toISOString();
    const snap: PrinterSnapshot = {
      state: "FINISH", percent: 100, remainingMin: 0, layer: null, totalLayers: null, jobName: null, errorCode: 0, nozzleTemp: null, bedTemp: null, at,
    };
    expect(linkPrinter("a1", ORDER).ok).toBe(true);
    ingestReport("a1", snap, [{ kind: "finished", percent: 100, jobName: null, at }]);
    expect(store.getOrder(ORDER)!.status).toBe("IN_PRODUCTION");
    await beat();
    completeTask(store.listTasks(ORDER).find((t) => t.kind === "collect_and_qc")!.id, "operator");
    const s = await beat();
    expect(s.findings.some((f) => f.kind === "start_production")).toBe(false);
    expect(fromHeartbeat()).toHaveLength(0);
    // A failed reprint after that does need a new production run.
    store.saveTask({ id: "T-re", orderId: ORDER, kind: "reprint", text: "Cetak ulang", status: "done", createdBy: "agent", at: new Date().toISOString() });
    expect(checkHeartbeat().some((f) => f.kind === "start_production")).toBe(true);
  });

  it("a failed Claude call is not 'handled': the paid order is woken again after the retry wait", async () => {
    chooseQuote(ORDER, "Q-own", "agent", "within budget");
    store.saveEscrow({
      orderId: ORDER, amountMicro: 30_000_000, escrowWalletId: "w1", escrowAddress: "0xe", customerWalletId: "w2", customerAddress: "0xc",
      state: "FUNDED", txs: [], network: "ARC-TESTNET", label: "testnet", createdAt: new Date().toISOString(),
    });
    fakeClaude(async () => { throw new Error("Claude API 529 overloaded"); });
    const t0 = Date.now();
    const s1 = await beat(new Date(t0));
    expect(s1.woke).toMatchObject([{ orderId: ORDER, outcome: "error" }]);
    fakeClaude(); // credits bought, Claude works again
    const s2 = await beat(new Date(t0 + 2 * 60_000)); // within the wait: no call every beat
    expect(s2.woke).toMatchObject([{ orderId: ORDER, outcome: "deferred" }]);
    expect(fromHeartbeat()).toHaveLength(0);
    const s3 = await beat(new Date(t0 + 31 * 60_000));
    expect(s3.woke).toMatchObject([{ orderId: ORDER, outcome: "done" }]);
    expect(fromHeartbeat()).toHaveLength(1);
    await beat(new Date(t0 + 33 * 60_000)); // handled now: not again
    expect(fromHeartbeat()).toHaveLength(1);
  });

  it("a beat whose checks fail keeps what was already handled", async () => {
    await beat();
    expect(fromHeartbeat()).toHaveLength(1);
    const escrow = {
      orderId: ORDER, amountMicro: 30_000_000, escrowWalletId: "w1", escrowAddress: "0xe", customerWalletId: "w2", customerAddress: "0xc",
      state: "AWAITING_DEPOSIT" as const, txs: [], network: "ARC-TESTNET", label: "testnet" as const, createdAt: new Date().toISOString(),
    };
    store.saveEscrow({ ...escrow, txs: null as unknown as [] }); // a broken row makes the checks throw
    const s = await beat();
    expect(s.errors.length).toBeGreaterThan(0);
    store.saveEscrow(escrow);
    await beat();
    expect(fromHeartbeat()).toHaveLength(1); // needs_plan was handled before the error: no second wake
  });

  it("a pending payment is synced in code (fake Circle), not by waking Claude", async () => {
    chooseQuote(ORDER, "Q-own", "agent", "within budget");
    expect(customerAgree(ORDER, "Aini").ok).toBe(true);
    expect((await customerPay(ORDER)).ok).toBe(true);
    const s = await beat();
    expect(s.findings.map((f) => f.kind)).toContain("payment_pending");
    expect(s.actions.some((a) => a.startsWith("Synced payment of ORD-001"))).toBe(true);
    for (let i = 0; i < 4 && store.getEscrow(ORDER)!.state !== "FUNDED"; i++) await beat();
    expect(store.getEscrow(ORDER)!.state).toBe("FUNDED");
    expect(fromHeartbeat().some((w) => w.trigger.includes("Pembayaran"))).toBe(false);
  });

  it("an offline printer on an order gets one operator task and no wake", async () => {
    chooseQuote(ORDER, "Q-own", "agent", "within budget");
    store.savePrinter({ id: "a1", name: "A1 Combo #1", currentOrderId: ORDER, lastSeen: "2026-01-01T00:00:00Z" });
    const s = await beat();
    expect(s.findings.map((f) => f.kind)).toEqual(["printer_offline"]);
    await beat();
    const tasks = store.listTasks(ORDER).filter((t) => t.status === "open");
    expect(tasks).toMatchObject([{ kind: "check_printer", printerId: "a1" }]);
    expect(fromHeartbeat()).toHaveLength(0);
  });

  it("deadline: one wake when it is near and one when it passed; the Chief decides, so code opens no second task", async () => {
    store.saveOrder({ ...store.getOrder(ORDER)!, deadline: "2026-10-20" });
    const s = await beat(new Date("2026-10-20T10:00:00+07:00"));
    expect(s.findings.map((f) => f.kind).sort()).toEqual(["deadline_risk", "needs_plan"]);
    expect(fromHeartbeat()).toHaveLength(1);
    expect(fromHeartbeat()[0].trigger).toContain("less than 24 hours away");
    expect(store.listTasks(ORDER)).toEqual([]);
    const s2 = await beat(new Date("2026-10-21T08:00:00+07:00"));
    expect(s2.findings.find((f) => f.kind === "deadline_risk"))
      .toMatchObject({ key: `deadline_passed:${ORDER}:2026-10-20`, text: expect.stringContaining("has passed") });
    expect(fromHeartbeat()).toHaveLength(2);
    expect(fromHeartbeat()[1].trigger).toContain("has passed");
    expect(fromHeartbeat()[1].trigger).toContain("(product: «Custom lamp side table"); // the customer's words, marked as data
    await beat(new Date("2026-10-21T09:00:00+07:00"));
    expect(fromHeartbeat()).toHaveLength(2);
    expect(store.listTasks(ORDER)).toEqual([]);
  });

  it("deadline while Claude fails: code opens the task itself, once, and names it when the Chief runs later", async () => {
    chooseQuote(ORDER, "Q-own", "agent", "within budget");
    store.saveOrder({ ...store.getOrder(ORDER)!, deadline: "2026-10-20" });
    fakeClaude(async () => { throw new Error("Claude API 400: credit balance too low"); });
    const t0 = new Date("2026-10-20T10:00:00+07:00").getTime();
    expect((await beat(new Date(t0))).woke).toMatchObject([{ orderId: ORDER, outcome: "error" }]);
    const tasks = () => store.listTasks(ORDER);
    expect(tasks()).toMatchObject([{ kind: "check_printer", status: "open", key: `deadline_risk:${ORDER}:2026-10-20`, by: "code" }]);
    await beat(new Date(t0 + 2 * 60_000)); // within the retry wait: no second task
    expect(tasks()).toHaveLength(1);
    fakeClaude();
    await beat(new Date(t0 + 31 * 60_000));
    expect(fromHeartbeat()).toHaveLength(1);
    expect(fromHeartbeat()[0].trigger).toContain(`(Operator task ${tasks()[0].id} is already open for this.)`);
    expect(tasks()).toHaveLength(1);
  });

  it("the Chief already on the order (an event woke it): no second run queued; the next beat looks again", async () => {
    process.env.KESUNI_MAX_WAKES_PER_HOUR = "1000";
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    fakeClaude(async () => { await gate; return end("Decision: none.\nWaiting on: the operator."); });
    expect(wakeChief(ORDER, "A new order arrived.")).toBe(true);
    const s = await beat();
    expect(s.woke).toMatchObject([{ orderId: ORDER, outcome: "busy" }]);
    release();
    await new Promise((r) => setTimeout(r, 30));
    expect(woken).toHaveLength(1); // only the event's run
    await beat();
    expect(fromHeartbeat()).toHaveLength(1); // not handled while busy: this beat woke it
    await beat();
    expect(fromHeartbeat()).toHaveLength(1);
    delete process.env.KESUNI_MAX_WAKES_PER_HOUR;
  });

  it("pricing again at the same price is no new problem (no quote ids in the key)", async () => {
    await beat();
    const q = store.getQuote("Q-own")!;
    store.deleteQuote("Q-own");
    store.saveQuote({ ...q, id: "Q-own-2" });
    await beat();
    expect(fromHeartbeat()).toHaveLength(1);
  });

  it("rules mode: the deadline gets one code task, closed once the order's print starts", async () => {
    setLlmGateway(undefined);
    process.env.KESUNI_AGENT_MODE = "rules";
    chooseQuote(ORDER, "Q-own", "agent", "within budget");
    // Today in Jakarta: its end (23:59:59 WIB) is always less than 24 h away. Twelve hours from now was tomorrow
    // after noon WIB, more than 24 h away, so the test failed every afternoon.
    const day = new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);
    store.saveOrder({ ...store.getOrder(ORDER)!, deadline: day });
    await beat();
    const [task] = store.listTasks(ORDER);
    expect(task).toMatchObject({ kind: "check_printer", status: "open", key: `deadline_risk:${ORDER}:${day}`, by: "code" });
    expect(linkPrinter("a1", ORDER).ok).toBe(true);
    const at = new Date().toISOString();
    const running: PrinterSnapshot = {
      state: "RUNNING", percent: 1, remainingMin: 60, layer: null, totalLayers: null, jobName: null, errorCode: 0, nozzleTemp: null, bedTemp: null, at,
    };
    ingestReport("a1", running, [{ kind: "started", percent: 1, jobName: null, at }]);
    expect(store.getTask(task.id)).toMatchObject({ status: "done", doneBy: "A1 Combo #1 (printing started)" });
  });

  it("wakes at most 3 orders per beat; the rest follow on the next beat", async () => {
    for (let i = 2; i <= 6; i++) {
      const id = `ORD-00${i}`;
      store.saveOrder({ ...store.getOrder(ORDER)!, id, jobId: `JOB-00${i}` });
      store.saveQuote({ id: `Q-${i}`, orderId: id, vendorId: "own", priceMicro: 30_000_000, etaHours: 48, source: "own" });
    }
    const s1 = await beat();
    expect(fromHeartbeat()).toHaveLength(3);
    expect(s1.woke.filter((w) => w.outcome === "deferred")).toHaveLength(3);
    await beat();
    expect(fromHeartbeat()).toHaveLength(6);
    expect(new Set(fromHeartbeat().map((w) => w.orderId)).size).toBe(6);
    await beat();
    expect(fromHeartbeat()).toHaveLength(6);
  });

  it("refuses to overlap: a second run while one is busy is turned away", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    fakeClaude(async () => { await gate; return end("ok"); });
    const first = runHeartbeat({ trigger: "timer" });
    expect(await runHeartbeat({ trigger: "button" })).toMatchObject({ ok: false, busy: true });
    expect((await POST()).status).toBe(409);
    release();
    expect((await first).ok).toBe(true);
    expect((await runHeartbeat({ trigger: "button" })).ok).toBe(true);
  });

  it("writes the daily review last, once per Jakarta day after the hour", async () => {
    delete process.env.KESUNI_DAILY_REVIEW_HOUR; // default 21 WIB
    store.saveOrder({ ...store.getOrder(ORDER)!, deadline: "2026-12-31" });
    expect((await beat(new Date("2026-10-14T20:00:00+07:00"))).actions.some((a) => a.startsWith("Daily review"))).toBe(false);
    const s = await beat(new Date("2026-10-14T21:30:00+07:00"));
    expect(s.actions.at(-1)).toBe("Daily review for 2026-10-14 written (code template)"); // this fake Claude only answers order runs
    expect(store.getDailyReview("2026-10-14")).toMatchObject({ trigger: "schedule" });
    expect((await beat(new Date("2026-10-14T21:32:00+07:00"))).actions.some((a) => a.startsWith("Daily review"))).toBe(false);
  });

  it("never throws: a failing Claude is recorded", async () => {
    fakeClaude(async () => { throw new Error("overloaded"); });
    const s = await beat();
    // The Chief falls back to the rule planner for a CREATED order.
    expect(s.woke[0]).toMatchObject({ orderId: ORDER, outcome: "fallback" });
    expect(s.errors.join()).toContain("overloaded");
  });

  it("rules mode: only 'choose a plan' runs the rule planner; the rest is recorded as needing Claude", async () => {
    setLlmGateway(undefined);
    process.env.KESUNI_AGENT_MODE = "rules";
    const other = { ...store.getOrder(ORDER)!, id: "ORD-002", jobId: "JOB-002" };
    store.saveOrder(other); // no quotes: needs a price, which needs Claude
    const s = await beat();
    expect(s.mode).toBe("rules");
    expect(s.woke).toEqual(expect.arrayContaining([
      { orderId: ORDER, outcome: "done", summary: expect.any(String) },
      { orderId: "ORD-002", outcome: "needs_claude", summary: expect.any(String) },
    ]));
    expect(store.getOrder(ORDER)!.status).toBe("PLAN_CHOSEN");
    expect(store.listTasks("ORD-002")).toEqual([]);
    expect(woken).toHaveLength(0);
  });
});

describe("scheduler and API", () => {
  it("the timer is never started under tests", async () => {
    expect(startHeartbeatScheduler()).toEqual({ started: false, reason: "tests" });
    await register();
    expect(heartbeatStatus().schedulerRunning).toBe(false);
  });

  it("interval comes from KESUNI_HEARTBEAT_SECONDS (0 = off)", () => {
    expect(heartbeatStatus().intervalSeconds).toBe(120);
    process.env.KESUNI_HEARTBEAT_SECONDS = "0";
    expect(heartbeatStatus()).toMatchObject({ enabled: false, nextRunAt: null });
    delete process.env.KESUNI_HEARTBEAT_SECONDS;
  });

  it("GET shows the last run; POST runs one now", async () => {
    expect((await (await GET()).json()).last).toBeNull();
    const j = await (await POST()).json();
    expect(j.last).toMatchObject({ trigger: "button", woke: [{ orderId: ORDER }] });
    expect(j.nextRunAt).toEqual(expect.any(String));
  });
});

describe("agent prints on the heartbeat (code, no Claude)", () => {
  const mem = new Map<string, Uint8Array>();
  const files: FileStore = { async put(k, b) { mem.set(k, b); }, async get(k) { return mem.get(k)!; }, async remove(k) { mem.delete(k); } };
  const IDLE = {
    gcode_state: "IDLE", sdcard: true, hms: [], nozzle_diameter: "0.4",
    ams: { ams: [{ id: "0", info: "1002", tray: [{ id: "0", tray_type: "PLA", tray_color: "FEC600FF", tray_sub_brands: "" }] }] },
  };
  async function paidOrderWithFile() {
    chooseQuote(ORDER, "Q-own", "agent", "within budget");
    store.saveOrder({ ...store.getOrder(ORDER)!, label: "real" });
    store.saveEscrow({
      orderId: ORDER, amountMicro: 30_000_000, escrowWalletId: "w1", escrowAddress: "0xe", customerWalletId: "w2", customerAddress: "0xc",
      state: "FUNDED", txs: [], network: "ARC-TESTNET", label: "testnet", createdAt: new Date().toISOString(),
    });
    setFileStore(files);
    const bytes = fake3mf({ projectColours: ["#FCE300"], plates: [{ index: 1, filaments: [{ id: 1, type: "PLA", color: "#FCE300", usedG: 9 }] }] });
    // As the studio PC slices it (the agent prints only those): the STL, the sliced file, and the done slice linking them.
    const src = await addAttachment(ORDER, { kind: "design", filename: "Benchy.stl", bytes: new TextEncoder().encode("solid b endsolid b"), uploadedBy: "Khelda" });
    const up = await addAttachment(ORDER, { kind: "design", filename: "Benchy.gcode.3mf", bytes, uploadedBy: SLICER_NAME });
    if (!up.ok || !src.ok) throw new Error("upload failed");
    const at = new Date().toISOString();
    store.insertSliceJob({
      id: store.nextSliceJobId(), orderId: ORDER, attachmentId: src.attachment.id, sourceName: "Benchy.stl", mode: "mesh", printerId: "a1", tray: 0,
      material: "PLA", color: "#FCE300", quality: "standard", infillPct: 20, supports: "auto", key: "test", state: "done", actor: "person", by: "Khelda",
      createdAt: at, updatedAt: at, resultAttachmentId: up.attachment.id,
    });
    ingestReport("a1", mergeReport(undefined, { print: IDLE }, new Date().toISOString())!, []);
    confirmColors("a1", "Khelda");
  }
  afterEach(() => setFileStore(undefined));

  it("with agent prints on, a paid order waiting for a printer does not wake Claude: the dispatcher says why it waits", async () => {
    await paidOrderWithFile();
    expect(setAutoPrint({ on: true, by: "Khelda", confirm: true }).ok).toBe(true);
    const s = await beat();
    const f = s.findings.find((x) => x.kind === "start_production")!;
    expect(f).toMatchObject({ wake: false, text: expect.stringContaining("Waiting for a person to confirm the bed on A1 Combo #1") });
    expect(fromHeartbeat()).toEqual([]);
  });

  it("the beat runs the dispatcher before any wake: after a person's 'Bed is empty' it queues the print", async () => {
    await paidOrderWithFile();
    expect(setAutoPrint({ on: true, by: "Khelda", confirm: true }).ok).toBe(true);
    expect(clearBed("a1", "Khelda").ok).toBe(true);
    // (the switch-on and bed routes run the dispatcher too; here only the beat does)
    const s = await beat(new Date(Date.now() + 1000));
    expect(s.actions.some((a) => /^Agent print PJ-\S+ for ORD-001 queued on a1$/.test(a))).toBe(true);
    expect(store.listPrintJobs()).toEqual([expect.objectContaining({ actor: "agent", bedConfirmedBy: "Khelda" })]);
    expect(fromHeartbeat()).toEqual([]);
  });

  it("with agent prints off the beat wakes the Chief as before and the dispatcher does nothing", async () => {
    await paidOrderWithFile();
    expect(clearBed("a1", "Khelda").ok).toBe(true);
    const s = await beat();
    expect(s.findings.find((x) => x.kind === "start_production")).toMatchObject({ wake: true });
    expect(store.listPrintJobs()).toEqual([]);
  });
});
