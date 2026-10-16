// Kesuni's official price: by weight. Selling price = grams × Rp1.500, cost = grams × Rp750 (the cost
// per gram already covers filament, finishing, print hours and electricity). The price per unit is
// rounded UP to the nearest Rp500. Grams per unit come from the slicer (Bambu Studio), never a guess.
// Pure functions, no I/O: client components import this too (they pass the config from the API,
// because process.env is server-only). The long cost calculator (costing.ts) is only a check.
//
// Time (owner-approved, 15 Oct 2026): one A1 Combo prints a gram in 3–5 min in one colour and 5–15 min in multi
// colour (AMS: filament swaps and purge). One unit is never split across printers, but different units print side by
// side on the studio's printers, so an order prints in ceil(quantity / printers) rounds. Then a person collects,
// checks and packs it (handling hours). The colour mode never changes the price per gram.
//
// Materials (owner, 15 Oct 2026): PLA and PETG. PETG costs the same per gram as PLA unless
// KESUNI_PRICE_PER_GRAM_IDR_PETG / KESUNI_COST_PER_GRAM_IDR_PETG say otherwise. Other materials are priced by a person.
import type { Material, Order } from "./types";

export const MATERIALS: readonly Material[] = ["PLA", "PETG"];
/** "pla", "PLA Basic", "PETG HF" -> "PLA" / "PETG"; anything else (filled, mixed, other materials) -> null. */
export function toMaterial(v: unknown): Material | null {
  const s = typeof v === "string" ? v.trim().toUpperCase().replace(/\s+/g, " ") : "";
  if (/^PLA(\+| (BASIC|MATTE|SILK|TOUGH\+?))?$/.test(s)) return "PLA";
  if (/^PETG( (BASIC|HF))?$/.test(s)) return "PETG";
  return null;
}
/** The order's material: the choice on the order, else a plain PLA/PETG spec. Null when neither says. */
export const orderMaterial = (o: Pick<Order, "material" | "spec">): Material | null =>
  o.material && MATERIALS.includes(o.material) ? o.material : toMaterial(o.spec?.material);

export type ColorMode = "single" | "multi";
export const COLOR_MODES: readonly ColorMode[] = ["single", "multi"];
/** English labels (pages translate them with t()). */
export const COLOR_MODE_LABEL: Record<ColorMode, string> = { single: "Single colour", multi: "Multi colour" };
/** Orders saved before the colour mode existed are single colour. */
export const toColorMode = (v: unknown): ColorMode => (v === "multi" ? "multi" : "single");
/** From a request body: missing means single colour; anything other than "single" or "multi" is null (refuse it). */
export const parseColorMode = (v: unknown): ColorMode | null =>
  v === undefined || v === null || v === "" ? "single" : v === "single" || v === "multi" ? v : null;

/** Minutes, from fastest to slowest. */
export interface MinutesRange { min: number; max: number }

export interface PricingConfig {
  pricePerGramIdr: number;  // selling price per gram
  costPerGramIdr: number;   // Kesuni's cost per gram
  roundIdr: number;         // unit price is rounded up to this
  printMinPerGram: Record<ColorMode, MinutesRange>; // print minutes per gram on one A1 Combo
  handlingHours: number;    // collect, QC and pack after printing, whole hours
  printerCount: number;     // printers that print units side by side
  /** Price and cost per gram for each material (PLA = the two numbers above). Missing from older API answers. */
  materials?: Partial<Record<Material, { pricePerGramIdr: number; costPerGramIdr: number }>>;
}

export interface WeightPrice {
  gramsPerUnit: number;
  quantity: number;
  pricePerGramIdr: number;
  costPerGramIdr: number;
  unitPriceIdr: number;     // rounded up to roundIdr
  unitCostIdr: number;
  totalIdr: number;         // unitPriceIdr × quantity
  costIdr: number;
  marginPct: number;        // (total − cost) / total, one decimal
  colorMode: ColorMode;
  minPerGram: MinutesRange; // print minutes per gram for this colour mode
  batches: number;          // ceil(quantity / printers): rounds of printing
  printMinutes: MinutesRange; // gramsPerUnit × minutes per gram × batches
  handlingHours: number;
  etaHours: number;         // ready in: ceil(printMinutes.max / 60) + handlingHours
}

export const MAX_GRAMS_PER_UNIT = 5000;
/** Above this many minutes per gram the setting is a typo, not a print. */
export const MAX_MIN_PER_GRAM = 60;
export const DEFAULT_PRINT_MIN_PER_GRAM: Readonly<Record<ColorMode, MinutesRange>> = {
  single: { min: 3, max: 5 },
  multi: { min: 5, max: 15 },
};

const env = (name: string): string | undefined => process.env[name];
const num = (name: string, fallback: number) => {
  const n = Number(process.env[name]);
  return process.env[name] !== undefined && process.env[name] !== "" && Number.isFinite(n) && n >= 0 ? n : fallback;
};
const positive = (name: string, fallback: number) => num(name, fallback) || fallback;

