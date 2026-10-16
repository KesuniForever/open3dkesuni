import { beforeEach, describe, expect, it } from "vitest";
import * as store from "./store";
import { cachedLive, liveView, loadLive, peopleIn, safeLine, type Hide, type LiveRows } from "./live";
import { chiefAuthority } from "./agent/authority";
import { explorerTxBase } from "./network";
import { emptySnapshot, hmsUrl, stageOf, type AmsTray, type PrinterSnapshot } from "./printer/bambu";
import { issueTexts } from "@/app/machines/issue-texts";
import type { AgentLogEntry, ChainTx, Escrow, Order, Printer } from "./types";
import type { Traction } from "./traction";
import { makeT } from "../i18n/core";
import { ID } from "../i18n/id";

// The public page must never carry these, whatever the rows hold.
const SECRETS = [
  "Lia", "Kusuma", "keychain", "0812", "3456", "Jl. Sudirman", "lia@example.com", "abcdefabcdefabcdefabcdef", "Khelda", "Sabina",
  "lia_keychain", ".stl", ".3mf", "192.168.100.21", "03919D4A1201234", "12345678", "StudioWifi", "w-escrow-uuid", "w-cust-uuid",
  "0xescrowaddr", "0xcustaddr", "idem-key", "circle-tx-id", "Rumah Lia", "Please call", "Budi", "Santoso", "sk-ant",
];

const NOW = new Date("2026-10-16T05:00:00.000Z");
const at = (sec: number) => new Date(NOW.getTime() - 3_600_000 + sec * 1000).toISOString();
const RECENT = new Date(NOW.getTime() - 12_000).toISOString();
let seq = 0;
const row = (p: Partial<AgentLogEntry> & { tool: string; sec: number }): AgentLogEntry => ({
  id: ++seq, orderId: p.orderId ?? "ORD-010", actor: p.actor ?? "agent", tool: p.tool, input: p.input ?? {}, ok: p.ok ?? true,
  output: p.output ?? {}, at: at(p.sec),
});
const order = (id: string, label: Order["label"], extra: Partial<Order> = {}): Order => ({
  id, jobId: `JOB-${id}`, product: `Product ${id}`, quantity: 1, deadline: "2026-10-20", designVersion: "v1", mandateMicro: 50_000_000,
  status: "IN_PRODUCTION", label, ...extra,
});
const tray = (slot: number, type: string | null, color: string | null, bambu = false): AmsTray => ({
  ams: 0, slot, empty: !type, type, subBrand: bambu ? `${type} Basic` : null, infoIdx: null, color, colors: color ? [color] : [], remainPct: null, bambu,
});
const snap = (over: Partial<PrinterSnapshot>): PrinterSnapshot => ({ ...emptySnapshot(RECENT), state: "IDLE", ...over });
const tx = (kind: ChainTx["kind"], state: ChainTx["state"], sec: number, extra: Partial<ChainTx> = {}): ChainTx => ({
  kind, from: "0xcustaddr", to: "0xescrowaddr", amountMicro: 100_000, idempotencyKey: "idem-key", circleTxId: "circle-tx-id", state, at: at(sec), ...extra,
});
const HASH = `0x${"ab12".repeat(16)}`;

const real = order("ORD-010", "real", {
  product: "lia: keychain for Lia", customerName: "Lia Kusuma", customerNote: "Please call 0812-3456-7890, Jl. Sudirman No 5, lia@example.com",
  customerToken: "abcdefabcdefabcdefabcdef", review: { quality: 5, communication: 5, value: 5, text: "Rumah Lia", by: "Lia Kusuma", at: at(0) },
});
const sim = order("ORD-011", "simulated", { product: "Test vase", customerName: "Budi Santoso" });

// Fields a bridge or an older row might carry: never on the page.
const secretPrinter = { ip: "192.168.100.21", serial: "03919D4A1201234", accessCode: "12345678", wifiSsid: "StudioWifi" };
const printing: Printer = Object.assign({
  id: "a1", name: "A1 Combo #1", lastSeen: RECENT, currentOrderId: "ORD-010",
  colorsChecked: { by: "Khelda", at: RECENT, key: "k" },
  snapshot: snap({
    state: "RUNNING", percent: 45.6, layer: 120, totalLayers: 260, remainingMin: 65, jobName: "lia_keychain.gcode.3mf", fileName: "lia_keychain.gcode.3mf",
    stage: stageOf("RUNNING", [2, 0], 0), nozzleTemp: 219.6, nozzleTarget: 220, bedTemp: 65, bedTarget: 65,
    ams: { trays: [tray(0, "PLA", "#FEC600", true), tray(1, null, null), tray(2, "PETG", "#FFFFFF"), tray(3, "PLA", "#C12E1F", true)], activeSlot: 0, externalActive: false, humidity: null, lite: true },
  }),
}, secretPrinter);
const faulty: Printer = {
  id: "a1-3", name: "A1 Combo #3", lastSeen: RECENT, bedOccupiedBy: "ORD-011",
  bedCheck: { id: "BC-1", by: "Sabina", at: RECENT, via: "button" },
  snapshot: snap({ stage: null, hms: [{ code: "HMS_0510_0400_0001_0044", severity: 1, url: hmsUrl("0510040000010044"), since: RECENT }] }),
};
const offline: Printer = { id: "a1-2", name: "A1 Combo #2", lastSeen: new Date(NOW.getTime() - 10 * 60_000).toISOString(), snapshot: snap({}) };

