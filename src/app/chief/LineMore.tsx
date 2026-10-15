"use client";

// One line of text cut to fit the row, that opens to the rest. Used by the Chief page and the Operations page.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useT } from "@/i18n/client";
import "./line-more.css";

/**
 * A one-line result. With `children` (the full text) it always offers More, and opening shows the children.
 * Without, it offers More only when the line is actually cut on this screen (measured), and opening unwraps the line.
 */
export default function LineMore({ line, children, className = "" }: { line: string; children?: ReactNode; className?: string }) {
  const t = useT();
  const box = useRef<HTMLDetailsElement>(null);
  const text = useRef<HTMLSpanElement>(null);
  const [cut, setCut] = useState(false);
  const full = children !== undefined && children !== null && typeof children !== "boolean" && children !== "";

  useEffect(() => {
    const el = text.current;
    if (full || !el || typeof ResizeObserver === "undefined") return;
    // Measured only while closed: an open line wraps, so it would never look cut. The observer also fires once on start.
    const ro = new ResizeObserver(() => {
      if (!box.current?.open) setCut(el.scrollWidth > el.clientWidth + 1);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [full, line]);

  const opens = full || cut;
  return (
    <details ref={box} className={`line-more${full ? " has-full" : ""}${opens ? "" : " still"}${className ? ` ${className}` : ""}`}>
      <summary title={opens ? line : undefined} tabIndex={opens ? undefined : -1}
        onClick={(e) => { if (!opens) e.preventDefault(); }}>
        <span ref={text} className="line-more-text">{line}</span>
        {opens && <span className="line-more-toggle" aria-hidden="true" data-more={t("More")} data-less={t("Less")} />}
      </summary>
      {full && <div className="line-more-full">{children}</div>}
    </details>
  );
}
