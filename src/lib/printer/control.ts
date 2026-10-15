// Printer controls, for PEOPLE only: which ones exist, when each is allowed, and the exact MQTT message the bridge
// publishes (protocol spec §4, checked on our A1s). Pure and without runtime imports: scripts/printer-bridge.mjs
// imports this file straight from Node and checks again against its own live snapshot right before it publishes.
// The Chief (src/lib/agent) never imports this file or src/lib/printer/jobs.ts: it can read printer status, never
// control a printer (a test checks it).
// Never here, whatever a request asks: raw G-code, axis moves, homing, temperatures, fans, AMS moves, calibration
// runs, firmware, or SD-card browsing.
import type { PrinterSnapshot, PrinterState } from "./bambu";
import type { PrintOptions, Printer, PrinterCommandKind, ThreeMfInfo } from "../types";

export const COMMAND_KINDS: readonly PrinterCommandKind[] = ["pause", "resume", "stop", "speed", "light", "get_version", "camera_snapshot"];
/** Kinds that change what the printer does: a person's name, and the person confirms. */
export const CONTROL_KINDS: readonly PrinterCommandKind[] = ["pause", "resume", "stop", "speed", "light"];
/** Kinds that need an explicit confirm: true in the request (the page shows a dialog first). */
export const CONFIRM_KINDS: readonly PrinterCommandKind[] = ["pause", "resume", "stop"];
/** A command the bridge has not picked up within this time expires, so a stale STOP never fires later. */
export const COMMAND_EXPIRY_MS = 60_000;
/** A print job the bridge has not picked up within this time fails: the bed was confirmed empty for now, not for later. */
export const JOB_PICKUP_MS = 5 * 60_000;
/**
 * The print is sent to the printer at most this long after the person confirmed the bed (download + upload included).
 * Later, the app refuses to record "sent" and the bridge refuses to publish: the person checks the bed and starts again.
 */
export const START_CONFIRM_MS = 10 * 60_000;
/** A job the bridge took ("uploading") but never reported on fails after this (e.g. the bridge restarted mid-job). */
export const UPLOAD_TIMEOUT_MS = 30 * 60_000;
/** A job reported "sent" that never showed on the printer (PREPARE/RUNNING) fails after this. */
export const SENT_TIMEOUT_MS = 15 * 60_000;
/** A started print still preparing (heating, levelling, calibrating) after this gets a task for a person to look. */
export const PREPARE_WAIT_MS = 15 * 60_000;
/** Start a print only on a printer that reported within this time. */
export const START_FRESH_MS = 60_000;
/** Other controls: the printer counts as online (same window as the rest of the app). */
export const ONLINE_MS = 2 * 60_000;
/** Rate limits per printer. */
export const COMMAND_GAP_MS = 3_000;
export const START_GAP_MS = 60_000;

/** print_error values that are no fault: a person cancelled or paused the job, or Bambu's internal codes (same lists as
 *  bambu.ts BENIGN_PRINT_ERRORS + INTERNAL_PRINT_ERRORS; this file has no runtime imports, a test keeps them equal). */
export const NOT_A_FAULT_PRINT_ERRORS: readonly number[] = [
  0x0300400c, 0x0500400e, 0x03008001,
  0x05008030, 0x0500c011, 0x05024007, 0x05024008, 0x05024009, 0x0502400a, 0x0502400b, 0x0502400c, 0x05024012,
];
const isFault = (code: number) => code !== 0 && !NOT_A_FAULT_PRINT_ERRORS.includes(code >>> 0);
const hex8 = (n: number) => (n >>> 0).toString(16).toUpperCase().padStart(8, "0");
const errText = (n: number) => `${hex8(n).slice(0, 4)}-${hex8(n).slice(4)}`;

/** The printer's state in words, for reasons a person reads ("The printer is paused: ..."). */
export const STATE_WORD: Record<PrinterState, string> = {
  IDLE: "idle", PREPARE: "preparing", SLICING: "slicing", RUNNING: "printing", PAUSE: "paused", FINISH: "finished",
  FAILED: "stopped", INIT: "starting up", UNKNOWN: "not reporting its state",
};

