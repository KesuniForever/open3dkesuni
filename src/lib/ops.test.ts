import { beforeEach, describe, expect, it } from "vitest";
import * as store from "./store";
import {
  ago, auditEvents, chainRows, chiefFeed, collapseRepeats, dbWhere, describeEntry, integrationRows, loadAudit, loadMoneyFlow,
  matchesFilter, moneyFlow, oneLine, pickFilter, plain, triggerTitle, wib, type IntegrationInput,
} from "./ops";
import type { AgentLogEntry, ChainTx, Escrow, Order, Quote } from "./types";
import { agreementHash } from "./agreement";
import { makeT } from "../i18n/core";

let seq = 0;
const T0 = Date.parse("2026-10-14T10:00:00.000Z");
const at = (sec: number) => new Date(T0 + sec * 1000).toISOString();
const row = (p: Partial<AgentLogEntry> & { tool: string; sec: number }): AgentLogEntry => ({
  id: ++seq, orderId: p.orderId ?? "ORD-001", actor: p.actor ?? "agent", tool: p.tool, input: p.input ?? {}, ok: p.ok ?? true,
  output: p.output ?? {}, at: at(p.sec),
});
const order = (id: string, label: Order["label"], extra: Partial<Order> = {}): Order => ({
  id, jobId: `JOB-${id}`, product: `Product ${id}`, quantity: 1, deadline: "2026-10-20", designVersion: "v1", mandateMicro: 50_000_000,
  status: "CREATED", label, ...extra,
});
const tx = (kind: ChainTx["kind"], state: ChainTx["state"], amountMicro: number, extra: Partial<ChainTx> = {}): ChainTx => ({
  kind, from: "0xa", to: "0xb", amountMicro, idempotencyKey: `${kind}-${state}-${amountMicro}`, state, at: at(500), ...extra,
});
const escrow = (orderId: string, state: Escrow["state"], txs: ChainTx[], network = "ARC-TESTNET"): Escrow => ({
  orderId, amountMicro: 10_000_000, escrowWalletId: "w", escrowAddress: "0xe", customerWalletId: "c", customerAddress: "0xc",
  state, txs, network, label: network === "ARC" ? "mainnet" : "testnet", createdAt: at(400),
});

beforeEach(() => { seq = 0; });

