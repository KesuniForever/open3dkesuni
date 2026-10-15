// Choices on the spec form (part of the agreement the customer approves): the material, PLA or PETG (what the
// studio's A1 printers run and the price per gram covers), and the finishing. Stored in English, because the
// agreement fingerprint, the log and the Chief read them; pages show them with t(). A spec saved before these were
// choices keeps its free-text value while nobody changes it. Pure, client-safe.
import { toMaterial } from "./pricing";
import type { Material } from "./types";

export const FINISHES = ["Standard", "Sanded", "Primed for paint"] as const;
export const BAD_FINISHING = "Finishing must be Standard, Sanded or Primed for paint";

/** The spec's material: empty -> `fallback` (the order's material, else PLA); "pla", "PLA Basic" -> "PLA"; the spec's current value unchanged -> kept. Null: refuse. */
export function specMaterial(v: string, current: string | undefined, fallback: Material): string | null {
  const s = v.trim();
  if (!s) return fallback;
  if (s === current) return s;
  return toMaterial(s);
}

/** The spec's finishing: empty -> "Standard"; one of FINISHES (any case); the spec's current value unchanged -> kept. Null: refuse. */
export function specFinishing(v: string, current?: string): string | null {
  const s = v.trim();
  if (!s) return "Standard";
  if (s === current) return s;
  if (s === "Standar") return "Standard"; // the Indonesian default that older specs used
  return FINISHES.find((f) => f.toLowerCase() === s.toLowerCase()) ?? null;
}

/** For the select: the choices, plus an older free-text value so saving the form does not change it by surprise. */
export const choicesWith = (choices: readonly string[], current: string | undefined): string[] =>
  current && !choices.includes(current) ? [...choices, current] : [...choices];

/** The finishing as a page shows it: one of FINISHES translated ("Standar", the old default, reads as Standard), else as stored. */
export function finishingText(v: string, t: (key: string) => string): string {
  const f = v === "Standar" ? "Standard" : v;
  return (FINISHES as readonly string[]).includes(f) ? t(f) : v;
}