/**
 * The printer paused because of a fault, not because a person paused it: a pause stage that needs a person (other than
 * 16, "paused by the user"), a print_error that is a fault, or a fatal/serious HMS. Resuming then needs the person to
 * say they fixed the cause (params.fixed), in the app and again in the bridge.
 */
export function resumeNeedsFix(s: Pick<PrinterSnapshot, "state" | "errorCode" | "stage" | "hms"> | undefined): boolean {
  if (!s || s.state !== "PAUSE") return false;
  if (isFault(s.errorCode)) return true;
  if (s.stage?.needsPerson && s.stage.code !== 16 && s.stage.code !== -1) return true;
  return (s.hms ?? []).some((h) => h.severity === 1 || h.severity === 2);
}

/** Names that are not a person: controls are refused for them. */
const NOT_A_PERSON = /^(agent|ai|chief|the chief|chief kesuni officer|claude|heartbeat|system|bridge|auto(matic)?|bot|robot)$/i;
/** A person's name: required on every control. */
export function isPersonName(by: unknown): by is string {
  return typeof by === "string" && by.trim().length > 0 && by.trim().length <= 60 && !NOT_A_PERSON.test(by.trim());
}

const online = (p: Pick<Printer, "lastSeen">, now: number, ms: number) => Boolean(p.lastSeen) && now - Date.parse(p.lastSeen!) <= ms;

/** Why this control cannot be sent to this printer now; empty when it can. English (pages show them with tLib). */
export function commandReasons(
  p: Pick<Printer, "lastSeen" | "snapshot">, kind: PrinterCommandKind, params: Record<string, unknown>, now: number,
): string[] {
  if (!COMMAND_KINDS.includes(kind)) return ["Unknown printer command"];
  const r: string[] = [];
  if (!online(p, now, ONLINE_MS)) r.push("The printer is offline (no report in the last 2 min)");
  const state: PrinterState = p.snapshot?.state ?? "UNKNOWN";
  const need = (ok: boolean, text: string) => { if (!ok) r.push(text); };
  switch (kind) {
    case "pause": need(state === "RUNNING" || state === "PREPARE", "Pause works only while the printer is printing or preparing"); break;
    case "resume":
      need(state === "PAUSE", "Resume works only while the printer is paused");
      need(!resumeNeedsFix(p.snapshot) || params.fixed === true, "The printer paused because of a fault: fix it, then tick \"I fixed the cause\"");
      break;
    case "stop": need(state === "PREPARE" || state === "RUNNING" || state === "PAUSE", "Stop works only while a print is on the printer"); break;
    case "speed":
      need(state === "RUNNING", "The speed can only change while the printer is printing");
      need([1, 2, 3, 4].includes(params.level as number), "Speed level must be 1 (silent), 2 (standard), 3 (sport) or 4 (ludicrous)");
      break;
    case "light": need(typeof params.on === "boolean", "Say whether the light goes on or off"); break;
    default: break;
  }
  return r;
}

// ---------- starting a print ----------

export interface StartCheck {
  info: ThreeMfInfo | undefined;   // the attachment's parsed3mf
  plate: number;
  amsMapping: number[];
  options: PrintOptions;
  bedEmptyConfirmed: boolean;      // a person at the printer confirmed the bed is empty and clean
  personPresent: boolean;          // a person is at the printer when it starts
  by: string;
  orderId?: string;
  /** Another job on this printer that is still queued, uploading or sent. */
  jobInFlight?: string | null;
  /** The person ticked "I checked this" for the warnings. */
  warningsChecked?: boolean;
}

export interface StartVerdict { ok: boolean; reasons: string[]; warnings: string[] }

/** "slot 3" for global tray 2 of AMS 0 (the printer counts slots from 1). */
export const slotLabel = (tray: number): string => (tray >> 2 === 0 ? `slot ${(tray & 3) + 1}` : `AMS ${(tray >> 2) + 1} slot ${(tray & 3) + 1}`);

