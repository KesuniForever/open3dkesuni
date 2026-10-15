// What a printer card (and the order page) shows beyond src/lib/machines.ts: "what it is doing now", faults, the AMS
// spools, fans, speed, light, nozzle, firmware, Wi-Fi and the SD card. Pure, so client components use it. Bambu's own
// fault texts are not here: that table is server-only, so the pages pass them in (issue-texts.ts).
import {
  activeIssues, HMS_SEVERITY, SPEED_LABEL, STAGE_PREPARING, type HmsMessage, type PrinterIssue, type PrinterSnapshot, type SpeedLevel,
} from "@/lib/printer/bambu";
import { resumeNeedsFix } from "@/lib/printer/control";
import { dateLocale, type Locale } from "@/i18n/core";
import { nameOf } from "@/lib/colors";
import type { OperatorTask, Printer } from "@/lib/types";
import type { T } from "@/i18n/core";
import { tLib } from "@/lib/lib-text";

/** Bambu's text per fault code, in the visitor's language; null when Bambu's table does not know the code. */
export type IssueTexts = Record<string, string | null>;

/** "Heating nozzle", "Preparing 35%". Null while idle (an idle A1 reports a stage number that means nothing). */
export function stageText(s: PrinterSnapshot | undefined, t: T): string | null {
  const st = s?.stage;
  if (!st) return null;
  const text = t(st.key, { n: st.code });
  return st.key === STAGE_PREPARING && s.prepPercent ? `${text} ${s.prepPercent}%` : text;
}

export interface IssueView extends PrinterIssue {
  /** "fatal", "serious", "common" for HMS; null for a print_error (its state says more). */
  level: string | null;
  /** bad = blocks printing (red); warn = a person checks it first (amber). */
  tone: "bad" | "warn";
  /** Bambu's words, or null (the page then shows "Unknown printer message {code}"). */
  text: string | null;
}

/** The parts of a fault task's English text (issueTaskText in src/lib/printer/actions.ts). */
const FAULT_TASK = /^(.+?) reports (error )?(\S+?)(?: \((\w+)\))?: ([\s\S]*) Check the printer before the next print\. (\S+)$/;

/**
 * An operator task in the page's language. The stored text stays English; a fault task also gets Bambu's own words
 * for its code in the page's language, when the page knows them (the fault is still reported).
 */
export function taskText(task: Pick<OperatorTask, "text" | "errorCode">, t: T, texts: IssueTexts = {}): string {
  const m = task.errorCode ? FAULT_TASK.exec(task.text) : null;
  if (!m || m[3] !== task.errorCode) return tLib(t, task.text);
  const words = texts[m[3]] ?? (m[5] === NO_WORDS ? t(NO_WORDS) : m[5]);
  return t(`{printer} reports ${m[2] ? "error " : ""}{code}${m[4] ? " ({level})" : ""}: {words} Check the printer before the next print. {url}`,
    { printer: m[1], code: m[3], level: m[4] ? t(m[4]) : "", words, url: m[6] });
}
const NO_WORDS = "Bambu has no description for this code.";

/** The faults to show loudly, worst first: HMS except info, and a print_error that is not a person's pause or stop. */
export function issueViews(s: PrinterSnapshot | undefined, texts: IssueTexts): IssueView[] {
  return activeIssues({ hms: s?.hms, errorCode: s?.errorCode ?? 0 })
    .map((i): IssueView => ({
      ...i, level: i.severity ? HMS_SEVERITY[i.severity] ?? null : null, tone: i.severity === 3 ? "warn" : "bad", text: texts[i.code] ?? null,
    }))
    .sort((a, b) => Number(a.tone === "warn") - Number(b.tone === "warn"));
}

/** HMS messages that are only information (severity 4): shown quietly in the details. */
export const infoMessages = (s: PrinterSnapshot | undefined): HmsMessage[] => (s?.hms ?? []).filter((h) => h.severity === 4);

/** Every fault code a page needs a text for. */
export const issueCodes = (printers: Pick<Printer, "snapshot">[]): string[] =>
  [...new Set(printers.flatMap((p) => [...activeIssues({ hms: p.snapshot?.hms, errorCode: p.snapshot?.errorCode ?? 0 }).map((i) => i.code),
    ...infoMessages(p.snapshot).map((h) => h.code)]))];

