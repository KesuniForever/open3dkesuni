// The agent dispatcher: deterministic code, no Claude call, no cost. It is the only way the agent prints by itself.
// When a person turned "Agent may start prints" on, it takes the orders in production by earliest deadline and, for each,
// either asks the studio PC for one slice (the order's newest design file, an STL or OBJ, in the order's one colour,
// src/lib/slicing.ts) or starts the file the studio PC sliced from it on the best printer that passes every gate
// (createAgentPrintJob in jobs.ts re-checks them all). Never on a bed a person has not confirmed empty ("Bed is empty" on
// My machines) since the last print, and one print per confirmation.
// It runs (runDispatch) when a person confirms a bed empty or marks a task done, after every printer report,
// when a slice arrives, when the switch turns on, when a person sets an order's runs, on each heartbeat, and when the
// Chief asks (request_dispatch: it can only ask; the order of the queue and every gate stay in code). Synchronous inside
// one store transaction: two triggers at once queue one print, never two. Every start, slice and changed reason is in
// the decision log (actor "agent"); a missing spool raises one "Load ..." task, closed by code once it is loaded.
// planDispatch is the same decision without writes: the "why not" lines on My machines, the order page and the Chief page.
import * as store from "../store";
import type { Fail } from "../actions";
import { colorsCheckedNow, deltaE, matchJob, MATCH_MAX_DELTA_E, nameOf, normalizeHex } from "../colors";
import { deadlineEnd } from "../owner-rules";
import { cancelSliceJob, expireStaleSlices, requestSlice, slicerStatus } from "../slicing";
import { sliceSourceCheck } from "../slice-rules";
import { isPersonName, ONLINE_MS, slotLabel } from "./control";
import { createTask, printerName, printerRef } from "./actions";
import { createAgentPrintJob, expireStale } from "./jobs";
import {
  autoPrintSetting, jobsInFlight, newestDesign, orderGate, pairing, plateColourList, plateColours, printerGate, printSources, PRODUCTION_STATUSES,
  type AutoPrintSetting, type PrinterGate, type PrintSource,
} from "./autoprint";
import { AUTO_PRINT_META, bedState, MAX_RUNS, whyText, type Why } from "./autoprint-rules";
import type { AgentLogEntry, Order, Printer, ThreeMfFilament } from "../types";

const fail = (status: number, error: string, reasons?: string[]): Fail => ({ ok: false, status, error, reasons });
const iso = (now: number) => new Date(now).toISOString();
/** Log rows about the whole studio (the switch) are filed under this id: it is not an order. */
export const STUDIO = "studio";
/** The dispatcher's memory: each order's last reason, so a reason is logged once when it changes, not on every report. */
const LAST_META = "autoPrintLast";
const LOAD_PREFIX = "autoprint:load:";
/** Agent slices of one source that failed because of the studio PC (or were cancelled by turning the switch off) before
 *  the agent stops asking: a person slices it then. A slice that failed because of the model is never asked again. */
const MAX_AGENT_SLICE_TRIES = 3;
/** Reasons that are the normal state of an order, not a decision worth a log row. */
const QUIET = new Set([
  "Not a real order: a person sets its runs to let the agent print it", "A person set 0 runs: the agent does not print it",
  "All runs printed ({done} of {needed})", "Run {n} of {needed} is on the printer", "Slicing on the studio PC…", "Started on {printer}",
  "Marked printed for testing: the agent does not print it",
]);

export type Trigger =
  | "bed_cleared" | "task_done" | "printer_report" | "colors_confirmed" | "slice_done" | "switch_on" | "runs_set" | "heartbeat" | "chief";

export interface OrderLine {
  orderId: string;
  why: Why;
  /** print / slice: what the dispatcher would do now (preview); started / slicing: done; wait: nothing yet. */
  action: "print" | "slice" | "started" | "slicing" | "wait";
  /** The printer it would print on, or waits for. */
  printerId?: string;
  runsDone: number;
  runsNeeded: number;
  runsActive: number;
}

export interface PrinterLine {
  printerId: string;
  /** Why the agent would not print on it now; null when it can (or just did). */
  why: Why | null;
  /** The order the agent prints here next (now, or once a person confirms the bed), and in what (English colour names). */
  next: { orderId: string; what: string; colours: { material: string; name: string }[] } | null;
  /** A person's "Bed is empty" the agent may still use. */
  bed: { by: string; at: string } | null;
  /** A print job on its way to this printer (queued, uploading or sent): no new "Bed is empty" is asked for. */
  jobOnItsWay: string | null;
}

