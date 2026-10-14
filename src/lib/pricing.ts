// Kesuni's official price: by weight. Selling price = grams × Rp1.500, cost = grams × Rp750 (the cost
// per gram already covers filament, finishing, print hours and electricity). The price per unit is
// rounded UP to the nearest Rp500. Grams per unit come from the slicer (Bambu Studio), never a guess.
// Pure functions, no I/O: client components import this too (they pass the config from the API,
// because process.env is server-only). The long cost calculator (costing.ts) is only a check.

export interface PricingConfig {
  pricePerGramIdr: number;  // selling price per gram
  costPerGramIdr: number;   // Kesuni's cost per gram
  roundIdr: number;         // unit price is rounded up to this
  gramsPerHour: number;     // one A1 printer, PLA, rough
  printerCount: number;
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
  etaHours: number;         // 24 h for prep, QC and packing + print time on all printers
}

export const MAX_GRAMS_PER_UNIT = 5000;

const num = (name: string, fallback: number) => {
  const n = Number(process.env[name]);
  return process.env[name] !== undefined && process.env[name] !== "" && Number.isFinite(n) && n >= 0 ? n : fallback;
};
const positive = (name: string, fallback: number) => num(name, fallback) || fallback;

/** Server only: the numbers come from .env.local. */
export const pricingConfig = (): PricingConfig => ({
  pricePerGramIdr: num("KESUNI_PRICE_PER_GRAM_IDR", 1500),
  costPerGramIdr: num("KESUNI_COST_PER_GRAM_IDR", 750),
  roundIdr: positive("KESUNI_PRICE_ROUND_IDR", 500),
  gramsPerHour: positive("KESUNI_GRAMS_PER_HOUR", 15),
  printerCount: Math.max(1, Math.round(positive("KESUNI_PRINTER_COUNT", 2))),
});

/** Reasons the input cannot be priced; empty when it can. */
export function weightInputReasons(gramsPerUnit: number, quantity: number): string[] {
  const r: string[] = [];
  if (!Number.isFinite(gramsPerUnit) || gramsPerUnit <= 0 || gramsPerUnit > MAX_GRAMS_PER_UNIT) {
    r.push(`Grams per unit must be above 0 and at most ${MAX_GRAMS_PER_UNIT}`);
  }
  if (!Number.isInteger(quantity) || quantity < 1) r.push("Quantity must be a whole number, at least 1");
  return r;
}

export function priceByWeight(
  gramsPerUnit: number, quantity: number, cfg: PricingConfig = pricingConfig(),
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
  const totalGrams = grams * quantity;
  return {
    ok: true,
    price: {
      gramsPerUnit: grams, quantity, pricePerGramIdr: cfg.pricePerGramIdr, costPerGramIdr: cfg.costPerGramIdr,
      unitPriceIdr, unitCostIdr, totalIdr, costIdr,
      marginPct: totalIdr > 0 ? Math.round(((totalIdr - costIdr) / totalIdr) * 1000) / 10 : 0,
      etaHours: 24 + Math.ceil(totalGrams / (cfg.gramsPerHour * cfg.printerCount)),
    },
  };
}
