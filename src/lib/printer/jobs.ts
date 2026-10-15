// Printing from the website: a PERSON asks for a control or a print here; the LAN bridge (the only thing that can
// reach the printers) picks it up from /api/printers/queue, does it, and reports back. The app checks first
// (control.ts), the bridge checks again against its live snapshot. Nothing here is reachable from the Chief:
// src/lib/agent never imports this file (a test checks it), and every request needs a person's name.
// Stale requests never fire later: a command the bridge has not picked up in 60 s expires, a print in 5 min fails, and a
// print is never sent more than 10 min after the person confirmed the bed (START_CONFIRM_MS).
import { createHash } from "node:crypto";
import * as store from "../store";
import type { Fail } from "../actions";
import { matchJob, type JobMatch } from "../colors";
import {
  canStartPrint, COMMAND_EXPIRY_MS, COMMAND_GAP_MS, COMMAND_KINDS, commandReasons, CONFIRM_KINDS, CONTROL_KINDS, isPersonName,
  JOB_PICKUP_MS, sdFileName, SENT_TIMEOUT_MS, START_CONFIRM_MS, START_GAP_MS, subtaskName, UPLOAD_TIMEOUT_MS,
} from "./control";
import { clearBed, linkPrinter, printerName } from "./actions";
import type { Attachment, PrintJob, PrintJobState, PrinterCommand, PrinterCommandKind, PrinterCommandState, PrintOptions } from "../types";

const fail = (status: number, error: string, reasons?: string[]): Fail => ({ ok: false, status, error, reasons });
const ID = /^[a-z0-9-]{1,32}$/;
/** A command the bridge took but never answered is marked failed after this. */
const COMMAND_SENT_TIMEOUT_MS = 5 * 60_000;
const iso = (now: number) => new Date(now).toISOString();

// ---------- expiry ----------

/**
 * Mark stale requests: queued commands after 60 s, unanswered commands after 5 min; queued jobs after 5 min, jobs
 * stuck uploading after 30 min and jobs sent but never seen on the printer after 15 min (a bridge restarted mid-job:
 * without this they would block the printer for ever).
 */
export function expireStale(now = Date.now()): void {
  for (const c of store.listPrinterCommands()) {
    const age = now - Date.parse(c.createdAt);
    if (c.state === "queued" && age > COMMAND_EXPIRY_MS) {
      store.savePrinterCommand({ ...c, state: "expired", doneAt: iso(now), result: "The bridge did not pick it up within 60 s" });
    } else if (c.state === "sent" && age > COMMAND_SENT_TIMEOUT_MS) {
      store.savePrinterCommand({ ...c, state: "failed", doneAt: iso(now), result: "No answer from the bridge" });
    }
  }
  for (const j of store.listPrintJobs()) {
    const stale = (error: string) => {
      store.savePrintJob({ ...j, state: "failed", updatedAt: iso(now), error });
      if (j.orderId) {
        store.addLog({ orderId: j.orderId, actor: "human", tool: "print_job", input: { jobId: j.id, state: "failed" }, ok: false,
          output: { printer: printerName(j.printerId), error }, at: iso(now) });
      }
    };
    if (j.state === "queued" && now - Date.parse(j.createdAt) > JOB_PICKUP_MS) {
      stale("The bridge did not pick it up within 5 min. Check the bed again and start again.");
    } else if (j.state === "uploading" && now - Date.parse(j.updatedAt) > UPLOAD_TIMEOUT_MS) {
      stale("The bridge stopped answering during the upload. Check the printer screen, then start again.");
    } else if (j.state === "sent" && now - Date.parse(j.updatedAt) > SENT_TIMEOUT_MS) {
      stale("The printer never showed the print starting. Check the printer screen, then start again.");
    }
  }
}

// ---------- commands ----------

