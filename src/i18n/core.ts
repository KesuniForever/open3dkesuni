// Two languages: English (the default, what the judges and every new visitor see) and Indonesian (the "ID" switch).
// The English text in the code is the key; src/i18n/id/*.ts maps it to Indonesian. A missing entry falls back to
// English, so an untranslated line never breaks a page. Safe to import from server and client components.
export type Locale = "en" | "id";
export const LOCALES: Locale[] = ["en", "id"];
export const DEFAULT_LOCALE: Locale = "en";
/**
 * Cookie that remembers the visitor's choice for the browser session. Without it the site is English. Renamed from
 * "lang" (kept for a year) on 16 Oct 2026, so an old Indonesian choice no longer opens the site in Indonesian.
 */
export const LOCALE_COOKIE = "site_lang";

export const toLocale = (v: unknown): Locale => (v === "id" ? "id" : DEFAULT_LOCALE);

export type Vars = Record<string, string | number>;
/** t("Printers online") or t("{n} printers", { n: 3 }). */
export type T = (text: string, vars?: Vars) => string;

const fill = (text: string, vars?: Vars) =>
  vars ? text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : text;

export function makeT(locale: Locale, dict: Readonly<Record<string, string>>): T {
  return (text, vars) => fill(locale === "id" ? (dict[text] ?? text) : text, vars);
}

/** For toLocaleString and friends. Both keep day-month order, as people in Indonesia read dates. */
export const dateLocale = (locale: Locale): string => (locale === "id" ? "id-ID" : "en-GB");