const log: AgentLogEntry[] = [
  row({ tool: "agent_start", sec: 0, input: { trigger: "The operator pressed Run agent.", model: "claude-x" } }),
  row({ tool: "price_by_weight", sec: 5, output: { unitPriceIdr: 1650, totalIdr: 16500 } }),
  row({ tool: "agent_summary", sec: 10, input: { turns: 3 }, output: {
    text: "Priced lia: keychain for Lia for Lia Kusuma at Rp16.500. Khelda should load white PETG; the file lia_keychain.stl is ready. Call 0812-3456-7890 or see https://kesuni.example/c/abcdefabcdefabcdefabcdef. Printer 192.168.100.21, serial 03919D4A1201234.",
  } }),
  // As heartbeat.ts writes it: the product with the customer's name already hidden (agentText).
  row({ tool: "heartbeat", sec: 100, output: { findings: [{ text: "ORD-010 ([customer name]: keychain for [customer name]) is paid into escrow but has no printer yet. Start production." }] } }),
  row({ tool: "auto_print", sec: 200, input: { printerId: "a1", file: "ORD-010_p1.gcode.3mf", bedConfirmedBy: "Khelda" }, output: { printer: "A1 Combo #1", jobId: "PJ-1" } }),
  row({ tool: "message_customer", sec: 300, input: { text: "Halo Lia Kusuma, your keychain is printing." } }),
  row({ tool: "get_order", sec: 400, orderId: "ORD-011" }),
  row({ tool: "check_vendor_policy", sec: 401, orderId: "ORD-011", ok: false, input: { quoteId: "Q-p" }, output: { reasons: ["Price 35 USDC is above the mandate 32 USDC"] } }),
  row({ tool: "request_human_decision", sec: 402, orderId: "ORD-011", input: { question: "Sabina, should we accept the partner quote?" } }),
  // People's own rows are not the agent's work: never shown.
  row({ tool: "clear_bed", sec: 500, actor: "human", input: { printerId: "a1", by: "Khelda" }, output: { printer: "A1 Combo #1" } }),
];

const escrows: Escrow[] = [
  {
    orderId: "ORD-010", amountMicro: 100_000, escrowWalletId: "w-escrow-uuid", escrowAddress: "0xescrowaddr", customerWalletId: "w-cust-uuid",
    customerAddress: "0xcustaddr", state: "RELEASED", network: "ARC-TESTNET", label: "testnet", createdAt: at(0),
    txs: [
      tx("customer_topup", "COMPLETE", 10, { txHash: HASH, verified: { ok: true, at: at(11), internal: true } }),
      tx("deposit", "COMPLETE", 20, { txHash: HASH, verified: { ok: true, at: at(21) } }),
      tx("release", "COMPLETE", 30, { txHash: HASH }),
    ],
  },
  {
    orderId: "ORD-011", amountMicro: 100_000, escrowWalletId: "w-escrow-uuid", escrowAddress: "0xescrowaddr", customerWalletId: "w-cust-uuid",
    customerAddress: "0xcustaddr", state: "FUNDED", network: "ARC-TESTNET", label: "testnet", createdAt: at(0),
    txs: [tx("deposit", "COMPLETE", 40, { txHash: HASH, verified: { ok: false, at: at(41), reason: "no transfer" } }), tx("refund", "FAILED", 50)],
  },
  { ...escrowsBase("ORD-404"), txs: [tx("deposit", "COMPLETE", 60, { txHash: HASH })] },
];
function escrowsBase(orderId: string): Escrow {
  return { orderId, amountMicro: 1, escrowWalletId: "w", escrowAddress: "0x", customerWalletId: "c", customerAddress: "0x", state: "FUNDED", network: "ARC-TESTNET", label: "testnet", createdAt: at(0), txs: [] };
}

const usage: Traction = {
  computedAt: NOW.toISOString(), rule: "Simulated orders, demo top-ups and internal transfers are not counted.", realCustomers: 1, realOrders: 1,
  realOrdersByStatus: { CREATED: 0, PLAN_CHOSEN: 0, IN_PRODUCTION: 1, EVIDENCE_SUBMITTED: 0, ACCEPTED: 0, REJECTED: 0, PAID: 0 },
  arcTxs: {
    count: 2, byKind: { deposit: 1, release: 1, refund: 0 }, verifiedOnArc: 1, mismatchOnArc: 0, notCheckedYet: 1,
    volume: { testnet: { micro: 200_000, usdc: "0.2" }, mainnet: { micro: 0, usdc: "0" } },
    last: [{ orderId: "ORD-010", kind: "deposit", amountMicro: 1, amountUsdc: "0.000001", network: "ARC-TESTNET", networkLabel: "testnet", txHash: HASH, explorerUrl: "x", verifiedOnArc: true, at: at(0) }],
  },
  excluded: { simulatedOrders: 1, demoTopups: 1 },
};

