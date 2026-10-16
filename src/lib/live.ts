// The public "Live studio" page (/live): proof for anyone with the link that the printers, the agent and the Arc
// transfers are real. Read-only, no login, no controls. Every field below is picked by name (an allow-list): never
// a whole DB row, never a customer's name, phone, address, note, message, token or link, a person's name, a file
// name, a product title, a printer's IP, serial or access code, a wallet id or address, or anything from env.
// liveView() is pure (rows in, view out), so the tests feed it the same way the page does; loadLive() reads the store.
// The printer helpers live with My machines (src/app/machines): they are pure, and the same words show there.
import * as store from "./store";
import { allLog, chiefFeed, oneLine, wib, type FeedItem } from "./ops";
import { ago, machineStats, machineView } from "./machines";
import { microToUsdc } from "./policy";
import { DAY, daysUntil, formatters } from "./capacity";
import { deadlineEnd } from "./owner-rules";
import { explorerTxBase, isTestnetChain, publicNetwork } from "./network";
import { traction, type Traction } from "./traction";
import { autoPrintSetting } from "./printer/autoprint";
import { heartbeatStatus } from "./agent/heartbeat";
import { chiefSteps, isDecision, isEscalation, jakartaDay } from "./agent/daily-review";
import { agentText, redactNote } from "./agent/tools";
import { ACTION_TOOLS, type Skill } from "./agent/skills";
import { nameOf } from "./colors";
import { tLib } from "./lib-text";
import { amsSlots, issueViews, stageText, taskText, type IssueTexts } from "@/app/machines/printer-details";
import { issueTexts } from "@/app/machines/issue-texts";
import type { AgentLogEntry, ChainTx, Escrow, OperatorTask, Order, Printer, PrintJob } from "./types";
import type { Tone } from "./machines";
import { makeT, type Locale, type T } from "../i18n/core";

const EN: T = makeT("en", {});
/** How many agent entries and Arc transfers the page shows. */
export const LIVE_AGENT_ITEMS = 8;
export const LIVE_TRANSFERS = 10;
/** The page re-reads itself this often while the tab is visible. */
export const LIVE_REFRESH_S = 15;

// ---------- the view (everything the page may show) ----------

/** "removed": the order was deleted; it never counts as real business. */
export type LiveLabel = "real" | "simulated" | "removed";
/** An order as this page shows it: the id and its label. Never the product title or the customer. */
export interface LiveOrder { id: string; label: LiveLabel }

export interface LiveSlot {
  slot: number;            // 1..4 as the printer labels it
  empty: boolean;
  type: string | null;     // "PLA"
  name: string | null;     // English colour name; the page translates it
  color: string | null;    // "#RRGGBB"
  colors: string[];
  active: boolean;
}

export interface LiveFault {
  code: string;
  tone: "bad" | "warn";
  level: string | null;
  /** Bambu's own words in the page's language; null when Bambu's table does not know the code. */
  text: string | null;
  /** Bambu's own guide for the code (bambulab.com only). */
  url: string | null;
}

export interface LivePrinter {
  id: string;
  name: string;
  online: boolean;
  lastReport: string;
  /** The state only ("Idle", "Printing 45%", "Offline"): online and the last report have their own line. */
  pill: { tone: Tone; text: string };
  stage: { text: string; needsPerson: boolean } | null;
  progress: { percent: number; paused: boolean } | null;
  nozzle: string;
  bed: string;
  nozzleTarget: number | null;
  bedTarget: number | null;
  layer: string;
  remaining: string;
  ams: { lite: boolean; slots: LiveSlot[] } | null;
  external: { type: string; color: string | null; name: string | null; active: boolean } | null;
  faults: LiveFault[];
  order: LiveOrder | null;
  /** null: the bed is empty. Else it holds a part waiting for a person to collect it (order null: a print without one). */
  bedHolds: { order: LiveOrder | null } | null;
}

export interface LiveAgentItem {
  id: string;
  at: string;
  /** "15 Oct, 12:04" in Jakarta time. */
  when: string;
  /** "person": a person started a print (shown so no print looks like the agent's). */
  kind: FeedItem["kind"] | "person";
  mode: "claude" | "rules" | null;
  title: string;
  /** One line, names and file names hidden, cut short. "" when the step has no line that is safe to show. */
  line: string;
  skill: Skill;
  /** null: a row about the whole studio or one printer. */
  order: LiveOrder | null;
  refused: number;
  asked: boolean;
  repeats: number;
}

