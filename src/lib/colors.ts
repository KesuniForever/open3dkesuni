// Colours of filament: what the studio has loaded in its AMS units, English names for them, and matching the colours
// of a sliced 3MF to the spools on one printer. Pure functions, no I/O: client components import this too.
// Distance is CIEDE2000 (deltaE00) in Lab: about 1 is the smallest difference people see, 2–10 is "the same colour,
// another batch or brand", above ~10 it is another colour. Material must always match exactly (PLA is never PETG).
import type { AmsTray, PrinterSnapshot } from "./printer/bambu";
import type { ColorChoice, Material, Printer, ThreeMfFilament } from "./types";
import { toMaterial } from "./pricing";

/** Above this deltaE00 a spool is not the colour the file asks for (it may still be offered as a suggestion). */
export const MATCH_MAX_DELTA_E = 10;

// ---------- hex <-> Lab ----------

export type Lab = { L: number; a: number; b: number };
const HEX = /^#?([0-9a-fA-F]{6})([0-9a-fA-F]{2})?$/;

/** "#fec600", "FEC600FF" -> "#FEC600"; null when it is not a colour. */
export function normalizeHex(v: unknown): string | null {
  const m = typeof v === "string" ? HEX.exec(v.trim()) : null;
  return m ? `#${m[1].toUpperCase()}` : null;
}

export function hexToRgb(hex: string): [number, number, number] {
  const h = normalizeHex(hex);
  if (!h) throw new Error(`Not a colour: ${hex}`);
  return [0, 2, 4].map((i) => Number.parseInt(h.slice(1 + i, 3 + i), 16)) as [number, number, number];
}

export function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((c) => Math.round(Math.max(0, Math.min(255, c))).toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}

// sRGB D65 -> XYZ -> Lab
const lin = (c: number) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const unlin = (v: number) => 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
const WHITE = [0.95047, 1, 1.08883];
const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
const fInv = (t: number) => (t ** 3 > 216 / 24389 ? t ** 3 : (116 * t - 16) / (24389 / 27));

export function hexToLab(hex: string): Lab {
  const [r, g, b] = hexToRgb(hex).map(lin);
  const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / WHITE[0];
  const y = (0.2126729 * r + 0.7151522 * g + 0.072175 * b) / WHITE[1];
  const z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / WHITE[2];
  const fx = f(x), fy = f(y), fz = f(z);
  return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

export function labToHex({ L, a, b }: Lab): string {
  const fy = (L + 16) / 116, fx = fy + a / 500, fz = fy - b / 200;
  const [x, y, z] = [fInv(fx) * WHITE[0], fInv(fy) * WHITE[1], fInv(fz) * WHITE[2]];
  const r = 3.2404542 * x - 1.5371385 * y - 0.4985314 * z;
  const g = -0.969266 * x + 1.8760108 * y + 0.041556 * z;
  const bl = 0.0556434 * x - 0.2040259 * y + 1.0572252 * z;
  return rgbToHex(unlin(r), unlin(g), unlin(bl));
}

/** CIEDE2000 colour difference between two hex colours. */
export function deltaE(hex1: string, hex2: string): number {
  const p = hexToLab(hex1), q = hexToLab(hex2);
  const rad = Math.PI / 180;
  const C1 = Math.hypot(p.a, p.b), C2 = Math.hypot(q.a, q.b);
  const Cm = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cm ** 7 / (Cm ** 7 + 25 ** 7)));
  const a1 = (1 + G) * p.a, a2 = (1 + G) * q.a;
  const c1 = Math.hypot(a1, p.b), c2 = Math.hypot(a2, q.b);
  const hue = (b: number, a: number) => { if (a === 0 && b === 0) return 0; const h = Math.atan2(b, a) / rad; return h < 0 ? h + 360 : h; };
  const h1 = hue(p.b, a1), h2 = hue(q.b, a2);
  const dL = q.L - p.L, dC = c2 - c1;
  let dh = 0;
  if (c1 * c2 !== 0) dh = Math.abs(h2 - h1) <= 180 ? h2 - h1 : h2 - h1 > 180 ? h2 - h1 - 360 : h2 - h1 + 360;
  const dH = 2 * Math.sqrt(c1 * c2) * Math.sin((dh / 2) * rad);
  const Lm = (p.L + q.L) / 2, cm = (c1 + c2) / 2;
  let hm = h1 + h2;
  if (c1 * c2 !== 0) hm = Math.abs(h1 - h2) <= 180 ? (h1 + h2) / 2 : h1 + h2 < 360 ? (h1 + h2 + 360) / 2 : (h1 + h2 - 360) / 2;
  const T = 1 - 0.17 * Math.cos((hm - 30) * rad) + 0.24 * Math.cos(2 * hm * rad) + 0.32 * Math.cos((3 * hm + 6) * rad) - 0.2 * Math.cos((4 * hm - 63) * rad);
  const dTheta = 30 * Math.exp(-(((hm - 275) / 25) ** 2));
  const Rc = 2 * Math.sqrt(cm ** 7 / (cm ** 7 + 25 ** 7));
  const Sl = 1 + (0.015 * (Lm - 50) ** 2) / Math.sqrt(20 + (Lm - 50) ** 2);
  const Sc = 1 + 0.045 * cm, Sh = 1 + 0.015 * cm * T;
  const Rt = -Math.sin(2 * dTheta * rad) * Rc;
  return Math.sqrt((dL / Sl) ** 2 + (dC / Sc) ** 2 + (dH / Sh) ** 2 + Rt * (dC / Sc) * (dH / Sh));
}