const rows = (over: Partial<LiveRows> = {}, locale: "en" | "id" = "en"): LiveRows => ({
  printers: [printing, offline, faulty], orders: [real, sim], log, escrows, usage, agentPrints: { on: false },
  network: { name: "Arc Testnet", isTestnet: true }, issueTexts: issueTexts([printing, offline, faulty], locale),
  people: peopleIn({ tasks: [], printers: [printing, faulty], jobs: [] }), ...over,
});

beforeEach(() => { seq = log.length; });

describe("live view: nothing private leaks", () => {
  it("no name, phone, address, email, token, file name, IP, serial, access code, Wi-Fi or wallet detail anywhere", () => {
    for (const locale of ["en", "id"] as const) {
      const json = JSON.stringify(liveView(rows({}, locale), NOW, makeT(locale, ID), locale));
      for (const s of SECRETS) expect(json, `${locale}: ${s}`).not.toContain(s);
    }
  });

  it("each printer, agent entry and transfer carries only its allow-listed fields", () => {
    const v = liveView(rows(), NOW);
    expect(Object.keys(v).sort()).toEqual(["agent", "agentCheck", "agentPrints", "at", "lastReport", "network", "overview", "printers", "transfers", "usage"]);
    expect(Object.keys(v.printers[0]).sort()).toEqual([
      "ams", "bed", "bedHolds", "bedTarget", "external", "faults", "id", "lastReport", "layer", "name", "nozzle", "nozzleTarget", "online",
      "order", "pill", "progress", "remaining", "stage",
    ]);
    expect(Object.keys(v.agent[0]).sort()).toEqual(["asked", "at", "id", "kind", "line", "mode", "order", "refused", "repeats", "skill", "title", "when"]);
    expect(Object.keys(v.transfers[0]).sort()).toEqual(["amount", "at", "check", "explorerUrl", "hash", "id", "kind", "order", "state", "testnet", "when"]);
    expect(Object.keys(v.usage).sort()).toEqual(["arcTransfers", "mismatch", "realCustomers", "realOrders", "rule", "simulatedOrders", "testTransfers", "unchecked", "verified"]);
    expect(v.printers[0].ams?.slots.map((s) => Object.keys(s).sort().join())).toEqual(Array(4).fill("active,color,colors,empty,name,slot,type"));
    const o = v.overview;
    expect(Object.keys(o).sort()).toEqual(["agent", "money", "orders", "printers"]);
    expect(Object.keys(o.printers).sort()).toEqual(["online", "paused", "printing", "ready", "running", "toCollect", "total"]);
    expect(Object.keys(o.printers.running[0]).sort()).toEqual(["doneAt", "id", "name", "needsPerson", "online", "order", "paused", "percent", "remaining", "stage"]);
    expect(Object.keys(o.printers.toCollect[0]).sort()).toEqual(["name", "order"]);
    expect(Object.keys(o.orders).sort()).toEqual(["finished", "inProgress", "next", "real", "simulated", "total"]);
    expect(Object.keys(o.orders.next!).sort()).toEqual(["day", "due", "late", "order"]);
    expect(Object.keys(o.money).sort()).toEqual(["real", "test", "transfers", "verified", "volume"]);
    expect(Object.keys(o.agent).sort()).toEqual(["claudeRuns", "decisions", "handedToPerson"]);
  });
});

