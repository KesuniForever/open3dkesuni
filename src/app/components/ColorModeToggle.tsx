"use client";

import { useRef } from "react";
import { COLOR_MODE_LABEL, COLOR_MODES, type ColorMode } from "@/lib/pricing";
import { useT } from "@/i18n/client";

const NEXT = ["ArrowRight", "ArrowDown"];
const PREV = ["ArrowLeft", "ArrowUp"];

/**
 * Single colour | Multi colour. Sets the print time, never the price per gram. A radio group: one Tab stop (the
 * checked option), the arrow keys and Home/End choose and move focus, Space/Enter or a click chooses.
 */
export default function ColorModeToggle({ value, onChange, disabled, labelledBy }: {
  value: ColorMode; onChange: (m: ColorMode) => void; disabled?: boolean; labelledBy: string;
}) {
  const t = useT();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const pick = (i: number) => {
    const n = COLOR_MODES.length;
    const k = ((i % n) + n) % n;
    onChange(COLOR_MODES[k]);
    refs.current[k]?.focus();
  };
  const onKeyDown = (i: number) => (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (NEXT.includes(e.key)) pick(i + 1);
    else if (PREV.includes(e.key)) pick(i - 1);
    else if (e.key === "Home") pick(0);
    else if (e.key === "End") pick(COLOR_MODES.length - 1);
    else return;
    e.preventDefault();
  };
  return (
    <div className="seg" role="radiogroup" aria-labelledby={labelledBy}>
      {COLOR_MODES.map((m, i) => (
        <button key={m} ref={(el) => { refs.current[i] = el; }} type="button" role="radio" aria-checked={value === m}
          tabIndex={value === m ? 0 : -1} disabled={disabled} onClick={() => onChange(m)} onKeyDown={onKeyDown(i)}>
          {t(COLOR_MODE_LABEL[m])}
        </button>
      ))}
    </div>
  );
}
