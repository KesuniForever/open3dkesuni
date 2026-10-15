"use client";

import { useRef, type ReactNode } from "react";
import Icon from "./Icon";
import { useT } from "@/i18n/client";

const EDGE = 12; // px kept free between the popup and the window edge

/** A small ⓘ that shows its explanation on hover, tap or keyboard focus, so the page itself stays short. */
export default function Info({ children }: { children: ReactNode }) {
  const pop = useRef<HTMLSpanElement>(null);
  const t = useT();
  // The popup is centred under the ⓘ; near the window edge it slides back inside (phones use a fixed bar instead).
  const place = () => {
    const el = pop.current;
    if (!el) return;
    el.style.setProperty("--nudge", "0px");
    const r = el.getBoundingClientRect();
    if (!r.width) return;
    const w = document.documentElement.clientWidth;
    const nudge = r.right > w - EDGE ? w - EDGE - r.right : r.left < EDGE ? EDGE - r.left : 0;
    el.style.setProperty("--nudge", `${Math.round(nudge)}px`);
  };
  return (
    <span className="info" tabIndex={0} aria-label={t("More info")} onMouseEnter={place} onFocus={place}>
      <Icon name="info" size={15} />
      <span ref={pop} className="info-pop" role="tooltip">{children}</span>
    </span>
  );
}