describe("live view: the overview", () => {
  it("running now: each printing or paused printer with Bambu's stage, time left and the finish time in WIB; the rest counted", () => {
    const o = liveView(rows(), NOW).overview;
    // 12:00 WIB now; Bambu reported 65 min left 12 s ago: done around 13:04.
    expect(o.printers).toEqual({
      total: 3, online: 2, printing: 1, paused: 0, ready: 0,
      running: [{
        id: "a1", name: "A1 Combo #1", percent: 45, paused: false, online: true, stage: "Printing", needsPerson: false, remaining: "1h 05m",
        doneAt: "13:04", order: { id: "ORD-010", label: "real" },
      }],
      toCollect: [{ name: "A1 Combo #3", order: { id: "ORD-011", label: "simulated" } }],
    });
    // The same printers as the Printers tab.
    const v = liveView(rows(), NOW);
    expect(o.printers.online).toBe(v.printers.filter((p) => p.online).length);
    expect(o.printers.running.map((r) => r.id)).toEqual(v.printers.filter((p) => p.progress).map((p) => p.id));
    expect(liveView(rows({}, "id"), NOW, makeT("id", ID), "id").overview.printers.running[0]).toMatchObject({ doneAt: "13.04", remaining: "1j 05m" });
  });

  it("a finish after midnight says tomorrow; paused, offline or without Bambu's minutes: no finish time", () => {
    const late = { ...printing, snapshot: { ...printing.snapshot!, remainingMin: 900 } };
    expect(liveView(rows({ printers: [late] }), NOW).overview.printers.running[0].doneAt).toBe("tomorrow 02:59");
    expect(liveView(rows({ printers: [late] }, "id"), NOW, makeT("id", ID), "id").overview.printers.running[0].doneAt).toBe("besok 02.59");
    const later = { ...printing, snapshot: { ...printing.snapshot!, remainingMin: 2 * 24 * 60 } };
    expect(liveView(rows({ printers: [later] }), NOW).overview.printers.running[0].doneAt).toBe("18 Oct, 11:59");
    const paused = { ...printing, snapshot: { ...printing.snapshot!, state: "PAUSE" as const } };
    expect(liveView(rows({ printers: [paused] }), NOW).overview.printers).toMatchObject({ printing: 0, paused: 1, running: [{ paused: true, doneAt: null }] });
    const gone = { ...printing, lastSeen: new Date(NOW.getTime() - 10 * 60_000).toISOString() };
    expect(liveView(rows({ printers: [gone] }), NOW).overview.printers).toMatchObject({ online: 0, printing: 0, running: [{ online: false, doneAt: null }] });
    const noTime = { ...printing, snapshot: { ...printing.snapshot!, remainingMin: null } };
    expect(liveView(rows({ printers: [noTime] }), NOW).overview.printers.running[0]).toMatchObject({ remaining: "—", doneAt: null });
  });

  it("nothing printing: no running printer, the ready ones counted", () => {
    const idle: Printer = { id: "a1-4", name: "A1 Combo #4", lastSeen: RECENT, snapshot: snap({ state: "FINISH" }) };
    expect(liveView(rows({ printers: [idle, offline] }), NOW).overview.printers).toEqual({
      total: 2, online: 1, printing: 0, paused: 0, ready: 1, running: [], toCollect: [],
    });
  });

  it("orders: in progress and finished as the Orders page counts, real vs simulated, and the next deadline by id and label only", () => {
    const o = liveView(rows(), NOW).overview.orders;
    // Both IN_PRODUCTION, due 20 Oct: the lower id first.
    expect(o).toEqual({
      total: 2, inProgress: 2, finished: 0, real: 1, simulated: 1,
      next: { order: { id: "ORD-010", label: "real" }, due: "in 4 d", day: "Tue 20 Oct", late: false },
    });
    const more = [
      real, sim,
      order("ORD-012", "simulated", { status: "PLAN_CHOSEN", deadline: "2026-10-14" }),
      order("ORD-013", "real", { status: "EVIDENCE_SUBMITTED", deadline: "2026-10-01" }), // made already: its deadline is met
      order("ORD-014", "real", { status: "ACCEPTED" }),
      order("ORD-015", "real", { status: "PAID" }),
      order("ORD-016", "simulated", { status: "REJECTED" }),
    ];
    expect(liveView(rows({ orders: more }), NOW).overview.orders).toEqual({
      total: 7, inProgress: 5, finished: 2, real: 4, simulated: 3,
      next: { order: { id: "ORD-012", label: "simulated" }, due: "2 d late", day: "Wed 14 Oct", late: true },
    });
    expect(liveView(rows({ orders: more }, "id"), NOW, makeT("id", ID), "id").overview.orders.next).toMatchObject({ due: "telat 2 hari", day: "Rab 14 Okt" });
    const today = order("ORD-017", "real", { deadline: "2026-10-16" });
    expect(liveView(rows({ orders: [today] }), NOW).overview.orders.next).toMatchObject({ due: "today", late: false });
    expect(liveView(rows({ orders: [order("ORD-018", "real", { status: "PAID" })] }), NOW).overview.orders.next).toBeNull();
    expect(liveView(rows({ orders: [] }), NOW).overview.orders).toEqual({ total: 0, inProgress: 0, finished: 0, real: 0, simulated: 0, next: null });
  });

  it("Arc transfers: real orders as counted, the tests apart, never added across networks; the Money tab's numbers", () => {
    const v = liveView(rows(), NOW);
    // Real: the usage's 2 counted transfers (1 verified, 0.2 test USDC). Tests: the simulated order's deposit (Arc did not
    // match), the removed order's deposit (not checked) and the real order's demo top-up (verified): 3, 0.3 test USDC.
    expect(v.overview.money).toEqual({
      transfers: 5, verified: 2, volume: { testUsdc: "0.5", usdc: "0" },
      real: { transfers: 2, verified: 1, volume: { testUsdc: "0.2", usdc: "0" } },
      test: { transfers: 3, verified: 1, volume: { testUsdc: "0.3", usdc: "0" } },
    });
    expect(v.overview.money.real.transfers).toBe(v.usage.arcTransfers);
    expect(v.overview.money.real.verified).toBe(v.usage.verified);
    expect(v.overview.money.test.transfers).toBe(v.usage.testTransfers);
    // A mainnet transfer is real USDC: never added to test USDC.
    const main: Escrow = { ...escrowsBase("ORD-011"), network: "ARC", txs: [tx("deposit", "COMPLETE", 70, { amountMicro: 2_500_000, txHash: HASH })] };
    expect(liveView(rows({ escrows: [...escrows, main] }), NOW).overview.money).toMatchObject({
      transfers: 6, volume: { testUsdc: "0.5", usdc: "2.5" }, test: { transfers: 4, volume: { testUsdc: "0.3", usdc: "2.5" } },
    });
    // No transfer at all: zeros, not missing.
    const none = { ...usage, arcTxs: { ...usage.arcTxs, count: 0, verifiedOnArc: 0, notCheckedYet: 0, volume: { testnet: { micro: 0, usdc: "0" }, mainnet: { micro: 0, usdc: "0" } } } };
    expect(liveView(rows({ usage: none, escrows: [] }), NOW).overview.money).toEqual({
      transfers: 0, verified: 0, volume: { testUsdc: "0", usdc: "0" },
      real: { transfers: 0, verified: 0, volume: { testUsdc: "0", usdc: "0" } }, test: { transfers: 0, verified: 0, volume: { testUsdc: "0", usdc: "0" } },
    });
  });

  it("the agent today (Jakarta day): Claude runs, decisions and questions to a person; yesterday and people's rows do not count", () => {
    expect(liveView(rows(), NOW).overview.agent).toEqual({ claudeRuns: 1, decisions: 1, handedToPerson: 1 });
    const yesterday = new Date("2026-10-15T16:59:00.000Z").toISOString(); // 23:59 WIB on 15 Oct
    const extra = [
      { ...row({ tool: "choose_plan", sec: 0 }), at: yesterday },
      { ...row({ tool: "agent_start", sec: 0 }), at: yesterday },
      row({ tool: "choose_printer", sec: 600, actor: "human" }),
      row({ tool: "choose_plan", sec: 700, ok: false }),
      row({ tool: "create_operator_task", sec: 800, input: { kind: "check_printer" } }),
    ];
    expect(liveView(rows({ log: [...log, ...extra] }), NOW).overview.agent).toEqual({ claudeRuns: 1, decisions: 2, handedToPerson: 1 });
  });
});