const A1_MODEL_ID = "N2S";
const A1_MODEL = "Bambu Lab A1";

/**
 * Everything the app checks before it queues a print, and the bridge checks again before it publishes. reasons block
 * the start; warnings need the person to tick "I checked this" (warningsChecked) and do not block once ticked.
 * The printer itself refuses a wrong model, nozzle, file name, a full SD card and more; it never checks the bed, the
 * colour, the material in each slot, or who pressed the button: those are checked here.
 */
export function canStartPrint(p: Printer, job: StartCheck, now: number): StartVerdict {
  const reasons: string[] = [];
  const warnings: string[] = [];
  const s = p.snapshot;
  if (!isPersonName(job.by)) reasons.push("A person's name is required");
  if (!job.personPresent) reasons.push("A person must be at the printer when it starts");
  if (!job.bedEmptyConfirmed) reasons.push("A person must confirm the bed is empty and clean");
  if (!online(p, now, START_FRESH_MS)) reasons.push("The printer has not reported in the last minute (is the bridge running?)");
  const state = s?.state ?? "UNKNOWN";
  if (!["IDLE", "FINISH", "FAILED"].includes(state)) reasons.push(`The printer is ${STATE_WORD[state] ?? STATE_WORD.UNKNOWN}: it must be idle or finished`);
  if (p.currentOrderId && p.currentOrderId !== job.orderId) reasons.push(`The printer is linked to ${p.currentOrderId}`);
  if (job.jobInFlight) reasons.push(`Another print job (${job.jobInFlight}) on this printer has not started yet`);
  for (const h of s?.hms ?? []) {
    if (h.severity === 1 || h.severity === 2) reasons.push(`Printer error ${h.code}: fix it before printing`);
    else if (h.severity === 3) warnings.push(`Printer warning ${h.code}: check it before printing`);
  }
  if (s?.errorCode && isFault(s.errorCode)) reasons.push(`Printer error ${errText(s.errorCode)}: fix it before printing`);
  if (s?.sdcard === undefined || s.sdcard === null) reasons.push("The bridge does not report the SD card yet: update and restart the bridge");
  else if (!s.sdcard) reasons.push("No microSD card in the printer (printing needs one)");
  if (s?.sdAbnormal) reasons.push("The printer reports a problem with the SD card");

  const info = job.info;
  if (!info || !info.sliced) {
    reasons.push(info?.error ? `The 3MF could not be read: ${info.error}` : "Not a sliced file: in Bambu Studio use File > Export > Export plate sliced file (.gcode.3mf)");
    return { ok: false, reasons, warnings };
  }
  if (info.printerModelId ? info.printerModelId !== A1_MODEL_ID : info.printerModel !== A1_MODEL) {
    reasons.push(info.printerModel || info.printerModelId
      ? `The file is sliced for ${info.printerModel ?? info.printerModelId}, not the Bambu Lab A1`
      : "The file does not say which printer it is sliced for");
  }
  const plate = info.plates.find((x) => x.index === job.plate);
  if (!plate) {
    reasons.push(`Plate ${job.plate} is not in the sliced file`);
    return { ok: false, reasons, warnings };
  }
  const want = plate.nozzle ?? info.nozzle;
  const have = s?.nozzle?.diameter;
  if (want && have && Number(want) !== Number(have)) reasons.push(`The file is for a ${want} mm nozzle; the printer has ${have} mm`);
  if (!plate.filaments.length) reasons.push("The plate uses no filament");

  const count = info.projectFilaments?.length ?? Math.max(0, ...plate.filaments.map((f) => f.id));
  if (job.options.useAms) {
    if (job.amsMapping.length !== count) reasons.push(`The AMS mapping needs ${count} entries, one per filament in the project`);
    if (job.amsMapping.some((v) => !Number.isInteger(v) || v < -1 || v > 15)) reasons.push("The AMS mapping holds an invalid slot");
    const trays = s?.ams?.trays;
    if (!trays) reasons.push("The bridge does not report the AMS yet: update and restart the bridge");
    for (const f of plate.filaments) {
      const tray = job.amsMapping[f.id - 1];
      if (tray === undefined || tray === -1) { reasons.push(`Filament ${f.id} (${f.type}) has no AMS slot`); continue; }
      if (!trays) continue;
      const t = trays.find((x) => x.ams * 4 + x.slot === tray);
      if (!t || t.empty || !t.type) reasons.push(`Filament ${f.id} (${f.type}) is mapped to ${slotLabel(tray)}, which is empty`);
      else if (t.type.toUpperCase() !== f.type.trim().toUpperCase()) {
        reasons.push(`Filament ${f.id} needs ${f.type}, but ${slotLabel(tray)} holds ${t.type}`);
      }
    }
  } else {
    // Without the AMS: one filament, from the external spool (mixed AMS + external jobs are not offered).
    const types = [...new Set(plate.filaments.map((f) => f.type.trim().toUpperCase()))];
    const ext = s?.externalSpool;
    if (plate.filaments.length !== 1) reasons.push("Without the AMS only one filament can print, from the external spool");
    else if (!ext) reasons.push("No external spool is set on the printer");
    else if (ext.type.toUpperCase() !== types[0]) reasons.push(`The external spool holds ${ext.type}; the file needs ${plate.filaments[0].type}`);
  }
  if (warnings.length && !job.warningsChecked) reasons.push("Check the warnings and tick \"I checked this\"");
  return { ok: reasons.length === 0, reasons, warnings };
}