describe("text and time helpers", () => {
  it("strips markdown and keeps one short first paragraph", () => {
    expect(plain("**Payment:** the `escrow` is empty\n\n\n\nNext")).toBe("Payment: the escrow is empty\n\nNext");
    expect(oneLine("I could not run it.\nStill one paragraph.\n\nSecond paragraph")).toBe("I could not run it. Still one paragraph.");
    const long = oneLine("x".repeat(300), 50);
    expect(long).toHaveLength(50);
    expect(long.endsWith("…")).toBe(true);
  });

  it("writes Jakarta time and relative time", () => {
    expect(wib("2026-10-14T23:30:00.000Z")).toBe("15 Oct, 06:30");
    const now = new Date("2026-10-15T12:00:00.000Z");
    expect(ago("2026-10-15T11:59:30.000Z", now)).toBe("just now");
    expect(ago("2026-10-15T11:55:00.000Z", now)).toBe("5 min ago");
    expect(ago("2026-10-15T09:00:00.000Z", now)).toBe("3 h ago");
    expect(ago("2026-10-13T12:00:00.000Z", now)).toBe("2 days ago");
    expect(ago("2026-10-14T11:00:00.000Z", now)).toBe("1 day ago");
  });

  it("names why the Chief woke up from the trigger text the code writes", () => {
    expect(triggerTitle("Heartbeat check (timer) found: ORD-001 has no price yet.")).toBe("Woken by the heartbeat");
    expect(triggerTitle("The operator pressed Run agent.")).toBe("Run by the operator");
    expect(triggerTitle("The customer's payment just arrived in escrow. Start production.")).toBe("Payment arrived in escrow");
    expect(triggerTitle("Something new")).toBe("Chief woke up");
  });

  it("describes log rows in rupiah written the Indonesian way", () => {
    const d = describeEntry(row({ tool: "price_by_weight", sec: 0, output: { unitPriceIdr: 1650, totalIdr: 1_200_000 } }));
    expect(d).toEqual({ title: "Priced by weight", line: "Rp1.650/unit, total Rp1.200.000" });
    expect(describeEntry(row({ tool: "check_vendor_policy", sec: 0, ok: false, input: { quoteId: "Q-1" }, output: { ok: false, reasons: ["Too expensive"] } })))
      .toEqual({ title: "Quote Q-1 refused", line: "Too expensive" });
  });

  it("writes its display texts through the visitor's translator, English when none is given", () => {
    const t = makeT("id", {
      "{n} min ago": "{n} mnt lalu", "Quote {id} refused": "Penawaran {id} ditolak", "Claude unavailable: {error}": "Claude tidak tersedia: {error}",
      "Chief run: {what}": "Putaran Chief: {what}", "Run by the operator": "Dijalankan operator",
    });
    expect(wib("2026-10-14T23:30:00.000Z", "id")).toBe("15 Okt, 06.30");
    expect(ago("2026-10-15T11:55:00.000Z", new Date("2026-10-15T12:00:00.000Z"), t)).toBe("5 mnt lalu");
    const refused = row({ tool: "check_vendor_policy", sec: 0, ok: false, input: { quoteId: "Q-1" }, output: { reasons: ["Too expensive"] } });
    // Stored text (the reason) stays as written; only the fixed words are translated.
    expect(describeEntry(refused, t)).toEqual({ title: "Penawaran Q-1 ditolak", line: "Too expensive" });
    const log = [
      row({ tool: "agent_start", sec: 0, input: { trigger: "The operator pressed Run agent." } }),
      row({ tool: "llm_unavailable", sec: 1, ok: false, output: { error: "Claude API 529: overloaded" } }),
    ];
    const orders = [order("ORD-001", "real")];
    expect(chiefFeed(log, orders, 15, t)[0]).toMatchObject({ line: "Claude tidak tersedia: Claude API 529: overloaded", down: true });
    // A failed Claude call still marks the audit event as failed when its line is translated.
    const [ev] = auditEvents({ orders, log, decisions: [], tasks: [], escrows: [] }, t);
    expect(ev).toMatchObject({ title: "Putaran Chief: dijalankan operator", ok: false });
    expect(auditEvents({ orders, log, decisions: [], tasks: [], escrows: [] })[0]).toMatchObject({ title: "Chief run: run by the operator", ok: false });
  });

  it("reads the real/simulated filter", () => {
    expect(pickFilter("real")).toBe("real");
    expect(pickFilter(["simulated"])).toBe("simulated");
    expect(pickFilter("x")).toBe("all");
    expect(matchesFilter("removed", "simulated")).toBe(true);
    expect(matchesFilter("removed", "real")).toBe(false);
    expect(matchesFilter("real", "all")).toBe(true);
  });
});

