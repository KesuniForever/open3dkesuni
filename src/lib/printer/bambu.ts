// Bambu Lab printer reports (LAN MQTT, topic device/<serial>/report) -> a clean snapshot and events.
// Pure functions, no I/O. scripts/printer-bridge.mjs imports this file straight from Node (type stripping), so it has
// no runtime imports and only erasable TypeScript (no enums, no namespaces, no parameter properties).
// Field names and meanings: the protocol spec checked live on our three A1 Combos (15 Oct 2026) against OpenBambuAPI,
// Bambu Studio and pybambu. A1 printers send PARTIAL updates after a full "pushall" (printer #1 sends full reports
// every second), so mergeReport always merges into the previous snapshot: a missing key means "unchanged".
// SD-card file lists are never read here: the snapshot only says whether a card is present.

export type PrinterState = "IDLE" | "PREPARE" | "SLICING" | "RUNNING" | "PAUSE" | "FINISH" | "FAILED" | "INIT" | "UNKNOWN";
export const PRINTER_STATES: readonly PrinterState[] = ["IDLE", "PREPARE", "SLICING", "RUNNING", "PAUSE", "FINISH", "FAILED", "INIT", "UNKNOWN"];
/** A job is on the printer (Bambu Studio's is_in_printing_status, minus cloud slicing). */
export const BUSY_STATES: readonly PrinterState[] = ["PREPARE", "RUNNING", "PAUSE"];

/** Print speed level (spd_lvl). English labels; pages translate them with t(). */
export type SpeedLevel = 1 | 2 | 3 | 4;
export const SPEED_LEVELS: readonly SpeedLevel[] = [1, 2, 3, 4];
export const SPEED_LABEL: Record<SpeedLevel, string> = { 1: "Silent", 2: "Standard", 3: "Sport", 4: "Ludicrous" };

/** HMS severity from the top 16 bits of the code: 1 fatal, 2 serious, 3 common, 4 info. */
export const HMS_SEVERITY: Record<number, "fatal" | "serious" | "common" | "info"> = { 1: "fatal", 2: "serious", 3: "common", 4: "info" };

export interface HmsMessage {
  code: string;           // "HMS_0510_0400_0001_0044", as the Bambu wiki writes it
  severity: number;       // 1 fatal, 2 serious, 3 common, 4 info (0 = unknown)
  url: string;            // Bambu's own link for this code (redirects to the wiki page, or the HMS home page)
  since: string | null;   // when the printer raised it (ISO), if it says
}

/** A fault a person must look at: an HMS message (not info) or a print_error the printer set. */
export interface PrinterIssue {
  kind: "hms" | "print_error";
  code: string;           // "HMS_0510_0400_0001_0044" or "0700-8011"
  severity: number | null; // HMS severity; null for print_error (its state says more: PAUSE needs a person, FAILED ended the job)
  url: string;
}

export interface AmsTray {
  ams: number;            // AMS unit (0: an A1 has one AMS lite)
  slot: number;           // 0..3 (the printer labels them 1..4)
  empty: boolean;
  type: string | null;    // material: "PLA", "PETG"
  subBrand: string | null; // "PLA Basic" on Bambu RFID spools
  infoIdx: string | null; // filament preset: "GFA00" Bambu PLA Basic, "GFL99" Generic PLA, "GFG99" Generic PETG
  color: string | null;   // "#RRGGBB"
  colors: string[];       // several for a multi-colour spool
  remainPct: number | null; // null on AMS lite: it reports 100 for every spool
  bambu: boolean;         // RFID-tagged Bambu spool: material and colour come from the tag, not from a person typing them
}

export interface AmsState {
  trays: AmsTray[];
  /** Global tray in the toolhead (ams*4 + slot), null when none or the external spool. */
  activeSlot: number | null;
  /** The external spool (vt_tray, id 254) is in the toolhead. */
  externalActive: boolean;
  /** Null on AMS lite: it has no humidity sensor (the report holds a constant). */
  humidity: number | null;
  lite: boolean;
}