export interface DispatchPlan {
  on: boolean;
  by: string | null;
  at: string | null;
  /** KESUNI_AUTO_PRINT=off on this server. */
  locked: boolean;
  printers: Record<string, PrinterLine>;
  orders: Record<string, OrderLine>;
}

export interface DispatchResult {
  on: boolean;
  trigger: Trigger;
  /** Another dispatch was running in this process (it covers this one). */
  busy?: boolean;
  error?: string;
  started: { jobId: string; orderId: string; printerId: string }[];
  sliced: { sliceId: string; orderId: string }[];
  plan?: DispatchPlan;
}

interface Ctx {
  now: number;
  run: boolean;
  trigger: Trigger;
  setting: AutoPrintSetting;
  printers: Printer[];
  gates: Map<string, PrinterGate>;
  /** Printers an earlier order took in this pass (started on, or waits for its bed). */
  takenBy: Map<string, NonNullable<PrinterLine["next"]>>;
  missing: Map<string, { type: string; color: string; orderId: string }>;
  started: DispatchResult["started"];
  sliced: DispatchResult["sliced"];
}

const byDeadline = (a: Order, b: Order) =>
  (deadlineEnd(a) || Infinity) - (deadlineEnd(b) || Infinity) || (a.createdAt ?? "").localeCompare(b.createdAt ?? "") || a.id.localeCompare(b.id);
const isOnline = (p: Printer, now: number) => Boolean(p.lastSeen) && now - Date.parse(p.lastSeen!) <= ONLINE_MS;
const spoolKey = (type: string, color: string) => `${LOAD_PREFIX}${type.toUpperCase()}:${color}`;
const missingWhy = (type: string, color: string): Why => ({ key: "No spool of {material} {name} loaded", vars: { material: type.toUpperCase(), name: nameOf(color) } });
const onPrinter = (p: Printer, why: Why | string): Why =>
  ({ key: "{printer}: {reason}", vars: { printer: printerName(p.id), reason: typeof why === "string" ? why : whyText(why) } });

/** A spool of this material within the colour limit on a printer, nearest colour first. */
function spoolsOf(printers: Printer[], type: string, color: string) {
  const want = normalizeHex(color) ?? "#000000";
  return printers.flatMap((p) => (p.snapshot?.ams?.trays ?? [])
    .filter((t) => !t.empty && t.color && t.type?.toUpperCase() === type.toUpperCase())
    .map((t) => ({ p, tray: t.ams * 4 + t.slot, d: deltaE(want, t.color!) })))
    .filter((x) => x.d <= MATCH_MAX_DELTA_E)
    .sort((a, b) => a.d - b.d || a.p.id.localeCompare(b.p.id) || a.tray - b.tray);
}

/** The bed reason, said about one printer (the order's line names the printer it waits for). */
function bedWait(p: Printer, gate: PrinterGate): Why {
  const vars = { printer: printerName(p.id) };
  if (gate.why?.key === "The bed holds a finished print: a person empties it") return { key: "The bed of {printer} holds a finished print: a person empties it", vars };
  if (gate.why?.key === "The bed was confirmed more than 2 h ago: confirm it again") return { key: "Confirm the bed on {printer} again: the last check is over 2 h old", vars };
  return { key: "Waiting for a person to confirm the bed on {printer}", vars };
}

// ---------- one order with a sliced file: pick the printer ----------