describe("chiefFeed", () => {
  const orders = [order("ORD-001", "simulated"), order("ORD-002", "real")];

  it("groups one Claude run into one item: trigger, steps, question, summary, model", () => {
    const log = [
      row({ tool: "agent_start", sec: 0, orderId: "ORD-002", input: { trigger: "Heartbeat check (timer) found: no price.", model: "claude-sonnet-5-5" } }),
      row({ tool: "get_order", sec: 2, orderId: "ORD-002" }),
      row({ tool: "get_order", sec: 3, orderId: "ORD-002" }),
      row({ tool: "create_operator_task", sec: 5, orderId: "ORD-002", input: { kind: "needs_info", text: "How many grams?" } }),
      row({ tool: "request_human_decision", sec: 5, orderId: "ORD-002", input: { question: "How many **grams** per unit?" } }),
      row({ tool: "agent_thought", sec: 6, orderId: "ORD-002", output: { text: "Decision: asked for grams.\n\nWaiting on: the operator." } }),
      row({ tool: "agent_summary", sec: 6, orderId: "ORD-002", input: { turns: 3, model: "claude-sonnet-5-5" }, output: { text: "Decision: asked for grams.\n\nWaiting on: the operator." } }),
      row({ tool: "link_printer", sec: 7, orderId: "ORD-002", actor: "human", output: { printer: "A1 Combo #1" } }),
    ];
    const feed = chiefFeed(log, orders);
    expect(feed).toHaveLength(1);
    const f = feed[0];
    expect(f).toMatchObject({
      kind: "run", mode: "claude", title: "Woken by the heartbeat", line: "Decision: asked for grams.", model: "claude-sonnet-5-5", turns: 3,
      unfinished: false, refused: 0, order: { id: "ORD-002", tag: "real" }, questions: ["How many grams per unit?"],
    });
    expect(f.text).toBe("Decision: asked for grams.\n\nWaiting on: the operator.");
    expect(f.steps.map((s) => [s.tool, s.n, s.skill])).toEqual([
      ["get_order", 2, "Operations"], ["create_operator_task", 1, "Operations"], ["request_human_decision", 1, "Operations"],
    ]);
  });

  it("marks a run without a summary as unfinished, and shows Claude being unavailable", () => {
    const open = chiefFeed([row({ tool: "agent_start", sec: 0, input: { trigger: "The operator pressed Run agent." } }), row({ tool: "get_order", sec: 1 })], orders);
    expect(open[0]).toMatchObject({ unfinished: true, line: "No summary yet", title: "Run by the operator" });
    const down = chiefFeed([
      row({ tool: "agent_start", sec: 0, input: { trigger: "x" } }),
      row({ tool: "llm_unavailable", sec: 1, ok: false, output: { error: "Claude API 529: overloaded" } }),
    ], orders);
    expect(down[0]).toMatchObject({ unfinished: false, refused: 1 });
    expect(down[0].line).toBe("Claude unavailable: Claude API 529: overloaded");
  });

  it("groups the rule-based planner, keeps heartbeats apart and merges code actions of one moment", () => {
    const log = [
      row({ tool: "get_order", sec: 0 }),
      row({ tool: "get_quotes", sec: 0 }),
      row({ tool: "check_vendor_policy", sec: 0, ok: false, input: { quoteId: "Q-p" }, output: { reasons: ["Quote 35 USDC exceeds mandate 32 USDC"] } }),
      row({ tool: "choose_plan", sec: 0, input: { quoteId: "Q-own", reason: "Cheapest allowed option: Q-own at 30 USDC, 48h." } }),
      row({ tool: "heartbeat", sec: 100, output: { findings: [{ kind: "deadline_risk", text: "Deadline passed." }, { kind: "printer_offline", text: "A1 is offline." }] } }),
      row({ tool: "choose_printer", sec: 200, ok: false, output: { reasons: ["A1 Combo #1: offline"] } }),
      row({ tool: "create_operator_task", sec: 201, input: { kind: "check_printer", text: "No printer is ready." } }),
      row({ tool: "arc_verify", sec: 300, orderId: "ORD-002", input: { kind: "deposit" }, output: { verified: true } }),
      row({ tool: "arc_verify", sec: 300, orderId: "ORD-002", input: { kind: "release" }, output: { verified: true } }),
    ];
    const feed = chiefFeed(log, orders);
    expect(feed.map((f) => [f.kind, f.title])).toEqual([
      ["action", "Checked 2 transfers on Arc"],
      ["action", "No printer ready"],
      ["heartbeat", "Heartbeat noticed 2 problems"],
      ["run", "Rule-based planner"],
    ]);
    expect(feed[0].line).toBe("All match on Arc");
    expect(feed[1]).toMatchObject({ refused: 1, line: "A1 Combo #1: offline", text: "No printer is ready." });
    expect(feed[2]).toMatchObject({ line: "Deadline passed.", text: "• Deadline passed.\n• A1 is offline." });
    expect(feed[3]).toMatchObject({ mode: "rules", refused: 1, line: "Cheapest allowed option: Q-own at 30 USDC, 48h.", order: { tag: "simulated" } });
  });

  it("folds the same reminder raised again and again into one item, and tags rows of removed orders", () => {
    const reminder = (sec: number) => row({ tool: "create_operator_task", sec, input: { kind: "check_printer", text: "CHECK NOW: collect the print." } });
    const log = [reminder(0), reminder(3600), reminder(7200), row({ tool: "heartbeat", sec: 9000, orderId: "ORD-404", output: { findings: [] } })];
    const feed = chiefFeed(log, orders);
    expect(feed).toHaveLength(2);
    expect(feed[0].order).toEqual({ id: "ORD-404", tag: "removed" });
    expect(feed[1]).toMatchObject({ repeats: 3, at: at(7200), firstAt: at(0) });
  });

  it("keeps the full text behind a line that had to be cut, and none when the line says it all", () => {
    const long = `ORD-001 has no grams per unit yet. ${"Ask the operator to slice it. ".repeat(8)}`.trim();
    const log = [
      row({ tool: "get_order", sec: 0 }),
      row({ tool: "choose_plan", sec: 0, input: { quoteId: "Q-own", reason: long } }),
      row({ tool: "heartbeat", sec: 100, output: { findings: [{ text: long }] } }),
      row({ tool: "heartbeat", sec: 200, output: { findings: [{ text: "Deadline passed." }] } }),
    ];
    const [short, beat, plan] = chiefFeed(log, orders);
    expect(short).toMatchObject({ line: "Deadline passed.", text: undefined });
    expect(beat.line).toBe(oneLine(long));
    expect(beat.line.endsWith("…")).toBe(true);
    expect(beat.text).toBe(long);
    expect(plan).toMatchObject({ mode: "rules", line: oneLine(long), text: long });
    expect(describeEntry(row({ tool: "create_operator_task", sec: 0, input: { text: "Short task." } }))).toEqual({ title: "Task for the operator", line: "Short task." });
  });

  it("returns the newest items first, up to the limit", () => {
    const log = Array.from({ length: 30 }, (_, i) => row({ tool: "choose_printer", sec: i * 100, orderId: i % 2 ? "ORD-001" : "ORD-002", output: { chose: `P${i}` } }));
    const feed = chiefFeed(log, orders, 5);
    expect(feed.map((f) => f.title)).toEqual(["Chose P29", "Chose P28", "Chose P27", "Chose P26", "Chose P25"]);
  });
});