// ---------- names ----------

/** Small palette of plain English colour names (pages translate them with t()). Filament colours, not paint chips. */
export const COLOR_NAMES: readonly { name: string; hex: string }[] = [
  { name: "Black", hex: "#000000" }, { name: "Charcoal", hex: "#3A3A3A" }, { name: "Grey", hex: "#808080" },
  { name: "Silver", hex: "#C0C0C0" }, { name: "White", hex: "#FFFFFF" }, { name: "Ivory", hex: "#F3EBD8" },
  { name: "Beige", hex: "#D8C3A0" }, { name: "Brown", hex: "#7B4A2A" }, { name: "Dark red", hex: "#8B1A1A" },
  { name: "Red", hex: "#C8261F" }, { name: "Pink", hex: "#F29BB5" }, { name: "Magenta", hex: "#C2185B" },
  { name: "Orange", hex: "#FF6A13" }, { name: "Gold", hex: "#D4A017" }, { name: "Yellow", hex: "#FCD200" },
  { name: "Lime", hex: "#9BD12E" }, { name: "Green", hex: "#3F8E43" }, { name: "Dark green", hex: "#1E4D2B" },
  { name: "Mint", hex: "#9FE2BF" }, { name: "Teal", hex: "#00827F" }, { name: "Cyan", hex: "#00BCE4" },
  { name: "Sky blue", hex: "#7EC8E3" }, { name: "Blue", hex: "#0072CE" }, { name: "Navy", hex: "#1B2A57" },
  { name: "Purple", hex: "#6A3FA0" }, { name: "Lavender", hex: "#B9A4DA" },
];

/** The nearest English name for a colour, e.g. "#FEC600" -> "Yellow". */
export function nameOf(hex: string): string {
  const h = normalizeHex(hex);
  if (!h) return "Unknown colour";
  let best = COLOR_NAMES[0], bestD = Infinity;
  for (const c of COLOR_NAMES) {
    const d = deltaE(h, c.hex);
    if (d < bestD) { best = c; bestD = d; }
  }
  return best.name;
}

// ---------- the studio's loaded spools ----------

/** A distinct material + colour loaded somewhere in the studio. */
export interface PaletteColor {
  type: Material;
  color: string;        // "#RRGGBB"
  name: string;         // English colour name
  /** Every printer that has it, with its global tray numbers (ams*4 + slot). Operator pages only, never customers. */
  printers: { printerId: string; slots: number[] }[];
  /** True when at least one of those spools is a Bambu RFID spool or a person checked the colours on that printer
   *  since the spools last changed. Generic spools show black until a person types the colour on the printer. */
  checked: boolean;
}

/** Signature of the loaded trays: a person's colour check stays valid while this is unchanged. */
export function amsKey(s: Pick<PrinterSnapshot, "ams"> | undefined): string {
  return (s?.ams?.trays ?? []).filter((t) => !t.empty).map((t) => `${t.ams * 4 + t.slot}:${t.type}:${t.color}`).join("|");
}

/** The colour check of this printer still matches what is loaded. */
export const colorsCheckedNow = (p: Pick<Printer, "colorsChecked" | "snapshot">): boolean =>
  Boolean(p.colorsChecked && p.colorsChecked.key === amsKey(p.snapshot));

const loaded = (t: AmsTray) => !t.empty && t.type && t.color;

/**
 * Distinct (material, colour) pairs loaded in the studio's AMS units, PLA and PETG only. Printers not seen for
 * maxAgeMs (default a day) are left out: their spools may have changed. Sorted by material, then name.
 */
export function studioPalette(printers: Printer[], now = Date.now(), maxAgeMs = 24 * 3600_000): PaletteColor[] {
  const out = new Map<string, PaletteColor>();
  for (const p of printers) {
    if (!p.lastSeen || now - Date.parse(p.lastSeen) > maxAgeMs) continue;
    const checked = colorsCheckedNow(p);
    for (const t of p.snapshot?.ams?.trays ?? []) {
      const type = loaded(t) ? toMaterial(t.type) : null;
      if (!type) continue;
      const key = `${type}${t.color}`;
      const entry = out.get(key) ?? { type, color: t.color!, name: nameOf(t.color!), printers: [], checked: false };
      const slot = t.ams * 4 + t.slot;
      const onPrinter = entry.printers.find((x) => x.printerId === p.id);
      if (onPrinter) onPrinter.slots.push(slot);
      else entry.printers.push({ printerId: p.id, slots: [slot] });
      entry.checked ||= checked || t.bambu;
      out.set(key, entry);
    }
  }
  return [...out.values()].sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name) || a.color.localeCompare(b.color));
}

