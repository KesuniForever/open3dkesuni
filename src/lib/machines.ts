// "My machines" page: turn the printers the LAN bridge reports (store.listPrinters / GET /api/printers)
// into what one machine card shows. Pure functions with no store access, so the page's client component
// can re-shape every poll in the browser. Readings are only what the Bambu A1 reports over LAN MQTT.
import type { OperatorTask, Printer } from "./types";
import { activeIssues, BENIGN_PRINT_ERRORS, errorCodeText, type PrinterSnapshot, type PrinterState } from "./printer/bambu";
import { makeT, type T, type Vars } from "../i18n/core";

/** English, for callers that pass no translator (tests, the agent). The page passes its own t for Indonesian. */
const EN: T = makeT("en", {});

/** A text to show, as a dictionary key plus its values, so a page can render it in the visitor's language. */
export type Msg = { key: string; vars?: Vars };

/** No report for this long = offline. Same window as notReadyReason in printer/actions.ts (STALE_MS). */
export const ONLINE_MS = 2 * 60 * 1000;
/** ingestReport writes this in bedOccupiedBy when a print ended that no order was linked to. */
export const NO_ORDER_PRINT = "a print without an order";

const ACTIVE: PrinterState[] = ["PREPARE", "RUNNING", "PAUSE"];
const PRINTER_TASKS: OperatorTask["kind"][] = ["check_printer", "change_filament"];

export type Tone = "ok" | "busy" | "warn" | "bad" | "idle";

export interface MachineView {
  id: string;
  name: string;
  online: boolean;
  /** "12 s ago", "5 min ago", or "never". */
  lastReport: string;
  lastSeen: string | null;
  state: PrinterState | null;
  pill: { tone: Tone; text: string };
  /** Only while a print is running, preparing or paused. */
  progress: { percent: number; paused: boolean } | null;
  nozzle: string;
  bed: string;
  layer: string;
  remaining: string;
  /** The file being printed, or the last file while not printing. */
  job: { name: string; current: boolean } | null;
  errorCode: string | null;
  orderId: string | null;
  /** The bed still holds a part (the printer cannot see its bed: a person confirms it is empty). */
  bedHolds: { orderId: string | null } | null;
  /** Why the agent would not pick this printer for a new job, or null when it is ready. */
  notReady: string | null;
}

export function isOnline(p: Printer, now: number): boolean {
  return Boolean(p.lastSeen) && now - Date.parse(p.lastSeen!) <= ONLINE_MS;
}

/** A fault that blocks printing: a fatal or serious HMS message, or a device error (same rule as printer/actions.ts). */
export function blockingFaultCode(s: Pick<PrinterSnapshot, "hms" | "errorCode"> | undefined): string | null {
  return (s ? activeIssues(s) : []).find((i) => i.kind === "print_error" || i.severity === 1 || i.severity === 2)?.code ?? null;
}

/** Same rules and words as notReadyReason in printer/actions.ts (that module needs the store, so it cannot run in the browser). */
export function notReadyMsg(p: Printer, now: number): Msg | null {
  if (!isOnline(p, now)) return { key: "offline (no report in the last 2 min)" };
  const fault = blockingFaultCode(p.snapshot);
  if (fault) return { key: "printer error {code}", vars: { code: fault } };
  if (p.currentOrderId) return { key: "busy with {id}", vars: { id: p.currentOrderId } };
  if (p.bedOccupiedBy) {
    return p.bedOccupiedBy === NO_ORDER_PRINT
      ? { key: "bed still holds the part of a print without an order" }
      : { key: "bed still holds the part of {id}", vars: { id: p.bedOccupiedBy } };
  }
  const s = p.snapshot?.state;
  if (s && !["IDLE", "FINISH"].includes(s)) return { key: "printer state is {state}", vars: { state: s } };
  return null;
}

export function notReadyText(p: Printer, now: number, t: T = EN): string | null {
  const m = notReadyMsg(p, now);
  return m && t(m.key, m.vars);
}

export function ago(iso: string | undefined | null, now: number, t: T = EN): string {
  if (!iso) return t("never");
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return t("{n} s ago", { n: s });
  if (s < 3600) return t("{n} min ago", { n: Math.round(s / 60) });
  if (s < 86400) return t("{n} h ago", { n: Math.round(s / 3600) });
  return t("{n} d ago", { n: Math.round(s / 86400) });
}

