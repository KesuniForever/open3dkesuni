"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { LOCALE_COOKIE, LOCALES, type Locale } from "@/i18n/core";
import { useLocale, useT } from "@/i18n/client";

/** Remembers the choice in this browser for a year (outside the component, so React's lint sees no render-time mutation). */
function saveLocale(l: Locale) {
  document.cookie = `${LOCALE_COOKIE}=${l}; path=/; max-age=31536000; samesite=lax`;
}

/** EN | ID switch, top right. English stays the default; the choice is remembered in this browser for a year. */
export default function LangSwitch() {
  const router = useRouter();
  const current = useLocale();
  const t = useT();
  const [pending, start] = useTransition();

  function choose(l: Locale) {
    if (l === current) return;
    saveLocale(l);
    start(() => router.refresh());
  }

  return (
    <div className="lang-switch" role="group" aria-label={t("Language")}>
      {LOCALES.map((l) => (
        <button key={l} type="button" className={l === current ? "on" : ""} aria-pressed={l === current}
          disabled={pending} onClick={() => choose(l)} lang={l} title={l === "en" ? "English" : "Bahasa Indonesia"}>
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