export type LiveTxKind = "deposit" | "release" | "refund" | "topup";
export interface LiveTransfer {
  id: string;
  kind: LiveTxKind;
  amount: string;          // "0.1"
  testnet: boolean;        // test USDC
  at: string;
  when: string;
  order: LiveOrder;
  state: "complete" | "pending" | "failed";
  /** Only for a complete transfer: checked on Arc and it matches, does not match, or not checked yet. */
  check: "verified" | "mismatch" | "unchecked" | null;
  explorerUrl: string | null;
  hash: string | null;     // "0x1234ab…cdef"
}

export interface LiveUsage {
  realCustomers: number;
  realOrders: number;
  arcTransfers: number;
  verified: number;
  mismatch: number;
  unchecked: number;
  simulatedOrders: number;
  /** Complete transfers not counted: every transfer of a simulated or removed order, and demo top-ups on real ones. */
  testTransfers: number;
  rule: string;
}

/** Amounts in USDC ("0.3"): on a test network (test USDC) and on mainnet (real USDC), never added together. */
export interface LiveVolume { testUsdc: string; usdc: string }
export interface LiveMoneyPart { transfers: number; verified: number; volume: LiveVolume }

/** A printer with a print running or paused: what the overview lists under "Running now". */
export interface LiveRunning {
  id: string;
  name: string;
  percent: number;
  paused: boolean;
  /** false: the bridge has not reported for 2 min; the numbers are the last known reading. */
  online: boolean;
  /** Bambu's own stage words ("Printing", "Heatbed preheating"). */
  stage: string | null;
  needsPerson: boolean;
  /** "42m", "1h 05m", "—". */
  remaining: string;
  /** When it should be done, WIB: "13:42", "tomorrow 01:20". null while paused, offline, or when Bambu gives no time. */
  doneAt: string | null;
  order: LiveOrder | null;
}

/** The tab /live opens on: the same numbers as the other tabs, counted once here. */
export interface LiveOverview {
  printers: {
    total: number; online: number; printing: number; paused: number;
    /** Online, idle, no order linked, bed empty, no fault: the printers the agent could pick for a new job. */
    ready: number;
    running: LiveRunning[];
    /** Beds holding a finished part until a person collects it. */
    toCollect: { name: string; order: LiveOrder | null }[];
  };
  orders: {
    total: number;
    /** As the Orders page counts: not paid out or rejected yet. */
    inProgress: number;
    finished: number;
    real: number;
    simulated: number;
    /** The earliest deadline of an order still to be made: "in 4 d", "today", "2 d late", and the day. */
    next: { order: LiveOrder; due: string; day: string; late: boolean } | null;
  };
  /** Completed Arc transfers, as the Money on Arc tab counts them: real orders (counted) and tests (not counted). */
  money: LiveMoneyPart & { real: LiveMoneyPart; test: LiveMoneyPart };
  /** Today in Jakarta, counted the same way as the Chief page. */
  agent: { decisions: number; handedToPerson: number; claudeRuns: number };
}

export interface LiveView {
  at: string;
  network: { name: string; isTestnet: boolean };
  printers: LivePrinter[];
  /** The newest printer report ("12 s ago"), null before the first: when no printer is online, the bridge may be down. */
  lastReport: string | null;
  /** on: a person allowed agent prints. started: prints the agent (the code dispatcher) has started so far. */
  agentPrints: { on: boolean; locked: boolean; started: number };
  /** The heartbeat's last round (code checks; Claude woken when an order needs a decision). */
  agentCheck: { at: string; ago: string; mode: "claude" | "rules" } | null;
  agent: LiveAgentItem[];
  transfers: LiveTransfer[];
  usage: LiveUsage;
  overview: LiveOverview;
}

// ---------- hiding what must never show ----------

/**
 * Words a "by" field holds that are not a name. The fields also carry roles, tools and notes: "Claude for Khelda
 * (duplicate cleanup)", "A1 Combo #3 (no longer reported)", "Bridge dry-run test". Hiding those words would hide
 * "for" and "Combo" everywhere.
 */