describe("auditEvents", () => {
  it("merges the log, plan decisions, finished tasks and escrow transfers, newest first", () => {
    const orders = [order("ORD-001", "simulated"), order("ORD-002", "real")];
    const events = auditEvents({
      orders,
      log: [
        row({ tool: "get_order", sec: 0, orderId: "ORD-002" }),
        row({ tool: "choose_plan", sec: 0, orderId: "ORD-002", input: { quoteId: "Q-1", reason: "Cheapest allowed option." } }),
        row({ tool: "customer_decision", sec: 600, orderId: "ORD-002", actor: "human", input: { accepted: true } }),
        row({ tool: "release_escrow", sec: 601, orderId: "ORD-002" }),
      ],
      decisions: [{ orderId: "ORD-002", quoteId: "Q-1", decidedBy: "agent", reason: "Cheapest allowed option.", at: at(0) }],
      tasks: [
        { id: "T-1", orderId: "ORD-001", kind: "collect_and_qc", text: "Collect and QC", status: "done", createdBy: "agent", at: at(10), doneAt: at(700), doneBy: "Sabina (QC)" },
        { id: "T-2", orderId: "ORD-001", kind: "check_printer", text: "Still open", status: "open", createdBy: "agent", at: at(20) },
      ],
      escrows: [escrow("ORD-002", "RELEASED", [
        tx("deposit", "COMPLETE", 10_000_000, { at: at(300), txHash: "0xabc", verified: { ok: true, at: at(301) } }),
        tx("release", "FAILED", 10_000_000, { at: at(650) }),
      ])],
    });
    expect(events.map((e) => [e.kind, e.title])).toEqual([
      ["task", "Task done by Sabina"],
      ["money", "Release · 10 test USDC"],
      ["code", "Escrow release started"],
      ["person", "Customer accepted the print"],
      ["money", "Deposit · 10 test USDC"],
      ["decision", "Plan chosen by the Chief"],
    ]);
    const deposit = events.find((e) => e.title.startsWith("Deposit"))!;
    expect(deposit).toMatchObject({ ok: true, line: "complete · verified on Arc", href: "https://explorer.testnet.arc.io/tx/0xabc" });
    expect(events.find((e) => e.title.startsWith("Release"))!.ok).toBe(false);
    expect(events.filter((e) => matchesFilter(e.order.tag, "real"))).toHaveLength(5);
    expect(events.filter((e) => matchesFilter(e.order.tag, "simulated"))).toHaveLength(1);
    expect(events.every((e) => e.text === undefined)).toBe(true);
  });

  it("carries the full text of a cut line: the Chief's summary, a long plan reason, a long task", () => {
    const long = `Print finished on Bambu Lab A1. ${"Collect the item and check every surface. ".repeat(5)}`.trim();
    const orders = [order("ORD-002", "real")];
    const events = auditEvents({
      orders,
      log: [
        row({ tool: "agent_start", sec: 0, orderId: "ORD-002", input: { trigger: "The operator pressed Run agent." } }),
        row({ tool: "agent_summary", sec: 5, orderId: "ORD-002", input: { turns: 2 }, output: { text: "Decision: wait for grams.\n\nWaiting on: the operator." } }),
      ],
      decisions: [{ orderId: "ORD-002", quoteId: "Q-1", decidedBy: "human", reason: long, at: at(100) }],
      tasks: [{ id: "T-1", orderId: "ORD-002", kind: "collect_and_qc", text: long, status: "done", createdBy: "agent", at: at(10), doneAt: at(200) }],
      escrows: [],
    });
    const by = (k: string) => events.find((e) => e.kind === k)!;
    expect(by("chief")).toMatchObject({ line: "Decision: wait for grams.", text: "Decision: wait for grams.\n\nWaiting on: the operator." });
    expect(by("decision")).toMatchObject({ line: oneLine(long), text: long });
    expect(by("task")).toMatchObject({ line: oneLine(long, 140), text: long });
  });
});

