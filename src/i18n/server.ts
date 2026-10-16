import { cookies } from "next/headers";
import { LOCALE_COOKIE, makeT, toLocale, type Locale, type T } from "./core";
import { ID } from "./id";

/** The visitor's language from the language cookie; English when there is none. */
export async function getLocale(): Promise<Locale> {
  return toLocale((await cookies()).get(LOCALE_COOKIE)?.value);
}

/** In a server component: `const t = await getT();` then `t("Printers online")`. */
export async function getT(): Promise<T> {
  return makeT(await getLocale(), ID);
}
