// Small text helpers for the pages. Pure, no server imports, so client components can use them too.

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