export interface PrinterSnapshot {
  state: PrinterState;
  percent: number;          // 0..100
  remainingMin: number | null;
  layer: number | null;
  totalLayers: number | null;
  jobName: string | null;   // subtask_name, the job being printed (kept after it ends)
  errorCode: number;        // print_error, 0 = none
  nozzleTemp: number | null;
  bedTemp: number | null;
  at: string;               // ISO time of the last report
  // ----- added 15 Oct 2026. Optional: snapshots saved earlier, and older bridges, do not have them. -----
  /** What the printer is doing now. Only while a job is on it (PREPARE/RUNNING/PAUSE); null when idle. */
  stage?: { code: number; key: string; needsPerson: boolean } | null;
  stageList?: number[];     // stg: the planned stages of this job
  stageCur?: number | null; // stg_cur as reported (0 or 255 when idle: never show it raw)
  prepPercent?: number | null; // gcode_file_prepare_percent, while preparing
  nozzleTarget?: number | null;
  bedTarget?: number | null;
  partFanPct?: number | null;   // part-cooling fan 0..100 (steps of 10)
  hotendFanPct?: number | null; // heatbreak fan 0..100
  speedLevel?: SpeedLevel | null;
  speedPct?: number | null;
  light?: "on" | "off" | "flashing" | null; // chamber_light: the only light an A1 has
  hms?: HmsMessage[];       // active health messages, all severities
  printError?: { code: string; url: string } | null; // errorCode as text; null when 0
  nozzle?: { diameter: string | null; type: string | null };
  wifiDbm?: number | null;
  sdcard?: boolean | null;  // a microSD card is in (printing needs one). Never a file list.
  sdAbnormal?: boolean;
  fileName?: string | null; // gcode_file
  printType?: string | null; // idle, local, cloud
  firmware?: { product: string | null; ota: string | null; ams: string | null } | null;
  ams?: AmsState | null;
  externalSpool?: { type: string; color: string | null } | null;
  camera?: { available: boolean; recording: boolean; timelapse: boolean } | null;
}

export type PrinterEventKind =
  | "started"          // a new print began
  | "progress"         // crossed 25 / 50 / 75 %
  | "needs_operator"   // paused with an error (often filament runout): a person must act
  | "resumed"
  | "finished"         // print complete: someone must collect it and do QC
  | "failed"           // print failed or was cancelled
  | "error"            // a new HMS message (not info) or print_error appeared
  | "error_cleared";   // the printer no longer reports it

export const EVENT_KINDS: readonly PrinterEventKind[] = ["started", "progress", "needs_operator", "resumed", "finished", "failed", "error", "error_cleared"];

export interface PrinterEvent {
  kind: PrinterEventKind;
  percent: number;
  jobName: string | null;
  errorCode?: number;
  /** For error / error_cleared. */
  issue?: PrinterIssue;
  at: string;
}

// ---------- stages (stg_cur): "what it is doing now". Texts from Bambu Studio get_stage_string(). ----------

