// Indonesian for the texts shared libraries build with a value in them ("Order is PAID; quotes are closed",
// "Orders under Rp150.000 need the owner's approval", "A1 Combo #2: busy with ORD-004"). The libraries keep writing
// English: it is also the language of the log, the API and the tests. A page shows such a text with tLib(t, text):
// the exact dictionary entry when there is one, else the matching template from src/i18n/id/lib.ts with the values
// put back in. In English the text comes back unchanged. Pure, so server and client components can both use it.
import type { T, Vars } from "../i18n/core";
import lib from "../i18n/id/lib";

/** Placeholders with a narrow shape, so a template cannot swallow the words around them. Others match any text. */
const SHAPE: Record<string, string> = {
  n: "\\d+(?:[.,]\\d+)?", h: "\\d+(?:[.,]\\d+)?", pct: "\\d+(?:[.,]\\d+)?",
  status: "[A-Z_]+", state: "[A-Z_]+", from: "[A-Z_]+", to: "[A-Z_]+",
  order: "[A-Z]+-[\\w-]+|a print without an order",
};
/** Values that are words themselves (a status, a printer state, "2 min", a colour name): translated too. */
const WORD_VARS = new Set(["status", "state", "order", "kind", "ext", "rating", "every", "name", "level"]);

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

interface Template { text: string; names: string[]; re: RegExp; literal: number }

function compile(text: string): Template {
  const names: string[] = [];
  const parts = text.split(/\{(\w+)\}/g);
  let src = "";
  let literal = 0;
  parts.forEach((p, i) => {
    if (i % 2 === 0) { src += escape(p); literal += p.length; return; }
    names.push(p);
    src += `(${SHAPE[p] ?? ".+?"})`;
  });
  return { text, names, re: new RegExp(`^${src}$`), literal };
}

let templates: Template[] | null = null;
/** The dictionary keys with {placeholders}, most literal text first (the most specific template wins). */
const all = (): Template[] =>
  (templates ??= Object.keys(lib).filter((k) => /\{\w+\}/.test(k)).map(compile).sort((a, b) => b.literal - a.literal));

/**
 * A library text in the page's language. English stays byte-identical. Several reasons joined with "; " (the printer
 * bridge sends them so) are translated one by one when the whole text has no entry.
 */
export function tLib(t: T, text: string, depth = 0): string {
  const direct = t(text);
  if (direct !== text || depth > 2) return direct;
  for (const tpl of all()) {
    const m = tpl.re.exec(text);
    if (!m) continue;
    const vars: Vars = {};
    tpl.names.forEach((name, i) => {
      const v = m[i + 1];
      vars[name] = WORD_VARS.has(name) ? tLib(t, v, depth + 1) : v;
    });
    return t(tpl.text, vars);
  }
  if (depth === 0 && text.includes("; ")) return text.split("; ").map((part) => tLib(t, part, 1)).join("; ");
  return text;
}