const NOT_NAMES = new Set([
  "agent", "chief", "claude", "human", "operator", "system", "code", "person", "customer", "kesuni", "owner", "studio", "admin", "team",
  "test", "tests", "demo", "bridge", "printer", "combo", "bambu", "lab", "dry-run", "for", "the", "and", "with", "from", "via", "reset",
  "slicer", "studio-pc", "dispatcher", "heartbeat",
]);
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The words of a name worth hiding: 3+ letters, not a role or a common word. "Claude for Khelda (x)" -> ["Khelda"]. */
function nameParts(v: unknown): string[] {
  if (typeof v !== "string") return [];
  return v.split(" (")[0].split(/\s+/).filter((w) => /^\p{L}[\p{L}'’-]+$/u.test(w) && w.length >= 3 && !NOT_NAMES.has(w.toLowerCase()));
}

/** Each of these words or phrases, whole (not inside a longer word), replaced by `put`. Any case unless `anyCase` is false. */
function hideWords(text: string, words: string[], put: string, anyCase = true): string {
  const list = [...new Set(words.filter(Boolean))].sort((a, b) => b.length - a.length);
  if (!list.length) return text;
  return text.replace(new RegExp(`(?<![\\p{L}\\w])(${list.map(escapeRe).join("|")})(?![\\p{L}\\w])`, anyCase ? "giu" : "gu"), put);
}

export interface Hide {
  /** The customers' names (each order's customerName). */
  customers: string[];
  /** People at Kesuni: everyone in a "by" field. Shown as "a person". */
  people: string[];
  /** The orders' product titles (they can start with the customer's name): never shown. */
  products: string[];
}

/** The ways a text may quote a product: as typed, without the "lia: " in front, and its head ("Lamp (3D parts)" -> "Lamp"). */
function productForms(p: string): string[] {
  const s = p.trim();
  const bare = s.replace(/^[^:]{1,40}:\s*/, "");
  const head = (x: string) => x.split(/\s*[(,;]\s*|\s+[-–—]\s+/)[0].trim();
  return [s, bare, head(s), head(bare)];
}

/** Dates ("2026-10-20") and Bambu's print_error codes ("0700-8011") are not phone numbers: redactNote must not hide them.
 *  A code with more digits around it ("0812-3456 7890") is part of a phone number: not kept. */
const KEEP = /\b\d{4}-\d{2}-\d{2}\b|(?<![\d+][\s().-]*)(?<![\w-])0[0-9A-F]{3}-[0-9A-F]{4}(?![\w-])(?![\s().-]*\d)/g;
const FILE = /[^\s"'()[\]<>]+\.(?:gcode\.3mf|3mf|stl|obj|step|stp|gcode|png|jpe?g|webp|heic|gif|pdf|zip)\b/gi;
/** Bambu's guide links in a fault task: the printer card links the guide itself. */
const BAMBU_LINK = /\s*\bhttps:\/\/(?:e|wiki)\.bambulab\.com\/\S*/gi;
const URL_RE = /\bhttps?:\/\/\S+/gi;
const CUSTOMER_LINK = /\/(?:c|request)\/[\w-]+/g;
const IP = /\b\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?\b/g;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const HEX = /\b(?:0x)?[0-9a-f]{16,}\b/gi;
/** A Bambu serial ("03919D4A1201234"): capital letters and 5+ digits, 10+ long, one word. */
const SERIAL = /\b(?=[0-9A-Z]*[A-Z])(?=(?:[A-Z]*\d){5})[0-9A-Z]{10,}\b/g;
/** A quote of 20+ characters (a task's text, a customer's words), also one cut short: shown as “…”. It opens at the start of a
 *  word (Bambu's `the "Firmware" page` is not one: its closing mark is not an opening one). */
const QUOTE = /(?<=^|[\s:(])["“](?=\S)[^"”]{20,}(?:["”]|$)/g;
/** An order with its product in brackets, as code writes it ("ORD-012 (lia: keychain)"), also when the text was cut
 *  inside the brackets: the id stays, whatever the brackets hold. */
const ORDER_LABEL = /\b(ORD-[\w-]+)\s*\((?:[^()]|\([^()]*\))*(?:\)|$)/g;

/**
 * Text written by the Chief or by code (a summary, a finding, a reason) as this page may show it, on one line: no
 * product title, no customer or staff name, no phone, address, email, link, file name, IP, wallet id or serial.
 * Pass the whole text: a text cut before this runs may end in the middle of a product title.
 */
export function safeLine(text: string, hide: Hide, max = 160): string {
  let s = oneLine(text, 4000).replace(QUOTE, "“…”");
  // The product, in any case: in brackets or quotes it goes whatever its length; alone only when it is long enough
  // not to be a common word ("Vase").
  const forms = [...new Set(hide.products.flatMap(productForms))].filter((x) => x.length >= 3).sort((a, b) => b.length - a.length);
  for (const p of forms) {
    s = s.replace(new RegExp(`\\s?\\(${escapeRe(p)}\\)|"${escapeRe(p)}"`, "gi"), "");
    if (p.length >= 8) s = hideWords(s, [p], "");
  }
  s = s.replace(ORDER_LABEL, "$1");
  // Links, files and contacts before names: "lia@example.com" is an email first.
  s = s.replace(BAMBU_LINK, "").replace(URL_RE, "[link hidden]").replace(CUSTOMER_LINK, "[link hidden]").replace(FILE, "[file]").replace(IP, "[hidden]")
    .replace(UUID, "[hidden]").replace(HEX, "[hidden]").replace(SERIAL, "[hidden]");
  const kept: string[] = [];
  s = s.replace(KEEP, (m) => `\u0000${kept.push(m) - 1}\u0001`);
  s = (redactNote(s) ?? "").replace(/\u0000(\d+)\u0001/g, (_, i: string) => kept[Number(i)]);
  // The whole name first ("Lia Kusuma" once, not twice), then each part of it. A two-letter name ("Al") only as written.
  for (const c of hide.customers) {
    const whole = c.split(" (")[0].trim();
    const parts = nameParts(c);
    if (parts.length) s = hideWords(hideWords(s, [whole], "[customer name]"), parts, "[customer name]");
    else if (/^\p{L}{2}$/u.test(whole)) s = hideWords(s, [whole], "[customer name]", false);
  }
  s = hideWords(s, hide.people.flatMap(nameParts), "a person");
  return oneLine(s.replace(/\(\s*\)/g, "").replace(/\s+([.,;:])/g, "$1").replace(/\s{2,}/g, " "), max);
}

// ---------- printers ----------

const tagOf = (o: Order | undefined): LiveLabel => (!o ? "removed" : o.label === "real" ? "real" : "simulated");
const bambuUrl = (url: string | undefined): string | null =>
  url && /^https:\/\/(e|wiki)\.bambulab\.com\//.test(url) ? url : null;
/** My machines' pills that start with "Online · ": here the card says online on its own line. */
const ONLINE_PILL: Record<string, string> = { "Online · Idle": "Idle", "Online · Finished": "Finished", "Online · No status yet": "No status yet" };

function livePrinter(p: Printer, now: number, orderOf: (id: string) => LiveOrder, texts: IssueTexts, t: T): LivePrinter {
  const v = machineView(p, now, t);
  const s = p.snapshot;
  const stage = stageText(s, t);
  const slots = amsSlots(s);
  const ext = s?.externalSpool;
  const en = machineView(p, now).pill.text;
  const pill = !v.online && p.lastSeen ? { tone: v.pill.tone, text: t("Offline") } : ONLINE_PILL[en] ? { tone: v.pill.tone, text: t(ONLINE_PILL[en]) } : v.pill;
  return {
    id: p.id,
    name: p.name,
    online: v.online,
    lastReport: v.lastReport,
    pill,
    stage: stage ? { text: stage, needsPerson: Boolean(s?.stage?.needsPerson) } : null,
    progress: v.progress,
    nozzle: v.nozzle,
    bed: v.bed,
    nozzleTarget: s?.nozzleTarget && s.nozzleTarget > 0 ? Math.round(s.nozzleTarget) : null,
    bedTarget: s?.bedTarget && s.bedTarget > 0 ? Math.round(s.bedTarget) : null,
    layer: v.layer,
    remaining: v.remaining,
    ams: slots.length
      ? { lite: Boolean(s?.ams?.lite), slots: slots.map((x) => ({ slot: x.slot, empty: x.empty, type: x.type, name: x.name, color: x.color, colors: x.colors, active: x.active })) }
      : null,
    external: ext ? { type: ext.type, color: ext.color, name: ext.color ? nameOf(ext.color) : null, active: Boolean(s?.ams?.externalActive) } : null,
    faults: issueViews(s, texts).map((i) => ({ code: i.code, tone: i.tone, level: i.level, text: i.text, url: bambuUrl(i.url) })),
    order: v.orderId ? orderOf(v.orderId) : null,
    bedHolds: v.bedHolds ? { order: v.bedHolds.orderId ? orderOf(v.bedHolds.orderId) : null } : null,
  };
}

// ---------- the agent at work ----------

/** Steps whose line is safe to show (their own words or numbers). Others (prints, slices, files, messages to the customer)
 *  carry file names, a person's name or the customer's words: only their title shows. */
const LINE_OK = new Set([
  "heartbeat", "choose_plan", "check_vendor_policy", "price_by_weight", "price_from_costing", "choose_printer", "suggest_reroute",
  "create_operator_task", "request_human_decision", "arc_verify", "release_escrow", "refund_escrow", "auto_print_wait",
  "request_dispatch", "agent_wake_skipped", "print_job", "get_order", "get_quotes", "get_available_budget",
  "get_production_status",
]);
/** A fault task as code writes it (issueTaskText in src/lib/printer/actions.ts): its code, for Bambu's words in the page's language. */
const FAULT_CODE = / reports (?:error )?(\S+?)(?: \(\w+\))?: /;

/** The whole text behind the feed's line: the line is cut at 180 characters, maybe inside a product title. */
function fullLine(f: FeedItem): string {
  if (!f.line.endsWith("…") || !f.text) return f.line;
  return f.text.startsWith("• ") ? f.text.split("\n")[0].slice(2) : f.text;
}

/** Titles for this page that say who did the work: a Claude run a person asked for is still the agent's run. */
function liveTitle(f: FeedItem, main: FeedItem["steps"][number] | undefined, t: T): string {
  const trigger = f.trigger ?? "";
  if (f.kind === "run" && f.mode === "claude") {
    if (/pressed Run agent/i.test(trigger)) return t("Chief run · a person asked");
    if (/owner approved an exception/i.test(trigger)) return t("Chief run · after the owner's OK");
    if (/entered grams per unit/i.test(trigger)) return t("Chief run · after slicer grams");
  }
  if (f.kind === "action" && main?.tool === "create_operator_task") return t("Agent opened a task for a person");
  return f.title;
}

function liveAgentItem(f: FeedItem, orderOf: (id: string) => LiveOrder, hide: Hide, texts: IssueTexts, t: T, locale: Locale): LiveAgentItem {
  const main = f.steps.find((s) => ACTION_TOOLS.includes(s.tool)) ?? f.steps.find((s) => !s.tool.startsWith("get_")) ?? f.steps[0];
  const lineOk = f.kind === "run" || f.steps.every((s) => LINE_OK.has(s.tool));
  let full = lineOk ? fullLine(f) : "";
  // Tasks code wrote in English: in the page's language when the dictionary knows them (a fault task with Bambu's words).
  if (full && f.kind === "action" && main?.tool === "create_operator_task") {
    const code = FAULT_CODE.exec(full)?.[1];
    full = code ? taskText({ text: full, errorCode: code }, t, texts) : tLib(t, full);
  }
  // A run Claude could not finish: the API's error text stays on the operator pages.
  const line = f.down ? t("Claude could not be reached. The rules carried on.") : full ? safeLine(full, hide) : "";
  return {
    id: f.id,
    at: f.at,
    when: wib(f.at, locale),
    kind: f.kind,
    mode: f.mode ?? null,
    title: safeLine(liveTitle(f, main, t), hide, 90),
    line,
    skill: main?.skill ?? "Operations",
    order: f.order.tag === "studio" ? null : orderOf(f.order.id),
    refused: f.refused,
    asked: f.questions.length > 0 || f.steps.some((s) => s.tool === "request_human_decision"),
    repeats: f.repeats,
  };
}

/** Prints people started from the website (the Chief's feed leaves people's rows out): title only, never who or which file. */
function personPrints(log: AgentLogEntry[], orderOf: (id: string) => LiveOrder, hide: Hide, t: T, locale: Locale): LiveAgentItem[] {
  return log.filter((e) => e.actor === "human" && e.tool === "start_print" && e.ok)
    .sort((a, b) => b.at.localeCompare(a.at) || b.id - a.id).slice(0, LIVE_AGENT_ITEMS)
    .map((e): LiveAgentItem => {
      const o = (e.output ?? {}) as Record<string, unknown>;
      const printer = typeof o.printer === "string" && o.printer ? o.printer : t("a printer");
      return {
        id: `person-${e.id}`, at: e.at, when: wib(e.at, locale), kind: "person", mode: null,
        title: safeLine(t("A person started a print on {printer}", { printer }), hide, 90), line: "", skill: "Machines",
        order: e.orderId === "studio" || e.orderId.startsWith("printer:") ? null : orderOf(e.orderId), refused: 0, asked: false, repeats: 1,
      };
    });
}

// ---------- money on Arc ----------

const TX_KIND: Record<ChainTx["kind"], LiveTxKind> = { customer_topup: "topup", deposit: "deposit", release: "release", refund: "refund" };
const FAILED: ChainTx["state"][] = ["FAILED", "DENIED", "CANCELLED"];
const TX_HASH = /^0x[0-9a-fA-F]{8,128}$/;

function liveTransfers(escrows: Escrow[], byId: Map<string, Order>, locale: Locale): LiveTransfer[] {
  const out: LiveTransfer[] = [];
  for (const e of escrows) {
    const o = byId.get(e.orderId);
    if (!o) continue; // a removed order: its escrow is not shown
    e.txs.forEach((x, i) => {
      const complete = x.state === "COMPLETE";
      const hash = x.txHash && TX_HASH.test(x.txHash) ? x.txHash : null;
      out.push({
        id: `${o.id}-${i}`,
        kind: TX_KIND[x.kind] ?? "deposit",
        amount: microToUsdc(x.amountMicro),
        testnet: isTestnetChain(e.network),
        at: x.at,
        when: wib(x.at, locale),
        order: { id: o.id, label: tagOf(o) },
        state: complete ? "complete" : FAILED.includes(x.state) ? "failed" : "pending",
        check: complete ? (x.verified ? (x.verified.ok ? "verified" : "mismatch") : "unchecked") : null,
        explorerUrl: hash ? `${explorerTxBase(e.network)}${hash}` : null,
        hash: hash ? `${hash.slice(0, 8)}…${hash.slice(-4)}` : null,
      });
    });
  }
  return out.sort((a, b) => b.at.localeCompare(a.at)).slice(0, LIVE_TRANSFERS);
}

/** Complete transfers that are not counted: every transfer of a simulated or removed order (traction() skips them
 *  without counting), and the demo top-ups on real orders (traction() counts those apart, excluded.demoTopups). */
function testTxs(escrows: Escrow[], byId: Map<string, Order>): { amountMicro: number; testnet: boolean; verified: boolean }[] {
  return escrows.flatMap((e) => {
    const real = byId.get(e.orderId)?.label === "real";
    return e.txs.filter((x) => x.state === "COMPLETE" && (!real || x.kind === "customer_topup"))
      .map((x) => ({ amountMicro: x.amountMicro, testnet: isTestnetChain(e.network), verified: Boolean(x.verified?.ok) }));
  });
}

/** The home page's counts, and the transfers not counted. */
function liveUsage(u: Traction, escrows: Escrow[], byId: Map<string, Order>): LiveUsage {
  return {
    realCustomers: u.realCustomers, realOrders: u.realOrders, arcTransfers: u.arcTxs.count, verified: u.arcTxs.verifiedOnArc,
    mismatch: u.arcTxs.mismatchOnArc, unchecked: u.arcTxs.notCheckedYet, simulatedOrders: u.excluded.simulatedOrders,
    testTransfers: testTxs(escrows, byId).length, rule: u.rule,
  };
}

// ---------- the overview (the tab /live opens on) ----------

/** The Orders page's "In progress" tab (src/app/orders/page.tsx); the rest (paid out, rejected) is finished. */
const IN_PROGRESS: Order["status"][] = ["CREATED", "PLAN_CHOSEN", "IN_PRODUCTION", "EVIDENCE_SUBMITTED", "ACCEPTED"];
/** Still to be made (the capacity board's open orders): the deadlines the studio still has to meet. */
const TO_MAKE: Order["status"][] = ["CREATED", "PLAN_CHOSEN", "IN_PRODUCTION"];
const WIB_MS = 7 * 3_600_000;

/** A time in WIB as the page writes times ("13:42", "13.42" in Indonesian); "tomorrow 01:20"; later "18 Oct, 09:00". */
function clockText(ms: number, now: number, t: T, locale: Locale): string {
  const d = new Date(ms + WIB_MS);
  const hm = `${String(d.getUTCHours()).padStart(2, "0")}${locale === "id" ? "." : ":"}${String(d.getUTCMinutes()).padStart(2, "0")}`;
  const days = daysUntil(ms, now);
  return days <= 0 ? hm : days === 1 ? t("tomorrow {time}", { time: hm }) : wib(new Date(ms).toISOString(), locale);
}

function runningItem(p: LivePrinter, raw: Printer | undefined, now: number, t: T, locale: Locale): LiveRunning {
  const progress = p.progress!;
  const left = raw?.snapshot?.remainingMin;
  // Bambu counts the minutes left from its last report, not from this page's clock.
  const seen = Date.parse(raw?.lastSeen ?? "");
  const from = Number.isFinite(seen) ? Math.min(seen, now) : now;
  const doneAt = p.online && !progress.paused && typeof left === "number" && Number.isFinite(left) && left >= 0
    ? clockText(from + Math.round(left) * 60_000, now, t, locale) : null;
  return {
    id: p.id, name: p.name, percent: progress.percent, paused: progress.paused, online: p.online, stage: p.stage?.text ?? null,
    needsPerson: Boolean(p.stage?.needsPerson), remaining: p.remaining, doneAt, order: p.order,
  };
}

const sumMicro = (xs: { amountMicro: number }[]) => xs.reduce((a, x) => a + x.amountMicro, 0);

function liveOverview(rows: LiveRows, printers: LivePrinter[], byId: Map<string, Order>, orderOf: (id: string) => LiveOrder,
  now: Date, t: T, locale: Locale): LiveOverview {
  const ms = now.getTime();
  const stats = machineStats(rows.printers, ms);
  const raw = new Map(rows.printers.map((p) => [p.id, p]));

  const fmt = formatters(locale, t);
  const next = rows.orders.filter((o) => TO_MAKE.includes(o.status)).map((o) => ({ o, due: deadlineEnd(o) }))
    .filter((x) => Number.isFinite(x.due)).sort((a, b) => a.due - b.due || a.o.id.localeCompare(b.o.id))[0];
  const real = rows.orders.filter((o) => o.label === "real").length;
  const inProgress = rows.orders.filter((o) => IN_PROGRESS.includes(o.status)).length;

  // Real orders: traction's own numbers (the Money tab's); tests: the transfers it does not count.
  const u = rows.usage.arcTxs;
  const realMicro = { test: u.volume?.testnet.micro ?? 0, main: u.volume?.mainnet.micro ?? 0 };
  const tests = testTxs(rows.escrows, byId);
  const testMicro = { test: sumMicro(tests.filter((x) => x.testnet)), main: sumMicro(tests.filter((x) => !x.testnet)) };
  const realPart: LiveMoneyPart = {
    transfers: u.count, verified: u.verifiedOnArc, volume: { testUsdc: microToUsdc(realMicro.test), usdc: microToUsdc(realMicro.main) },
  };
  const testPart: LiveMoneyPart = {
    transfers: tests.length, verified: tests.filter((x) => x.verified).length,
    volume: { testUsdc: microToUsdc(testMicro.test), usdc: microToUsdc(testMicro.main) },
  };

  // Today in Jakarta, from the same log the agent tab reads; counted as the Chief page counts.
  const start = Date.parse(`${jakartaDay(now)}T00:00:00+07:00`);
  const today = rows.log.filter((e) => {
    const at = Date.parse(e.at);
    return at >= start && at < start + DAY;
  });
  const steps = chiefSteps(today);

  return {
    printers: {
      total: stats.total, online: stats.online, printing: stats.printing, paused: stats.paused, ready: stats.ready,
      running: printers.filter((p) => p.progress).map((p) => runningItem(p, raw.get(p.id), ms, t, locale)),
      toCollect: printers.filter((p) => p.bedHolds).map((p) => ({ name: p.name, order: p.bedHolds!.order })),
    },
    orders: {
      total: rows.orders.length, inProgress, finished: rows.orders.length - inProgress, real, simulated: rows.orders.length - real,
      next: next ? { order: orderOf(next.o.id), due: fmt.dueIn(next.due, ms), day: fmt.day(next.due), late: next.due < ms } : null,
    },
    money: {
      transfers: realPart.transfers + testPart.transfers, verified: realPart.verified + testPart.verified,
      volume: { testUsdc: microToUsdc(realMicro.test + testMicro.test), usdc: microToUsdc(realMicro.main + testMicro.main) },
      real: realPart, test: testPart,
    },
    agent: {
      decisions: steps.filter(isDecision).length,
      handedToPerson: steps.filter(isEscalation).length,
      claudeRuns: today.filter((e) => e.actor === "agent" && e.tool === "agent_start").length,
    },
  };
}

// ---------- the whole page ----------

export interface LiveRows {
  printers: Printer[];
  orders: Order[];
  log: AgentLogEntry[];
  escrows: Escrow[];
  usage: Traction;
  /** started: prints the agent dispatcher has started (print jobs with actor "agent" that reached the printer). */
  agentPrints: { on: boolean; locked?: boolean; started?: number };
  /** The heartbeat's last round. */
  heartbeat?: { at: string; mode: "claude" | "rules" } | null;
  network: { name: string; isTestnet: boolean };
  /** Bambu's words for the faults reported now, in the page's language (src/app/machines/issue-texts.ts). */
  issueTexts: IssueTexts;
  /** Everyone in a "by" field elsewhere (tasks, printers, print jobs, files, the switch): hidden as "a person". */
  people: string[];
}

/** Everything /live shows, shaped from store rows. Pure. Pass the page's t and locale for the visitor's language. */
export function liveView(rows: LiveRows, now: Date, t: T = EN, locale: Locale = "en"): LiveView {
  const byId = new Map(rows.orders.map((o) => [o.id, o]));
  const orderOf = (id: string): LiveOrder => ({ id, label: tagOf(byId.get(id)) });
  const people = [
    ...rows.people,
    ...rows.log.flatMap((e) => {
      const i = (e.input ?? {}) as Record<string, unknown>;
      const o = (e.output ?? {}) as Record<string, unknown>;
      return [i.by, i.bedConfirmedBy, o.by];
    }),
    ...rows.orders.flatMap((o) => [o.ownerApproval?.by, o.slicerGrams?.by, o.actual?.by, o.review?.by, o.agreement?.by, o.autoPrint?.by]),
  ].filter((n): n is string => typeof n === "string" && nameParts(n).length > 0);
  const hide: Hide = {
    customers: rows.orders.map((o) => o.customerName ?? "").filter(Boolean),
    people: [...new Set(people)],
    // The product as typed, and as the Chief's texts quote it (name, phone and address already hidden).
    products: rows.orders.flatMap((o) => [o.product, agentText(o.product, o)]),
  };
  const feed = chiefFeed(rows.log, rows.orders, LIVE_AGENT_ITEMS, t).map((f) => liveAgentItem(f, orderOf, hide, rows.issueTexts, t, locale));
  const agent = [...feed, ...personPrints(rows.log, orderOf, hide, t, locale)]
    .sort((a, b) => b.at.localeCompare(a.at)).slice(0, LIVE_AGENT_ITEMS);
  const seen = rows.printers.map((p) => p.lastSeen).filter((x): x is string => Boolean(x)).sort().pop();
  const hb = rows.heartbeat;
  const printers = rows.printers.map((p) => livePrinter(p, now.getTime(), orderOf, rows.issueTexts, t));
  return {
    at: now.toISOString(),
    network: { name: rows.network.name, isTestnet: rows.network.isTestnet },
    printers,
    lastReport: seen ? ago(seen, now.getTime(), t) : null,
    agentPrints: { on: rows.agentPrints.on, locked: Boolean(rows.agentPrints.locked), started: rows.agentPrints.started ?? 0 },
    agentCheck: hb && Number.isFinite(Date.parse(hb.at)) ? { at: hb.at, ago: ago(hb.at, now.getTime(), t), mode: hb.mode === "claude" ? "claude" : "rules" } : null,
    agent,
    transfers: liveTransfers(rows.escrows, byId, locale),
    usage: liveUsage(rows.usage, rows.escrows, byId),
    overview: liveOverview(rows, printers, byId, orderOf, now, t, locale),
  };
}

/** The "by" fields outside the log and the orders: tasks, printers, print jobs, slices, controls, files and the switch. */
export function peopleIn(x: {
  tasks: OperatorTask[]; printers: Printer[]; jobs: PrintJob[]; extra?: unknown[];
}): string[] {
  return [
    ...x.tasks.map((k) => k.doneBy),
    ...x.printers.flatMap((p) => [p.colorsChecked?.by, p.bedCheck?.by]),
    ...x.jobs.flatMap((j) => [j.by, j.bedConfirmedBy]),
    ...(x.extra ?? []),
  ].filter((n): n is string => typeof n === "string" && nameParts(n).length > 0);
}

/** Agent prints that reached the printer. */
const STARTED: PrintJob["state"][] = ["sent", "printing", "done"];

/** Reads the store and shapes the page. Server only (Bambu's fault table is large). */
export function loadLive(t: T = EN, locale: Locale = "en", now: Date = new Date()): LiveView {
  const printers = store.listPrinters();
  const orders = store.listOrders();
  const jobs = store.listPrintJobs();
  const setting = autoPrintSetting();
  const net = publicNetwork();
  const last = heartbeatStatus().last;
  return liveView({
    printers,
    orders,
    log: allLog(),
    escrows: store.listEscrows(),
    usage: traction({ now }),
    agentPrints: { on: setting.on, locked: setting.locked, started: jobs.filter((j) => j.actor === "agent" && STARTED.includes(j.state)).length },
    heartbeat: last ? { at: last.at, mode: last.mode } : null,
    network: { name: net.name, isTestnet: net.isTestnet },
    issueTexts: issueTexts(printers, locale),
    people: peopleIn({
      tasks: store.listAllTasks(), printers, jobs,
      extra: [
        setting.by, ...store.listSliceJobs().map((j) => j.by), ...store.listPrinterCommands().map((c) => c.by),
        ...orders.flatMap((o) => [...store.listAttachments(o.id).map((a) => a.uploadedBy), store.getAcceptance(o.id)?.by]),
      ],
    }),
  }, now, t, locale);
}

/** How long one shaped page is reused: each tab refreshes every LIVE_REFRESH_S, so a crowd costs one store read per window. */
const CACHE_MS = 8_000;
const cache = new Map<Locale, { at: number; v: LiveView }>();

/** loadLive, kept a few seconds per language. /live is public and uncached otherwise; it runs on the process the bridge reports to. */
export function cachedLive(t: T, locale: Locale, now: number = Date.now()): LiveView {
  const hit = cache.get(locale);
  if (hit && now - hit.at >= 0 && now - hit.at < CACHE_MS) return hit.v;
  const v = loadLive(t, locale, new Date(now));
  cache.set(locale, { at: now, v });
  return v;
}