describe("moneyFlow", () => {
  it("counts each step for real and simulated orders apart, never adding them together", () => {
    const quotes: Record<string, Quote> = {
      "Q-r": { id: "Q-r", orderId: "ORD-002", vendorId: "own", priceMicro: 10_000_000, etaHours: 24, source: "own" },
    };
    const real = order("ORD-002", "real", {
      chosenQuoteId: "Q-r",
      gramPricing: {
        gramsPerUnit: 100, quantity: 1, pricePerGramIdr: 1650, costPerGramIdr: 800, unitPriceIdr: 165_000, totalIdr: 165_000,
        costIdr: 80_000, source: "slicer", quoteId: "Q-r", by: "human", at: at(0),
      },
    });
    real.agreement = { version: 1, hash: agreementHash(real, quotes["Q-r"]), quoteId: "Q-r", priceMicro: 10_000_000, by: "Aini", at: at(0) };
    // Approved before the order changed: the approval no longer matches, so it is not agreed.
    const stale = order("ORD-003", "real", { chosenQuoteId: "Q-r", agreement: { ...real.agreement, hash: "old" } });
    const sim = order("ORD-001", "simulated", { chosenQuoteId: "Q-s" });
    const flow = moneyFlow([real, stale, sim], [
      escrow("ORD-002", "FUNDED", [tx("customer_topup", "COMPLETE", 10_000_000), tx("deposit", "COMPLETE", 10_000_000)]),
      escrow("ORD-001", "RELEASED", [tx("deposit", "COMPLETE", 30_000_000), tx("release", "COMPLETE", 30_000_000), tx("refund", "SENT", 1)]),
      escrow("ORD-404", "FUNDED", [tx("deposit", "COMPLETE", 99)]),
    ], (id) => quotes[id]);
    expect(flow.real).toMatchObject({ orders: 2, priced: 2, agreed: 1, agreedIdr: 165_000, escrows: 1, pending: 0, failed: 0 });
    expect(flow.real.topup).toEqual({ count: 1, micro: { testnet: 10_000_000, mainnet: 0 } });
    expect(flow.real.held).toEqual({ count: 1, micro: { testnet: 10_000_000, mainnet: 0 } });
    expect(flow.real.release.count).toBe(0);
    expect(flow.simulated).toMatchObject({ orders: 1, priced: 1, agreed: 0, escrows: 1, pending: 1 });
    expect(flow.simulated.release).toEqual({ count: 1, micro: { testnet: 30_000_000, mainnet: 0 } });
  });

  it("keeps a mainnet escrow's money apart from test USDC", () => {
    const flow = moneyFlow([order("ORD-002", "real")], [escrow("ORD-002", "FUNDED", [tx("deposit", "COMPLETE", 5_000_000), tx("deposit", "FAILED", 1)], "ARC")], () => undefined);
    expect(flow.real.deposit.micro).toEqual({ testnet: 0, mainnet: 5_000_000 });
    expect(flow.real.failed).toBe(1);
  });
});