/** The palette as customers may see it: material, colour and name only (no printers, slots or addresses). */
export const publicPalette = (palette: PaletteColor[]) => palette.map(({ type, color, name, checked }) => ({ type, color, name, checked }));

// ---------- matching a sliced file to one printer's spools ----------

export interface JobMatch {
  /** Every used filament has a spool of the same material within MATCH_MAX_DELTA_E. */
  ok: boolean;
  /** ams_mapping: one entry per project filament; the global tray, or -1 when this plate does not use it. */
  mapping: number[];
  /** Used filaments with no spool of the same material within the colour limit. */
  missing: { filamentId: number; type: string; color: string; reason: "material" | "color" }[];
  /** For each used filament, the spools of the same material on this printer, nearest colour first. */
  suggestions: { filamentId: number; slots: { slot: number; color: string; deltaE: number }[] }[];
}

/**
 * Pick a tray for each filament of a plate: same material required, nearest colour by deltaE00. Several filaments may
 * share a tray when they are the same material and colour. projectCount is the number of filaments in the project
 * (ThreeMfInfo.projectFilaments.length): the mapping always has that length.
 */
export function matchJob(
  filaments: ThreeMfFilament[], printer: Pick<Printer, "snapshot">, projectCount?: number, maxDeltaE = MATCH_MAX_DELTA_E,
): JobMatch {
  const count = Math.max(projectCount ?? 0, ...filaments.map((x) => x.id), 0);
  const mapping = Array.from({ length: count }, () => -1);
  const trays = (printer.snapshot?.ams?.trays ?? []).filter(loaded);
  const missing: JobMatch["missing"] = [];
  const suggestions: JobMatch["suggestions"] = [];
  for (const fil of filaments) {
    const want = fil.type.trim().toUpperCase();
    const color = normalizeHex(fil.color) ?? "#000000";
    const same = trays.filter((t) => t.type!.toUpperCase() === want)
      .map((t) => ({ slot: t.ams * 4 + t.slot, color: t.color!, deltaE: Math.round(deltaE(color, t.color!) * 10) / 10 }))
      .sort((a, b) => a.deltaE - b.deltaE || a.slot - b.slot);
    suggestions.push({ filamentId: fil.id, slots: same });
    if (!same.length) { missing.push({ filamentId: fil.id, type: fil.type, color, reason: "material" }); continue; }
    if (same[0].deltaE > maxDeltaE) { missing.push({ filamentId: fil.id, type: fil.type, color, reason: "color" }); continue; }
    if (fil.id >= 1 && fil.id <= count) mapping[fil.id - 1] = same[0].slot;
  }
  return { ok: missing.length === 0 && filaments.length > 0, mapping, missing, suggestions };
}

// ---------- the customer's choice ----------

/** At most this many colours per order (one AMS lite holds 4 spools). */
export const MAX_COLOR_CHOICES = 4;

/**
 * Colours a customer picked, from a request body: [{ type: "PLA" | "PETG", color: "#RRGGBB", name? }]. Missing means
 * none. With a palette (studioPalette of the printers now), each colour must be one the studio has loaded: exact
 * material and colour. Names are cut short; a missing name becomes nameOf(color).
 */
export function parseColorChoices(
  v: unknown, palette?: Pick<PaletteColor, "type" | "color">[],
): { ok: true; choices: ColorChoice[] } | { ok: false; reasons: string[] } {
  if (v === undefined || v === null) return { ok: true, choices: [] };
  if (!Array.isArray(v)) return { ok: false, reasons: ["Colours must be a list"] };
  if (v.length > MAX_COLOR_CHOICES) return { ok: false, reasons: [`Pick at most ${MAX_COLOR_CHOICES} colours`] };
  const reasons: string[] = [];
  const choices: ColorChoice[] = [];
  for (const raw of v) {
    const c = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
    const type = c.type === "PLA" || c.type === "PETG" ? c.type : null;
    const color = normalizeHex(c.color);
    if (!type) { reasons.push("Material must be PLA or PETG"); continue; }
    if (!color) { reasons.push("A colour must be written as #RRGGBB"); continue; }
    if (palette && !palette.some((p) => p.type === type && p.color === color)) {
      reasons.push(`${type} ${nameOf(color)} (${color}) is not loaded in the studio right now`);
      continue;
    }
    if (choices.some((x) => x.type === type && x.color === color)) continue;
    const name = typeof c.name === "string" && c.name.trim() ? c.name.trim().slice(0, 40) : nameOf(color);
    choices.push({ type, color, name });
  }
  return reasons.length ? { ok: false, reasons } : { ok: true, choices };
}