/** Paused because of a fault (not by a person): resuming needs "I fixed the cause". Same rule the server and bridge check. */
export const pauseNeedsFix = (s: PrinterSnapshot | undefined): boolean => resumeNeedsFix(s);

/** "0.4 mm" / "0,4 mm": a nozzle size the way the visitor writes numbers. */
export const mm = (v: string | number, locale: Locale = "en"): string => {
  const n = Number(v);
  return Number.isFinite(n) ? `${n.toLocaleString(dateLocale(locale), { maximumFractionDigits: 2 })} mm` : `${v} mm`;
};

/** Wi-Fi bars from dBm: >= -60 good, -60..-70 fair, below -70 weak. */
export function wifiQuality(dbm: number | null | undefined): "good" | "fair" | "weak" | null {
  if (dbm == null) return null;
  return dbm >= -60 ? "good" : dbm >= -70 ? "fair" : "weak";
}

/** "Standard · 100%". */
export function speedText(s: PrinterSnapshot | undefined, t: T): string | null {
  if (!s?.speedLevel) return null;
  const label = t(SPEED_LABEL[s.speedLevel as SpeedLevel]);
  return s.speedPct ? `${label} · ${s.speedPct}%` : label;
}

const NOZZLE_TYPES: Record<string, string> = { stainless_steel: "stainless steel", hardened_steel: "hardened steel" };
/** "0.4 mm · stainless steel" ("0,4 mm" in Indonesian). */
export function nozzleText(s: PrinterSnapshot | undefined, t: T, locale: Locale = "en"): string | null {
  const n = s?.nozzle;
  if (!n?.diameter && !n?.type) return null;
  const type = n.type ? t(NOZZLE_TYPES[n.type] ?? n.type.replace(/_/g, " ")) : null;
  return [n.diameter ? mm(n.diameter, locale) : null, type].filter(Boolean).join(" · ");
}

/** The plate a sliced file expects, as Bambu Studio names it (the person checks it on the printer). */
const BED_TYPES: Record<string, string> = {
  textured_plate: "Textured PEI plate", cool_plate: "Cool plate", eng_plate: "Engineering plate",
  hot_plate: "Smooth PEI plate", supertack_plate: "Cool plate SuperTack",
};
export const bedTypeLabel = (v: string | null | undefined): string | null => (v ? BED_TYPES[v] ?? v.replace(/_/g, " ") : null);

export interface SlotView {
  tray: number;            // global tray number (ams*4 + slot): the AMS mapping value
  slot: number;            // 1..4 as the printer labels it
  empty: boolean;
  type: string | null;     // "PLA", "PETG"
  name: string | null;     // English colour name ("Yellow"); the page translates it
  brand: string | null;    // "PLA Basic" on a Bambu RFID spool
  color: string | null;
  colors: string[];
  active: boolean;         // in the toolhead now
  bambu: boolean;          // RFID spool: the colour comes from the tag
  remainPct: number | null;
}

/** The AMS slots in order, 1..4 (an A1 has one AMS lite). Empty when the bridge does not report the AMS. */
export function amsSlots(s: PrinterSnapshot | undefined): SlotView[] {
  const ams = s?.ams;
  if (!ams) return [];
  return ams.trays.map((x): SlotView => {
    const tray = x.ams * 4 + x.slot;
    return {
      tray, slot: x.slot + 1, empty: x.empty || !x.type, type: x.empty ? null : x.type, name: !x.empty && x.color ? nameOf(x.color) : null,
      brand: x.empty ? null : x.subBrand, color: x.empty ? null : x.color, colors: x.empty ? [] : x.colors,
      active: ams.activeSlot === tray, bambu: !x.empty && x.bambu, remainPct: x.empty ? null : x.remainPct,
    };
  });
}

/** "Slot 3" (A1: one AMS). */
export const slotText = (tray: number, t: T): string =>
  tray >> 2 === 0 ? t("Slot {n}", { n: (tray & 3) + 1 }) : t("AMS {a} slot {n}", { a: (tray >> 2) + 1, n: (tray & 3) + 1 });