/** English labels. Pages show them with t(stage.key, { n: stage.code }). */
export const STAGES: Readonly<Record<number, string>> = {
  0: "Printing", 1: "Auto bed leveling", 2: "Heatbed preheating", 3: "Vibration compensation", 4: "Changing filament",
  5: "M400 pause", 6: "Paused (filament ran out)", 7: "Heating nozzle", 8: "Calibrating dynamic flow", 9: "Scanning bed surface",
  10: "Inspecting first layer", 11: "Identifying build plate type", 12: "Calibrating Micro Lidar", 13: "Homing toolhead",
  14: "Cleaning nozzle tip", 15: "Checking extruder temperature", 16: "Paused by the user", 17: "Pause (front cover fall off)",
  18: "Calibrating the micro lidar", 19: "Calibrating flow ratio", 20: "Pause (nozzle temperature malfunction)",
  21: "Pause (heatbed temperature malfunction)", 22: "Filament unloading", 23: "Pause (step loss)", 24: "Filament loading",
  25: "Motor noise cancellation", 26: "Pause (AMS offline)", 27: "Pause (low speed of the heatbreak fan)",
  28: "Pause (chamber temperature control problem)", 29: "Cooling chamber", 30: "Pause (G-code inserted by user)",
  31: "Motor noise showoff", 32: "Pause (nozzle clumping)", 33: "Pause (cutter error)", 34: "Pause (first layer error)",
  35: "Pause (nozzle clog)", 36: "Measuring motion precision", 37: "Enhancing motion precision", 38: "Measuring motion accuracy",
  39: "Nozzle offset calibration", 40: "High-temperature auto bed leveling", 41: "Auto check: quick release lever",
  42: "Auto check: door and upper cover", 43: "Laser calibration", 44: "Auto check: platform",
  45: "Confirming BirdsEye camera location", 46: "Calibrating BirdsEye camera", 47: "Auto bed leveling: phase 1",
  48: "Auto bed leveling: phase 2", 49: "Heating chamber", 50: "Adjusting heatbed temperature", 51: "Printing calibration lines",
  52: "Auto check: material", 53: "Live View camera calibration", 54: "Waiting for heatbed to reach target temperature",
  55: "Auto check: material position", 56: "Cutting module offset calibration", 57: "Measuring surface",
  58: "Thermal preconditioning for first layer", 63: "Waiting for the chamber temperature to equalize", 64: "Preparing hotend",
  65: "Calibrating the nozzle clumping detection", 66: "Purifying the chamber air", 67: "Measuring rotary attachment",
  68: "Moving the toolhead above the purge chute", 69: "Cooling down the nozzle", 70: "Moving the toolhead to the bed centre",
  71: "Active arc fitting", 72: "Hotend type detection", 73: "Build plate alignment detection",
  74: "Heatbed surface foreign object detection", 75: "Heatbed underside foreign object detection",
  76: "Pre-extrusion before printing", 77: "Preparing AMS",
};
/** Pauses that need a person at the printer: show them loudly. */
export const NEEDS_PERSON_STAGES: readonly number[] = [5, 6, 16, 17, 20, 21, 23, 26, 27, 28, 30, 32, 33, 34, 35];
/** Stage keys that are not a Bambu stage id. */
export const STAGE_PREPARING = "Preparing";
export const STAGE_PAUSED = "Paused";
export const STAGE_UNKNOWN = "Working (stage {n})";

/**
 * The stage to show, or null when idle. An idle A1 reports stg_cur 0 or 255, so a stage counts only while a job is on
 * the printer and its stage list is not empty (as Bambu Studio does).
 */
export function stageOf(state: PrinterState, list: number[], cur: number | null, errorCode = 0): PrinterSnapshot["stage"] {
  if (!BUSY_STATES.includes(state)) return null;
  const known = cur !== null && cur >= 0 && cur < 255 && list.length > 0;
  if (state === "PAUSE") {
    if (known && NEEDS_PERSON_STAGES.includes(cur!)) return { code: cur!, key: STAGES[cur!], needsPerson: true };
    return { code: known ? cur! : -1, key: STAGE_PAUSED, needsPerson: errorCode !== 0 };
  }
  if (!known) return state === "PREPARE" ? { code: -1, key: STAGE_PREPARING, needsPerson: false } : { code: 0, key: STAGES[0], needsPerson: false };
  return { code: cur!, key: STAGES[cur!] ?? STAGE_UNKNOWN, needsPerson: NEEDS_PERSON_STAGES.includes(cur!) };
}

// ---------- errors: HMS and print_error ----------

const hex8 = (n: number) => (n >>> 0).toString(16).toUpperCase().padStart(8, "0");
/** Bambu's link for an HMS code, the same one Bambu Studio opens (d=039 is the A1). */
export const hmsUrl = (code16: string, lang = "en") => `https://e.bambulab.com/index.php?e=${code16}&d=039&s=device_hms&lang=${lang}`;
/** print_error codes have no page of their own. */
export const PRINT_ERROR_URL = "https://wiki.bambulab.com/en/hms/home";
/** print_error values that are normal: the job was cancelled by a person, or paused by a person. */
export const BENIGN_PRINT_ERRORS: readonly number[] = [0x0300400c, 0x0500400e, 0x03008001];
/**
 * Bambu's internal device errors: in the official A1 table with an empty text. Bambu Studio hides them
 * (is_internal_error), so they are no fault here either. Same list as "internal" in bambu-errors.json (a test checks).
 */