describe("live view: printers", () => {
  it("a printing A1: state with %, Bambu's stage, layers, time left, temperatures, the AMS spools and the linked order's label", () => {
    const p = liveView(rows(), NOW).printers[0];
    expect(p).toMatchObject({
      name: "A1 Combo #1", online: true, lastReport: "12 s ago", pill: { tone: "busy", text: "Printing 45%" }, stage: { text: "Printing", needsPerson: false },
      progress: { percent: 45, paused: false }, layer: "120 / 260", remaining: "1h 05m", nozzle: "220 °C", nozzleTarget: 220, bed: "65 °C", bedTarget: 65,
      order: { id: "ORD-010", label: "real" }, bedHolds: null, faults: [],
    });
    expect(p.ams).toEqual({ lite: true, slots: [
      { slot: 1, empty: false, type: "PLA", name: "Yellow", color: "#FEC600", colors: ["#FEC600"], active: true },
      { slot: 2, empty: true, type: null, name: null, color: null, colors: [], active: false },
      { slot: 3, empty: false, type: "PETG", name: "White", color: "#FFFFFF", colors: ["#FFFFFF"], active: false },
      { slot: 4, empty: false, type: "PLA", name: "Red", color: "#C12E1F", colors: ["#C12E1F"], active: false },
    ] });
  });

  it("offline, a fault in Bambu's words (English and Indonesian), and a bed holding a simulated order's part", () => {
    const [, off, bad] = liveView(rows(), NOW).printers;
    expect(off).toMatchObject({ online: false, lastReport: "10 min ago", pill: { tone: "bad", text: "Offline" }, order: null, bedHolds: null });
    expect(bad.pill).toEqual({ tone: "bad", text: "Printer error" });
    expect(bad.bedHolds).toEqual({ order: { id: "ORD-011", label: "simulated" } });
    expect(bad.faults).toEqual([{
      code: "HMS_0510_0400_0001_0044", tone: "bad", level: "fatal", text: expect.stringMatching(/firmware of AMS lite does not match the printer/i),
      url: "https://e.bambulab.com/index.php?e=0510040000010044&d=039&s=device_hms&lang=en",
    }]);
    const id = liveView(rows({}, "id"), NOW, makeT("id", ID), "id").printers;
    expect(id[2].faults[0].text).toMatch(/Firmware AMS lite tidak sesuai dengan printer/);
    expect(id[0].pill.text).toBe("Mencetak 45%");
    expect(id[1].lastReport).toBe("10 mnt lalu");
  });

  it("a bed holding a print without an order, and a fault link that is not Bambu's is dropped", () => {
    const odd: Printer = { ...faulty, bedOccupiedBy: "a print without an order", snapshot: snap({ hms: [{ code: "HMS_0300_0100_0003_0001", severity: 3, url: "https://evil.example/x", since: null }] }) };
    const p = liveView(rows({ printers: [odd] }), NOW).printers[0];
    expect(p.bedHolds).toEqual({ order: null });
    expect(p.faults[0]).toMatchObject({ tone: "warn", url: null });
  });
});

