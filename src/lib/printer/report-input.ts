// What the LAN bridge may send to /api/printers/report, checked field by field. The bridge holds a token, but its body
// is still input: every string is cut short, every list is capped, and anything of the wrong shape is dropped. Older
// bridges send the short snapshot (no stage, AMS, HMS ...): those fields simply stay missing.
import {
  EVENT_KINDS, PRINTER_STATES, SPEED_LEVELS, type AmsTray, type HmsMessage, type PrinterEvent, type PrinterEventKind,
  type PrinterIssue, type PrinterSnapshot, type PrinterState, type SpeedLevel,
} from "./bambu";

type Raw = Record<string, unknown>;
const obj = (v: unknown): Raw | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Raw) : null);
const n = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const s = (v: unknown, max = 120): string | null => (typeof v === "string" ? v.slice(0, max) : null);
const b = (v: unknown): boolean | null => (typeof v === "boolean" ? v : null);
const HEX = /^#[0-9A-F]{6}$/;
const hex = (v: unknown): string | null => (typeof v === "string" && HEX.test(v) ? v : null);
const URL_OK = /^https:\/\/(e\.bambulab\.com|wiki\.bambulab\.com)\//;
const url = (v: unknown): string => (typeof v === "string" && URL_OK.test(v) ? v.slice(0, 200) : "https://wiki.bambulab.com/en/hms/home");
const isoOrNull = (v: unknown): string | null => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? v.slice(0, 40) : null);
const has = (o: Raw, k: string) => Object.prototype.hasOwnProperty.call(o, k);

function readHms(v: unknown): HmsMessage[] | undefined {
  if (!Array.isArray(v)) return undefined;
  return v.slice(0, 32).map(obj).filter((h): h is Raw => Boolean(h && typeof h.code === "string" && /^HMS_[0-9A-F]{4}(_[0-9A-F]{4}){3}$/.test(h.code)))
    .map((h) => ({ code: h.code as string, severity: n(h.severity) ?? 0, url: url(h.url), since: isoOrNull(h.since) }));
}

function readTray(v: unknown): AmsTray | null {
  const t = obj(v);
  if (!t || n(t.ams) === null || n(t.slot) === null) return null;
  const ams = Math.trunc(n(t.ams)!), slot = Math.trunc(n(t.slot)!);
  if (ams < 0 || ams > 3 || slot < 0 || slot > 3) return null;
  const remain = n(t.remainPct);
  return {
    ams, slot, empty: t.empty === true, type: s(t.type, 24), subBrand: s(t.subBrand, 60), infoIdx: s(t.infoIdx, 16),
    color: hex(t.color), colors: Array.isArray(t.colors) ? t.colors.slice(0, 8).map(hex).filter((c): c is string => Boolean(c)) : [],
    remainPct: remain === null ? null : Math.max(0, Math.min(100, remain)), bambu: t.bambu === true,
  };
}

function readAms(v: unknown): PrinterSnapshot["ams"] | undefined {
  if (v === null) return null;
  const a = obj(v);
  if (!a || !Array.isArray(a.trays)) return undefined;
  const slot = n(a.activeSlot);
  return {
    trays: a.trays.slice(0, 16).map(readTray).filter((t): t is AmsTray => Boolean(t)),
    activeSlot: slot !== null && slot >= 0 && slot < 16 ? Math.trunc(slot) : null,
    externalActive: a.externalActive === true, humidity: n(a.humidity), lite: a.lite !== false,
  };
}

