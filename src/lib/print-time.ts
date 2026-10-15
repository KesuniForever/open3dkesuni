// Print time and "ready in" as people read them: "3–5 min", "30–50 min", "50 min – 2.5 h", "1.5–2.5 h",
// "2.1–3.5 days"; "± 2 hours". Each end of a range gets the unit that suits it (never "0 h"); when both ends share a
// unit it is written once. Decimals follow the page's language (1.5 h, 1,5 jam). Pure: server and client pages use it.
import { dateLocale, type Locale, type T } from "../i18n/core";
import type { MinutesRange } from "./pricing";

type Unit = "min" | "h" | "days";
const ONE: Record<Unit, string> = { min: "{n} min", h: "{n} h", days: "{n} days" };
const RANGE: Record<Unit, string> = { min: "{a}–{b} min", h: "{a}–{b} h", days: "{a}–{b} days" };

/** Under an hour in whole minutes, under two days in hours, then days (one decimal). */
function part(minutes: number): { unit: Unit; n: number } {
  const m = Math.max(1, Math.round(minutes));
  if (m < 60) return { unit: "min", n: m };
  if (m < 48 * 60) return { unit: "h", n: Math.round(m / 6) / 10 };
  return { unit: "days", n: Math.round(m / 144) / 10 };
}

const number = (n: number, locale: Locale) => n.toLocaleString(dateLocale(locale), { maximumFractionDigits: 1 });

/** "3–5" minutes per gram, or "4" when both ends are the same. */
export function rangeText(r: MinutesRange, locale: Locale): string {
  return r.min === r.max ? number(r.min, locale) : `${number(r.min, locale)}–${number(r.max, locale)}`;
}

/** The print time of an order: "3–5 min", "50 min – 2.5 h", "1.5–2.5 h". */
export function printTimeText(r: MinutesRange, t: T, locale: Locale): string {
  const lo = part(r.min);
  const hi = part(r.max);
  const a = number(lo.n, locale);
  const b = number(hi.n, locale);
  if (lo.unit !== hi.unit) return `${t(ONE[lo.unit], { n: a })} – ${t(ONE[hi.unit], { n: b })}`;
  return a === b ? t(ONE[hi.unit], { n: b }) : t(RANGE[hi.unit], { a, b });
}

/**
 * When the order is ready (print time + handling): "± 2 hours", or "± 76 hours · about 3.2 days" for long jobs. No
 * parentheses, so a page can add its own note after it: "± 76 hours · about 3.2 days (print time + 1 h …)".
 */
export function readyInText(etaHours: number, t: T, locale: Locale): string {
  if (etaHours >= 48) return t("± {n} hours · about {d} days", { n: etaHours, d: number(Math.round(etaHours / 2.4) / 10, locale) });
  return t(etaHours === 1 ? "± {n} hour" : "± {n} hours", { n: etaHours });
}