export const INTERNAL_PRINT_ERRORS: readonly number[] = [
  0x05008030, 0x0500c011, 0x05024007, 0x05024008, 0x05024009, 0x0502400a, 0x0502400b, 0x0502400c, 0x05024012,
];
/** A print_error a person must look at: set, not a person's pause or stop, not one of Bambu's internal codes. */
export const isFaultPrintError = (code: number): boolean =>
  code !== 0 && !BENIGN_PRINT_ERRORS.includes(code >>> 0) && !INTERNAL_PRINT_ERRORS.includes(code >>> 0);

/** HMS attr + code -> "HMS_0510_0400_0001_0044" and its severity. */
export function hmsCode(attr: number, code: number): { code: string; code16: string; severity: number } {
  const code16 = hex8(attr) + hex8(code);
  return { code: `HMS_${code16.match(/.{4}/g)!.join("_")}`, code16, severity: code >>> 16 };
}
/** "HMS_0510_0400_0001_0044" -> "0510040000010044" (the key in Bambu's message table). */
export const hmsKey = (code: string) => code.replace(/^HMS_/, "").replace(/_/g, "");

/** print_error as the hex code Bambu shows in its app/wiki, e.g. 0x07008011 -> "0700-8011". */
export function errorCodeText(code: number): string {
  const hex = hex8(code);
  return `${hex.slice(0, 4)}-${hex.slice(4)}`;
}

/** The faults to show loudly and to raise as operator tasks: HMS messages except info, and a print_error that is a fault. */
export function activeIssues(s: Pick<PrinterSnapshot, "hms" | "errorCode">): PrinterIssue[] {
  const out: PrinterIssue[] = (s.hms ?? [])
    .filter((h) => h.severity !== 4)
    .map((h) => ({ kind: "hms", code: h.code, severity: h.severity, url: h.url }));
  if (s.errorCode && isFaultPrintError(s.errorCode)) {
    out.push({ kind: "print_error", code: errorCodeText(s.errorCode), severity: null, url: PRINT_ERROR_URL });
  }
  return out;
}

// ---------- merging reports ----------

type Raw = Record<string, unknown>;
const obj = (v: unknown): Raw | undefined => (v && typeof v === "object" && !Array.isArray(v) ? (v as Raw) : undefined);
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
/** Bambu sends some numbers as strings ("0", "-65dBm", "1002"). */
const numLike = (v: unknown): number | undefined => {
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v !== "string" || !v.trim()) return undefined;
  const n = Number.parseFloat(v);
  return Number.isFinite(n) ? n : undefined;
};
const int = (v: unknown): number | undefined => {
  const n = numLike(v);
  return n === undefined ? undefined : Math.trunc(n);
};
const text = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const has = (o: Raw, k: string) => Object.prototype.hasOwnProperty.call(o, k);
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/** Raw fan speed 0..15 -> percent in steps of 10 (Bambu Studio DevFan). */
export const fanPct = (raw: number): number => clamp(Math.floor(raw / 1.5) * 10, 0, 100);

