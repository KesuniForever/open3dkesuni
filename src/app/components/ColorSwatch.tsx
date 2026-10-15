import type { CSSProperties } from "react";
import { hexToLab, normalizeHex } from "@/lib/colors";

/** Very light colours (white, ivory) get a darker rim, so the swatch still shows on a white card. */
const light = (hex: string) => hexToLab(hex).L > 88;

/**
 * A filament colour: a round swatch, split in slices for a multi-colour spool, dashed and empty for an empty AMS slot.
 * `active` draws a ring (the spool in the toolhead). Server and client components both use it; the label and title
 * come translated from the caller.
 */
export default function ColorSwatch({ color, colors, size = 22, active = false, title, className }: {
  color: string | null | undefined;
  /** Every colour of a multi-colour spool; one or none = plain. */
  colors?: string[];
  size?: number;
  active?: boolean;
  title?: string;
  className?: string;
}) {
  const hexes = (colors && colors.length > 1 ? colors : [color]).map(normalizeHex).filter((h): h is string => Boolean(h));
  const empty = hexes.length === 0;
  // conic-gradient slices for a multi-colour spool (Bambu's "cols"), a plain fill otherwise.
  const fill = hexes.length > 1
    ? `conic-gradient(${hexes.map((h, i) => `${h} ${(i * 360) / hexes.length}deg ${((i + 1) * 360) / hexes.length}deg`).join(", ")})`
    : hexes[0];
  const style: CSSProperties = {
    display: "inline-block", flex: "none", width: size, height: size, borderRadius: "50%", verticalAlign: "middle",
    background: empty ? "transparent" : fill,
    border: empty ? "1.5px dashed var(--faint)" : `1px solid ${hexes.some(light) ? "rgba(32, 41, 54, 0.45)" : "rgba(32, 41, 54, 0.18)"}`,
    boxShadow: active ? "0 0 0 2px var(--surface), 0 0 0 4px var(--primary)" : undefined,
  };
  return (
    <span className={className ? `swatch ${className}` : "swatch"} style={style} title={title}
      role={title ? "img" : undefined} aria-label={title} aria-hidden={title ? undefined : true} />
  );
}