describe("live view: the agent at work", () => {
  it("newest first, with the skill, the order's label, and markers for a policy refusal and a question to a person", () => {
    const agent = liveView(rows(), NOW).agent;
    expect(agent.map((a) => [a.title, a.order, a.skill])).toEqual([
      ["Rule-based planner", { id: "ORD-011", label: "simulated" }, "Operations"],
      ["Messaged the customer", { id: "ORD-010", label: "real" }, "Customer"],
      ["Agent started a print on A1 Combo #1", { id: "ORD-010", label: "real" }, "Machines"],
      ["Heartbeat noticed 1 problem", { id: "ORD-010", label: "real" }, "Operations"],
      ["Chief run · a person asked", { id: "ORD-010", label: "real" }, "Finance"],
    ]);
    expect(agent[0]).toMatchObject({ refused: 1, asked: true, kind: "run", mode: "rules" });
    expect(agent[4]).toMatchObject({ refused: 0, asked: false, kind: "run", mode: "claude", when: "16 Oct, 11:00" });
  });

  it("lines: the Chief's summary without names, contacts, links, files, IPs or serials; no line for a print or a customer message", () => {
    const agent = liveView(rows(), NOW).agent;
    const summary = agent[4].line;
    expect(summary).toMatch(/^Priced for \[customer name\] at Rp16\.500\. a person should load white PETG; the file \[file\] is ready\. Call \[number hidden\]/);
    expect(summary.length).toBeLessThanOrEqual(160);
    expect(agent[3].line).toBe("ORD-010 is paid into escrow but has no printer yet. Start production.");
    expect(agent[2].line).toBe(""); // the file name and the person who confirmed the bed
    expect(agent[1].line).toBe(""); // the customer's message
    expect(agent[0].line).toBe("Asked a person: a person, should we accept the partner quote?");
  });

  it("a run where Claude could not be reached shows no API error text", () => {
    const down = [row({ tool: "agent_start", sec: 0, input: { trigger: "The operator pressed Run agent." } }),
      row({ tool: "llm_unavailable", sec: 1, output: { error: "401 invalid x-api-key sk-ant-secret request_id req_123" } })];
    const [a] = liveView(rows({ log: down }), NOW).agent;
    expect(a.line).toBe("Claude could not be reached. The rules carried on.");
    expect(JSON.stringify(a)).not.toMatch(/sk-ant|req_123|x-api-key/);
    // The same error logged on its own (outside a run): its title only.
    const [alone] = liveView(rows({ log: [row({ tool: "llm_unavailable", sec: 5, output: { error: "401 invalid x-api-key request_id req_123" } })] }), NOW).agent;
    expect(alone).toMatchObject({ title: "Claude unavailable", line: "" });
  });

  it("the agent-prints switch shows on or off, never who set it", () => {
    expect(liveView(rows({ agentPrints: { on: true } }), NOW).agentPrints).toEqual({ on: true, locked: false, started: 0 });
    expect(liveView(rows({ agentPrints: { on: false, started: 2 } }), NOW).agentPrints).toEqual({ on: false, locked: false, started: 2 });
  });
});

describe("live view: money on Arc", () => {
  it("transfers newest first with amount, label, the Arc check and an explorer link; a removed order's escrow is left out", () => {
    const t = liveView(rows(), NOW).transfers;
    expect(t.map((x) => [x.kind, x.order.id, x.order.label, x.state, x.check])).toEqual([
      ["refund", "ORD-011", "simulated", "failed", null],
      ["deposit", "ORD-011", "simulated", "complete", "mismatch"],
      ["release", "ORD-010", "real", "complete", "unchecked"],
      ["deposit", "ORD-010", "real", "complete", "verified"],
      ["topup", "ORD-010", "real", "complete", "verified"],
    ]);
    expect(t[3]).toMatchObject({ amount: "0.1", testnet: true, explorerUrl: `${explorerTxBase("ARC-TESTNET")}${HASH}`, hash: "0xab12ab…ab12" });
    expect(t[0]).toMatchObject({ explorerUrl: null, hash: null });
  });

  it("the real-usage counts, zeros included", () => {
    // Not counted: the simulated order's complete deposit, the removed order's deposit and the real order's demo top-up.
    expect(liveView(rows(), NOW).usage).toMatchObject({ realCustomers: 1, realOrders: 1, arcTransfers: 2, verified: 1, unchecked: 1, simulatedOrders: 1, testTransfers: 3 });
    const none = { ...usage, realCustomers: 0, realOrders: 0, arcTxs: { ...usage.arcTxs, count: 0, verifiedOnArc: 0, notCheckedYet: 0 } };
    expect(liveView(rows({ usage: none }), NOW).usage).toMatchObject({ realCustomers: 0, realOrders: 0, arcTransfers: 0, verified: 0 });
  });
});

describe("safeLine", () => {
  const hide: Hide = { customers: ["Lia Kusuma"], people: ["Khelda"], products: ["lia: keychain for Lia"] };
  it("hides what a summary must not show and keeps the rest", () => {
    expect(safeLine("Deadline 2026-10-20 for ORD-010 (lia: keychain for Lia); Khelda checks it.", hide)).toBe("Deadline 2026-10-20 for ORD-010; a person checks it.");
    expect(safeLine("Mail lia@example.com, WA +62 812 3456 7890", hide)).toBe("Mail [email hidden], WA [number hidden]");
    expect(safeLine("See https://x.example/c/abc and /c/abcdef, tx 0xabcdef0123456789abcdef", hide)).toBe("See [link hidden] and [link hidden], tx [hidden]");
    expect(safeLine("HMS_0510_0400_0001_0044 on A1 Combo #3, error 0700-8011", hide)).toBe("HMS_0510_0400_0001_0044 on A1 Combo #3, error 0700-8011");
    expect(safeLine("Ring 0812-3456-7890 about error 0300-400C", hide)).toBe("Ring [number hidden] about error 0300-400C");
    expect(safeLine("Lia Kusuma and lia both asked; Khelda (owner) replied", hide)).toBe("[customer name] and [customer name] both asked; a person (owner) replied");
    expect(safeLine("x".repeat(300), hide, 50)).toHaveLength(50);
  });

  it("a 'by' field is not always a name: only its name words are hidden, not 'for', 'Combo' or 'test'", () => {
    const people = ["Claude for Khelda (duplicate cleanup)", "A1 Combo #3 (no longer reported)", "Bridge dry-run test", "operator", "khelda"];
    const h: Hide = { customers: ["Claude test"], people, products: [] };
    expect(safeLine("Task for the operator: print finished on A1 Combo #1 for Khelda, a Bridge dry-run test by Claude.", h))
      .toBe("Task for the operator: print finished on A1 Combo #1 for a person, a Bridge dry-run test by Claude.");
  });
});