function placePrint(ctx: Ctx, o: Order, src: PrintSource, line: (why: Why, action?: OrderLine["action"], printerId?: string) => OrderLine): OrderLine {
  const { now, printers } = ctx;
  const count = src.info.projectFilaments?.length;
  const what = plateColours(src.plate);
  const holders = printers.map((p) => ({ p, match: matchJob(src.plate.filaments, p, count) })).filter((x) => x.match.ok);
  if (!holders.length) {
    // The first filament no printer holds: one "Load ..." task for it.
    const f = src.plate.filaments.find((x: ThreeMfFilament) => !spoolsOf(printers, x.type, x.color).length) ?? src.plate.filaments[0];
    const color = normalizeHex(f.color) ?? "#000000";
    if (!spoolsOf(printers, f.type, color).length) ctx.missing.set(spoolKey(f.type, color), { type: f.type.toUpperCase(), color, orderId: o.id });
    return line(missingWhy(f.type, color));
  }
  const free = holders.filter(({ p }) => (!p.currentOrderId || p.currentOrderId === o.id) && !ctx.takenBy.has(p.id));
  if (!free.length) {
    const p = holders[0].p;
    return line({ key: "Waiting for {printer}: {order} goes first", vars: { printer: printerName(p.id), order: ctx.takenBy.get(p.id)?.orderId ?? p.currentOrderId ?? "" } });
  }
  const scored = free.map(({ p, match }) => {
    const gate = ctx.gates.get(p.id)!;
    const pair = gate.readyButBed ? pairing(p, src, o.id, now, gate.bed?.by ?? "Operator") : null;
    const worst = Math.max(0, ...match.suggestions.map((s) => s.slots.find((sl) => sl.slot === match.mapping[s.filamentId - 1])?.deltaE ?? 0));
    const usable = Boolean(pair && pair.reasons.length === 0);
    return { p, gate, pair, worst, usable, ready: usable && gate.ok };
  }).sort((a, b) => Number(b.p.currentOrderId === o.id) - Number(a.p.currentOrderId === o.id) || Number(b.ready) - Number(a.ready)
    || Number(b.usable) - Number(a.usable) || a.worst - b.worst || a.p.id.localeCompare(b.p.id));
  const best = scored[0];
  if (!best.usable) return line(onPrinter(best.p, best.pair ? best.pair.reasons[0] : best.gate.why!));
  ctx.takenBy.set(best.p.id, { orderId: o.id, what, colours: plateColourList(src.plate) });
  if (!best.gate.ok) return line(bedWait(best.p, best.gate), "wait", best.p.id);
  if (!ctx.setting.on) return line({ key: "Agent prints are off: a person starts it" }, "wait", best.p.id);
  const vars = { printer: printerName(best.p.id) };
  if (!ctx.run) return line({ key: "Next: print on {printer}", vars }, "print", best.p.id);
  const g = orderGate(o);
  const why = [
    `${o.id}: earliest deadline that can print now (run ${g.runsDone + 1} of ${g.runsNeeded})`,
    `${src.attachment.filename}: sliced for the A1 0.4 mm, ${what}`,
    `${vars.printer}: idle, colours confirmed, spools within the colour limit`,
    `Bed confirmed empty by ${best.gate.bed!.by}`,
  ];
  const r = createAgentPrintJob({ printerId: best.p.id, orderId: o.id, attachmentId: src.attachment.id, why, trigger: ctx.trigger }, now);
  if (!r.ok) return line(onPrinter(best.p, r.reasons?.[0] ?? r.error));
  ctx.started.push({ jobId: r.job.id, orderId: o.id, printerId: best.p.id });
  return line({ key: "Started on {printer}", vars }, "started", best.p.id);
}

// ---------- one order with an STL: ask the studio PC for one slice in the order's colour ----------

