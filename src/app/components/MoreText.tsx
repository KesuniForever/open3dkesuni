"use client";

import { oneLine, plain } from "@/lib/text";
import { useT } from "@/i18n/client";

/** Shows `oneLine(text)` elsewhere; this fold holds the whole text, only when that line left something out. */
export default function MoreText({ text, label = "Full text" }: { text: string; label?: string }) {
  const t = useT();
  const full = plain(text);
  if (full.replace(/\s+/g, " ") === oneLine(text)) return null;
  return (
    <details className="fold more-text">
      <summary>{t(label)}</summary>
      <p className="muted">{full}</p>
    </details>
  );
}
