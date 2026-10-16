// A dispatcher reason (Why: English template + values) in the page's language. Each text value is translated on its own
// ("White" -> "Putih", a reason inside "{printer}: {reason}"); names, ids and codes stay as they are. English unchanged.
// Pure: pages and src/lib/ops.ts use it.
import type { T } from "../../i18n/core";
import { tLib } from "../lib-text";
import type { Why } from "./autoprint-rules";

export function whyLine(t: T, why: Why | null | undefined): string {
  if (!why?.key) return "";
  if (!why.vars || Object.keys(why.vars).length === 0) return tLib(t, why.key);
  const vars = Object.fromEntries(Object.entries(why.vars).map(([k, v]) => [k, typeof v === "string" ? tLib(t, v) : v]));
  return t(why.key, vars);
}