/** "3-5" (also "3–5", "3.5-4.5" or one number "4") minutes per gram. Anything else falls back. */
export function parseMinutesRange(raw: string | undefined, fallback: MinutesRange): MinutesRange {
  const m = /^\s*(\d+(?:\.\d+)?)\s*(?:[-–]\s*(\d+(?:\.\d+)?))?\s*$/.exec(raw ?? "");
  if (!m) return { ...fallback };
  const min = Number(m[1]);
  const max = m[2] === undefined ? min : Number(m[2]);
  return min > 0 && max >= min && max <= MAX_MIN_PER_GRAM ? { min, max } : { ...fallback };
}

/** Server only: the numbers come from .env.local. */
export const pricingConfig = (): PricingConfig => {
  const handling = num("KESUNI_HANDLING_HOURS", 1);
  const price = num("KESUNI_PRICE_PER_GRAM_IDR", 1500);
  const cost = num("KESUNI_COST_PER_GRAM_IDR", 750);
  return {
    pricePerGramIdr: price,
    costPerGramIdr: cost,
    materials: {
      PLA: { pricePerGramIdr: price, costPerGramIdr: cost },
      PETG: { pricePerGramIdr: num("KESUNI_PRICE_PER_GRAM_IDR_PETG", price), costPerGramIdr: num("KESUNI_COST_PER_GRAM_IDR_PETG", cost) },
    },
    roundIdr: positive("KESUNI_PRICE_ROUND_IDR", 500),
    printMinPerGram: {
      single: parseMinutesRange(env("KESUNI_PRINT_MIN_PER_GRAM_SINGLE"), DEFAULT_PRINT_MIN_PER_GRAM.single),
      multi: parseMinutesRange(env("KESUNI_PRINT_MIN_PER_GRAM_MULTI"), DEFAULT_PRINT_MIN_PER_GRAM.multi),
    },
    // Whole hours (quotes keep whole hours); more than a week is a typo.
    handlingHours: handling <= 168 ? Math.ceil(handling) : 1,
    // Kesuni's studio has three A1 Combo printers.
    printerCount: Math.max(1, Math.round(positive("KESUNI_PRINTER_COUNT", 3))),
  };
};

/** The config with the price and cost per gram of this material (PLA, or no material: unchanged). */
export function pricingFor(cfg: PricingConfig, material: Material | null | undefined): PricingConfig {
  const m = material ? cfg.materials?.[material] : undefined;
  return m ? { ...cfg, pricePerGramIdr: m.pricePerGramIdr, costPerGramIdr: m.costPerGramIdr } : cfg;
}

/** Reasons the input cannot be priced; empty when it can. */
export function weightInputReasons(gramsPerUnit: number, quantity: number): string[] {
  const r: string[] = [];
  if (!Number.isFinite(gramsPerUnit) || gramsPerUnit <= 0 || gramsPerUnit > MAX_GRAMS_PER_UNIT) {
    r.push(`Grams per piece must be above 0 and at most ${MAX_GRAMS_PER_UNIT}`);
  }
  if (!Number.isInteger(quantity) || quantity < 1) r.push("Quantity must be a whole number, at least 1");
  return r;
}

export function priceByWeight(
  gramsPerUnit: number, quantity: number, colorMode: ColorMode = "single", cfg: PricingConfig = pricingConfig(),
): { ok: true; price: WeightPrice } | { ok: false; reasons: string[] } {
  const reasons = weightInputReasons(gramsPerUnit, quantity);
  if (reasons.length) return { ok: false, reasons };
  // Work in hundredths of a gram so 38.2 × 1500 is exactly 57.300, not 57.300,0000001 (which would round up to 57.500 + 500).
  const centi = Math.round(gramsPerUnit * 100);
  const grams = centi / 100;
  const rawUnit = (centi * cfg.pricePerGramIdr) / 100;
  const unitPriceIdr = Math.ceil(Math.round(rawUnit * 1000) / 1000 / cfg.roundIdr) * cfg.roundIdr;
  const unitCostIdr = Math.round((centi * cfg.costPerGramIdr) / 100);
  const totalIdr = unitPriceIdr * quantity;
  const costIdr = Math.round((centi * cfg.costPerGramIdr * quantity) / 100);
  const mode = toColorMode(colorMode);
  // Pages get the config over the API: one from a server that predates print times falls back to the defaults.
  const perGram = cfg.printMinPerGram?.[mode] ?? DEFAULT_PRINT_MIN_PER_GRAM[mode];
  const handlingHours = cfg.handlingHours ?? 1;
  const batches = Math.ceil(quantity / cfg.printerCount);
  // Also in hundredths, so 12 g × 5 min is exactly 60 min (1 h), never 60.000001 (2 h).
  const minutes = (perMin: number) => Math.round(centi * perMin * batches) / 100;
  const printMinutes = { min: minutes(perGram.min), max: minutes(perGram.max) };
  return {
    ok: true,
    price: {
      gramsPerUnit: grams, quantity, pricePerGramIdr: cfg.pricePerGramIdr, costPerGramIdr: cfg.costPerGramIdr,
      unitPriceIdr, unitCostIdr, totalIdr, costIdr,
      marginPct: totalIdr > 0 ? Math.round(((totalIdr - costIdr) / totalIdr) * 1000) / 10 : 0,
      colorMode: mode, minPerGram: { ...perGram }, batches, printMinutes, handlingHours,
      etaHours: Math.ceil(printMinutes.max / 60) + handlingHours,
    },
  };
}
