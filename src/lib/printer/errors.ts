// Bambu's own words for a printer fault, in English or Indonesian: the official A1 tables (HMS messages and device
// errors), saved by scripts/fetch-bambu-errors.mjs. Server-side only (the table is about 640 KB). These are Bambu's
// translations, so they are data and not entries in the i18n dictionaries. Unknown codes return null: the page then
// shows t("Unknown printer message {code}") and the link.
import table from "./bambu-errors.json";
import type { Locale } from "../../i18n/core";
import { hmsKey, type PrinterIssue } from "./bambu";

type Lang = { hms: Record<string, string>; err: Record<string, string> };
const T = table as { ver: string; en: Lang; id: Lang };

/** Version of Bambu's table (e.g. "202609231145"). */
export const errorTableVersion = (): string => T.ver;

/** Bambu's text for an HMS code ("HMS_0510_0400_0001_0044") or a print_error ("0700-8011"), or null. */
export function issueText(issue: Pick<PrinterIssue, "kind" | "code">, locale: Locale = "en"): string | null {
  const key = issue.kind === "hms" ? hmsKey(issue.code) : issue.code.replace("-", "");
  const pick = (l: Lang) => (issue.kind === "hms" ? l.hms : l.err)[key.toUpperCase()];
  return (locale === "id" ? pick(T.id) : undefined) ?? pick(T.en) ?? null;
}
