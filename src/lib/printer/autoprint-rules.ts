// Agent prints: the rules that need no store, shared by the app (src/lib/printer/autoprint.ts, jobs.ts, dispatch.ts) and
// the pages (My machines, the order page). Pure: the browser imports this file too.
// The bed gate: a person's "Bed is empty" (Printer.bedCheck) allows ONE print. It is used up by that print (the agent's
// or a person's), voided when any print starts or ends on the printer before that or the printer stops reporting for a while, and too
// old after 2 h (someone may work on the printer later).
import type { BedCheck, Printer } from "../types";
import { isPersonName } from "./control";

/** The meta key of the "Agent may start prints" switch. Missing or { on: false }: the agent never starts or slices. */
export const AUTO_PRINT_META = "autoPrint";
/** A bed confirmation older than this no longer counts: things may have been put on the bed, or hands in the printer, since. */
export const BED_CHECK_VALID_MS = 2 * 3600_000;
/** Runs a person may ask for on one order. */
export const MAX_RUNS = 50;

/** Why the agent waits or what it does, as an English template and its values (pages translate it with t(key, vars)). */
export interface Why { key: string; vars?: Record<string, string | number> }

/** The English text of a Why, with the values filled in (logs and the API are English). */
export const whyText = (w: Why): string =>
  w.vars ? w.key.replace(/\{(\w+)\}/g, (m, k: string) => (k in w.vars! ? String(w.vars![k]) : m)) : w.key;

export type BedState =
  | { ok: true; check: BedCheck }
  | { ok: false; reason: "occupied" | "none" | "used" | "voided" | "stale" | "old" };

/** Whether a person's bed confirmation allows the agent one print on this printer now. */
export function bedState(p: Pick<Printer, "bedOccupiedBy" | "bedCheck" | "lastPrintStartAt" | "lastPrintEndAt">, now: number): BedState {
  if (p.bedOccupiedBy) return { ok: false, reason: "occupied" };
  const b = p.bedCheck;
  if (!b || !isPersonName(b.by)) return { ok: false, reason: "none" };
  if (b.usedAt || b.usedBy) return { ok: false, reason: "used" };
  if (b.voidedAt) return { ok: false, reason: "voided" };
  const at = Date.parse(b.at);
  const before = (iso?: string) => Boolean(iso) && !(at > Date.parse(iso!));
  // Confirmed before the last print started or ended: that print may have left something on the bed.
  if (!Number.isFinite(at) || before(p.lastPrintEndAt) || before(p.lastPrintStartAt)) return { ok: false, reason: "stale" };
  if (now - at > BED_CHECK_VALID_MS) return { ok: false, reason: "old" };
  return { ok: true, check: b };
}

/** The Why for a bed that does not allow an agent print. */
export const bedWhy = (s: Exclude<BedState, { ok: true }>): Why =>
  s.reason === "occupied" ? { key: "The bed holds a finished print: a person empties it" }
    : s.reason === "old" ? { key: "The bed was confirmed more than 2 h ago: confirm it again" }
      : { key: "Waiting for a person to confirm the bed is empty" };

/** "Bed is empty" makes sense now: the printer is not printing. */
export const bedButtonUseful = (p: Pick<Printer, "snapshot">): boolean => !["PREPARE", "RUNNING", "PAUSE", "SLICING"].includes(p.snapshot?.state ?? "");