describe("product titles never show, also when the stored text was cut inside one", () => {
  // A long title with other people's names in it, as a customer may type it (up to 200 characters).
  const long = "lia: wedding souvenir keychains with the names Budi Hartono and Sari Wulandari engraved on both sides, gold PLA, 50 pieces, packed in small boxes";
  const wedding = order("ORD-012", "real", { product: long, customerName: "Lia Kusuma" });
  const lamp = order("ORD-001", "real", { product: "Custom lamp side table (3D-printed components)" });
  const label = `ORD-012 (${long.replace(/\blia\b/gi, "[customer name]")})`;

  it("a heartbeat finding and a stale-task quote with a 140+ character product", () => {
    const stale = `ORD-012 (${long.replace(/\blia\b/gi, "[customer name]")}) has no price yet.`;
    const log2 = [
      row({ tool: "heartbeat", sec: 10, orderId: "ORD-012", output: { findings: [{ text: `${label} is paid into escrow but has no printer yet. Start production.` }] } }),
      row({ tool: "heartbeat", sec: 20, orderId: "ORD-012", output: { findings: [{ text: `Task for ORD-012 has been open for more than 6 hours: "${stale.slice(0, 140)}…"` }] } }),
    ];
    const agent = liveView(rows({ orders: [wedding], log: log2 }), NOW).agent;
    expect(agent.map((a) => a.line)).toEqual([
      "Task for ORD-012 has been open for more than 6 hours: “…”",
      "ORD-012 is paid into escrow but has no printer yet. Start production.",
    ]);
    expect(JSON.stringify(agent)).not.toMatch(/wedding|Budi|Hartono|Sari|Wulandari|keychain|gold PLA/i);
  });

  it("a task or a question that quotes the title shortened, reworded or in lower case", () => {
    const log2 = [
      row({ tool: "create_operator_task", sec: 10, orderId: "ORD-001", input: { kind: "check_printer", text: "ORD-001 (Custom lamp side table, qty 1) is past its deadline. Check it and tell the customer." } }),
      row({ tool: "agent_start", sec: 20, orderId: "ORD-001", input: { trigger: "The owner approved an exception for this order." } }),
      row({ tool: "agent_summary", sec: 21, orderId: "ORD-001", output: { text: "ORD-001 is a custom lamp side table; I priced it at Rp50.000." } }),
    ];
    const agent = liveView(rows({ orders: [lamp], log: log2 }), NOW).agent;
    expect(agent.map((a) => [a.title, a.line])).toEqual([
      ["Chief run · after the owner's OK", "ORD-001 is a; I priced it at Rp50.000."],
      ["Agent opened a task for a person", "ORD-001 is past its deadline. Check it and tell the customer."],
    ]);
    expect(JSON.stringify(agent)).not.toMatch(/lamp side table/i);
  });

  it("safeLine drops any order label in brackets, also one cut short", () => {
    const h: Hide = { customers: [], people: [], products: [] };
    expect(safeLine("ORD-004 (desk lamp, white) and ORD-005 (vase (tall)) are done; ORD-006 (key", h)).toBe("ORD-004 and ORD-005 are done; ORD-006");
  });
});

