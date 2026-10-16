// Agent prints: every gate, in code. Read-only (store reads, no writes). The enforcer (jobs.ts createAgentPrintJob)
// re-checks all of them inside its transaction, and the dispatcher (dispatch.ts) uses the same functions for its plan
// and its "why not" lines, so a preview and a start never disagree. Never imported by src/lib/agent (the Chief).
//
// Gates, each alone blocks an agent print:
// - switch: a person turned "Agent may start prints" on (meta autoPrint), and KESUNI_AUTO_PRINT is not "off";
// - printer: reported in the last minute; IDLE or FINISH (after a failed print a person starts the next one); no print
//   job on its way; one start a minute; no fault (fatal/serious HMS, device error) and no warning HMS; SD card in and
//   fine; colours confirmed by a person since the spools last changed; not linked to another order;
// - bed: a person's "Bed is empty" given after the last print started and ended, not used, not older than 2 h;
// - order: PLAN_CHOSEN or IN_PRODUCTION; a real order is paid into escrow (FUNDED); an order that is not real only when a
//   person set its runs; runs left (runs needed - finished prints - prints on their way > 0, one at a time). Finished: the
//   order's done print jobs, or its collect tasks from a printer if more (a print started outside the website). On its
//   way: its jobs not ended, and any printer linked to it that is printing. No open reprint task and no open "agent
//   print did not start" task;
// - file: only a .gcode.3mf the studio PC sliced from the order's newest design file, an STL or OBJ, with the studio's
//   presets (a done SliceJob links it): never a file someone uploaded (its G-code was never reviewed) and never a 3MF
//   project sliced with its own settings, and never an automatic weighing's slice (it only priced the design). For the
//   Bambu Lab A1, 0.4 mm nozzle, textured PEI plate, one plate, in the order's material and colours;
// - pairing: every filament has a spool of the same material within the colour limit (matchJob) of the file AND of the
//   order's colour, and canStartPrint with actor "agent" gives no reason and no warning. At "sent" (jobs.ts) the spools
//   must still be the ones the print was queued with (agentSpoolProblem).
import * as store from "../store";
import { colorsCheckedNow, deltaE, matchJob, MATCH_MAX_DELTA_E, nameOf, normalizeHex, type JobMatch } from "../colors";
import { orderMaterial, toMaterial } from "../pricing";
import { sliceSourceCheck } from "../slice-rules";
import { canStartPrint, START_FRESH_MS, START_GAP_MS } from "./control";
import { blockingFault, printerName } from "./actions";
import { AUTO_PRINT_META, bedState, bedWhy, type Why } from "./autoprint-rules";
import type { Attachment, BedCheck, Order, Printer, PrintJob, PrintOptions, ThreeMfInfo, ThreeMfPlate } from "../types";

/** The options of an agent print: the app's defaults (bed levelling and flow calibration on, no timelapse, the AMS). */
export const AGENT_OPTIONS: PrintOptions = { bedLevelling: true, flowCali: true, timelapse: false, useAms: true };
export const PRODUCTION_STATUSES: Order["status"][] = ["PLAN_CHOSEN", "IN_PRODUCTION"];
const IN_FLIGHT = ["queued", "uploading", "sent"];
const ACTIVE = [...IN_FLIGHT, "printing"];
const ON_PRINTER = ["PREPARE", "RUNNING", "PAUSE"];
const A1 = { modelId: "N2S", model: "Bambu Lab A1", nozzle: "0.4", bed: "textured_plate" };

// ---------- the switch ----------

export interface AutoPrintSetting { on: boolean; by?: string; at?: string; /** KESUNI_AUTO_PRINT=off on this server. */ locked?: boolean }

/** "Agent may start prints": set by a person on the Chief page. Off when missing, and always off with KESUNI_AUTO_PRINT=off. */
export function autoPrintSetting(): AutoPrintSetting {
  const m = store.getMeta<{ on?: unknown; by?: unknown; at?: unknown }>(AUTO_PRINT_META);
  const locked = (process.env.KESUNI_AUTO_PRINT ?? "").trim().toLowerCase() === "off";
  return {
    on: m?.on === true && !locked,
    ...(typeof m?.by === "string" ? { by: m.by } : {}), ...(typeof m?.at === "string" ? { at: m.at } : {}), ...(locked ? { locked } : {}),
  };
}
export const autoPrintOn = (): boolean => autoPrintSetting().on;

// ---------- printer ----------