/** The snapshot the bridge sent, or null when its required part is missing. */
export function readSnapshot(v: unknown): PrinterSnapshot | null {
  const x = obj(v);
  if (!x || !(PRINTER_STATES as unknown[]).includes(x.state) || n(x.percent) === null || typeof x.at !== "string") return null;
  const snap: PrinterSnapshot = {
    state: x.state as PrinterState, percent: Math.max(0, Math.min(100, n(x.percent)!)),
    remainingMin: n(x.remainingMin), layer: n(x.layer), totalLayers: n(x.totalLayers),
    jobName: s(x.jobName), errorCode: n(x.errorCode) ?? 0, nozzleTemp: n(x.nozzleTemp), bedTemp: n(x.bedTemp), at: x.at.slice(0, 40),
  };
  const stage = obj(x.stage);
  if (has(x, "stage")) {
    snap.stage = stage && n(stage.code) !== null && typeof stage.key === "string"
      ? { code: Math.trunc(n(stage.code)!), key: stage.key.slice(0, 80), needsPerson: stage.needsPerson === true } : null;
  }
  if (Array.isArray(x.stageList)) snap.stageList = x.stageList.slice(0, 64).filter((i): i is number => Number.isInteger(i));
  if (has(x, "stageCur")) snap.stageCur = n(x.stageCur);
  for (const k of ["prepPercent", "nozzleTarget", "bedTarget", "partFanPct", "hotendFanPct", "speedPct", "wifiDbm"] as const) {
    if (has(x, k)) snap[k] = n(x[k]);
  }
  if (has(x, "speedLevel")) snap.speedLevel = (SPEED_LEVELS as unknown[]).includes(x.speedLevel) ? (x.speedLevel as SpeedLevel) : null;
  if (has(x, "light")) snap.light = x.light === "on" || x.light === "off" || x.light === "flashing" ? x.light : null;
  const hms = readHms(x.hms);
  if (hms) snap.hms = hms;
  const pe = obj(x.printError);
  if (has(x, "printError")) snap.printError = pe && typeof pe.code === "string" ? { code: pe.code.slice(0, 12), url: url(pe.url) } : null;
  const nz = obj(x.nozzle);
  if (nz) snap.nozzle = { diameter: s(nz.diameter, 8), type: s(nz.type, 32) };
  if (has(x, "sdcard")) snap.sdcard = b(x.sdcard);
  if (has(x, "sdAbnormal")) snap.sdAbnormal = x.sdAbnormal === true;
  if (has(x, "fileName")) snap.fileName = s(x.fileName, 200);
  if (has(x, "printType")) snap.printType = s(x.printType, 16);
  const fw = obj(x.firmware);
  if (has(x, "firmware")) snap.firmware = fw ? { product: s(fw.product, 40), ota: s(fw.ota, 24), ams: s(fw.ams, 24) } : null;
  const ams = readAms(x.ams);
  if (ams !== undefined) snap.ams = ams;
  const ext = obj(x.externalSpool);
  if (has(x, "externalSpool")) snap.externalSpool = ext && typeof ext.type === "string" ? { type: ext.type.slice(0, 24), color: hex(ext.color) } : null;
  const cam = obj(x.camera);
  if (has(x, "camera")) snap.camera = cam ? { available: cam.available === true, recording: cam.recording === true, timelapse: cam.timelapse === true } : null;
  return snap;
}

function readIssue(v: unknown): PrinterIssue | undefined {
  const i = obj(v);
  if (!i || (i.kind !== "hms" && i.kind !== "print_error") || typeof i.code !== "string") return undefined;
  return { kind: i.kind, code: i.code.slice(0, 40), severity: n(i.severity), url: url(i.url) };
}

/** The events the bridge detected, or null when the list is malformed. */
export function readEvents(v: unknown): PrinterEvent[] | null {
  if (!Array.isArray(v) || v.length > 40) return null;
  const out: PrinterEvent[] = [];
  for (const raw of v) {
    const e = obj(raw);
    if (!e || !(EVENT_KINDS as unknown[]).includes(e.kind) || n(e.percent) === null || typeof e.at !== "string") return null;
    out.push({
      kind: e.kind as PrinterEventKind, percent: n(e.percent)!, at: e.at.slice(0, 40), jobName: s(e.jobName),
      errorCode: n(e.errorCode) ?? undefined, issue: readIssue(e.issue),
    });
  }
  return out;
}