function placeSlice(ctx: Ctx, o: Order, skipped: Why | null, line: (why: Why, action?: OrderLine["action"], printerId?: string) => OrderLine): OrderLine {
  const { now, printers } = ctx;
  // Only the order's newest design file, and only an STL or OBJ: the studio's presets, never a project's own settings.
  const src = newestDesign(o.id);
  if (!src) return line(skipped ?? { key: "No sliced file for the A1 and no STL to slice" });
  const source = sliceSourceCheck(src);
  if (!source.ok || source.mode !== "mesh") return line(skipped ?? { key: "The agent slices only an STL or OBJ: a person slices this order's file" });
  const choices = o.preferredColors ?? [];
  if (choices.length !== 1) return line(skipped ?? { key: "Pick one colour on the order: the agent slices in one colour" });
  const choice = choices[0];
  const color = normalizeHex(choice.color) ?? "#000000";
  const slices = store.listSliceJobs({ orderId: o.id });
  if (slices.some((j) => j.state === "queued" || j.state === "slicing")) return line({ key: "Slicing on the studio PC…" }, "slicing");
  const tried = slices.filter((j) => j.actor === "agent" && j.attachmentId === src.id && (j.state === "failed" || j.state === "cancelled"));
  if (tried.some((j) => j.failKind === "person")) return line({ key: "A person cancelled the agent's slice: a person slices it on the order page" });
  // A failure of the model (or one from before failKind) is final; the studio PC being away is retried a few times.
  if (tried.some((j) => !j.failKind || j.failKind === "model") || tried.length >= MAX_AGENT_SLICE_TRIES) {
    return line({ key: "The agent's slice failed: a person slices it on the order page" });
  }
  const holders = spoolsOf(printers, choice.type, color);
  if (!holders.length) {
    ctx.missing.set(spoolKey(choice.type, color), { type: choice.type, color, orderId: o.id });
    return line(missingWhy(choice.type, color));
  }
  const usable = holders.filter((h) => isOnline(h.p, now) && colorsCheckedNow(h.p));
  if (!usable.length) {
    const h = holders[0];
    return line(onPrinter(h.p, isOnline(h.p, now) ? "Nobody confirmed the colours on this printer" : "No report in the last 2 min"));
  }
  if (!ctx.setting.on) return line({ key: "Agent prints are off: a person starts it" });
  if (!slicerStatus(now).ready) return line({ key: "Waiting for the studio PC's slicer (is the bridge running?)" });
  const h = usable[0];
  if (!ctx.run) return line({ key: "Next: slice {file} in {material} {name}", vars: { file: src.filename, material: choice.type, name: nameOf(color) } }, "slice", h.p.id);
  const r = requestSlice({
    orderId: o.id, attachmentId: src.id, printerId: h.p.id, tray: h.tray, quality: "standard", supports: "auto", by: "agent", actor: "agent",
    why: [`${o.id}: no sliced file for the A1; ${src.filename} in the order's colour ${choice.type} ${nameOf(color)}`,
      `Spool: ${printerName(h.p.id)} ${slotLabel(h.tray)}, colours confirmed`],
  }, now);
  if (!r.ok) return line({ key: r.reasons?.[0] ?? r.error });
  // A finished slice with these settings is still on the order but the agent may not print it: a person looks.
  if (r.reused === "done") return line(skipped ?? { key: "The sliced file cannot be printed by the agent" });
  if (!r.reused) ctx.sliced.push({ sliceId: r.job.id, orderId: o.id });
  return line({ key: "Slicing on the studio PC…" }, "slicing", h.p.id);
}

// ---------- the decision ----------

function decide(ctx: Ctx): DispatchPlan {
  const orders: Record<string, OrderLine> = {};
  for (const o of store.listOrders().filter((x) => PRODUCTION_STATUSES.includes(x.status)).sort(byDeadline)) {
    const g = orderGate(o);
    const base = { orderId: o.id, runsDone: g.runsDone, runsNeeded: g.runsNeeded, runsActive: g.runsActive };
    const line = (why: Why, action: OrderLine["action"] = "wait", printerId?: string): OrderLine => ({ ...base, why, action, ...(printerId ? { printerId } : {}) });
    if (g.why) {
      orders[o.id] = line(g.why);
      continue;
    }
    const src = printSources(o);
    orders[o.id] = src.ok.length ? placePrint(ctx, o, src.ok[0], line) : placeSlice(ctx, o, src.skipped, line);
  }
  const printers: Record<string, PrinterLine> = {};
  for (const p of ctx.printers) {
    const gate = ctx.gates.get(p.id)!;
    const next = ctx.takenBy.get(p.id) ?? null;
    const bed = bedState(store.getPrinter(p.id) ?? p, ctx.now); // as it is now: a print started in this run used it
    const why: Why | null = !ctx.setting.on ? { key: "Agent prints are off" }
      : gate.why ? gate.why
        : next ? null
          : p.currentOrderId ? { key: "Linked to {order}", vars: { order: p.currentOrderId } }
            : { key: "No order waits for an agent print" };
    printers[p.id] = {
      printerId: p.id, why, next, bed: bed.ok ? { by: bed.check.by, at: bed.check.at } : null, jobOnItsWay: jobsInFlight(p.id)[0]?.id ?? null,
    };
  }
  return { on: ctx.setting.on, by: ctx.setting.by ?? null, at: ctx.setting.at ?? null, locked: Boolean(ctx.setting.locked), printers, orders };
}

function newCtx(now: number, run: boolean, trigger: Trigger): Ctx {
  const printers = store.listPrinters();
  return {
    now, run, trigger, setting: autoPrintSetting(), printers, gates: new Map(printers.map((p) => [p.id, printerGate(p, now)])),
    takenBy: new Map(), missing: new Map(), started: [], sliced: [],
  };
}