/** 42 -> "42 min", 65 -> "1 h 05 min"; compact: "42m", "1h 05m". */
export function duration(min: number, compact = false, t: T = EN): string {
  const m = Math.max(0, Math.round(min));
  const h = Math.floor(m / 60);
  const r = String(m % 60);
  if (compact) return h ? t("{h}h {m}m", { h, m: r.padStart(2, "0") }) : t("{m}m", { m: r });
  return h ? t("{h} h {m} min", { h, m: r.padStart(2, "0") }) : t("{m} min", { m: r });
}

export const temp = (v: number | null | undefined): string => (v == null ? "—" : `${Math.round(v)} °C`);

function pill(p: Printer, online: boolean, now: number, t: T): MachineView["pill"] {
  const s = p.snapshot;
  if (!p.lastSeen) return { tone: "idle", text: t("No report yet") };
  if (!online) return { tone: "bad", text: t("Offline · {ago}", { ago: ago(p.lastSeen, now, t) }) };
  if (!s || s.state === "UNKNOWN") return { tone: "idle", text: t("Online · No status yet") };
  const pct = `${Math.floor(s.percent)}%`;
  // A fault that blocks printing is red whatever the state (printer #3's AMS firmware HMS while idle, a clog while paused).
  const fault = blockingFaultCode(s);
  if (fault) return { tone: "bad", text: fault.startsWith("HMS_") ? t("Printer error") : t("Error {code}", { code: fault }) };
  switch (s.state) {
    // A person's Stop ends as FAILED with "task cancelled": not a failure.
    case "FAILED": return BENIGN_PRINT_ERRORS.includes(s.errorCode >>> 0) ? { tone: "warn", text: t("Print stopped") } : { tone: "bad", text: t("Print failed") };
    case "PAUSE": return { tone: "warn", text: t("Paused {pct}", { pct }) };
    case "RUNNING": return { tone: "busy", text: t("Printing {pct}", { pct }) };
    case "PREPARE": return { tone: "busy", text: t("Preparing") };
    case "SLICING": return { tone: "busy", text: t("Slicing") };
    case "FINISH": return { tone: "ok", text: t("Online · Finished") };
    case "INIT": return { tone: "idle", text: t("Starting up") };
    default: return { tone: "ok", text: t("Online · Idle") };
  }
}

/** One machine card. Pass the page's t to get the words in the visitor's language (English without it). */
export function machineView(p: Printer, now: number, t: T = EN): MachineView {
  const s = p.snapshot;
  const online = isOnline(p, now);
  const active = Boolean(s && ACTIVE.includes(s.state));
  const layer = s && s.totalLayers && s.state !== "IDLE" ? `${s.layer ?? 0} / ${s.totalLayers}` : null;
  const left = active && s!.remainingMin != null ? s!.remainingMin : null;
  return {
    id: p.id,
    name: p.name,
    online,
    lastReport: ago(p.lastSeen, now, t),
    lastSeen: p.lastSeen ?? null,
    state: s?.state ?? null,
    pill: pill(p, online, now, t),
    progress: active ? { percent: Math.floor(s!.percent), paused: s!.state === "PAUSE" } : null,
    nozzle: temp(s?.nozzleTemp),
    bed: temp(s?.bedTemp),
    layer: layer ?? "—",
    remaining: left == null ? "—" : duration(left, true, t),
    job: s?.jobName ? { name: s.jobName, current: active } : null,
    errorCode: s?.errorCode ? errorCodeText(s.errorCode) : null,
    orderId: p.currentOrderId ?? null,
    bedHolds: p.bedOccupiedBy ? { orderId: p.bedOccupiedBy === NO_ORDER_PRINT ? null : p.bedOccupiedBy } : null,
    notReady: notReadyText(p, now, t),
  };
}

export const isPrinterTask = (t: OperatorTask): boolean => t.status === "open" && PRINTER_TASKS.includes(t.kind);

export interface MachineStats {
  total: number;
  online: number;
  printing: number;
  paused: number;
  ready: number;
  bedsToCollect: number;
}

export function machineStats(printers: Printer[], now: number): MachineStats {
  const views = printers.map((p) => machineView(p, now));
  return {
    total: views.length,
    online: views.filter((v) => v.online).length,
    printing: views.filter((v) => v.online && v.progress && !v.progress.paused).length,
    paused: views.filter((v) => v.online && v.progress?.paused).length,
    ready: views.filter((v) => v.notReady === null).length,
    bedsToCollect: printers.filter((p) => p.bedOccupiedBy).length,
  };
}

/** The newest report from any printer: when the LAN bridge last got through. */
export function lastBridgeReport(printers: Printer[]): string | null {
  const times = printers.map((p) => p.lastSeen).filter((t): t is string => Boolean(t)).sort();
  return times.at(-1) ?? null;
}
