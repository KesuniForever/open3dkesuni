// Small text helpers for the pages. Pure, no server imports, so client components can use them too.
import type { Locale } from "../i18n/core";

/** "1 unit", "2 units"; pass `many` for irregular words. */
export const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/** Markdown-free text: no bold, code ticks or heading marks; "- " list marks become "• ". Line breaks are kept. */
export function plain(text: string): string {
  return text
    .replace(/\*\*|__|`/g, "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*]\s+/gm, "• ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** The first paragraph on one line, cut at `max` characters. */
export function oneLine(text: string, max = 160): string {
  const first = plain(text).split(/\n\s*\n/)[0].replace(/\s+/g, " ").trim();
  return first.length > max ? `${first.slice(0, max - 1).trimEnd()}…` : first;
}

/**
 * A message to the customer as a reader in this language sees it: its Indonesian text (textId) on an Indonesian page
 * when it has one, else its English. The customer's page, the operator's pages and the repeat guard (messages.ts) share it.
 */
export const messageText = (m: { text: string; textId?: string }, locale: Locale): string =>
  (locale === "id" && m.textId ? m.textId : m.text);