const STATE_TEXT: Record<string, string> = {
  PREPARE: "The printer is preparing a print", RUNNING: "The printer is printing", PAUSE: "The printer is paused",
  SLICING: "The printer is slicing", INIT: "The printer is starting up", UNKNOWN: "The printer does not report its state",
};

export const jobsInFlight = (printerId: string) => store.listPrintJobs({ printerId }).filter((j) => IN_FLIGHT.includes(j.state));

export interface PrinterGate {
  /** Every gate passes, the bed too. */
  ok: boolean;
  /** The first gate that fails, or null. */
  why: Why | null;
  /** Every gate but the bed passes: the printer waits only for a person's "Bed is empty". */
  readyButBed: boolean;
  /** The person's bed confirmation the agent may use now. */
  bed: BedCheck | null;
}

/** The printer gates, then the bed. orderId: the order it would print (a printer linked to another order is reserved). */
export function printerGate(p: Printer, now: number, orderId?: string): PrinterGate {
  const no = (why: Why): PrinterGate => ({ ok: false, why, readyButBed: false, bed: null });
  const s = p.snapshot;
  if (!p.lastSeen || now - Date.parse(p.lastSeen) > START_FRESH_MS) return no({ key: "No report in the last minute" });
  const state = s?.state ?? "UNKNOWN";
  if (state === "FAILED") return no({ key: "The last print failed: a person starts the next one" });
  if (state !== "IDLE" && state !== "FINISH") return no({ key: STATE_TEXT[state] ?? STATE_TEXT.UNKNOWN });
  if (jobsInFlight(p.id).length) return no({ key: "A print job is on its way to the printer" });
  const last = store.listPrintJobs({ printerId: p.id }).at(-1);
  if (last && now - Date.parse(last.createdAt) < START_GAP_MS && last.state !== "failed" && last.state !== "cancelled") {
    return no({ key: "One print start per printer per minute" });
  }
  const fault = blockingFault(s);
  if (fault) return no({ key: "Printer error {code}", vars: { code: fault } });
  const warning = (s?.hms ?? []).find((h) => h.severity === 3);
  if (warning) return no({ key: "Printer warning {code}: a person checks it", vars: { code: warning.code } });
  if (s?.sdcard === undefined || s.sdcard === null) return no({ key: "The bridge does not report the SD card yet: update and restart the bridge" });
  if (!s.sdcard) return no({ key: "No microSD card in the printer (printing needs one)" });
  if (s.sdAbnormal) return no({ key: "The printer reports a problem with the SD card" });
  if (!s.ams) return no({ key: "The bridge does not report the AMS yet: update and restart the bridge" });
  if (!colorsCheckedNow(p)) return no({ key: "Nobody confirmed the colours on this printer" });
  if (p.currentOrderId && orderId !== undefined && p.currentOrderId !== orderId) return no({ key: "Linked to {order}", vars: { order: p.currentOrderId } });
  const bed = bedState(p, now);
  if (!bed.ok) return { ok: false, why: bedWhy(bed), readyButBed: true, bed: null };
  return { ok: true, why: null, readyButBed: true, bed: bed.check };
}

// ---------- order ----------

export interface OrderGate {
  why: Why | null;
  runsNeeded: number;
  runsDone: number;
  /** Print jobs of the order on their way or printing. */
  runsActive: number;
  real: boolean;
}

/** Runs a person asked for; without it 1 for a real order and 0 (the agent never prints it) for any other. */
export const runsNeeded = (o: Order): number => o.autoPrint?.runsNeeded ?? (o.label === "real" ? 1 : 0);

