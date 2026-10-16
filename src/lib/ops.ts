// Data shaping for the Chief (AI) page and the Operations page. Read-only, and the shaping itself is pure: every
// function below takes store rows as arguments, so the pages and the tests feed it the same way. Real and simulated
// orders are kept apart: an order's tag comes from its own label; a log row whose order no longer exists is
// "removed" and never counts as real business. No customer names, phones or addresses are returned.
import path from "node:path";
import * as store from "./store";
import { microToUsdc } from "./policy";
import { explorerTxBase, isTestnetChain } from "./network";
import { quoteIdr } from "./owner-rules";
import { agreementHash } from "./agreement";
import { skillOf, type Skill } from "./agent/skills";
import { nameOf } from "./colors";
import { whyLine as whyInPage } from "./printer/why-text";
import type { AgentLogEntry, ChainTx, Decision, Escrow, OperatorTask, Order, Quote } from "./types";
import { dateLocale, makeT, type Locale, type T } from "../i18n/core";

// ---------- small text and time helpers ----------

const WIB_MS = 7 * 3_600_000;
const rp = (n: number) => `Rp${Math.round(n).toLocaleString("id-ID")}`;
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string => (typeof v === "string" ? v : v === undefined || v === null ? "" : String(v));
/** Display texts go through `t`, the visitor's translator that the page passes in. Without one they stay English. */
const EN: T = makeT("en", {});

