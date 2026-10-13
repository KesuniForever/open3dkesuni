// Printer actions: link printers to orders, take reports from the LAN bridge, and let the agent
// turn printer events into evidence and operator tasks, pick a ready printer, and suggest a
// reroute when one fails. Nothing here moves money: "print finished" only asks a person to
// collect and QC the part.
import * as store from "../store";
import { addEvidence, type Fail } from "../actions";
import { errorCodeText, type PrinterEvent, type PrinterSnapshot } from "./bambu";
import type { OperatorTask, Printer } from "../types";

const fail = (status: number, error: string, reasons?: string[]): Fail => ({ ok: false, status, error, reasons });
const PRINTING_STATUSES = ["PLAN_CHOSEN", "IN_PRODUCTION", "EVIDENCE_SUBMITTED"];
const ID = /^[a-z0-9-]{1,32}$/;
/** Printer #1 keeps the id "a1"; the bridge names the others "a1-2", "a1-3". */
export function printerName(id: string): string {
  const n = id === "a1" ? "1" : /^a1-(\d+)$/.exec(id)?.[1];
  return n ? `A1 Combo #${n}` : `Printer ${id}`;
}
const STALE_MS = 2 * 60 * 1000;

function ensurePrinter(id: string): Printer {
  const existing = store.getPrinter(id);
  if (existing) return existing;
  const p: Printer = { id, name: printerName(id) };
  store.savePrinter(p);
  return p;
}

/** Why a printer cannot take a new job right now, or null if it can. */
export function notReadyReason(p: Printer, now = Date.now()): string | null {
  if (!p.lastSeen || now - Date.parse(p.lastSeen) > STALE_MS) return "offline (no report in the last 2 min)";
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
    createTask(orderId, "check_printer", `Tidak ada printer yang siap untuk ${orderId}. ${reasons.join("; ")}.`);
    return fail(409, "No printer is ready", reasons);
  }
  const pick = ready[0];
  const r = linkPrinter(pick.id, orderId, "agent");
  if (!r.ok) return r;
  store.addLog({ orderId, actor: "agent", tool: "choose_printer", input: {}, ok: true, output: { chose: pick.name, reasons }, at });
  return { ok: true, printer: r.printer, reasons };
}

function createTask(orderId: string, kind: OperatorTask["kind"], text: string, printerId?: string): OperatorTask {
  const task: OperatorTask = { id: store.nextTaskId(), orderId, kind, printerId, text, status: "open", createdBy: "agent", at: new Date().toISOString() };
  store.saveTask(task);
  store.addLog({ orderId, actor: "agent", tool: "create_operator_task", input: { kind, printerId, text }, ok: true, output: { taskId: task.id }, at: task.at });
  return task;
}

const pct = (e: PrinterEvent) => `${Math.round(e.percent)}%`;
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
  const code = e.errorCode ? ` kode ${errorCodeText(e.errorCode)}` : "";
  switch (e.kind) {
    case "started":
      log(`mulai mencetak${job(e)}`);
      break;
    case "progress":
      log(`progres ${pct(e)}`);
      break;
    case "needs_operator":
      log(`berhenti di ${pct(e)}${code}, butuh operator`);
      createTask(orderId, "change_filament",
        `${printer.name} berhenti di ${pct(e)}${code}. Kemungkinan filament habis: cek printer, ganti filament, lalu lanjutkan cetak dari layar printer.`,
        printer.id);
      break;
    case "resumed":
      log(`lanjut mencetak dari ${pct(e)}`);
      for (const t of store.listTasks(orderId)) {
        if (t.status === "open" && t.kind === "change_filament" && (!t.printerId || t.printerId === printer.id)) {
          store.saveTask({ ...t, status: "done", doneAt: e.at, doneBy: `${printer.name} (lanjut mencetak)` });
        }
      }
      break;
    case "finished":
      log(`selesai mencetak${job(e)}`);
      createTask(orderId, "collect_and_qc",
        `Cetak selesai di ${printer.name}. Ambil barang, cek kualitas, lalu catat hasil QC dengan foto. Selesai cetak belum berarti boleh dibayar.`,
        printer.id);
      break;
    case "failed": {
      log(`cetak gagal di ${pct(e)}${code}`);
      const alt = alternative(printer.id);
      const suggestion = alt
        ? ` Saran agen: setelah bed dibersihkan, cetak ulang di ${alt.name} (siap, bed kosong), atau ulangi di ${printer.name}.`
        : " Belum ada printer lain yang siap.";
      createTask(orderId, "reprint", `Cetak gagal di ${printer.name} (${pct(e)}${code}). Bersihkan bed dan putuskan cetak ulang.${suggestion}`, printer.id);
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
  const firstSeenEnded = !before.snapshot && (snapshot.state === "FINISH" || snapshot.state === "FAILED");
  if ((ended || firstSeenEnded) && !printer.bedOccupiedBy) {
    printer.bedOccupiedBy = printer.currentOrderId ?? "a print without an order";
  }
  store.savePrinter(printer);

  // A print starting while the bed should still hold a part: warn a person right away.
  const startedOnFullBed = events.some((e) => e.kind === "started") && printer.bedOccupiedBy;
  if (startedOnFullBed) {
    createTask(printer.bedOccupiedBy!, "check_printer",
      `PERIKSA SEKARANG: ${printer.name} mulai mencetak, padahal hasil ${printer.bedOccupiedBy} belum ditandai diambil.`, printer.id);
  }

  const orderId = printer.currentOrderId;
  const order = orderId ? store.getOrder(orderId) : undefined;
  if (!orderId || !order || !PRINTING_STATUSES.includes(order.status)) return { ok: true, printer, applied: 0 };
  // Order the reroute suggestion sees this printer as not ready.
  if (ended) {
    printer = { ...printer, currentOrderId: undefined, bedOccupiedBy: orderId };
    store.savePrinter(printer);
  }
  for (const e of events) react(printer, orderId, e);
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
