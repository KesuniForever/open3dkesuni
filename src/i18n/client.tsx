"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { DEFAULT_LOCALE, makeT, type Locale, type T } from "./core";
import { ID } from "./id";

const LocaleContext = createContext<Locale>(DEFAULT_LOCALE);

/** Set once in the root layout from the language cookie, so client components render the same language as the server. */
export function LocaleProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}

export const useLocale = (): Locale => useContext(LocaleContext);

/** In a client component: `const t = useT();` then `t("Printers online")`. */
export function useT(): T {
  const locale = useLocale();
  return useMemo(() => makeT(locale, ID), [locale]);
}
