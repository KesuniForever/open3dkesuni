// Printer actions: link printers to orders, take reports from the LAN bridge, and let the agent
// turn printer events into evidence and operator tasks, pick a ready printer, and suggest a
// reroute when one fails. Nothing here moves money: "print finished" only asks a person to
// collect and QC the part. Nothing here controls a printer either (that is src/lib/printer/jobs.ts, people only).
import * as store from "../store";
import { addEvidence, type Fail } from "../actions";
import { activeIssues, errorCodeText, HMS_SEVERITY, STAGE_PAUSED, type PrinterEvent, type PrinterIssue, type PrinterSnapshot } from "./bambu";
import { issueText } from "./errors";
import { PREPARE_WAIT_MS } from "./control";
import { amsKey } from "../colors";
import type { OperatorTask, Printer, PrintJob, PrintJobState } from "../types";

const fail = (status: number, error: string, reasons?: string[]): Fail => ({ ok: false, status, error, reasons });
const PRINTING_STATUSES = ["PLAN_CHOSEN", "IN_PRODUCTION", "EVIDENCE_SUBMITTED"];
const ID = /^[a-z0-9-]{1,32}$/;
/** Printer #1 keeps the id "a1"; the bridge names the others "a1-2", "a1-3". */
export function printerName(id: string): string {
  const n = id === "a1" ? "1" : /^a1-(\d+)$/.exec(id)?.[1];
  return n ? `A1 Combo #${n}` : `Printer ${id}`;
}
const STALE_MS = 2 * 60 * 1000;
/** Tasks about a printer that no order is linked to are filed under this ref (the dashboard links them to /machines). */
export const printerRef = (printerId: string) => `printer:${printerId}`;
export const isPrinterRef = (orderId: string) => orderId.startsWith("printer:");

function ensurePrinter(id: string): Printer {
  const existing = store.getPrinter(id);
  if (existing) return existing;
  const p: Printer = { id, name: printerName(id) };
  store.savePrinter(p);
  return p;
}

/** A fault that blocks printing (fatal or serious HMS, or a device error), as its code; null when there is none. */
export function blockingFault(s: Pick<PrinterSnapshot, "hms" | "errorCode"> | undefined): string | null {
  return (s ? activeIssues(s) : []).find((i) => i.kind === "print_error" || i.severity === 1 || i.severity === 2)?.code ?? null;
}

/** Why a printer cannot take a new job right now, or null if it can. */
export function notReadyReason(p: Printer, now = Date.now()): string | null {
  if (!p.lastSeen || now - Date.parse(p.lastSeen) > STALE_MS) return "offline (no report in the last 2 min)";
  const fault = blockingFault(p.snapshot);
  if (fault) return `printer error ${fault}`;
  if (p.currentOrderId) return `busy with ${p.currentOrderId}`;
  if (p.bedOccupiedBy) return `bed still holds the part of ${p.bedOccupiedBy}`;
  const s = p.snapshot?.state;
  if (s && !["IDLE", "FINISH"].includes(s)) return `printer state is ${s}`;
  return null;
}

/** A person (or the agent) says which order this printer is now printing. */
export function linkPrinter(printerId: string, orderId: string, by: "human" | "agent" = "human"): { ok: true; printer: Printer } | Fail {
  if (!ID.test(printerId)) return fail(400, "Invalid printer id");
  const order = store.getOrder(orderId);
  if (!order) return fail(404, "Order not found");
  if (!PRINTING_STATUSES.includes(order.status)) return fail(409, `Order is ${order.status}; choose a plan before printing`);
  const p = ensurePrinter(printerId);
  if (p.currentOrderId && p.currentOrderId !== orderId) return fail(409, `${p.name} is busy with ${p.currentOrderId}`);
  if (p.bedOccupiedBy) return fail(409, `${p.name}: bed still holds the part of ${p.bedOccupiedBy}. Collect it first.`);
  for (const other of store.listPrinters()) {
    if (other.id !== printerId && other.currentOrderId === orderId) store.savePrinter({ ...other, currentOrderId: undefined });
  }
  const printer = { ...p, currentOrderId: orderId };
  store.savePrinter(printer);
  if (by === "human") {
    store.addLog({ orderId, actor: "human", tool: "link_printer", input: { printerId }, ok: true, output: { printer: printer.name }, at: new Date().toISOString() });
  }
  return { ok: true, printer };
}

