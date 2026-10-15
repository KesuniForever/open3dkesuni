import { Fragment, type ReactNode } from "react";
import type { T } from "@/i18n/core";

/** A translated sentence with JSX inside: rich(t("Customer {name} approved."), { name: <b>Lia</b> }).
 *  Unknown {placeholders} stay as written, like t() does. */
export function rich(text: string, parts: Record<string, ReactNode>): ReactNode {
  return text.split(/(\{\w+\})/g).map((piece, i) => {
    const m = /^\{(\w+)\}$/.exec(piece);
    return <Fragment key={i}>{m && m[1] in parts ? parts[m[1]] : piece}</Fragment>;
  });
}

/** "1 unit" / "2 units" in English (same as plural()), "{n} unit" in Indonesian. */
export const units = (t: T, n: number): string => t(n === 1 ? "{n} unit" : "{n} units", { n });