/** A person asks for a control (or a read-only request) on one printer. */
export function createPrinterCommand(
  printerId: string, input: { kind: unknown; params?: unknown; by: unknown; confirm?: unknown }, now = Date.now(),
): { ok: true; command: PrinterCommand } | Fail {
  if (!ID.test(printerId)) return fail(400, "Invalid printer id");
  const p = store.getPrinter(printerId);
  if (!p) return fail(404, "Printer not found");
  const kind = input.kind as PrinterCommandKind;
  if (!COMMAND_KINDS.includes(kind)) return fail(400, "Unknown printer command", [`kind must be one of ${COMMAND_KINDS.join(", ")}`]);
  if (!isPersonName(input.by)) return fail(400, "A person's name is required");
  if (CONFIRM_KINDS.includes(kind) && input.confirm !== true) return fail(400, "Confirm first", ["Send confirm: true after the person confirmed"]);
  const raw = input.params && typeof input.params === "object" && !Array.isArray(input.params) ? (input.params as Record<string, unknown>) : {};
  // resume keeps "fixed": the person said they fixed the fault the printer paused for (checked again by the bridge).
  const params: PrinterCommand["params"] = kind === "speed" ? { level: raw.level as number } : kind === "light" ? { on: raw.on as boolean }
    : kind === "resume" && raw.fixed === true ? { fixed: true } : {};
  const reasons = commandReasons(p, kind, params, now);
  if (reasons.length) return fail(409, "The printer cannot do that now", reasons);
  expireStale(now);
  // One control every 3 s per printer. Camera frames and firmware checks do not count, and Stop is never held back.
  if (kind !== "stop" && CONTROL_KINDS.includes(kind)) {
    const last = store.listPrinterCommands(printerId).filter((c) => CONTROL_KINDS.includes(c.kind)).at(-1);
    if (last && now - Date.parse(last.createdAt) < COMMAND_GAP_MS) return fail(429, "One command every 3 seconds per printer");
  }
  if (store.listPrinterCommands(printerId).some((c) => c.state === "queued" && c.kind === kind)) {
    return fail(409, "The same command is already waiting for the bridge");
  }
  const command: PrinterCommand = {
    id: store.nextPrinterCommandId(), printerId, kind, params, state: "queued", by: (input.by as string).trim(), createdAt: iso(now),
  };
  store.savePrinterCommand(command);
  if (p.currentOrderId && kind !== "get_version" && kind !== "camera_snapshot") {
    store.addLog({ orderId: p.currentOrderId, actor: "human", tool: "printer_command", input: { printerId, kind, params, by: command.by },
      ok: true, output: { commandId: command.id }, at: command.createdAt });
  }
  return { ok: true, command };
}

// ---------- print jobs ----------

export interface PrintJobInput {
  orderId?: unknown; printerId: unknown; attachmentId: unknown; plate: unknown; amsMapping: unknown; options?: unknown;
  by: unknown; bedEmptyConfirmed: unknown; personPresent: unknown; warningsChecked?: unknown;
  /** "sdcard" (default: file:///sdcard/<name>) or "ftp" (ftp:///<name>), the fallback when an A1 did not start. */
  urlForm?: unknown;
}

const DEFAULT_OPTIONS: PrintOptions = { bedLevelling: true, flowCali: true, timelapse: false, useAms: true };
function readOptions(v: unknown): PrintOptions {
  const o = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  const bool = (k: keyof PrintOptions) => (typeof o[k] === "boolean" ? (o[k] as boolean) : DEFAULT_OPTIONS[k]);
  return { bedLevelling: bool("bedLevelling"), flowCali: bool("flowCali"), timelapse: bool("timelapse"), useAms: bool("useAms") };
}

/** Jobs on this printer that have not started printing or ended yet. */
const inFlight = (printerId: string) => store.listPrintJobs({ printerId }).filter((j) => ["queued", "uploading", "sent"].includes(j.state));

const is3mf = (a: Attachment) => a.filename.toLowerCase().endsWith(".3mf");

/**
 * A person starts a real print: checks the printer, the sliced file, the AMS mapping and the colours, then queues it
 * for the bridge. The person's confirmation that the bed is empty clears the bed flag, and the printer is linked to
 * the order (when its status allows) so the print's progress becomes evidence on the order.
 */