export function unlinkPrinter(printerId: string): { ok: true; printer: Printer } | Fail {
  const p = store.getPrinter(printerId);
  if (!p) return fail(404, "Printer not found");
  const printer = { ...p, currentOrderId: undefined };
  store.savePrinter(printer);
  return { ok: true, printer };
}

/** A person checked that the material and colour shown for each AMS slot are the real spools (customers pick from them). */
export function confirmColors(printerId: string, by: string): { ok: true; printer: Printer } | Fail {
  const p = store.getPrinter(printerId);
  if (!p) return fail(404, "Printer not found");
  if (!by.trim()) return fail(400, "Who checked the colours is required");
  if (!p.snapshot?.ams) return fail(409, "The printer has not reported its AMS yet");
  const printer: Printer = { ...p, colorsChecked: { by: by.trim().slice(0, 60), at: new Date().toISOString(), key: amsKey(p.snapshot) } };
  store.savePrinter(printer);
  return { ok: true, printer };
}

/** A person confirms the bed is empty (part collected or failed print removed). */
export function clearBed(printerId: string, by: string): { ok: true; printer: Printer } | Fail {
  const p = store.getPrinter(printerId);
  if (!p) return fail(404, "Printer not found");
  if (!by.trim()) return fail(400, "Who cleared the bed is required");
  const printer = { ...p, bedOccupiedBy: undefined };
  store.savePrinter(printer);
  return { ok: true, printer };
}

/** The agent picks a ready printer for the order and links it, or explains why none is ready. */
export function choosePrinter(orderId: string): { ok: true; printer: Printer; reasons: string[] } | Fail {
  const order = store.getOrder(orderId);
  if (!order) return fail(404, "Order not found");
  if (!PRINTING_STATUSES.includes(order.status)) return fail(409, `Order is ${order.status}; choose a plan before printing`);
  const at = new Date().toISOString();
  const printers = store.listPrinters();
  const reasons = printers.map((p) => `${p.name}: ${notReadyReason(p) ?? "ready"}`);
  const ready = printers.filter((p) => notReadyReason(p) === null);
  if (ready.length === 0) {
    store.addLog({ orderId, actor: "agent", tool: "choose_printer", input: {}, ok: false, output: { reasons }, at });
    createTask(orderId, "check_printer", `No printer is ready for ${orderId}. ${reasons.join("; ")}.`);
    return fail(409, "No printer is ready", reasons);
  }
  const pick = ready[0];
  const r = linkPrinter(pick.id, orderId, "agent");
  if (!r.ok) return r;
  store.addLog({ orderId, actor: "agent", tool: "choose_printer", input: {}, ok: true, output: { chose: pick.name, reasons }, at });
  return { ok: true, printer: r.printer, reasons };
}

/**
 * The order's print has finished and now waits for collection and QC: its last collect_and_qc task is newer
 * than its last reprint task. A failed print (reprint task last) does need a new production run.
 */
export function printFinished(orderId: string): boolean {
  const last = store.listTasks(orderId).filter((t) => t.kind === "collect_and_qc" || t.kind === "reprint").at(-1);
  return last?.kind === "collect_and_qc";
}

export function createTask(orderId: string, kind: OperatorTask["kind"], text: string, printerId?: string, errorCode?: string): OperatorTask {
  const task: OperatorTask = {
    id: store.nextTaskId(), orderId, kind, printerId, text, status: "open", createdBy: "agent", at: new Date().toISOString(),
    ...(errorCode ? { errorCode } : {}),
  };
  store.saveTask(task);
  store.addLog({ orderId, actor: "agent", tool: "create_operator_task", input: { kind, printerId, text }, ok: true, output: { taskId: task.id }, at: task.at });
  return task;
}

