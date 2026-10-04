// Bambu Lab printer reports (LAN MQTT, topic device/<serial>/report) -> a clean snapshot and events.
// Pure functions, no I/O. Bambu has no official API: field names follow the community-documented
// format (OpenBambuAPI) and must be checked against the real A1 before we rely on them.
//
// A1/P1 printers send PARTIAL updates (only changed fields) after a full "pushall",
// so mergeReport always merges into the previous snapshot.

export type PrinterState = "IDLE" | "PREPARE" | "SLICING" | "RUNNING" | "PAUSE" | "FINISH" | "FAILED" | "UNKNOWN";

export interface PrinterSnapshot {
  state: PrinterState;
  percent: number;          // 0..100
  remainingMin: number | null;
  layer: number | null;
  totalLayers: number | null;
  jobName: string | null;   // subtask_name, the file being printed
  errorCode: number;        // print_error, 0 = none
  nozzleTemp: number | null;
  bedTemp: number | null;
  at: string;               // ISO time of the last report
}

export type PrinterEventKind =
  | "started"          // a new print began
  | "progress"         // crossed 25 / 50 / 75 %
  | "needs_operator"   // paused with an error (often filament runout): a person must act
  | "resumed"
  | "finished"         // print complete: someone must collect it and do QC
  | "failed";          // print failed or was cancelled

export interface PrinterEvent {
  kind: PrinterEventKind;
  percent: number;
  jobName: string | null;
  errorCode?: number;
  at: string;
}

const STATES: PrinterState[] = ["IDLE", "PREPARE", "SLICING", "RUNNING", "PAUSE", "FINISH", "FAILED"];
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const text = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);

export function emptySnapshot(at: string): PrinterSnapshot {
  return { state: "UNKNOWN", percent: 0, remainingMin: null, layer: null, totalLayers: null,
    jobName: null, errorCode: 0, nozzleTemp: null, bedTemp: null, at };
}

/** Merge one MQTT report into the previous snapshot. Returns undefined if it is not a print status report. */
export function mergeReport(prev: PrinterSnapshot | undefined, message: unknown, at: string): PrinterSnapshot | undefined {
  const p = (message as { print?: Record<string, unknown> } | null)?.print;
  if (!p || typeof p !== "object") return undefined;
  const base = prev ?? emptySnapshot(at);
  const state = text(p.gcode_state)?.toUpperCase();
  const percent = num(p.mc_percent);
  return {
    state: state && (STATES as string[]).includes(state) ? (state as PrinterState) : base.state,
    percent: percent !== undefined ? Math.max(0, Math.min(100, percent)) : base.percent,
    remainingMin: num(p.mc_remaining_time) ?? base.remainingMin,
    layer: num(p.layer_num) ?? base.layer,
    totalLayers: num(p.total_layer_num) ?? base.totalLayers,
    jobName: text(p.subtask_name) ?? base.jobName,
    errorCode: num(p.print_error) ?? base.errorCode,
    nozzleTemp: num(p.nozzle_temper) ?? base.nozzleTemp,
    bedTemp: num(p.bed_temper) ?? base.bedTemp,
    at,
  };
}

const ACTIVE: PrinterState[] = ["PREPARE", "RUNNING"];
const MILESTONES = [25, 50, 75];

/** What happened between two snapshots. Ignores the first snapshot (we don't know what came before). */
export function detectEvents(prev: PrinterSnapshot | undefined, next: PrinterSnapshot): PrinterEvent[] {
  if (!prev || prev.state === "UNKNOWN") return [];
  const ev = (kind: PrinterEventKind, extra: Partial<PrinterEvent> = {}): PrinterEvent =>
    ({ kind, percent: next.percent, jobName: next.jobName, at: next.at, ...extra });
  const out: PrinterEvent[] = [];
  const wasActive = ACTIVE.includes(prev.state) || prev.state === "PAUSE";
  const isActive = ACTIVE.includes(next.state);

  if (!wasActive && isActive) out.push(ev("started"));
  if (prev.state === "PAUSE" && isActive) out.push(ev("resumed"));
  if (next.state === "PAUSE" && prev.state !== "PAUSE") out.push(ev("needs_operator", { errorCode: next.errorCode }));
  if (next.state === "FINISH" && prev.state !== "FINISH" && wasActive) out.push(ev("finished", { percent: 100 }));
  if (next.state === "FAILED" && prev.state !== "FAILED") out.push(ev("failed", { errorCode: next.errorCode }));
  if (next.state === "RUNNING") {
    for (const m of MILESTONES) if (prev.percent < m && next.percent >= m) out.push(ev("progress", { percent: m }));
  }
  return out;
}

/** print_error as the hex code Bambu shows in its app/wiki, e.g. 0x07008011 -> "0700-8011". */
export function errorCodeText(code: number): string {
  const hex = (code >>> 0).toString(16).toUpperCase().padStart(8, "0");
  return `${hex.slice(0, 4)}-${hex.slice(4)}`;
}
