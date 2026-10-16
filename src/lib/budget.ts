// The customer's budget, typed in rupiah or in USDC and shown in both, plus US dollars (1 USDC = 1 US$). Money moves
// in USDC: the order keeps the USDC mandate in micro-USDC (mandateMicro, all 6 decimals). Since 15 Oct 2026 it also
// keeps the rupiah as typed (or worked out from the USDC typed) and the app rate used: idrPerUsdc() in costing.ts,
// which reads the env, so pages pass the rate in. Pure: client components import this too.
import { dateLocale, type Locale, type T } from "../i18n/core";
import type { Order } from "./types";

export type BudgetCurrency = "IDR" | "USDC";
export const BUDGET_CURRENCIES: readonly BudgetCurrency[] = ["IDR", "USDC"];

export interface Budget {
  budgetIdr: number;        // whole rupiah
  rateIdrPerUsdc: number;   // the app rate the mandate was worked out with
  mandateMicro: number;     // micro-USDC
}

export const BAD_IDR = "Type the budget in whole rupiah, like 50.000";
export const BAD_USDC = "Budget must be a USDC amount like 32 or 32.5 (max 6 decimals)";
export const NO_BUDGET = "The budget is required (rupiah or USDC)";
export const TWO_BUDGETS = "Give the budget in rupiah or in USDC, not both";