// ---------- names on the SD card ----------

/** Our rule for files we upload to the SD root: ASCII, no spaces, at most 72 characters, ends .gcode.3mf. */
export const SD_FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,60}\.gcode\.3mf$/;

/** "ORD-012_p1_1792072000.gcode.3mf": unique and safe on the printer. */
export function sdFileName(prefix: string, plate: number, unixSec: number): string {
  const safe = prefix.replace(/[^A-Za-z0-9-]/g, "").slice(0, 24) || "JOB";
  return `${safe}_p${plate}_${Math.trunc(unixSec)}.gcode.3mf`;
}

/** The name the printer shows for the job: ASCII, with the order code so reports can be matched to the order. */
export function subtaskName(orderId: string | undefined, product: string | undefined): string {
  const words = (product ?? "").normalize("NFKD").replace(/[^\x20-\x7E]/g, "").replace(/[^A-Za-z0-9 ._-]/g, " ").replace(/\s+/g, " ").trim();
  return [orderId, words].filter(Boolean).join(" ").slice(0, 60) || "Kesuni print";
}

// ---------- MQTT messages (published to device/<serial>/request) ----------

/** Kinds the bridge may publish. Anything else is refused, whatever the app asks. */
export type MqttKind = Exclude<PrinterCommandKind, "camera_snapshot"> | "start_print" | "pushall";
export const MQTT_KINDS: readonly MqttKind[] = ["pause", "resume", "stop", "speed", "light", "get_version", "start_print", "pushall"];

export interface StartParams {
  plate: number;
  fileName: string;         // in the SD root, SD_FILE_NAME
  subtaskName: string;
  amsMapping: number[];
  options: PrintOptions;
  /** A1: "sdcard" (file:///sdcard/<name>, 5 sources). "ftp" (ftp:///<name>) is the fallback if nothing starts. */
  urlForm?: "sdcard" | "ftp";
}

export interface MqttMessage { payload: Record<string, unknown>; qos: 0 | 1 }

/**
 * The exact message for one control (spec §4). sequenceId is the bridge's counter as a string (start at 50000; avoid
 * 20000–29999, Bambu Studio's range). Throws for anything not on the list or with bad parameters.
 */