/** English task text for a printer fault: the code, Bambu's own words when known, and the link. */
export function issueTaskText(printer: Pick<Printer, "name">, issue: PrinterIssue): string {
  const words = issueText(issue) ?? "Bambu has no description for this code.";
  const level = issue.kind === "hms" && issue.severity ? ` (${HMS_SEVERITY[issue.severity] ?? "unknown"})` : "";
  return `${printer.name} reports ${issue.kind === "hms" ? "" : "error "}${issue.code}${level}: ${words} ` +
    `Check the printer before the next print. ${issue.url}`;
}

/**
 * One task each time a fault appears on a printer, closed by itself once the printer stops reporting it. A person
 * may close it earlier; it is not raised again until the fault clears and comes back (Printer.faultsSeen). A pause or
 * failure of a linked order already has a task with the code in it (change filament, reprint): no second task then.
 */
function syncIssueTasks(printer: Printer): void {
  const s = printer.snapshot;
  if (!s) return;
  const issues = activeIssues(s);
  const seen = { ...(printer.faultsSeen ?? {}) };
  const open = store.listOpenTasks().filter((t) => t.printerId === printer.id);
  let changed = false;
  for (const issue of issues) {
    if (seen[issue.code]) continue;
    seen[issue.code] = s.at;
    changed = true;
    if (open.some((t) => t.errorCode === issue.code || (issue.kind === "print_error" && t.text.includes(issue.code)))) continue;
    createTask(printer.currentOrderId ?? printerRef(printer.id), "check_printer", issueTaskText(printer, issue), printer.id, issue.code);
  }
  for (const code of Object.keys(seen)) {
    if (issues.some((i) => i.code === code)) continue;
    if (code.startsWith("HMS_") && !s.hms) continue; // an older bridge does not send HMS: unknown is not "cleared"
    delete seen[code];
    changed = true;
    for (const t of open) {
      if (t.errorCode === code) store.saveTask({ ...t, status: "done", doneAt: s.at, doneBy: `${printer.name} (no longer reported)` });
    }
  }
  if (changed) store.savePrinter({ ...store.getPrinter(printer.id)!, faultsSeen: seen });
}

/**
 * A printer report moves the website job that is on it: PREPARE/RUNNING -> printing, FINISH -> done, FAILED -> failed
 * (or cancelled after a person's stop). So the job's state is right even when the bridge stops reporting after "sent".
 * A job still preparing 15 min after it started (heating, levelling, calibrating take a few minutes) gets one task.
 */
export function syncJobWithPrinter(printerId: string, s: Pick<PrinterSnapshot, "state" | "errorCode">, now = Date.now()): PrintJob | undefined {
  const j = store.listPrintJobs({ printerId }).filter((x) => x.state === "sent" || x.state === "printing").at(-1);
  if (!j) return undefined;
  if (j.state === "printing" && s.state === "PREPARE" && now - Date.parse(j.updatedAt) > PREPARE_WAIT_MS) {
    const ref = j.orderId ?? printerRef(printerId);
    if (!store.listTasks(ref).some((t) => t.text.includes(j.id))) {
      createTask(ref, "check_printer",
        `${printerName(printerId)} has been preparing ${j.id} for more than 15 min without printing. Check the printer screen.`, printerId);
    }
  }
  const cancelled = [0x0300400c, 0x0500400e].includes(s.errorCode >>> 0);
  const next: PrintJobState | null =
    ["PREPARE", "RUNNING", "PAUSE"].includes(s.state) && j.state === "sent" ? "printing"
      : s.state === "FINISH" && j.state === "printing" ? "done"
        : s.state === "FAILED" && j.state === "printing" ? (cancelled ? "cancelled" : "failed")
          : null;
  if (!next) return undefined;
  const job: PrintJob = {
    ...j, state: next, updatedAt: new Date(now).toISOString(),
    ...(next === "failed" && s.errorCode ? { error: `Printer error ${errorCodeText(s.errorCode)}` } : {}),
  };
  store.savePrintJob(job);
  return job;
}