export function createPrintJob(input: PrintJobInput, now = Date.now()):
  { ok: true; job: PrintJob; warnings: string[]; match: JobMatch } | (Fail & { warnings?: string[]; match?: JobMatch }) {
  const printerId = typeof input.printerId === "string" ? input.printerId : "";
  if (!ID.test(printerId)) return fail(400, "Invalid printer id");
  const printer = store.getPrinter(printerId);
  if (!printer) return fail(404, "Printer not found");
  const attachment = typeof input.attachmentId === "string" ? store.getAttachment(input.attachmentId) : undefined;
  if (!attachment) return fail(404, "File not found");
  const orderId = typeof input.orderId === "string" && input.orderId ? input.orderId : attachment.orderId;
  if (attachment.orderId !== orderId) return fail(400, "The file does not belong to this order");
  const order = store.getOrder(orderId);
  if (!order) return fail(404, "Order not found");
  if (!is3mf(attachment)) return fail(400, "Only a sliced Bambu Studio file (.gcode.3mf) can be printed");
  if (input.urlForm !== undefined && input.urlForm !== null && input.urlForm !== "sdcard" && input.urlForm !== "ftp") {
    return fail(400, "urlForm must be sdcard or ftp");
  }
  const urlForm = input.urlForm === "ftp" ? ("ftp" as const) : undefined;
  const plate = Number(input.plate);
  const amsMapping = Array.isArray(input.amsMapping) ? input.amsMapping.map(Number) : [];
  const options = readOptions(input.options);
  const by = typeof input.by === "string" ? input.by.trim() : "";
  const info = attachment.parsed3mf;
  const plateInfo = info?.plates.find((x) => x.index === plate);
  const match = matchJob(plateInfo?.filaments ?? [], printer, info?.projectFilaments?.length);

  expireStale(now);
  const verdict = canStartPrint(printer, {
    info, plate, amsMapping, options, bedEmptyConfirmed: input.bedEmptyConfirmed === true, personPresent: input.personPresent === true,
    by, orderId, jobInFlight: inFlight(printerId)[0]?.id ?? null, warningsChecked: input.warningsChecked === true,
  }, now);
  const reasons = [...verdict.reasons];
  const warnings = [...verdict.warnings];
  // Colours: the printer never checks them. A colour that is far from the file's is a warning the person accepts.
  if (options.useAms && plateInfo) {
    for (const f of plateInfo.filaments) {
      const tray = amsMapping[f.id - 1];
      const t = printer.snapshot?.ams?.trays.find((x) => x.ams * 4 + x.slot === tray);
      const best = match.suggestions.find((sg) => sg.filamentId === f.id)?.slots.find((sl) => sl.slot === tray);
      if (t && !t.empty && best && best.deltaE > 10) warnings.push(`Filament ${f.id}: the file asks for ${f.color}, the spool is ${t.color}`);
    }
  }
  const escrow = store.getEscrow(orderId);
  if (order.label === "real" && escrow?.state !== "FUNDED") warnings.push("The customer has not paid into escrow yet");
  if (warnings.length && input.warningsChecked !== true && !reasons.includes("Check the warnings and tick \"I checked this\"")) {
    reasons.push("Check the warnings and tick \"I checked this\"");
  }
  const lastStart = store.listPrintJobs({ printerId }).at(-1);
  if (lastStart && now - Date.parse(lastStart.createdAt) < START_GAP_MS && lastStart.state !== "failed" && lastStart.state !== "cancelled") {
    reasons.push("One print start per printer per minute");
  }
  if (reasons.length) return { ...fail(409, "The print cannot start", reasons), warnings, match };

  // The person at the printer confirmed the bed is empty: clear the flag the last print left.
  if (printer.bedOccupiedBy) clearBed(printerId, by);
  const linked = linkPrinter(printerId, orderId, "human");
  if (!linked.ok) warnings.push(`Not linked to ${orderId}: ${linked.error}`);
  const at = iso(now);
  const job: PrintJob = {
    id: store.nextPrintJobId(), orderId, printerId, attachmentId: attachment.id, plate,
    fileName: sdFileName(orderId, plate, Math.floor(now / 1000)), amsMapping: options.useAms ? amsMapping : [], options,
    state: "queued", by, createdAt: at, updatedAt: at, subtaskName: subtaskName(orderId, order.product), ...(urlForm ? { urlForm } : {}),
  };
  store.savePrintJob(job);
  store.addLog({ orderId, actor: "human", tool: "start_print", input: { printerId, attachmentId: attachment.id, plate, amsMapping: job.amsMapping, options, by, ...(urlForm ? { urlForm } : {}) },
    ok: true, output: { jobId: job.id, printer: printerName(printerId), warnings }, at });
  return { ok: true, job, warnings, match };
}

/**
 * A person cancels a job that has not reached the printer: still queued, or being uploaded (the bridge then cannot
 * record "sent" and publishes nothing). A job already on the printer is stopped with "stop".
 */