export function orderGate(o: Order): OrderGate {
  const real = o.label === "real";
  const jobs = store.listPrintJobs({ orderId: o.id });
  // A print a person started outside the website (Bambu Studio, the printer screen) has no print job: the collect task
  // the printer's "finished" raised counts it, and a linked printer that is printing counts as a run on its way.
  const collected = store.listTasks(o.id).filter((t) => t.kind === "collect_and_qc" && t.printerId && t.createdBy === "agent").length;
  const runsDone = Math.max(jobs.filter((j) => j.state === "done").length, collected);
  const busy = new Set(jobs.filter((j) => ACTIVE.includes(j.state)).map((j) => j.printerId));
  for (const p of store.listPrinters()) if (p.currentOrderId === o.id && ON_PRINTER.includes(p.snapshot?.state ?? "")) busy.add(p.id);
  const runsActive = busy.size;
  const need = runsNeeded(o);
  const base = { runsNeeded: need, runsDone, runsActive, real };
  const no = (why: Why): OrderGate => ({ ...base, why });
  if (!PRODUCTION_STATUSES.includes(o.status)) return no({ key: "Order is {status}", vars: { status: o.status } });
  if (!real && !o.autoPrint) return no({ key: "Not a real order: a person sets its runs to let the agent print it" });
  if (need === 0) return no({ key: "A person set 0 runs: the agent does not print it" });
  if (real && store.getEscrow(o.id)?.state !== "FUNDED") return no({ key: "Waiting for the customer's payment" });
  if (runsDone >= need) return no({ key: "All runs printed ({done} of {needed})", vars: { done: runsDone, needed: need } });
  if (runsActive > 0) return no({ key: "Run {n} of {needed} is on the printer", vars: { n: Math.min(need, runsDone + 1), needed: need } });
  const open = store.listTasks(o.id).filter((t) => t.status === "open");
  if (open.some((t) => t.kind === "reprint")) return no({ key: "A print failed: a person decides on a reprint (close its task)" });
  if (open.some((t) => t.key?.startsWith("autoprint:failed:"))) {
    return no({ key: "The agent's last print did not start: a person checks the printer (close its task)" });
  }
  return { ...base, why: null };
}

// ---------- the file ----------

export interface PrintSource { attachment: Attachment; info: ThreeMfInfo; plate: ThreeMfPlate }

const MODEL_FILE = /\.(stl|obj|3mf|step|stp)$/i;
/**
 * The order's newest design model that is not a sliced file (STL, OBJ, STEP or an unsliced 3MF): what the customer
 * wants printed now. The agent prints no file sliced from an older one, and slices only this one.
 */
export function newestDesign(orderId: string): Attachment | undefined {
  return store.listAttachments(orderId).filter((a) => a.kind === "design" && MODEL_FILE.test(a.filename) && !a.parsed3mf?.sliced).at(-1);
}

/** Why the agent may not print this file for this order, or null. */
export function agentFileProblem(o: Order, a: Attachment): Why | null {
  if (a.orderId !== o.id) return { key: "The file is not on this order" };
  const info = a.parsed3mf;
  if (a.kind !== "design" || !a.filename.toLowerCase().endsWith(".3mf") || !info?.sliced) return { key: "Not a sliced file" };
  // Only the studio PC's own slice of an STL/OBJ with the studio's presets: nobody reviewed the G-code of any other file
  // (a person prints it, and sees the warning).
  const slice = store.listSliceJobs({ orderId: o.id }).find((j) => j.resultAttachmentId === a.id && j.state === "done");
  if (!slice || slice.mode !== "mesh") return { key: "The agent prints only files the studio PC sliced from an STL or OBJ: a person prints this one" };
  // An automatic weighing only priced the customer's design (any spool of the material, colours not confirmed).
  if (slice.actor === "system") return { key: "Sliced only to weigh the design: the agent slices it again to print" };
  const src = store.getAttachment(slice.attachmentId);
  if (!src || src.orderId !== o.id || !sliceSourceCheck(src).ok) return { key: "The design file this was sliced from is gone" };
  if (newestDesign(o.id)?.id !== src.id) return { key: "A newer design file is on the order: this sliced file is out of date" };
  if (info.printerModelId ? info.printerModelId !== A1.modelId : info.printerModel !== A1.model) return { key: "The sliced file is not for the Bambu Lab A1" };
  if (info.plates.length !== 1) return { key: "The sliced file has {n} plates: a person prints it", vars: { n: info.plates.length } };
  const plate = info.plates[0];
  if ((plate.nozzle ?? info.nozzle) !== A1.nozzle) return { key: "The sliced file is not for the 0.4 mm nozzle" };
  if (plate.bedType !== A1.bed) return { key: "The sliced file is not for the textured PEI plate" };
  if (!plate.filaments.length) return { key: "Not a sliced file" };
  const material = orderMaterial(o);
  const choices = o.preferredColors ?? [];
  for (const f of plate.filaments) {
    const type = f.type.trim().toUpperCase();
    if (material && type !== material) return { key: "The sliced file is {type}; the order is {material}", vars: { type, material } };
    const color = normalizeHex(f.color);
    if (choices.length && !(color && choices.some((c) => c.type === type && deltaE(c.color, color) <= MATCH_MAX_DELTA_E))) {
      return { key: "The sliced file's colours are not the order's" };
    }
  }
  return null;
}

