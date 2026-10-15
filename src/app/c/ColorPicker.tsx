"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { ColorChoice, Material } from "@/lib/types";
import { MATERIALS, type ColorMode } from "@/lib/pricing";
import { deltaE, hexToLab, MAX_COLOR_CHOICES } from "@/lib/colors";
import { useT } from "@/i18n/client";
import Info from "@/app/components/Info";
import ColorModeToggle from "@/app/components/ColorModeToggle";

// The customer picks a material and one colour (or up to four for a multi-colour print) from the spools loaded in the
// studio's AMS right now (GET /api/studio/colors). Used on the invite order form and the customer's order page.

/** " light" for white and ivory, which get a darker rim (same rule as ColorSwatch). */
const lightDot = (hex: string): string => {
  try { return hexToLab(hex).L > 88 ? " light" : ""; } catch { return ""; }
};

/** One colour the studio has loaded now, as GET /api/studio/colors gives it. */
export interface StudioColor { type: Material; color: string; name: string; checked: boolean }
export interface Choice { material: Material | null; colors: ColorChoice[] }

export const NO_CHOICE: Choice = { material: null, colors: [] };

/** The studio's loaded colours: null while loading, [] when there are none or the request failed. */
export function useStudioColors(): StudioColor[] | null {
  const [colors, setColors] = useState<StudioColor[] | null>(null);
  useEffect(() => {
    let live = true;
    fetch("/api/studio/colors", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { colors: [] }))
      .then((d: { colors?: unknown }) => { if (live) setColors(Array.isArray(d.colors) ? (d.colors as StudioColor[]) : []); })
      .catch(() => { if (live) setColors([]); });
    return () => { live = false; };
  }, []);
  return colors;
}

/** Spools of nearly the same colour (two reds of two brands) show as one swatch; a checked spool wins. Order kept. */
export function swatchesFor(palette: StudioColor[]): StudioColor[] {
  const out: { c: StudioColor; i: number }[] = [];
  palette.forEach((c, i) => {
    const twin = out.find((o) => o.c.type === c.type && o.c.name === c.name && deltaE(o.c.color, c.color) < 5);
    if (!twin) out.push({ c, i });
    else if (c.checked && !twin.c.checked) twin.c = c;
  });
  return out.sort((a, b) => a.i - b.i).map((o) => o.c);
}

/** Only the chosen colours that are still offered (spools change): the rest could not be saved anyway. */
export function keepOffered(choice: Choice, swatches: StudioColor[]): Choice {
  const colors = choice.colors.filter((c) => swatches.some((s) => s.type === c.type && s.color === c.color));
  return colors.length === choice.colors.length ? choice : { ...choice, colors };
}

const same = (a: Pick<ColorChoice, "type" | "color">, b: Pick<ColorChoice, "type" | "color">) => a.type === b.type && a.color === b.color;