/** "FEC600FF" (RRGGBBAA) -> "#FEC600". Null for a missing or fully transparent colour. */
export function trayHex(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  if (!/^[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(s)) return null;
  if (s.length === 8 && s.slice(6).toLowerCase() === "00" && s.slice(0, 6) === "000000") return null;
  return `#${s.slice(0, 6).toUpperCase()}`;
}

export function emptySnapshot(at: string): PrinterSnapshot {
  return { state: "UNKNOWN", percent: 0, remainingMin: null, layer: null, totalLayers: null,
    jobName: null, errorCode: 0, nozzleTemp: null, bedTemp: null, at };
}

function readHms(v: unknown[]): HmsMessage[] {
  const out: HmsMessage[] = [];
  for (const raw of v.slice(0, 32)) {
    const h = obj(raw);
    const attr = num(h?.attr), code = num(h?.code);
    if (attr === undefined || code === undefined) continue;
    const c = hmsCode(attr, code);
    const ts = num(h?.timestamp);
    out.push({ code: c.code, severity: c.severity, url: hmsUrl(c.code16), since: ts && ts > 1e9 ? new Date(ts * 1000).toISOString() : null });
  }
  return out;
}

function readFirmware(modules: unknown): PrinterSnapshot["firmware"] | undefined {
  if (!Array.isArray(modules)) return undefined;
  const mods = modules.map(obj).filter((m): m is Raw => Boolean(m));
  const ota = mods.find((m) => m.name === "ota");
  const ams = mods.find((m) => typeof m.name === "string" && m.name.startsWith("ams"));
  // Module serial numbers ("sn") are never kept.
  return { product: text(ota?.product_name) ?? null, ota: text(ota?.sw_ver) ?? null, ams: text(ams?.sw_ver) ?? null };
}

/** One tray: a delta holds only the changed fields; {"id": "1"} alone means the slot is empty. */
function mergeTray(prev: AmsTray | undefined, t: Raw, ams: number, slot: number, lite: boolean): AmsTray {
  if (Object.keys(t).length <= 1) {
    return { ams, slot, empty: true, type: null, subBrand: null, infoIdx: null, color: null, colors: [], remainPct: null, bambu: false };
  }
  const p = prev && !prev.empty ? prev : undefined;
  const pick = <K extends keyof AmsTray>(key: string, field: K, read: (v: unknown) => AmsTray[K]): AmsTray[K] =>
    has(t, key) ? read(t[key]) : (p?.[field] ?? (null as AmsTray[K]));
  const type = pick("tray_type", "type", (v) => text(v)?.toUpperCase() ?? null);
  const color = pick("tray_color", "color", trayHex);
  const cols = has(t, "cols") && Array.isArray(t.cols)
    ? t.cols.slice(0, 8).map(trayHex).filter((c): c is string => Boolean(c))
    : p?.colors ?? [];
  const remain = has(t, "remain") ? num(t.remain) : p?.remainPct ?? undefined;
  return {
    ams, slot, empty: !type, type,
    subBrand: pick("tray_sub_brands", "subBrand", (v) => text(v) ?? null),
    infoIdx: pick("tray_info_idx", "infoIdx", (v) => text(v) ?? null),
    color, colors: cols.length ? cols : color ? [color] : [],
    remainPct: lite || remain === undefined || remain < 0 ? null : clamp(remain, 0, 100),
    // Only RFID-tagged Bambu spools carry a sub-brand ("PLA Basic") and a tray id name ("A00-Y2"). tray_is_bbl_bits is
    // set for generic spools too on our A1s, so it is not used.
    bambu: has(t, "tray_sub_brands") || has(t, "tray_id_name") ? Boolean(text(t.tray_sub_brands) || text(t.tray_id_name)) : p?.bambu ?? false,
  };
}

/** Bit n of a hex string ("d" = slots 0, 2 and 3). */
const bit = (hex: unknown, n: number): boolean | undefined => {
  if (typeof hex !== "string" || !/^[0-9a-fA-F]{1,8}$/.test(hex)) return undefined;
  return ((Number.parseInt(hex, 16) >>> n) & 1) === 1;
};

function mergeAms(prev: AmsState | null | undefined, raw: Raw): AmsState {
  const byIndex = new Map((prev?.trays ?? []).map((t) => [t.ams * 4 + t.slot, t]));
  let lite = prev?.lite ?? true;
  let humidity = prev?.humidity ?? null;
  for (const unitRaw of Array.isArray(raw.ams) ? raw.ams.slice(0, 4) : []) {
    const unit = obj(unitRaw);
    const amsId = int(unit?.id);
    if (!unit || amsId === undefined || amsId < 0 || amsId > 3) continue;
    if (typeof unit.info === "string" && /^[0-9a-fA-F]+$/.test(unit.info)) lite = (Number.parseInt(unit.info, 16) & 0xf) === 2;
    if (has(unit, "humidity")) humidity = lite ? null : int(unit.humidity) ?? null;
    for (const trayRaw of Array.isArray(unit.tray) ? unit.tray.slice(0, 4) : []) {
      const t = obj(trayRaw);
      const slot = int(t?.id);
      if (!t || slot === undefined || slot < 0 || slot > 3) continue;
      byIndex.set(amsId * 4 + slot, mergeTray(byIndex.get(amsId * 4 + slot), t, amsId, slot, lite));
    }
  }
  // tray_exist_bits: bit n = a spool is in global slot n.
  const trays = [...byIndex.entries()].sort((a, b) => a[0] - b[0])
    .map(([i, t]) => (bit(raw.tray_exist_bits, i) === false && !t.empty ? { ...t, empty: true, bambu: false } : t));
  let activeSlot = prev?.activeSlot ?? null;
  let externalActive = prev?.externalActive ?? false;
  if (has(raw, "tray_now")) {
    const now = int(raw.tray_now);
    externalActive = now === 254;
    activeSlot = now !== undefined && now >= 0 && now < 16 ? now : null;
  }
  return { trays, activeSlot, externalActive, humidity: lite ? null : humidity, lite };
}

/**
 * Merge one MQTT message into the previous snapshot. A push_status report, or the get_version reply (firmware only).
 * Returns undefined for anything else, including replies to commands.
 */
export function mergeReport(prev: PrinterSnapshot | undefined, message: unknown, at: string): PrinterSnapshot | undefined {
  const m = obj(message);
  const info = obj(m?.info);
  if (info?.command === "get_version") {
    const firmware = readFirmware(info.module);
    return firmware ? { ...(prev ?? emptySnapshot(at)), firmware, at } : undefined;
  }
  const p = obj(m?.print);
  if (!p) return undefined;
  if (typeof p.command === "string" && p.command !== "push_status") return undefined; // a reply, not a status report
  const base = prev ?? emptySnapshot(at);
  const state = text(p.gcode_state)?.toUpperCase();
  const percent = numLike(p.mc_percent);
  const next: PrinterSnapshot = {
    ...base,
    state: state && (PRINTER_STATES as string[]).includes(state) ? (state as PrinterState) : base.state,
    percent: percent !== undefined ? clamp(percent, 0, 100) : base.percent,
    remainingMin: numLike(p.mc_remaining_time) ?? base.remainingMin,
    layer: numLike(p.layer_num) ?? base.layer,
    totalLayers: numLike(p.total_layer_num) ?? base.totalLayers,
    jobName: text(p.subtask_name) ?? base.jobName,
    errorCode: num(p.print_error) ?? base.errorCode,
    nozzleTemp: num(p.nozzle_temper) ?? base.nozzleTemp,
    bedTemp: num(p.bed_temper) ?? base.bedTemp,
    at,
  };
  next.stageList = Array.isArray(p.stg) ? p.stg.slice(0, 64).filter((x): x is number => Number.isInteger(x)) : base.stageList ?? [];
  next.stageCur = has(p, "stg_cur") ? int(p.stg_cur) ?? null : base.stageCur ?? null;
  next.stage = stageOf(next.state, next.stageList, next.stageCur, next.errorCode);
  if (has(p, "gcode_file_prepare_percent")) next.prepPercent = int(p.gcode_file_prepare_percent) ?? null;
  if (has(p, "nozzle_target_temper")) next.nozzleTarget = num(p.nozzle_target_temper) ?? null;
  if (has(p, "bed_target_temper")) next.bedTarget = num(p.bed_target_temper) ?? null;
  if (has(p, "cooling_fan_speed")) next.partFanPct = int(p.cooling_fan_speed) !== undefined ? fanPct(int(p.cooling_fan_speed)!) : null;
  if (has(p, "heatbreak_fan_speed")) next.hotendFanPct = int(p.heatbreak_fan_speed) !== undefined ? fanPct(int(p.heatbreak_fan_speed)!) : null;
  if (has(p, "spd_lvl")) {
    const lvl = int(p.spd_lvl);
    next.speedLevel = lvl !== undefined && lvl >= 1 && lvl <= 4 ? (lvl as SpeedLevel) : null;
  }
  if (has(p, "spd_mag")) next.speedPct = int(p.spd_mag) ?? null;
  // Arrays that arrive whole: replace, never merge.
  if (Array.isArray(p.lights_report)) {
    const lights = p.lights_report.map(obj);
    const mode = (lights.find((l) => l?.node === "chamber_light") ?? lights[0])?.mode;
    next.light = mode === "on" || mode === "off" || mode === "flashing" ? mode : null;
  }
  if (Array.isArray(p.hms)) next.hms = readHms(p.hms);
  next.printError = next.errorCode ? { code: errorCodeText(next.errorCode), url: PRINT_ERROR_URL } : null;
  if (has(p, "nozzle_diameter") || has(p, "nozzle_type")) {
    next.nozzle = {
      diameter: has(p, "nozzle_diameter") ? text(String(p.nozzle_diameter ?? "")) ?? null : base.nozzle?.diameter ?? null,
      type: has(p, "nozzle_type") ? text(p.nozzle_type) ?? null : base.nozzle?.type ?? null,
    };
  }
  if (has(p, "wifi_signal")) next.wifiDbm = int(p.wifi_signal) ?? null;
  if (typeof p.sdcard === "boolean") next.sdcard = p.sdcard;
  if (num(p.home_flag) !== undefined) {
    const flag = num(p.home_flag)!;
    next.sdAbnormal = (flag & 0x200) !== 0;
    if (next.sdcard === undefined) next.sdcard = (flag & 0x100) !== 0;
  }
  if (has(p, "gcode_file")) next.fileName = text(p.gcode_file) ?? null;
  if (has(p, "print_type")) next.printType = text(p.print_type) ?? null;
  const ams = obj(p.ams);
  if (ams) next.ams = mergeAms(base.ams, ams);
  const vt = obj(p.vt_tray);
  if (vt) {
    const type = has(vt, "tray_type") ? text(vt.tray_type)?.toUpperCase() : base.externalSpool?.type;
    const color = has(vt, "tray_color") ? trayHex(vt.tray_color) : base.externalSpool?.color ?? null;
    next.externalSpool = type ? { type, color } : null;
  }
  const cam = obj(p.ipcam);
  if (cam) {
    next.camera = {
      available: has(cam, "ipcam_dev") ? cam.ipcam_dev === "1" || cam.ipcam_dev === 1 : base.camera?.available ?? false,
      recording: has(cam, "ipcam_record") ? cam.ipcam_record === "enable" : base.camera?.recording ?? false,
      timelapse: has(cam, "timelapse") ? cam.timelapse === "enable" : base.camera?.timelapse ?? false,
    };
  }
  return next;
}

// ---------- events ----------

const ACTIVE: PrinterState[] = ["PREPARE", "RUNNING"];
const MILESTONES = [25, 50, 75];

/**
 * What happened between two snapshots. State events ignore the first snapshot (we don't know what came before);
 * faults do not: a printer that connects with a fault already showing raises it (printer #3's AMS firmware HMS).
 */
export function detectEvents(prev: PrinterSnapshot | undefined, next: PrinterSnapshot): PrinterEvent[] {
  const ev = (kind: PrinterEventKind, extra: Partial<PrinterEvent> = {}): PrinterEvent =>
    ({ kind, percent: next.percent, jobName: next.jobName, at: next.at, ...extra });
  const out: PrinterEvent[] = [];
  const known = Boolean(prev && prev.state !== "UNKNOWN");
  if (known && prev) {
    const wasActive = ACTIVE.includes(prev.state) || prev.state === "PAUSE";
    const isActive = ACTIVE.includes(next.state);
    if (!wasActive && isActive) out.push(ev("started"));
    if (prev.state === "PAUSE" && isActive) out.push(ev("resumed"));
    if (next.state === "PAUSE" && prev.state !== "PAUSE") out.push(ev("needs_operator", { errorCode: next.errorCode }));
    // A print the reports never showed running still ended (bridge or app down, MQTT link lost): IDLE -> FINISH, or a
    // finished/failed printer that now names another job. The part is on the bed all the same.
    const otherJob = Boolean(prev.jobName && next.jobName && prev.jobName !== next.jobName);
    if (next.state === "FINISH" && (prev.state !== "FINISH" || otherJob)) out.push(ev("finished", { percent: 100 }));
    if (next.state === "FAILED" && (prev.state !== "FAILED" || otherJob)) out.push(ev("failed", { errorCode: next.errorCode }));
    if (next.state === "RUNNING") {
      for (const m of MILESTONES) if (prev.percent < m && next.percent >= m) out.push(ev("progress", { percent: m }));
    }
  }
  const before = prev ? activeIssues(prev) : [];
  const now = activeIssues(next);
  for (const issue of now) if (!before.some((b) => b.code === issue.code)) out.push(ev("error", { issue }));
  // An older snapshot without the hms list cannot tell whether an HMS cleared.
  for (const issue of before) {
    if (issue.kind === "hms" && !next.hms) continue;
    if (!now.some((n) => n.code === issue.code)) out.push(ev("error_cleared", { issue }));
  }
  return out;
}