describe("live view: who did the work", () => {
  it("a print a person started shows as theirs (no name, no file), never as the agent's", () => {
    const start = row({ tool: "start_print", sec: 600, actor: "human", input: { printerId: "a1", attachmentId: "A-1", by: "Khelda" },
      output: { jobId: "PJ-1", printer: "A1 Combo #1" } });
    const [a] = liveView(rows({ log: [...log, start] }), NOW).agent;
    expect(a).toMatchObject({ kind: "person", title: "A person started a print on A1 Combo #1", line: "", skill: "Machines", order: { id: "ORD-010", label: "real" } });
    expect(JSON.stringify(a)).not.toMatch(/Khelda|A-1|PJ-1/);
    const id = liveView(rows({ log: [...log, start] }, "id"), NOW, makeT("id", ID), "id").agent[0];
    expect(id.title).toBe("Seseorang memulai cetak di A1 Combo #1");
  });

  it("the heartbeat's last round and the newest printer report", () => {
    const v = liveView(rows({ heartbeat: { at: new Date(NOW.getTime() - 90_000).toISOString(), mode: "claude" } }), NOW);
    expect(v.agentCheck).toMatchObject({ ago: "2 min ago", mode: "claude" });
    expect(v.lastReport).toBe("12 s ago");
    expect(liveView(rows({ heartbeat: null, printers: [] }), NOW)).toMatchObject({ agentCheck: null, lastReport: null });
  });

  it("a fault task in Bambu's words in the page's language", () => {
    const text = "A1 Combo #3 reports HMS_0510_0400_0001_0044 (fatal): The firmware of AMS lite does not match the printer. Check the printer before the next print. https://e.bambulab.com/index.php?e=0510040000010044";
    const task = row({ tool: "create_operator_task", sec: 10, orderId: "printer:a1-3", input: { kind: "check_printer", printerId: "a1-3", text } });
    const en = liveView(rows({ log: [task] }), NOW).agent[0];
    expect(en).toMatchObject({ title: "Agent opened a task for a person", order: null });
    expect(en.line).toMatch(/^A1 Combo #3 reports HMS_0510_0400_0001_0044 \(fatal\): .*firmware of AMS lite/i);
    expect(en.line).not.toMatch(/http|link hidden|“…”/); // Bambu's `the "Firmware" page` is not a quote to hide
    const id = liveView(rows({ log: [task] }, "id"), NOW, makeT("id", ID), "id").agent[0];
    expect(id.line).toMatch(/^A1 Combo #3 melaporkan HMS_0510_0400_0001_0044 \(fatal\): Firmware AMS lite tidak sesuai/);
  });
});

describe("safeLine: names and numbers", () => {
  it("a two-letter customer name as written, and a phone number that starts like a Bambu code", () => {
    const h: Hide = { customers: ["Al"], people: [], products: [] };
    expect(safeLine("Al asked for a blue one; ALL good.", h)).toBe("[customer name] asked for a blue one; ALL good.");
    expect(safeLine("Call the customer back on 0812-3456 7890 today.", h)).toBe("Call the customer back on [number hidden] today.");
    expect(safeLine("Call +62 0812-3456 today, error 0700-8011 again.", h)).toBe("Call [number hidden] today, error 0700-8011 again.");
    expect(safeLine("Due 2026-10-20 17:00.", h)).toBe("Due 2026-10-20 17:00.");
  });
});

describe("loadLive: from the store", () => {
  beforeEach(() => store.resetDb());

  it("reads the store without leaking the customer, the people or the files", () => {
    store.saveOrder(real);
    store.saveOrder(sim);
    store.savePrinter(printing);
    store.savePrinter(faulty);
    for (const e of log) store.addLog({ orderId: e.orderId, actor: e.actor, tool: e.tool, input: e.input, ok: e.ok, output: e.output, at: e.at });
    store.setMeta("autoPrint", { on: true, by: "Khelda", at: RECENT });
    // A person named only on a file they uploaded, and in the Chief's words.
    store.saveAttachment({ id: "A-9", orderId: "ORD-010", kind: "design", filename: "x.3mf", size: 1, mime: "model/3mf", uploadedBy: "Rina", at: RECENT, storageKey: "k" });
    store.addLog({ orderId: "ORD-010", actor: "agent", tool: "heartbeat", input: {}, ok: true, output: { findings: [{ text: "Rina still has to load the white PETG." }] }, at: at(900) });
    store.setMeta("heartbeatLast", { at: at(950), trigger: "timer", mode: "rules", findings: [], woke: [], actions: [], errors: [], durationMs: 1 });
    const v = loadLive(makeT("en", ID), "en", NOW);
    expect(v.printers.map((p) => p.name)).toEqual(["A1 Combo #1", "A1 Combo #3"]);
    expect(v.agentPrints).toEqual({ on: true, locked: false, started: 0 });
    expect(v.agentCheck).toMatchObject({ at: at(950), mode: "rules" });
    expect(v.agent[0].line).toBe("a person still has to load the white PETG.");
    // Today's decisions and questions to a person: the Chief page's numbers.
    const today = chiefAuthority(NOW).today;
    expect(v.overview.agent).toMatchObject({ decisions: today.decisions, handedToPerson: today.escalations });
    expect(v.overview.agent.decisions).toBeGreaterThan(0);
    // Real vs simulated and the transfers: the counts of the Money tab.
    expect(v.overview.orders).toMatchObject({ total: v.usage.realOrders + v.usage.simulatedOrders, real: v.usage.realOrders, simulated: v.usage.simulatedOrders });
    const json = JSON.stringify(v);
    for (const s of [...SECRETS, "Rina"]) expect(json, s).not.toContain(s);
  });

  it("cachedLive shapes the page once per language for a few seconds", () => {
    store.saveOrder(real);
    const t0 = NOW.getTime();
    const a = cachedLive(makeT("en", ID), "en", t0);
    store.savePrinter(printing);
    expect(cachedLive(makeT("en", ID), "en", t0 + 5_000)).toBe(a);
    expect(cachedLive(makeT("id", ID), "id", t0 + 5_000)).not.toBe(a);
    expect(cachedLive(makeT("en", ID), "en", t0 + 9_000).printers).toHaveLength(1);
  });
});