/** Markdown-free text: no bold, code ticks or heading marks. Line breaks are kept. */
export function plain(text: string): string {
  return text
    .replace(/\*\*|__|`/g, "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** The first paragraph on one line, cut at `max` characters. */
export function oneLine(text: string, max = 180): string {
  const first = plain(text).split(/\n\s*\n/)[0].replace(/\s+/g, " ").trim();
  return first.length > max ? `${first.slice(0, max - 1).trimEnd()}…` : first;
}

/** "15 Oct, 12:04" in Jakarta time (WIB); "15 Okt, 12.04" in Indonesian (a dot between hours and minutes, as id-ID writes it). */
export function wib(iso: string, locale: Locale = "en"): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "—";
  const d = new Date(t + WIB_MS);
  const month = d.toLocaleString(dateLocale(locale), { month: "short", timeZone: "UTC" });
  const sep = locale === "id" ? "." : ":";
  return `${d.getUTCDate()} ${month}, ${String(d.getUTCHours()).padStart(2, "0")}${sep}${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

/** "just now", "5 min ago", "3 h ago", "2 days ago". */
export function ago(iso: string, now: Date = new Date(), t: T = EN): string {
  const s = Math.round((now.getTime() - Date.parse(iso)) / 1000);
  if (!Number.isFinite(s)) return "—";
  if (s < 60) return t("just now");
  if (s < 3600) return t("{n} min ago", { n: Math.floor(s / 60) });
  if (s < 86_400) return t("{n} h ago", { n: Math.floor(s / 3600) });
  const d = Math.floor(s / 86_400);
  return t(d === 1 ? "{n} day ago" : "{n} days ago", { n: d });
}

/** Jakarta day of an ISO time: "2026-10-15". */
export const wibDay = (iso: string): string => new Date(Date.parse(iso) + WIB_MS).toISOString().slice(0, 10);

// ---------- orders: real, simulated or removed ----------

/** "studio": a row about the whole studio or one printer (the agent-prints switch, a printer with no order), not an order. */
export type OrderTag = "real" | "simulated" | "removed" | "studio";
export interface OrderRef { id: string; tag: OrderTag; product?: string }

/** Log rows filed under "studio" (src/lib/printer/dispatch.ts) or "printer:<id>" (src/lib/printer/actions.ts). */
const isStudioRow = (id: string) => id === "studio" || id.startsWith("printer:");

export function orderTagger(orders: Order[]): (id: string) => OrderRef {
  const byId = new Map(orders.map((o) => [o.id, o]));
  return (id) => {
    const o = byId.get(id);
    if (!o) return { id, tag: isStudioRow(id) ? "studio" : "removed" };
    return { id, tag: o.label === "real" ? "real" : "simulated", product: o.product };
  };
}

export type TagFilter = "all" | "real" | "simulated";
export const pickFilter = (v: string | string[] | undefined): TagFilter => {
  const w = Array.isArray(v) ? v[0] : v;
  return w === "real" || w === "simulated" ? w : "all";
};
/** "simulated" also holds rows of removed orders: neither is real business. Studio rows show under "all" only. */
export const matchesFilter = (tag: OrderTag, f: TagFilter): boolean =>
  f === "all" || (f === "real" ? tag === "real" : tag === "simulated" || tag === "removed");

// ---------- one line per log row ----------

export interface Described {
  title: string;
  line?: string;
  /** The full plain text behind the line, only when the line had to be shortened. */
  text?: string;
}

/** A one-line detail cut from free text, plus the full text when the cut left something out. */
function detail(raw: string, max?: number): { line: string; text?: string } {
  const line = oneLine(raw, max);
  const text = plain(raw);
  return text && text !== line ? { line, text } : { line };
}

/** A short title and an optional one-line detail for one decision-log row. Stored text (reasons, notes, questions,
 *  summaries) stays as written; only the fixed words around it go through `t`. */
export function describeEntry(e: AgentLogEntry, t: T = EN): Described {
  const i = obj(e.input);
  const o = obj(e.output);
  const reasons = Array.isArray(o.reasons) ? (o.reasons as unknown[]).map(str).join("; ") : str(o.error);
  switch (e.tool) {
    case "get_order": return { title: t("Read the order") };
    case "get_quotes": return { title: t("Read the quotes") };
    case "get_available_budget": return { title: t("Read the budget") };
    case "get_production_status": return { title: t("Read printers and payment") };
    case "check_vendor_policy":
      return e.ok ? { title: t("Quote {id} allowed", { id: str(i.quoteId) }) } : { title: t("Quote {id} refused", { id: str(i.quoteId) }), line: reasons };
    case "choose_plan":
      return e.ok ? { title: t("Chose plan {id}", { id: str(i.quoteId) }), ...detail(str(i.reason)) } : { title: t("Plan refused by policy"), line: reasons };
    case "price_by_weight":
      return e.ok
        ? {
          title: t("Priced by weight"),
          line: `${o.unitPriceIdr !== undefined ? t("{price}/unit", { price: rp(Number(o.unitPriceIdr)) }) : ""}${o.totalIdr !== undefined ? `, ${t("total {price}", { price: rp(Number(o.totalIdr)) })}` : ""}` || undefined,
        }
        : { title: t("Pricing refused"), line: reasons };
    case "price_from_costing":
      return { title: t("Priced with the cost calculator"), line: o.revenueIdr !== undefined ? t("Total {price}", { price: rp(Number(o.revenueIdr)) }) : undefined };
    case "slicer_grams":
      return { title: t(i.automatic ? "Grams from the automatic weighing" : "Slicer grams entered"), line: t("{g} g per unit", { g: str(i.gramsPerUnit) }) };
    // The customer's own design (src/lib/auto-weigh.ts): uploaded with the order, then weighed automatically.
    case "customer_design":
      return e.ok ? { title: t("Customer sent their design"), line: str(i.file) || undefined } : { title: t("Customer's design not stored"), line: reasons };
    case "auto_weigh": return { title: t("Automatic weighing could not start"), line: reasons };
    case "auto_weigh_result":
      return e.ok
        ? { title: t("Design weighed automatically"), line: t("{g} g per unit", { g: str(o.gramsPerUnit) }) }
        : { title: t("Automatic weighing: a person enters the grams"), line: oneLine(str(o.error)) || undefined };
    case "owner_approval": {
      const d = detail(str(i.note));
      return { title: t("Owner approved an exception"), ...d, line: d.line || undefined };
    }
    case "choose_printer": return e.ok ? { title: t("Chose {printer}", { printer: str(o.chose) || t("a printer") }) } : { title: t("No printer ready"), line: reasons };
    case "link_printer": return { title: t("Linked {printer}", { printer: str(o.printer) || str(i.printerId) }) };
    case "suggest_reroute":
      return { title: t("Suggested a reroute"), line: `${t("{printer} failed", { printer: str(i.failed) })}${o.suggestion ? `; ${t("try {printer}", { printer: str(o.suggestion) })}` : ""}` };
    case "create_operator_task": return { title: t("Task for the operator"), ...detail(str(i.text)) };
    case "request_human_decision": return { title: t("Asked a person"), ...detail(str(i.question) || str(o.question)) };
    case "message_customer": return { title: t("Messaged the customer"), ...detail(str(i.text)) };
    case "heartbeat": {
      const f = Array.isArray(o.findings) ? (o.findings as unknown[]).map((x) => str(obj(x).text)) : [];
      return { title: t(f.length === 1 ? "Heartbeat noticed {n} problem" : "Heartbeat noticed {n} problems", { n: f.length }), line: f[0] ? oneLine(f[0]) : undefined };
    }
    case "arc_verify":
      return e.ok
        ? { title: t("{kind} verified on Arc", { kind: kindLabel(str(i.kind), t) }) }
        : { title: t("{kind} not confirmed on Arc", { kind: kindLabel(str(i.kind), t) }), line: oneLine(str(o.reason)) || undefined };
    case "release_escrow":
      return e.ok ? { title: t("Escrow release started"), line: t("After the customer accepted") } : { title: t("Release held by policy"), line: reasons };
    case "refund_escrow":
      return e.ok ? { title: t("Refund started"), line: t("After the customer rejected") } : { title: t("Refund held by policy"), line: reasons };
    case "customer_decision": return { title: t(i.accepted ? "Customer accepted the print" : "Customer rejected the print") };
    case "customer_agreement":
      return { title: t("Customer approved price and spec"), line: i.version !== undefined ? t("Version {v}", { v: str(i.version) }) : undefined };
    case "customer_review": return { title: t("Customer left a review"), line: i.quality !== undefined ? t("Quality {q}/5", { q: str(i.quality) }) : undefined };
    case "customer_colors": {
      const colors = Array.isArray(i.colors) ? (i.colors as { name?: unknown }[]).map((c) => t(str(c?.name))).filter(Boolean) : [];
      return { title: t("Customer chose material and colours"), line: [str(i.material), ...colors].filter(Boolean).join(" · ") || undefined };
    }
    // Printing from the website: always a person (the Chief has no control tool).
    case "start_print": return { title: t("Print started by {name}", { name: str(i.by) }), line: [str(o.printer), str(o.jobId)].filter(Boolean).join(" · ") || undefined };
    case "printer_command": return { title: t("Printer control by {name}", { name: str(i.by) }), line: str(i.kind) || undefined };
    case "print_job":
      return e.ok ? { title: t("Print sent to the printer"), line: str(o.printer) || undefined } : { title: t("Print did not start"), line: oneLine(str(o.error)) || undefined };
    // A person removed a file from the order (the Chief has no tool for it). A failed row: its stored copy stayed.
    case "remove_file":
      return e.ok
        ? { title: t("File removed by {name}", { name: str(i.by) }), line: str(i.filename) || undefined }
        : { title: t("Stored copy not deleted"), line: [str(i.filename), str(o.storageKey)].filter(Boolean).join(" · ") || undefined };
    // Slicing on the studio PC (src/lib/slicing.ts): asked by a person, or by the agent through the dispatcher.
    case "slice_request":
      return {
        title: e.actor === "agent" ? t("Agent asked for a slice") : i.actor === "system" ? t("Weighing the customer's design")
          : t("Slice asked by {name}", { name: str(i.by) }),
        line: [str(i.file), [str(i.material), str(i.color) ? t(nameOf(str(i.color))) : ""].filter(Boolean).join(" ")].filter(Boolean).join(" · ") || undefined,
      };
    case "slice_result":
      return e.ok
        ? { title: t("Sliced on the studio PC"), line: [str(o.file), o.weightG ? `${str(o.weightG)} g` : "", o.minutes ? t("{m} min", { m: str(o.minutes) }) : ""].filter(Boolean).join(" · ") || undefined }
        : { title: t("Slice failed"), line: oneLine(str(o.error)) || undefined };
    case "slice_cancel": return { title: t("Slice cancelled by {name}", { name: str(i.by) }), line: str(i.file) || undefined };
    // Agent prints (src/lib/printer/dispatch.ts): code, never Claude, only after a person's "Bed is empty".
    case "auto_print":
      return { title: t("Agent started a print on {printer}", { printer: str(o.printer) || str(i.printerId) }),
        line: [str(i.file), i.bedConfirmedBy ? t("bed confirmed by {name}", { name: str(i.bedConfirmedBy) }) : ""].filter(Boolean).join(" · ") || undefined };
    case "auto_print_wait": return { title: t("Agent print waits"), line: whyLine(i, o, t) };
    case "auto_print_switch": return { title: t(i.on ? "Agent prints turned on by {name}" : "Agent prints turned off by {name}", { name: str(i.by) }) };
    case "auto_print_runs": return { title: t("Runs set by {name}", { name: str(i.by) }), line: t("{n} runs", { n: str(i.runsNeeded) }) };
    case "clear_bed": return { title: t("Bed confirmed empty by {name}", { name: str(i.by) }), line: str(o.printer) || undefined };
    // "Done (debug)" on a test order (src/lib/printer/done-debug.ts): a person, never the Chief; nothing was printed.
    case "print_done_debug": return { title: t("Print marked done for testing by {name}", { name: str(i.by) }), line: t("No real print: a test order") };
    case "request_dispatch": return { title: t("Asked the dispatcher to look"), line: oneLine(str(o.thisOrder)) || undefined };
    case "agent_start": return { title: triggerTitle(str(i.trigger), t), ...detail(str(i.trigger)) };
    case "agent_thought": case "agent_summary": return { title: t("Chief summary"), ...detail(str(o.text)) };
    case "llm_unavailable": return { title: t("Claude unavailable"), line: oneLine(str(o.error), 140) };
    case "agent_wake_skipped": return { title: t("Wake-up skipped"), ...detail(str(o.reason)) };
    default: return { title: e.tool.replace(/_/g, " ") };
  }
}

/** The dispatcher's stored reason (input.key + input.vars) in the page's language, else the English text it logged. */
function whyLine(i: Record<string, unknown>, o: Record<string, unknown>, t: T): string | undefined {
  const key = str(i.key);
  const vars = obj(i.vars) as Record<string, string | number>;
  return (key ? whyInPage(t, { key, vars }) : str(o.text)) || undefined;
}

const KIND_LABEL: Record<string, string> = {
  customer_topup: "Demo top-up", deposit: "Deposit", release: "Release", refund: "Refund",
};
const kindLabel = (k: string, t: T = EN) => (KIND_LABEL[k] ? t(KIND_LABEL[k]) : k ? k.replace(/_/g, " ") : t("Transfer"));

/** Why the Chief woke up, in a few words, from the trigger text the code wrote (chief.ts, heartbeat.ts, routes). */
export function triggerTitle(trigger: string, t: T = EN): string {
  if (/^Heartbeat check \(timer\)/i.test(trigger)) return t("Woken by the heartbeat");
  if (/^Heartbeat check \(button\)/i.test(trigger)) return t("Woken by a heartbeat run");
  if (/pressed Run agent/i.test(trigger)) return t("Run by the operator");
  if (/customer just placed/i.test(trigger)) return t("New customer order");
  if (/payment just arrived/i.test(trigger)) return t("Payment arrived in escrow");
  if (/entered grams per unit/i.test(trigger)) return t("Slicer grams entered");
  if (/owner approved an exception/i.test(trigger)) return t("Owner approved an exception");
  return t("Chief woke up");
}

// ---------- the Chief's decision feed: one item per run, beat or code action ----------

export interface Step { tool: string; skill: Skill; ok: boolean; n: number }

export interface FeedItem {
  id: string;
  kind: "run" | "heartbeat" | "action";
  /** For runs: Claude (started by agent_start) or the rule-based planner. */
  mode?: "claude" | "rules";
  order: OrderRef;
  at: string;
  title: string;
  /** One line: the result (summary, chosen plan, first finding, action detail). */
  line: string;
  trigger?: string;
  questions: string[];
  /** The full text behind the one line (Claude's summary, all findings). Plain text. */
  text?: string;
  steps: Step[];
  refused: number;
  model?: string;
  turns?: number;
  /** A Claude run with no summary yet: still running, or it stopped without one. */
  unfinished: boolean;
  /** The line reports that Claude could not be reached (kept apart from the text, which may be translated). */
  down?: boolean;
  /** The same item happened this many times in a row (e.g. one reminder raised on every printer report). */
  repeats: number;
  /** When the first of those repeats happened. */
  firstAt?: string;
}

/** Folds back-to-back items that say the same thing about the same order into one, with a count. Newest first in, newest first out. */
export function collapseRepeats<T extends { kind: string; order: OrderRef; title: string; line?: string; at: string; repeats: number; firstAt?: string }>(items: T[]): T[] {
  const out: T[] = [];
  for (const it of items) {
    const last = out[out.length - 1];
    if (last && last.kind === it.kind && last.order.id === it.order.id && last.title === it.title && (last.line ?? "") === (it.line ?? "")) {
      last.repeats += it.repeats;
      last.firstAt = it.firstAt ?? it.at;
      continue;
    }
    out.push({ ...it });
  }
  return out;
}

const RUN_GAP_MS = 15 * 60_000;
const PLANNER_GAP_MS = 60_000;
const MERGE_MS = 5_000;
const PLANNER_TOOLS = new Set(["get_order", "get_quotes", "get_available_budget", "check_vendor_policy", "choose_plan", "request_human_decision"]);
const BOOKKEEPING = new Set(["agent_start", "agent_thought", "agent_summary"]);

type Group = { item: FeedItem; rows: AgentLogEntry[]; last: number; closed: boolean };

function finish(g: Group, t: T): FeedItem {
  const it = g.item;
  let down = false;
  const steps = new Map<string, Step>();
  let refused = 0;
  for (const e of g.rows) {
    if (BOOKKEEPING.has(e.tool)) continue;
    if (!e.ok) refused++;
    const key = `${e.tool}|${e.ok}`;
    const s = steps.get(key);
    if (s) s.n++;
    else steps.set(key, { tool: e.tool, skill: skillOf(e.tool, e.input), ok: e.ok, n: 1 });
  }
  it.steps = [...steps.values()];
  it.refused = refused;
  it.questions = g.rows.filter((e) => e.tool === "request_human_decision")
    .map((e) => plain(str(obj(e.input).question) || str(obj(e.output).question))).filter(Boolean);

  if (it.kind === "run" && it.mode === "claude") {
    const summary = [...g.rows].reverse().find((e) => e.tool === "agent_summary" && str(obj(e.output).text))
      ?? [...g.rows].reverse().find((e) => e.tool === "agent_thought" && str(obj(e.output).text));
    const fin = g.rows.find((e) => e.tool === "agent_summary");
    const fail = g.rows.find((e) => e.tool === "llm_unavailable");
    it.text = summary ? plain(str(obj(summary.output).text)) : undefined;
    down = !it.text && Boolean(fail);
    it.line = it.text ? oneLine(it.text) : fail ? t("Claude unavailable: {error}", { error: oneLine(str(obj(fail.output).error), 120) })
      : it.questions[0] ? oneLine(it.questions[0]) : t("No summary yet");
    it.turns = fin ? Number(obj(fin.input).turns) || undefined : undefined;
    it.model = str(obj(fin?.input).model) || str(obj(g.rows[0].input).model) || undefined;
    it.unfinished = !fin && !fail;
  } else if (it.kind === "run") {
    const plan = g.rows.find((e) => e.tool === "choose_plan");
    const d = plan ? describeEntry(plan, t) : undefined;
    it.line = d ? d.line ?? d.title : it.questions[0] ? t("Asked a person: {q}", { q: oneLine(it.questions[0]) }) : t("No plan chosen");
    it.text = d?.text;
  } else if (it.kind === "heartbeat") {
    const f = Array.isArray(obj(g.rows[0].output).findings) ? (obj(g.rows[0].output).findings as unknown[]).map((x) => plain(str(obj(x).text))) : [];
    it.title = describeEntry(g.rows[0], t).title;
    it.line = f[0] ? oneLine(f[0]) : t("Nothing new");
    // All findings, or the one finding in full when the line had to cut it.
    it.text = f.length > 1 ? f.map((x) => `• ${x}`).join("\n") : f[0] && f[0] !== it.line ? f[0] : undefined;
  } else {
    const verify = g.rows.filter((e) => e.tool === "arc_verify");
    if (verify.length > 1 && verify.length === g.rows.length) {
      const bad = verify.filter((e) => !e.ok).length;
      it.title = t("Checked {n} transfers on Arc", { n: verify.length });
      it.line = bad ? t("{n} not confirmed on Arc", { n: bad }) : t("All match on Arc");
    } else {
      const main = g.rows.find((e) => !e.ok) ?? g.rows[g.rows.length - 1];
      const d = describeEntry(main, t);
      it.title = d.title;
      it.line = d.line ?? (g.rows.length > 1 ? g.rows.map((e) => describeEntry(e, t).title).join(" · ") : "");
      const long = g.rows.map((e) => str(obj(e.input).text) || str(obj(e.output).text)).filter(Boolean);
      const full = plain(long.join("\n\n"));
      if (full && full !== it.line) it.text = full;
    }
  }
  // Same test as on the English line: stored text (a summary, an error) is never translated, so it still matches.
  it.down = down || /^Claude unavailable/.test(it.line);
  return it;
}

/**
 * The Chief's work across all orders, newest first: Claude runs (agent_start … agent_summary, with their tool calls
 * grouped), rule-planner runs, heartbeat findings and code actions (tasks, printer picks, Arc checks, settlements).
 * People's own rows (actor "human") are left out: they are not the Chief's decisions.
 */
export function chiefFeed(log: AgentLogEntry[], orders: Order[], limit = 15, t: T = EN): FeedItem[] {
  const ref = orderTagger(orders);
  const groups: Group[] = [];
  const openRun = new Map<string, Group>();
  let prev: Group | undefined;
  const start = (kind: FeedItem["kind"], e: AgentLogEntry, mode?: FeedItem["mode"]): Group => {
    const d = describeEntry(e, t);
    const g: Group = {
      item: {
        id: `log-${e.id}`, kind, mode, order: ref(e.orderId), at: e.at, title: d.title, line: d.line ?? "",
        trigger: e.tool === "agent_start" ? plain(str(obj(e.input).trigger)) : undefined,
        questions: [], steps: [], refused: 0, unfinished: false, repeats: 1,
      },
      rows: [e], last: Date.parse(e.at), closed: false,
    };
    if (kind === "run" && mode === "rules") g.item.title = t("Rule-based planner");
    groups.push(g);
    return g;
  };
  const add = (g: Group, e: AgentLogEntry) => { g.rows.push(e); g.last = Math.max(g.last, Date.parse(e.at)); };

  for (const e of [...log].sort((a, b) => a.id - b.id)) {
    if (e.actor !== "agent") continue;
    const t = Date.parse(e.at);
    if (e.tool === "agent_start") {
      openRun.set(e.orderId, (prev = start("run", e, "claude")));
      continue;
    }
    const run = openRun.get(e.orderId);
    if (run && e.tool !== "heartbeat" && t - run.last <= RUN_GAP_MS) {
      add(run, e);
      if (e.tool === "agent_summary") openRun.delete(e.orderId);
      prev = run;
      continue;
    }
    if (run) openRun.delete(e.orderId);
    if (e.tool === "heartbeat") { prev = start("heartbeat", e); continue; }
    if (PLANNER_TOOLS.has(e.tool)) {
      const p = prev && prev.item.kind === "run" && prev.item.mode === "rules" && !prev.closed && prev.item.order.id === e.orderId
        && t - prev.last <= PLANNER_GAP_MS ? prev : undefined;
      if (p) {
        add(p, e);
        if (e.tool === "choose_plan" || e.tool === "request_human_decision") p.closed = true;
        continue;
      }
      if (e.tool === "get_order") { prev = start("run", e, "rules"); continue; }
    }
    if (prev && prev.item.kind === "action" && prev.item.order.id === e.orderId && Math.abs(t - prev.last) <= MERGE_MS) {
      add(prev, e);
      continue;
    }
    prev = start("action", e);
  }
  const items = groups.sort((a, b) => b.item.at.localeCompare(a.item.at) || b.rows[0].id - a.rows[0].id).map((g) => finish(g, t));
  return collapseRepeats(items).slice(0, limit);
}

// ---------- activity audit: one timeline over the log, decisions, tasks and escrow transfers ----------

export type AuditKind = "chief" | "heartbeat" | "code" | "person" | "decision" | "task" | "money";
export interface AuditEvent {
  id: string;
  /** Tie-break for rows written in the same millisecond: the log row id, else 0. */
  seq: number;
  at: string;
  kind: AuditKind;
  order: OrderRef;
  title: string;
  line?: string;
  /** The full text behind the line, when there is more than the line shows (the Chief's summary, all findings). */
  text?: string;
  ok: boolean;
  /** Explorer link for an on-chain transfer. */
  href?: string;
  repeats: number;
  firstAt?: string;
}

const FAILED: ChainTx["state"][] = ["FAILED", "DENIED", "CANCELLED"];
const FINAL: ChainTx["state"][] = ["COMPLETE", ...FAILED];

export function auditEvents(rows: {
  orders: Order[]; log: AgentLogEntry[]; decisions: Decision[]; tasks: OperatorTask[]; escrows: Escrow[];
}, t: T = EN): AuditEvent[] {
  const ref = orderTagger(rows.orders);
  const out: AuditEvent[] = [];
  // A rule-planner run that ends in a plan decision is shown once, as the decision.
  const decided = (f: FeedItem) => rows.decisions.some((d) => d.orderId === f.order.id && Math.abs(Date.parse(d.at) - Date.parse(f.at)) <= 2_000);
  for (const f of chiefFeed(rows.log, rows.orders, Number.MAX_SAFE_INTEGER, t)) {
    if (f.kind === "run" && f.mode === "rules" && decided(f)) continue;
    const full = f.text ?? f.questions.join("\n\n");
    out.push({
      id: f.id, seq: Number(f.id.slice(4)), at: f.at, order: f.order, ok: !f.down, repeats: f.repeats, firstAt: f.firstAt,
      kind: f.kind === "run" ? "chief" : f.kind === "heartbeat" ? "heartbeat" : "code",
      title: f.kind === "run" ? (f.mode === "claude" ? t("Chief run: {what}", { what: f.title.toLowerCase() }) : t("Rule-based planner")) : f.title,
      line: f.line || undefined, text: full && full !== f.line ? full : undefined,
    });
  }
  for (const e of rows.log) {
    if (e.actor !== "human") continue;
    const d = describeEntry(e, t);
    out.push({ id: `log-${e.id}`, seq: e.id, at: e.at, kind: "person", order: ref(e.orderId), title: d.title, line: d.line, text: d.text, ok: e.ok, repeats: 1 });
  }
  rows.decisions.forEach((d, i) => {
    out.push({
      id: `dec-${i}-${d.orderId}`, seq: 0, at: d.at, kind: "decision", order: ref(d.orderId), ok: true, repeats: 1,
      title: t(d.decidedBy === "agent" ? "Plan chosen by the Chief" : "Plan chosen by a person"), ...detail(d.reason),
    });
  });
  for (const k of rows.tasks) {
    if (k.status !== "done" || !k.doneAt) continue;
    out.push({
      id: `task-${k.id}`, seq: 0, at: k.doneAt, kind: "task", order: ref(k.orderId), ok: true, repeats: 1,
      title: k.doneBy ? t("Task done by {name}", { name: k.doneBy.split(" (")[0] }) : t("Task done"), ...detail(k.text, 140),
    });
  }
  for (const e of rows.escrows) {
    const unit = t(isTestnetChain(e.network) ? "test USDC" : "USDC");
    e.txs.forEach((x, i) => {
      const state = t(x.state === "COMPLETE" ? "complete" : x.state.toLowerCase().replace(/_/g, " "));
      const check = x.verified ? ` · ${t(x.verified.ok ? "verified on Arc" : "not confirmed on Arc")}` : "";
      out.push({
        id: `tx-${e.orderId}-${i}`, seq: 0, at: x.at, kind: "money", order: ref(e.orderId), ok: !FAILED.includes(x.state) && x.verified?.ok !== false, repeats: 1,
        title: `${kindLabel(x.kind, t)} · ${microToUsdc(x.amountMicro)} ${unit}`,
        line: `${state}${check}${x.kind === "customer_topup" ? ` · ${t("internal test funds")}` : ""}`,
        href: x.txHash ? `${explorerTxBase(e.network)}${x.txHash}` : undefined,
      });
    });
  }
  return collapseRepeats(out.sort((a, b) => b.at.localeCompare(a.at) || b.seq - a.seq));
}

// ---------- money flow: Rupiah price, then test USDC through the escrow ----------

export interface Amount { testnet: number; mainnet: number }
export interface FlowStep { count: number; micro: Amount }
export interface FlowSet {
  orders: number;
  priced: number;          // a plan (price) was chosen
  agreed: number;          // the customer approved the price and spec
  agreedIdr: number;       // their agreed prices, in rupiah
  topup: FlowStep;         // demo funds → customer wallet (testnet only)
  deposit: FlowStep;       // customer wallet → escrow
  held: FlowStep;          // escrows FUNDED now
  release: FlowStep;       // escrow → Kesuni, after the customer accepted
  refund: FlowStep;        // escrow → customer, after a rejection
  awaiting: number;        // escrows waiting for the deposit
  pending: number;         // transfers not final yet
  failed: number;          // transfers that failed, were denied or cancelled
  escrows: number;
}
export interface MoneyFlow { real: FlowSet; simulated: FlowSet }

const step = (): FlowStep => ({ count: 0, micro: { testnet: 0, mainnet: 0 } });
const emptySet = (): FlowSet => ({
  orders: 0, priced: 0, agreed: 0, agreedIdr: 0, topup: step(), deposit: step(), held: step(), release: step(), refund: step(),
  awaiting: 0, pending: 0, failed: 0, escrows: 0,
});

/** Counts per step of the money path, real orders and simulated ones apart. Removed orders are left out. */
export function moneyFlow(orders: Order[], escrows: Escrow[], quoteOf: (id: string) => Quote | undefined): MoneyFlow {
  const flow: MoneyFlow = { real: emptySet(), simulated: emptySet() };
  const byId = new Map(orders.map((o) => [o.id, o]));
  for (const o of orders) {
    const s = o.label === "real" ? flow.real : flow.simulated;
    s.orders++;
    if (o.chosenQuoteId) s.priced++;
    // Same rule as finance.countsAsAgreed: the customer's approval still matches the chosen quote, and not rejected.
    const q = o.chosenQuoteId ? quoteOf(o.chosenQuoteId) : undefined;
    if (o.status !== "REJECTED" && o.agreement && q && o.agreement.hash === agreementHash(o, q)) {
      s.agreed++;
      s.agreedIdr += quoteIdr(o, q);
    }
  }
  for (const e of escrows) {
    const o = byId.get(e.orderId);
    if (!o) continue;
    const s = o.label === "real" ? flow.real : flow.simulated;
    const net: keyof Amount = isTestnetChain(e.network) ? "testnet" : "mainnet";
    const bump = (st: FlowStep, micro: number) => { st.count++; st.micro[net] += micro; };
    s.escrows++;
    if (e.state === "FUNDED") bump(s.held, e.amountMicro);
    if (e.state === "AWAITING_DEPOSIT") s.awaiting++;
    for (const t of e.txs) {
      if (FAILED.includes(t.state)) { s.failed++; continue; }
      if (!FINAL.includes(t.state)) { s.pending++; continue; }
      if (t.kind === "customer_topup") bump(s.topup, t.amountMicro);
      else bump(s[t.kind], t.amountMicro);
    }
  }
  return flow;
}

// ---------- integration status ----------

export type RowStatus = "ok" | "warn" | "bad" | "neutral";
export interface IntegrationRow {
  id: string;
  icon: "chain" | "wallet" | "printer" | "bot" | "pulse" | "orders" | "layers" | "shield";
  name: string;
  line: string;
  status: RowStatus;
  chip: string;
}

export interface IntegrationInput {
  now: Date;
  agent: { mode: "claude" | "rules"; model: string; profile: string | null; hasApiKey: boolean };
  heartbeat: { enabled: boolean; intervalSeconds: number; schedulerRunning: boolean; lastAt: string | null; nextRunAt: string | null; lastErrors: number };
  printers: { total: number; online: number; lastSeen: string | null };
  network: { name: string; isTestnet: boolean };
  mainnetUnlocked: boolean;
  db: { orders: number; real: number; logRows: number; where: DbWhere };
  customerLinks: number;
}

/** Where the database file sits: this computer, a Railway volume, or a Railway disk that every deploy wipes. */
export type DbWhere = "local" | "volume" | "no-volume";

/** From the deploy storage plan (deploy.ts storagePlan): on Railway the file counts as safe only inside the volume. */
export function dbWhere(p: { onRailway: boolean; volume: string | null; dbPath: string }): DbWhere {
  if (!p.onRailway) return "local";
  if (!p.volume) return "no-volume";
  const rel = path.posix.relative(p.volume, p.dbPath);
  return rel && !rel.startsWith("..") && !path.posix.isAbsolute(rel) ? "volume" : "no-volume";
}

const DB_PLACE: Record<DbWhere, { place: string; status: RowStatus; chip: string }> = {
  local: { place: "On this computer", status: "neutral", chip: "local" },
  volume: { place: "Railway volume", status: "ok", chip: "server" },
  "no-volume": { place: "Railway, not on a volume: lost on every deploy", status: "warn", chip: "no volume" },
};

const clock = (iso: string | null, locale: Locale) => (iso ? `${wib(iso, locale).split(", ")[1]} WIB` : "—");
/** "2 min" or "90 s". */
export const every = (seconds: number, t: T = EN): string =>
  seconds >= 60 && seconds % 60 === 0 ? t("{n} min", { n: seconds / 60 }) : t("{n} s", { n: seconds });

/** Everything except Arc and Circle, which need a network call (see chainRows). Pure: config flags in, rows out. */
export function integrationRows(x: IntegrationInput, t: T = EN, locale: Locale = "en"): IntegrationRow[] {
  const rows: IntegrationRow[] = [];
  const p = x.printers;
  rows.push({
    id: "printers", icon: "printer", name: t("Printer bridge (Bambu Lab, LAN)"),
    line: p.total === 0 ? t("No printer has reported yet")
      : `${t("{online} of {total} printers reported in the last 2 min", { online: p.online, total: p.total })}${p.lastSeen ? ` · ${t("last {when}", { when: ago(p.lastSeen, x.now, t) })}` : ""}`,
    status: p.total === 0 ? "warn" : p.online === p.total ? "ok" : p.online > 0 ? "warn" : "bad",
    chip: t(p.total === 0 ? "not set up" : p.online === p.total ? "live" : p.online > 0 ? "partly online" : "offline"),
  });
  const a = x.agent;
  rows.push({
    id: "claude", icon: "bot", name: t("Chief agent (Claude)"),
    line: a.mode === "claude"
      ? `${a.model}${a.profile ? ` · ${t(a.profile === "demo" ? "Demo profile" : "Test profile")}` : ""}${a.hasApiKey ? "" : ` · ${t("no API key")}`}`
      : t(a.hasApiKey ? "Rule-based planner only (KESUNI_AGENT_MODE=rules)" : "Rule-based planner only: no Claude API key"),
    status: a.mode === "claude" && a.hasApiKey ? "ok" : "warn",
    chip: t(a.mode === "claude" && a.hasApiKey ? "on" : "rules only"),
  });
  const h = x.heartbeat;
  const lastMs = h.lastAt ? Date.parse(h.lastAt) : NaN;
  const late = h.enabled && (!Number.isFinite(lastMs) || x.now.getTime() - lastMs > 3 * h.intervalSeconds * 1000);
  rows.push({
    id: "heartbeat", icon: "pulse", name: t("Heartbeat timer"),
    line: h.enabled
      ? t("Every {every} · last {last} · next {next}", { every: every(h.intervalSeconds, t), last: clock(h.lastAt, locale), next: clock(h.nextRunAt, locale) })
      : t("Off (KESUNI_HEARTBEAT_SECONDS=0); runs only by button"),
    status: !h.enabled || late ? "warn" : h.lastErrors > 0 ? "warn" : "ok",
    chip: !h.enabled ? t("off") : late ? t(h.schedulerRunning ? "late" : "not running")
      : h.lastErrors > 0 ? t(h.lastErrors === 1 ? "{n} error" : "{n} errors", { n: h.lastErrors }) : t("on"),
  });
  rows.push({
    id: "customer", icon: "orders", name: t("Customer pages"),
    line: `${t("Order form and order links")} · ${x.customerLinks
      ? t(x.customerLinks === 1 ? "{n} order link issued" : "{n} order links issued", { n: x.customerLinks })
      : t("no order links issued yet")}`,
    status: "ok", chip: t("on"),
  });
  const db = DB_PLACE[x.db.where];
  rows.push({
    id: "db", icon: "layers", name: t("Database (SQLite)"),
    line: `${t(db.place)} · ${t(x.db.orders === 1 ? "{n} order ({real} real)" : "{n} orders ({real} real)", { n: x.db.orders, real: x.db.real })} · ${t("{n} log rows", { n: x.db.logRows })}`,
    status: db.status, chip: t(db.chip),
  });
  rows.push({
    id: "mainnet", icon: "shield", name: t("Mainnet lock"),
    line: x.network.isTestnet
      ? `${t("{name}, test USDC only", { name: x.network.name })} · ${t(x.mainnetUnlocked ? "KESUNI_ALLOW_MAINNET=1 is set" : "mainnet needs KESUNI_ALLOW_MAINNET=1")}`
      : `${t("{name}, real USDC", { name: x.network.name })} · ${t(x.mainnetUnlocked ? "unlocked by KESUNI_ALLOW_MAINNET=1" : "locked: no USDC can move")}`,
    status: x.mainnetUnlocked ? "warn" : "ok",
    chip: t(x.mainnetUnlocked ? "unlocked" : "locked"),
  });
  return rows;
}

/** The Arc RPC and Circle rows, from the read-only chain health check (chain-health.ts). */
export function chainRows(h: {
  network: { name: string; isTestnet: boolean };
  arc: { status: string; chainId?: number; expectedChainId?: number; blockNumber?: string; blockAgeSec?: number; reason?: string };
  circle: { status: string; walletSet?: string; wallet?: { usdc: string; state: string } | null; reason?: string };
}, t: T = EN): IntegrationRow[] {
  const ARC: Record<string, [RowStatus, string]> = {
    ok: ["ok", "live"], stale: ["warn", "stale"], wrong_chain: ["bad", "wrong chain"], bad_token: ["bad", "USDC mismatch"],
    unreachable: ["bad", "unreachable"], not_configured: ["warn", "not configured"],
  };
  const CIRCLE: Record<string, [RowStatus, string]> = { ok: ["ok", "reachable"], unreachable: ["bad", "unreachable"], not_configured: ["warn", "not configured"] };
  const [as, ac] = ARC[h.arc.status] ?? ["warn", h.arc.status];
  const [cs, cc] = CIRCLE[h.circle.status] ?? ["warn", h.circle.status];
  const arcLine = h.arc.status === "ok" || h.arc.status === "stale"
    ? `${h.network.name}${h.arc.blockNumber ? ` · ${t("block {n}", { n: h.arc.blockNumber })}` : ""}${h.arc.blockAgeSec !== undefined ? ` · ${t("{n} s old", { n: h.arc.blockAgeSec })}` : ""}`
    : oneLine(h.arc.reason ? t(h.arc.reason) : h.network.name, 120);
  const w = h.circle.wallet;
  const circleLine = h.circle.status === "ok"
    ? `${t("Wallet set {state}", { state: t(h.circle.walletSet ?? "reachable") })}${w
      ? ` · ${t("demo funds {amount}", { amount: `${w.usdc} ${t(h.network.isTestnet ? "test USDC" : "USDC")}` })}`
      : w === null ? ` · ${t("demo-funds wallet not found")}` : ""}`
    : `${oneLine(t(h.circle.reason ?? "No answer"), 110)}${h.circle.status === "unreachable" ? ` · ${t("on a blocked ISP, turn on WARP")}` : ""}`;
  return [
    { id: "arc", icon: "chain", name: "Arc RPC", line: arcLine, status: as, chip: t(ac) },
    { id: "circle", icon: "wallet", name: t("Circle wallets"), line: circleLine, status: cs, chip: t(cc) },
  ];
}

// ---------- loaders (read the store; the shaping above stays pure) ----------

const ALL_FROM = "1970-01-01T00:00:00.000Z";
const ALL_TO = "9999-12-31T23:59:59.999Z";
/** Every decision-log row of every order, oldest first. */
export const allLog = (): AgentLogEntry[] => store.listLogBetween(ALL_FROM, ALL_TO);

export function loadAudit(t: T = EN): AuditEvent[] {
  return auditEvents({
    orders: store.listOrders(), log: allLog(), decisions: store.listAllDecisions(), tasks: store.listAllTasks(), escrows: store.listEscrows(),
  }, t);
}

export function loadMoneyFlow(): MoneyFlow {
  return moneyFlow(store.listOrders(), store.listEscrows(), store.getQuote);
}