export function cancelPrintJob(id: string, by: unknown, now = Date.now()): { ok: true; job: PrintJob } | Fail {
  const j = store.getPrintJob(id);
  if (!j) return fail(404, "Print job not found");
  if (!isPersonName(by)) return fail(400, "A person's name is required");
  if (j.state !== "queued" && j.state !== "uploading") return fail(409, `The job is ${j.state}; stop the print on the printer instead`);
  const job: PrintJob = { ...j, state: "cancelled", updatedAt: iso(now), error: `Cancelled by ${(by as string).trim()}` };
  store.savePrintJob(job);
  return { ok: true, job };
}

/** MD5 of the file, so the bridge can check its download before uploading it to the printer. */
export const fileMd5 = (bytes: Uint8Array): string => createHash("md5").update(bytes).digest("hex");

// ---------- the bridge's side ----------

export interface QueueItemCommand { type: "command"; id: string; printerId: string; kind: PrinterCommandKind; params: PrinterCommand["params"]; by: string; createdAt: string; expiresAt: string }
export interface QueueItemJob {
  type: "job"; id: string; printerId: string; orderId?: string; plate: number; fileName: string; subtaskName: string; amsMapping: number[];
  options: PrintOptions; by: string; createdAt: string; expiresAt: string; size: number; md5: string | null;
  /** GET this (bearer) to download the 3MF. */
  fileUrl: string;
  /** "ftp": publish url ftp:///<name> instead of file:///sdcard/<name> (a person's retry after an A1 did not start). */
  urlForm: "sdcard" | "ftp";
  /** Send the print no later than this (START_CONFIRM_MS after the person confirmed the bed). */
  sendBy: string;
}

/** What the bridge should do now: queued commands and jobs, oldest first. Expired ones are never returned. */
export function bridgeQueue(printerIds: string[] | null, now = Date.now()): { commands: QueueItemCommand[]; jobs: QueueItemJob[] } {
  expireStale(now);
  const want = (id: string) => !printerIds || printerIds.includes(id);
  const commands = store.listPrinterCommands().filter((c) => c.state === "queued" && want(c.printerId)).map((c): QueueItemCommand => ({
    type: "command", id: c.id, printerId: c.printerId, kind: c.kind, params: c.params, by: c.by, createdAt: c.createdAt,
    expiresAt: iso(Date.parse(c.createdAt) + COMMAND_EXPIRY_MS),
  }));
  const jobs = store.listPrintJobs().filter((j) => j.state === "queued" && want(j.printerId)).map((j): QueueItemJob => {
    const a = store.getAttachment(j.attachmentId);
    return {
      type: "job", id: j.id, printerId: j.printerId, orderId: j.orderId, plate: j.plate, fileName: j.fileName,
      subtaskName: j.subtaskName ?? j.fileName, amsMapping: j.amsMapping, options: j.options, by: j.by, createdAt: j.createdAt,
      expiresAt: iso(Date.parse(j.createdAt) + JOB_PICKUP_MS), size: a?.size ?? 0, md5: j.md5 ?? null,
      fileUrl: `/api/print-jobs/${encodeURIComponent(j.id)}/file`, urlForm: j.urlForm ?? "sdcard",
      sendBy: iso(Date.parse(j.createdAt) + START_CONFIRM_MS),
    };
  });
  return { commands, jobs };
}

const COMMAND_NEXT: Record<PrinterCommandState, PrinterCommandState[]> = {
  queued: ["sent", "failed"], sent: ["done", "failed"], done: [], failed: [], expired: [],
};
const JOB_NEXT: Record<PrintJobState, PrintJobState[]> = {
  queued: ["uploading", "failed"], uploading: ["sent", "failed", "cancelled"], sent: ["printing", "failed", "done", "cancelled"],
  printing: ["done", "failed", "cancelled"], done: [], failed: [], cancelled: [],
};

/**
 * The bridge reports progress on one command ("PC-…") or job ("PJ-…"). Taking an item is the move from queued to
 * sent (command) or uploading (job): it succeeds once, so a command never runs twice.
 */