describe("integration rows", () => {
  const base: IntegrationInput = {
    now: new Date("2026-10-15T09:00:00.000Z"),
    agent: { mode: "claude", model: "claude-sonnet-5-5", profile: "test", hasApiKey: true },
    heartbeat: { enabled: true, intervalSeconds: 120, schedulerRunning: true, lastAt: "2026-10-15T08:59:00.000Z", nextRunAt: "2026-10-15T09:01:00.000Z", lastErrors: 0 },
    printers: { total: 3, online: 3, lastSeen: "2026-10-15T08:59:50.000Z" },
    network: { name: "Arc Testnet", isTestnet: true },
    mainnetUnlocked: false,
    db: { orders: 3, real: 1, logRows: 61, where: "local" },
    customerLinks: 2,
  };
  const chip = (x: IntegrationInput) => Object.fromEntries(integrationRows(x).map((r) => [r.id, `${r.status}:${r.chip}`]));

  it("reports a healthy setup", () => {
    expect(chip(base)).toEqual({
      printers: "ok:live", claude: "ok:on", heartbeat: "ok:on", customer: "ok:on", db: "neutral:local", mainnet: "ok:locked",
    });
    const rows = integrationRows(base);
    expect(rows.find((r) => r.id === "heartbeat")!.line).toBe("Every 2 min · last 15:59 WIB · next 16:01 WIB");
    expect(rows.find((r) => r.id === "claude")!.line).toBe("claude-sonnet-5-5 · Test profile");
  });

  it("warns about rules mode, a late or switched-off heartbeat, offline printers and an unlocked mainnet", () => {
    expect(chip({
      ...base,
      agent: { ...base.agent, mode: "rules", hasApiKey: false },
      heartbeat: { ...base.heartbeat, lastAt: "2026-10-15T08:00:00.000Z", schedulerRunning: false },
      printers: { total: 3, online: 1, lastSeen: null },
      mainnetUnlocked: true,
    })).toMatchObject({ claude: "warn:rules only", heartbeat: "warn:not running", printers: "warn:partly online", mainnet: "warn:unlocked" });
    expect(chip({ ...base, heartbeat: { ...base.heartbeat, enabled: false }, printers: { total: 2, online: 0, lastSeen: null } }))
      .toMatchObject({ heartbeat: "warn:off", printers: "bad:offline" });
    expect(chip({ ...base, printers: { total: 0, online: 0, lastSeen: null } }).printers).toBe("warn:not set up");
  });

  it("says where the database lives: this computer, the Railway volume, or a Railway disk that a deploy wipes", () => {
    const db = (where: IntegrationInput["db"]["where"]) => integrationRows({ ...base, db: { ...base.db, where } }).find((r) => r.id === "db")!;
    expect(db("local")).toMatchObject({ status: "neutral", chip: "local", line: "On this computer · 3 orders (1 real) · 61 log rows" });
    expect(db("volume")).toMatchObject({ status: "ok", chip: "server", line: "Railway volume · 3 orders (1 real) · 61 log rows" });
    expect(db("no-volume")).toMatchObject({ status: "warn", chip: "no volume" });

    expect(dbWhere({ onRailway: false, volume: null, dbPath: "L:/kesuni3d/data/local/kesuni.db" })).toBe("local");
    expect(dbWhere({ onRailway: true, volume: "/data", dbPath: "/data/kesuni.db" })).toBe("volume");
    expect(dbWhere({ onRailway: true, volume: null, dbPath: "/app/data/local/kesuni.db" })).toBe("no-volume");
    expect(dbWhere({ onRailway: true, volume: "/data", dbPath: "/app/data/local/kesuni.db" })).toBe("no-volume");
    expect(dbWhere({ onRailway: true, volume: "/data", dbPath: "/data-old/kesuni.db" })).toBe("no-volume");
  });

  it("maps the chain health check without leaking more than the status", () => {
    const rows = chainRows({
      network: { name: "Arc Testnet", isTestnet: true },
      arc: { status: "ok", blockNumber: "123", blockAgeSec: 2 },
      circle: { status: "ok", walletSet: "reachable", wallet: { usdc: "2.3", state: "LIVE" } },
    });
    expect(rows.map((r) => [r.id, r.status, r.chip, r.line])).toEqual([
      ["arc", "ok", "live", "Arc Testnet · block 123 · 2 s old"],
      ["circle", "ok", "reachable", "Wallet set reachable · demo funds 2.3 test USDC"],
    ]);
    const down = chainRows({ network: { name: "Arc Testnet", isTestnet: true }, arc: { status: "unreachable", reason: "timed out" }, circle: { status: "unreachable", reason: "fetch failed" } });
    expect(down.map((r) => `${r.status}:${r.chip}`)).toEqual(["bad:unreachable", "bad:unreachable"]);
    expect(down[1].line).toContain("WARP");
  });
});