export function buildMqttPayload(kind: MqttKind, params: Record<string, unknown>, sequenceId: string): MqttMessage {
  if (!/^\d{1,9}$/.test(sequenceId)) throw new Error("sequenceId must be a number as a string");
  switch (kind) {
    case "pause":
    case "resume":
    case "stop":
      return { payload: { print: { sequence_id: sequenceId, command: kind, param: "" } }, qos: 1 };
    case "speed": {
      const level = params.level;
      if (![1, 2, 3, 4].includes(level as number)) throw new Error("speed level must be 1, 2, 3 or 4");
      return { payload: { print: { sequence_id: sequenceId, command: "print_speed", param: String(level) } }, qos: 1 };
    }
    case "light":
      if (typeof params.on !== "boolean") throw new Error("light needs on: true or false");
      // All four timing keys must be present; an A1 has only chamber_light.
      return {
        payload: { system: { sequence_id: sequenceId, command: "ledctrl", led_node: "chamber_light", led_mode: params.on ? "on" : "off",
          led_on_time: 500, led_off_time: 500, loop_times: 0, interval_time: 0 } },
        qos: 1,
      };
    case "get_version":
      return { payload: { info: { sequence_id: "0", command: "get_version" } }, qos: 0 };
    case "pushall":
      return { payload: { pushing: { sequence_id: "0", command: "pushall", version: 1, push_target: 1 } }, qos: 0 };
    case "start_print": {
      const p = params as unknown as StartParams;
      if (!Number.isInteger(p.plate) || p.plate < 1 || p.plate > 64) throw new Error("plate must be 1 to 64");
      if (typeof p.fileName !== "string" || !SD_FILE_NAME.test(p.fileName)) throw new Error("file name is not a safe SD-card name");
      if (!Array.isArray(p.amsMapping) || p.amsMapping.some((v) => !Number.isInteger(v) || v < -1 || v > 15)) throw new Error("bad AMS mapping");
      const o = p.options ?? ({} as PrintOptions);
      const useAms = o.useAms !== false;
      const level = o.bedLevelling !== false;
      return {
        payload: {
          print: {
            sequence_id: sequenceId, command: "project_file", param: `Metadata/plate_${p.plate}.gcode`,
            url: p.urlForm === "ftp" ? `ftp:///${p.fileName}` : `file:///sdcard/${p.fileName}`,
            file: "", md5: "", subtask_name: String(p.subtaskName ?? "").replace(/[^\x20-\x7E]/g, "").slice(0, 60) || "Kesuni print",
            project_id: "0", profile_id: "0", task_id: "0", subtask_id: "0", bed_type: "auto",
            timelapse: o.timelapse === true,
            // Sources spell it both ways; unknown keys are ignored, so both are sent with the same value.
            bed_leveling: level, bed_levelling: level,
            flow_cali: o.flowCali !== false, vibration_cali: false, layer_inspect: true,
            use_ams: useAms, ...(useAms ? { ams_mapping: p.amsMapping } : {}),
          },
        },
        qos: 1,
      };
    }
    default:
      throw new Error(`${String(kind)} is not an allowed printer command`);
  }
}

/**
 * A reply to one of our commands: {"print"|"system"|"info": {command, sequence_id, result, reason, err_code?}}. Null for
 * anything else. A non-zero err_code (Bambu Studio reads it too) is a refusal even without result "fail"; errCode then
 * holds it as "0500-4004" so the person sees which device error it was.
 */
export function parseReply(message: unknown):
  { type: string; command: string; sequenceId: string; ok: boolean | null; reason: string; errCode?: string } | null {
  if (!message || typeof message !== "object") return null;
  for (const type of ["print", "system", "info"]) {
    const body = (message as Record<string, unknown>)[type] as Record<string, unknown> | undefined;
    if (!body || typeof body !== "object" || typeof body.command !== "string" || body.command === "push_status") continue;
    const result = typeof body.result === "string" ? body.result.toLowerCase() : null;
    const err = typeof body.err_code === "number" && Number.isFinite(body.err_code) && body.err_code !== 0 ? body.err_code : null;
    return {
      type, command: body.command, sequenceId: String(body.sequence_id ?? ""),
      ok: err !== null ? false : result === "success" ? true : result === "fail" || result === "failed" ? false : null,
      reason: typeof body.reason === "string" ? body.reason.slice(0, 200) : "",
      ...(err !== null ? { errCode: errText(err) } : {}),
    };
  }
  return null;
}