export function updateQueueItem(id: string, input: { state: unknown; error?: unknown; result?: unknown; md5?: unknown }, now = Date.now()):
  { ok: true; command?: PrinterCommand; job?: PrintJob } | Fail {
  expireStale(now);
  const state = typeof input.state === "string" ? input.state : "";
  const note = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 300) : undefined);
  if (id.startsWith("PC-")) {
    const c = store.getPrinterCommand(id);
    if (!c) return fail(404, "Command not found");
    if (!COMMAND_NEXT[c.state].includes(state as PrinterCommandState)) return fail(409, `The command is ${c.state}; it cannot become ${state || "that"}`);
    const done = state === "done" || state === "failed";
    const command: PrinterCommand = { ...c, state: state as PrinterCommandState, ...(done ? { doneAt: iso(now) } : {}),
      result: note(input.result) ?? note(input.error) ?? c.result };
    store.savePrinterCommand(command);
    return { ok: true, command };
  }
  if (id.startsWith("PJ-")) {
    const j = store.getPrintJob(id);
    if (!j) return fail(404, "Print job not found");
    if (!JOB_NEXT[j.state].includes(state as PrintJobState)) return fail(409, `The job is ${j.state}; it cannot become ${state || "that"}`);
    // "sent" is the last gate before the printer starts: the person's bed confirmation must still hold.
    if (state === "sent") {
      const late = now - Date.parse(j.createdAt) > START_CONFIRM_MS;
      const bed = store.getPrinter(j.printerId)?.bedOccupiedBy;
      if (late || bed) {
        const error = late
          ? "The bed was confirmed more than 10 min ago: nothing was sent. Check the bed again and start again."
          : "A print ended on this printer after the bed was confirmed: nothing was sent. Clear the bed and start again.";
        updateQueueItem(id, { state: "failed", error }, now);
        return fail(409, error);
      }
    }
    const md5 = typeof input.md5 === "string" && /^[0-9a-f]{32}$/i.test(input.md5) ? input.md5.toLowerCase() : j.md5;
    const job: PrintJob = { ...j, state: state as PrintJobState, updatedAt: iso(now), md5, ...(note(input.error) ? { error: note(input.error) } : {}) };
    store.savePrintJob(job);
    if (job.orderId && (state === "failed" || state === "sent")) {
      store.addLog({ orderId: job.orderId, actor: "human", tool: "print_job", input: { jobId: job.id, state }, ok: state !== "failed",
        output: { printer: printerName(job.printerId), error: job.error ?? null }, at: job.updatedAt });
    }
    return { ok: true, job };
  }
  return fail(404, "Unknown queue item");
}

/** The job's 3MF, for the bridge. Only while the job is waiting or being uploaded. */
export function jobFile(id: string): { ok: true; job: PrintJob; attachment: Attachment } | Fail {
  const j = store.getPrintJob(id);
  if (!j) return fail(404, "Print job not found");
  if (!["queued", "uploading"].includes(j.state)) return fail(409, `The job is ${j.state}`);
  const attachment = store.getAttachment(j.attachmentId);
  if (!attachment) return fail(404, "File not found");
  return { ok: true, job: j, attachment };
}

// ---------- camera frames (kept in memory: the latest one per printer) ----------

export const MAX_FRAME_BYTES = 2 * 1024 * 1024;
const frames = ((globalThis as unknown as { __kesuniFrames?: Map<string, { jpeg: Uint8Array; at: string }> }).__kesuniFrames ??= new Map());

/** The bridge sends the latest camera frame. Only a JPEG, at most 2 MB. */
export function saveCameraFrame(printerId: string, jpeg: Uint8Array, now = Date.now()): { ok: true; at: string; size: number } | Fail {
  if (!ID.test(printerId)) return fail(400, "Invalid printer id");
  if (!store.getPrinter(printerId)) return fail(404, "Printer not found");
  if (jpeg.byteLength > MAX_FRAME_BYTES) return fail(413, "Camera frame is larger than 2 MB");
  if (jpeg.byteLength < 4 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8 || jpeg[2] !== 0xff) return fail(400, "Not a JPEG image");
  const at = iso(now);
  frames.set(printerId, { jpeg: new Uint8Array(jpeg), at });
  return { ok: true, at, size: jpeg.byteLength };
}

export const cameraFrame = (printerId: string): { jpeg: Uint8Array; at: string } | undefined => frames.get(printerId);
/** Tests only. */
export const clearCameraFrames = () => frames.clear();