describe("collapseRepeats", () => {
  it("only folds neighbours with the same order, title and line", () => {
    const ref = { id: "ORD-001", tag: "simulated" as const };
    const items = [
      { kind: "task", order: ref, title: "Task done", line: "A", at: at(3), repeats: 1 },
      { kind: "task", order: ref, title: "Task done", line: "A", at: at(2), repeats: 1 },
      { kind: "task", order: ref, title: "Task done", line: "B", at: at(1), repeats: 1 },
      { kind: "task", order: ref, title: "Task done", line: "A", at: at(0), repeats: 1 },
    ];
    expect(collapseRepeats(items).map((i) => `${i.line}×${i.repeats}`)).toEqual(["A×2", "B×1", "A×1"]);
  });
});

describe("loaders over the store", () => {
  beforeEach(() => store.resetDb());

  it("read every order's log and escrow through the store", () => {
    store.addLog({ orderId: "ORD-001", actor: "agent", tool: "heartbeat", input: {}, ok: true, output: { findings: [{ text: "Needs a price." }] }, at: at(0) });
    store.addLog({ orderId: "ORD-001", actor: "human", tool: "slicer_grams", input: { gramsPerUnit: 12 }, ok: true, output: {}, at: at(10) });
    store.saveEscrow(escrow("ORD-001", "FUNDED", [tx("deposit", "COMPLETE", 30_000_000)]));
    const events = loadAudit();
    expect(events.map((e) => e.title)).toEqual(["Deposit · 30 test USDC", "Slicer grams entered", "Heartbeat noticed 1 problem"]);
    expect(events.every((e) => e.order.tag === "simulated")).toBe(true);
    const flow = loadMoneyFlow();
    expect(flow.real.escrows).toBe(0);
    expect(flow.simulated.held.count).toBe(1);
  });
});