const pct = (e: PrinterEvent) => `${Math.round(e.percent)}%`;
/** Filament ran out: AMS, AMS lite or external spool (Bambu's x8011 codes, 0300-8015). */
const isRunout = (code: number) => (code & 0xffff) === 0x8011 || code === 0x03008015;
/** print_error after a person's stop. */
const STOPPED_BY_PERSON = [0x0300400c, 0x0500400e];
/** The task a fault pause opens (closed again when the print resumes). */
const pauseTaskText = (printer: Printer) => `${printer.name} paused at `;
const job = (e: PrinterEvent) => (e.jobName ? ` (${e.jobName})` : "");

/** A ready printer other than this one, for a reroute suggestion. */
function alternative(exceptId: string): Printer | undefined {
  return store.listPrinters().find((p) => p.id !== exceptId && notReadyReason(p) === null);
}

/**
 * The agent's reaction to each printer event for the linked order: record what the printer
 * reported as `device` evidence, track the bed, and create a task when a person must act.
 */
function react(printer: Printer, orderId: string, e: PrinterEvent): void {
  const log = (note: string) => addEvidence(orderId, { kind: "log", note: `${printer.name}: ${note}`, label: "device" });
  const code = e.errorCode ? ` code ${errorCodeText(e.errorCode)}` : "";
  switch (e.kind) {
    case "started":
      log(`started printing${job(e)}`);
      break;
    case "progress":
      log(`progress ${pct(e)}`);
      break;
    case "needs_operator": {
      // A pause is not always a problem: a person may have paused it (website or printer screen: stage 16, 0300-8001).
      // Out of filament asks for a spool; other faults ask a person to look. An older bridge sends no stage: as before.
      const err = (e.errorCode ?? 0) >>> 0;
      const stage = printer.snapshot?.stage;
      const runout = stage?.code === 6 || isRunout(err);
      const byPerson = !runout && (err === 0x03008001 || (stage !== undefined && (stage?.code === 16 || (err === 0 && !stage?.needsPerson))));
      if (byPerson) {
        log(`paused at ${pct(e)} by a person`);
        break;
      }
      log(`stopped at ${pct(e)}${code}, needs an operator`);
      if (runout) {
        createTask(orderId, "change_filament",
          `${printer.name} stopped at ${pct(e)}${code}. Out of filament: load a new spool in the same slot, then resume the print.`, printer.id);
      } else if (stage === undefined) {
        createTask(orderId, "change_filament",
          `${printer.name} stopped at ${pct(e)}${code}. Probably out of filament: check the printer, change the filament, then resume the print from the printer screen.`,
          printer.id);
      } else {
        const why = stage && stage.key !== STAGE_PAUSED ? ` (${stage.key})` : "";
        createTask(orderId, "check_printer",
          `${pauseTaskText(printer)}${pct(e)}${code}${why}. Check the printer screen and fix the cause, then resume the print.`, printer.id);
      }
      break;
    }
    case "resumed":
      log(`resumed printing from ${pct(e)}`);
      for (const t of store.listTasks(orderId)) {
        if (t.status !== "open" || (t.printerId && t.printerId !== printer.id)) continue;
        if (t.kind === "change_filament" || (t.kind === "check_printer" && !t.errorCode && t.text.startsWith(pauseTaskText(printer)))) {
          store.saveTask({ ...t, status: "done", doneAt: e.at, doneBy: `${printer.name} (resumed printing)` });
        }
      }
      break;
    case "finished":
      log(`finished printing${job(e)}`);
      createTask(orderId, "collect_and_qc",
        `Print finished on ${printer.name}. Collect the item, check the quality, then log the QC result with a photo. A finished print does not mean it may be paid yet.`,
        printer.id);
      break;
    case "error":
      if (e.issue) log(`reports ${e.issue.code}`);
      break;
    case "error_cleared":
      if (e.issue) log(`no longer reports ${e.issue.code}`);
      break;
    case "failed": {
      if (STOPPED_BY_PERSON.includes((e.errorCode ?? 0) >>> 0)) {
        // A person pressed Stop: no failure and no reroute, only the bed to clear.
        log(`print stopped by a person at ${pct(e)}`);
        createTask(orderId, "reprint",
          `${printer.name}: a person stopped the print at ${pct(e)}. Clear the bed, then decide what happens with the order.`, printer.id);
        break;
      }
      log(`print failed at ${pct(e)}${code}`);
      const alt = alternative(printer.id);
      const suggestion = alt
        ? ` Agent suggestion: after clearing the bed, reprint on ${alt.name} (ready, bed empty), or repeat on ${printer.name}.`
        : " No other printer is ready yet.";
      createTask(orderId, "reprint", `Print failed on ${printer.name} (${pct(e)}${code}). Clear the bed and decide on a reprint.${suggestion}`, printer.id);
      store.addLog({ orderId, actor: "agent", tool: "suggest_reroute", input: { failed: printer.name }, ok: true,
        output: { suggestion: alt ? alt.name : null }, at: e.at });
      break;
    }
  }
}