/** What the dispatcher would do now and why each printer and order waits. Read-only: no writes, no slice, no print. */
export function planDispatch(now = Date.now()): DispatchPlan {
  return decide(newCtx(now, false, "heartbeat"));
}

/** planDispatch for pages and reads that must not fail because of it: null when it could not be made. */
export function safePlan(now = Date.now()): DispatchPlan | null {
  try {
    return planDispatch(now);
  } catch (e) {
    console.error(`! agent dispatcher plan: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

/** One "Load ..." task per missing spool (material + colour), closed by code when it is loaded or no order needs it. */
function syncSpoolTasks(ctx: Ctx): void {
  const open = store.listOpenTasks().filter((t) => t.key?.startsWith(LOAD_PREFIX));
  for (const [key, m] of ctx.missing) {
    if (open.some((t) => t.key === key)) continue;
    createTask(m.orderId, "change_filament", `Load ${m.type} ${nameOf(m.color)} (${m.color}) in an AMS: ${m.orderId} waits for it.`, undefined, undefined, key);
  }
  for (const t of open) {
    if (ctx.missing.has(t.key!)) continue;
    const [, , type, color] = t.key!.split(":");
    const loaded = spoolsOf(ctx.printers, type, color)[0];
    store.saveTask({ ...t, status: "done", doneAt: iso(ctx.now), doneBy: loaded ? `${printerName(loaded.p.id)} (spool loaded)` : "agent (no order waits for it)" });
  }
}

/** Each order's reason in the decision log, once each time it changes (starts and slices have their own rows). */
function logChanges(ctx: Ctx, plan: DispatchPlan): void {
  const last = store.getMeta<{ orders?: Record<string, string> }>(LAST_META)?.orders ?? {};
  const now: Record<string, string> = {};
  const at = iso(ctx.now);
  for (const l of Object.values(plan.orders)) {
    const text = whyText(l.why);
    now[l.orderId] = text;
    if (last[l.orderId] === text || QUIET.has(l.why.key)) continue;
    store.addLog({ orderId: l.orderId, actor: "agent", tool: "auto_print_wait", ok: true, at,
      input: { key: l.why.key, vars: l.why.vars ?? {}, trigger: ctx.trigger, ...(l.printerId ? { printerId: l.printerId } : {}) }, output: { text } });
  }
  if (JSON.stringify(now) !== JSON.stringify(last)) store.setMeta(LAST_META, { at, trigger: ctx.trigger, orders: now });
}

const state = ((globalThis as unknown as { __kesuniDispatch?: { running: boolean } }).__kesuniDispatch ??= { running: false });

/**
 * Run the dispatcher once. Off: returns at once and writes nothing. On: in one transaction, expire stale jobs and slices,
 * then for each order in production by earliest deadline start a print (createAgentPrintJob) or ask for a slice, raise
 * or close the spool tasks and log the reasons that changed. orderId (the Chief's request) never changes the choice.
 */
export function runDispatch(opts: { trigger: Trigger; now?: number }): DispatchResult {
  const now = opts.now ?? Date.now();
  const empty = { trigger: opts.trigger, started: [], sliced: [] };
  if (!autoPrintSetting().on) return { on: false, ...empty };
  if (state.running) return { on: true, busy: true, ...empty };
  state.running = true;
  try {
    return store.transaction(() => {
      expireStale(now);
      expireStaleSlices(now);
      const ctx = newCtx(now, true, opts.trigger);
      const plan = decide(ctx);
      syncSpoolTasks(ctx);
      logChanges(ctx, plan);
      return { on: true, trigger: opts.trigger, started: ctx.started, sliced: ctx.sliced, plan };
    });
  } finally {
    state.running = false;
  }
}

/** runDispatch for the triggers (routes, reports, the heartbeat): a dispatcher error never fails the caller. */
export function safeDispatch(trigger: Trigger, now = Date.now()): DispatchResult {
  try {
    return runDispatch({ trigger, now });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error(`! agent dispatcher (${trigger}): ${error}`);
    return { on: autoPrintSetting().on, trigger, started: [], sliced: [], error };
  }
}

// ---------- what people set ----------

/**
 * A person turns "Agent may start prints" on or off: a person's name and confirm: true, every change logged. Off cancels
 * the agent's prints and slices that have not reached a printer yet and closes its spool tasks. On runs the dispatcher.
 */
export function setAutoPrint(input: { on: unknown; by: unknown; confirm?: unknown }, now = Date.now()):
  { ok: true; setting: AutoPrintSetting; cancelled: string[]; dispatch: DispatchResult | null } | Fail {
  if (typeof input.on !== "boolean") return fail(400, "Say on: true or false");
  if (!isPersonName(input.by)) return fail(400, "A person's name is required");
  if (input.confirm !== true) return fail(400, "Confirm first", ["Send confirm: true after the person confirmed"]);
  const on = input.on;
  const by = input.by.trim();
  if (on && autoPrintSetting().locked) return fail(409, "Agent prints are switched off on this server (KESUNI_AUTO_PRINT=off)");
  const at = iso(now);
  const cancelled: string[] = [];
  store.transaction(() => {
    store.setMeta(AUTO_PRINT_META, { on, by, at });
    if (!on) {
      for (const j of store.listPrintJobs()) {
        if (j.actor !== "agent" || (j.state !== "queued" && j.state !== "uploading")) continue;
        store.savePrintJob({ ...j, state: "cancelled", updatedAt: at, error: `Agent prints turned off by ${by}` });
        cancelled.push(j.id);
      }
      for (const s of store.listSliceJobs()) {
        if (s.actor === "agent" && (s.state === "queued" || s.state === "slicing") && cancelSliceJob(s.id, by, now, "switch").ok) cancelled.push(s.id);
      }
      for (const t of store.listOpenTasks()) {
        if (t.key?.startsWith(LOAD_PREFIX)) store.saveTask({ ...t, status: "done", doneAt: at, doneBy: `${by} (agent prints turned off)` });
      }
    }
    store.addLog({ orderId: STUDIO, actor: "human", tool: "auto_print_switch", input: { on, by }, ok: true, output: { cancelled }, at });
  });
  return { ok: true, setting: autoPrintSetting(), cancelled, dispatch: on ? safeDispatch("switch_on", now) : null };
}

/** A person sets how many prints of an order are needed (0 = the agent never prints it). Logged; runs the dispatcher. */
export function setOrderRuns(orderId: string, input: { runsNeeded: unknown; by: unknown }, now = Date.now()):
  { ok: true; order: Order; dispatch: DispatchResult } | Fail {
  const o = store.getOrder(orderId);
  if (!o) return fail(404, "Order not found");
  if (!isPersonName(input.by)) return fail(400, "A person's name is required");
  const raw = input.runsNeeded;
  const n = typeof raw === "string" && raw.trim() !== "" ? Number(raw) : raw;
  if (typeof n !== "number" || !Number.isInteger(n) || n < 0 || n > MAX_RUNS) return fail(400, `Runs must be a whole number from 0 to ${MAX_RUNS}`);
  const by = input.by.trim();
  const at = iso(now);
  const order: Order = { ...o, autoPrint: { runsNeeded: n, by, at } };
  store.saveOrder(order);
  store.addLog({ orderId, actor: "human", tool: "auto_print_runs", input: { runsNeeded: n, by }, ok: true, output: {}, at });
  return { ok: true, order, dispatch: safeDispatch("runs_set", now) };
}

// ---------- reading ----------

/** Log tools of agent prints, for the Chief page's "Last agent decisions". */
export const AUTO_PRINT_TOOLS = ["auto_print", "slice_request", "auto_print_wait", "auto_print_switch"];

/** The latest agent print decisions across orders (the agent's starts, slices and reasons; a person's switch changes). */
export function autoPrintFeed(limit = 6): AgentLogEntry[] {
  return store.listLogByTools(AUTO_PRINT_TOOLS, limit * 3)
    .filter((e) => e.tool !== "slice_request" || e.actor === "agent")
    .slice(0, limit);
}

/** This order's line for the order page: the switch, the reason and the runs (null when the plan could not be made). */
export function orderAutoPrint(orderId: string, now = Date.now()): { on: boolean; line: OrderLine | null; runsSet: boolean } {
  const plan = safePlan(now);
  return { on: plan?.on ?? autoPrintSetting().on, line: plan?.orders[orderId] ?? null, runsSet: Boolean(store.getOrder(orderId)?.autoPrint) };
}

/** The printer ref ("printer:a1") and the studio id are not orders. */
export const isStudioRef = (id: string): boolean => id === STUDIO || id.startsWith(printerRef(""));