/** "50000", "50.000", "50,000", "50 000", "Rp 50.000" -> 50000. Whole rupiah above 0 only; anything else is null. */
export function parseIdr(v: unknown): number | null {
  if (typeof v === "number") return Number.isSafeInteger(v) && v > 0 ? v : null;
  if (typeof v !== "string") return null;
  const s = v.trim().replace(/^rp\.?\s*/i, "");
  // One kind of thousands separator, in groups of three: "1.000,000" could mean either, so it is refused.
  if (!/^\d+$/.test(s) && !/^\d{1,3}([., ])\d{3}(\1\d{3})*$/.test(s)) return null;
  const n = Number(s.replace(/\D/g, ""));
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/**
 * "32", "32.5", "0.000001" -> micro-USDC, exactly. A decimal comma ("3,5", as Indonesians write it) too, unless it
 * could be a thousands separator: "1,000" is refused, since it could mean 1 or 1000.
 */
export function parseUsdcMicro(v: unknown): number | null {
  const raw = typeof v === "number" ? String(v) : typeof v === "string" ? v.trim() : "";
  const s = /^\d+,(\d{1,2}|\d{4,6})$/.test(raw) ? raw.replace(",", ".") : raw;
  const m = /^(\d+)(?:\.(\d{1,6}))?$/.exec(s);
  if (!m) return null;
  const micro = Number(m[1]) * 1_000_000 + Number((m[2] ?? "").padEnd(6, "0"));
  return Number.isSafeInteger(micro) && micro > 0 ? micro : null;
}

/** Rupiah typed: kept as typed; the mandate is rupiah / rate in micro-USDC, rounded to the micro. */
export const idrBudget = (budgetIdr: number, rate: number): Budget =>
  ({ budgetIdr, rateIdrPerUsdc: rate, mandateMicro: Math.round((budgetIdr * 1_000_000) / rate) });

/** USDC typed: the mandate is exactly the USDC typed; the rupiah is USDC × rate, rounded to the rupiah. */
export function usdcBudget(mandateMicro: number, rate: number): Budget {
  // Whole USDC and the micro part apart, so a large budget never loses precision in one big product.
  const whole = Math.floor(mandateMicro / 1_000_000);
  const budgetIdr = Math.round(whole * rate + ((mandateMicro % 1_000_000) * rate) / 1_000_000);
  return { budgetIdr, rateIdrPerUsdc: rate, mandateMicro };
}

/** The budget from a form or a request body: what was typed and in which currency. */
export function budgetFrom(amount: unknown, currency: BudgetCurrency, rate: number): { ok: true; budget: Budget } | { ok: false; reasons: string[] } {
  if (amount === undefined || amount === null || amount === "") return { ok: false, reasons: [NO_BUDGET] };
  if (currency === "IDR") {
    const idr = parseIdr(amount);
    return idr === null ? { ok: false, reasons: [BAD_IDR] } : { ok: true, budget: idrBudget(idr, rate) };
  }
  const micro = parseUsdcMicro(amount);
  return micro === null ? { ok: false, reasons: [BAD_USDC] } : { ok: true, budget: usdcBudget(micro, rate) };
}

/** POST /api/orders: { budgetIdr } (rupiah, as typed) or { budgetUsdc } (USDC, a string like "32.5"), exactly one. */
export function budgetFromBody(b: Record<string, unknown>, rate: number): { ok: true; budget: Budget } | { ok: false; reasons: string[] } {
  const given = (v: unknown) => v !== undefined && v !== null && v !== "";
  if (given(b.budgetIdr) && given(b.budgetUsdc)) return { ok: false, reasons: [TWO_BUDGETS] };
  // budgetUsdc was a string before rupiah budgets existed; a JSON number would be a float, so it stays a string.
  if (given(b.budgetUsdc)) return typeof b.budgetUsdc === "string" ? budgetFrom(b.budgetUsdc, "USDC", rate) : { ok: false, reasons: [BAD_USDC] };
  return budgetFrom(b.budgetIdr, "IDR", rate);
}

/** Rp1.650: the way the app writes rupiah in both languages. */
export const rp = (n: number): string => `Rp${Math.round(n).toLocaleString("id-ID")}`;
/** The rate, with decimals only when the env gives some ("Rp16.500", "Rp16.250,5"). */
export const rateText = (rate: number): string => `Rp${rate.toLocaleString("id-ID", { maximumFractionDigits: 2 })}`;
/** Micro-USDC as USDC with every decimal that is not zero: 3030303 -> "3.030303", 32500000 -> "32.5". */
export function usdcText(micro: number): string {
  const m = Math.max(0, Math.round(micro));
  const frac = String(m % 1_000_000).padStart(6, "0").replace(/0+$/, "");
  return frac ? `${Math.floor(m / 1_000_000)}.${frac}` : String(Math.floor(m / 1_000_000));
}
/** US dollars to the cent (1 USDC = 1 US$): "US$3.03". */
export const usdText = (micro: number): string =>
  `US$${(Math.round(micro / 10_000) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** "Rp50.000 = 3.030303 USDC ≈ US$3.03": US dollars are shown to the cent, so "=" only when that is exact. */
export const budgetEquals = (b: Budget): string =>
  `${rp(b.budgetIdr)} = ${usdcText(b.mandateMicro)} USDC ${b.mandateMicro % 10_000 === 0 ? "=" : "≈"} ${usdText(b.mandateMicro)}`;

/**
 * "1.000" typed as USDC: in Indonesia that is how a thousand is written, but here the dot is a decimal point (1 USDC).
 * The form shows a hint for it (the amount itself is fine: the line under the field shows what it means).
 */
export const looksLikeThousands = (typed: string): boolean => /^\d{1,3}\.\d{3}$/.test(typed.trim());

/**
 * The order's budget for lists: "Rp50.000 · 3.030303 USDC" (or "test USDC" on a testnet). Orders made before the
 * rupiah budget existed show the USDC only.
 */
export function budgetText(o: Pick<Order, "mandateMicro" | "budgetIdr">, t: T, testnet = false): string {
  const usdc = `${usdcText(o.mandateMicro)} ${testnet ? t("test USDC") : "USDC"}`;
  return o.budgetIdr !== undefined ? `${rp(o.budgetIdr)} · ${usdc}` : usdc;
}

/**
 * The customer's latest budget raise (src/lib/budget-raise.ts), for the operator's "Budget mandate" row under
 * budgetText: "raised by the customer from Rp1.500.000 (Aini, 17 Oct)". Null when the customer never raised it.
 */
export function budgetRaiseText(o: Pick<Order, "budgetRaises">, t: T, locale: Locale = "en", testnet = false): string | null {
  const r = o.budgetRaises?.at(-1);
  if (!r) return null;
  const from = r.fromIdr !== null ? rp(r.fromIdr) : `${usdcText(r.fromMicro)} ${testnet ? t("test USDC") : "USDC"}`;
  const date = new Date(r.at).toLocaleDateString(dateLocale(locale), { timeZone: "Asia/Jakarta", day: "numeric", month: "short" });
  return t("raised by the customer from {from} ({name}, {date})", { from, name: r.by, date });
}