/** Called by the LAN bridge with the latest snapshot and the events it detected. */
export function ingestReport(
  printerId: string, snapshot: PrinterSnapshot, events: PrinterEvent[],
): { ok: true; printer: Printer; applied: number } | Fail {
  if (!ID.test(printerId)) return fail(400, "Invalid printer id");
  const before = ensurePrinter(printerId);
  let printer: Printer = { ...before, name: printerName(printerId), snapshot, lastSeen: new Date().toISOString() };
  // Any print that ends leaves something on the bed, whether or not it belonged to an order.
  // Also when we first see a printer already sitting in FINISH/FAILED: assume the part is still there.
  const ended = events.some((e) => e.kind === "finished" || e.kind === "failed");
  const unseen = !before.snapshot || before.snapshot.state === "UNKNOWN";
  const firstSeenEnded = unseen && (snapshot.state === "FINISH" || snapshot.state === "FAILED");
  if ((ended || firstSeenEnded) && !printer.bedOccupiedBy) {
    printer.bedOccupiedBy = printer.currentOrderId ?? "a print without an order";
  }
  store.savePrinter(printer);

  // A print starting while the bed should still hold a part: warn a person right away.
  const startedOnFullBed = events.some((e) => e.kind === "started") && printer.bedOccupiedBy;
  if (startedOnFullBed) {
    createTask(printer.bedOccupiedBy!, "check_printer",
      `CHECK NOW: ${printer.name} started printing, but the print for ${printer.bedOccupiedBy} was not marked as collected.`, printer.id);
  }

  syncJobWithPrinter(printerId, snapshot);
  const orderId = printer.currentOrderId;
  const order = orderId ? store.getOrder(orderId) : undefined;
  if (!orderId || !order || !PRINTING_STATUSES.includes(order.status)) {
    syncIssueTasks(printer);
    return { ok: true, printer: store.getPrinter(printerId)!, applied: 0 };
  }
  // Order the reroute suggestion sees this printer as not ready.
  if (ended) {
    printer = { ...printer, currentOrderId: undefined, bedOccupiedBy: orderId };
    store.savePrinter(printer);
  }
  for (const e of events) react(printer, orderId, e);
  syncIssueTasks(store.getPrinter(printerId)!);
  return { ok: true, printer: store.getPrinter(printerId)!, applied: events.length };
}

/** A person marks a task done. Collecting the part (or clearing a failed print) frees the bed. */
export function completeTask(taskId: string, by: string): { ok: true; task: OperatorTask } | Fail {
  const t = store.getTask(taskId);
  if (!t) return fail(404, "Task not found");
  if (t.status === "done") return { ok: true, task: t };
  if (!by.trim()) return fail(400, "Who did it is required");
  const task: OperatorTask = { ...t, status: "done", doneAt: new Date().toISOString(), doneBy: by.trim() };
  store.saveTask(task);
  if ((t.kind === "collect_and_qc" || t.kind === "reprint") && t.printerId) {
    const p = store.getPrinter(t.printerId);
    if (p && p.bedOccupiedBy === t.orderId) store.savePrinter({ ...p, bedOccupiedBy: undefined });
  }
  return { ok: true, task };
}