describe("agent prints in the decision log", () => {
  it("each new row has a short title and line, in English and Indonesian; studio rows are not 'removed' orders", async () => {
    const { ID } = await import("../i18n/id");
    const idT = makeT("id", ID);
    const start = row({ tool: "auto_print", sec: 1, input: { printerId: "a1", file: "Benchy.gcode.3mf", bedConfirmedBy: "Khelda" }, output: { jobId: "PJ-1-x", printer: "A1 Combo #1" } });
    expect(describeEntry(start)).toEqual({ title: "Agent started a print on A1 Combo #1", line: "Benchy.gcode.3mf · bed confirmed by Khelda" });
    expect(describeEntry(start, idT)).toEqual({ title: "Agen memulai cetakan di A1 Combo #1", line: "Benchy.gcode.3mf · bed dikonfirmasi oleh Khelda" });
    const wait = row({ tool: "auto_print_wait", sec: 2, input: { key: "No spool of {material} {name} loaded", vars: { material: "PETG", name: "White" } }, output: { text: "No spool of PETG White loaded" } });
    expect(describeEntry(wait)).toEqual({ title: "Agent print waits", line: "No spool of PETG White loaded" });
    expect(describeEntry(wait, idT).line).toBe("Tidak ada spool PETG Putih yang terpasang");
    const nested = row({ tool: "auto_print_wait", sec: 3, input: { key: "{printer}: {reason}", vars: { printer: "A1 Combo #2", reason: "Linked to ORD-004" } } });
    expect(describeEntry(nested, idT).line).toBe("A1 Combo #2: Terhubung ke ORD-004");
    expect(describeEntry(row({ tool: "auto_print_switch", sec: 4, actor: "human", orderId: "studio", input: { on: true, by: "Khelda" } }), idT).title)
      .toBe("Cetak oleh agen diaktifkan oleh Khelda");
    expect(describeEntry(row({ tool: "clear_bed", sec: 5, actor: "human", orderId: "printer:a1", input: { by: "Aini" }, output: { printer: "A1 Combo #1" } })))
      .toEqual({ title: "Bed confirmed empty by Aini", line: "A1 Combo #1" });
    expect(describeEntry(row({ tool: "auto_print_runs", sec: 6, actor: "human", input: { runsNeeded: 2, by: "Khelda" } }))).toEqual({ title: "Runs set by Khelda", line: "2 runs" });
    const feed = chiefFeed([row({ tool: "create_operator_task", sec: 7, orderId: "printer:a1", input: { kind: "change_filament", text: "Load PETG White" } })], [order("ORD-001", "real")]);
    expect(feed[0].order).toEqual({ id: "printer:a1", tag: "studio" });
    expect(matchesFilter("studio", "real")).toBe(false);
    expect(matchesFilter("studio", "simulated")).toBe(false);
    expect(matchesFilter("studio", "all")).toBe(true);
  });
});
