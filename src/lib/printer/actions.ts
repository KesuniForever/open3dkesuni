// Printer actions: link a printer to an order, take reports from the LAN bridge, and let the
// agent turn printer events into evidence and operator tasks. Nothing here moves money:
// "print finished" only asks a person to collect and QC the part.
import * as store from "../store";
import { addEvidence, type Fail } from "../actions";
import { errorCodeText, type PrinterEvent, type PrinterSnapshot } from "./bambu";
import type { OperatorTask, Printer } from "../types";

const fail = (status: number, error: string, reasons?: string[]): Fail => ({ ok: false, status, error, reasons });
const PRINTING_STATUSES = ["PLAN_CHOSEN", "IN_PRODUCTION", "EVIDENCE_SUBMITTED"];
const NAMES: Record<string, string> = { a1: "Bambu Lab A1" };

function ensurePrinter(id: string): Printer {
  const existing = store.getPrinter(id);
  if (existing) return existing;
  const p: Printer = { id, name: NAMES[id] ?? `Printer ${id}` };
  store.savePrinter(p);
  return p;
}

/** A person says which order this printer is now printing. */
export function linkPrinter(printerId: string, orderId: string): { ok: true; printer: Printer } | Fail {
  if (!/^[a-z0-9-]{1,32}$/.test(printerId)) return fail(400, "Invalid printer id");
  const order = store.getOrder(orderId);
  if (!order) return fail(404, "Order not found");
  if (!PRINTING_STATUSES.includes(order.status)) return fail(409, `Order is ${order.status}; choose a plan before printing`);
  const printer = { ...ensurePrinter(printerId), currentOrderId: orderId };
  store.savePrinter(printer);
  return { ok: true, printer };
}

export function unlinkPrinter(printerId: string): { ok: true; printer: Printer } | Fail {
  const p = store.getPrinter(printerId);
  if (!p) return fail(404, "Printer not found");
  const printer = { ...p, currentOrderId: undefined };
  store.savePrinter(printer);
  return { ok: true, printer };
}

function createTask(orderId: string, kind: OperatorTask["kind"], text: string): OperatorTask {
  const task: OperatorTask = { id: store.nextTaskId(), orderId, kind, text, status: "open", createdBy: "agent", at: new Date().toISOString() };
  store.saveTask(task);
  store.addLog({ orderId, actor: "agent", tool: "create_operator_task", input: { kind, text }, ok: true, output: { taskId: task.id }, at: task.at });
  return task;
}

const pct = (e: PrinterEvent) => `${Math.round(e.percent)}%`;
const job = (e: PrinterEvent) => (e.jobName ? ` (${e.jobName})` : "");

/**
 * The agent's reaction to each printer event for the linked order: record what the printer
 * reported as `device` evidence, and create a task when a person must act.
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
        `${printer.name} berhenti di ${pct(e)}${code}. Kemungkinan filament habis: cek printer, ganti filament, lalu lanjutkan cetak dari layar printer.`);
      break;
    case "resumed": {
      log(`lanjut mencetak dari ${pct(e)}`);
      for (const t of store.listTasks(orderId)) {
        if (t.status === "open" && t.kind === "change_filament") {
          store.saveTask({ ...t, status: "done", doneAt: e.at, doneBy: `${printer.name} (lanjut mencetak)` });
        }
      }
      break;
    }
    case "finished":
      log(`selesai mencetak${job(e)}`);
      createTask(orderId, "collect_and_qc",
        `Cetak selesai di ${printer.name}. Ambil barang, cek kualitas, lalu catat hasil QC dengan foto. Selesai cetak belum berarti boleh dibayar.`);
      break;
    case "failed":
      log(`cetak gagal di ${pct(e)}${code}`);
      createTask(orderId, "reprint", `Cetak gagal di ${printer.name} (${pct(e)}${code}). Cek printer dan putuskan apakah perlu cetak ulang.`);
      break;
  }
}

/** Called by the LAN bridge with the latest snapshot and the events it detected. */
export function ingestReport(
  printerId: string, snapshot: PrinterSnapshot, events: PrinterEvent[],
): { ok: true; printer: Printer; applied: number } | Fail {
  if (!/^[a-z0-9-]{1,32}$/.test(printerId)) return fail(400, "Invalid printer id");
  const printer = { ...ensurePrinter(printerId), snapshot, lastSeen: new Date().toISOString() };
  store.savePrinter(printer);
  const orderId = printer.currentOrderId;
  const order = orderId ? store.getOrder(orderId) : undefined;
  if (!orderId || !order || !PRINTING_STATUSES.includes(order.status)) return { ok: true, printer, applied: 0 };
  for (const e of events) react(printer, orderId, e);
  if (events.some((e) => e.kind === "finished" || e.kind === "failed")) {
    store.savePrinter({ ...printer, currentOrderId: undefined }); // free the printer for the next job
  }
  return { ok: true, printer: store.getPrinter(printerId)!, applied: events.length };
}

/** A person marks a task done. */
export function completeTask(taskId: string, by: string): { ok: true; task: OperatorTask } | Fail {
  const t = store.getTask(taskId);
  if (!t) return fail(404, "Task not found");
  if (t.status === "done") return { ok: true, task: t };
  if (!by.trim()) return fail(400, "Who did it is required");
  const task: OperatorTask = { ...t, status: "done", doneAt: new Date().toISOString(), doneBy: by.trim() };
  store.saveTask(task);
  return { ok: true, task };
}