export default function ColorPicker({ value, onChange, palette, materialLocked = false, disabled = false }: {
  value: Choice; onChange: (c: Choice) => void;
  /** From useStudioColors(). */
  palette: StudioColor[] | null;
  /** Kesuni already priced the order in this material: only colours of it may be picked. */
  materialLocked?: boolean;
  disabled?: boolean;
}) {
  const t = useT();
  const id = useId();
  const [mode, setMode] = useState<ColorMode>(value.colors.length > 1 ? "multi" : "single");
  const multi = mode === "multi";
  const swatches = palette ? swatchesFor(palette) : null;
  const full = value.colors.length >= MAX_COLOR_CHOICES;

  const pickMaterial = (m: Material) => { if (m !== value.material) onChange({ material: m, colors: [] }); };
  const pickMode = (m: ColorMode) => {
    setMode(m);
    if (m === "single" && value.colors.length > 1) onChange({ ...value, colors: value.colors.slice(0, 1) });
  };
  const toggle = (c: StudioColor) => {
    const pick: ColorChoice = { type: c.type, color: c.color, name: c.name };
    if (c.type !== value.material) return onChange({ material: c.type, colors: [pick] });
    if (value.colors.some((x) => same(x, c))) return onChange({ ...value, colors: value.colors.filter((x) => !same(x, c)) });
    if (!multi) return onChange({ ...value, colors: [pick] });
    if (!full) onChange({ ...value, colors: [...value.colors, pick] });
  };

  return (
    <div className="cc">
      <div className="row fields cc-segs">
        <div className="cc-seg">
          <span className="field-label" id={`${id}-m`}>
            {t("Material")}{" "}
            <Info>{t("PLA: neat and rigid, good for most items. PETG: tougher, and handles heat and water better.")}</Info>
          </span>
          <MaterialSeg value={value.material} onChange={pickMaterial} disabled={disabled || materialLocked} labelledBy={`${id}-m`} />
          {materialLocked && <p className="cust-note cc-locked">{t("Kesuni is already pricing your order in this material.")}</p>}
        </div>
        <div className="cc-seg">
          <span className="field-label" id={`${id}-n`}>{t("Colours")}{multi && <span className="cc-count"> · {t("{n} of {total}", { n: value.colors.length, total: MAX_COLOR_CHOICES })}</span>}</span>
          <ColorModeToggle value={mode} onChange={pickMode} disabled={disabled} labelledBy={`${id}-n`} />
        </div>
      </div>

      <div className="cc-palette" aria-labelledby={`${id}-a`} role="group">
        <span className="field-label" id={`${id}-a`}>
          {t("Available colours")}{" "}
          <Info>{t("The spools loaded in Kesuni's printers right now. A dashed circle means Kesuni still checks that colour.")}</Info>
        </span>
        {swatches === null ? <p className="cust-note">{t("Loading colours…")}</p>
          : swatches.length === 0 ? <p className="cust-note">{t("No colours to show right now. Write the colour you want in the notes.")}</p>
            : MATERIALS.map((m) => {
              const list = swatches.filter((c) => c.type === m);
              if (!list.length) return null;
              const other = Boolean(value.material && value.material !== m);
              return (
                <div key={m} className={`cc-group${other ? " other" : ""}`} role="group" aria-label={m}>
                  <span className="cc-type">{m}</span>
                  <div className="cc-swatches">
                    {list.map((c) => {
                      const on = value.colors.some((x) => same(x, c));
                      return (
                        <button key={c.color} type="button" className="cc-swatch" aria-pressed={on} onClick={() => toggle(c)}
                          disabled={disabled || (other && materialLocked) || (multi && full && !on && !other)}
                          title={c.checked ? undefined : t("Kesuni still checks this colour")}>
                          <span className={`cc-dot${c.checked ? "" : " unsure"}${lightDot(c.color)}`} style={{ background: c.color }} aria-hidden="true" />
                          {t(c.name)}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
      </div>

      {multi && (
        <p className="cust-note">
          {t("Multi-colour needs a 3MF file from Bambu Studio. Send it to Kesuni on WhatsApp.")}{" "}
          <Info>{t("An STL file has no colours. Paint the colours in Bambu Studio, then save the project as a 3MF file.")}</Info>
        </p>
      )}
    </div>
  );
}

const NEXT = ["ArrowRight", "ArrowDown"];
const PREV = ["ArrowLeft", "ArrowUp"];

/** PLA | PETG as a radio group (one Tab stop, arrow keys move), like ColorModeToggle. Nothing checked = not chosen. */
function MaterialSeg({ value, onChange, disabled, labelledBy }: {
  value: Material | null; onChange: (m: Material) => void; disabled: boolean; labelledBy: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const at = value ? MATERIALS.indexOf(value) : 0;
  const pick = (i: number) => {
    const k = ((i % MATERIALS.length) + MATERIALS.length) % MATERIALS.length;
    onChange(MATERIALS[k]);
    refs.current[k]?.focus();
  };
  const onKeyDown = (i: number) => (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (NEXT.includes(e.key)) pick(i + 1);
    else if (PREV.includes(e.key)) pick(i - 1);
    else return;
    e.preventDefault();
  };
  return (
    <div className="seg" role="radiogroup" aria-labelledby={labelledBy}>
      {MATERIALS.map((m, i) => (
        <button key={m} ref={(el) => { refs.current[i] = el; }} type="button" role="radio" aria-checked={value === m}
          tabIndex={i === at ? 0 : -1} disabled={disabled} onClick={() => onChange(m)} onKeyDown={onKeyDown(i)}>
          {m}
        </button>
      ))}
    </div>
  );
}

/** The choice as a line of swatches, for the order page. */
export function ChoiceSummary({ choice }: { choice: Choice }) {
  const t = useT();
  if (!choice.material && !choice.colors.length) return <p className="muted" style={{ margin: 0 }}>{t("Not chosen yet")}</p>;
  return (
    <div className="cc-summary">
      {choice.material && <span className="badge">{choice.material}</span>}
      {choice.colors.map((c) => (
        <span key={c.type + c.color} className="cc-chip">
          <span className={`cc-dot${lightDot(c.color)}`} style={{ background: c.color }} aria-hidden="true" />{t(c.name ?? "Unknown colour")}
        </span>
      ))}
      {choice.material && !choice.colors.length && <span className="muted">{t("Any colour")}</span>}
    </div>
  );
}
