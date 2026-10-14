// Cost and price calculator for one order, in whole rupiah. Pure functions, no I/O.
// Same model as our earlier pricing prototype: real costs (material, power, labour, machine wear,
// finishing), a reprint reserve, per-order costs, then price, margin and break-even.
// Estimates only: power comes from an average wattage, not a meter.

export interface CostInput {
  quantity: number;            // units
  gramsPerUnit: number;        // filament per unit, g
  supportWastePct: number;     // extra filament for supports and purge, %
  filamentIdrPerKg: number;
  machineHours: number;        // printer time for the whole order
  avgWatts: number;            // average printer draw (estimate)
  idrPerKwh: number;
  laborHours: number;          // human time for the whole order
  laborIdrPerHour: number;
  machineIdrPerHour: number;   // depreciation + maintenance
  finishingIdr: number;        // per order
  packagingIdr: number;        // per order
  shippingIdr: number;         // per order
  overheadIdr: number;         // share of running the business, per order
  reprintRiskPct: number;      // expected share of prints that fail, %
  unitPriceIdr: number;        // price per unit offered to the customer
  targetMarginPct: number;     // for the suggested price
  feePct: number;              // platform/payment fee taken from revenue, %
}

export interface CostLine { key: string; label: string; idr: number }

export interface CostResult {
  filamentGrams: number;
  kwh: number;
  lines: CostLine[];           // where the money goes, before fee and profit
  productionIdr: number;       // material + power + labour + machine + finishing
  reserveIdr: number;          // reprint reserve
  businessCostIdr: number;     // everything the order costs Kesuni
  revenueIdr: number;          // quantity × unit price
  feeIdr: number;
  profitIdr: number;           // revenue − cost − fee (before tax)
  marginPct: number;           // profit / revenue, one decimal
  targetUnitPriceIdr: number;  // unit price that reaches targetMarginPct
  breakEvenUnitPriceIdr: number;
}

/** Kesuni's defaults: Bambu Lab A1, PLA, Padang. Every value is editable per order. */
export const KESUNI_DEFAULTS: CostInput = {
  quantity: 1,
  gramsPerUnit: 20,
  supportWastePct: 12,
  filamentIdrPerKg: 180_000,
  machineHours: 1,
  avgWatts: 120,
  idrPerKwh: 1_700,
  laborHours: 0.5,
  laborIdrPerHour: 25_000,
  machineIdrPerHour: 3_500,
  finishingIdr: 0,
  packagingIdr: 3_000,
  shippingIdr: 0,
  overheadIdr: 5_000,
  reprintRiskPct: 8,
  unitPriceIdr: 50_000,
  targetMarginPct: 25,
  feePct: 0,
};

const FIELDS = Object.keys(KESUNI_DEFAULTS) as (keyof CostInput)[];

/** Check and clean an input that came from a form or an API body. */
export function parseCostInput(raw: Record<string, unknown>): { ok: true; input: CostInput } | { ok: false; reasons: string[] } {
  const reasons: string[] = [];
  const input = { ...KESUNI_DEFAULTS };
  for (const k of FIELDS) {
    if (raw[k] === undefined || raw[k] === "") continue;
    const n = Number(raw[k]);
    if (!Number.isFinite(n) || n < 0) reasons.push(`${k} must be a number, 0 or more`);
    else input[k] = n;
  }
  if (!Number.isInteger(input.quantity) || input.quantity < 1) reasons.push("quantity must be a whole number, at least 1");
  if (input.reprintRiskPct >= 100) reasons.push("reprintRiskPct must be under 100");
  if (input.targetMarginPct + input.feePct >= 100) reasons.push("targetMarginPct + feePct must be under 100");
  return reasons.length ? { ok: false, reasons } : { ok: true, input };
}

export function calculate(i: CostInput): CostResult {
  const filamentGrams = i.quantity * i.gramsPerUnit * (1 + i.supportWastePct / 100);
  const material = filamentGrams * (i.filamentIdrPerKg / 1000);
  const kwh = (i.machineHours * i.avgWatts) / 1000;
  const power = kwh * i.idrPerKwh;
  const labor = i.laborHours * i.laborIdrPerHour;
  const machine = i.machineHours * i.machineIdrPerHour;
  const production = material + power + labor + machine + i.finishingIdr;
  const risk = i.reprintRiskPct / 100;
  const reserve = (production * risk) / (1 - risk);
  const businessCost = production + reserve + i.packagingIdr + i.shippingIdr + i.overheadIdr;
  const revenue = i.quantity * i.unitPriceIdr;
  const fee = revenue * (i.feePct / 100);
  const profit = revenue - businessCost - fee;
  const keep = 1 - i.feePct / 100;
  const r = Math.round;
  const lines: CostLine[] = [
    { key: "material", label: "Material + support/waste", idr: r(material) },
    { key: "power", label: "Electricity", idr: r(power) },
    { key: "labor", label: "Labour", idr: r(labor) },
    { key: "machine", label: "Machine & upkeep", idr: r(machine) },
    { key: "finishing", label: "Finishing", idr: r(i.finishingIdr) },
    { key: "reserve", label: "Reprint reserve", idr: r(reserve) },
    { key: "packing", label: "Packaging + shipping", idr: r(i.packagingIdr + i.shippingIdr) },
    { key: "overhead", label: "Overhead share", idr: r(i.overheadIdr) },
  ];
  const businessCostIdr = r(businessCost);
  return {
    filamentGrams: Math.ceil(filamentGrams),
    kwh: Math.round(kwh * 100) / 100,
    lines,
    productionIdr: r(production),
    reserveIdr: r(reserve),
    businessCostIdr,
    revenueIdr: r(revenue),
    feeIdr: r(fee),
    profitIdr: r(profit),
    marginPct: revenue > 0 ? Math.round((profit / revenue) * 1000) / 10 : 0,
    targetUnitPriceIdr: Math.ceil(businessCost / (keep - i.targetMarginPct / 100) / i.quantity),
    breakEvenUnitPriceIdr: Math.ceil(businessCost / keep / i.quantity),
  };
}

/** Rupiah per USDC, for showing prices to Indonesian customers. Display and pricing only: money moves in USDC. */
export const idrPerUsdc = (): number => {
  const n = Number(process.env.IDR_PER_USDC);
  return Number.isFinite(n) && n > 0 ? n : 16_500;
};
/** Rupiah to micro-USDC, rounded to whole cents (0.01 USDC) so prices read cleanly. */
export const idrToMicro = (idr: number): number => Math.round((idr / idrPerUsdc()) * 100) * 10_000;
export const microToIdr = (micro: number): number => Math.round((micro / 1e6) * idrPerUsdc());