/** The order's sliced files the agent may print, newest first, and why the newest other one may not (if any). */
export function printSources(o: Order): { ok: PrintSource[]; skipped: Why | null } {
  const ok: PrintSource[] = [];
  let skipped: Why | null = null;
  for (const a of store.listAttachments(o.id).reverse()) {
    if (a.kind !== "design" || !a.parsed3mf?.sliced) continue;
    const why = agentFileProblem(o, a);
    if (why) skipped ??= why;
    else ok.push({ attachment: a, info: a.parsed3mf, plate: a.parsed3mf.plates[0] });
  }
  return { ok, skipped };
}

/** What a plate prints with: material and English colour name per filament, no repeats. */
export const plateColourList = (plate: ThreeMfPlate): { material: string; name: string }[] =>
  plate.filaments.map((f) => ({ material: f.type.trim().toUpperCase(), name: nameOf(f.color) }))
    .filter((c, i, all) => all.findIndex((x) => x.material === c.material && x.name === c.name) === i);

/** "PLA White", "PLA Yellow + PETG Black": what a plate prints with. */
export const plateColours = (plate: ThreeMfPlate): string =>
  plate.filaments.map((f) => `${f.type.trim().toUpperCase()} ${nameOf(f.color)}`).filter((v, i, all) => all.indexOf(v) === i).join(" + ");

// ---------- order x printer ----------

export interface Pairing { match: JobMatch; reasons: string[] }

/**
 * The spools and canStartPrint for this file on this printer, as the agent: same material within the colour limit for
 * every filament, and no reason and no warning (nobody is there to tick "I checked this"). bedConfirmedBy is the person
 * whose "Bed is empty" the print would use.
 */
export function pairing(p: Printer, src: PrintSource, orderId: string, now: number, bedConfirmedBy: string): Pairing {
  const match = matchJob(src.plate.filaments, p, src.info.projectFilaments?.length);
  const reasons = match.missing.map((m) => `No spool of ${m.type.toUpperCase()} ${nameOf(m.color)} on ${printerName(p.id)}`);
  // Each spool is also near the colour the customer picked, not only near the file's: two tolerances never add up.
  const choices = store.getOrder(orderId)?.preferredColors ?? [];
  if (choices.length && !match.missing.length) {
    for (const f of src.plate.filaments) {
      const t = p.snapshot?.ams?.trays.find((x) => x.ams * 4 + x.slot === match.mapping[f.id - 1]);
      const type = toMaterial(t?.type);
      if (!t?.color || !choices.some((c) => c.type === type && deltaE(c.color, t.color!) <= MATCH_MAX_DELTA_E)) {
        reasons.push(`The spool for filament ${f.id} on ${printerName(p.id)} is not the order's colour`);
      }
    }
  }
  const verdict = canStartPrint(p, {
    info: src.info, plate: src.plate.index, amsMapping: match.mapping, options: AGENT_OPTIONS, bedEmptyConfirmed: false, personPresent: false,
    by: "agent", actor: "agent", bedConfirmedBy, orderId, jobInFlight: jobsInFlight(p.id)[0]?.id ?? null, warningsChecked: false,
  }, now);
  return { match, reasons: [...reasons, ...verdict.reasons, ...verdict.warnings] };
}

/** The spools an agent print is queued with (PrintJob.expectedTrays): material and colour of each mapped AMS tray. */
export function expectedTrays(p: Printer, mapping: number[]): NonNullable<PrintJob["expectedTrays"]> {
  return [...new Set(mapping.filter((x) => x >= 0))].map((tray) => {
    const t = p.snapshot?.ams?.trays.find((x) => x.ams * 4 + x.slot === tray);
    return { tray, type: (t?.type ?? "").toUpperCase(), color: (t?.color ?? "").toUpperCase() };
  });
}

/** Why an agent print is not sent: a spool changed after it was queued. */
export const SPOOL_CHANGED_TEXT = "A spool changed after the agent queued the print: nothing was sent. A person confirms the colours again.";

/**
 * Nobody stands at the printer to notice a spool swapped during the upload: an agent print is sent only while a person's
 * colour check still holds and every mapped tray still holds the material and colour it was queued with. Null: it may.
 */
export function agentSpoolProblem(j: Pick<PrintJob, "expectedTrays">, p: Printer | undefined): string | null {
  if (!p || !colorsCheckedNow(p) || !j.expectedTrays?.length) return SPOOL_CHANGED_TEXT;
  for (const e of j.expectedTrays) {
    const t = p.snapshot?.ams?.trays.find((x) => x.ams * 4 + x.slot === e.tray);
    if (!t || t.empty || (t.type ?? "").toUpperCase() !== e.type || (t.color ?? "").toUpperCase() !== e.color) return SPOOL_CHANGED_TEXT;
  }
  return null;
}
